/*
  Language server: luau-lsp for the game's scripting API, behind a WebSocket.

    WS  /x/lsp              one connection = one luau-lsp process = one private workspace
    GET /x/lsp/defs/<name>  a definition file, read-only (text/plain)

  Only signed-in users get a session (at most 3 at a time each, 24 in all unless
  NT_LSP_MAX says otherwise). Each WebSocket text message is one JSON-RPC message.
  The browser never sees a real path: the project is file:///project/<path> and the
  definitions are file:///defs/<name>. A client message that names any other file:
  URI is refused. Start-up, in this order (each step may follow the previous one at
  once; messages are handled strictly in the order sent):

    1. initialize   (its params are replaced: luau-lsp gets this server's capabilities)
    2. initialized
    3. $/nt/files { files: { "main.luau": "…", "lib/util.luau": "…" } }
    4. textDocument/didOpen for each file open in the editor

  The workspace mirror on disk is what require() resolves through; keep it equal to
  the project with $/nt/files (replace everything), $/nt/write { path, text },
  $/nt/delete { path } (a file or a folder) and $/nt/rename { from, to } (a file or
  a folder). They are answered (result null) when sent with an id; refused ones are
  answered with an error, or reported as $/nt/error { method, code, message, data }
  when sent without one. Files open in the editor go through didOpen / didChange /
  didClose as usual and take precedence over the mirror.

  How strictly it checks and what it offers is the client's to say, within a fixed
  list, with $/nt/settings at any time, before initialize included:

    { mode: "nonstrict" | "strict" | "nocheck",
      lint: { LocalUnused: false, … },                    rules to turn off, by Luau's names
      completion: { addParentheses, fillCallArguments },  booleans
      inlayHints: { parameterNames: "none" | "literals" | "all",
                    variableTypes, parameterTypes, functionReturnTypes } }

  Every part may be left out and is then as this server sets it. Anything not on the
  list is refused (bad-settings). Sent with an id it is answered (result null) once
  luau-lsp has taken the change, and the open documents are checked again.

  luau-lsp runs on the "standard" platform with types.d.luau then globals.d.luau
  loaded, no Roblox globals, push diagnostics, and no FunctionUnused warning for the
  global functions the game calls (tick). Go-to-definition and go-to-type-definition
  of names from the definition files are answered here when luau-lsp has nothing
  (luau-lsp 1.70 cannot locate symbols of definition files).

  Limits: 2 MB per message, 200 messages a second, 64 requests in flight, the
  project rules of ext/core.js for the mirror and the open documents, 12 new
  sessions a minute per address and per user, and an idle timeout (NT_LSP_IDLE
  seconds, default 600) after the last client message. The process and the folder
  go when the socket closes, when the process stops, and when this server exits.
*/
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const core = require('./core');
const tools = require('./tools');
const ws = require('./ws');

const { HttpError, PROJECT } = core;

const WIN = process.platform === 'win32';
const ROOT_URI = 'file:///project';
const DEFS_URI = 'file:///defs';
const SOCKET_PATH = '/x/lsp';
const MAX_SESSIONS = Math.max(1, Math.floor(Number(process.env.NT_LSP_MAX)) || 24);
const IDLE_MS = Math.max(10, Number(process.env.NT_LSP_IDLE) || 600) * 1000;
const PER_USER = 3;
const NEW_PER_MINUTE = 12;
const MAX_MESSAGE = 2 * 1024 * 1024;
const MAX_RATE = 200;               // client messages per second
const MAX_QUEUE = 256;              // client messages waiting their turn
const MAX_PENDING = 64;             // requests luau-lsp has not answered yet
const MAX_OUTPUT = 16 * 1024 * 1024; // one message from luau-lsp
const MAX_BACKLOG = 32 * 1024 * 1024; // bytes not yet taken by the process or the socket
const MAX_DEPTH = 32;               // nesting of a client message
const INTERNAL_WAIT = 5000;         // for the requests this module makes itself
const BASE = path.join(os.tmpdir(), 'nt-lsp');
const SESSION_DIR = /^(\d+)-[0-9a-f]{32}$/;

// Global functions the game calls; luau-lsp would call them unused.
const ENTRY_POINTS = new Set(['tick']);

// JSON-RPC and LSP error codes.
const ERR = { parse: -32700, invalid: -32600, method: -32601, params: -32602, internal: -32603, uninitialized: -32002, failed: -32803 };

/* ---------- Tools and definitions ---------- */

const BIN = tools.bin('luau-lsp');
const DEFS = (() => {
  const files = tools.defs();
  if (!files) return null;
  try {
    return files.map((file) => {
      const text = fs.readFileSync(file, 'utf8');
      const name = path.basename(file);
      return { name, file, text, bytes: Buffer.byteLength(text), uri: `${DEFS_URI}/${name}` };
    });
  } catch (e) {
    return null;
  }
})();
const DEF_BY_NAME = new Map((DEFS || []).map((d) => [d.name, d]));

const norm = (p) => (WIN ? p.replace(/\\/g, '/').toLowerCase() : p);
const DEF_BY_PATH = new Map((DEFS || []).map((d) => [norm(d.file), d]));

// Where every declared global, type and member is, for go-to-definition.
const INDEX = indexDefinitions(DEFS || []);

