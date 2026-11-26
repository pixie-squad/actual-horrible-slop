#!/usr/bin/env node
/*
  The colour roles of the Material 3 Expressive style (styles/md3/style.css), worked out
  by Material's own colour library from each accent's source colour:

    node tools/md3-colors.js

  Material Color Utilities (@material/material-color-utilities, Apache 2.0), pinned by
  version, with the 2025 colour spec that came with M3 Expressive, the Tonal Spot scheme
  variant (a Pixel's own), on a phone, at standard contrast. The library is loaded by a page in the
  checks' browser (check/cdp.js) and runs there, not in Node. What comes back is written
  between the two marks in style.css; the rest of that file is left as it is.

  To add an accent or change one's source colour: the table below, then run this.
*/
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cdp = require('../check/cdp');

const VERSION = '0.4.0';
const LIB = `https://cdn.jsdelivr.net/npm/@material/material-color-utilities@${VERSION}/+esm`;
const OUT = path.join(__dirname, '..', 'styles', 'md3', 'style.css');
const OPEN = '/* colour roles: written by tools/md3-colors.js */', CLOSE = '/* end of colour roles */';

// The accent → its source colour (the swatch in Settings is this colour too).
const SOURCES = {
  blue: '#3b6cf6',
  indigo: '#6a5cf0',
  purple: '#9a4ee0',
  pink: '#d93a8c',
  orange: '#d66a10',
  green: '#1f9a55',
  teal: '#128f9c',
};
// TONAL_SPOT is the scheme a Pixel makes from a colour: one family of hue, the tertiary a
// near neighbour. (VIBRANT is the same family with more colour in it; EXPRESSIVE turns
// secondary and tertiary to other hues, which this app does not want.)
const VARIANT = 'TONAL_SPOT';
const SPEC = '2025';

// The role's name here → the library's.
const ROLES = {
  primary: 'primary', 'on-primary': 'onPrimary', 'primary-container': 'primaryContainer', 'on-primary-container': 'onPrimaryContainer',
  secondary: 'secondary', 'on-secondary': 'onSecondary', 'secondary-container': 'secondaryContainer', 'on-secondary-container': 'onSecondaryContainer',
  tertiary: 'tertiary', 'on-tertiary': 'onTertiary', 'tertiary-container': 'tertiaryContainer', 'on-tertiary-container': 'onTertiaryContainer',
  error: 'error', 'on-error': 'onError', 'error-container': 'errorContainer', 'on-error-container': 'onErrorContainer',
  surface: 'surface', 'surface-dim': 'surfaceDim', 'surface-bright': 'surfaceBright',
  'surface-container-lowest': 'surfaceContainerLowest', 'surface-container-low': 'surfaceContainerLow', 'surface-container': 'surfaceContainer',
  'surface-container-high': 'surfaceContainerHigh', 'surface-container-highest': 'surfaceContainerHighest',
  'on-surface': 'onSurface', 'on-surface-variant': 'onSurfaceVariant', outline: 'outline', 'outline-variant': 'outlineVariant',
  'inverse-surface': 'inverseSurface', 'inverse-on-surface': 'inverseOnSurface', 'inverse-primary': 'inversePrimary',
};

// Runs in the page.
const schemes = async (lib, sources, variant, roles, spec) => {
  const M = await import(lib);
  const colors = new M.MaterialDynamicColors();
  const hex = (argb) => '#' + (argb & 0xffffff).toString(16).padStart(6, '0');
  const out = {};
  for (const [accent, source] of Object.entries(sources)) {
    out[accent] = {};
    for (const theme of ['light', 'dark']) {
      const scheme = new M.DynamicScheme({ sourceColorHct: M.Hct.fromInt(M.argbFromHex(source)), variant: M.Variant[variant], isDark: theme === 'dark', contrastLevel: 0, specVersion: spec, platform: 'phone' });
      const row = (out[accent][theme] = {});
      for (const [name, theirs] of Object.entries(roles)) row[name] = hex(colors[theirs]().getArgb(scheme));
    }
  }
  return out;
};

async function main() {
  const browser = await cdp.launch({ port: 9537, profile: path.join(os.tmpdir(), 'nt-tools-profile'), settleMs: 8000 });
  let all;
  try {
    const page = await browser.page({ width: 800, height: 600, scale: 1 });
    // Any page of the library's own origin, to import it from.
    await page.go(`https://cdn.jsdelivr.net/npm/@material/material-color-utilities@${VERSION}/package.json`);
    all = await page.eval(schemes, LIB, SOURCES, VARIANT, ROLES, SPEC);
  } finally {
    await browser.close();
  }

  const lines = [OPEN];
  for (const theme of ['light', 'dark']) {
    Object.keys(SOURCES).forEach((accent, i) => {
      // The first accent is also what a page with no accent on it has.
      const sel = `html[data-theme="${theme}"]` + (i ? `[data-accent="${accent}"]` : '');
      const row = all[accent][theme];
      const decls = Object.keys(ROLES).map((name) => `--${name}: ${row[name]};`);
      lines.push(`${sel} {`);
      for (let k = 0; k < decls.length; k += 4) lines.push('  ' + decls.slice(k, k + 4).join(' '));
      lines.push('}');
    });
  }
  // The swatch of each accent in Settings: its source colour.
  for (const [accent, source] of Object.entries(SOURCES)) lines.push(`.m-swatch[data-accent="${accent}"] { background: ${source}; }`);
  lines.push(CLOSE);

  const raw = fs.readFileSync(OUT, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const text = raw.replace(/\r\n/g, '\n');
  const from = text.indexOf(OPEN), to = text.indexOf(CLOSE, from);
  if (from < 0 || to < 0) throw new Error('styles/md3/style.css has no place marked for the colour roles');
  fs.writeFileSync(OUT, (text.slice(0, from) + lines.join('\n') + text.slice(to + CLOSE.length)).replace(/\n/g, eol));
  console.log(`${Object.keys(SOURCES).length} accents, ${Object.keys(ROLES).length} roles, light and dark → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
