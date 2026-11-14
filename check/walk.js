/*
  The walk: every address of check/routes.js, in every style asked for, in both
  themes and at both sizes, each a fresh load that is waited on until it has arrived
  (page.js). What it collects: exceptions, console errors and failed requests, a
  screenshot of each page (<out>/walk/<style>/<theme>-<size>/<name>.png), and how
  long each took. It also checks that check/routes.js reaches every page name the
  app's routes know.
*/
'use strict';

const path = require('path');
const App = require('./page');
const ROUTES = require('./routes');

// Answers that belong to the mock's world, whoever asks: the audit log is not open
// to everyone upstream (403), and signed out every call is refused (401).
const always = (url, status) => status === 403 && /\/api\/users\/[^/]+\/audit/.test(url);
const refused = (url, status) => status === 401 && /\/(api|x\/keep)\//.test(url);

const NAMES = ['home', 'scripts', 'maps', 'profile', 'script', 'viewer', 'editor', 'audit', 'user', 'settings', 'editorSettings', 'lintRules', 'notFound'];

async function run(ctx) {
  const { opt, browser, mock, here, say, SIZES, problems } = ctx;
  const routes = opt.routes ? ROUTES.filter((r) => opt.routes.includes(r.path) || opt.routes.includes(r.name)) : ROUTES;
  const started = Date.now();
  const jobs = [];
  for (const style of opt.styles) for (const theme of opt.themes) for (const size of opt.sizes) jobs.push({ style, theme, size });
  const results = [];
  let next = 0;

  async function worker(n) {
    let page = null, sizeNow = null;
    while (next < jobs.length) {
      const job = jobs[next++];
      // A tab of its own per worker, for its own cookies; a new one when the size
      // changes, so that nothing of the other size's layout is carried over.
      if (!page || sizeNow !== job.size) {
        if (page) await page.close();
        page = await browser.page(Object.assign({ isolated: true }, SIZES[job.size]));
        sizeNow = job.size;
      }
      await App.prefs(page, { style: job.style, theme: job.theme });
      const label = `${job.style} ${job.theme} ${job.size}`;
      let current = null;
      const w = App.watch(page, { expected: (url, status) => always(url, status) || (current && current.out && refused(url, status)) || (current && current.name === 'logout' && refused(url, status)) || !!(current && current.expect && current.expect(url, status)) });
      for (const r of routes) {
        current = r;
        if (r.out) await App.signOut(page);
        else await App.signIn(page, mock, 'ada');
        w.label(`${label} ${r.path}`);
        const navs = w.navigations;
        let res = await App.open(page, here.url + r.path, w);
        // A tab Helium reloaded by itself is opened again.
        if (w.navigations - navs > 1) res = await App.open(page, here.url + r.path, w);
        const file = path.join(opt.out, 'walk', job.style, `${job.theme}-${job.size}`, `${r.name}.png`);
        await page.shot(file).catch(() => {});
        const info = await page.eval(() => ({ name: NT.routes.match(NT.routes.current()).name, title: document.title })).catch(() => ({}));
        results.push({ style: job.style, theme: job.theme, size: job.size, path: r.path, name: info.name, ok: res.ok, ms: res.ms, why: res.why || null });
        if (!res.ok) problems.push({ kind: 'page', where: `${label} ${r.path}`, text: res.why });
      }
      say(`  walk: ${label} (${routes.length} pages, worker ${n})`);
    }
    if (page) await page.close();
  }

  say(`walk: ${jobs.length * routes.length} pages`);
  await Promise.all(Array.from({ length: Math.max(1, opt.jobs) }, (_, i) => worker(i + 1)));

  const reached = new Set(results.map((r) => r.name).filter(Boolean));
  const unreached = opt.routes ? [] : NAMES.filter((n) => !reached.has(n));
  if (unreached.length) problems.push({ kind: 'walk', where: 'check/routes.js', text: 'never reached: ' + unreached.join(', ') });
  const fs = require('fs');
  fs.writeFileSync(path.join(opt.out, 'walk.json'), JSON.stringify(results, null, 1));
  const slow = results.filter((r) => r.ok).sort((a, b) => b.ms - a.ms)[0];
  const bad = results.filter((r) => !r.ok).length;
  return {
    results,
    summary: `walk: ${results.length} pages in ${Math.round((Date.now() - started) / 1000)} s, ${bad} never arrived` +
      (slow ? `; slowest ${slow.ms} ms (${slow.style} ${slow.theme} ${slow.size} ${slow.path})` : '') +
      `; screenshots in ${path.join(opt.out, 'walk')}`,
  };
}

module.exports = { run };
