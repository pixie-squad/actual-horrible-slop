#!/usr/bin/env node
/*
  The symbols of the Liquid Glass style (styles/glass/icons.js), from Framework7 Icons
  (MIT): the open set drawn to match SF Symbols.

    node tools/glass-icons.js

  Fetches each drawing named below from the package, pinned by version, and writes
  the SYMBOLS table of styles/glass/icons.js again; the rest of that file is left as
  it is. To add a symbol: give the app's name for it and the set's
  (https://framework7.io/icons/), run this, and say what it is after in the file's head.
*/
'use strict';

const fs = require('fs');
const path = require('path');

const VERSION = '5.0.5';
const OUT = path.join(__dirname, '..', 'styles', 'glass', 'icons.js');

// The app's name (js/icons.js) → the set's.
const MAP = {
  home: 'house',
  code: 'chevron_left_slash_chevron_right',
  map: 'map',
  person: 'person',
  search: 'search',
  heart: 'heart',
  'heart-fill': 'heart_fill',
  share: 'square_arrow_up',
  plus: 'plus',
  diff: 'plus_slash_minus',
  photo: 'photo',
  upload: 'tray_arrow_up',
  ellipsis: 'ellipsis',
  'chevron-left': 'chevron_left',
  'chevron-right': 'chevron_right',
  'chevron-down': 'chevron_down',
  updown: 'chevron_up_chevron_down',
  gear: 'gear_alt',
  pencil: 'pencil',
  trash: 'trash',
  eye: 'eye',
  play: 'play_fill',
  bolt: 'bolt_fill',
  sparkles: 'sparkles',
  check: 'checkmark',
  xmark: 'xmark',
  clock: 'clock',
  doc: 'doc',
  copy: 'doc_on_doc',
  link: 'link',
  clipboard: 'doc_on_clipboard',
  key: 'lock_fill',
  appearance: 'circle_lefthalf_fill',
  info: 'info_circle',
  warning: 'exclamationmark_triangle',
  sort: 'arrow_up_arrow_down',
  send: 'paperplane',
  logout: 'square_arrow_right',
  shield: 'shield',
  target: 'scope',
  flame: 'flame',
  wand: 'wand_stars',
  cube: 'cube',
  list: 'list_bullet',
  drop: 'drop',
  database: 'tray_2',
  reset: 'arrow_counterclockwise',
  globe: 'globe',
  sidebar: 'sidebar_left',
  folder: 'folder',
  'folder-plus': 'folder_badge_plus',
  'doc-text': 'doc_text',
  scissors: 'scissors',
  duplicate: 'plus_square_on_square',
  download: 'square_arrow_down',
  sliders: 'slider_horizontal_3',
  books: 'book',
};

// A tenth of a unit is a twentieth of a pixel at the sizes the app draws these.
const round = (d) => d
  .replace(/-?\d*\.?\d+(?:e-?\d+)?/g, (n) => String(+(+n).toFixed(1)))
  .replace(/\s+/g, ' ')
  .replace(/ ?([MLCQZHVSAmlcqzhvsa]) ?/g, '$1')
  .trim();

async function main() {
  const rows = [];
  for (const [name, theirs] of Object.entries(MAP)) {
    const res = await fetch(`https://cdn.jsdelivr.net/npm/framework7-icons@${VERSION}/svg/${theirs}.svg`);
    if (!res.ok) throw new Error(`${theirs}: ${res.status}`);
    const svg = await res.text();
    const box = (/viewBox="([^"]+)"/.exec(svg) || [])[1];
    if (box !== '0 0 56 56') throw new Error(`${theirs} is drawn on ${box}, not 0 0 56 56`);
    const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => round(m[1]));
    if (!paths.length || /<(circle|rect|polygon|ellipse|g)[\s>]/.test(svg)) throw new Error(`${theirs} is not plain paths`);
    rows.push(`    ${/^[a-z]+$/.test(name) ? name : `'${name}'`}: '${paths.join('')}',`);
  }
  const raw = fs.readFileSync(OUT, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const text = raw.replace(/\r\n/g, '\n');
  const open = '  const SYMBOLS = {\n', close = '\n  };\n';
  const from = text.indexOf(open), to = text.indexOf(close, from);
  if (from < 0 || to < 0) throw new Error('styles/glass/icons.js has no SYMBOLS table');
  fs.writeFileSync(OUT, (text.slice(0, from + open.length) + rows.join('\n') + text.slice(to)).replace(/\n/g, eol));
  console.log(`${rows.length} symbols → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
