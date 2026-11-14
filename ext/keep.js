/*
  Remember Me: staying signed in past the upstream's session, which lasts a day.

  The upstream signs in by password and has nothing to renew a session with, so
  staying signed in means signing in again, and that takes the password. It is kept
  so that no one place has it:

    - The browser holds it sealed (AES-256-GCM), in a cookie its pages cannot read
      (HttpOnly) and that it sends here and nowhere else (Path=/x/keep, so neither
      the upstream nor another extension is ever shown it).
    - This server holds the key, in memory, and not one sealed copy.

  Nothing is stored here, and what a break-in here finds is a key with nothing to
  open: only the copies of whoever comes back while it lasts, as it would see anyone
  who typed a password meanwhile. A browser's copy without the key is noise.

    NT_KEEP_KEY   the secret the key is made from, 32 characters or more. Without it
                  a new key is made each start: restarting forgets everyone, who then
                  sign in again. Changing it does the same.

    POST /x/keep/login      { username, password }        sign in and remember
    POST /x/keep/register   { name, username, password }  create an account and remember
    POST /x/keep/refresh    sign in again from the sealed copy
    POST /x/keep/forget     drop the sealed copy

  The first two answer as the upstream did, with its session cookie, and say
  "x-nt-kept: 1" when the sealed copy went with it. A copy lasts 30 days from its
  last use and 180 from when the password was typed. refresh answers 401 "forgotten"
  and drops the copy when it cannot be used any more: run out, sealed with another
  key, or the upstream no longer takes what is in it.
*/
'use strict';

const crypto = require('crypto');
const core = require('./core');

const COOKIE = 'nt_keep';
const PATH = '/x/keep';
const DAY = 24 * 3600 * 1000;
const IDLE = 30 * DAY;
const MOST = 180 * DAY;
const COOKIE_MAX = 3800; // a browser takes about 4096 for a whole cookie

const KEY = (() => {
  const secret = (process.env.NT_KEEP_KEY || '').trim();
  if (!secret) return crypto.randomBytes(32);
  if (secret.length < 32) throw new Error('NT_KEEP_KEY needs 32 characters or more');
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'nt-keep', 'seal/1', 32));
})();
// A copy is good for the upstream it was made for, and for this way of sealing.
const BOUND = Buffer.from('nt-keep/1 ' + core.UPSTREAM.origin);

/* ---------- Sealing ---------- */

// o: { u, p, t (when the password was typed), x (when this copy runs out) }
function seal(o) {
  // Padded to a step of 128 bytes, so its length says little about the password's.
  const bare = Buffer.byteLength(JSON.stringify(Object.assign({}, o, { _: '' })));
  const text = JSON.stringify(Object.assign({}, o, { _: ' '.repeat((128 - (bare % 128)) % 128) }));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  cipher.setAAD(BOUND);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return 'v1.' + Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url');
}

// → what was sealed, or null for anything that is not a copy still good now.
function unseal(value) {
  try {
    if (typeof value !== 'string' || !value.startsWith('v1.')) return null;
    const raw = Buffer.from(value.slice(3), 'base64url');
    if (raw.length < 12 + 16 + 1) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12));
    decipher.setAAD(BOUND);
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    const text = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString('utf8');
    const o = JSON.parse(text);
    const now = Date.now();
    if (!o || typeof o.u !== 'string' || typeof o.p !== 'string' || !(o.x > now) || !(o.t + MOST > now)) return null;
    return o;
  } catch (e) {
    return null;
  }
}

/* ---------- The cookie ---------- */

function held(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}

// Over HTTPS the copy travels over nothing else. The page's own address says which it
// is: this server may be behind something that ends TLS for it.
function secure(req) {
  try {
    if (req.headers.origin) return new URL(req.headers.origin).protocol === 'https:';
  } catch (e) { /* no telling from that */ }
  return !!req.socket.encrypted || /^https\b/i.test(String(req.headers['x-forwarded-proto'] || ''));
}

const cookie = (req, value, age) =>
  `${COOKIE}=${value}; Path=${PATH}; Max-Age=${age}; HttpOnly; SameSite=Strict${secure(req) ? '; Secure' : ''}`;
const dropped = (req) => cookie(req, '', 0);

// The sealed copy as a cookie, or null when it would not fit in one.
function kept(req, username, password, typed) {
  const now = Date.now();
  const value = seal({ u: username, p: password, t: typed || now, x: now + IDLE });
  return value.length > COOKIE_MAX ? null : cookie(req, value, Math.round(IDLE / 1000));
}

/* ---------- Signing in ---------- */

async function signIn(req, path, body) {
  try {
    return await core.upstream('POST', path, { body, agent: req.headers['user-agent'] });
  } catch (e) {
    throw new core.HttpError(502, 'upstream-unavailable');
  }
}

const passed = (up) => up.status >= 200 && up.status < 300;
const session = (up) => (up.headers['set-cookie'] || []).map(core.localCookie);
const text = (v, most) => typeof v === 'string' && v.length > 0 && v.length <= most;

// Signs in or registers as asked, and hands the answer on with the sealed copy.
async function enter(req, res, path, fields) {
  core.requireRate('keep-enter', req, 10, 60000);
  const given = await core.readJson(req, 8192);
  const body = {};
  for (const name of fields) {
    if (!text(given[name], 2048)) throw new core.HttpError(400, 'bad-request');
    body[name] = given[name];
  }
  const up = await signIn(req, path, body);
  const cookies = session(up);
  const headers = {};
  if (passed(up) && cookies.length) {
    const mine = kept(req, body.username, body.password);
    if (mine) {
      cookies.push(mine);
      headers['x-nt-kept'] = '1';
    }
  }
  if (cookies.length) headers['set-cookie'] = cookies;
  core.send(res, up.status, up.json, headers);
}

async function refresh(req, res) {
  core.requireRate('keep-refresh', req, 20, 60000);
  const forgotten = () => core.send(res, 401, { error: 'forgotten' }, { 'set-cookie': [dropped(req)] });
  const o = unseal(held(req));
  if (!o) return forgotten();
  const up = await signIn(req, '/api/auth/login', { username: o.u, password: o.p });
  const cookies = session(up);
  if (passed(up) && cookies.length) {
    const mine = kept(req, o.u, o.p, o.t);
    if (mine) cookies.push(mine);
    return core.send(res, 200, { ok: true }, { 'set-cookie': cookies });
  }
  // Busy or broken is not "no": the copy stays for another try.
  if (up.status === 429) throw new core.HttpError(429, 'slow-down');
  if (passed(up) || up.status >= 500) throw new core.HttpError(502, 'upstream-unavailable');
  forgotten();
}

module.exports = {
  name: 'keep',
  async handle(req, res, url, parts) {
    if (parts.length !== 1) return false;
    const routes = {
      login: () => enter(req, res, '/api/auth/login', ['username', 'password']),
      register: () => enter(req, res, '/api/auth/register', ['name', 'username', 'password']),
      refresh: () => refresh(req, res),
      forget: () => core.send(res, 204, null, { 'set-cookie': [dropped(req)] }),
    };
    if (!Object.prototype.hasOwnProperty.call(routes, parts[0])) return false;
    if (req.method !== 'POST') throw new core.HttpError(405, 'method-not-allowed');
    return routes[parts[0]]();
  },
};
