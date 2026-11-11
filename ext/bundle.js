/*
  Bundling: a project's files become the one script the game runs.

    POST /x/bundle   { files, entry?: "main.luau", minify?: true }
      200 { code, hash, bytes, chars, fits, minified }
      422 { error: "bundle-failed", message, diagnostics: [{ path, line, column, message }] }
      400 bad-json | bad-files | bad-request, 413 too-large, 429 slow-down,
      503 busy (queue full) | unavailable (no darklua)

  The game and the upstream service take one script of at most 1,000,000 characters,
  so darklua (tools.bin('darklua')) inlines every require("./relative/path") into the
  entry file and, with minify, writes it densely, without types and with short local
  names. The entry's top level stays the bundle's top level, so the global functions
  it defines (tick and the rest) stay global; globals are never renamed. Modules run
  once, on first require. The entry's --!native and --!optimize lines stay on top.
  Without minify, a project of one file comes back exactly as sent.

  Requires resolve as in Luau (and luau-lsp): "./" and "../" from the file's folder,
  except in a folder's init.luau, where "./" is the folder's parent and "@self/" the
  folder. The path as written is tried, then with .luau, then .lua, then its
  init.luau or init.lua. Case counts. JSON files (strict JSON) are required as data.
  darklua would follow a require to any file on this machine, so requires are checked
  here first: inside the project, naming one of its files, and no cycles.

  hash is the sha256 of the code's UTF-8; fits is true when both its UTF-8 bytes and
  its UTF-16 length are within the limit. Diagnostics name project paths; line and
  column count from 1 and are null when darklua does not say.

  Anyone may call it (there is no account in demo mode), so: 60 requests a minute per
  client, 2 darklua runs at a time with 4 more waiting, 10 seconds per run.

  bundle(files, entry, minify) does the same for other extensions and throws the same
  HttpErrors; rate(req) applies this endpoint's per-client limit.
*/
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const core = require('./core');
const tools = require('./tools');

const { HttpError } = core;

const LIMIT = 1000000;
const RUNNING = 2;   // darklua processes at once
const WAITING = 4;   // requests queued behind them; past that the answer is "busy"
const TIMEOUT = 10000;
const BODY_LIMIT = 2 * core.PROJECT.maxBytes + 65536; // JSON escapes can double the text
const MAX_DIAGNOSTICS = 50;
const STDERR_CAP = 256 * 1024;
const BASE = path.join(os.tmpdir(), 'nt-bundle');
// darklua runs on a copy of the entry at the project root, so no name from the request
// reaches its command line. No project path starts with a dot.
const ENTRY_COPY = '.nt-entry.luau';

// A renamed local must never take the name of a global the game provides.
const GAME_GLOBALS = ['server', 'lookup', 'createObject', 'createCallback', 'log', 'event', 'json'];
// .luaurc aliases are looked up in every folder above the file, which is outside the project.
const REQUIRES = { require_mode: { name: 'luau', use_luau_configuration: false } };

const CONFIG = {
  // The files' own text, comments and all; only darklua's glue is compact.
  // A project of one file comes out as it went in.
  readable: { generator: 'retain_lines', bundle: REQUIRES, rules: [] },
  // dense writes no comments and no spare spaces, so remove_comments and remove_spaces
  // would change nothing. Every rule here keeps behaviour: types do nothing at run time,
  // and without them the game's Luau never meets type syntax newer than itself (casts
  // keep their parentheses, so f() :: any still yields one value); only locals are
  // renamed, avoiding every global the code uses; t["k"] becomes t.k and f("x") f"x".
  minified: {
    generator: 'dense',
    bundle: REQUIRES,
    rules: [
      'remove_types',
      { rule: 'rename_variables', include_functions: true, globals: ['$default', ...GAME_GLOBALS] },
      'convert_index_to_field',
      'remove_function_call_parens',
    ],
  },
};

/* ---------- Requires ---------- */

class LexError extends Error {
  constructor(index, message) {
    super(message);
    this.index = index;
  }
}

const WORD = /[A-Za-z0-9_]/;
const SPACE = /[ \t\n\v\f\r]/;

// `[` `=`* `[` opens a long string or comment: its level, or -1.
function longLevel(src, i) {
  let j = i + 1;
  while (src[j] === '=') j++;
  return src[j] === '[' ? j - i - 1 : -1;
}

function longString(src, i, level) {
  const open = i + level + 2;
  const close = src.indexOf(']' + '='.repeat(level) + ']', open);
  if (close < 0) throw new LexError(i, 'unfinished long string or comment');
  const body = src.slice(open, close);
  return { end: close + level + 2, body: body[0] === '\n' ? body.slice(1) : body, escaped: false };
}

