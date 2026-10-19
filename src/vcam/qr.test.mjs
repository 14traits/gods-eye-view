import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encodeQr } from './qr.js';

const hash = (matrix) =>
  crypto
    .createHash('sha256')
    .update(matrix.map((row) => row.map(Number).join('')).join('\n'))
    .digest('hex');

test('pairing links encode to the matrices an independent decoder read back', () => {
  // Both hashes were checked by decoding the matrices with jsQR, which this
  // repository does not depend on; a change to the encoder must be rechecked.
  assert.equal(
    hash(encodeQr('https://192.168.1.23:4174/#9XUXQ4')),
    '9be04e45ca9b039ed9af52ce4966541f8a60dda9a0eb8555b8664d5cdac2cb05',
  );
  assert.equal(
    hash(encodeQr('https://192.168.100.200:4174/#ABCDEF')),
    '98e8a59c7040c74bdbe3df100b9844143e97ba74f0629d843fcac0178ccc6855',
  );
});

test('the symbol grows with the text and keeps its fixed patterns', () => {
  for (const [text, version] of [
    ['A', 1],
    ['https://10.0.0.5:4174/#ABCDEF', 3],
    ['x'.repeat(150), 8],
    ['z'.repeat(213), 10],
  ]) {
    const matrix = encodeQr(text);
    assert.equal(matrix.length, version * 4 + 17, text.slice(0, 12));
    const size = matrix.length;
    for (const [x, y] of [
      [0, 0],
      [size - 7, 0],
      [0, size - 7],
    ]) {
      // Finder: dark 7×7 ring, light ring, dark 3×3 core.
      assert.equal(matrix[y][x], true);
      assert.equal(matrix[y + 1][x + 1], false);
      assert.equal(matrix[y + 3][x + 3], true);
    }
    // Timing patterns alternate between the finders.
    for (let i = 8; i < size - 8; i++) {
      assert.equal(matrix[6][i], i % 2 === 0);
      assert.equal(matrix[i][6], i % 2 === 0);
    }
    assert.equal(matrix[size - 8][8], true, 'the dark module');
  }
  assert.throws(() => encodeQr('q'.repeat(214)), RangeError);
});
