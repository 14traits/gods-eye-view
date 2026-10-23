/**
 * Link graph (DESIGN.md §12.1): a hand-written force-directed graph of
 * globe.graph(ref), ≤ 40 nodes, on one canvas. Nodes are coloured by
 * altitude band, the root is larger, edges carry their relation on hover.
 * Drag a node to pull the graph; tap a node to open its dossier. Selection
 * is shared with the globe through `select(id)`.
 */

import { BAND_COLOR } from './bands.js';
import { bandOfKind } from './shim3.js';
import { reducedMotion } from './dom.js';

const KIND_GLYPH = {
  aircraft: '✈',
  helicopter: 'H',
  military: '✈',
  satellite: '◆',
  vessel: '⛴',
  quake: '◎',
  camera: '◉',
  situation: '!',
  place: '⌖',
  moment: '▶',
  track: '·',
  capture: '◐',
};

export function createLinkGraph(host, { onOpen, onSelect } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'lg';
  wrap.innerHTML = `<canvas class="lg-canvas" aria-label="Link graph" role="img"></canvas><div class="lg-tip tele" hidden></div><div class="lg-legend tele"><span data-band="orbit"><i></i>Orbit</span><span data-band="sky"><i></i>Sky</span><span data-band="ground"><i></i>Ground</span><span data-band="inside"><i></i>Inside</span></div>`;
  host.appendChild(wrap);
  const canvas = wrap.querySelector('canvas');
  const tip = wrap.querySelector('.lg-tip');
  const ctx = canvas.getContext('2d');
  let W = 0;
  let H = 0;
  let dpr = 1;
  let nodes = [];
  let edges = [];
  let rootId = null;
  let selected = null;
  let hover = null;
  let alpha = 1;
  let raf = 0;
  let dragN = null;
  let destroyed = false;

  function resize() {
    const r = wrap.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    kick(0.3);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);

  function set(graph, root) {
    rootId = root;
    const prev = new Map(nodes.map((n) => [n.id, n]));
    const deg = new Map();
    for (const e of graph.edges) {
      deg.set(e.from, (deg.get(e.from) || 0) + 1);
      deg.set(e.to, (deg.get(e.to) || 0) + 1);
    }
    nodes = graph.nodes.slice(0, 40).map((n, i) => {
      const p = prev.get(n.id);
      const a = (i / Math.max(1, graph.nodes.length)) * Math.PI * 2;
      const isRoot = n.id === root;
      return {
        ...n,
        band: bandOfKind(n.kind),
        r: isRoot ? 15 : 7 + Math.min(5, (deg.get(n.id) || 1) * 0.9),
        x: p?.x ?? (isRoot ? 0 : Math.cos(a) * 90),
        y: p?.y ?? (isRoot ? 0 : Math.sin(a) * 90),
        vx: 0,
        vy: 0,
        root: isRoot,
      };
    });
    const idx = new Map(nodes.map((n, i) => [n.id, i]));
    edges = graph.edges
      .filter((e) => idx.has(e.from) && idx.has(e.to))
      .map((e) => ({
        ...e,
        a: nodes[idx.get(e.from)],
        b: nodes[idx.get(e.to)],
      }));
    kick(1);
  }

  function kick(a = 0.6) {
    alpha = Math.max(alpha, a);
    if (!raf && !destroyed) raf = requestAnimationFrame(tick);
  }

  function step() {
    const k = 1;
    // Repulsion
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 0.5;
        }
        const f = (4200 * k) / d2;
        const d = Math.sqrt(d2);
        a.vx -= (dx / d) * f;
        a.vy -= (dy / d) * f;
        b.vx += (dx / d) * f;
        b.vy += (dy / d) * f;
      }
    }
    // Springs
    for (const e of edges) {
      const dx = e.b.x - e.a.x;
      const dy = e.b.y - e.a.y;
      const d = Math.max(0.01, Math.hypot(dx, dy));
      const rest = e.a.root || e.b.root ? 120 : 80;
      const f = (d - rest) * 0.035;
      e.a.vx += (dx / d) * f;
      e.a.vy += (dy / d) * f;
      e.b.vx -= (dx / d) * f;
      e.b.vy -= (dy / d) * f;
    }
    for (const n of nodes) {
      // Gravity to the centre; the root is pinned there.
      n.vx -= n.x * 0.012;
      n.vy -= n.y * 0.012;
      if (n.root && n !== dragN) {
        n.x *= 0.8;
        n.y *= 0.8;
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      if (n === dragN) continue;
      n.vx *= 0.62;
      n.vy *= 0.62;
      n.x += n.vx * alpha;
      n.y += n.vy * alpha;
    }
  }

  function view() {
    // Fit the graph into the canvas with padding.
    let minX = -60;
    let maxX = 60;
    let minY = -60;
    let maxY = 60;
    for (const n of nodes) {
      minX = Math.min(minX, n.x - n.r);
      maxX = Math.max(maxX, n.x + n.r);
      minY = Math.min(minY, n.y - n.r);
      maxY = Math.max(maxY, n.y + n.r);
    }
    const pad = 46;
    const s = Math.min(
      2.2,
      (W - pad * 2) / (maxX - minX),
      (H - pad * 2) / (maxY - minY),
    );
    return {
      s,
      cx: W / 2 - ((minX + maxX) / 2) * s,
      cy: H / 2 - ((minY + maxY) / 2) * s,
    };
  }
  let V = { s: 1, cx: 0, cy: 0 };
  const sx = (n) => V.cx + n.x * V.s;
  const sy = (n) => V.cy + n.y * V.s;

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    V = view();
    const focus = hover || selected || rootId;
    const relFocus = hover || selected;
    const near = new Set();
    if (focus)
      for (const e of edges) {
        if (e.a.id === focus) near.add(e.b.id);
        if (e.b.id === focus) near.add(e.a.id);
      }
    // Edges
    for (const e of edges) {
      const hot = focus && (e.a.id === focus || e.b.id === focus);
      ctx.strokeStyle = hot
        ? 'rgba(255,255,255,0.7)'
        : 'rgba(255,255,255,0.16)';
      ctx.lineWidth = hot ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(sx(e.a), sy(e.a));
      ctx.lineTo(sx(e.b), sy(e.b));
      ctx.stroke();
      if (hot && e.relation && relFocus) {
        const mx = (sx(e.a) + sx(e.b)) / 2;
        const my = (sy(e.a) + sy(e.b)) / 2;
        ctx.font = '600 9px "JetBrains Mono", ui-monospace, monospace';
        const w = ctx.measureText(e.relation.toUpperCase()).width;
        ctx.fillStyle = 'rgba(8,10,14,0.85)';
        ctx.fillRect(mx - w / 2 - 4, my - 7, w + 8, 14);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.textAlign = 'center';
        ctx.fillText(e.relation.toUpperCase(), mx, my + 3);
      }
    }
    // Nodes
    for (const n of nodes) {
      const x = sx(n);
      const y = sy(n);
      const col = BAND_COLOR[n.band] || '#fff';
      const dim = focus && focus !== n.id && !near.has(n.id) && !n.root;
      ctx.globalAlpha = dim ? 0.35 : 1;
      if (n.id === selected || n.root) {
        ctx.fillStyle = `${col}33`;
        ctx.beginPath();
        ctx.arc(x, y, n.r + 7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = n.root ? col : '#0b0d11';
      ctx.strokeStyle = col;
      ctx.lineWidth = n.root ? 0 : 2;
      ctx.beginPath();
      ctx.arc(x, y, n.r, 0, Math.PI * 2);
      ctx.fill();
      if (!n.root) ctx.stroke();
      ctx.fillStyle = n.root ? '#0b0d11' : col;
      ctx.font = `700 ${n.root ? 13 : 9}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(KIND_GLYPH[n.kind] || '•', x, y + 0.5);
      ctx.textBaseline = 'alphabetic';
      const showLabel =
        n.root || n.id === focus || near.has(n.id) || nodes.length <= 14;
      if (showLabel) {
        const short = n.root ? n.title : String(n.title).split(' · ')[0];
        const label = short.length > 22 ? `${short.slice(0, 21)}…` : short;
        ctx.font = `${n.root ? 650 : 550} ${n.root ? 12 : 10.5}px system-ui, sans-serif`;
        ctx.fillStyle = n.root ? '#fff' : 'rgba(235,241,250,0.85)';
        ctx.fillText(label, x, y + n.r + 13);
      }
      ctx.globalAlpha = 1;
    }
  }

  function tick() {
    raf = 0;
    if (destroyed) return;
    const steps = reducedMotion() ? 60 : alpha > 0.4 ? 6 : 2;
    for (let i = 0; i < steps && alpha > 0.01; i += 1) {
      step();
      alpha *= reducedMotion() ? 0.92 : 0.985;
    }
    draw();
    if (alpha > 0.01 || dragN) raf = requestAnimationFrame(tick);
  }

  function hit(e) {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    let best = null;
    let bd = 22;
    for (const n of nodes) {
      const d = Math.hypot(sx(n) - px, sy(n) - py) - n.r;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return { n: best, px, py };
  }

  let down = null;
  canvas.addEventListener('pointerdown', (e) => {
    const { n, px, py } = hit(e);
    down = { n, px, py, moved: false };
    if (n) {
      dragN = n;
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (down?.n) {
      const r = canvas.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      if (Math.hypot(px - down.px, py - down.py) > 4) down.moved = true;
      if (down.moved) {
        down.n.x = (px - V.cx) / V.s;
        down.n.y = (py - V.cy) / V.s;
        kick(0.4);
      }
      return;
    }
    if (e.pointerType === 'mouse') {
      const { n } = hit(e);
      const id = n?.id || null;
      if (id !== hover) {
        hover = id;
        canvas.style.cursor = id ? 'pointer' : 'default';
        if (n) {
          tip.hidden = false;
          tip.textContent = `${n.kind.toUpperCase()} · ${n.title}`;
          tip.style.transform = `translate(${Math.round(sx(n))}px, ${Math.round(sy(n) - n.r - 30)}px) translateX(-50%)`;
        } else tip.hidden = true;
        draw();
      }
    }
  });
  const up = () => {
    if (!down) return;
    const d = down;
    down = null;
    dragN = null;
    if (d.n && !d.moved) {
      selected = d.n.id;
      draw();
      onSelect?.(d.n);
      if (!d.n.root) onOpen?.(d.n);
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => {
    if (hover) {
      hover = null;
      tip.hidden = true;
      draw();
    }
  });

  return {
    set,
    select(id) {
      selected = id;
      draw();
    },
    has: (id) => nodes.some((n) => n.id === id),
    get size() {
      return nodes.length;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      wrap.remove();
    },
  };
}
