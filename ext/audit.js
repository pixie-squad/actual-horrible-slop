/*
  Audit log (mounted at /x/audit).

  The upstream keeps an audit log of its own, but it cannot be relied on. So every
  successful change that passes through the proxy is also written down here, per
  user, and the two are merged when the log is read.

    GET /x/audit/users/<userId>   that user only ("me" works)
      → { events: [{ occurred_at, actor_id, target_id, event_type, changes, metadata }],
          upstream: "ok" | "unavailable" }
    Newest first, at most 500. "ok" when the upstream answered with a list of events,
    which are then merged in: an upstream event and one of ours with the same type and
    target a few seconds apart are one event, and the upstream's copy is the one kept.

  Events written here, with what target_id is:
    UserRegister, UserLogin, UserLogout, UserPasswordChange      the user
    ScriptCreate, ScriptDelete                                   the script
    ScriptPublish    changes: { revision } when it could be read back
    ScriptUpdate     changes: { content | name | description | map: true, count }
    FavoriteAdd, FavoriteRemove                                  the script
    MapCreate, MapDelete                                         the map
    MapUpdate        changes: { name | map_internal_id: true }

  The editor saves about once a second while typing, so an update to the same field
  of a script joins the newest event about that script when it is an update of that
  field begun less than ten minutes before: occurred_at becomes the latest save,
  changes.count goes up, and metadata.since keeps when it began.

  Never written: passwords, cookies, script content. Each user's newest 1000 events
  live in NT_DATA/audit/<userId>.json, changed by one write at a time per user.
*/
'use strict';

const core = require('./core');

const { HttpError, store } = core;

const KEEP = 1000;                  // events kept per user
const ANSWER = 500;                 // events in one answer
const JOIN_WINDOW = 10 * 60 * 1000; // saves within this of the first join its event
const SAME_WINDOW = 5000;           // our copy and the upstream's of one event
const UPSTREAM_TIMEOUT = 4000;
const CACHED_LOGS = 50;             // users whose log stays in memory
const SESSION_MEMORY = 5000;
const DAY = 24 * 60 * 60 * 1000;

const TYPES = [
  'UserRegister', 'UserLogin', 'UserLogout', 'UserPasswordChange',
  'ScriptCreate', 'ScriptUpdate', 'ScriptPublish', 'ScriptDelete',
  'FavoriteAdd', 'FavoriteRemove',
  'MapCreate', 'MapUpdate', 'MapDelete',
];

// Script fields the app changes, and the methods that change them.
const SCRIPT_FIELDS = new Map([['content', ['PUT']], ['name', ['PUT']], ['description', ['PUT', 'DELETE']], ['map', ['PUT']]]);

/* ---------- What a call was ---------- */

// The path after /api, decoded; null when it does not decode.
function segments(apiPath) {
  try { return apiPath.split('/').slice(2).filter(Boolean).map(decodeURIComponent); } catch (e) { return null; }
}

// What a successful call did, as { type, target, field, self, signIn, endsSession }, or
// null when it is not something the log records. `self` means the target is the actor.
function describe(event, s) {
  const M = event.method;
  const [a, b, c] = s;
  const n = s.length;
  if (a === 'auth' && n === 2 && M === 'POST') {
    if (b === 'login') return { type: 'UserLogin', self: true, signIn: true };
    if (b === 'register') return { type: 'UserRegister', self: true, signIn: true };
    if (b === 'logout') return { type: 'UserLogout', self: true, endsSession: true };
  }
  if (a === 'users' && n === 3) {
    if (c === 'password' && M === 'PUT') return { type: 'UserPasswordChange', self: true, endsSession: true };
    if (c === 'favorites' && (M === 'POST' || M === 'DELETE')) {
      return { type: M === 'POST' ? 'FavoriteAdd' : 'FavoriteRemove', target: event.body && event.body.script_id };
    }
  }
  if (a === 'scripts') {
    if (n === 1 && M === 'POST') return { type: 'ScriptCreate', target: event.json && event.json.script_id };
    if (n === 2 && M === 'DELETE') return { type: 'ScriptDelete', target: b };
    if (n === 3 && c === 'publish' && M === 'POST') return { type: 'ScriptPublish', target: b };
    if (n === 3 && SCRIPT_FIELDS.has(c) && SCRIPT_FIELDS.get(c).includes(M)) return { type: 'ScriptUpdate', target: b, field: c };
  }
  if (a === 'maps') {
    const created = event.json && event.json.user_map;
    if (n === 1 && M === 'POST') return { type: 'MapCreate', target: created && created.user_map_id };
    if (n === 2 && M === 'PATCH') return { type: 'MapUpdate', target: b, field: 'map_internal_id' };
    if (n === 2 && M === 'DELETE') return { type: 'MapDelete', target: b };
    if (n === 3 && c === 'name' && M === 'PUT') return { type: 'MapUpdate', target: b, field: 'name' };
  }
  return null;
}