function indexDefinitions(defs) {
  const globals = new Map();
  const types = new Map();
  const members = new Map(); // owner → Map(member → location)
  const parents = new Map(); // extern type → the type it extends
  const member = (owner, name, loc) => {
    if (!members.has(owner)) members.set(owner, new Map());
    if (!members.get(owner).has(name)) members.get(owner).set(name, loc);
  };
  for (const def of defs) {
    let owner = null; // the extern type or table whose members follow
    def.text.split(/\r\n|\r|\n/).forEach((line, n) => {
      const at = (m) => ({ uri: def.uri, range: { start: { line: n, character: m.indices[1][0] }, end: { line: n, character: m.indices[1][1] } } });
      let m;
      if (/^\s*--/.test(line)) return;
      if (owner && /^(end\b|\})/.test(line)) { owner = null; return; }
      if ((m = /^declare\s+extern\s+type\s+(\w+)(?:\s+extends\s+(\w+))?/d.exec(line))) {
        types.set(m[1], at(m));
        if (m[2]) parents.set(m[1], m[2]);
        owner = m[1];
      } else if ((m = /^declare\s+function\s+(\w+)/d.exec(line))) {
        globals.set(m[1], at(m));
      } else if ((m = /^declare\s+(\w+)\s*:/d.exec(line))) {
        globals.set(m[1], at(m));
        if (/\{\s*$/.test(line)) owner = m[1];
      } else if ((m = /^(?:export\s+)?type\s+(\w+)/d.exec(line))) {
        if (!types.has(m[1])) types.set(m[1], at(m));
        if (/\{\s*$/.test(line)) owner = m[1];
      } else if (owner && (m = /^\s+(?:function\s+)?(\w+)\s*[:(]/d.exec(line))) {
        member(owner, m[1], at(m));
      }
    });
  }
  return { globals, types, members, parents };
}

function findMember(type, name) {
  for (let t = type, hops = 0; t && hops < 16; t = INDEX.parents.get(t), hops++) {
    const loc = INDEX.members.has(t) && INDEX.members.get(t).get(name);
    if (loc) return loc;
  }
  return null;
}

// The declared names in a hover's type text that the definitions know.
function typeNames(code) {
  const t = code.replace(/^local\s+\w+\s*:\s*/, '').replace(/^type\s+\w+(?:<[^>]*>)?\s*=\s*/, '');
  return (t.match(/[A-Za-z_]\w*/g) || []).filter((n) => INDEX.types.has(n) || INDEX.members.has(n));
}

/* ---------- luau-lsp configuration ---------- */

// Answered to workspace/configuration and also given with --settings, so it holds
// before the first answer arrives. A client changes only what TUNABLE lists.
const SETTINGS = {
  platform: { type: 'standard' },
  sourcemap: { enabled: false, autogenerate: false },
  types: { roblox: false, definitionFiles: {}, disabledGlobals: [] },
  diagnostics: { includeDependents: true, workspace: false, strictDatamodelTypes: false },
  completion: {
    enabled: true, autocompleteEnd: false, suggestImports: false, imports: { enabled: false },
    addParentheses: true, addTabstopAfterParentheses: true, fillCallArguments: true,
    showKeywords: true, showAnonymousAutofilledFunction: true, showDeprecatedItems: true,
  },
  hover: { enabled: true, showTableKinds: false, multilineFunctionDefinitions: false, includeStringLength: true },
  signatureHelp: { enabled: true },
  inlayHints: { parameterNames: 'literals', variableTypes: false, parameterTypes: false, functionReturnTypes: false, hideHintsForErrorTypes: true },
  require: { useOriginalRequireByStringSemantics: false },
  index: { enabled: true, maxFiles: PROJECT.maxFiles },
  ignoreGlobs: [],
  plugins: { enabled: false, paths: [] },
};
const SETTINGS_FILE = JSON.stringify(Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => ['luau-lsp.' + k, v])));

// What a client may set ($/nt/settings): for each, a type or the values it can take.
const TUNABLE = {
  completion: { addParentheses: 'boolean', fillCallArguments: 'boolean' },
  inlayHints: { parameterNames: ['none', 'literals', 'all'], variableTypes: 'boolean', parameterTypes: 'boolean', functionReturnTypes: 'boolean' },
};
// How strictly Luau checks, and its lint rules, are not settings of luau-lsp's but a
// .luaurc at the project's root. No project path starts with a dot, so it is never
// one of the project's files.
const RC = '.luaurc';
const MODES = ['nonstrict', 'strict', 'nocheck']; // the first is what Luau does unasked
const LINTS = new Set(['UnknownGlobal', 'DeprecatedGlobal', 'GlobalUsedAsLocal', 'LocalShadow', 'SameLineStatement', 'MultiLineStatement', 'LocalUnused', 'FunctionUnused', 'ImportUnused', 'BuiltinGlobalWrite', 'PlaceholderRead', 'UnreachableCode', 'UnknownType', 'ForRange', 'UnbalancedAssignment', 'ImplicitReturn', 'DuplicateLocal', 'FormatString', 'TableLiteral', 'UninitializedLocal', 'DuplicateFunction', 'DeprecatedApi', 'TableOperations', 'DuplicateCondition', 'MisleadingAndOr', 'CommentDirective', 'IntegerParsing', 'ComparisonPrecedence', 'RedundantNativeAttribute']);

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const plain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// A client's choices, checked. → { settings, rc }: luau-lsp's settings with them in,
// and the text of the .luaurc that says the rest ('' when there is nothing to say).
function tuned(p) {
  const bad = (what) => new Refused(ERR.params, 'bad-settings', { setting: String(what).slice(0, 100) });
  for (const key of Object.keys(p)) if (key !== 'mode' && key !== 'lint' && !own(TUNABLE, key)) throw bad(key);
  const settings = Object.assign({}, SETTINGS);
  for (const [section, fields] of Object.entries(TUNABLE)) {
    if (p[section] === undefined) continue;
    if (!plain(p[section])) throw bad(section);
    const next = Object.assign({}, SETTINGS[section]);
    for (const [name, value] of Object.entries(p[section])) {
      const kind = own(fields, name) ? fields[name] : null;
      if (!kind || (Array.isArray(kind) ? !kind.includes(value) : typeof value !== kind)) throw bad(`${section}.${name}`);
      next[name] = value;
    }
    settings[section] = next;
  }
  const rc = {};
  if (p.mode !== undefined) {
    if (!MODES.includes(p.mode)) throw bad('mode');
    if (p.mode !== MODES[0]) rc.languageMode = p.mode;
  }
  if (p.lint !== undefined) {
    if (!plain(p.lint)) throw bad('lint');
    const off = {};
    for (const [name, on] of Object.entries(p.lint)) {
      if (!LINTS.has(name) || typeof on !== 'boolean') throw bad(`lint.${name}`);
      if (!on) off[name] = false;
    }
    if (Object.keys(off).length) rc.lint = off;
  }
  return { settings, rc: Object.keys(rc).length ? JSON.stringify(rc) : '' };
}

// What luau-lsp is told the client can do. No pull diagnostics (it then pushes
// them), UTF-16 positions (as in JavaScript strings), plain Location results.
const CLIENT_CAPABILITIES = {
  general: { positionEncodings: ['utf-16'] },
  workspace: {
    configuration: true,
    workspaceFolders: true,
    didChangeWatchedFiles: { dynamicRegistration: true },
    applyEdit: false,
    workspaceEdit: { documentChanges: false },
    symbol: {},
  },
  textDocument: {
    synchronization: { didSave: true },
    completion: {
      completionItem: {
        snippetSupport: true, commitCharactersSupport: false, documentationFormat: ['markdown', 'plaintext'],
        deprecatedSupport: true, labelDetailsSupport: true, tagSupport: { valueSet: [1] },
      },
      contextSupport: true,
    },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    signatureHelp: {
      signatureInformation: { documentationFormat: ['markdown', 'plaintext'], parameterInformation: { labelOffsetSupport: true }, activeParameterSupport: true },
      contextSupport: true,
    },
    definition: { linkSupport: false },
    typeDefinition: { linkSupport: false },
    references: {},
    documentHighlight: {},
    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
    codeAction: {
      codeActionLiteralSupport: { codeActionKind: { valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports'] } },
      resolveSupport: { properties: ['edit'] },
    },
    rename: { prepareSupport: true },
    publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] }, versionSupport: true, codeDescriptionSupport: true },
    foldingRange: {},
    documentLink: {},
    colorProvider: {},
    inlayHint: {},
    semanticTokens: {
      requests: { full: true },
      tokenTypes: ['namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'parameter', 'variable', 'property', 'enumMember', 'event', 'function', 'method', 'macro', 'keyword', 'modifier', 'comment', 'string', 'number', 'regexp', 'operator', 'decorator'],
      tokenModifiers: ['declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract', 'async', 'modification', 'documentation', 'defaultLibrary'],
      formats: ['relative'],
    },
    callHierarchy: {},
  },
  window: { workDoneProgress: false, showMessage: {} },
};

