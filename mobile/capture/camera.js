/** Rear camera: preview, still photo (JPEG) and short video (MediaRecorder). */

export function createCamera(video) {
  let stream = null;
  let recorder = null;
  let chunks = [];

  async function start() {
    if (stream) return stream;
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('Camera API unavailable (needs https)');
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1440 },
      },
    });
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play().catch(() => {});
    return stream;
  }

  function stop() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
  }

  function info() {
    const t = stream?.getVideoTracks()[0];
    if (!t) return null;
    const s = t.getSettings?.() || {};
    return {
      label: t.label || 'camera',
      width: s.width,
      height: s.height,
      facingMode: s.facingMode || null,
      frameRate: s.frameRate ? Math.round(s.frameRate) : null,
    };
  }

  /** Grab the current frame as a JPEG blob at the sensor's resolution. */
  async function photo() {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new Error('Camera not ready');
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(video, 0, 0, w, h);
    return new Promise((resolve, reject) =>
      c.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Encode failed'))),
        'image/jpeg',
        0.92,
      ),
    );
  }

  function canRecord() {
    return !!stream && typeof MediaRecorder !== 'undefined';
  }

  function startVideo() {
    if (!canRecord()) throw new Error('Video recording unavailable');
    const types = [
      'video/mp4;codecs=avc1',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported?.(t));
    chunks = [];
    recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType, videoBitsPerSecond: 4e6 } : undefined,
    );
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start(250);
  }

  function stopVideo() {
    return new Promise((resolve) => {
      if (!recorder || recorder.state === 'inactive') return resolve(null);
      recorder.onstop = () =>
        resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
      recorder.stop();
    });
  }

  return {
    start,
    stop,
    info,
    photo,
    startVideo,
    stopVideo,
    canRecord,
    get active() {
      return !!stream;
    },
  };
}