// From just past `\`: the index of the escape's last character (\z also takes the spaces after it).
function escape(src, j) {
  if (src[j] === 'z') while (SPACE.test(src[j + 1] || '')) j++;
  return j;
}

function quoted(src, i) {
  const quote = src[i];
  let escaped = false;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === quote) return { end: j + 1, body: src.slice(i + 1, j), escaped };
    if (c === '\n') break;
    if (c === '\\') {
      escaped = true;
      j = escape(src, j + 1);
    }
  }
  throw new LexError(i, 'unfinished string');
}

// The text of an interpolated string from `i` up to its closing backtick or next `{`.
function section(src, i, start) {
  let escaped = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '`' || c === '{') return { end: j + 1, open: c === '{', body: src.slice(i, j), escaped };
    if (c === '\n') break;
    if (c === '\\') {
      escaped = true;
      j = escape(src, j + 1);
    }
  }
  throw new LexError(start, 'unfinished string');
}

function comment(src, i) {
  const level = src[i + 2] === '[' ? longLevel(src, i + 2) : -1;
  if (level >= 0) return longString(src, i + 2, level).end;
  const nl = src.indexOf('\n', i);
  return nl < 0 ? src.length : nl;
}

function trivia(src, i) {
  for (;;) {
    if (SPACE.test(src[i] || '')) i++;
    else if (src[i] === '-' && src[i + 1] === '-') i = comment(src, i);
    else return i;
  }
}

// A string literal at `i` → { at, end, body, escaped, plain }, or null.
function literal(src, i) {
  const c = src[i];
  if (c === '"' || c === "'") return Object.assign({ at: i, plain: true }, quoted(src, i));
  const level = c === '[' ? longLevel(src, i) : -1;
  if (level >= 0) return Object.assign({ at: i, plain: true }, longString(src, i, level));
  if (c === '`') {
    const s = section(src, i + 1, i);
    if (!s.open) return { at: i, end: s.end, body: s.body, escaped: s.escaped, plain: false };
  }
  return null;
}

// The literal the `require` at `start` is called with, or null. Extra parentheses and
// backtick strings count here, to be safe; `exact` marks the calls darklua inlines:
// a plain `require` name with one string, as require "x" or require("x").
function requireArg(src, start) {
  let i = trivia(src, start + 7);
  let parens = 0;
  while (src[i] === '(') {
    parens++;
    i = trivia(src, i + 1);
  }
  const lit = literal(src, i);
  if (!lit) return null;
  lit.exact = lit.plain && !/[\w.:]/.test(src[start - 1] || '')
    && (parens === 0 || (parens === 1 && src[trivia(src, lit.end)] === ')'));
  return lit;
}

// Every literal passed to `require` in Luau source. Only strings and comments are told
// apart from code, and the word counts wherever it appears in code, so no require that
// darklua follows can be missed. Throws LexError on an unfinished string or comment.
function requires(src) {
  const found = [];
  const holes = []; // brace depth inside each open `{…}` of an interpolated string
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const top = holes.length - 1;
    if (c === '-' && src[i + 1] === '-') {
      i = comment(src, i);
    } else if (c === '"' || c === "'") {
      i = quoted(src, i).end;
    } else if (c === '[' && longLevel(src, i) >= 0) {
      i = longString(src, i, longLevel(src, i)).end;
    } else if (c === '`' || (c === '}' && top >= 0 && holes[top] === 0)) {
      if (c === '}') holes.pop();
      const s = section(src, i + 1, i);
      if (s.open) holes.push(0);
      i = s.end;
    } else if (c === 'r' && src.startsWith('require', i) && !WORD.test(src[i + 7] || '')) {
      const arg = requireArg(src, i);
      if (arg) found.push(arg);
      i += 7;
    } else {
      if (top >= 0 && c === '{') holes[top]++;
      else if (top >= 0 && c === '}') holes[top]--;
      i++;
    }
  }
  if (holes.length) throw new LexError(src.length, 'unfinished string');
  return found;
}

const has = (files, p) => Object.prototype.hasOwnProperty.call(files, p);

