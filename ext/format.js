/*
  Formatting: Luau as StyLua writes it.

    POST /x/format   { text, tabs?: true, width?: 4, column?: 120, quotes?: "double",
                       range?: { start, end } }
      200 { text, changed }
      422 { error: "format-failed", message, line, column }
      400 bad-json | bad-request, 413 too-large, 429 slow-down,
      503 busy (queue full) | unavailable (no stylua)

  tabs and width are the file's indentation; column is the line length StyLua wraps
  at (40 to 240); quotes is "double" or "single", the kind a string gets when either
  would do. range, in characters of text, formats only the statements inside it.
  Everything else is StyLua's default, whatever the machine it runs on has set: the
  text goes in on stdin and comes out on stdout, StyLua runs in a folder of its own
  with an empty stylua.toml and no environment, and nothing of the text is written
  anywhere. A message names lines of the text, never a file.

  Anyone may call it (there is no account in demo mode), so: 120 requests a minute
  per client, 4 StyLua runs at a time with 8 more waiting, 5 seconds per run.
*/
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const core = require('./core');
const tools = require('./tools');

const { HttpError } = core;

const RUNNING = 4;
const WAITING = 8;
const TIMEOUT = 5000;
const MAX_TEXT = core.PROJECT.maxFileBytes;
const BODY_LIMIT = 2 * MAX_TEXT + 4096; // JSON escapes can double the text
const OUT_CAP = 4 * MAX_TEXT;
const HOME = path.join(os.tmpdir(), 'nt-format');
const QUOTES = { double: 'AutoPreferDouble', single: 'AutoPreferSingle' };

/* ---------- The folder StyLua runs in ---------- */

let home = null;

// Its own folder with an empty stylua.toml, so no configuration of this machine's is
// ever read. Checked every time: a temp cleaner may have removed it since.
async function ready() {
  try {
    await fs.promises.mkdir(HOME, { recursive: true, mode: 0o700 });
    const st = await fs.promises.lstat(HOME);
    const own = typeof process.getuid !== 'function' || (st.uid === process.getuid() && (st.mode & 0o077) === 0);
    if (!st.isDirectory() || !own) throw new Error(`${HOME} is not a private folder of this user`);
    const config = path.join(HOME, 'stylua.toml');
    try { await fs.promises.access(config); } catch (e) { await fs.promises.writeFile(config, ''); }
    home = config;
  } catch (e) {
    if (home !== false) console.error('Formatting is off:', e.message);
    home = false;
    throw new HttpError(503, 'unavailable');
  }
  return home;
}

/* ---------- Running StyLua ---------- */

let running = 0;
const queue = [];

function acquire() {
  if (running < RUNNING) {
    running++;
    return Promise.resolve();
  }
  if (queue.length >= WAITING) throw new HttpError(503, 'busy');
  return new Promise((resolve) => queue.push(resolve));
}

function release() {
  const next = queue.shift();
  if (next) next();
  else running--;
}

// The text goes in on stdin; nothing of it is on the command line.
function exec(bin, args, input) {
  return new Promise((resolve) => {
    const out = [];
    let size = 0, stderr = '', timedOut = false, done = false, timer = null;
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, timedOut, stdout: Buffer.concat(out).toString('utf8'), stderr });
    };
    let child;
    try {
      child = spawn(bin, args, { cwd: HOME, env: {}, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      return finish(-1);
    }
    child.stdout.on('data', (d) => {
      size += d.length;
      if (size > OUT_CAP) return void child.kill('SIGKILL');
      out.push(d);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { if (stderr.length < 65536) stderr += d; });
    child.stdin.on('error', () => {});
    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, TIMEOUT);
    child.on('error', () => finish(-1));
    child.on('close', (code) => finish(code));
    child.stdin.end(input);
  });
}