// What a client may send to luau-lsp. Everything else is answered or dropped here.
const REQUESTS = new Set([
  'shutdown',
  'textDocument/completion', 'textDocument/hover', 'textDocument/signatureHelp',
  'textDocument/definition', 'textDocument/typeDefinition', 'textDocument/references',
  'textDocument/documentHighlight', 'textDocument/documentSymbol', 'textDocument/documentLink',
  'textDocument/codeAction', 'codeAction/resolve', 'textDocument/rename', 'textDocument/prepareRename',
  'textDocument/foldingRange', 'textDocument/semanticTokens/full', 'textDocument/inlayHint',
  'textDocument/documentColor', 'textDocument/colorPresentation', 'textDocument/onTypeFormatting',
  'textDocument/prepareCallHierarchy', 'callHierarchy/incomingCalls', 'callHierarchy/outgoingCalls',
  'workspace/symbol',
]);
const NOTIFICATIONS = new Set([
  'initialized', 'exit', '$/cancelRequest',
  'textDocument/didOpen', 'textDocument/didChange', 'textDocument/didClose', 'textDocument/didSave',
]);
const SYNC = new Set(['textDocument/didOpen', 'textDocument/didChange', 'textDocument/didClose', 'textDocument/didSave']);

/* ---------- Paths, URIs and text ---------- */

// A path as luau-lsp spells it in a URI: file:///c%3A/Users/… on Windows.
function fileUri(p) {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  let head = '';
  if (/^[A-Za-z]:$/.test(parts[0] || '')) head = '/' + parts.shift()[0].toLowerCase() + '%3A';
  return 'file://' + head + '/' + parts.map(encodeURIComponent).join('/');
}

