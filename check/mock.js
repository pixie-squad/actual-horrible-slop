#!/usr/bin/env node
/*
  A stand-in for the upstream service (scripting.nulls.gg/api), so the app can run
  live and signed in without an account. The endpoints and payloads are the ones
  js/api.js uses; what it holds is in memory and starts over with each start.

    node check/mock.js [port]          → http://127.0.0.1:<port>/api
    NT_UPSTREAM=http://127.0.0.1:<port> PORT=5197 node server.js

    const mock = await require('./mock').start(port)   → { url, port, close() }

  Accounts: ada / "correct horse" (scripts, favourites, maps, a photo) and bob / "pw".
  The session is the cookie sid, set for the upstream's own domain as the real one is.
  Everything but signing in answers 401 without one, as the real one does, and the
  audit log answers 403 (it is not open to everyone there yet).

  Control, outside /api:
    POST /_mock/session  { username }       → { sid }: a session without the form
    POST /_mock/expire                       every session runs out
    POST /_mock/fail     { path, method, status, times, delay }
                         the next `times` calls (default 1, -1 for all) whose path matches
                         the regular expression `path` (and `method`, where given) answer
                         `status` after `delay` ms; status 0 drops the connection
    POST /_mock/clear                        no more failures
    POST /_mock/many     { username, n }     n more scripts of theirs (a list long enough to scroll)
    POST /_mock/reset                        the data as it was at start
    GET  /_mock/state                        { logins, sessions, calls: ["METHOD /path status"] }
*/
'use strict';

const http = require('http');
const crypto = require('crypto');
const zlib = require('zlib');

/* ---------- Pictures ---------- */