// The project file a require names → { target } or { error }, as darklua's luau mode
// finds it. Paths are exact (case too), so every platform finds the same file.
function resolve(files, from, literal) {
  const shown = literal.body.slice(0, 100);
  if (literal.escaped) return { error: 'a require path cannot contain escape sequences' };
  const parts = literal.body.split('/');
  const dir = from.split('/').slice(0, -1);
  if (parts[0] === '@self') {
    parts.shift();
  } else if (parts[0] !== '.' && parts[0] !== '..') {
    return { error: `require paths start with "./", "../" or "@self/" (got "${shown}")` };
  } else if (path.posix.basename(from, path.posix.extname(from)) === 'init') {
    if (!dir.length) return { error: `"${shown}" is outside the project (in an init file, "./" is the folder's parent)` };
    dir.pop();
  }
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      if (!dir.length) return { error: `"${shown}" is outside the project` };
      dir.pop();
    } else if (core.badPath(part, true)) {
      return { error: `"${shown}" is not a project path` };
    } else {
      dir.push(part);
    }
  }
  const base = dir.join('/');
  const ext = path.posix.extname(base);
  const tries = !base ? []
    : ext === '.luau' || ext === '.lua' ? [base]
    : [base, base + '.luau', base + '.lua', base + '/init.luau', base + '/init.lua'];
  const target = tries.find((p) => has(files, p));
  if (!target) return { error: `cannot find "${shown}"` };
  // darklua picks how to load a file by its exact extension.
  if (!/\.(luau|lua|json)$/.test(target)) return { error: `"${target}" needs a lower-case extension to be required` };
  return { target };
}

function position(src, index) {
  let line = 1, start = 0;
  for (let nl = src.indexOf('\n'); nl >= 0 && nl < index; nl = src.indexOf('\n', nl + 1)) {
    line++;
    start = nl + 1;
  }
  return { line, column: index - start + 1 };
}

const diag = (file, src, index, message) => Object.assign({ path: file }, position(src, index), { message });

// The entry's copy at the project root: when the entry is in a folder, each require
// darklua inlines is rewritten to name its file from the root, keeping the line count.
function rootCopy(src, links) {
  let out = '', last = 0;
  for (const { at, end, target } of links) {
    const lines = src.slice(at, end).split('\n').length - 1;
    out += src.slice(last, at) + JSON.stringify('./' + target) + '\n'.repeat(lines);
    last = end;
  }
  return out + src.slice(last);
}

// Walks the requires from the entry → { problems, copy }: everything darklua must not be
// asked to do, and the text of the entry's copy.
function check(files, entry) {
  const out = [];
  const links = [];
  const state = new Map(); // path → 'open' while its requires are being walked, then 'done'
  const stack = [];
  const visit = (file) => {
    state.set(file, 'open');
    stack.push(file);
    const src = files[file];
    if (file.endsWith('.json')) {
      try { JSON.parse(src); } catch (e) {
        const at = /position (\d+)/.exec(e.message);
        out.push(diag(file, src, at ? Number(at[1]) : 0, 'not valid JSON: ' + e.message.slice(0, 200)));
      }
    } else {
      let found = [];
      try { found = requires(src); } catch (e) {
        if (!(e instanceof LexError)) throw e;
        out.push(diag(file, src, e.index, e.message));
      }
      for (const literal of found) {
        if (out.length >= MAX_DIAGNOSTICS) break;
        const r = resolve(files, file, literal);
        if (r.error) {
          out.push(diag(file, src, literal.at, r.error));
          continue;
        }
        if (file === entry && literal.exact) links.push({ at: literal.at, end: literal.end, target: r.target });
        if (state.get(r.target) === 'open') {
          const cycle = stack.slice(stack.indexOf(r.target)).concat(r.target);
          out.push(diag(file, src, literal.at, 'require cycle: ' + cycle.join(' → ')));
        } else if (!state.has(r.target)) visit(r.target);
      }
    }
    stack.pop();
    state.set(file, 'done');
  };
  visit(entry);
  const copy = entry.includes('/') ? rootCopy(files[entry], links) : files[entry];
  return { problems: out.slice(0, MAX_DIAGNOSTICS), copy };
}

/* ---------- darklua's errors ---------- */

