#!/usr/bin/env node
/*
  Local server for NT Scripting (no dependencies).

    node server.js            → http://localhost:5173
    node ext/tools.js         → fetch the tools some extensions need (once)

  - Serves the static app, falling back to index.html for app routes, its text
    compressed (brotli or gzip, as the browser takes them).
  - Proxies /api/* to https://scripting.nulls.gg/api/* so the browser can use
    the real service with its session cookie, without cross-origin limits.
  - Mounts the backend extensions in ./ext under /x/* (see ext/index.js): the
    bundler, the language server, test runs, which a runner elsewhere carries
    out (ext/tests.js: NT_RUNNER_URL, NT_RUNNER_TOKEN, NT_RUNNER_CA), and Remember
    Me (ext/keep.js: NT_KEEP_KEY). NT_EXT=off runs without them.
  - Keeps nothing. No request or answer is written down, and there is no data
    folder: what the app stores is in the upstream's scripts or in the browser.
*/
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const zlib = require('zlib');
const core = require('./ext/core');
const ext = require('./ext');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
const UPSTREAM = core.UPSTREAM;
const upstreamLib = UPSTREAM.protocol === 'http:' ? http : https;
const upstreamPort = UPSTREAM.port || (UPSTREAM.protocol === 'http:' ? 80 : 443);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Sent with everything: a file is what its type says, and no address of the app goes
// to another site as a referrer.
const SAFE = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
// … and with the page, which no other site may show in a frame of its own.
const PAGE = { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" };

// Only these are ever served from disk.
// A style may keep its pictures and fonts in folders of its own (styles/<id>/icons/…).
const PUBLIC = /^\/(index\.html|js\/[\w.-]+\.js|styles\/[\w-]+\/[\w.-]+\.(?:css|js)|styles\/[\w-]+\/[\w-]+\/[\w.-]+\.(?:png|jpg|woff2))$/;

/* ---------- The app's own files ----------
   Each is read once per version (its size and time of change: an edited file is read
   again on its next request) and kept in memory, with its brotli and gzip forms made
   the first time a browser takes them. Only text is compressed. What is kept is the
   app's own files and nothing else, up to KEEP_MOST bytes, the longest unused going
   first.

   The browser checks back each time (no-cache) and is told when what it has is still
   the file (an ETag for each form), so a file is sent once. */

const KEEP_MOST = 64 * 1024 * 1024;
const TEXT = new Set(['.html', '.css', '.js', '.json', '.svg']);
const kept = new Map(); // file → { version, tag, data, forms: { br, gzip } (Buffers or promises) }
let keptBytes = 0;

const squeeze = {
  br: (data) => new Promise((resolve, reject) => zlib.brotliCompress(data, {
    params: {
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length,
    },
  }, (err, out) => (err ? reject(err) : resolve(out)))),
  gzip: (data) => new Promise((resolve, reject) => zlib.gzip(data, { level: 9 }, (err, out) => (err ? reject(err) : resolve(out)))),
};
const SUFFIX = { br: '-br', gzip: '-gz' };

// The form to send: 'br', 'gzip' or null, by what Accept-Encoding allows.
function encoding(req) {
  const allowed = new Map();
  for (const part of String(req.headers['accept-encoding'] || '').split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    allowed.set(name, q ? Number(q.slice(2)) : 1);
  }
  const ok = (name) => (allowed.has(name) ? allowed.get(name) > 0 : allowed.has('*') && allowed.get('*') > 0);
  return ok('br') ? 'br' : ok('gzip') ? 'gzip' : null;
}

// Whether If-None-Match names this tag (a list, weak or strong, or *).
function matches(req, tag) {
  const header = req.headers['if-none-match'];
  if (!header) return false;
  return header.split(',').some((t) => {
    const v = t.trim();
    return v === '*' || v.replace(/^W\//, '') === tag;
  });
}

function forget(file) {
  const entry = kept.get(file);
  if (!entry) return;
  kept.delete(file);
  keptBytes -= entry.bytes;
}

function trim(file) {
  for (const [old] of kept) {
    if (keptBytes <= KEEP_MOST || old === file) break;
    forget(old);
  }
}

function keep(file, entry) {
  forget(file);
  kept.set(file, entry);
  keptBytes += entry.bytes;
  trim(file);
}

// → the file as kept, read again when it changed; null when there is no such file.
async function load(file, prepare) {
  let stat;
  try { stat = await fs.promises.stat(file); } catch (e) { return null; }
  if (!stat.isFile()) return null;
  const version = `${stat.size}:${stat.mtimeMs}`;
  const had = kept.get(file);
  if (had && had.version === version) {
    // Most recently used goes last.
    kept.delete(file);
    kept.set(file, had);
    return had;
  }
  let data;
  try { data = await fs.promises.readFile(file); } catch (e) { return null; }
  if (prepare) data = prepare(data);
  const entry = {
    version,
    data,
    tag: crypto.createHash('sha1').update(data).digest('base64url').slice(0, 20),
    forms: {},
    bytes: data.length,
  };
  keep(file, entry);
  return entry;
}

// The compressed form, made once; a failure leaves the file to go as it is.
async function form(file, entry, enc) {
  if (!entry.forms[enc]) {
    entry.forms[enc] = squeeze[enc](entry.data).then((out) => {
      if (kept.get(file) === entry) {
        keptBytes += out.length;
        entry.bytes += out.length;
        trim(file);
      }
      return out;
    });
  }
  try { return await entry.forms[enc]; } catch (e) { return null; }
}

/* Versions. The page lists every script and stylesheet of the app with a tag of what
   it holds (<meta name="nt-files">), and js/styles.js asks for each as <path>?v=<tag>.
   An address with the file's current tag is that file for good, and the browser keeps
   it without asking again (immutable); with another tag, or none, it is checked back
   on as before. Only the page itself is asked for on every load. */

const VERSIONED = /^\/(js\/[\w.-]+\.js|styles\/[\w-]+\/[\w.-]+\.(?:css|js))$/;
const short = (entry) => entry.tag.slice(0, 12);

// "path:tag path:tag …" of every file the loader may ask for.
async function versions() {
  const out = [];
  const add = async (rel) => {
    if (!VERSIONED.test('/' + rel)) return;
    const entry = await load(path.join(ROOT, rel));
    if (entry) out.push(`${rel}:${short(entry)}`);
  };
  const list = (dir) => fs.promises.readdir(path.join(ROOT, dir), { withFileTypes: true }).catch(() => []);
  for (const f of await list('js')) if (f.isFile()) await add(`js/${f.name}`);
  for (const s of await list('styles')) {
    if (!s.isDirectory()) continue;
    for (const f of await list(`styles/${s.name}`)) if (f.isFile()) await add(`styles/${s.name}/${f.name}`);
  }
  return out.join(' ');
}

// The page, built again when it or any file it lists changed. App routes such as
// /scripts/abc load the same page, so asset URLs must resolve from the root. (Opened
// from disk there is no base, no list, and relative URLs just work.)
const PAGE_KEY = '\0page';
let built = null; // { key, entry }
async function thePage() {
  const raw = await load(path.join(ROOT, 'index.html'));
  if (!raw) return null;
  const list = await versions();
  const key = raw.tag + ' ' + crypto.createHash('sha1').update(list).digest('base64url');
  if (built && built.key === key && kept.get(PAGE_KEY) === built.entry) return built.entry;
  const tag = (list.match(/(?:^| )js\/styles\.js:(\S+)/) || [])[1];
  const html = raw.data.toString('utf8')
    .replace('<!--base-->', `<base href="/">\n<meta name="nt-files" content="${list}">`)
    .replace('src="js/styles.js"', tag ? `src="js/styles.js?v=${tag}"` : 'src="js/styles.js"');
  const data = Buffer.from(html);
  const entry = { version: key, data, tag: crypto.createHash('sha1').update(data).digest('base64url').slice(0, 20), forms: {}, bytes: data.length };
  keep(PAGE_KEY, entry);
  built = { key, entry };
  return entry;
}

async function sendFile(req, res, file, url) {
  const isPage = path.basename(file) === 'index.html';
  const key = isPage ? PAGE_KEY : file;
  const entry = isPage ? await thePage() : await load(file);
  if (!entry) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const ext = path.extname(file);
  const text = TEXT.has(ext);
  const enc = text && entry.data.length >= 512 ? encoding(req) : null;
  const body = enc ? await form(key, entry, enc) : entry.data;
  const used = body && enc ? enc : null;
  const tag = `"${entry.tag}${used ? SUFFIX[used] : ''}"`;
  const v = url && url.searchParams.get('v');
  const lasting = !!v && VERSIONED.test(url.pathname) && v === short(entry);
  const headers = Object.assign({
    ETag: tag,
    'Cache-Control': lasting ? 'public, max-age=31536000, immutable' : 'no-cache',
  }, text ? { Vary: 'Accept-Encoding' } : null);
  if (matches(req, tag)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  const out = used ? body : entry.data;
  Object.assign(headers, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Content-Length': out.length,
  }, used ? { 'Content-Encoding': used } : null, isPage ? PAGE : null);
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : out);
}

// Requests and answers are piped straight through: nothing of either is read or kept here.
// What changes anything has to come from this app's own pages (core.sameOrigin): the
// upstream is told it comes from its own site, so it cannot tell for itself.
function proxy(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !core.sameOrigin(req)) {
    req.resume();
    res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: 'cross-origin' }));
    return;
  }
  const headers = {
    accept: req.headers.accept || '*/*',
    'accept-language': req.headers['accept-language'] || 'en',
    'user-agent': req.headers['user-agent'] || 'nt-scripting-local',
    origin: UPSTREAM.origin,
    referer: UPSTREAM.origin + '/',
  };
  for (const name of ['cookie', 'content-type', 'content-length']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }

  const upstream = upstreamLib.request(
    { host: UPSTREAM.hostname, port: upstreamPort, method: req.method, path: url.pathname + url.search, headers },
    (up) => {
      const out = { 'x-nt-proxy': '1', 'cache-control': 'no-store', 'cross-origin-resource-policy': 'same-origin' };
      if (up.headers['content-type']) out['content-type'] = up.headers['content-type'];
      if (up.headers['set-cookie']) out['set-cookie'] = up.headers['set-cookie'].map(core.localCookie);
      res.writeHead(up.statusCode || 502, out);
      up.pipe(res);
    }
  );
  upstream.setTimeout(20000, () => upstream.destroy(new Error('upstream timeout')));
  upstream.on('error', () => {
    // Cut off half-way, the answer cannot be mended: it ends there.
    if (res.headersSent) return void res.destroy();
    res.writeHead(502, { 'x-nt-proxy': '1', 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: 'upstream unavailable' }));
  });
  req.pipe(upstream);
}

