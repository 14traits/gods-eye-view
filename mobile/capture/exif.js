/**
 * Tiny, dependency-free EXIF reader for JPEG: GPS position, altitude and
 * image direction, DateTimeOriginal (+ offset), orientation, make/model.
 * Returns null for anything that is not a JPEG with an Exif APP1 segment.
 */

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function readIfd(view, tiff, offset, le) {
  const out = {};
  if (offset + 2 > view.byteLength) return out;
  const n = view.getUint16(offset, le);
  for (let i = 0; i < n; i += 1) {
    const e = offset + 2 + i * 12;
    if (e + 12 > view.byteLength) break;
    const tag = view.getUint16(e, le);
    const type = view.getUint16(e + 2, le);
    const count = view.getUint32(e + 4, le);
    const size = (TYPE_SIZE[type] || 1) * count;
    const at = size > 4 ? tiff + view.getUint32(e + 8, le) : e + 8;
    if (at + size > view.byteLength) continue;
    out[tag] = readValue(view, at, type, count, le);
  }
  return out;
}

function readValue(view, at, type, count, le) {
  const one = (k) => {
    const p = at + k * (TYPE_SIZE[type] || 1);
    switch (type) {
      case 1:
      case 7:
        return view.getUint8(p);
      case 3:
        return view.getUint16(p, le);
      case 4:
        return view.getUint32(p, le);
      case 9:
        return view.getInt32(p, le);
      case 5: {
        const d = view.getUint32(p + 4, le);
        return d ? view.getUint32(p, le) / d : 0;
      }
      case 10: {
        const d = view.getInt32(p + 4, le);
        return d ? view.getInt32(p, le) / d : 0;
      }
      default:
        return null;
    }
  };
  if (type === 2) {
    let s = '';
    for (let k = 0; k < count; k += 1) {
      const c = view.getUint8(at + k);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s.trim();
  }
  if (count === 1) return one(0);
  return Array.from({ length: count }, (_, k) => one(k));
}

const dms = (v) =>
  Array.isArray(v) ? v[0] + (v[1] || 0) / 60 + (v[2] || 0) / 3600 : Number(v);

/** "2026:10:18 20:53:37" (+ "-05:00") → ms epoch; local time if no offset. */
function exifDate(s, offset) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s || '');
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : ''}`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * @param {Blob|ArrayBuffer} input
 * @returns {Promise<null | { lat?, lon?, altM?, headingDeg?, takenAt?, takenAtHasZone?, orientation?, make?, model?, raw }>}
 */
export async function readExif(input) {
  const buf =
    input instanceof Blob
      ? await input.slice(0, 256 * 1024).arrayBuffer()
      : input;
  const view = new DataView(buf);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
  let p = 2;
  while (p + 4 <= view.byteLength) {
    if (view.getUint8(p) !== 0xff) return null;
    const marker = view.getUint8(p + 1);
    const len = view.getUint16(p + 2);
    if (marker === 0xda || marker === 0xd9) return null; // start of scan: no EXIF before it
    if (
      marker === 0xe1 &&
      p + 10 <= view.byteLength &&
      view.getUint32(p + 4) === 0x45786966
    ) {
      const tiff = p + 10;
      const le = view.getUint16(tiff) === 0x4949;
      if (view.getUint16(tiff + 2, le) !== 42) return null;
      const ifd0 = readIfd(view, tiff, tiff + view.getUint32(tiff + 4, le), le);
      const exif = ifd0[0x8769]
        ? readIfd(view, tiff, tiff + ifd0[0x8769], le)
        : {};
      const gps = ifd0[0x8825]
        ? readIfd(view, tiff, tiff + ifd0[0x8825], le)
        : {};
      const out = { raw: { ifd0, exif, gps } };
      if (gps[2] != null && gps[4] != null) {
        let lat = dms(gps[2]);
        let lon = dms(gps[4]);
        if (String(gps[1]).toUpperCase() === 'S') lat = -lat;
        if (String(gps[3]).toUpperCase() === 'W') lon = -lon;
        if (
          Number.isFinite(lat) &&
          Number.isFinite(lon) &&
          Math.abs(lat) <= 90 &&
          Math.abs(lon) <= 180 &&
          (lat || lon)
        ) {
          out.lat = lat;
          out.lon = lon;
        }
      }
      if (gps[6] != null) out.altM = (gps[5] === 1 ? -1 : 1) * Number(gps[6]);
      if (gps[0x11] != null) out.headingDeg = Number(gps[0x11]);
      const offset = exif[0x9011] || exif[0x9010];
      const taken = exifDate(
        exif[0x9003] || exif[0x9004] || ifd0[0x0132],
        offset,
      );
      if (taken) {
        out.takenAt = taken;
        out.takenAtHasZone = !!offset;
      }
      if (ifd0[0x0112]) out.orientation = ifd0[0x0112];
      if (ifd0[0x010f]) out.make = ifd0[0x010f];
      if (ifd0[0x0110]) out.model = ifd0[0x0110];
      return out;
    }
    p += 2 + len;
  }
  return null;
}