// The path inside a file: URI (any spelling: drive letter case, %3A) and its
// #fragment, or null.
function uriPath(uri) {
  const m = /^file:\/\/([^/?#]*)([^?#]*)(#[A-Za-z0-9_.,:-]*)?$/i.exec(uri);
  if (!m || m[1]) return null; // with a host it is not a local file
  let p;
  try { p = decodeURIComponent(m[2] || '/'); } catch (e) { return null; }
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  return { path: p, fragment: m[3] || '' };
}

// Matches a path where luau-lsp may write it into text: native or URI, either slash,
// "c:" or "c%3A", any letter case on Windows; group 1 is whatever path follows it.
function textPattern(p) {
  const segs = p.split(/[\\/]+/).filter(Boolean);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '(?: |%20)');
  const head = WIN && /^[A-Za-z]:$/.test(segs[0] || '') ? `(?:file:///?)?/?${segs.shift()[0]}(?::|%3a)` : '(?:file://)?';
  const body = segs.map((s) => '[\\\\/]' + esc(s)).join('');
  return new RegExp(head + body + '(?![A-Za-z0-9_.-])((?:[\\\\/][A-Za-z0-9_.%@-]+)*)', WIN ? 'gi' : 'g');
}

function replacer(pattern, virtual) {
  return [pattern, (match, rest) => (/^file:/i.test(match) ? 'file://' : '') + virtual + rest.replace(/\\/g, '/')];
}

// Hides where a path is, keeping only its file name: /…/name.lua
function hider(pattern) {
  return [pattern, (match, rest) => (/^file:/i.test(match) ? 'file://' : '') + '/…' + (rest ? '/' + rest.split(/[\\/]/).pop() : '')];
}

// Whatever else would tell the browser how this machine is laid out: anything under
// these folders, and on Windows any path with a drive letter.
const PRIVATE = [...new Set([os.tmpdir(), core.ROOT, tools.TOOLS_DIR, os.homedir()].map((p) => path.resolve(p)))]
  .filter((p) => path.parse(p).root !== p)
  .sort((a, b) => b.length - a.length)
  .map((p) => hider(textPattern(p)));
if (WIN) PRIVATE.push(hider(/(?:file:\/\/\/?)?\/?\b[A-Za-z](?::|%3a)((?:[\\/][A-Za-z0-9_.%@~-]+)+)/gi));
const DEF_TEXT = (DEFS || []).map((d) => replacer(textPattern(d.file), `/defs/${d.name}`));

// Line `line` of `text` as [start, end) offsets, or null past the last line.
function lineSpan(text, line) {
  const re = /\r\n|\r|\n/g;
  let start = 0;
  for (let l = 0; l < line; l++) {
    const m = re.exec(text);
    if (!m) return null;
    start = m.index + m[0].length;
  }
  const m = re.exec(text);
  return [start, m ? m.index : text.length];
}

const isPosition = (p) => p && Number.isSafeInteger(p.line) && Number.isSafeInteger(p.character) && p.line >= 0 && p.character >= 0;

// UTF-16 offset of an LSP position; past the end of a line is its end.
function offsetAt(text, pos) {
  const span = lineSpan(text, pos.line);
  return span ? Math.min(span[0] + pos.character, span[1]) : text.length;
}

/* ---------- Sessions ---------- */

const sessions = new Set();

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Other servers on this machine share the folder, so only the leftovers of earlier runs
// go: session folders of processes that are gone, or of this process id (which, before
// the first session, can only be an earlier run's).
function prepareBase() {
  try {
    fs.mkdirSync(BASE, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(BASE);
    // Anyone can create folders in a shared temp directory; only use one that is ours.
    if (!st.isDirectory() || (process.getuid && st.uid !== process.getuid())) return false;
    for (const name of fs.readdirSync(BASE)) {
      const m = SESSION_DIR.exec(name);
      if (!m || (Number(m[1]) !== process.pid && alive(Number(m[1])))) continue;
      try { fs.rmSync(path.join(BASE, name), { recursive: true, force: true }); } catch (e) { /* still in use; next time */ }
    }
    return true;
  } catch (e) {
    return false;
  }
}

const available = Boolean(BIN && DEFS && prepareBase());

function childEnv(dir) {
  const env = { TMPDIR: dir, TMP: dir, TEMP: dir };
  if (WIN) env.SystemRoot = process.env.SystemRoot || 'C:\\Windows';
  return env;
}

const removeDir = (dir) => fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(() => {});

class Refused extends Error {
  constructor(code, message, data) {
    super(message);
    this.rpc = { code, message, data };
  }
}

const badUri = (uri) => new Refused(ERR.params, 'bad-uri', { uri: String(uri).slice(0, 200) });
const fromHttp = (e) => new Refused(ERR.params, e.code, e.extra || undefined);

class Session {
  constructor(conn, user) {
    this.conn = conn;
    this.userId = user.user_id;
    this.dir = path.join(BASE, `${process.pid}-${crypto.randomBytes(16).toString('hex')}`);
    this.projectDir = path.join(this.dir, 'project');
    this.rootUri = fileUri(this.projectDir);
    this.rootNorm = norm(this.projectDir);
    this.text = [replacer(textPattern(this.projectDir), '/project'), ...DEF_TEXT, ...PRIVATE];
    this.child = null;
    this.exited = false;
    this.exiting = false;
    this.ended = false;
    this.phase = 'new'; // → initializing → ready
    this.nextId = 1;
    this.pending = new Map();  // our id → { clientId, method, params } or { internal }
    this.byClient = new Map(); // client id → our id, for $/cancelRequest
    this.docs = new Map();     // open documents: project path → { text, version }
    this.docChars = 0;
    this.mirror = new Map();   // files on disk: project path → text
    this.unannounced = [];     // disk changes made before luau-lsp was initialized
    this.settings = SETTINGS;  // luau-lsp's, with what the client chose ($/nt/settings)
    this.rc = '';              // the .luaurc on disk ('' for none)
    this.configured = null;    // called when luau-lsp next asks for its settings
    this.queued = 0;
    this.second = 0;
    this.inSecond = 0;
    this.lastSeen = Date.now();
    this.out = { chunks: [], size: 0, want: -1 };

    sessions.add(this);
    conn.on('message', (text) => this.receive(text));
    conn.on('close', () => this.end(1000, ''));
    this.armIdle(IDLE_MS);
    this.chain = this.start().catch(() => this.end(1011, 'language server failed to start'));
  }

  async start() {
    await fs.promises.mkdir(this.projectDir, { recursive: true, mode: 0o700 });
    const settings = path.join(this.dir, 'settings.json');
    await fs.promises.writeFile(settings, SETTINGS_FILE);
    if (this.ended) return void removeDir(this.dir);
    // Unnamed definitions load in the order given (named ones load in no fixed order),
    // and globals.d.luau needs the types of types.d.luau. Only paths of ours go here.
    const args = ['lsp', '--stdio', ...DEFS.map((d) => '--definitions=' + d.file), '--settings=' + settings];
    const child = spawn(BIN, args, { cwd: this.projectDir, env: childEnv(this.dir), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    child.on('error', () => this.end(1011, 'language server failed'));
    child.on('exit', () => {
      this.exited = true;
      if (this.exiting) this.end(1000, 'exit');
      else this.end(1011, 'language server stopped');
    });
    child.stdin.on('error', () => {}); // it stopped; 'exit' says so
    child.stdout.on('data', (chunk) => this.fromServer(chunk));
    child.stderr.resume();
  }

  armIdle(ms) {
    this.idle = setTimeout(() => {
      const left = this.lastSeen + IDLE_MS - Date.now();
      if (left > 0) this.armIdle(left);
      else this.end(4408, 'idle');
    }, ms);
    this.idle.unref();
  }

  end(code, reason) {
    if (this.ended) return;
    this.ended = true;
    sessions.delete(this);
    clearTimeout(this.idle);
    if (this.configured) this.configured();
    for (const entry of this.pending.values()) if (entry.internal) entry.internal(null);
    this.pending.clear();
    this.byClient.clear();
    this.docs.clear();
    this.mirror.clear();
    this.conn.close(code, reason);
    const child = this.child;
    if (child && !this.exited) {
      child.once('exit', () => removeDir(this.dir));
      child.kill();
    } else {
      removeDir(this.dir);
    }
  }

  /* ----- Client → luau-lsp ----- */

  receive(text) {
    if (this.ended) return;
    const now = Date.now();
    this.lastSeen = now;
    if (now - this.second >= 1000) {
      this.second = now;
      this.inSecond = 0;
    }
    if (++this.inSecond > MAX_RATE || this.queued >= MAX_QUEUE) return this.end(1008, 'too many messages');
    this.queued++;
    this.chain = this.chain
      .then(() => (this.ended ? null : this.handle(text)))
      .catch((e) => {
        console.error('Language server session:', e);
        this.end(1011, 'internal error');
      })
      .then(() => { this.queued--; });
  }

  async handle(text) {
    let msg;
    try { msg = JSON.parse(text); } catch (e) { return this.reject(null, new Refused(ERR.parse, 'parse-error')); }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return this.reject(null, new Refused(ERR.invalid, 'invalid-request'));
    const { method } = msg;
    if (typeof method !== 'string') return; // a response: this server never asks the client anything
    const isRequest = msg.id !== undefined;
    if (isRequest && !(Number.isSafeInteger(msg.id) || (typeof msg.id === 'string' && msg.id.length <= 100))) {
      return this.reject(null, new Refused(ERR.invalid, 'invalid-request'));
    }
    const params = msg.params === undefined || msg.params === null ? {} : msg.params; // shutdown and exit have none
    try {
      if (method.startsWith('$/nt/')) return await this.custom(msg, params, isRequest);
      if (method === 'initialize') return this.initialize(msg, isRequest);
      if (this.phase === 'new') {
        if (method === 'exit') return this.end(1000, 'exit');
        if (isRequest) throw new Refused(ERR.uninitialized, 'not-initialized');
        return;
      }
      if (!(isRequest ? REQUESTS : NOTIFICATIONS).has(method)) {
        if (isRequest) throw new Refused(ERR.method, 'method-not-found');
        throw new Refused(ERR.method, 'notification-not-forwarded');
      }
      if (!params || typeof params !== 'object') throw new Refused(ERR.params, 'bad-params');
      return this.forward(msg, method, params, isRequest);
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      if (isRequest) this.reject(msg.id, e);
      else this.toClient({ jsonrpc: '2.0', method: '$/nt/error', params: Object.assign({ method: method.slice(0, 100) }, e.rpc) }, true);
    }
  }

  reject(id, refusal) {
    this.toClient({ jsonrpc: '2.0', id, error: refusal.rpc }, true);
  }

  initialize(msg, isRequest) {
    if (!isRequest) return;
    if (this.phase !== 'new') throw new Refused(ERR.invalid, 'already-initialized');
    this.phase = 'initializing';
    // Nothing of the client's goes to the process: not its paths, not its capabilities,
    // not initializationOptions (which can set Luau flags).
    this.request('initialize', {
      processId: process.pid,
      clientInfo: { name: 'nt-scripting' },
      rootUri: this.rootUri,
      rootPath: this.projectDir,
      workspaceFolders: [{ uri: this.rootUri, name: 'project' }],
      capabilities: CLIENT_CAPABILITIES,
      trace: 'off',
    }, { clientId: msg.id, method: 'initialize' });
  }

  forward(msg, method, params, isRequest) {
    if (method === '$/cancelRequest') {
      const ours = params && this.byClient.get(params.id);
      if (ours !== undefined) this.toServer({ jsonrpc: '2.0', method, params: { id: ours } });
      return;
    }
    if (method === 'exit') this.exiting = true;
    const docUri = params.textDocument && params.textDocument.uri;
    // The definition files are not documents of the project: opening them is a no-op.
    if (SYNC.has(method) && typeof docUri === 'string' && docUri.startsWith(DEFS_URI + '/')) return;
    let mapped;
    if (method === 'textDocument/didOpen' || method === 'textDocument/didChange') {
      mapped = this.sync(method, params);
    } else {
      mapped = this.inbound(params, 0);
      if (method === 'textDocument/didClose') {
        const rel = this.relOf(docUri);
        if (rel !== null && this.docs.has(rel)) {
          this.docChars -= this.docs.get(rel).text.length;
          this.docs.delete(rel);
        }
      }
    }
    if (method === 'initialized') {
      if (this.phase !== 'initializing') return;
      this.phase = 'ready';
      this.toServer({ jsonrpc: '2.0', method, params: {} });
      return this.announce(this.unannounced.splice(0));
    }
    if (!isRequest) return void this.toServer({ jsonrpc: '2.0', method, params: mapped });
    if (this.pending.size >= MAX_PENDING) throw new Refused(ERR.failed, 'busy');
    this.request(method, mapped, { clientId: msg.id, method, params: mapped });
  }

  // didOpen / didChange: the document text is content, not an address, so it is left
  // out of the URI walk; it is also tracked here (for its size and for definitions).
  sync(method, params) {
    const uri = params.textDocument && params.textDocument.uri;
    const rel = this.relOf(uri);
    if (rel === null) throw badUri(uri);
    const version = params.textDocument.version;
    if (!Number.isSafeInteger(version)) throw new Refused(ERR.params, 'bad-version');
    if (method === 'textDocument/didOpen') {
      const text = params.textDocument.text;
      if (typeof text !== 'string') throw new Refused(ERR.params, 'bad-text');
      const old = this.docs.has(rel) ? this.docs.get(rel).text.length : 0;
      if (!this.docs.has(rel) && this.docs.size >= PROJECT.maxFiles) throw new Refused(ERR.params, 'too-large', { reason: 'files', limit: PROJECT.maxFiles });
      this.track(rel, text, old, version);
      const mapped = this.inbound(Object.assign({}, params, { textDocument: Object.assign({}, params.textDocument, { text: '' }) }), 0);
      mapped.textDocument.text = text;
      return mapped;
    }
    if (!this.docs.has(rel)) throw new Refused(ERR.params, 'not-open', { uri: String(uri).slice(0, 200) });
    const changes = params.contentChanges;
    if (!Array.isArray(changes)) throw new Refused(ERR.params, 'bad-params');
    let text = this.docs.get(rel).text;
    const old = text.length;
    for (const change of changes) {
      if (!change || typeof change.text !== 'string') throw new Refused(ERR.params, 'bad-text');
      if (change.range === undefined) {
        text = change.text;
        continue;
      }
      const r = change.range;
      if (!r || !isPosition(r.start) || !isPosition(r.end)) throw new Refused(ERR.params, 'bad-range');
      const a = offsetAt(text, r.start);
      const b = offsetAt(text, r.end);
      if (b < a) throw new Refused(ERR.params, 'bad-range');
      text = text.slice(0, a) + change.text + text.slice(b);
    }
    this.track(rel, text, old, version);
    const blank = changes.map((c) => Object.assign({}, c, { text: '' }));
    const mapped = this.inbound(Object.assign({}, params, { contentChanges: blank }), 0);
    mapped.contentChanges.forEach((c, i) => { c.text = changes[i].text; });
    return mapped;
  }

  // An open document over the project's limits ends the session: refusing one change
  // would leave luau-lsp's copy and the editor's apart.
  track(rel, text, old, version) {
    const big = text.length > PROJECT.maxFileBytes / 3 && Buffer.byteLength(text) > PROJECT.maxFileBytes;
    if (big || this.docChars - old + text.length > PROJECT.maxBytes) {
      this.end(1009, 'document too large');
      throw new Refused(ERR.params, 'too-large');
    }
    this.docChars += text.length - old;
    this.docs.set(rel, { text, version });
  }

  // Project path of a file:///project/… URI, or null.
  relOf(uri) {
    if (typeof uri !== 'string' || !uri.startsWith(ROOT_URI + '/')) return null;
    let rel;
    try { rel = decodeURIComponent(uri.slice(ROOT_URI.length + 1)); } catch (e) { return null; }
    return core.badPath(rel) ? null : rel;
  }

  // A client's file: URI as luau-lsp knows it; null for anything outside the two roots.
  realOf(uri) {
    const m = /^file:\/\/\/(project|defs)(?:\/([^?#]*))?$/i.exec(uri);
    if (!m || !uri.slice(8).startsWith(m[1].toLowerCase())) return null;
    let rel;
    try { rel = decodeURIComponent(m[2] || ''); } catch (e) { return null; }
    if (m[1] === 'defs') {
      const def = DEF_BY_NAME.get(rel);
      return def ? fileUri(def.file) : null;
    }
    if (!rel) return this.rootUri;
    if (core.badPath(rel) && core.badPath(rel, true)) return null;
    return this.rootUri + '/' + rel;
  }

  // Client → luau-lsp: every string and key that is a file: URI is mapped, wherever it is.
  inbound(value, depth) {
    if (depth > MAX_DEPTH) throw new Refused(ERR.invalid, 'too-deep');
    if (typeof value === 'string') {
      if (!/^file:/i.test(value)) return value;
      const real = this.realOf(value);
      if (!real) throw badUri(value);
      return real;
    }
    if (Array.isArray(value)) return value.map((v) => this.inbound(v, depth + 1));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (k === '__proto__') continue;
        out[this.inbound(k, depth + 1)] = this.inbound(v, depth + 1);
      }
      return out;
    }
    return value;
  }

  request(method, params, entry) {
    const id = this.nextId++;
    this.pending.set(id, entry);
    if (entry.clientId !== undefined) this.byClient.set(entry.clientId, id);
    this.toServer({ jsonrpc: '2.0', id, method, params });
    return id;
  }

  // A request of this module's own; resolves with its result, or null.
  internal(method, params) {
    return new Promise((resolve) => {
      let id = null;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, INTERNAL_WAIT);
      id = this.request(method, params, {
        internal: (msg) => {
          clearTimeout(timer);
          resolve(msg && msg.result !== undefined ? msg.result : null);
        },
      });
    });
  }

  toServer(msg) {
    const child = this.child;
    if (!child || this.exited || !child.stdin.writable) return;
    const body = JSON.stringify(msg);
    // Content-Length counts bytes, not characters.
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    if (child.stdin.writableLength > MAX_BACKLOG) this.end(1011, 'language server is not keeping up');
  }

  /* ----- The workspace mirror ----- */

  async custom(msg, params, isRequest) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Refused(ERR.params, 'bad-params');
    if (msg.method === '$/nt/settings') {
      await this.configure(params);
      if (isRequest) this.toClient({ jsonrpc: '2.0', id: msg.id, result: null }, true);
      return;
    }
    let next;
    try {
      next = this.planMirror(msg.method, params);
    } catch (e) {
      if (e instanceof HttpError) throw fromHttp(e);
      throw e;
    }
    try {
      await this.applyMirror(next);
    } catch (e) {
      if (e instanceof Refused) throw e;
      throw new Refused(ERR.internal, 'write-failed');
    }
    if (isRequest) this.toClient({ jsonrpc: '2.0', id: msg.id, result: null }, true);
  }

  // $/nt/settings: how this session's luau-lsp checks and what it offers.
  async configure(p) {
    const next = tuned(p);
    const same = JSON.stringify(next.settings) === JSON.stringify(this.settings);
    this.settings = next.settings;
    let change = null;
    if (next.rc !== this.rc) {
      const file = path.join(this.projectDir, RC);
      try {
        if (next.rc) await fs.promises.writeFile(file, next.rc);
        else await fs.promises.rm(file, { force: true });
      } catch (e) {
        throw new Refused(ERR.internal, 'write-failed');
      }
      change = { uri: `${this.rootUri}/${RC}`, type: !next.rc ? 3 : this.rc ? 2 : 1 };
      this.rc = next.rc;
    }
    if (this.ended || (same && !change)) return;
    // Before luau-lsp is initialized there is nothing to tell it: it reads both then.
    if (this.phase !== 'ready') {
      if (change) this.unannounced.push(change);
      return;
    }
    // Told that its settings changed, luau-lsp asks for them again. The client's
    // answer waits for that, so whatever it asks next is answered under the new ones.
    if (!same) {
      let timer = null;
      const asked = new Promise((resolve) => { this.configured = resolve; });
      this.toServer({ jsonrpc: '2.0', method: 'workspace/didChangeConfiguration', params: { settings: null } });
      await Promise.race([asked, new Promise((resolve) => { timer = setTimeout(resolve, INTERNAL_WAIT); })]);
      clearTimeout(timer);
      this.configured = null;
    }
    if (change && !this.ended) this.announce([change]);
  }

  // The mirror as it should be after this change, checked against the project rules.
  planMirror(method, p) {
    const next = new Map(this.mirror);
    const under = (folder) => [...next.keys()].filter((k) => k.startsWith(folder + '/'));
    switch (method) {
      case '$/nt/files': {
        if (!p.files || typeof p.files !== 'object' || Array.isArray(p.files)) throw new HttpError(400, 'bad-files', { reason: 'shape' });
        const files = Object.keys(p.files).length ? core.checkFiles(p.files) : {};
        return new Map(Object.entries(files));
      }
      case '$/nt/write':
        if (typeof p.path !== 'string') throw new HttpError(400, 'bad-files', { reason: 'path' });
        if (typeof p.text !== 'string') throw new HttpError(400, 'bad-files', { reason: 'text', path: p.path.slice(0, 200) });
        next.set(p.path, p.text);
        break;
      case '$/nt/delete': {
        if (typeof p.path !== 'string') throw new HttpError(400, 'bad-files', { reason: 'path' });
        const hit = next.has(p.path) ? [p.path] : core.badPath(p.path, true) ? [] : under(p.path);
        if (!hit.length) throw new HttpError(404, 'not-found', { path: p.path.slice(0, 200) });
        for (const k of hit) next.delete(k);
        break;
      }
      case '$/nt/rename': {
        const { from, to } = p;
        if (typeof from !== 'string' || typeof to !== 'string') throw new HttpError(400, 'bad-files', { reason: 'path' });
        if (from === to) return next;
        const moves = next.has(from) ? [[from, to]] : core.badPath(from, true) ? [] : under(from).map((k) => [k, to + k.slice(from.length)]);
        if (!moves.length) throw new HttpError(404, 'not-found', { path: from.slice(0, 200) });
        const texts = moves.map(([a]) => next.get(a));
        for (const [a] of moves) next.delete(a);
        moves.forEach(([, b], i) => {
          if (next.has(b)) throw new HttpError(400, 'bad-files', { reason: 'exists', path: b.slice(0, 200) });
          next.set(b, texts[i]);
        });
        break;
      }
      default:
        throw new Refused(ERR.method, 'method-not-found');
    }
    return next.size ? new Map(Object.entries(core.checkFiles(Object.fromEntries(next)))) : next;
  }

  // Inside the project folder, whatever the path says (it has been checked already).
  diskPath(rel) {
    const file = path.join(this.projectDir, ...rel.split('/'));
    if (!file.startsWith(this.projectDir + path.sep)) throw new Refused(ERR.params, 'bad-files', { reason: 'path' });
    return file;
  }

  async applyMirror(next) {
    const changes = [];
    const folders = new Set();
    // Deletions first: a rename that only changes letter case must not meet itself.
    for (const rel of [...this.mirror.keys()]) {
      if (next.has(rel)) continue;
      await fs.promises.rm(this.diskPath(rel), { force: true });
      this.mirror.delete(rel);
      changes.push({ uri: this.rootUri + '/' + rel, type: 3 });
      const parts = rel.split('/');
      for (let i = parts.length - 1; i > 0; i--) folders.add(parts.slice(0, i).join('/'));
    }
    for (const folder of [...folders].sort((a, b) => b.length - a.length)) {
      await fs.promises.rmdir(this.diskPath(folder)).catch(() => {}); // not empty: still used
    }
    for (const [rel, text] of next) {
      if (this.mirror.get(rel) === text) continue;
      const file = this.diskPath(rel);
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, text);
      changes.push({ uri: this.rootUri + '/' + rel, type: this.mirror.has(rel) ? 2 : 1 });
      this.mirror.set(rel, text);
    }
    if (this.ended) return;
    if (this.phase === 'ready') this.announce(changes);
    else this.unannounced.push(...changes);
  }

  announce(changes) {
    if (!changes.length) return;
    this.toServer({ jsonrpc: '2.0', method: 'workspace/didChangeWatchedFiles', params: { changes } });
    // luau-lsp marks the dependants of a changed file dirty but does not check open
    // documents again, and a require that did not resolve is no dependency at all. An
    // empty change (same version, same text) makes it check each open document and
    // publish its diagnostics.
    for (const [rel, doc] of this.docs) {
      this.toServer({ jsonrpc: '2.0', method: 'textDocument/didChange', params: { textDocument: { uri: this.rootUri + '/' + rel, version: doc.version }, contentChanges: [] } });
    }
  }

  /* ----- luau-lsp → client ----- */

  // LSP stdio framing: headers, a blank line, then Content-Length bytes of JSON.
  fromServer(chunk) {
    const out = this.out;
    out.chunks.push(chunk);
    out.size += chunk.length;
    while (!this.ended) {
      if (out.want < 0) {
        const buf = out.chunks.length === 1 ? out.chunks[0] : Buffer.concat(out.chunks);
        out.chunks = [buf];
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) {
          if (buf.length > 4096) this.end(1011, 'language server sent garbage');
          return;
        }
        const m = /(?:^|\r\n)content-length:\s*(\d+)/i.exec(buf.toString('latin1', 0, end));
        if (!m || Number(m[1]) > MAX_OUTPUT) return void this.end(1011, 'language server sent garbage');
        out.want = Number(m[1]);
        out.chunks = [buf.subarray(end + 4)];
        out.size = buf.length - end - 4;
      }
      if (out.size < out.want) return;
      const all = out.chunks.length === 1 ? out.chunks[0] : Buffer.concat(out.chunks);
      const body = all.subarray(0, out.want);
      out.chunks = [all.subarray(out.want)];
      out.size = all.length - out.want;
      out.want = -1;
      let msg;
      try { msg = JSON.parse(body.toString('utf8')); } catch (e) { return void this.end(1011, 'language server sent garbage'); }
      if (msg && typeof msg === 'object') this.onServer(msg);
    }
  }

  onServer(msg) {
    if (msg.method !== undefined && msg.id !== undefined) return this.answerServer(msg);
    if (msg.method !== undefined) return this.serverNotification(msg);
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    if (entry.internal) return entry.internal(msg);
    if (this.byClient.get(entry.clientId) === msg.id) this.byClient.delete(entry.clientId);
    const reply = this.outbound({ jsonrpc: '2.0', id: null, result: msg.result, error: msg.error });
    reply.id = entry.clientId;
    if (msg.error !== undefined) delete reply.result;
    else delete reply.error;
    if (entry.method === 'initialize' && reply.result && reply.result.capabilities) {
      delete reply.result.capabilities.diagnosticProvider; // diagnostics are pushed
    }
    const empty = reply.result === null || (Array.isArray(reply.result) && !reply.result.length);
    if (empty && (entry.method === 'textDocument/definition' || entry.method === 'textDocument/typeDefinition')) {
      return void this.locate(entry).catch(() => null).then((found) => {
        if (found) reply.result = entry.method === 'textDocument/definition' ? found : found[0];
        this.toClient(reply, true);
      });
    }
    this.toClient(reply, true);
  }

  answerServer(msg) {
    let result = null;
    let error;
    switch (msg.method) {
      case 'workspace/configuration': {
        const items = msg.params && Array.isArray(msg.params.items) ? msg.params.items : [];
        result = items.map((item) => (item && item.section === 'luau-lsp' ? this.settings : null));
        if (this.configured) this.configured();
        break;
      }
      case 'workspace/workspaceFolders':
        result = [{ uri: this.rootUri, name: 'project' }];
        break;
      case 'workspace/applyEdit':
        result = { applied: false };
        break;
      case 'client/registerCapability':
      case 'client/unregisterCapability':
      case 'window/workDoneProgress/create':
      case 'window/showMessageRequest':
        break;
      default:
        if (!/\/refresh$/.test(msg.method)) error = { code: ERR.method, message: 'method-not-found' };
    }
    this.toServer(error ? { jsonrpc: '2.0', id: msg.id, error } : { jsonrpc: '2.0', id: msg.id, result });
  }

  serverNotification(msg) {
    if (msg.method === 'textDocument/publishDiagnostics') {
      const p = msg.params;
      if (!p || typeof p.uri !== 'string' || !Array.isArray(p.diagnostics)) return;
      const uri = this.virtualOf(p.uri);
      if (!uri || !uri.startsWith(ROOT_URI + '/')) return; // only files of the project
      const diagnostics = p.diagnostics.filter((d) => {
        const m = d && typeof d.message === 'string' && /^FunctionUnused: Function '(\w+)' is never used/.exec(d.message);
        return !(m && ENTRY_POINTS.has(m[1]));
      });
      const out = this.outbound({ jsonrpc: '2.0', method: msg.method, params: Object.assign({}, p, { diagnostics }) });
      return this.toClient(out, true);
    }
    if (msg.method === 'window/showMessage') return this.toClient(this.outbound(msg), true);
    // logMessage, $/logTrace, $/progress, telemetry: nothing a client needs
  }

  // A file: URI of luau-lsp's as the client knows it: undefined when it is not a file
  // URI, null when it is outside the project and the definitions.
  virtualOf(s) {
    if (!/^file:/i.test(s)) return undefined;
    const u = uriPath(s);
    if (u === null) return null;
    const n = norm(u.path);
    if (n === this.rootNorm) return ROOT_URI + u.fragment;
    if (n.startsWith(this.rootNorm + '/')) return ROOT_URI + u.path.slice(this.rootNorm.length).replace(/\\/g, '/') + u.fragment;
    const def = DEF_BY_PATH.get(n);
    return def ? def.uri + u.fragment : null;
  }

  scrub(s) {
    if (!/[\\/]|%3a/i.test(s)) return s;
    for (const [pattern, fn] of this.text) s = s.replace(pattern, fn);
    return s;
  }

  // An object of a list that points at a file outside the project (a location, a
  // link, related information): dropped rather than shown with a scrubbed address.
  pointsOutside(v, depth = 0) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    for (const x of Object.values(v)) {
      if (typeof x === 'string' && this.virtualOf(x) === null) return true;
      if (depth === 0 && this.pointsOutside(x, 1)) return true;
    }
    return false;
  }

  // luau-lsp → client: file: URIs mapped wherever they are, real paths scrubbed from text.
  outbound(value) {
    if (typeof value === 'string') return this.virtualOf(value) || this.scrub(value);
    if (Array.isArray(value)) return value.filter((v) => !this.pointsOutside(v)).map((v) => this.outbound(v));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        const key = this.virtualOf(k);
        if (key === null || k === '__proto__') continue; // e.g. edits to a file outside
        out[key || this.scrub(k)] = this.outbound(v);
      }
      return out;
    }
    return value;
  }

  toClient(msg, mapped) {
    if (this.ended) return;
    this.conn.send(JSON.stringify(mapped ? msg : this.outbound(msg)));
    if (this.conn.bufferedAmount > MAX_BACKLOG) this.end(1008, 'client is not reading');
  }

  /* ----- Definitions of the game's API ----- */

  // Where a name from the definition files is declared, worked out from the text
  // around the position and luau-lsp's hovers; null when it is not one of those.
  async locate(entry) {
    const params = entry.params;
    if (!params.textDocument || typeof params.textDocument.uri !== 'string') return null;
    const rel = this.relOf(this.virtualOf(params.textDocument.uri));
    const pos = params.position;
    const doc = rel !== null && this.docs.get(rel);
    if (!doc || !isPosition(pos)) return null;
    const text = doc.text;
    const span = lineSpan(text, pos.line);
    if (!span) return null;
    const line = text.slice(span[0], span[1]);
    const hover = async (character) => {
      const result = await this.internal('textDocument/hover', { textDocument: { uri: params.textDocument.uri }, position: { line: pos.line, character } });
      const value = result && result.contents && (typeof result.contents === 'string' ? result.contents : result.contents.value);
      const m = typeof value === 'string' && /```[a-z]*\n([\s\S]*?)\n```/.exec(value);
      return m ? m[1] : '';
    };
    let s = Math.min(pos.character, line.length);
    let e = s;
    while (s > 0 && /\w/.test(line[s - 1])) s--;
    while (e < line.length && /\w/.test(line[e])) e++;
    if (s === e || /^\d/.test(line.slice(s, e))) return null;
    const word = line.slice(s, e);

    if (entry.method === 'textDocument/typeDefinition') {
      let code = await hover(s);
      if (/^function\s/.test(code)) code = code.slice(code.lastIndexOf('):') + 2);
      const name = typeNames(code).find((n) => INDEX.types.has(n));
      return name ? [INDEX.types.get(name)] : null;
    }

    let p = s - 1;
    while (p >= 0 && /\s/.test(line[p])) p--;
    if ((line[p] === '.' || line[p] === ':') && line[p - 1] !== '.') {
      const owners = [];
      const self = /^function\s+(\w+)(?:<[^>]*>)?[:.]/.exec(await hover(s)); // a method's hover names its type
      if (self) owners.push(self[1]);
      let r = p - 1;
      while (r >= 0 && /\s/.test(line[r])) r--;
      if (r >= 0 && /\w/.test(line[r])) owners.push(...typeNames(await hover(r)));
      for (const owner of owners) {
        const loc = findMember(owner, word);
        if (loc) return [loc];
      }
      const all = [...INDEX.members.values()].map((m) => m.get(word)).filter(Boolean);
      return all.length ? all.slice(0, 8) : null;
    }
    const loc = INDEX.globals.get(word) || INDEX.types.get(word);
    return loc ? [loc] : null;
  }
}