function parse(req) {
  try { return new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch (e) { return null; }
}

const server = http.createServer((req, res) => {
  for (const name of Object.keys(SAFE)) res.setHeader(name, SAFE[name]);
  const url = parse(req);
  if (!url) {
    res.writeHead(400);
    res.end();
    return;
  }

  if (url.pathname.startsWith('/api/')) return proxy(req, res, url);
  if (url.pathname === '/x' || url.pathname.startsWith('/x/')) return void ext.handle(req, res, url);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }

  const done = (err) => {
    console.error('Serving a file:', err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  };
  if (PUBLIC.test(url.pathname)) return void sendFile(req, res, path.join(ROOT, url.pathname), url).catch(done);

  // Unknown files are a 404; everything else is an app route.
  if (path.extname(url.pathname)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  sendFile(req, res, path.join(ROOT, 'index.html')).catch(done);
});

// WebSockets exist only for extensions (the language server).
server.on('upgrade', (req, socket, head) => {
  const url = parse(req);
  if (!url || !url.pathname.startsWith('/x/')) return void socket.destroy();
  socket.on('error', () => {});
  ext.upgrade(req, socket, head, url);
});

// As PID 1 in a container Node ignores these unless handled, which makes `docker stop` hang.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));

server.listen(PORT, HOST, () => {
  console.log(`NT Scripting → http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Proxying /api → ${UPSTREAM.origin}/api`);
  console.log(ext.names.length ? `Extensions → ${ext.names.join(', ')}` : 'Extensions → none');
});