// A PNG of w × h, coloured by f(x, y) → [r, g, b].
function png(w, h, f) {
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = f(x, y);
      const at = y * (w * 3 + 1) + 1 + x * 3;
      raw[at] = r; raw[at + 1] = g; raw[at + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A block as js/pack.js writes one.
function block(kind, head, bytes) {
  const body = bytes.toString('base64').replace(/.{100}(?=.)/g, '$&\n');
  const pairs = Object.keys(head).map((k) => ` ${k}=${head[k]}`).join('');
  return `--[=[nt:${kind}${pairs}\n${body}\n]=]\n`;
}

/* ---------- Data ---------- */

const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

const CODE = [
  '--!strict\nlocal count = 0\n\nlocal function tick()\n\tcount += 1\n\tif count % 30 == 0 then\n\t\tprint("tick", count)\n\tend\nend\n\nreturn { tick = tick }\n',
  '--!strict\ntype Wave = { bots: number, rest: number }\n\nlocal WAVES: { Wave } = {\n\t{ bots = 3, rest = 6 },\n\t{ bots = 5, rest = 8 },\n}\n\nfor i, wave in WAVES do\n\tprint(i, wave.bots)\nend\n',
  'local speed = 100\n\nlocal function step(dt: number)\n\tspeed = math.min(speed + dt * 15, 280)\n\treturn speed\nend\n\nprint(step(1))\n',
];

const GROUPS = {
  levels: '6256599c-a4d8-400f-a615-6d2ec4848335',
  buffs: 'eb4afba2-b363-451e-b1bf-4c5b6832f6e3',
  charges: '57878b05-1b9b-4ade-84ce-17e492d8abeb',
  other: '9900c3ae-e526-4080-887b-b3b3427d3051',
  flags: 'f93d2b68-f4d9-44b1-8176-f8f520a68da7',
};
const int = (name, group, def, min, max) => ({ id: 'p-' + name, name, group_id: group, type: 'int', default_value: def, min_value: min, max_value: max });
const bool = (name, group, def) => ({ id: 'p-' + name, name, group_id: group, type: 'bool', default_value: def, min_value: 0, max_value: 1 });
const PARAMETERS = [
  int('levelHitPoints', GROUPS.levels, 11, 1, 11),
  int('levelSkillWeapon', GROUPS.levels, 11, 1, 11),
  int('speedBuffPercent', GROUPS.buffs, 100, 0, 300),
  int('reloadBuffPercent', GROUPS.buffs, 100, 0, 300),
  bool('chargeUltiAutomatically', GROUPS.charges, 0),
  int('automaticTicks', GROUPS.charges, 20, 1, 60),
  int('botsDifficulty', GROUPS.other, 5, 0, 10),
  bool('disablePoison', GROUPS.flags, 0),
  bool('enableChat', GROUPS.flags, 1),
];

const WORDS = ['Low Gravity', 'Sudden Death', 'Super Lab', 'Glass Cannon', 'Pet Parade', 'Turtle Mode', 'Bot Gauntlet', 'Back to Basics', 'Poison Free', 'Level One', 'Speedrun', 'Sandbox', 'Hypercharge', 'Night Shift', 'Mirror Match', 'Slow Motion', 'Heist Rush', 'King of Hill'];

function seed() {
  const users = {
    'u-ada': { user_id: 'u-ada', name: 'Ada Lovelace', username: 'ada', password: 'correct horse', has_password: true, has_connect_email: false },
    'u-bob': { user_id: 'u-bob', name: 'Bob Example', username: 'bob', password: 'pw', has_password: true, has_connect_email: false },
    'u-kim': { user_id: 'u-kim', name: 'Kim Mori', username: 'kim', password: 'pw', has_password: true },
    'u-noor': { user_id: 'u-noor', name: 'Noor Haddad', username: 'noor', password: 'pw', has_password: true },
    'u-teo': { user_id: 'u-teo', name: 'Teo Marchetti', username: 'teo', password: 'pw', has_password: true, no_connect: true },
  };
  const scripts = {};
  const releases = {};
  const add = (id, name, author, updated, published, o = {}) => {
    scripts[id] = Object.assign({
      script_id: id, name, description: null, author_uuid: author,
      updated_at: ago(updated), published_at: published == null ? null : ago(published),
      user_map_id: null, content: CODE[Object.keys(scripts).length % CODE.length], revision: 1,
    }, o);
    releases[id] = [];
    if (published != null) {
      const n = o.revision || 1;
      for (let r = n; r >= 1; r--) releases[id].push({ revision: r, created_at: ago(published + (n - r) * 3), description: r === 1 ? 'First public release.' : null });
    }
  };
  // Ada's own: published, drafts, one with a map and a thumbnail.
  add('ada-trainer', 'Speedrun Trainer', 'u-ada', 0.4, 2, { description: 'Tight respawn timers and a split clock.', user_map_id: 'm-1', revision: 3 });
  add('ada-sandbox', 'Chill Sandbox', 'u-ada', 40, 40, { description: 'A calm ruleset, kept from before the API changed.' });
  add('ada-hyper', 'Hypercharge Party', 'u-ada', 0.05, null);
  add('ada-draft', 'New Script 4', 'u-ada', 4, null, { content: '' });
  add('ada-waves', 'Wave Runner', 'u-ada', 6, 5, { revision: 2 });
  // Everyone else's, published: enough to scroll.
  const others = ['u-bob', 'u-kim', 'u-noor', 'u-teo'];
  for (let i = 0; i < 44; i++) {
    const id = 'pub-' + String(i).padStart(2, '0');
    const name = `${WORDS[i % WORDS.length]}${i >= WORDS.length ? ' ' + (1 + Math.floor(i / WORDS.length)) : ''}`;
    add(id, name, others[i % others.length], 1 + i * 0.7, 1 + i * 0.7, { description: i % 3 ? 'Everyone floats and jump pads launch twice as far.' : null, revision: 1 + (i % 3) });
  }
  add('bob-draft', 'Bob Secret', 'u-bob', 1, null);

  // Holders: Ada's photo, and the thumbnail of one of her scripts.
  const face = png(96, 96, (x, y) => [40 + x, 90 + y, 200]);
  scripts['ada-face'] = {
    script_id: 'ada-face', name: 'pfp.meta', description: null, author_uuid: 'u-ada', updated_at: ago(10), published_at: ago(10),
    user_map_id: null, content: block('face', { v: 'f1', color: '5a8ad0', type: 'png' }, face), revision: 1,
  };
  const thumb = png(320, 180, (x, y) => [255 - (x >> 1), 120 + (y >> 2), 60 + (x >> 2)]);
  scripts['ada-trainer-thumb'] = {
    script_id: 'ada-trainer-thumb', name: 'Speedrun Trainer.meta.thumb', description: null, author_uuid: 'u-ada', updated_at: ago(3), published_at: ago(2),
    user_map_id: null, content: block('thumb', { for: 'ada-trainer', v: 't1', color: 'c08a70', type: 'png' }, thumb), revision: 1,
  };

  return {
    users,
    scripts,
    releases,
    favorites: { 'u-ada': ['pub-01', 'pub-04', 'pub-07', 'pub-10', 'ada-sandbox'], 'u-bob': [] },
    maps: {
      'm-1': { user_map_id: 'm-1', name: 'Canyon Loop', internal_id: '7Kq2mXw9:3', owner: 'u-ada' },
      'm-2': { user_map_id: 'm-2', name: 'Twin Rivers', internal_id: 'Rt81bVzP:1', owner: 'u-ada' },
    },
  };
}

/* ---------- Server ---------- */

function start(opts = {}) {
  const port = typeof opts === 'number' ? opts : opts.port || 0;
  let db = seed();
  let sessions = new Map(); // sid → user id
  let logins = 0;
  let failures = [];
  const calls = [];

  const byName = (name) => Object.values(db.users).find((u) => u.username === String(name).replace(/^@/, '').toLowerCase()) || null;
  const resolve = (id, self) => (id === 'me' ? self : db.users[id] || byName(id));
  const pub = (u) => u && { user_id: u.user_id, name: u.name, username: u.username };
  const me = (u) => ({ user_id: u.user_id, name: u.name, username: u.username, has_password: u.has_password, has_connect_email: !!u.has_connect_email });
  const item = (s, self) => ({
    script_id: s.script_id, name: s.name, description: s.description, author_uuid: s.author_uuid,
    author_name: db.users[s.author_uuid] ? db.users[s.author_uuid].name : 'Unknown',
    updated_at: s.updated_at, published_at: s.published_at,
    is_favorite: !!self && (db.favorites[self.user_id] || []).includes(s.script_id),
  });
  const begin = (u) => {
    const sid = crypto.randomBytes(12).toString('hex');
    sessions.set(sid, u.user_id);
    logins++;
    return `sid=${sid}; Path=/; Domain=scripting.nulls.gg; Max-Age=86400; HttpOnly; Secure; SameSite=None`;
  };
  const who = (req) => {
    const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '');
    const id = m && sessions.get(m[1]);
    return id ? db.users[id] || null : null;
  };
  const read = (req) => new Promise((done) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { done(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); } catch (e) { done(null); }
    });
  });

  async function control(req, res, name) {
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (name === 'state') return send(200, { logins, sessions: sessions.size, calls: calls.slice(-200) });
    if (req.method !== 'POST') return send(405, { error: 'POST' });
    const body = (await read(req)) || {};
    if (name === 'session') {
      const u = byName(body.username || 'ada');
      if (!u) return send(404, { error: 'no such user' });
      const cookie = begin(u);
      return send(200, { sid: /sid=([^;]+)/.exec(cookie)[1] });
    }
    if (name === 'expire') { sessions = new Map(); return send(200, { ok: true }); }
    if (name === 'fail') {
      failures.push({ path: new RegExp(body.path || '.'), method: body.method ? String(body.method).toUpperCase() : null, status: Number(body.status) || 0, times: body.times == null ? 1 : Number(body.times), delay: Number(body.delay) || 0 });
      return send(200, { ok: true, failures: failures.length });
    }
    if (name === 'clear') { failures = []; return send(200, { ok: true }); }
    if (name === 'many') {
      const u = byName(body.username || 'ada');
      const n = Math.min(500, Number(body.n) || 60);
      for (let i = 0; i < n; i++) {
        const id = `${u.username}-many-${i}`;
        db.scripts[id] = {
          script_id: id, name: `${WORDS[i % WORDS.length]} ${i + 1}`, description: i % 2 ? 'Everyone floats and jump pads launch twice as far.' : null,
          author_uuid: u.user_id, updated_at: ago(7 + i * 0.3), published_at: i % 3 ? ago(7 + i * 0.3) : null, user_map_id: null, content: CODE[i % CODE.length], revision: 1,
        };
        db.releases[id] = [];
      }
      return send(200, { ok: true, n });
    }
    if (name === 'reset') { db = seed(); sessions = new Map(); failures = []; logins = 0; calls.length = 0; return send(200, { ok: true }); }
    send(404, { error: 'unknown' });
  }

  async function api(req, res, url) {
    const p = url.pathname.replace(/^\/api/, '').split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch (e) { return s; } });
    const M = req.method;
    const data = M === 'GET' || M === 'HEAD' ? null : await read(req);
    let status = 0;
    const send = (code, json, headers) => {
      status = code;
      res.writeHead(code, Object.assign({ 'content-type': 'application/json' }, headers));
      res.end(json === undefined ? '' : JSON.stringify(json));
    };
    const err = (code, message) => send(code, { error: message || http.STATUS_CODES[code] || 'error' });
    const done = () => {
      calls.push(`${M} ${url.pathname}${url.search} ${status}`);
      if (calls.length > 1000) calls.splice(0, calls.length - 1000);
    };

    for (const f of failures) {
      if (f.times === 0 || !f.path.test(url.pathname) || (f.method && f.method !== M)) continue;
      if (f.times > 0) f.times--;
      if (f.delay) await new Promise((r) => setTimeout(r, f.delay));
      if (!f.status) {
        calls.push(`${M} ${url.pathname} dropped`);
        return void req.socket.destroy();
      }
      err(f.status, f.status >= 500 ? 'internal' : 'refused');
      return done();
    }
    failures = failures.filter((f) => f.times !== 0);

    try {
      route(p, M, data, url, req, send, err);
    } finally {
      done();
    }
  }

  function route(p, M, data, url, req, send, err) {
    if (p[0] === 'auth') {
      if (M !== 'POST') return err(405);
      if (p[1] === 'login') {
        const u = byName((data && data.username) || '');
        if (!u || u.password !== (data && data.password)) return err(401, 'invalid credentials');
        return send(200, {}, { 'set-cookie': [begin(u)] });
      }
      if (p[1] === 'register') {
        const name = String((data && data.username) || '').toLowerCase();
        if (!/^[a-z0-9_]{3,32}$/.test(name)) return err(400, 'invalid username');
        if (byName(name)) return err(409, 'username taken');
        const id = 'u-' + name;
        db.users[id] = { user_id: id, name: String((data && data.name) || name), username: name, password: String((data && data.password) || ''), has_password: true };
        db.favorites[id] = [];
        return send(201, {}, { 'set-cookie': [begin(db.users[id])] });
      }
      if (p[1] === 'logout') {
        const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '');
        if (m) sessions.delete(m[1]);
        return send(200, {}, { 'set-cookie': ['sid=; Path=/; Domain=scripting.nulls.gg; Max-Age=0; HttpOnly; Secure; SameSite=None'] });
      }
      return err(404);
    }

    const s0 = p[0] === 'scripts' ? db.scripts[p[1]] : null;
    // What the game client fetches with a share token needs no session.
    if (p[0] === 'scripts' && p[2] === 'content' && M === 'GET' && url.searchParams.get('token')) {
      return s0 ? send(200, { content: s0.content, revision: s0.revision }) : err(404, 'script not found');
    }
    const self = who(req);
    if (!self) return err(401, 'unauthorized');

    if (p[0] === 'users') {
      if (p[1] === 'me' && p.length === 2) return send(200, me(self));
      const u = resolve(p[1], self);
      if (!u) return err(404, 'user not found');
      if (p.length === 2) return send(200, pub(u));
      const own = self.user_id === u.user_id;
      if (p[2] === 'scripts') {
        return send(200, { scripts: Object.values(db.scripts).filter((s) => s.author_uuid === u.user_id && (own || s.published_at)).map((s) => item(s, self)) });
      }
      if (p[2] === 'favorites') {
        if (M === 'GET') return send(200, { scripts: (db.favorites[u.user_id] || []).map((id) => db.scripts[id]).filter(Boolean).map((s) => item(s, self)) });
        if (!own) return err(403, 'forbidden');
        const list = (db.favorites[u.user_id] = db.favorites[u.user_id] || []);
        const id = data && data.script_id;
        if (!db.scripts[id]) return err(404, 'script not found');
        const i = list.indexOf(id);
        if (M === 'POST' && i < 0) list.unshift(id);
        if (M === 'DELETE' && i >= 0) list.splice(i, 1);
        return send(200, {});
      }
      if (p[2] === 'maps') return send(200, { maps: Object.values(db.maps).filter((m) => m.owner === u.user_id).map((m) => ({ user_map_id: m.user_map_id, name: m.name, internal_id: m.internal_id })) });
      if (p[2] === 'password' && M === 'PUT') {
        if (!own) return err(403, 'forbidden');
        if (self.has_password && data && data.password !== self.password) return err(401, 'wrong password');
        self.password = String((data && data.new_password) || '');
        return send(200, {});
      }
      if (p[2] === 'audit') return err(403, 'forbidden');
      return err(404);
    }

    if (p[0] === 'scripts') {
      if (p.length === 1) {
        if (M === 'GET') return send(200, { scripts: Object.values(db.scripts).filter((s) => s.published_at).map((s) => item(s, self)) });
        if (M === 'POST') {
          const content = String((data && data.content) || '');
          if (content.length > 1000000) return err(400, 'content too long');
          const id = 's-' + crypto.randomBytes(5).toString('hex');
          db.scripts[id] = { script_id: id, name: String((data && data.name) || 'Untitled').slice(0, 32), description: null, author_uuid: self.user_id, updated_at: new Date().toISOString(), published_at: null, user_map_id: null, content, revision: 1 };
          db.releases[id] = [];
          return send(200, { script_id: id });
        }
        return err(405);
      }
      const id = p[1];
      const s = db.scripts[id];
      const visible = s && (s.published_at || s.author_uuid === self.user_id);
      if (!visible) return err(404, 'script not found');
      const owned = () => {
        if (s.author_uuid !== self.user_id) { err(403, 'forbidden'); return false; }
        return true;
      };
      const touched = () => { s.updated_at = new Date().toISOString(); };
      if (p.length === 2) {
        if (M === 'GET') {
          const map = s.user_map_id && db.maps[s.user_map_id];
          return send(200, Object.assign(item(s, self), { user_map_id: s.user_map_id || null, user_map_internal_id: map ? map.internal_id : null }));
        }
        if (M === 'DELETE') {
          if (!owned()) return;
          delete db.scripts[id];
          delete db.releases[id];
          for (const k of Object.keys(db.favorites)) db.favorites[k] = db.favorites[k].filter((x) => x !== id);
          return send(200, {});
        }
        return err(405);
      }
      switch (p[2]) {
        case 'content': {
          if (M === 'GET') {
            const rev = url.searchParams.get('revision');
            return send(200, { content: s.content, revision: rev ? Number(rev) : s.revision });
          }
          if (M !== 'PUT' || !owned()) return M === 'PUT' ? undefined : err(405);
          const text = String((data && data.content) || '');
          if (text.length > 1000000) return err(400, 'content too long');
          s.content = text;
          touched();
          return send(200, {});
        }
        case 'name':
          if (M !== 'PUT') return err(405);
          if (!owned()) return;
          if (!data || typeof data.name !== 'string' || data.name.length < 1 || data.name.length > 32) return err(400, 'invalid name');
          s.name = data.name;
          touched();
          return send(200, {});
        case 'description':
          if (M !== 'PUT' && M !== 'DELETE') return err(405);
          if (!owned()) return;
          s.description = M === 'DELETE' ? null : String((data && data.description) || '');
          touched();
          return send(200, {});
        case 'map':
          if (M !== 'PUT') return err(405);
          if (!owned()) return;
          s.user_map_id = (data && data.user_map_id) || null;
          touched();
          return send(200, {});
        case 'publish': {
          if (M !== 'POST') return err(405);
          if (!owned()) return;
          if (s.published_at) s.revision += 1;
          s.published_at = s.updated_at = new Date().toISOString();
          (db.releases[id] = db.releases[id] || []).unshift({ revision: s.revision, created_at: s.published_at, description: null });
          return send(200, { uuid: id });
        }
        case 'parameters':
          return send(200, { parameters: PARAMETERS.map((x) => Object.assign({}, x)) });
        case 'releases':
          return send(200, { releases: (db.releases[id] || []).slice() });
        case 'share': {
          if (M !== 'POST') return err(405);
          const author = db.users[s.author_uuid];
          if (author && author.no_connect) return err(403, 'author does not have connect');
          return send(200, { token: crypto.randomBytes(8).toString('hex') });
        }
        default:
          return err(404);
      }
    }

    if (p[0] === 'maps') {
      if (p.length === 1 && M === 'POST') {
        const id = 'm-' + crypto.randomBytes(3).toString('hex');
        db.maps[id] = { user_map_id: id, name: String((data && data.name) || 'Map'), internal_id: String((data && data.map_internal_id) || ''), owner: self.user_id };
        const m = db.maps[id];
        return send(200, { user_map: { user_map_id: m.user_map_id, name: m.name, internal_id: m.internal_id } });
      }
      const m = db.maps[p[1]];
      if (!m) return err(404, 'map not found');
      if (m.owner !== self.user_id) return err(403, 'forbidden');
      if (p.length === 2 && M === 'PATCH') { m.internal_id = String((data && data.map_internal_id) || m.internal_id); return send(200, {}); }
      if (p.length === 2 && M === 'DELETE') {
        delete db.maps[p[1]];
        for (const s of Object.values(db.scripts)) if (s.user_map_id === p[1]) s.user_map_id = null;
        return send(200, {});
      }
      if (p.length === 3 && p[2] === 'name' && M === 'PUT') { m.name = String((data && data.name) || m.name); return send(200, {}); }
      return err(404);
    }
    return err(404);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://mock');
    if (url.pathname.startsWith('/_mock/')) return void control(req, res, url.pathname.slice(7));
    if (url.pathname.startsWith('/api/')) return void api(req, res, url);
    res.writeHead(404);
    res.end();
  });

  return new Promise((done, fail) => {
    server.on('error', fail);
    server.listen(port, '127.0.0.1', () => {
      const p = server.address().port;
      done({
        port: p,
        url: `http://127.0.0.1:${p}`,
        close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(() => r()); }),
      });
    });
  });
}

module.exports = { start, png };

if (require.main === module) {
  start(Number(process.argv[2]) || 5290).then((m) => console.log(`mock upstream → ${m.url}/api`));
}
