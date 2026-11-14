/*
  The app in a tab: choosing a style and theme, signing in through the mock, opening
  an address and waiting until the page has really arrived, and writing down what
  went wrong on the way.

    await App.prefs(page, { style, theme })      before the next load
    await App.signIn(page, mock, 'ada') / App.signOut(page)
    const watch = App.watch(page)                 → { problems, label(text), quiet(ms) }
    await App.open(page, url, watch)              loads and waits (see ready below)

  A page is there when every style says so in the same way: #app has lost
  aria-busy (each style's boot takes it off once the service has answered), nothing
  on the page is aria-busy, the network has been quiet for a while (event streams
  and sockets aside), the fonts are in and two frames have been drawn. NT.nav.top
  and .boot are Liquid Glass's own and are not waited on.
*/
'use strict';

const { wait } = require('./cdp');

async function prefs(page, { style, theme, extra = {} }) {
  if (page._prefsScript) await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: page._prefsScript });
  const value = JSON.stringify(Object.assign({ theme, accent: 'blue', style }, extra));
  const source = `try { var p = JSON.parse(localStorage.getItem('nt.prefs') || '{}'); var v = ${value}; for (var k in v) p[k] = v[k]; localStorage.setItem('nt.prefs', JSON.stringify(p)); } catch (e) {}`;
  page._prefsScript = (await page.send('Page.addScriptToEvaluateOnNewDocument', { source })).identifier;
}

async function signIn(page, mock, username = 'ada') {
  const res = await fetch(mock.url + '/_mock/session', { method: 'POST', body: JSON.stringify({ username }) });
  const { sid } = await res.json();
  await page.send('Network.deleteCookies', { name: 'sid', domain: 'localhost' });
  await page.send('Network.setCookie', { name: 'sid', value: sid, domain: 'localhost', path: '/', httpOnly: true });
  return sid;
}

async function signOut(page) {
  await page.send('Network.deleteCookies', { name: 'sid', domain: 'localhost' });
  await page.send('Network.deleteCookies', { name: 'nt_keep', domain: 'localhost' });
}

// Problems are { kind: 'exception' | 'console' | 'request' | 'log', where, text }.
// expected(url, status) → true for an answer that is part of the page (a 401 while
// signed out, a 404 for an address that is not there): it is not a problem.
function watch(page, { expected = () => false } = {}) {
  const w = { problems: [], where: '', inflight: new Map(), answered: new Map(), last: Date.now(), expected, statuses: new Map(), navigations: 0 };
  const add = (kind, text) => w.problems.push({ kind, where: w.where, text: String(text).slice(0, 600) });
  const LONG = new Set(['EventSource', 'WebSocket']);
  page.on('Runtime.exceptionThrown', (e) => {
    const d = e.exceptionDetails;
    add('exception', (d.exception && d.exception.description) || d.text);
  });
  page.on('Runtime.consoleAPICalled', (e) => {
    if (e.type !== 'error' && e.type !== 'assert') return;
    add('console', e.args.map((a) => (a.value !== undefined ? a.value : a.description)).join(' '));
  });
  page.on('Log.entryAdded', ({ entry }) => {
    if (entry.level !== 'error') return;
    // A failed load is said once, as a request, with its status.
    if (entry.source === 'network') {
      const status = w.statuses.get(entry.url);
      if (status && (status < 400 || w.expected(entry.url, status))) return;
      if (status) return;
    }
    add('log', entry.text + (entry.url ? ' ' + entry.url : ''));
  });
  page.on('Network.requestWillBeSent', (e) => {
    if (LONG.has(e.type) || /^data:|^blob:/.test(e.request.url)) return;
    w.inflight.set(e.requestId, e.request.url);
    w.last = Date.now();
  });
  page.on('Network.responseReceived', (e) => {
    w.statuses.set(e.response.url, e.response.status);
    w.answered.set(e.requestId, Date.now());
    if (e.response.status >= 400 && !w.expected(e.response.url, e.response.status)) add('request', `${e.response.status} ${e.response.url}`);
  });
  page.on('Network.loadingFinished', (e) => { if (w.inflight.delete(e.requestId)) w.last = Date.now(); });
  page.on('Network.loadingFailed', (e) => {
    const url = w.inflight.get(e.requestId);
    if (w.inflight.delete(e.requestId)) w.last = Date.now();
    // A request the page itself gave up on (a newer one replaced it) is not a failure.
    if (url && !e.canceled && e.errorText !== 'net::ERR_ABORTED') add('request', `${e.errorText} ${url}`);
  });
  page.on('Page.frameNavigated', (e) => { if (!e.frame.parentId) w.navigations++; });
  w.label = (text) => { w.where = text; };
  // Resolves once no request has been under way for `ms`. A request whose answer came
  // and whose body the page never read (a 401 it only looked at the status of) never
  // finishes as far as the browser says: answered a while ago, it counts as done.
  w.quiet = async (ms = 400, timeout = 20000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      for (const id of w.inflight.keys()) {
        const at = w.answered.get(id);
        if (at && Date.now() - at > 1500) w.inflight.delete(id);
      }
      if (!w.inflight.size && Date.now() - w.last >= ms) return true;
      await wait(50);
    }
    return false;
  };
  return w;
}

// A page stacked under the one on top may wait to load until it is shown again, so
// only what can be seen counts.
const READY = () => {
  const app = document.getElementById('app');
  const busy = [...document.querySelectorAll('[aria-busy="true"]')].some((el) => el.checkVisibility({ visibilityProperty: true }));
  return !!(document.readyState === 'complete' && window.NT && NT.api && NT.nav && app && !app.hasAttribute('aria-busy') && !busy);
};

// → { ms, ok, why }
async function open(page, url, w, { timeout = 30000 } = {}) {
  const t0 = Date.now();
  if (w) w.inflight.clear();
  await page.go(url, timeout);
  try {
    await page.until(READY, { timeout });
  } catch (e) {
    return { ms: Date.now() - t0, ok: false, why: 'never ready: ' + e.message };
  }
  if (w && !(await w.quiet(400, timeout))) return { ms: Date.now() - t0, ok: false, why: 'network never quiet: ' + [...w.inflight.values()].slice(0, 3).join(', ') };
  await settle(page);
  return { ms: Date.now() - t0, ok: true };
}

// Fonts in, the page's own aria-busy gone again, and two frames drawn.
async function settle(page) {
  await page.eval(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }).catch(() => {});
  await page.until(READY, { timeout: 5000 }).catch(() => {});
  // Animations that end (a page sliding in) have ended; spinners and pulses go on.
  await page.until(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect.getComputedTiming().endTime === Infinity), { timeout: 4000 }).catch(() => {});
}

module.exports = { prefs, signIn, signOut, watch, open, settle, READY };