// "error parsing:\n - unexpected token `+` (1:14 to 1:15), expected …" → the first one.
function failed(stderr) {
  const text = stderr.replace(/\x1b\[[0-9;]*m/g, '');
  const m = /^\s*-\s*(.*?)\s*\((\d+):(\d+) to \d+:\d+\)(.*)$/m.exec(text);
  if (m) {
    const message = (m[1] + m[4]).replace(/\s+/g, ' ').replace(/^,\s*/, '').trim().slice(0, 300);
    return new HttpError(422, 'format-failed', { message, line: Number(m[2]), column: Number(m[3]) });
  }
  // Anything else says nothing about this machine worth sending.
  return new HttpError(422, 'format-failed', { message: 'StyLua could not format this', line: null, column: null });
}

/* ---------- API ---------- */

function options(body) {
  const bad = (field) => new HttpError(400, 'bad-request', { field });
  const o = { tabs: true, width: 4, column: 120, quotes: 'double', range: null };
  if (body.tabs !== undefined) {
    if (typeof body.tabs !== 'boolean') throw bad('tabs');
    o.tabs = body.tabs;
  }
  for (const [key, least, most] of [['width', 1, 16], ['column', 40, 240]]) {
    if (body[key] === undefined) continue;
    if (!Number.isInteger(body[key]) || body[key] < least || body[key] > most) throw bad(key);
    o[key] = body[key];
  }
  if (body.quotes !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(QUOTES, body.quotes)) throw bad('quotes');
    o.quotes = body.quotes;
  }
  if (body.range !== undefined && body.range !== null) {
    const r = body.range;
    if (!r || typeof r !== 'object' || !Number.isInteger(r.start) || !Number.isInteger(r.end) || r.start < 0 || r.end < r.start) throw bad('range');
    o.range = { start: r.start, end: r.end };
  }
  return o;
}

async function format(text, o) {
  const bin = tools.bin('stylua');
  if (!bin) throw new HttpError(503, 'unavailable');
  if (typeof text !== 'string') throw new HttpError(400, 'bad-request', { field: 'text' });
  const clean = text.replace(/\r\n?/g, '\n');
  if (Buffer.byteLength(clean) > MAX_TEXT) throw new HttpError(413, 'too-large', { limit: MAX_TEXT });
  const config = await ready();
  const args = [
    '--config-path', config, '--no-editorconfig', '--syntax', 'Luau', '--line-endings', 'Unix',
    '--indent-type', o.tabs ? 'Tabs' : 'Spaces', '--indent-width', String(o.width),
    '--column-width', String(o.column), '--quote-style', QUOTES[o.quotes],
  ];
  // StyLua counts the range in bytes of UTF-8.
  if (o.range) {
    const at = (n) => Buffer.byteLength(clean.slice(0, Math.min(n, clean.length)));
    args.push('--range-start', String(at(o.range.start)), '--range-end', String(at(o.range.end)));
  }
  args.push('-');
  await acquire();
  let r;
  try { r = await exec(bin, args, clean); } finally { release(); }
  if (r.timedOut) throw new HttpError(422, 'format-failed', { message: `formatting took longer than ${TIMEOUT / 1000} seconds`, line: null, column: null });
  if (r.code === -1) throw new HttpError(503, 'unavailable');
  if (r.code !== 0) throw failed(r.stderr);
  return { text: r.stdout, changed: r.stdout !== clean };
}

const versions = new Map(); // binary → Promise of what it says it is

function version(bin) {
  if (!versions.has(bin)) {
    versions.set(bin, new Promise((resolve) => {
      execFile(bin, ['--version'], { env: {}, timeout: 5000, windowsHide: true }, (err, stdout) => {
        const m = /(\d+\.\d+\.\d+\S*)/.exec(String(stdout || ''));
        resolve(m ? m[1] : tools.version('stylua'));
      });
    }));
  }
  return versions.get(bin);
}

module.exports = {
  name: 'format',
  async handle(req, res, url, parts) {
    if (parts.length) return false;
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed');
    core.requireRate('format', req, 120, 60000);
    const body = await core.readJson(req, BODY_LIMIT);
    core.send(res, 200, await format(body.text, options(body)));
  },
  async info() {
    const bin = tools.bin('stylua');
    return bin ? { available: true, version: await version(bin) } : { available: false };
  },
};
