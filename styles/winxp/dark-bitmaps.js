#!/usr/bin/env node
/*
  Luna's bitmaps for the dark theme (icons/<name>-dark.png), made from the light ones:

    node styles/winxp/dark-bitmaps.js

  Each is the same tracing, pixel for pixel, with its colours given again for a dark
  face: a white rim is a dim one, a pale face a dark one, a dark mark a pale one, and
  the green of a mark is lighter. The hue is left as it is (Luna's blue), so the filter
  that turns the light ones for the accent turns these too.
  The page never runs this; the files it writes are kept beside the originals.
*/
'use strict';

const fs = require('fs');
const path = require('path');
const PNG = require('../../check/png.js');

const DIR = path.join(__dirname, 'icons');

/* ---------- Colour: sRGB bytes to OKLCH and back ---------- */

const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const gam = (v) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)));
function toLch(r, g, b) {
  r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}
function toRgb(L, C, h) {
  const A = C * Math.cos(h), B = C * Math.sin(h);
  const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
  const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
  const s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
  return [
    gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
const BLUE = toLch(0x00, 0x54, 0xe3)[2];   // Luna's own hue
const deg = (h) => ((h * 180) / Math.PI + 360) % 360;
const mix = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));
// Through the points [[in, out], …], straight between them, flat beyond.
const curve = (points) => (v) => {
  if (v <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    if (v <= x1) return y0 + ((v - x0) / (x1 - x0)) * (y1 - y0);
  }
  return points[points.length - 1][1];
};

// f(L, C, h, x, y, img) → [L, C, h] or [L, C, h, alpha], or nothing for a pixel that is to be
// left out; x and y are in the units the tracing was drawn in.
function remake(name, unit, f) {
  const img = PNG.decode(fs.readFileSync(path.join(DIR, name + '.png')));
  const out = { width: img.width, height: img.height, data: Buffer.from(img.data) };
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const at = (y * img.width + x) * 4;
      if (!img.data[at + 3]) continue;
      const [L, C, h] = toLch(img.data[at], img.data[at + 1], img.data[at + 2]);
      const to = f(L, C, h, Math.floor(x / unit), Math.floor(y / unit), img);
      if (!to) { out.data[at + 3] = 0; continue; }   // left out: nothing is drawn there
      const [r, g, b] = toRgb(...to);
      out.data[at] = r; out.data[at + 1] = g; out.data[at + 2] = b;
      if (to.length > 3) out.data[at + 3] = Math.round(255 * to[3]);
    }
  }
  fs.writeFileSync(path.join(DIR, name + '-dark.png'), PNG.encode(out));
  console.log(name + '-dark.png');
}

/* ---------- The caption buttons: 21 units, a white rim, a glossy face, a white mark ---------- */

// The blue ones: the face is lowered to a dim blue a little lighter than the dark title
// bar, the rim to a blue-grey, the mark stays near white.
const capBlue = (L, C, h, x, y, img) => {
  const n = img.width / 3 - 1;
  const rim = x === 0 || y === 0 || x === n || y === n;
  const face = Math.min(1, C / 0.1);            // 0: white, 1: the blue of the face
  const k = mix(rim ? 0.6 : 0.96, 0.66, face);
  return [L * k, rim ? mix(0.035, C * 0.5, face) : C * 0.5, rim && face < 1 ? mix(BLUE, h, face) : h];
};
// Close: red as ever, a little deeper, in the same dim rim.
const capRed = (L, C, h, x, y, img) => {
  const n = img.width / 3 - 1;
  const rim = x === 0 || y === 0 || x === n || y === n;
  const face = Math.min(1, C / 0.1);
  return [L * mix(rim ? 0.6 : 0.96, 0.84, face), rim && face < 1 ? mix(0.035, C, face) : C * 0.94, rim && face < 1 ? mix(BLUE, h, face) : h];
};
for (const s of ['', '-hover', '-active']) {
  for (const b of ['min', 'max', 'restore']) remake('cap-' + b + s, 3, capBlue);
  remake('cap-close' + s, 3, capRed);
}

/* ---------- The scroll bar's arrows ----------
   Dark, the button under an arrow is drawn by the stylesheet from its tokens (a filter
   does not reach a scroll bar's own parts, so a bitmap of it could not follow the
   accent). What is kept of the bitmap is the arrow alone, pale, on nothing; the
   drop-down button uses the one that points down. */

const ARROW = toLch(0x4d, 0x61, 0x85);
for (const d of ['up', 'down', 'left', 'right']) {
  remake('sb-' + d, 3, (L, C) => (Math.abs(L - ARROW[0]) < 0.01 && Math.abs(C - ARROW[1]) < 0.01 ? [0.92, 0.012, BLUE] : null));
}

// The thumb's grip: a light line and a dark one, four times. Dark, a ridge that catches the
// light and the groove under it, as white and black laid thinly over the thumb, whatever
// colour the accent has made it (no filter reaches the thumb either).
const grip = (L) => (L > 0.94 ? [1, 0, 0, 0.3] : L > 0.85 ? null : [0, 0, 0, 0.45]);
remake('sb-grip-v', 3, grip);
remake('sb-grip-h', 3, grip);

/* ---------- The task pane's chevron: a white disc, a blue mark (19 px, as it is shown) ---------- */

remake('pane-up', 1, (L, C, h, x, y) => {
  const r = Math.hypot(x - 9, y - 9);
  if (r > 7.6) return [0.5, 0.05, BLUE];
  return [mix(0.92, 0.25, (L - 0.38) / 0.62), mix(0.03, 0.045, (L - 0.38) / 0.62), BLUE];
});

/* ---------- The check mark and the option dot: Luna's green, lighter ---------- */

remake('check', 3, (L, C, h) => [Math.min(0.8, L * 1.2), C, h]);
remake('radio', 3, (L, C, h) => [Math.min(0.82, L * 1.14), C, h]);

/* ---------- The trackbar's thumb: a pale body with green tips in a blue-grey line ---------- */

remake('thumb', 3, (L, C, h) => {
  const hue = deg(h);
  if (C > 0.06 && hue > 110 && hue < 170) return [L * 1.04, C, h];                    // the green tips
  if (C > 0.012 && hue > 180 && hue < 300) return [mix(0.1, 0.2, (L - 0.6) / 0.25), 0.02, h]; // its outline
  return [curve([[0.8, 0.44], [0.88, 0.56], [0.97, 0.7]])(L), 0.012, BLUE];             // the body
});
