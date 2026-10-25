#!/usr/bin/env python3
"""Procedural GLB models for the RPO replay.

ICEYE-X36: ICEYE Gen-3 class SAR microsatellite. Dimensions follow ICEYE's
fleet documentation (3.2 m x 0.4 m phased-array antenna, ~3.25 m span,
two deployable solar arrays, ~0.7 x 0.5 m bus).

Cosmos 2612: no public imagery of the design exists. The model is an
illustrative small military bus (box body, two three-panel wings, a forward
optical sensor and a rear propulsion module) sized like its launch cohort.

Axes (glTF, Y-up): +X along-track (velocity), +Y zenith, +Z = -orbit normal.
"""

import io
import json
import math
import struct

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = __file__.rsplit('/', 1)[0]
RNG = np.random.default_rng(7)


# ---------------------------------------------------------------------------
# Textures
# ---------------------------------------------------------------------------

def png_bytes(img):
    b = io.BytesIO()
    img.save(b, 'PNG', optimize=True)
    return b.getvalue()


def solar_texture(cols=8, rows=6, size=(512, 384)):
    w, h = size
    img = Image.new('RGB', size, (18, 22, 40))
    d = ImageDraw.Draw(img)
    cw, ch = w / cols, h / rows
    for i in range(cols):
        for j in range(rows):
            x0, y0 = i * cw + 3, j * ch + 3
            x1, y1 = (i + 1) * cw - 3, (j + 1) * ch - 3
            shade = int(RNG.integers(-6, 6))
            d.rectangle([x0, y0, x1, y1], fill=(28 + shade, 40 + shade, 92 + shade))
            # clipped corners like triple-junction cells
            c = 6
            for cx, cy in [(x0, y0), (x1, y0), (x0, y1), (x1, y1)]:
                d.polygon([(cx, cy), (cx + (c if cx == x0 else -c), cy), (cx, cy + (c if cy == y0 else -c))],
                          fill=(18, 22, 40))
            for k in range(1, 6):
                yy = y0 + (y1 - y0) * k / 6
                d.line([x0 + 2, yy, x1 - 2, yy], fill=(70, 82, 130), width=1)
            d.line([x0, (y0 + y1) / 2, x1, (y0 + y1) / 2], fill=(150, 155, 170), width=2)
    return img


