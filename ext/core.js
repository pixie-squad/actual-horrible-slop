/*
  Shared pieces for the backend extensions (no dependencies).

  Every extension lives in its own file next to this one and is mounted under
  /x/<name> by ext/index.js. What they share is here: how to ask the upstream
  service who a request belongs to, the rules for project files, and small HTTP
  helpers. Nothing here writes to disk.

    NT_UPSTREAM   upstream origin            (default https://scripting.nulls.gg)
    NT_TOOLS      where fetched tools live   (default ./.tools)
    NT_EXT        "off", or a comma list of extensions to load (default: all)
*/
'use strict';

const http = require('http');
const https = require('https');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const UPSTREAM = new URL(process.env.NT_UPSTREAM || 'https://scripting.nulls.gg');
const TOOLS_DIR = path.resolve(process.env.NT_TOOLS || path.join(ROOT, '.tools'));

/* ---------- Errors and responses ---------- */

// Thrown anywhere inside a handler; ext/index.js turns it into a JSON response.
class HttpError extends Error {
  constructor(status, code, extra) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra || null; // merged into the JSON body
  }
}

const BASE_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

function send(res, status, body, headers) {
  if (res.headersSent) return;
  const data = body === undefined || body === null ? '' : JSON.stringify(body);
  res.writeHead(status, Object.assign({}, BASE_HEADERS, data ? { 'content-type': 'application/json; charset=utf-8' } : null, headers));
  res.end(data);
}

/* ---------- Request bodies ---------- */

// Resolves with a Buffer; rejects with 413 once `limit` bytes are exceeded.
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > limit) {
      req.resume();
      return reject(new HttpError(413, 'too-large', { limit }));
    }
    const chunks = [];
    let size = 0, done = false;
    const fail = (err) => { if (!done) { done = true; reject(err); } };
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        fail(new HttpError(413, 'too-large', { limit }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', () => fail(new HttpError(400, 'bad-request')));
    req.on('aborted', () => fail(new HttpError(400, 'bad-request')));
  });
}

async function readJson(req, limit) {
  const buf = await readBody(req, limit);
  try {
    const value = JSON.parse(buf.toString('utf8'));
    if (value === null || typeof value !== 'object') throw new Error('not an object');
    return value;
  } catch (e) {
    throw new HttpError(400, 'bad-json');
  }
}

/* ---------- Upstream ---------- */

// One request to the upstream API. `apiPath` starts with /api/. Never rejects on an
// HTTP status; rejects only when the upstream cannot be reached.
//   opts: { cookie, body (sent as JSON), timeout }
//   → { status, headers, body: Buffer, json (parsed body or null) }
function upstream(method, apiPath, opts = {}) {
  return new Promise((resolve, reject) => {
    const lib = UPSTREAM.protocol === 'http:' ? http : https;
    const payload = opts.body === undefined ? null : Buffer.from(JSON.stringify(opts.body));
    const headers = {
      accept: 'application/json',
      'user-agent': 'nt-scripting-ext',
      origin: UPSTREAM.origin,
      referer: UPSTREAM.origin + '/',
    };
    if (opts.cookie) headers.cookie = opts.cookie;
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = payload.length;
    }
    const req = lib.request({
      host: UPSTREAM.hostname,
      port: UPSTREAM.port || (UPSTREAM.protocol === 'http:' ? 80 : 443),
      method,
      path: apiPath,
      headers,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > 4 * 1024 * 1024) return void req.destroy(new Error('upstream response too large'));
        chunks.push(c);
      });
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        let json = null;
        try { json = body.length ? JSON.parse(body.toString('utf8')) : null; } catch (e) { /* not JSON */ }
        resolve({ status: res.statusCode || 502, headers: res.headers, body, json });
      });
      res.on('error', reject);
    });
    req.setTimeout(opts.timeout || 15000, () => req.destroy(new Error('upstream timeout')));
    req.on('error', reject);
    req.end(payload || undefined);
  });
}

/* ---------- Who is asking ---------- */

// The session cookie is the upstream's; the only way to know whose it is, is to ask.
// Answers are remembered for half a minute, in memory and under a hash of the cookie,
// so a burst of requests asks once.
const SESSION_TTL = 30000;
const sessions = new Map(); // sha256(cookie) → { at, user }
const asking = new Map();   // sha256(cookie) → the lookup under way

function cookieKey(cookie) {
  return crypto.createHash('sha256').update(String(cookie)).digest('hex');
}

// → the signed-in user ({ user_id, name, username, … }) or null.
async function session(req) {
  const cookie = typeof req === 'string' ? req : req.headers.cookie;
  if (!cookie) return null;
  const key = cookieKey(cookie);
  const hit = sessions.get(key);
  if (hit && Date.now() - hit.at < SESSION_TTL) return hit.user;
  // A page load asks several things at once; they share one question to the upstream.
  if (asking.has(key)) return asking.get(key);
  const answer = (async () => {
    let user = null;
    try {
      const res = await upstream('GET', '/api/users/me', { cookie });
      if (res.status === 200 && res.json && res.json.user_id) user = res.json;
      else if (res.status >= 500) throw new HttpError(502, 'upstream-unavailable');
    } catch (e) {
      throw e instanceof HttpError ? e : new HttpError(502, 'upstream-unavailable');
    }
    if (sessions.size > 2000) sessions.clear();
    sessions.set(key, { at: Date.now(), user });
    return user;
  })();
  asking.set(key, answer);
  const settle = () => { if (asking.get(key) === answer) asking.delete(key); };
  answer.then(settle, settle);
  return answer;
}

