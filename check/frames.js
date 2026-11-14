/*
  Frame cost on real interactions, which screenshots cannot show: scrolling a long
  list, going to another page and back by its control, and opening a menu and
  closing it with Escape. Each is a real wheel turn or press (input.js) on a fresh
  load of the Scripts page with 60 more scripts in it.

  While each runs, the page records the gaps between animation frames and every long
  task. With vsync on (the default) a gap over 20 ms is a dropped frame, which is what
  a person sees; with --vsync off the frames are unthrottled and the mean gap is the
  cost of a frame.

  With --against, each repetition visits both origins, alternating which goes first:
  this machine drifts minutes apart by far more than most changes cost, so only
  measurements taken turn about compare.
*/
'use strict';

const fs = require('fs');
const path = require('path');
const App = require('./page');
const Input = require('./input');
const { wait } = require('./cdp');

// In the page: starts a recorder under its own token and returns nothing; stop(token)
// returns what it saw. A recorder is never restarted by a flag (two loops would run).
function startRecorder(token) {
  const rec = { gaps: [], long: [], on: true };
  (window.__rec = window.__rec || {})[token] = rec;
  try {
    rec.po = new PerformanceObserver((list) => { for (const e of list.getEntries()) rec.long.push(e.duration); });
    rec.po.observe({ type: 'longtask' });
  } catch (e) { /* no long task timing */ }
  let last = 0;
  const step = (t) => {
    if (!rec.on) return;
    if (last) rec.gaps.push(t - last);
    last = t;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function stopRecorder(token) {
  const rec = window.__rec && window.__rec[token];
  if (!rec) return null;
  rec.on = false;
  if (rec.po) rec.po.disconnect();
  delete window.__rec[token];
  return { gaps: rec.gaps, long: rec.long };
}

// The biggest list on screen that scrolls, as a point to turn the wheel at: in a window
// of a Windows style that is not the middle of the screen.
function scroller() {
  let best = null;
  for (const el of document.querySelectorAll('*')) {
    if (el.scrollHeight <= el.clientHeight + 200 || !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue;
    if (!el.checkVisibility({ visibilityProperty: true })) continue;
    const r = el.getBoundingClientRect();
    const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0), h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    if (w < 80 || h < 80) continue;
    const x = Math.max(r.left, 0) + w / 2, y = Math.max(r.top, 0) + h / 2;
    const top = document.elementFromPoint(x, y);
    if (!top || !el.contains(top)) continue;
    if (!best || w * h > best.area) best = { x, y, area: w * h, height: el.scrollHeight };
  }
  if (best) return best;
  const d = document.scrollingElement;
  return d && d.scrollHeight > innerHeight + 200 ? { x: innerWidth / 2, y: innerHeight / 2, height: d.scrollHeight } : null;
}

const INTERACTIONS = {
  async scroll(page) {
    const at = await page.eval(scroller);
    if (!at) return 'nothing to scroll';
    await Input.hover(page, at.x, at.y);
    return async () => {
      await Input.wheel(page, at.x, at.y, 120, { times: 30, every: 16 });
      await wait(500);
      await Input.wheel(page, at.x, at.y, -120, { times: 30, every: 16 });
      await wait(500);
    };
  },
  // Of the controls named Maps (a desktop icon wants two clicks, a taskbar button one),
  // the first that takes a press there; found once per style, on a load of its own.
  async page(page, ctx) {
    const here = () => page.eval(() => location.pathname);
    if (!ctx.mapsAt.has(ctx.style)) {
      let which = null, tried = 0;
      const count = (await Input.findAll(page, ['Maps'])).length;
      for (const how of ['click', 'double']) {
        for (let i = 0; i < count && !which; i++) {
          if (tried++) await ctx.reload();
          const now = (await Input.findAll(page, ['Maps']))[i];
          if (!now) break;
          await Input[how](page, now.x, now.y);
          await wait(900);
          if ((await here()) === '/maps') which = { i, how };
        }
      }
      ctx.mapsAt.set(ctx.style, which);
      await ctx.reload();
    }
    const which = ctx.mapsAt.get(ctx.style);
    const to = which ? (await Input.findAll(page, ['Maps']))[which.i] : null;
    if (!to) return 'no control that goes to Maps';
    return async () => {
      await Input[which.how](page, to.x, to.y);
      await wait(900);
      const back = (await Input.findAll(page, ['Scripts'])).pop();
      if (back) await Input.click(page, back.x, back.y);
      await wait(900);
    };
  },
  async menu(page) {
    // A control that says it opens a menu, else one of the app's own menu buttons by name.
    const at = (await page.eval(() => {
      for (const el of document.querySelectorAll('[aria-haspopup]:not([disabled])')) {
        if (!el.checkVisibility({ visibilityProperty: true })) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || r.top < 0 || r.bottom > innerHeight) continue;
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const top = document.elementFromPoint(x, y);
        if (top && (top === el || el.contains(top))) return { x, y, label: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20) };
      }
      return null;
    })) || (await Input.find(page, ['Script actions', 'More', 'New', 'Sort', 'File']));
    if (!at) return 'no menu button';
    return async () => {
      await Input.click(page, at.x, at.y);
      await wait(700);
      await Input.key(page, 'Escape');
      await wait(700);
    };
  },
};