// darklua names files relative to its working directory, the project root.
function projectPath(job, raw) {
  const abs = path.resolve(job.src, raw.replace(/^\\\\\?\\/, ''));
  if (abs === path.join(job.src, ENTRY_COPY)) return job.entry;
  const rel = path.relative(job.src, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

// Nothing about this machine leaves in a message: file names become project paths.
function scrub(job, text) {
  // A file name, not an operator token such as `/` or `//=`.
  let out = text.replace(/`([^`\n]*)`/g, (all, inner) => {
    if (!/\.(luau?|json5?)$/i.test(inner) && !/\w[\\/]\w/.test(inner)) return all;
    return '`' + (projectPath(job, inner) || 'a file outside the project') + '`';
  }).split(ENTRY_COPY).join(job.entry);
  for (const root of [job.dir, BASE, os.tmpdir(), core.ROOT, os.homedir()]) {
    if (!root || root.length < 4) continue;
    for (const form of new Set([root, root.split(path.sep).join('/'), root.split(path.sep).join('\\')])) {
      out = out.split(form).join('…');
    }
  }
  return out
    .replace(/\b[A-Za-z]:[\\/][^\s`'"]*/g, '…')
    .replace(/(^|[\s`'"(])(?:\/[\w.-]+){2,}/g, '$1…')
    .slice(0, 300);
}

// One parse problem: "… creating ast: <what>. (starting from line L, character C …)" with an
// optional "additional information" line, or "… tokenizing: <what> (L:C to L:C)".
const PARSE = /error occurred while creating ast: ([^\n]*?)\.? \(starting from line (\d+), character (\d+)[^)\n]*\)(?:\nadditional information: ([^\n]*))?|error occurred while tokenizing: ([^\n]*?) \((\d+):(\d+) to \d+:\d+\)/g;

function diagnose(job, stderr) {
  const text = stderr.replace(/\x1b\[[0-9;]*m/g, '');
  const at = text.search(/^\d+ errors? happened:/m);
  const body = at >= 0 ? text.slice(at).replace(/^.*\n/, '') : text;
  const out = [];
  const add = (raw, line, column, message) => {
    if (out.length < MAX_DIAGNOSTICS) out.push({ path: raw ? projectPath(job, raw) || job.entry : job.entry, line, column, message: scrub(job, message) });
  };
  const marks = [...body.matchAll(/unable to parse `([^`]+)`: |invalid Lua module at `([^`]+)`: ([^\n]*)|cyclic require detected with ([^\n]*)/g)];
  marks.forEach((m, k) => {
    if (m[1]) {
      const part = body.slice(m.index + m[0].length, k + 1 < marks.length ? marks[k + 1].index : body.length);
      for (const e of part.matchAll(PARSE)) {
        if (e[1] !== undefined) add(m[1], Number(e[2]), Number(e[3]), e[4] ? `${e[1]}: ${e[4]}` : e[1]);
        else add(m[1], Number(e[6]), Number(e[7]), e[5]);
      }
    } else if (m[2]) {
      add(m[2], null, null, m[3]);
    } else {
      const chain = [...m[4].matchAll(/`([^`]+)`/g)].map((p) => p[1]);
      add(chain[0] || null, null, null, 'require cycle: ' + chain.map((p) => projectPath(job, p) || '?').join(' → '));
    }
  });
  if (!out.length) {
    const first = body.split('\n').map((s) => s.replace(/^-> /, '').trim()).find(Boolean);
    // darklua itself crashed: its stack (far deeper nesting than Luau allows) or a bug.
    if (/overflowed its stack/.test(body)) add(null, null, null, 'the code is nested too deeply to bundle');
    else if (/panicked/.test(body)) add(null, null, null, 'darklua stopped on this project');
    else add(null, null, null, first || 'darklua could not bundle this project');
  }
  return out;
}

function failed(diagnostics) {
  const d = diagnostics[0];
  const where = d.line ? `${d.path}:${d.line}:${d.column}` : d.path;
  const more = diagnostics.length > 1 ? ` (and ${diagnostics.length - 1} more)` : '';
  return new HttpError(422, 'bundle-failed', { message: `${where}: ${d.message}${more}`, diagnostics });
}

/* ---------- Running darklua ---------- */

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

let warned = false;

// On a shared machine someone else could own the folder and watch or swap what is written
// there. Checked every time: a temp cleaner may have removed it since.
async function ready() {
  try {
    await fs.promises.mkdir(BASE, { recursive: true, mode: 0o700 });
    const st = await fs.promises.lstat(BASE);
    const own = typeof process.getuid !== 'function' || (st.uid === process.getuid() && (st.mode & 0o077) === 0);
    if (!st.isDirectory() || !own) throw new Error(`${BASE} is not a private folder of this user`);
  } catch (e) {
    if (!warned) console.error('Bundling is off:', e.message);
    warned = true;
    throw new HttpError(503, 'unavailable');
  }
}

// The child gets no environment and no user text on its command line.
function exec(bin, args, cwd) {
  return new Promise((resolve) => {
    let stderr = '', timedOut = false, done = false, timer = null;
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, timedOut, stderr });
    };
    let child;
    try {
      child = spawn(bin, args, { cwd, env: {}, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    } catch (e) {
      return finish(-1);
    }
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { if (stderr.length < STDERR_CAP) stderr += d; });
    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, TIMEOUT);
    child.on('error', () => finish(-1));
    child.on('close', (code) => finish(code));
  });
}

