#!/usr/bin/env node
/*
  The checks DESIGN.md §5 asks for, in one command (Node only, nothing to install):

    node check/run.js [options]

      --only walk,states,frames,load   which checks (default: walk)
      --styles glass,win7              which styles (default: all six)
      --themes light,dark              (default: both)
      --sizes wide,phone               wide: 1280×800 at 150 %; phone: 390×844 at 3× (default: both)
      --routes /,/scripts              addresses for the walk (default: check/routes.js)
      --against <git ref>              frames and load: compare with that ref, served beside this tree
      --reps <n>                       repetitions for frames (default 30) and load (default 5)
      --vsync off                      frames unthrottled: per-frame cost instead of dropped frames
      --out <folder>                   where screenshots and results go (default check/out/<time>)
      --port <n>                       first of the ports used (default 5197; 9333 for the browser)
      --profile <folder>               the browser's profile (default: one in the system's temp folder)

  It starts the mock upstream (check/mock.js), the app's server (twice with
  --against), and Helium headless with a profile of its own, and stops all of them at
  the end. Exit status 1 when a page threw, logged an error or a request failed, or a
  page never arrived.
*/
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cdp = require('./cdp');
const Mock = require('./mock');
const serve = require('./serve');

const STYLES = ['glass', 'md3', 'md2', 'win95', 'winxp', 'win7'];
const SIZES = {
  wide: { width: 1280, height: 800, scale: 1.5, mobile: false },
  phone: { width: 390, height: 844, scale: 3, mobile: true },
};

function options(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.includes('=') ? a.slice(2).split(/=(.*)/s) : [a.slice(2), argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'];
    o[k] = v;
  }
  const list = (v, all) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : all);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return {
    only: list(o.only, ['walk']),
    styles: list(o.styles, STYLES),
    themes: list(o.themes, ['light', 'dark']),
    sizes: list(o.sizes, Object.keys(SIZES)),
    routes: o.routes ? list(o.routes) : null,
    against: o.against || null,
    reps: o.reps ? Number(o.reps) : null,
    vsync: o.vsync !== 'off',
    out: path.resolve(o.out || path.join(__dirname, 'out', stamp)),
    port: Number(o.port) || 5197,
    devtools: Number(o.devtools) || 9333,
    profile: o.profile || path.join(os.tmpdir(), 'nt-check-profile'),
    jobs: Number(o.jobs) || 1,
  };
}

async function main() {
  const opt = options(process.argv.slice(2));
  for (const s of opt.styles) if (!STYLES.includes(s)) throw new Error('no such style: ' + s);
  for (const s of opt.sizes) if (!SIZES[s]) throw new Error('no such size: ' + s);
  fs.mkdirSync(opt.out, { recursive: true });
  const say = (...a) => console.log(...a);
  const stops = [];
  const problems = [];
  const summary = [];

  try {
    const mock = await Mock.start(opt.port + 100);
    stops.push(() => mock.close());
    const here = await serve.start({ port: opt.port, upstream: mock.url });
    stops.push(() => here.stop());
    const origins = [{ name: 'this tree', url: here.url, root: here.root }];
    if (opt.against) {
      const dir = path.join(os.tmpdir(), 'nt-check-against');
      serve.checkout(opt.against, dir);
      const other = await serve.start({ root: dir, port: opt.port + 1, upstream: mock.url });
      stops.push(() => other.stop());
      origins.push({ name: opt.against, url: other.url, root: dir });
    }
    say(`mock ${mock.url} · app ${origins.map((o) => `${o.name} ${o.url}`).join(' · ')}`);

    const browser = await cdp.launch({ port: opt.devtools, profile: opt.profile, vsync: opt.vsync });
    stops.unshift(() => browser.close());
    if (browser.fresh) say('(a new browser profile: waited for it to settle)');

    const ctx = { opt, browser, mock, origins, here, say, SIZES, problems };

    if (opt.only.includes('walk')) {
      const walk = require('./walk');
      const r = await walk.run(ctx);
      summary.push(r.summary);
    }
    if (opt.only.includes('states')) {
      const states = require('./states');
      const r = await states.run(ctx);
      summary.push(r.summary);
    }
    if (opt.only.includes('frames')) {
      const frames = require('./frames');
      const r = await frames.run(ctx);
      summary.push(r.summary);
    }
    if (opt.only.includes('load')) {
      const load = require('./load');
      say('load:');
      const rows = await load.run({ browser, origins, mock, styles: opt.styles, reps: opt.reps || 5, log: say });
      fs.writeFileSync(path.join(opt.out, 'load.json'), JSON.stringify(rows, null, 1));
      const text = load.table(rows);
      fs.writeFileSync(path.join(opt.out, 'load.txt'), text + '\n');
      summary.push('load (medians):\n' + text);
    }
  } finally {
    for (const stop of stops) await stop().catch(() => {});
  }

  fs.writeFileSync(path.join(opt.out, 'problems.json'), JSON.stringify(problems, null, 1));
  console.log('\n' + summary.join('\n\n'));
  if (problems.length) {
    console.log(`\n${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
    const seen = new Map();
    for (const p of problems) {
      const key = p.kind + ' ' + p.text;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(p.where);
    }
    for (const [key, where] of seen) console.log(`  ${key}\n    at ${where.slice(0, 4).join(', ')}${where.length > 4 ? ` and ${where.length - 4} more` : ''}`);
  }
  console.log(`\nresults in ${opt.out}`);
  process.exitCode = problems.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exitCode = 2;
});