// When this server exits, so do the language servers (a hard kill of this server ends
// their stdin, and luau-lsp stops at its end).
process.on('exit', () => {
  for (const s of sessions) {
    try { if (s.child && !s.exited) s.child.kill(); } catch (e) { /* already gone */ }
  }
  // Windows keeps a folder for a moment after the process that had it as its working
  // directory was killed, and there is no event loop left to wait in: retry, briefly.
  const nap = new Int32Array(new SharedArrayBuffer(4));
  const until = Date.now() + 2000;
  for (const s of sessions) {
    for (;;) {
      try {
        fs.rmSync(s.dir, { recursive: true, force: true });
        break;
      } catch (e) {
        if (Date.now() > until) break; // swept at the next start
        Atomics.wait(nap, 0, 0, 10);
      }
    }
  }
});

/* ---------- Extension ---------- */

function refuse(socket, status, text) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

async function open(req, socket, head) {
  // Nothing is read until it is decided; refusals after the handshake carry a close
  // code the browser can see (an HTTP status before it is invisible to WebSocket).
  socket.pause();
  let refusal = null;
  let user = null;
  if (!core.rateLimit('lsp-address', core.clientKey(req), NEW_PER_MINUTE, 60000)) {
    refusal = [4429, 'slow-down'];
  } else {
    try {
      user = await core.session(req);
      if (!user) refusal = [4401, 'sign-in'];
    } catch (e) {
      refusal = [4502, 'upstream-unavailable'];
    }
  }
  if (socket.destroyed) return;
  if (!refusal) {
    let mine = 0;
    for (const s of sessions) if (s.userId === user.user_id) mine++;
    if (sessions.size >= MAX_SESSIONS) refusal = [4503, 'busy'];
    else if (mine >= PER_USER) refusal = [4429, 'too-many-sessions'];
    else if (!core.rateLimit('lsp-user', user.user_id, NEW_PER_MINUTE, 60000)) refusal = [4429, 'slow-down'];
  }
  const conn = ws.accept(req, socket, head, { maxMessage: MAX_MESSAGE });
  if (!conn) return;
  if (refusal) return void conn.close(refusal[0], refusal[1]);
  new Session(conn, user);
}

