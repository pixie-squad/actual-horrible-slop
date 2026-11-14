/*
  What loading the app costs: time to a page that is there, and what went over the
  wire, from an empty cache (cold) and from the one the first load left (warm), on
  this machine's own network and on a slow one.

    load.run({ browser, origins: [{ name, url }], mock, styles, reps, path }) → rows

  Each repetition loads every origin once, in turns that alternate (A B, then B A),
  so that the drift of this machine between minutes falls on both alike. A row is
  the median of its repetitions:
    { origin, style, net, cache, ready, load, requests, revalidated, fromCache, bytes, ownBytes }
  ready: ms from navigation to #app losing aria-busy (the service has answered and the
  page is up); load: the load event; bytes: what came over the wire, ownBytes the part
  of it from the app's own server.
*/
'use strict';

const App = require('./page');
const { wait } = require('./cdp');

const NETS = {
  fast: null,
  // About what DevTools calls Slow 4G.
  slow: { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
};

// Marks when #app stops being busy, from the first moment of the document.
const MARK = `(() => {
  const look = () => {
    const app = document.getElementById('app');
    if (app && !app.hasAttribute('aria-busy') && !window.__ntReady) window.__ntReady = performance.now();
  };
  new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy'] });
})();`;

async function measure(page, url, origin) {
  const seen = new Map();
  const offs = [
    page.on('Network.requestWillBeSent', (e) => { seen.set(e.requestId, { url: e.request.url, status: 0, bytes: 0, cached: false }); }),
    page.on('Network.responseReceived', (e) => {
      const r = seen.get(e.requestId);
      if (r) { r.status = e.response.status; r.cached = !!(e.response.fromDiskCache || e.response.fromServiceWorker || e.response.fromPrefetchCache); }
    }),
    // A revalidated file is reported as the 200 it stands for; the wire said 304.
    page.on('Network.responseReceivedExtraInfo', (e) => { const r = seen.get(e.requestId); if (r && e.statusCode === 304) r.wire304 = true; }),
    page.on('Network.requestServedFromCache', (e) => { const r = seen.get(e.requestId); if (r) r.cached = true; }),
    page.on('Network.loadingFinished', (e) => { const r = seen.get(e.requestId); if (r) r.bytes = e.encodedDataLength; }),
  ];
  const t0 = Date.now();
  await page.go(url, 60000);
  await page.until(App.READY, { timeout: 60000 });
  // What the page asks for after it is up (the lists) belongs to the load too.
  const quietSince = async () => {
    let last = seen.size, at = Date.now();
    while (Date.now() - at < 500) {
      await wait(50);
      if (seen.size !== last) { last = seen.size; at = Date.now(); }
    }
  };
  await quietSince();
  const t = await page.eval(() => {
    const n = performance.getEntriesByType('navigation')[0];
    return { ready: window.__ntReady || null, load: n ? n.loadEventEnd : null };
  });
  offs.forEach((off) => off());
  const rows = [...seen.values()].filter((r) => !/^data:|^blob:/.test(r.url));
  const own = rows.filter((r) => r.url.startsWith(origin));
  return {
    ready: Math.round(t.ready),
    load: Math.round(t.load),
    wall: Date.now() - t0,
    requests: own.length,
    revalidated: own.filter((r) => r.status === 304 || r.wire304).length,
    fromCache: own.filter((r) => r.cached).length,
    bytes: rows.reduce((s, r) => s + r.bytes, 0),
    ownBytes: own.reduce((s, r) => s + r.bytes, 0),
  };
}

const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

async function run({ browser, origins, mock, styles, reps = 5, path = '/', theme = 'light', nets = ['fast', 'slow'], log = console.log }) {
  const page = await browser.page({ width: 1280, height: 800, scale: 1.5 });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: MARK });
  const samples = new Map(); // key → [measure]
  for (const net of nets) {
    await page.send('Network.emulateNetworkConditions', NETS[net] || { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    for (const style of styles) {
      await App.prefs(page, { style, theme });
      for (let rep = 0; rep < reps; rep++) {
        const order = rep % 2 ? origins.slice().reverse() : origins;
        for (const o of order) {
          await App.signIn(page, mock, 'ada');
          // Cold: nothing cached. Then warm: what that load left.
          await page.send('Network.clearBrowserCache');
          await page.go('about:blank');
          const cold = await measure(page, o.url + path, o.url);
          await page.go('about:blank');
          const warm = await measure(page, o.url + path, o.url);
          for (const [cache, m] of [['cold', cold], ['warm', warm]]) {
            const key = [o.name, style, net, cache].join('|');
            if (!samples.has(key)) samples.set(key, []);
            samples.get(key).push(m);
          }
        }
      }
      log(`  load: ${style} ${net} done`);
    }
  }
  await page.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await page.close();
  const rows = [];
  for (const [key, list] of samples) {
    const [origin, style, net, cache] = key.split('|');
    const row = { origin, style, net, cache, n: list.length };
    for (const f of ['ready', 'load', 'requests', 'revalidated', 'fromCache', 'bytes', 'ownBytes']) row[f] = median(list.map((m) => m[f]));
    rows.push(row);
  }
  return rows;
}

function table(rows) {
  const kb = (b) => (b == null ? '-' : (b / 1024).toFixed(0) + ' KB');
  const lines = ['origin     style  net   cache  ready ms  load ms  requests  304s  cached  own bytes  all bytes'];
  for (const r of rows) {
    lines.push([
      r.origin.padEnd(10), r.style.padEnd(6), r.net.padEnd(5), r.cache.padEnd(6),
      String(r.ready).padStart(8), String(r.load).padStart(8), String(r.requests).padStart(9), String(r.revalidated).padStart(5),
      String(r.fromCache).padStart(7), kb(r.ownBytes).padStart(10), kb(r.bytes).padStart(10),
    ].join(' '));
  }
  return lines.join('\n');
}

module.exports = { run, table, NETS };
