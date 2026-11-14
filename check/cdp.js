/*
  A browser to check the app in, driven over the DevTools protocol (no dependencies:
  Node's own WebSocket and fetch).

    const browser = await cdp.launch({ port, profile, vsync })
    const page = await browser.page()           a new tab
    await page.send('Page.navigate', { url })    any protocol command
    page.on('Runtime.exceptionThrown', fn)       any protocol event
    await page.eval(fn, ...args)                 fn's value, run in the page (fn is sent as text)
    await page.until(fn, { timeout, every })     waits for fn to be true in the page
    await page.shot(file, clip)                  a PNG of the viewport, or of clip
    await browser.close()

  The browser is the user's own, Helium, run headless with a profile of its own
  (never the user's). NT_BROWSER names another Chromium. A profile used for the
  first time is let alone for a while first: Helium reloads its tab once by itself
  some seconds after a fresh profile starts.
*/
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HELIUM = path.join(process.env.LOCALAPPDATA || '', 'imput', 'Helium', 'Application', 'chrome.exe');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function browserPath() {
  if (process.env.NT_BROWSER) return process.env.NT_BROWSER;
  if (fs.existsSync(HELIUM)) return HELIUM;
  throw new Error('No browser: set NT_BROWSER to a Chromium');
}

class Connection {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map(); // sessionId|method → Set
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString('utf8'));
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}${msg.error.data ? ' ' + msg.error.data : ''}`));
        else p.resolve(msg.result);
        return;
      }
      const key = (msg.sessionId || '') + '|' + msg.method;
      for (const fn of this.listeners.get(key) || []) fn(msg.params || {});
    });
    ws.addEventListener('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('browser connection closed'));
      this.pending.clear();
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(msg));
    });
  }
  on(sessionId, method, fn) {
    const key = (sessionId || '') + '|' + method;
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(fn);
    return () => this.listeners.get(key).delete(fn);
  }
}

class Page {
  constructor(conn, targetId, sessionId) {
    this.conn = conn;
    this.targetId = targetId;
    this.sessionId = sessionId;
  }
  send(method, params) { return this.conn.send(method, params, this.sessionId); }
  on(method, fn) { return this.conn.on(this.sessionId, method, fn); }
  once(method, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error('timed out waiting for ' + method)); }, timeout);
      const off = this.on(method, (p) => { clearTimeout(timer); off(); resolve(p); });
    });
  }
  // fn runs in the page with args (JSON values); its value (awaited) comes back.
  async eval(fn, ...args) {
    const expression = typeof fn === 'function' ? `(${String(fn)})(...${JSON.stringify(args)})` : String(fn);
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('in page: ' + ((d.exception && (d.exception.description || d.exception.value)) || d.text));
    }
    return r.result.value;
  }
  // Waits until fn is true in the page. A throw in the page counts as not yet.
  async until(fn, { timeout = 30000, every = 100, args = [] } = {}) {
    const end = Date.now() + timeout;
    let last = null;
    while (Date.now() < end) {
      try {
        if (await this.eval(`!!((${String(fn)})(...${JSON.stringify(args)}))`)) return true;
      } catch (e) { last = e; }
      await wait(every);
    }
    throw new Error('timed out waiting for the page' + (last ? ': ' + last.message : ''));
  }
  async go(url, timeout = 30000) {
    const loaded = this.once('Page.loadEventFired', timeout).catch(() => null);
    await this.send('Page.navigate', { url });
    await loaded;
  }
  async shot(file, clip) {
    const params = { format: 'png', captureBeyondViewport: false };
    if (clip) params.clip = Object.assign({ scale: 1 }, clip);
    const r = await this.send('Page.captureScreenshot', params);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
  async close() {
    await this.conn.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
    if (this.contextId) await this.conn.send('Target.disposeBrowserContext', { browserContextId: this.contextId }).catch(() => {});
  }
}

// opts: { port (DevTools), profile (folder), vsync (false: frames unthrottled), headless (default true) }
async function launch(opts = {}) {
  const port = opts.port || 9333;
  const profile = opts.profile || path.join(os.tmpdir(), 'nt-check-profile');
  const fresh = !fs.existsSync(path.join(profile, 'Default'));
  fs.mkdirSync(profile, { recursive: true });
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1280,800',
  ];
  if (opts.headless !== false) args.unshift('--headless=new');
  if (opts.vsync === false) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
  const child = spawn(browserPath(), args.concat('about:blank'), { stdio: 'ignore', detached: false });
  let ver = null;
  for (let i = 0; i < 100 && !ver; i++) {
    await wait(150);
    try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch (e) { /* not up yet */ }
  }
  if (!ver) {
    child.kill();
    throw new Error('the browser did not open its DevTools port ' + port);
  }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const conn = new Connection(ws);
  if (fresh && opts.settle !== false) await wait(opts.settleMs || 45000);
  return {
    fresh,
    profile,
    conn,
    // isolated: in a browser context of its own (cookies and storage its own too).
    async page({ width = 1280, height = 800, scale = 1.5, mobile = false, isolated = false } = {}) {
      const browserContextId = isolated ? (await conn.send('Target.createBrowserContext', { disposeOnDetach: true })).browserContextId : undefined;
      const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank', browserContextId });
      const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
      const page = new Page(conn, targetId, sessionId);
      page.contextId = browserContextId || null;
      await page.send('Page.enable');
      await page.send('Runtime.enable');
      await page.send('Network.enable');
      await page.send('Log.enable');
      await page.size({ width, height, scale, mobile });
      return page;
    },
    async close() {
      try { await conn.send('Browser.close'); } catch (e) { /* gone */ }
      await wait(300);
      try { child.kill(); } catch (e) { /* gone */ }
    },
  };
}

Page.prototype.size = function ({ width, height, scale = 1, mobile = false }) {
  this.viewport = { width, height, scale, mobile };
  return Promise.all([
    this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile }),
    this.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 }),
  ]);
};

module.exports = { launch, wait, browserPath };