module.exports = {
  name: 'lsp',

  async handle(req, res, url, parts) {
    if (!parts.length) throw new HttpError(426, 'upgrade-required');
    if (parts.length !== 2 || parts[0] !== 'defs') return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method-not-allowed');
    const def = DEF_BY_NAME.get(parts[1]);
    if (!def) throw new HttpError(404, 'not-found');
    res.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'content-length': def.bytes,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : def.text);
  },

  upgrade(req, socket, head, url, parts) {
    if (parts.length) return refuse(socket, 404, 'Not Found');
    if (!available) return refuse(socket, 503, 'Service Unavailable');
    open(req, socket, head).catch((e) => {
      console.error('Language server upgrade:', e);
      socket.destroy();
    });
  },

  info() {
    return {
      available,
      version: tools.version('luau-lsp'),
      socket: SOCKET_PATH,
      root: ROOT_URI,
      defs: DEFS_URI,
      definitions: (DEFS || []).map((d) => d.name),
      signIn: true,
      settings: true, // $/nt/settings is understood
      limits: {
        messageBytes: MAX_MESSAGE,
        files: PROJECT.maxFiles,
        fileBytes: PROJECT.maxFileBytes,
        projectBytes: PROJECT.maxBytes,
        sessionsPerUser: PER_USER,
        idleSeconds: IDLE_MS / 1000,
      },
    };
  },
};