// darklua works from the project root: it keys modules by their path from its working
// directory, so the same file is one module however it is reached.
async function run(bin, files, entry, copy, minify) {
  await ready();
  const dir = await fs.promises.mkdtemp(path.join(BASE, 'b-'));
  const job = { dir, src: path.join(dir, 'src'), entry };
  try {
    for (const name of Object.keys(files)) {
      const file = path.join(job.src, ...name.split('/'));
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, files[name], { flag: 'wx' });
    }
    await fs.promises.writeFile(path.join(job.src, ENTRY_COPY), copy, { flag: 'wx' });
    const config = path.join(dir, 'darklua.json');
    const out = path.join(dir, 'out.luau');
    await fs.promises.writeFile(config, JSON.stringify(minify ? CONFIG.minified : CONFIG.readable), { flag: 'wx' });
    const r = await exec(bin, ['process', ENTRY_COPY, out, '--config', config], job.src);
    if (r.timedOut) throw failed([{ path: entry, line: null, column: null, message: `bundling took longer than ${TIMEOUT / 1000} seconds` }]);
    if (r.code === -1) throw new HttpError(503, 'unavailable');
    if (r.code !== 0) throw failed(diagnose(job, r.stderr));
    return await fs.promises.readFile(out, 'utf8');
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      .catch((e) => console.error('Bundle folder left behind:', e.code));
  }
}

// Left behind only if the server stopped mid-run; nothing this old is still in use.
function sweep() {
  const old = Date.now() - 10 * 60000;
  fs.promises.readdir(BASE, { withFileTypes: true }).then(async (entries) => {
    for (const e of entries) {
      if (!e.isDirectory() || !e.name.startsWith('b-')) continue;
      const p = path.join(BASE, e.name);
      try {
        if ((await fs.promises.stat(p)).mtimeMs < old) await fs.promises.rm(p, { recursive: true, force: true });
      } catch (err) { /* gone already */ }
    }
  }, () => { /* no folder yet */ });
}

/* ---------- API ---------- */

// The hot comments the compiler reads (--!native, --!optimize 2) count only above the first
// token; darklua puts its own code there, or drops comments, so the entry's go back on top.
// Type-checking modes stay out: they say nothing about a bundle whose types may be gone.
function directives(src) {
  const out = [];
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (/^--!(native|optimize)\b/.test(t)) out.push(t);
    else if (t && !t.startsWith('--')) break;
  }
  return out;
}

// minify defaults to true.
async function bundle(files, entry, minify) {
  const bin = tools.bin('darklua');
  if (!bin) throw new HttpError(503, 'unavailable');
  const minified = minify !== false;
  const clean = core.checkFiles(files);
  const main = core.checkEntry(clean, entry);
  const { problems, copy } = check(clean, main);
  if (problems.length) throw failed(problems);
  await acquire();
  let code;
  try { code = await run(bin, clean, main, copy, minified); } finally { release(); }
  const head = directives(clean[main]);
  if (head.join('\n') !== directives(code).join('\n')) code = head.join('\n') + '\n' + code;
  const bytes = Buffer.byteLength(code);
  return { code, hash: core.sha256(code), bytes, chars: code.length, fits: bytes <= LIMIT && code.length <= LIMIT, minified };
}

function rate(req) {
  core.requireRate('bundle', req, 60, 60000);
}

const versions = new Map(); // binary → Promise of what it says it is

function version(bin) {
  if (!versions.has(bin)) {
    versions.set(bin, new Promise((resolve) => {
      execFile(bin, ['--version'], { env: {}, timeout: 5000, windowsHide: true }, (err, stdout) => {
        const m = /(\d+\.\d+\.\d+\S*)/.exec(String(stdout || ''));
        resolve(m ? m[1] : tools.version('darklua'));
      });
    }));
  }
  return versions.get(bin);
}

sweep();

module.exports = {
  name: 'bundle',
  async handle(req, res, url, parts) {
    if (parts.length) return false;
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed');
    rate(req);
    const body = await core.readJson(req, BODY_LIMIT);
    if (body.minify !== undefined && typeof body.minify !== 'boolean') throw new HttpError(400, 'bad-request', { field: 'minify' });
    core.send(res, 200, await bundle(body.files, body.entry, body.minify));
  },
  async info() {
    const bin = tools.bin('darklua');
    return { available: !!bin, version: bin ? await version(bin) : null, limit: LIMIT };
  },
  bundle,
  rate,
};
