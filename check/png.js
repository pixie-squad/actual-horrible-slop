/*
  PNGs in Node with nothing to install (zlib only): enough for the screenshots the
  DevTools protocol takes, and for writing pictures of what changed between two.

    const img = PNG.decode(buffer)               → { width, height, data }  (RGBA, 8 bits)
    const buf = PNG.encode(img)                   a PNG of an RGBA image
    PNG.crop(img, x, y, width, height)            → img
    const d = PNG.diff(a, b, { threshold: 8 })    → { changed, max, box, image }

  decode reads 8-bit greyscale, grey + alpha, RGB and RGBA, not interlaced: what
  Chromium writes. diff counts the pixels where any channel differs by more than
  `threshold`; `box` is the smallest rectangle holding all of them (null when none),
  and `image` shows them in magenta over a faded copy of b.
*/
'use strict';

const zlib = require('zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

function decode(buf) {
  if (!SIGNATURE.equals(buf.subarray(0, 8))) throw new Error('not a PNG');
  let at = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (at + 8 <= buf.length) {
    const len = buf.readUInt32BE(at);
    const kind = buf.toString('ascii', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      interlace = data[12];
    } else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    at += 12 + len;
  }
  const bpp = CHANNELS[type];
  if (depth !== 8 || !bpp || interlace) throw new Error(`unsupported PNG: depth ${depth}, colour type ${type}, interlace ${interlace}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const from = y * (stride + 1);
    const filter = raw[from];
    const cur = Buffer.from(raw.subarray(from + 1, from + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? cur[i - bpp] : 0;
      const up = prev[i];
      const corner = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      cur[i] = (cur[i] + add) & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, s = x * bpp;
      if (bpp >= 3) {
        out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2];
        out[o + 3] = bpp === 4 ? cur[s + 3] : 255;
      } else {
        out[o] = out[o + 1] = out[o + 2] = cur[s];
        out[o + 3] = bpp === 2 ? cur[s + 1] : 255;
      }
    }
    prev = cur;
  }
  return { width, height, data: out };
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(kind, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(kind, 'ascii'), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, sum]);
}

function encode({ width, height, data }) {
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8; head[9] = 6; head[10] = 0; head[11] = 0; head[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([SIGNATURE, chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function crop(img, x, y, width, height) {
  x = Math.max(0, Math.round(x));
  y = Math.max(0, Math.round(y));
  width = Math.max(0, Math.min(Math.round(width), img.width - x));
  height = Math.max(0, Math.min(Math.round(height), img.height - y));
  const data = Buffer.alloc(width * height * 4);
  for (let r = 0; r < height; r++) img.data.copy(data, r * width * 4, ((y + r) * img.width + x) * 4, ((y + r) * img.width + x + width) * 4);
  return { width, height, data };
}

// Two pictures of the same place. Where they are not the same size, what one has and the
// other does not counts as changed.
function diff(a, b, { threshold = 8 } = {}) {
  const width = Math.max(a.width, b.width), height = Math.max(a.height, b.height);
  const image = { width, height, data: Buffer.alloc(width * height * 4) };
  let changed = 0, max = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const inA = x < a.width && y < a.height, inB = x < b.width && y < b.height;
      let d = 255;
      if (inA && inB) {
        const pa = (y * a.width + x) * 4, pb = (y * b.width + x) * 4;
        d = Math.max(
          Math.abs(a.data[pa] - b.data[pb]), Math.abs(a.data[pa + 1] - b.data[pb + 1]),
          Math.abs(a.data[pa + 2] - b.data[pb + 2]), Math.abs(a.data[pa + 3] - b.data[pb + 3]));
      }
      if (d > max) max = d;
      if (d > threshold) {
        changed++;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
        image.data[o] = 255; image.data[o + 1] = 0; image.data[o + 2] = 255; image.data[o + 3] = 255;
      } else {
        const src = inB ? b : a, p = (y * src.width + x) * 4;
        const grey = 0.299 * src.data[p] + 0.587 * src.data[p + 1] + 0.114 * src.data[p + 2];
        const v = Math.round(255 - (255 - grey) * 0.3);
        image.data[o] = image.data[o + 1] = image.data[o + 2] = v;
        image.data[o + 3] = 255;
      }
    }
  }
  const box = changed ? { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 } : null;
  return { changed, max, box, total: width * height, image };
}

module.exports = { decode, encode, crop, diff, crc32 };
