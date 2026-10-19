/**
 * Minimal QR Code encoder for the phone pairing link: byte mode, error
 * correction level M, versions 1–10 (up to 213 bytes). It follows ISO/IEC
 * 18004 directly, so pairing needs no network service or dependency.
 */

// Level M, indexed by version - 1.
const ECC_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const MAX_VERSION = 10;
// Format information encodes level M as 0b00.
const FORMAT_LEVEL_M = 0;

function rawDataModules(version) {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    modules -= (25 * align - 10) * align - 55;
    if (version >= 7) modules -= 36;
  }
  return modules;
}

const dataCodewords = (version) =>
  Math.floor(rawDataModules(version) / 8) -
  ECC_PER_BLOCK[version - 1] * BLOCKS[version - 1];

function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    divisor.forEach((coefficient, i) => {
      result[i] ^= gfMultiply(coefficient, factor);
    });
  }
  return result;
}

function alignmentPositions(version, size) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let position = size - 7; result.length < count; position -= step)
    result.splice(1, 0, position);
  return result;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function codewordsFor(bytes, version) {
  const capacity = dataCodewords(version);
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  push(0, Math.min(4, capacity * 8 - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8)
    data.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit));
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11)
    data.push(pad);

  const blocks = BLOCKS[version - 1];
  const eccLength = ECC_PER_BLOCK[version - 1];
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLength);
  const filled = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const block = data.slice(
      k,
      k + shortLength - eccLength + (i < shortBlocks ? 0 : 1),
    );
    k += block.length;
    const ecc = rsRemainder(block, divisor);
    if (i < shortBlocks) block.push(0);
    filled.push(block.concat(ecc));
  }
  const result = [];
  for (let i = 0; i < filled[0].length; i++)
    filled.forEach((block, j) => {
      if (i !== shortLength - eccLength || j >= shortBlocks)
        result.push(block[i]);
    });
  return result;
}

function penalty(modules) {
  const size = modules.length;
  let score = 0;
  const lines = [];
  for (let y = 0; y < size; y++) lines.push(modules[y]);
  for (let x = 0; x < size; x++) lines.push(modules.map((row) => row[x]));
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    const text = line.map(Number).join('');
    for (const pattern of ['00001011101', '10111010000'])
      for (
        let at = text.indexOf(pattern);
        at >= 0;
        at = text.indexOf(pattern, at + 1)
      )
        score += 40;
  }
  let dark = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) dark++;
      if (
        x < size - 1 &&
        y < size - 1 &&
        modules[y][x] === modules[y][x + 1] &&
        modules[y][x] === modules[y + 1][x] &&
        modules[y][x] === modules[y + 1][x + 1]
      )
        score += 3;
    }
  const total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

/**
 * Encode text as a QR Code.
 * @param {string} text
 * @returns {boolean[][]} Square module matrix, `true` for dark, row-major.
 */
export function encodeQr(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 1;
  // Byte mode costs 4 + 8 (or 16) bits of header.
  while (
    version <= MAX_VERSION &&
    4 + (version < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(version) * 8
  )
    version++;
  if (version > MAX_VERSION)
    throw new RangeError('Text is too long for a QR code');

  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () =>
    new Array(size).fill(false),
  );
  const reserved = Array.from({ length: size }, () =>
    new Array(size).fill(false),
  );
  const set = (x, y, dark) => {
    modules[y][x] = dark;
    reserved[y][x] = true;
  };

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, distance !== 2 && distance !== 4);
      }
  const align = alignmentPositions(version, size);
  for (let i = 0; i < align.length; i++)
    for (let j = 0; j < align.length; j++) {
      const corner =
        (i === 0 && j === 0) ||
        (i === 0 && j === align.length - 1) ||
        (i === align.length - 1 && j === 0);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          set(
            align[i] + dx,
            align[j] + dy,
            Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
          );
    }
  const drawFormat = (mask) => {
    const data = (FORMAT_LEVEL_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }

  const codewords = codewordsFor(bytes, version);
  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (reserved[y][x] || bit >= codewords.length * 8) continue;
        modules[y][x] = ((codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1) !== 0;
        bit++;
      }
  }

  let best = null;
  for (let mask = 0; mask < MASKS.length; mask++) {
    const candidate = modules.map((row, y) =>
      row.map((dark, x) =>
        reserved[y][x] ? dark : dark !== MASKS[mask](x, y),
      ),
    );
    // Format bits depend on the mask; draw them into the candidate.
    const saved = modules.map((row) => [...row]);
    for (let y = 0; y < size; y++) modules[y] = candidate[y];
    drawFormat(mask);
    const score = penalty(modules);
    if (!best || score < best.score)
      best = { score, matrix: modules.map((row) => [...row]) };
    for (let y = 0; y < size; y++) modules[y] = saved[y];
  }
  return best.matrix;
}

/**
 * Draw a QR matrix into a canvas with the standard four-module quiet zone.
 * @param {HTMLCanvasElement} canvas
 * @param {boolean[][]} matrix
 * @param {number} [pixels] - Target edge length in CSS pixels.
 */
export function drawQr(canvas, matrix, pixels = 168) {
  const quiet = 4;
  const count = matrix.length + quiet * 2;
  const scale = Math.max(
    1,
    Math.floor((pixels * (window.devicePixelRatio || 1)) / count),
  );
  canvas.width = canvas.height = count * scale;
  canvas.style.width =
    canvas.style.height = `${(count * scale) / (window.devicePixelRatio || 1)}px`;
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000';
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark)
        context.fillRect(
          (x + quiet) * scale,
          (y + quiet) * scale,
          scale,
          scale,
        );
    }),
  );
}