/* ---------- Who did it ---------- */

// Who each Cookie header belonged to (by hash), for the calls after which the
// upstream may no longer say: a logout or a password change.
const known = new Map();

function remember(cookie, userId) {
  if (!cookie) return;
  const key = core.sha256(cookie);
  known.delete(key);
  known.set(key, { userId, at: Date.now() });
  if (known.size > SESSION_MEMORY) known.delete(known.keys().next().value);
}

function recall(cookie) {
  const hit = cookie ? known.get(core.sha256(cookie)) : null;
  return hit && Date.now() - hit.at < DAY ? hit.userId : null;
}

async function sessionOf(cookie) {
  try { return await core.session(cookie || ''); } catch (e) { return null; }
}

// The Cookie header the browser sends once it has taken these Set-Cookie headers:
// replaced cookies keep their place, new ones go last, expired ones go.
function afterSetCookie(header, setCookie) {
  const jar = new Map();
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) jar.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  for (const line of setCookie || []) {
    const [pair, ...attrs] = String(line).split(';');
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    const name = pair.slice(0, i).trim();
    const gone = attrs.some((attr) => {
      const [k, v = ''] = attr.split('=').map((x) => x.trim());
      if (/^max-age$/i.test(k)) return Number(v) <= 0;
      if (/^expires$/i.test(k)) return Date.parse(v) <= Date.now();
      return false;
    });
    if (gone) jar.delete(name);
    else jar.set(name, pair.slice(i + 1).trim());
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

/* ---------- Per-user logs ---------- */

const logs = new Map();   // userId → events, newest first; the users seen last
const queues = new Map(); // userId → the last job queued on that log
const logFile = (userId) => store.path('audit', `${userId}.json`);

const isEvent = (e) => !!e && typeof e === 'object' && typeof e.event_type === 'string' && typeof e.occurred_at === 'string';
const time = (e) => Date.parse(e.occurred_at) || 0;

// Runs job(events) on a user's log, one job at a time per user. A job that throws
// leaves the log to be read from disk again, so memory never runs ahead of it.
function withLog(userId, job) {
  const run = (queues.get(userId) || Promise.resolve()).then(async () => {
    let events = logs.get(userId);
    if (!events) {
      const saved = await store.readJson(logFile(userId), []);
      events = Array.isArray(saved) ? saved.filter(isEvent) : [];
    }
    logs.delete(userId);
    logs.set(userId, events);
    if (logs.size > CACHED_LOGS) logs.delete(logs.keys().next().value);
    try {
      return await job(events);
    } catch (e) {
      logs.delete(userId);
      throw e;
    }
  });
  const tail = run.catch(() => {});
  queues.set(userId, tail);
  tail.then(() => { if (queues.get(userId) === tail) queues.delete(userId); });
  return run;
}

// Puts an event in its place, newest first, joining it to the update it continues.
function add(events, ev, field) {
  const t = time(ev);
  if (field && ev.event_type === 'ScriptUpdate') {
    const i = events.findIndex((x) => x.target_id === ev.target_id);
    const last = events[i];
    const since = last && Date.parse((last.metadata && last.metadata.since) || last.occurred_at);
    if (last && last.event_type === 'ScriptUpdate' && last.changes && last.changes[field] === true && t - since < JOIN_WINDOW) {
      events.splice(i, 1);
      last.changes.count = (Number(last.changes.count) || 1) + 1;
      if (t > time(last)) last.occurred_at = ev.occurred_at;
      ev = last;
    }
  }
  // Calls can finish out of order; one that happened earlier goes below the later ones.
  const at = time(ev);
  let i = 0;
  while (i < events.length && time(events[i]) > at) i++;
  events.splice(i, 0, ev);
  if (events.length > KEEP) events.length = KEEP;
}

function append(userId, ev, field) {
  return withLog(userId, (events) => {
    add(events, ev, field);
    return store.writeJson(logFile(userId), events);
  });
}

// The newest revision of a script, read back after a publish; null when unknown.
async function revisionOf(cookie, scriptId) {
  try {
    const res = await core.upstream('GET', `/api/scripts/${encodeURIComponent(scriptId)}/releases`, { cookie, timeout: UPSTREAM_TIMEOUT });
    const list = res.status === 200 && res.json && Array.isArray(res.json.releases) ? res.json.releases : [];
    let best = null;
    for (const r of list) if (r && Number.isSafeInteger(r.revision) && (best === null || r.revision > best)) best = r.revision;
    return best;
  } catch (e) {
    return null;
  }
}

async function observe(event, what, at) {
  const cookie = event.req.headers.cookie;
  let actor = null;
  if (what.signIn) {
    // The caller had no session yet: it is in the cookies this response set.
    const next = afterSetCookie(cookie, event.setCookie);
    const user = next ? await sessionOf(next) : null;
    if (user && core.isId(user.user_id)) {
      actor = user.user_id;
      remember(next, actor);
    }
  } else {
    const user = await sessionOf(cookie);
    if (user && core.isId(user.user_id)) {
      actor = user.user_id;
      remember(cookie, actor);
    } else {
      actor = recall(cookie);
    }
  }
  if (what.endsSession) core.forgetSession(cookie);
  if (what.type === 'UserLogout' && cookie) known.delete(core.sha256(cookie));
  if (!actor) return;

  const target = what.self ? actor : what.target;
  if (!core.isId(target)) return;
  const occurred = new Date(at).toISOString();
  const ev = { occurred_at: occurred, actor_id: actor, target_id: target, event_type: what.type, changes: {}, metadata: {} };
  if (what.field) ev.changes[what.field] = true;
  if (what.type === 'ScriptUpdate') {
    ev.changes.count = 1;
    ev.metadata.since = occurred;
  }
  await append(actor, ev, what.field);
  // Written down first and completed after, so the extra round trip cannot let a later
  // save land before the publish and join an update from before it.
  if (what.type === 'ScriptPublish') {
    const revision = await revisionOf(cookie, target);
    if (revision === null) return;
    await withLog(actor, (events) => {
      const same = events.find((e) => e.event_type === ev.event_type && e.target_id === target && e.occurred_at === occurred);
      if (!same) return;
      same.changes.revision = revision;
      return store.writeJson(logFile(actor), events);
    });
  }
}

/* ---------- Reading ---------- */

const pick = (e) => ({
  occurred_at: e.occurred_at, actor_id: e.actor_id, target_id: e.target_id,
  event_type: e.event_type, changes: e.changes, metadata: e.metadata,
});

// The upstream's events for this user, or null when it does not give a list.
async function upstreamEvents(req, userId) {
  try {
    const res = await core.upstream('GET', `/api/users/${encodeURIComponent(userId)}/audit`, { cookie: req.headers.cookie, timeout: UPSTREAM_TIMEOUT });
    if (res.status !== 200 || !res.json || !Array.isArray(res.json.events)) return null;
    return res.json.events.filter(isEvent).map(pick);
  } catch (e) {
    return null;
  }
}

// Ours and theirs, each of ours that the upstream also has paired off and left out.
function merge(ours, theirs) {
  const key = (e) => `${e.event_type}\n${e.target_id}`;
  const pool = new Map();
  for (const e of theirs) {
    if (!pool.has(key(e))) pool.set(key(e), []);
    pool.get(key(e)).push(time(e));
  }
  const kept = ours.filter((e) => {
    const times = pool.get(key(e));
    const i = times ? times.findIndex((t) => Math.abs(t - time(e)) <= SAME_WINDOW) : -1;
    if (i < 0) return true;
    times.splice(i, 1);
    return false;
  });
  return theirs.concat(kept).sort((x, y) => time(y) - time(x));
}

module.exports = {
  name: 'audit',

  async handle(req, res, url, parts) {
    if (parts.length !== 2 || parts[0] !== 'users') return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method-not-allowed');
    const id = parts[1];
    if (!core.isId(id)) throw new HttpError(400, 'bad-id');
    core.requireRate('audit-read', req, 60, 60 * 1000);
    const user = await core.requireUser(req);
    if (id !== 'me' && id !== user.user_id) throw new HttpError(403, 'forbidden');
    if (!core.isId(user.user_id)) throw new HttpError(404, 'not-found');
    remember(req.headers.cookie, user.user_id);
    const [ours, theirs] = await Promise.all([
      withLog(user.user_id, (events) => events.map(pick)),
      upstreamEvents(req, user.user_id),
    ]);
    const events = theirs ? merge(ours, theirs) : ours;
    core.send(res, 200, { events: events.slice(0, ANSWER), upstream: theirs ? 'ok' : 'unavailable' });
  },

  onApi(event) {
    if (event.status < 200 || event.status >= 300) return;
    const s = segments(event.path);
    const what = s && describe(event, s);
    if (what) return observe(event, what, Date.now());
  },

  info() {
    return { events: TYPES.slice() };
  },
};
