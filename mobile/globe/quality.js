/**
 * Adaptive quality governor (DESIGN.md §5).
 *
 * The scene renders on demand, so idle time is not slow time: only intervals
 * between back-to-back frames (< 250 ms apart, i.e. while something animates)
 * count. Over a rolling 2 s window, a mean frame time above 20 ms steps the
 * pixel ratio down 2 → 1.5 → 1.25 → 1 and, from 1.25 down, switches bloom
 * off. Eight calm seconds at vsync (< 17.5 ms) step back up toward the mode's ceiling.
 * Battery saver (Battery API) and 'low' pin the floor.
 */

export const SCALE_STEPS = Object.freeze([1, 1.25, 1.5, 2]);
const WINDOW_MS = 2000;
const UPGRADE_CALM_MS = 8000;
const SLOW_MS = 20;
const FAST_MS = 17.5; // holding vsync at 60 Hz

export function createGovernor(
  viewer,
  {
    quality = 'auto',
    post,
    onChange,
    devicePixelRatio = globalThis.devicePixelRatio || 1,
  } = {},
) {
  const scene = viewer.scene;
  const globe = scene.globe;
  const dprCap = Math.min(devicePixelRatio, 2);
  const ceiling = SCALE_STEPS.filter((s) => s <= dprCap + 1e-6).length - 1;
  let mode = quality;
  let index = mode === 'low' ? 0 : ceiling;
  let lowPower = false;
  let samples = [];
  let last = 0;
  let calmSince = 0;
  let fps = 0;
  let bloomCut = false; // set when still slow at the floor

  function apply() {
    const scale = SCALE_STEPS[index];
    viewer.useBrowserRecommendedResolution = true; // resolutionScale = CSS→device ratio
    viewer.resolutionScale = scale;
    // Screen-space error is measured in drawing-buffer pixels: scale it with
    // the pixel ratio so a 2x phone fetches the tiles a 1x screen would,
    // with a compact-screen bias (§5: 2 → 4).
    const compact =
      Math.min(viewer.canvas.clientWidth, viewer.canvas.clientHeight) < 600;
    const base = mode === 'high' ? 1.5 : compact ? 2 : 1.5;
    globe.maximumScreenSpaceError = base * Math.max(1, scale);
    globe.tileCacheSize = mode === 'low' || lowPower ? 100 : 320;
    // The first step down keeps bloom; the second (or being slow at the
    // floor) drops it.
    post?.setBloomAllowed(
      mode !== 'low' && !lowPower && !bloomCut && ceiling - index < 2,
    );
    scene.requestRender();
    onChange?.({
      scale,
      fps: Math.round(fps),
      bloom: Boolean(post?.bloomActive),
      quality: mode,
    });
  }

  let renderStart = 0;
  const removePre = scene.preRender.addEventListener(() => {
    renderStart = performance.now();
  });
  const remove = scene.postRender.addEventListener(() => {
    const now = performance.now();
    const dt = now - last;
    const cost = now - renderStart;
    last = now;
    // Back-to-back frames measure the real frame time; an isolated frame
    // after an idle gap still reports what the render itself cost.
    const sample = dt > 0 && dt <= 250 ? dt : cost;
    samples.push([now, sample]);
    while (samples.length && now - samples[0][0] > WINDOW_MS) samples.shift();
    let slowCount = 0;
    for (const s of samples) if (s[1] > 100) slowCount++;
    if (samples.length < 20 && slowCount < 3) return;
    let sum = 0;
    for (const s of samples) sum += s[1];
    const mean = sum / samples.length;
    fps = 1000 / mean;
    if (mode !== 'auto') return;
    if (mean > SLOW_MS && (index > 0 || (!bloomCut && post?.bloomActive))) {
      if (index > 0) index--;
      else bloomCut = true;
      samples = [];
      calmSince = now;
      apply();
    } else if (mean < FAST_MS) {
      if (!calmSince) calmSince = now;
      if (
        now - calmSince > UPGRADE_CALM_MS &&
        (index < ceiling || bloomCut) &&
        !lowPower
      ) {
        if (bloomCut) bloomCut = false;
        else index++;
        samples = [];
        calmSince = now;
        apply();
      }
    } else calmSince = now;
  });

  // Battery saver: drop to the floor while discharging under 20 %.
  globalThis.navigator?.getBattery?.().then(
    (battery) => {
      const check = () => {
        const next = !battery.charging && battery.level < 0.2;
        if (next === lowPower) return;
        lowPower = next;
        if (lowPower) index = 0;
        apply();
      };
      battery.addEventListener('levelchange', check);
      battery.addEventListener('chargingchange', check);
      check();
    },
    () => {},
  );

  apply();

  return {
    setQuality(next) {
      mode = next;
      index = mode === 'low' ? 0 : ceiling;
      bloomCut = false;
      apply();
    },
    state() {
      return {
        scale: SCALE_STEPS[index],
        fps: Math.round(fps),
        bloom: Boolean(post?.bloomActive),
        quality: mode,
        lowPower,
      };
    },
    destroy() {
      remove();
      removePre();
    },
  };
}