/* ---------- Guards ---------- */

// A browser sends Origin with anything that is not a plain navigation. When it is
// there it has to be this server; other pages do not get to act with the session.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
}

function requireSameOrigin(req) {
  if (!sameOrigin(req)) throw new HttpError(403, 'cross-origin');
}

function clientKey(req) {
  if (process.env.NT_TRUST_PROXY === '1' && req.headers['x-forwarded-for']) {
    return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

// Fixed-window counter: true while `key` is within `max` uses per `windowMs`.
const windows = new Map();
function rateLimit(name, key, max, windowMs) {
  const now = Date.now();
  const k = name + '\n' + key;
  let w = windows.get(k);
  if (!w || now - w.start >= windowMs) {
    if (windows.size > 5000) for (const [kk, ww] of windows) if (now - ww.start >= ww.span) windows.delete(kk);
    w = { start: now, count: 0, span: windowMs };
    windows.set(k, w);
  }
  w.count++;
  return w.count <= max;
}

function requireRate(name, req, max, windowMs) {
  if (!rateLimit(name, clientKey(req), max, windowMs)) throw new HttpError(429, 'slow-down');
}

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

/* ---------- Project files ---------- */

// A project is a flat map of path → text. The same rules hold wherever one is
// accepted (bundled, mirrored for the language server), so they live here.
const PROJECT = {
  maxFiles: 300,
  maxFileBytes: 1000000,
  maxBytes: 4 * 1024 * 1024,
  maxDepth: 8,
  extensions: ['.luau', '.lua', '.json'],
  entry: 'main.luau',
};
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i; // not usable as file names on Windows

// Why `p` cannot be a project path, or null when it can. Folders are implied by
// the paths of the files in them; `folder: true` checks a path without an extension.
function badPath(p, folder) {
  if (typeof p !== 'string' || !p || p.length > 200) return 'path';
  const parts = p.split('/');
  if (parts.length > PROJECT.maxDepth) return 'depth';
  for (const part of parts) {
    if (!SEGMENT.test(part) || part.endsWith('.') || part.includes('..') || RESERVED.test(part)) return 'name';
  }
  if (!folder && !PROJECT.extensions.includes(path.extname(p).toLowerCase())) return 'extension';
  return null;
}

// Validates { path: text } and returns a clean copy (LF line endings), or throws
// HttpError(400, 'bad-files', { reason, path }) / (413, 'too-large').
function checkFiles(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new HttpError(400, 'bad-files', { reason: 'shape' });
  const names = Object.keys(files);
  if (!names.length) throw new HttpError(400, 'bad-files', { reason: 'empty' });
  if (names.length > PROJECT.maxFiles) throw new HttpError(413, 'too-large', { reason: 'files', limit: PROJECT.maxFiles });
  const out = {};
  const seen = new Set(); // paths and folders, lower-cased: file systems here may ignore case
  const folders = new Set();
  let total = 0;
  for (const name of names) {
    const reason = badPath(name);
    if (reason) throw new HttpError(400, 'bad-files', { reason, path: name.slice(0, 200) });
    const text = files[name];
    if (typeof text !== 'string') throw new HttpError(400, 'bad-files', { reason: 'text', path: name });
    const clean = text.replace(/\r\n?/g, '\n');
    const size = Buffer.byteLength(clean);
    if (size > PROJECT.maxFileBytes) throw new HttpError(413, 'too-large', { reason: 'file', path: name, limit: PROJECT.maxFileBytes });
    total += size;
    if (total > PROJECT.maxBytes) throw new HttpError(413, 'too-large', { reason: 'project', limit: PROJECT.maxBytes });
    const key = name.toLowerCase();
    if (seen.has(key)) throw new HttpError(400, 'bad-files', { reason: 'duplicate', path: name });
    seen.add(key);
    const parts = key.split('/');
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
    out[name] = clean;
  }
  // A file and a folder cannot share a name.
  for (const key of seen) if (folders.has(key)) throw new HttpError(400, 'bad-files', { reason: 'duplicate', path: key });
  return out;
}

// The entry file of a checked project: the one asked for, which has to exist.
function checkEntry(files, entry) {
  const e = entry === undefined || entry === null ? PROJECT.entry : entry;
  if (typeof e !== 'string' || !Object.prototype.hasOwnProperty.call(files, e) || !/\.luau?$/i.test(e)) {
    throw new HttpError(400, 'bad-files', { reason: 'entry' });
  }
  return e;
}

module.exports = {
  ROOT, UPSTREAM, TOOLS_DIR,
  HttpError, send, readBody, readJson,
  upstream, session,
  sameOrigin, requireSameOrigin, clientKey, rateLimit, requireRate,
  sha256,
  PROJECT, badPath, checkFiles, checkEntry,
};