function summarize(list) {
  const all = list.filter(Boolean);
  const per = all.map((r) => {
    const gaps = r.gaps;
    const janky = gaps.filter((g) => g > 20).length;
    const dropped = gaps.reduce((s, g) => s + Math.max(0, Math.round(g / (1000 / 60)) - 1), 0);
    return {
      frames: gaps.length,
      janky,
      dropped,
      worst: gaps.length ? Math.max(...gaps) : 0,
      mean: gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : 0,
      long: r.long.reduce((s, d) => s + d, 0),
    };
  });
  const med = (f) => {
    const s = per.map((p) => p[f]).sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  };
  const avg = (f) => (per.length ? per.reduce((s, p) => s + p[f], 0) / per.length : null);
  return { n: per.length, janky: med('janky'), jankyMean: avg('janky'), dropped: med('dropped'), worst: med('worst'), mean: avg('mean'), long: avg('long') };
}

async function run(ctx) {
  const { opt, browser, mock, origins, say, SIZES } = ctx;
  const reps = opt.reps || (origins.length > 1 ? 30 : 10);
  const size = SIZES[opt.sizes[0]];
  const theme = opt.themes[0];
  const started = Date.now();
  await fetch(mock.url + '/_mock/many', { method: 'POST', body: JSON.stringify({ username: 'ada', n: 60 }) });
  const page = await browser.page(Object.assign({ isolated: true }, size));
  const samples = new Map(); // style|interaction|origin → [{gaps, long}]
  const skipped = new Map();
  const mapsAt = new Map();
  let token = 0;
  say(`frames: ${opt.styles.length} styles × ${Object.keys(INTERACTIONS).length} interactions × ${reps} reps × ${origins.length} origin(s), ${opt.vsync ? 'vsync on' : 'unthrottled'}`);
  for (const style of opt.styles) {
    await App.prefs(page, { style, theme });
    for (let rep = 0; rep < reps; rep++) {
      const order = rep % 2 ? origins.slice().reverse() : origins;
      for (const o of order) {
        for (const name of Object.keys(INTERACTIONS)) {
          await App.signIn(page, mock, 'ada');
          const w = App.watch(page);
          const reload = async () => {
            const r = await App.open(page, o.url + '/scripts', w);
            await wait(300);
            return r;
          };
          const res = await reload();
          if (!res.ok) { skipped.set(`${style}|${name}`, res.why); continue; }
          const go = await INTERACTIONS[name](page, { style, mapsAt, reload });
          if (typeof go !== 'function') { skipped.set(`${style}|${name}`, go); continue; }
          const t = 'r' + ++token;
          await page.eval(startRecorder, t);
          await go();
          const r = await page.eval(stopRecorder, t);
          const key = [style, name, o.name].join('|');
          if (!samples.has(key)) samples.set(key, []);
          samples.get(key).push(r);
        }
      }
    }
    say(`  frames: ${style} done`);
  }
  await page.close();

  const rows = [];
  for (const [key, list] of samples) {
    const [style, interaction, origin] = key.split('|');
    rows.push(Object.assign({ style, interaction, origin }, summarize(list)));
  }
  fs.writeFileSync(path.join(opt.out, 'frames.json'), JSON.stringify({ rows, skipped: [...skipped] }, null, 1));
  const f = (v, d = 0) => (v == null ? '-' : Number(v).toFixed(d));
  const lines = [`frames (${opt.vsync ? 'vsync on: dropped = gaps over 20 ms' : 'unthrottled: mean = ms a frame'}), medians of ${reps}:`,
    'style   interaction  origin        frames>20ms  mean>20ms  worst ms  mean ms  long tasks ms'];
  for (const r of rows) {
    lines.push([r.style.padEnd(7), r.interaction.padEnd(12), r.origin.slice(0, 12).padEnd(12), f(r.janky).padStart(12), f(r.jankyMean, 1).padStart(10), f(r.worst).padStart(9), f(r.mean, 1).padStart(8), f(r.long).padStart(14)].join(' '));
  }
  for (const [k, why] of skipped) lines.push(`  not measured: ${k.replace('|', ' ')}: ${why}`);
  fs.writeFileSync(path.join(opt.out, 'frames.txt'), lines.join('\n') + '\n');
  say(`  frames took ${Math.round((Date.now() - started) / 1000)} s`);
  return { rows, summary: lines.join('\n') };
}

module.exports = { run, startRecorder, stopRecorder, summarize };