def mli_texture(base, size=256):
    n = RNG.normal(0, 1, (size // 8, size // 8))
    n = np.kron(n, np.ones((8, 8)))
    img = Image.fromarray(np.uint8(np.clip(128 + n * 30, 0, 255))).filter(ImageFilter.GaussianBlur(3))
    a = np.asarray(img, dtype=float) / 255
    rgb = np.stack([np.clip(base[c] * (0.78 + 0.45 * a), 0, 255) for c in range(3)], -1)
    # seams / tape
    out = Image.fromarray(np.uint8(rgb))
    d = ImageDraw.Draw(out)
    for x in (0, size // 2):
        d.line([x, 0, x, size], fill=tuple(int(c * 0.65) for c in base), width=2)
    return out


def mli_normal(size=256):
    n = RNG.normal(0, 1, (size // 6 + 1, size // 6 + 1))
    n = np.kron(n, np.ones((6, 6)))[:size, :size]
    h = np.asarray(Image.fromarray(np.uint8(np.clip(128 + n * 40, 0, 255))).filter(ImageFilter.GaussianBlur(2)),
                   dtype=float) / 255
    gx = np.roll(h, -1, 1) - np.roll(h, 1, 1)
    gy = np.roll(h, -1, 0) - np.roll(h, 1, 0)
    s = 3.0
    nx, ny, nz = -gx * s, -gy * s, np.ones_like(h)
    l = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    rgb = np.stack([(nx / l + 1) / 2, (ny / l + 1) / 2, (nz / l + 1) / 2], -1)
    return Image.fromarray(np.uint8(rgb * 255))


def sar_texture(size=(1024, 128)):
    w, h = size
    img = Image.new('RGB', size, (34, 36, 40))
    d = ImageDraw.Draw(img)
    nx, ny = 64, 8
    for i in range(nx):
        for j in range(ny):
            cx, cy = (i + 0.5) * w / nx, (j + 0.5) * h / ny
            r = 4.5
            d.rectangle([cx - r, cy - r, cx + r, cy + r], fill=(150, 112, 70))
            d.rectangle([cx - r + 2, cy - r + 2, cx + r - 2, cy + r - 2], fill=(118, 88, 56))
    for k in range(1, 5):
        x = w * k / 5
        d.line([x, 0, x, h], fill=(10, 10, 12), width=3)
    return img


def panel_texture(color, size=128, lines=4):
    img = Image.new('RGB', (size, size), color)
    d = ImageDraw.Draw(img)
    for k in range(1, lines):
        p = size * k / lines
        d.line([p, 0, p, size], fill=tuple(int(c * 0.8) for c in color), width=1)
    return img


# ---------------------------------------------------------------------------
# Minimal glTF builder
# ---------------------------------------------------------------------------

class Gltf:
    def __init__(self):
        self.bin = bytearray()
        self.j = dict(asset=dict(version='2.0', generator='gods-eye-view rpo-replay'),
                      scenes=[dict(nodes=[0])], scene=0, nodes=[dict(name='root', children=[])],
                      meshes=[], materials=[], accessors=[], bufferViews=[], buffers=[],
                      images=[], textures=[], samplers=[dict(magFilter=9729, minFilter=9987, wrapS=10497, wrapT=10497)])
        self.prims = []

    def _view(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        off = len(self.bin)
        self.bin += data
        v = dict(buffer=0, byteOffset=off, byteLength=len(data))
        if target:
            v['target'] = target
        self.j['bufferViews'].append(v)
        return len(self.j['bufferViews']) - 1

    def _acc(self, arr, typ, target):
        arr = np.ascontiguousarray(arr)
        comp = 5126 if arr.dtype == np.float32 else 5125
        view = self._view(arr.tobytes(), target)
        a = dict(bufferView=view, componentType=comp, count=int(arr.shape[0]), type=typ)
        if typ == 'VEC3' and comp == 5126:
            a['min'] = arr.min(0).tolist()
            a['max'] = arr.max(0).tolist()
        self.j['accessors'].append(a)
        return len(self.j['accessors']) - 1

    def texture(self, img):
        view = self._view(png_bytes(img))
        self.j['images'].append(dict(bufferView=view, mimeType='image/png'))
        self.j['textures'].append(dict(sampler=0, source=len(self.j['images']) - 1))
        return len(self.j['textures']) - 1

    def material(self, name, color=(1, 1, 1), metal=0.0, rough=0.6, tex=None, normal=None, emissive=None,
                 double=False):
        m = dict(name=name, pbrMetallicRoughness=dict(baseColorFactor=[*color, 1.0], metallicFactor=metal,
                                                       roughnessFactor=rough))
        if tex is not None:
            m['pbrMetallicRoughness']['baseColorTexture'] = dict(index=tex)
        if normal is not None:
            m['normalTexture'] = dict(index=normal, scale=0.6)
        if emissive:
            m['emissiveFactor'] = list(emissive)
        if double:
            m['doubleSided'] = True
        self.j['materials'].append(m)
        return len(self.j['materials']) - 1

    def add(self, name, pos, nrm, uv, idx, mat, translation=(0, 0, 0), rotation=None):
        p = dict(attributes=dict(POSITION=self._acc(np.float32(pos), 'VEC3', 34962),
                                 NORMAL=self._acc(np.float32(nrm), 'VEC3', 34962),
                                 TEXCOORD_0=self._acc(np.float32(uv), 'VEC2', 34962)),
                 indices=self._acc(np.uint32(idx).ravel(), 'SCALAR', 34963), material=mat)
        self.j['meshes'].append(dict(name=name, primitives=[p]))
        node = dict(name=name, mesh=len(self.j['meshes']) - 1, translation=list(map(float, translation)))
        if rotation is not None:
            node['rotation'] = list(map(float, rotation))
        self.j['nodes'].append(node)
        self.j['nodes'][0]['children'].append(len(self.j['nodes']) - 1)

    def save(self, path):
        while len(self.bin) % 4:
            self.bin.append(0)
        self.j['buffers'] = [dict(byteLength=len(self.bin))]
        js = json.dumps(self.j, separators=(',', ':')).encode()
        while len(js) % 4:
            js += b' '
        out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(self.bin))
        out += struct.pack('<II', len(js), 0x4E4F534A) + js
        out += struct.pack('<II', len(self.bin), 0x004E4942) + bytes(self.bin)
        open(path, 'wb').write(out)
        print(path, f'{len(out)/1024:.0f} KB')


def box(sx, sy, sz, uv_scale=(1, 1)):
    """Axis-aligned box centred at origin with per-face UVs."""
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    faces = [
        ((1, 0, 0), [(hx, -hy, hz), (hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz)]),
        ((-1, 0, 0), [(-hx, -hy, -hz), (-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz)]),
        ((0, 1, 0), [(-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz), (-hx, hy, -hz)]),
        ((0, -1, 0), [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz), (-hx, -hy, hz)]),
        ((0, 0, 1), [(-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]),
        ((0, 0, -1), [(hx, -hy, -hz), (-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz)]),
    ]
    P, N, U, I = [], [], [], []
    for n, quad in faces:
        b = len(P)
        P += quad
        N += [n] * 4
        U += [(0, uv_scale[1]), (uv_scale[0], uv_scale[1]), (uv_scale[0], 0), (0, 0)]
        I += [(b, b + 1, b + 2), (b, b + 2, b + 3)]
    return P, N, U, I


def cylinder(r0, r1, length, seg=32, axis='x', caps=True):
    P, N, U, I = [], [], [], []
    for k in range(seg + 1):
        a = 2 * math.pi * k / seg
        c, s = math.cos(a), math.sin(a)
        slope = (r0 - r1) / length
        nl = math.sqrt(1 + slope ** 2)
        P += [(0, r0 * c, r0 * s), (length, r1 * c, r1 * s)]
        N += [(slope / nl, c / nl, s / nl)] * 2
        U += [(k / seg, 0), (k / seg, 1)]
    for k in range(seg):
        a, b = 2 * k, 2 * k + 2
        I += [(a, b, a + 1), (a + 1, b, b + 1)]
    if caps:
        for x, r, nx in ((0, r0, -1), (length, r1, 1)):
            if r <= 0:
                continue
            c0 = len(P)
            P.append((x, 0, 0)); N.append((nx, 0, 0)); U.append((0.5, 0.5))
            for k in range(seg + 1):
                a = 2 * math.pi * k / seg
                P.append((x, r * math.cos(a), r * math.sin(a))); N.append((nx, 0, 0))
                U.append((0.5 + 0.5 * math.cos(a), 0.5 + 0.5 * math.sin(a)))
            for k in range(seg):
                tri = (c0, c0 + 1 + k, c0 + 2 + k)
                I.append(tri if nx > 0 else tri[::-1])
    P = np.array(P, float)
    N = np.array(N, float)
    if axis == 'y':
        P, N = P[:, [1, 0, 2]] * [1, 1, 1], N[:, [1, 0, 2]]
        I = [t[::-1] for t in I]
    elif axis == 'z':
        P, N = P[:, [1, 2, 0]], N[:, [1, 2, 0]]
    return P.tolist(), N.tolist(), U, I


def dish(r, depth, seg=32, rings=6):
    """Paraboloid dish opening toward +X."""
    P, N, U, I = [], [], [], []
    for i in range(rings + 1):
        rr = r * i / rings
        x = depth * (rr / r) ** 2
        for k in range(seg + 1):
            a = 2 * math.pi * k / seg
            P.append((x, rr * math.cos(a), rr * math.sin(a)))
            n = np.array([-1.0, 2 * depth * rr / r ** 2 * math.cos(a), 2 * depth * rr / r ** 2 * math.sin(a)])
            n = -n / np.linalg.norm(n)
            N.append(tuple(n))
            U.append((k / seg, i / rings))
    for i in range(rings):
        for k in range(seg):
            a = i * (seg + 1) + k
            b = a + seg + 1
            I += [(a, a + 1, b), (a + 1, b + 1, b)]
    return P, N, U, I


def quat(axis, deg):
    axis = np.array(axis, float) / np.linalg.norm(axis)
    h = math.radians(deg) / 2
    return [*(axis * math.sin(h)), math.cos(h)]


# ---------------------------------------------------------------------------
# ICEYE-X36
# ---------------------------------------------------------------------------

def build_iceye():
    g = Gltf()
    t_sar = g.texture(sar_texture())
    t_sol = g.texture(solar_texture(cols=6, rows=4, size=(384, 256)))
    t_gold = g.texture(mli_texture((214, 168, 72)))
    t_n = g.texture(mli_normal())
    t_rad = g.texture(panel_texture((226, 228, 232)))

    m_sar = g.material('sar-face', tex=t_sar, metal=0.55, rough=0.42)
    m_back = g.material('antenna-back', color=(0.82, 0.83, 0.86), metal=0.2, rough=0.55, tex=t_rad)
    m_gold = g.material('mli-gold', tex=t_gold, normal=t_n, metal=0.85, rough=0.32)
    m_sol = g.material('solar', tex=t_sol, metal=0.4, rough=0.25)
    m_frame = g.material('frame', color=(0.55, 0.56, 0.6), metal=0.9, rough=0.35)
    m_black = g.material('black', color=(0.05, 0.05, 0.06), metal=0.1, rough=0.6)
    m_white = g.material('white', color=(0.9, 0.9, 0.92), metal=0.0, rough=0.5)

    # SAR antenna: five hinged segments, 3.25 m along-track x 0.40 m, face tilted
    # 25 deg off nadir toward -Z (right-looking).
    seg_len, gap = 0.638, 0.015
    tilt = quat((1, 0, 0), -25)
    for k in range(5):
        x = (k - 2) * (seg_len + gap)
        P, N, U, I = box(seg_len, 0.035, 0.40)
        # face (-Y) UVs map into 1/5 of the antenna texture
        U = [(u * 0.2 + 0.2 * k, v) for (u, v) in U]
        P = np.array(P) + [x, 0, 0]
        g.add(f'sar-seg-{k}', P, N, U, I, m_sar if True else m_back, rotation=tilt)
        Pb, Nb, Ub, Ib = box(seg_len - 0.04, 0.012, 0.36)
        g.add(f'sar-back-{k}', np.array(Pb) + [x, 0.022, 0], Nb, Ub, Ib, m_back, rotation=tilt)
    # Bus behind the antenna
    P, N, U, I = box(0.62, 0.42, 0.46)
    g.add('bus', P, N, U, I, m_gold, translation=(0, 0.25, 0.06))
    P, N, U, I = box(0.6, 0.02, 0.44)
    g.add('bus-top-radiator', P, N, U, I, m_white, translation=(0, 0.47, 0.06))
    # Solar wings off the bus, canted toward the sun-side
    for side in (1, -1):
        P, N, U, I = box(0.58, 0.02, 0.78)
        g.add(f'solar-{side}', P, N, U, I, m_sol, translation=(0, 0.42, 0.06 + side * 0.66),
              rotation=quat((1, 0, 0), side * 14))
        P, N, U, I = cylinder(0.012, 0.012, 0.16, seg=8, axis='z')
        g.add(f'hinge-{side}', P, N, U, I, m_frame, translation=(0, 0.42, 0.06 + side * 0.20 - (0.16 if side < 0 else 0)))
    # Star trackers, X-band downlink horn, GNSS patch
    for k, z in enumerate((-0.12, 0.12)):
        P, N, U, I = cylinder(0.035, 0.05, 0.08, seg=16, axis='y')
        g.add(f'star-tracker-{k}', P, N, U, I, m_black, translation=(-0.2, 0.48, 0.06 + z))
    P, N, U, I = cylinder(0.05, 0.02, 0.09, seg=16, axis='y')
    g.add('x-band', P, N, U, I, m_frame, translation=(0.2, 0.04, 0.2), rotation=quat((1, 0, 0), 180))
    P, N, U, I = box(0.08, 0.012, 0.08)
    g.add('gnss', P, N, U, I, m_white, translation=(0.18, 0.485, 0.06))
    g.save(f'{HERE}/iceye-x36.glb')


# ---------------------------------------------------------------------------
# Cosmos 2612 (illustrative)
# ---------------------------------------------------------------------------

def build_cosmos():
    g = Gltf()
    t_sol = g.texture(solar_texture(cols=8, rows=6))
    t_mli = g.texture(mli_texture((178, 182, 186)))
    t_dark = g.texture(mli_texture((64, 62, 58)))
    t_n = g.texture(mli_normal())
    t_rad = g.texture(panel_texture((210, 212, 205)))

    m_mli = g.material('mli-silver', tex=t_mli, normal=t_n, metal=0.9, rough=0.28)
    m_dark = g.material('mli-dark', tex=t_dark, normal=t_n, metal=0.6, rough=0.4)
    m_sol = g.material('solar', tex=t_sol, metal=0.4, rough=0.25)
    m_rad = g.material('radiator', tex=t_rad, metal=0.0, rough=0.55)
    m_frame = g.material('frame', color=(0.6, 0.6, 0.62), metal=0.9, rough=0.3)
    m_black = g.material('black', color=(0.03, 0.03, 0.035), metal=0.2, rough=0.4)
    m_lens = g.material('lens', color=(0.05, 0.08, 0.12), metal=1.0, rough=0.05, emissive=(0.02, 0.05, 0.08))
    m_nozzle = g.material('nozzle', color=(0.35, 0.3, 0.28), metal=0.95, rough=0.4)

    P, N, U, I = box(0.95, 0.72, 0.72)
    g.add('bus', P, N, U, I, m_mli)
    P, N, U, I = box(0.5, 0.74, 0.74)
    g.add('bus-band', P, N, U, I, m_dark, translation=(-0.12, 0, 0))
    P, N, U, I = box(0.8, 0.02, 0.6)
    g.add('radiator-top', P, N, U, I, m_rad, translation=(0.02, 0.375, 0))
    # Three-panel wings along +/-Z
    for side in (1, -1):
        P, N, U, I = cylinder(0.018, 0.018, 0.32, seg=10, axis='z')
        g.add(f'yoke-{side}', P, N, U, I, m_frame, translation=(0, 0, side * 0.36 - (0.32 if side < 0 else 0)))
        for k in range(3):
            P, N, U, I = box(0.62, 0.02, 0.5)
            z = side * (0.36 + 0.32 + 0.26 + k * 0.52)
            g.add(f'wing-{side}-{k}', P, N, U, I, m_sol, translation=(0, 0, z), rotation=quat((0, 0, 1), 10))
    # Forward optical sensor (faces +X: toward a target ahead along-track)
    P, N, U, I = cylinder(0.13, 0.13, 0.24, seg=32, axis='x')
    g.add('sensor-barrel', P, N, U, I, m_black, translation=(0.475, 0.12, 0.0))
    P, N, U, I = cylinder(0.145, 0.16, 0.06, seg=32, axis='x', caps=False)
    g.add('sensor-hood', P, N, U, I, m_frame, translation=(0.70, 0.12, 0.0))
    P, N, U, I = cylinder(0.1, 0.1, 0.01, seg=32, axis='x')
    g.add('sensor-lens', P, N, U, I, m_lens, translation=(0.715, 0.12, 0.0))
    # Proximity radar / laser rangefinder block
    P, N, U, I = box(0.12, 0.12, 0.16)
    g.add('ranging', P, N, U, I, m_dark, translation=(0.53, -0.18, 0.18))
    # Rear propulsion
    P, N, U, I = cylinder(0.16, 0.16, 0.12, seg=24, axis='x')
    g.add('prop-module', P, N, U, I, m_dark, translation=(-0.595, 0, 0))
    P, N, U, I = cylinder(0.035, 0.09, 0.16, seg=24, axis='x', caps=False)
    g.add('nozzle', P, N, U, I, m_nozzle, translation=(-0.76, 0, 0), rotation=quat((0, 0, 1), 180))
    for k, (y, z) in enumerate(((0.3, 0.3), (0.3, -0.3), (-0.3, 0.3), (-0.3, -0.3))):
        P, N, U, I = cylinder(0.012, 0.025, 0.05, seg=10, axis='x', caps=False)
        g.add(f'rcs-{k}', P, N, U, I, m_nozzle, translation=(-0.48, y, z), rotation=quat((0, 0, 1), 180))
    # S-band dish on a short mast (zenith)
    P, N, U, I = cylinder(0.012, 0.012, 0.22, seg=8, axis='y')
    g.add('mast', P, N, U, I, m_frame, translation=(-0.25, 0.37, 0.18))
    P, N, U, I = dish(0.14, 0.05)
    g.add('dish', P, N, U, I, m_rad, translation=(-0.25, 0.6, 0.18), rotation=quat((0, 0, 1), 90))
    g.save(f'{HERE}/cosmos-2612.glb')


if __name__ == '__main__':
    build_iceye()
    build_cosmos()
