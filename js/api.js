/*
  Data layer with two interchangeable backends.

  live – the scripting.nulls.gg API, reached through the local proxy in
         server.js (same endpoints and payloads the original site uses).
  demo – an in-browser store seeded from data.js and saved to localStorage.

  Pages only ever call NT.api.*, so they behave the same on either. Behind the local
  server the app is live, signed in or not; the sample data is what there is without
  that server, and otherwise only what someone asks to look around in (demoSignIn).

  The local server keeps nothing. What the app adds to the service is kept in the
  service's own scripts or in this browser:

  - A script's project mark is a block after its code (pack.js). scriptContent hands
    back the code alone and saveContent puts the blocks back, so nothing else ever
    sees them.
  - A profile photo, a script's thumbnail and a project's source files live in
    holders: scripts of the user's own that exist only to hold them, told apart by
    name (pfp.meta, <script>.meta.thumb, <script>.meta.<n>) and left out of every
    list handed to a page. A script's own 1,000,000 characters are all its code's.
  - The audit log of what was done from this browser is in localStorage.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { store, wait, uid, debounce } = NT.util;
  const Pack = NT.pack;
  const LIMIT = Pack.LIMIT;

  const LIVE_BASE = '/api';
  const UPSTREAM_API = 'https://scripting.nulls.gg/api';
  const DEMO_KEY = 'nt.demo.v3';
  // Scripts released before this date predate a breaking change in the scripting API.
  const API_BREAK = new Date('2026-09-16T00:00:00');

  const GROUP_LABELS = {
    '6256599c-a4d8-400f-a615-6d2ec4848335': 'Upgrade Levels',
    'eb4afba2-b363-451e-b1bf-4c5b6832f6e3': 'Multipliers and Buffs',
    '57878b05-1b9b-4ade-84ce-17e492d8abeb': 'Automatic Charges',
    '9900c3ae-e526-4080-887b-b3b3427d3051': 'Other Values',
    'f93d2b68-f4d9-44b1-8176-f8f520a68da7': 'Flags',
    '98e6016e-7189-4fbf-bccc-7c9bc5833ddb': 'Brawler Abilities',
    'b964b647-1834-4414-b4a3-e86b0a3c58f6': 'Items Drop',
  };

  const PARAM_LABELS = {
    levelHitPoints: 'Hit points level',
    levelSkillWeapon: 'Attack level',
    levelSkillUlti: 'Super level',
    levelServer: 'Battle level',
    speedBuffPercent: 'Movement speed',
    reloadBuffPercent: 'Reload speed',
    chargeUltiPercent: 'Super charge',
    chargeUltiAutomatically: 'Charge super',
    chargeOverchargeAutomatically: 'Charge hypercharge',
    automaticTicks: 'Periodicity',
    accessoryCooldownSubtractPercent: 'Gadgets cooldown',
    additionalPetsCount: 'Additional pets',
    poisonDamagePercent: 'Poison damage',
    regenerationHeroPercent: 'Health regeneration',
    botsDifficulty: 'Bots AI strength',
    respawnShieldExpandSeconds: 'Respawn shield duration',
    clientSpawnOffset: 'Base player spawn point',
    disablePoison: 'Disable poison completely',
    disablePoisonProgression: 'Disable progressive poison damage',
    restrictTeamJoin: 'Restrict joining the room',
    viewSelection: 'Show all selected brawlers',
    allowSelfKill: 'Allow early exit from battle',
    enableChat: 'Show chat during the battle',
    hasGadgets: 'Allow gadgets',
    hasStarPowers: 'Allow star powers',
    hasOvercharges: 'Allow hypercharges',
    gearsAmount: 'Number of gears',
    hasBuddyGadgets: 'Allow buffies for gadgets',
    hasBuddyStarPowers: 'Allow buffies for star powers',
    hasBuddyOvercharges: 'Allow buffies for hypercharges',
    boxPowerPoints: 'Showdown buffs from boxes',
    characterPowerPointsRate: 'Showdown buffs from brawlers',
  };

  // Order and offsets the game client expects for battle parameters in a room link.
  const BATTLE_PARAMS = [
    ['08d59fd7-b5ba-41c0-ac91-0ec36ad2fda7', 11], ['27debbd9-1800-453b-98cb-778faebf03ec', 11],
    ['850fa2e7-b6a8-4f65-a4d7-15e730772380', 11], ['0118efa9-4916-4258-896d-08d8fa6cb447', 11],
    ['67308acc-a26a-423d-9bd4-0a483aaddc16', 100], ['ef7f2daf-ecb6-4b45-b54a-05be2abf3028', 100],
    ['27df50dd-9b42-480b-ba29-252cb5b7d390', 0], ['d406daa9-299a-4c1f-8e38-7c0b7447f0e3', 0],
    ['588e2a5d-b1da-4ab1-af06-90fbf82ad845', 0], ['06e2388f-caee-4434-a2b5-729b837d0c63', 100],
    ['4a66586c-2d0e-48b8-b7a8-82dbd31f60ba', 0], ['9984be89-1a06-469a-b6e4-4fb9cf6fdcc6', 20],
    ['90c21bbe-dfd4-4bf0-b0a8-26f5a9c193e5', 0], ['19c252fe-337b-4830-b42b-831ccb1fd019', 0],
    ['7425f7c2-3a70-4655-8a55-aa6e40b55cac', 0], ['a3526238-44ab-4465-b338-a26a0bac9009', 3],
    ['0f1e4985-d6f2-4acc-8629-bc052fae5df9', 0], ['3b448328-99e4-4c63-ac08-1a6144299386', 0],
    ['2793b21b-a1b2-47e6-a777-7dde43388332', 0], ['6c60b2c1-90df-4ed6-9d65-f72cb3df959c', 0],
    ['5e9dfbe2-dc36-4492-b2f7-163b2b61b507', 0], ['3e4e283d-0950-4d29-9694-0b788c6f2151', 0],
    ['a709ece0-ff74-4271-acae-9fdb0b6edb86', 0], ['6dfa1632-da82-4c48-9028-83b11729396a', 0],
    ['afc1c68c-34f3-4808-ad44-4d0019fa2a7c', 0], ['9f654a06-ff46-4150-8313-eb602e245103', 0],
    ['5ba9cf79-aa86-4979-9c60-c3fff5f5503f', 0], ['13d8a58d-aa94-483a-8423-20da88dac86a', 0],
    ['b464565d-f0c7-4f0d-a178-3cfeaf0bb6dd', 0], ['5a35d6df-3180-4ea0-bb9d-554eae8071cb', 0],
    ['e8798ee0-3ced-4863-ae18-9c64d49ea7d2', 0], ['e42bf28e-fb71-473e-a90c-e8181a1caf2c', 0],
  ];

  class StatusError extends Error {
    constructor(status, message) {
      super(message || `Request failed (${status})`);
      this.name = 'StatusError';
      this.status = status;
    }
  }

  /* ---------- Live backend ---------- */

  // opts: { method, body (sent as JSON), timeout, quiet }. A change is written to the
  // audit log unless it is quiet: the app's own bookkeeping, not something the person did.
  async function live(path, opts = {}) {
    const init = { method: opts.method || 'GET', credentials: 'include', headers: {} };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    let timer = 0;
    if (opts.timeout) {
      const ctrl = new AbortController();
      init.signal = ctrl.signal;
      timer = setTimeout(() => ctrl.abort(), opts.timeout);
    }
    let res, text;
    try {
      res = await fetch(LIVE_BASE + path, init);
      text = await res.text();
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON body */ }
    if (!res.ok) throw new StatusError(res.status, data && data.error);
    if (init.method !== 'GET' && !opts.quiet) noted(init.method, path, opts.body, data);
    return data;
  }

  const at = (id) => '/scripts/' + encodeURIComponent(id);

  /* ---------- Audit log (live) ----------
     The upstream's own log cannot be relied on, so every change made from this
     browser is written down here, per user: the newest 1000 events, in localStorage
     under nt.audit.<userId>. Never written: passwords, script content.

       UserRegister, UserLogin, UserLogout, UserPasswordChange      target: the user
       ScriptCreate, ScriptDelete, FavoriteAdd, FavoriteRemove      the script
       ScriptPublish    changes: { revision } when it could be read back
       ScriptUpdate     changes: { content | name | description | map: true, count }
       MapCreate, MapDelete                                         the map
       MapUpdate        changes: { name | map_internal_id: true }

     The editor saves about once a second while typing, so an update to the same field
     of a script joins the newest event about that script when it is an update of that
     field begun less than ten minutes before: occurred_at becomes the latest save,
     changes.count goes up, and metadata.since keeps when it began. */

  const AUDIT_KEEP = 1000;
  const AUDIT_ANSWER = 500;
  const JOIN_WINDOW = 10 * 60 * 1000;
  const SAME_WINDOW = 5000; // our copy and the upstream's of one event
  const SCRIPT_FIELDS = { content: ['PUT'], name: ['PUT'], description: ['PUT', 'DELETE'], map: ['PUT'] };

  const auditKey = (userId) => 'nt.audit.' + userId;
  const isEvent = (e) => !!e && typeof e === 'object' && typeof e.event_type === 'string' && typeof e.occurred_at === 'string';
  const when = (e) => Date.parse(e.occurred_at) || 0;

  function logged(userId) {
    const saved = store.get(auditKey(userId), []);
    return Array.isArray(saved) ? saved.filter(isEvent) : [];
  }

  // What a successful call did, as { type, target, field, self }, or null when it is
  // not something the log records. `self` means the target is whoever is signed in.
  function describe(method, path, body, data) {
    let s;
    try { s = path.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent); } catch (e) { return null; }
    const [a, b, c] = s;
    const n = s.length, M = method;
    if (a === 'users' && n === 3) {
      if (c === 'password' && M === 'PUT') return { type: 'UserPasswordChange', self: true };
      if (c === 'favorites' && (M === 'POST' || M === 'DELETE')) return { type: M === 'POST' ? 'FavoriteAdd' : 'FavoriteRemove', target: body && body.script_id };
    }
    if (a === 'scripts') {
      if (n === 1 && M === 'POST') return { type: 'ScriptCreate', target: data && data.script_id };
      if (n === 2 && M === 'DELETE') return { type: 'ScriptDelete', target: b };
      if (n === 3 && c === 'publish' && M === 'POST') return { type: 'ScriptPublish', target: b };
      if (n === 3 && SCRIPT_FIELDS[c] && SCRIPT_FIELDS[c].includes(M)) return { type: 'ScriptUpdate', target: b, field: c };
    }
    if (a === 'maps') {
      const made = data && data.user_map;
      if (n === 1 && M === 'POST') return { type: 'MapCreate', target: made && made.user_map_id };
      if (n === 2 && M === 'PATCH') return { type: 'MapUpdate', target: b, field: 'map_internal_id' };
      if (n === 2 && M === 'DELETE') return { type: 'MapDelete', target: b };
      if (n === 3 && c === 'name' && M === 'PUT') return { type: 'MapUpdate', target: b, field: 'name' };
    }
    return null;
  }

  // Writes an event down for whoever is signed in. → the event as kept, or null.
  function log(type, target, field) {
    const me = api.session && api.session.user_id;
    if (!me || !target) return null;
    const occurred = new Date().toISOString();
    let ev = { occurred_at: occurred, actor_id: me, target_id: String(target), event_type: type, changes: {}, metadata: {} };
    if (field) ev.changes[field] = true;
    const events = logged(me);
    if (type === 'ScriptUpdate') {
      ev.changes.count = 1;
      ev.metadata.since = occurred;
      const i = events.findIndex((x) => x.target_id === ev.target_id);
      const last = events[i];
      const since = last && Date.parse((last.metadata && last.metadata.since) || last.occurred_at);
      if (field && last && last.event_type === type && last.changes && last.changes[field] === true && Date.now() - since < JOIN_WINDOW) {
        events.splice(i, 1);
        last.changes.count = (Number(last.changes.count) || 1) + 1;
        last.occurred_at = occurred;
        ev = last;
      }
    }
    events.unshift(ev);
    if (events.length > AUDIT_KEEP) events.length = AUDIT_KEEP;
    store.set(auditKey(me), events);
    return ev;
  }

  // The revision a publish made, read back and added to its event.
  async function revised(ev) {
    try {
      const list = (await live(at(ev.target_id) + '/releases')).releases;
      let best = null;
      for (const r of Array.isArray(list) ? list : []) if (r && Number.isSafeInteger(r.revision) && (best === null || r.revision > best)) best = r.revision;
      if (best === null) return;
      const events = logged(ev.actor_id);
      const same = events.find((e) => e.event_type === ev.event_type && e.target_id === ev.target_id && e.occurred_at === ev.occurred_at);
      if (!same) return;
      same.changes.revision = best;
      store.set(auditKey(ev.actor_id), events);
    } catch (e) { /* the event stands without it */ }
  }

  function noted(method, path, body, data) {
    const what = describe(method, path, body, data);
    if (!what) return;
    const ev = log(what.type, what.self ? api.session && api.session.user_id : what.target, what.field);
    if (ev && what.type === 'ScriptPublish') revised(ev);
  }

  // Ours and theirs, each of ours that the upstream also has paired off and left out.
  function merge(ours, theirs) {
    const key = (e) => `${e.event_type}\n${e.target_id}`;
    const pool = new Map();
    for (const e of theirs) {
      if (!pool.has(key(e))) pool.set(key(e), []);
      pool.get(key(e)).push(when(e));
    }
    const kept = ours.filter((e) => {
      const times = pool.get(key(e));
      const i = times ? times.findIndex((t) => Math.abs(t - when(e)) <= SAME_WINDOW) : -1;
      if (i < 0) return true;
      times.splice(i, 1);
      return false;
    });
    return theirs.concat(kept).sort((x, y) => when(y) - when(x));
  }

  /* ---------- Blocks (live) ---------- */

  const extras = new Map(); // script id → the blocks of its content, as last read or written here
  const queues = new Map(); // script id → the last write queued for it
  // Another tab changing what a script carries must not be undone by a save from this one.
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('nt.blocks') : null;
  if (channel) channel.onmessage = (e) => { if (e.data && extras.has(e.data.id)) extras.set(e.data.id, e.data.blocks || {}); };

  function remember(id, blocks, tell) {
    extras.delete(id);
    extras.set(id, blocks);
    if (extras.size > 24) extras.delete(extras.keys().next().value);
    if (tell && channel) channel.postMessage({ id, blocks });
  }

  // One write at a time per script: read, change and write never interleave.
  function serial(id, job) {
    const run = (queues.get(id) || Promise.resolve()).then(job);
    const tail = run.catch(() => {});
    queues.set(id, tail);
    tail.then(() => { if (queues.get(id) === tail) queues.delete(id); });
    return run;
  }

  // → { code, blocks } of a script as it is upstream now.
  async function read(id) {
    const res = await live(at(id) + '/content');
    return Pack.split(res && typeof res.content === 'string' ? res.content : '');
  }

  // blocks with each kind in patch replaced, or taken out where the patch says null.
  function patched(blocks, patch) {
    const next = Object.assign({}, blocks);
    for (const kind of Object.keys(patch || {})) {
      if (patch[kind]) next[kind] = patch[kind];
      else delete next[kind];
    }
    return next;
  }

  /* ---------- Holders (live) ---------- */

  // Holders are told apart by name alone and say nothing else about themselves:
  //   pfp.meta              a user's photo (published)
  //   <script>.meta.thumb   a script's thumbnail (published when its script is)
  //   <script>.meta.<n>     part n of a project's files (drafts)
  // <script> is the script's name, cut to fit a name's 32 characters. Scripts of one
  // author named alike have holders named alike, so a thumbnail or a part also says
  // which script it is for (for=<id>), and that is checked when it is read.
  const FACE = 'pfp.meta';
  const PART = /^(.*)\.meta\.(\d{1,3})$/;
  const THUMB = /^(.*)\.meta\.thumb$/;
  const baseOf = (name) => String(name || '').slice(0, 23);
  const thumbBase = (name) => String(name || '').slice(0, 21);
  const thumbKey = (author, base) => `${author}\n${base}`;
  // How holders were marked for a day, by description. Still read, and renamed when met.
  const OLD_FACE = 'Profile photo for NT Scripting. Not a script: it holds a picture and does nothing when run.';
  const OLD_SOURCES = /^Project sources for script ([A-Za-z0-9_-]{1,64}) in NT Scripting\./;

  const faces = new Map();   // user id → { id, stamp, published }: the holder of their photo
  const sources = new Map(); // script id → { base, name, published, parts: [{ n, id }] }: where its project's files may be (own scripts)
  const thumbs = new Map();  // author and holder base → [{ id, author, base, stamp, published }]: where thumbnails may be
  const tidied = new Set();
  const settled = new Set(); // users whose whole list has been read: no photo found means none
  const asking = new Map();  // user id → that list being read
  let publicSeen = false;    // … and the same for everyone, once the public list has been read

  const stampOf = (s) => `${s.script_id}|${s.updated_at || ''}|${s.published_at || ''}`;

  function forget() {
    extras.clear();
    faces.clear();
    sources.clear();
    thumbs.clear();
    settled.clear();
    asking.clear();
    publicSeen = false;
  }

  // An old holder as holders are now: renamed, no description, nothing but its blocks.
  async function tidy(s, name) {
    if (tidied.has(s.script_id)) return;
    tidied.add(s.script_id);
    try {
      await live(at(s.script_id) + '/name', { method: 'PUT', body: { name }, quiet: true });
      await live(at(s.script_id) + '/description', { method: 'DELETE', quiet: true });
      const { code, blocks } = await read(s.script_id);
      if (!code) return;
      await live(at(s.script_id) + '/content', { method: 'PUT', body: { content: Pack.join('', blocks) }, quiet: true });
      if (s.published_at) await live(at(s.script_id) + '/publish', { method: 'POST', quiet: true });
    } catch (e) { /* next time */ }
  }

  // A list from the upstream without the holders in it, which are noted on the way.
  // whole: 'all' for the public list, or the user whose scripts these all are.
  // A part whose script is gone is left in: it is a draft like any other now, and
  // deleting it is up to its author.
  function sift(list, whole) {
    if (!Array.isArray(list)) return [];
    const me = api.session && api.session.user_id;
    const own = !!me && (whole === me || whole === '@' + api.session.username);
    const found = new Map();
    const pictures = [];
    const parts = [];
    const rest = [];
    for (const s of list) {
      const mine = s.author_uuid === me;
      const old = s.description === OLD_FACE;
      if (s.name === FACE || old) {
        const had = found.get(s.author_uuid);
        if (!had || new Date(s.updated_at) > new Date(had.updated_at)) found.set(s.author_uuid, s);
        if (old && mine) tidy(s, FACE);
        continue;
      }
      const t = THUMB.exec(s.name);
      if (t) {
        pictures.push({ id: s.script_id, author: s.author_uuid, base: t[1], stamp: stampOf(s), published: !!s.published_at });
        continue;
      }
      const m = own && mine && !s.published_at ? PART.exec(s.name) : null;
      const was = own && mine && !s.published_at ? OLD_SOURCES.exec(s.description || '') : null;
      if (m) parts.push({ base: m[1], n: Number(m[2]), id: s.script_id, s });
      else if (was) parts.push({ target: was[1], n: 1, id: s.script_id, s });
      else rest.push(s);
    }
    const out = rest.slice();
    if (own) {
      sources.clear();
      const used = new Set();
      for (const s of rest) {
        if (s.author_uuid !== me) continue;
        const base = baseOf(s.name);
        const its = parts.filter((p) => (p.target ? p.target === s.script_id : p.base === base));
        for (const p of its) {
          used.add(p);
          if (p.target) tidy(p.s, `${base}.meta.1`);
        }
        sources.set(s.script_id, { base, name: s.name, published: !!s.published_at, parts: its.map((p) => ({ n: p.n, id: p.id })).sort((a, b) => a.n - b.n) });
      }
      for (const p of parts) if (!used.has(p)) out.push(p.s);
    }
    for (const [user, s] of found) faces.set(user, { id: s.script_id, stamp: stampOf(s), published: !!s.published_at });
    // Whose list this is, by id: a list may be asked for by @username.
    const author = whole && whole !== 'all' ? (list[0] && list[0].author_uuid) || (whole[0] === '@' ? null : whole) : null;
    if (whole === 'all') {
      publicSeen = true;
      for (const [user, f] of faces) if (f.published && !found.has(user)) faces.delete(user);
    } else if (whole) {
      settled.add(whole);
      if (!found.has(whole)) faces.delete(whole);
      if (author && author !== whole) {
        settled.add(author);
        if (!found.has(author)) faces.delete(author);
      }
    }
    // The thumbnail holders this list would have shown and did not are gone.
    const met = new Set(pictures.map((t) => t.id));
    for (const [key, had] of thumbs) {
      const kept = had.filter((t) => !met.has(t.id) && !(whole === 'all' ? t.published : author && t.author === author));
      if (kept.length) thumbs.set(key, kept);
      else thumbs.delete(key);
    }
    for (const t of pictures) {
      const key = thumbKey(t.author, t.base);
      thumbs.set(key, (thumbs.get(key) || []).concat(t));
    }
    return out;
  }

  // A user's whole list, read once however many ask for it.
  function wholeOf(userId) {
    if (!asking.has(userId)) {
      const done = () => asking.delete(userId);
      asking.set(userId, api.userScripts(userId).then(done, done));
    }
    return asking.get(userId);
  }

  // The thumbnail's holder of one of the person's own scripts, by the list as last read.
  async function ownThumb(id) {
    const known = sources.get(id);
    return known && api.session ? api.thumbOf({ script_id: id, author_uuid: api.session.user_id, name: known.name }) : null;
  }

  // For a day thumbnails were blocks in their own scripts. One met in a script of the
  // person's own goes into a holder, and the script gets its characters back.
  const moving = new Set();
  async function moveThumb(id, block) {
    if (moving.has(id)) return;
    moving.add(id);
    try {
      await api.sourcesOf(id);
      const known = sources.get(id);
      if (!known) return;
      const s = { script_id: id, author_uuid: api.session.user_id, name: known.name };
      // A holder there already is the newer of the two.
      if (!(await api.thumbOf(s))) {
        const moved = { head: Object.assign({ for: id }, block.head), body: block.body };
        const out = await api.hold(null, { name: api.thumbName(known.name), content: Pack.join('', { thumb: moved }), publish: known.published });
        api.setThumb(s, null, { id: out.id, stamp: 'moved', published: out.published });
      }
      await api.attach(id, 'thumb', () => null);
    } catch (e) {
      /* the next time it is met */
    } finally {
      moving.delete(id);
    }
  }

  // The parts among those named for a script that really are its own.
  async function partsOf(id) {
    const known = sources.get(id);
    const mine = [];
    for (const p of known ? known.parts : []) {
      try {
        const b = (await read(p.id)).blocks.sources;
        if (b && b.head.for === id) mine.push(p.id);
      } catch (e) { /* gone */ }
    }
    return mine;
  }

  function base62(bytes) {
    const A = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const digits = [0];
    for (const byte of bytes) {
      let carry = byte;
      for (let j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 62;
        carry = (carry / 62) | 0;
      }
      while (carry) {
        digits.push(carry % 62);
        carry = (carry / 62) | 0;
      }
    }
    let out = '';
    for (const byte of bytes) {
      if (byte !== 0) break;
      out += A[0];
    }
    for (let i = digits.length - 1; i >= 0; i--) out += A[digits[i]];
    return out;
  }

  /* ---------- Demo backend ---------- */

  let db = null;
  const persist = debounce(() => store.set(DEMO_KEY, db), 150);

  // Looking around on sample data is asked for (the sign-in sheet), never fallen into:
  // a session that ran out leaves the app signed out, not signed in as someone made up.
  // It lasts as long as the tab does.
  const LOOK_KEY = 'nt.look';
  const looking = () => {
    try { return sessionStorage.getItem(LOOK_KEY) === '1'; } catch (e) { return false; }
  };
  const look = (on) => {
    try {
      if (on) sessionStorage.setItem(LOOK_KEY, '1');
      else sessionStorage.removeItem(LOOK_KEY);
    } catch (e) { /* no storage: it lasts as long as the page */ }
  };

  function loadDemo() {
    db = store.get(DEMO_KEY, null);
    if (!db || db.version !== 3) db = NT.seed();
    db.signedIn = looking();
    store.set(DEMO_KEY, db);
  }

  const lag = () => wait(140 + Math.random() * 220);
  const demoMe = () => (db.signedIn ? db.me : null);

  function resolveUser(id) {
    if (id === 'me') return db.users[db.me];
    if (db.users[id]) return db.users[id];
    const handle = String(id).replace(/^@/, '').toLowerCase();
    return Object.values(db.users).find((u) => u.username.toLowerCase() === handle) || null;
  }

  function publicUser(u) {
    return u && { user_id: u.user_id, name: u.name, username: u.username };
  }

  function listItem(s) {
    const me = demoMe();
    const author = db.users[s.author_uuid];
    return {
      script_id: s.script_id,
      name: s.name,
      description: s.description,
      author_uuid: s.author_uuid,
      author_name: author ? author.name : 'Unknown',
      updated_at: s.updated_at,
      published_at: s.published_at,
      is_favorite: !!me && (db.favorites[me] || []).includes(s.script_id),
    };
  }

  function ownScript(id) {
    const s = db.scripts[id];
    if (!s) throw new StatusError(404, 'script not found');
    if (s.author_uuid !== demoMe()) throw new StatusError(403, 'forbidden');
    return s;
  }

  function logEvent(type, target, changes) {
    db.audit.unshift({ occurred_at: new Date().toISOString(), actor_id: db.me, target_id: target, event_type: type, changes: changes || {}, metadata: {} });
  }

  /* ---------- Public API ---------- */

  const api = (NT.api = {
    mode: 'demo',
    session: null,
    liveAvailable: false,
    StatusError,
    API_BREAK,

    async init() {
      loadDemo();
      if (location.protocol === 'http:' || location.protocol === 'https:') {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 4500);
          const res = await fetch(LIVE_BASE + '/users/me', { credentials: 'include', signal: ctrl.signal });
          clearTimeout(timer);
          if (res.headers.get('x-nt-proxy')) {
            this.liveAvailable = true;
            if (res.ok) {
              this.session = await res.json();
              this.mode = 'live';
              look(false);
              db.signedIn = false;
              return;
            }
            // Signed out of the real service. That is what the app shows.
            if (!db.signedIn) {
              this.mode = 'live';
              this.session = null;
              return;
            }
          }
        } catch (e) { /* offline or no proxy: stay on demo data */ }
      }
      this.mode = 'demo';
      this.session = db.signedIn ? Object.assign({}, db.users[db.me]) : null;
    },

    isOwner(script) {
      return !!this.session && !!script && script.author_uuid === this.session.user_id;
    },
    isOutdated(script) {
      return !!script && new Date(script.published_at || script.updated_at) < API_BREAK;
    },
    paramLabel(p) {
      return PARAM_LABELS[p.name] || PARAM_LABELS[String(p.id).replace(/-/g, '')] || p.name || p.id;
    },
    groupLabel(id) {
      return GROUP_LABELS[id] || 'Parameters';
    },

    /* ----- Auth ----- */

    async login(username, password) {
      if (!this.liveAvailable) throw new StatusError(0, 'live-unavailable');
      await live('/auth/login', { method: 'POST', body: { username, password } });
      forget();
      this.session = await live('/users/me');
      this.mode = 'live';
      look(false);
      db.signedIn = false;
      log('UserLogin', this.session.user_id);
    },
    async register(name, username, password) {
      if (!this.liveAvailable) throw new StatusError(0, 'live-unavailable');
      await live('/auth/register', { method: 'POST', body: { name, username, password } });
      forget();
      this.session = await live('/users/me');
      this.mode = 'live';
      look(false);
      db.signedIn = false;
      log('UserRegister', this.session.user_id);
    },
    // Look around: the sample data, as its sample user.
    async demoSignIn() {
      await lag();
      look(true);
      db.signedIn = true;
      persist();
      this.mode = 'demo';
      this.session = Object.assign({}, db.users[db.me]);
    },
    async logout() {
      if (this.mode === 'live') {
        try {
          await live('/auth/logout', { method: 'POST' });
          log('UserLogout', this.session && this.session.user_id);
        } catch (e) { /* session may already be gone */ }
        forget();
      } else await lag();
      look(false);
      db.signedIn = false;
      persist();
      this.mode = this.liveAvailable ? 'live' : 'demo';
      this.session = null;
    },
    async changePassword(oldPassword, newPassword) {
      if (this.mode === 'live') {
        const body = { new_password: newPassword };
        if (this.session.has_password && oldPassword) body.password = oldPassword;
        await live(`/users/${this.session.user_id}/password`, { method: 'PUT', body });
        this.session = await live('/users/me');
        return;
      }
      await lag();
      db.users[db.me].has_password = true;
      this.session.has_password = true;
      logEvent('UserPasswordChange', db.me);
      persist();
    },
    resetDemo() {
      const signedIn = db.signedIn;
      db = NT.seed();
      db.signedIn = signedIn;
      store.set(DEMO_KEY, db);
    },

    /* ----- Users ----- */

    async user(id) {
      if (this.mode === 'live') return live(`/users/${encodeURIComponent(id)}`);
      await lag();
      const u = resolveUser(id);
      if (!u) throw new StatusError(404, 'user not found');
      return publicUser(u);
    },
    async audit(userId) {
      // Your own log is the one this browser keeps, with the upstream's merged in when
      // it answers: an event both have is one event, and the upstream's copy is kept.
      if (this.mode === 'live') {
        const own = userId === this.session.user_id || userId === '@' + this.session.username;
        let theirs = null;
        try {
          const res = await live(`/users/${encodeURIComponent(userId)}/audit`, { timeout: 4000 });
          if (res && Array.isArray(res.events)) theirs = res.events.filter(isEvent);
        } catch (e) {
          if (!own) throw e;
        }
        const ours = own ? logged(this.session.user_id) : [];
        return (theirs ? merge(ours, theirs) : ours).slice(0, AUDIT_ANSWER);
      }
      await lag();
      return db.audit.slice();
    },

    /* ----- Scripts ----- */

    async scripts() {
      if (this.mode === 'live') return sift((await live('/scripts')).scripts, 'all');
      await lag();
      return Object.values(db.scripts).filter((s) => s.published_at).map(listItem);
    },
    async userScripts(userId) {
      if (this.mode === 'live') return sift((await live(`/users/${encodeURIComponent(userId)}/scripts`)).scripts, userId);
      await lag();
      const u = resolveUser(userId);
      if (!u) return [];
      const mine = u.user_id === demoMe();
      return Object.values(db.scripts).filter((s) => s.author_uuid === u.user_id && (mine || s.published_at)).map(listItem);
    },
    async favorites(userId) {
      if (this.mode === 'live') return sift((await live(`/users/${encodeURIComponent(userId)}/favorites`)).scripts, null);
      await lag();
      const u = resolveUser(userId);
      if (!u) return [];
      return (db.favorites[u.user_id] || []).map((id) => db.scripts[id]).filter(Boolean).map(listItem);
    },
    async setFavorite(scriptId, on) {
      if (!this.session) throw new StatusError(401, 'unauthorized');
      if (this.mode === 'live') {
        await live(`/users/${this.session.user_id}/favorites`, { method: on ? 'POST' : 'DELETE', body: { script_id: scriptId } });
        return;
      }
      await lag();
      const list = (db.favorites[db.me] = db.favorites[db.me] || []);
      const i = list.indexOf(scriptId);
      if (on && i < 0) list.unshift(scriptId);
      if (!on && i >= 0) list.splice(i, 1);
      persist();
    },
    async script(id) {
      if (this.mode === 'live') {
        try { return await live(`/scripts/${encodeURIComponent(id)}`); } catch (e) { return null; }
      }
      await lag();
      const s = db.scripts[id];
      if (!s || (!s.published_at && s.author_uuid !== demoMe())) return null;
      const map = db.maps.find((m) => m.user_map_id === s.user_map_id);
      return Object.assign(listItem(s), { user_map_id: s.user_map_id || null, user_map_internal_id: map ? map.internal_id : null });
    },
    async scriptContent(id, revision) {
      if (this.mode === 'live') {
        const q = revision != null && revision !== '' ? `?revision=${encodeURIComponent(revision)}` : '';
        const res = await live(`${at(id)}/content${q}`);
        if (!res || typeof res.content !== 'string') return res;
        // The code alone; what else the script carries is kept for the next save.
        const { code, blocks } = Pack.split(res.content);
        if (!q) remember(id, blocks);
        if (!q && blocks.thumb && this.session) moveThumb(id, blocks.thumb);
        return Object.assign({}, res, { content: code });
      }
      await lag();
      if (!demoMe()) throw new StatusError(401, 'unauthorized');
      const s = db.scripts[id];
      if (!s) throw new StatusError(404, 'script not found');
      return { content: s.content, revision: s.revision };
    },
    async createScript(name, content) {
      if (this.mode === 'live') return (await live('/scripts', { method: 'POST', body: { name, content } })).script_id;
      await lag();
      if (!demoMe()) throw new StatusError(401, 'unauthorized');
      if ((content || '').length > 1000000) throw new StatusError(400, 'content too long');
      const id = uid(10);
      db.scripts[id] = {
        script_id: id, name: String(name).slice(0, 32), description: null, author_uuid: db.me,
        updated_at: new Date().toISOString(), published_at: null, user_map_id: null, content: content || '', revision: 1,
      };
      db.releases[id] = [];
      logEvent('ScriptCreate', id);
      persist();
      return id;
    },
    // patch (live): blocks to put beside the code or, where null, to take out.
    async saveContent(id, content, patch) {
      if (this.mode === 'live') {
        return serial(id, async () => {
          const blocks = patched(extras.get(id) || (await read(id)).blocks, patch);
          const text = Pack.join(content, blocks);
          // The code alone would fit: it is what rides with it that is in the way.
          if (text.length > LIMIT && content.length <= LIMIT) throw new StatusError(413, 'content too long: extras');
          await live(at(id) + '/content', { method: 'PUT', body: { content: text } });
          remember(id, blocks, true);
        });
      }
      await lag();
      if (content.length > 1000000) throw new StatusError(400, 'content too long');
      const s = ownScript(id);
      s.content = content;
      s.updated_at = new Date().toISOString();
      persist();
    },
    async saveName(id, name) {
      if (this.mode === 'live') {
        // A project's parts and a thumbnail are found by the script's name, so they follow it.
        const parts = await this.sourcesOf(id).then(() => partsOf(id), () => []);
        const was = sources.get(id);
        const thumb = await ownThumb(id).catch(() => null);
        await live(at(id) + '/name', { method: 'PUT', body: { name } });
        for (let i = 0; i < parts.length; i++) {
          await live(at(parts[i]) + '/name', { method: 'PUT', body: { name: this.partName(baseOf(name), i + 1) }, quiet: true }).catch(() => {});
        }
        if (thumb) {
          try {
            await live(at(thumb.id) + '/name', { method: 'PUT', body: { name: this.thumbName(name) }, quiet: true });
            const author_uuid = this.session.user_id;
            this.setThumb({ author_uuid, name: was.name }, thumb.id, null);
            this.setThumb({ author_uuid, name }, null, thumb);
          } catch (e) { /* it stays under the old name, where nothing looks for it */ }
        }
        return;
      }
      await lag();
      const s = ownScript(id);
      s.name = name;
      s.updated_at = new Date().toISOString();
      persist();
    },
    async saveDescription(id, description) {
      if (this.mode === 'live') {
        if (!description) return live(`/scripts/${encodeURIComponent(id)}/description`, { method: 'DELETE' });
        return live(`/scripts/${encodeURIComponent(id)}/description`, { method: 'PUT', body: { description } });
      }
      await lag();
      const s = ownScript(id);
      s.description = description || null;
      s.updated_at = new Date().toISOString();
      persist();
    },
    async setMap(id, userMapId) {
      if (this.mode === 'live') return live(`/scripts/${encodeURIComponent(id)}/map`, { method: 'PUT', body: { user_map_id: userMapId || null } });
      await lag();
      ownScript(id).user_map_id = userMapId || null;
      persist();
    },
    async publish(id) {
      if (this.mode === 'live') {
        const uuid = (await live(at(id) + '/publish', { method: 'POST' })).uuid;
        // Its thumbnail is public with it.
        try {
          await this.sourcesOf(id);
          const thumb = await ownThumb(id);
          if (thumb && !thumb.published) {
            await live(at(thumb.id) + '/publish', { method: 'POST', quiet: true });
            this.setThumb({ author_uuid: this.session.user_id, name: sources.get(id).name }, thumb.id, { id: thumb.id, stamp: thumb.stamp, published: true });
          }
        } catch (e) { /* kept, and seen by its owner alone */ }
        return uuid;
      }
      await lag();
      const s = ownScript(id);
      const now = new Date().toISOString();
      const first = !s.published_at;
      if (!first) s.revision += 1;
      s.published_at = now;
      s.updated_at = now;
      (db.releases[id] = db.releases[id] || []).unshift({ revision: s.revision, created_at: now, description: first ? 'First public release.' : null });
      logEvent('ScriptPublish', id, { revision: s.revision });
      persist();
      return id;
    },
    async deleteScript(id) {
      if (this.mode === 'live') {
        // A project's files and a thumbnail go with their script.
        const parts = await this.sourcesOf(id).then(() => partsOf(id), () => []);
        const was = sources.get(id);
        const thumb = await ownThumb(id).catch(() => null);
        await live(at(id), { method: 'DELETE' });
        extras.delete(id);
        sources.delete(id);
        for (const part of parts) live(at(part), { method: 'DELETE', quiet: true }).catch(() => {});
        if (thumb) {
          live(at(thumb.id), { method: 'DELETE', quiet: true }).catch(() => {});
          this.setThumb({ author_uuid: this.session.user_id, name: was.name }, thumb.id, null);
        }
        return;
      }
      await lag();
      ownScript(id);
      delete db.scripts[id];
      delete db.releases[id];
      for (const k of Object.keys(db.favorites)) db.favorites[k] = db.favorites[k].filter((x) => x !== id);
      logEvent('ScriptDelete', id);
      persist();
    },
    async parameters(id) {
      if (this.mode === 'live') return (await live(`/scripts/${encodeURIComponent(id)}/parameters`)).parameters;
      await lag();
      return NT.demoParameters.map((p) => Object.assign({}, p));
    },
    async releases(id) {
      if (this.mode === 'live') return (await live(`/scripts/${encodeURIComponent(id)}/releases`)).releases;
      await lag();
      return (db.releases[id] || []).slice();
    },
    // Ask for a one-time token that lets the game client fetch this script.
    async share(id) {
      if (this.mode === 'live') {
        try {
          const data = await live(`/scripts/${encodeURIComponent(id)}/share`, { method: 'POST' });
          return { type: 'success', token: data.token };
        } catch (e) {
          if (e.message === 'author does not have connect') return { type: 'authorDoesNotHaveConnect' };
          throw e;
        }
      }
      await lag();
      const s = db.scripts[id];
      if (s && db.users[s.author_uuid] && db.users[s.author_uuid].no_connect) return { type: 'authorDoesNotHaveConnect' };
      return { type: 'success', token: 'demo' };
    },
    // Build the room link the game client opens to start a friendly battle.
    battleLink(script, token, valueOf) {
      const payload = {
        realm: 'experiment:scripts',
        script: `${UPSTREAM_API}/scripts/${script.script_id}/content?token=${encodeURIComponent(token)}`,
        bp: BATTLE_PARAMS.map(([id, offset]) => Number(valueOf(id)) - offset),
      };
      if (script.user_map_internal_id != null) payload.map = script.user_map_internal_id;
      const encoded = base62(new TextEncoder().encode(JSON.stringify(payload)));
      return `nullsbrawl://createAndJoinRoom?roomname=params:v2:${encoded}&friendly=1&side=0`;
    },

    /* ----- Blocks and holders (live only; see pack.js, media.js, project.js) ----- */

    // A block the script carried when its content was last read or written here.
    extra(id, kind) {
      const blocks = extras.get(id);
      return (blocks && blocks[kind]) || null;
    },
    // Characters the script's code may have beside what it carries (a project mark included).
    room(id) {
      return LIMIT - Pack.size(patched(extras.get(id), { project: null })) - 160;
    },
    // → { code, blocks } of a script as it is now. Nothing is remembered.
    blocks(id) {
      return read(id);
    },
    // Sets one block of a script, leaving its code and other blocks as they are now
    // upstream. make(room) → the block, or null to take it out; room is the characters
    // free for it. Rejects with 413 when it does not fit after all.
    attach(id, kind, make) {
      return serial(id, async () => {
        const { code, blocks } = await read(id);
        const block = await make(LIMIT - Pack.join(code, patched(blocks, { [kind]: null })).length);
        const next = patched(blocks, { [kind]: block || null });
        const text = Pack.join(code, next);
        if (text.length > LIMIT) throw new StatusError(413, 'no room');
        await live(at(id) + '/content', { method: 'PUT', body: { content: text }, quiet: true });
        remember(id, next, true);
      });
    },
    // Writes a holder: the one given, or a new script when id is null.
    //   o: { name, content, publish } → { id, published }
    async hold(id, o) {
      if (o.content.length > LIMIT) throw new StatusError(413, 'too large');
      if (id) await live(at(id) + '/content', { method: 'PUT', body: { content: o.content }, quiet: true });
      else id = (await live('/scripts', { method: 'POST', body: { name: o.name, content: o.content }, quiet: true })).script_id;
      let published = false;
      if (o.publish) {
        try {
          await live(at(id) + '/publish', { method: 'POST', quiet: true });
          published = true;
        } catch (e) { /* kept, and seen by its owner alone */ }
      }
      return { id, published };
    },
    async drop(id) {
      await live(at(id), { method: 'DELETE', quiet: true });
      extras.delete(id);
    },

    FACE,
    // The holder of a user's photo: { id, stamp, published }, null when they have
    // none, undefined when that is not known yet (face() finds out).
    peekFace(userId) {
      if (faces.has(userId)) return faces.get(userId);
      const mine = !!this.session && userId === this.session.user_id;
      return settled.has(userId) || (publicSeen && !mine) ? null : undefined;
    },
    async face(userId) {
      if (this.mode !== 'live' || !this.session) return null;
      if (this.peekFace(userId) === undefined) await wholeOf(userId);
      return faces.get(userId) || null;
    },
    setFace(userId, holder) {
      if (holder) faces.set(userId, holder);
      else faces.delete(userId);
      settled.add(userId);
    },
    // The holders a script's thumbnail may be in, by name: [{ id, stamp, published }],
    // null when it has none, undefined when that is not known yet (thumbsOf finds out).
    //   s: the script, as a list item or whole (its id, author and name are used)
    peekThumb(s) {
      const named = thumbs.get(thumbKey(s.author_uuid, thumbBase(s.name)));
      if (named && named.length) return named;
      const mine = !!this.session && s.author_uuid === this.session.user_id;
      return settled.has(s.author_uuid) || (publicSeen && !mine) ? null : undefined;
    },
    async thumbsOf(s) {
      if (this.mode !== 'live' || !this.session) return null;
      if (this.peekThumb(s) === undefined) await wholeOf(s.author_uuid);
      return this.peekThumb(s) || null;
    },
    // The one of them that is this script's own, with what it holds:
    // { id, stamp, published, block }, or null. Rejects when one cannot be read now.
    async thumbOf(s) {
      for (const t of (await this.thumbsOf(s)) || []) {
        let block = null;
        try { block = (await read(t.id)).blocks.thumb; } catch (e) {
          if (!e || (e.status !== 403 && e.status !== 404)) throw e;
        }
        if (block && block.head.for === s.script_id) return Object.assign({}, t, { block });
      }
      return null;
    },
    // A script's thumbnail was written, moved or removed here: the holder `was` (an
    // id) is no longer where it is, `now` ({ id, stamp, published }) is.
    setThumb(s, was, now) {
      const base = thumbBase(s.name);
      const key = thumbKey(s.author_uuid, base);
      const named = (thumbs.get(key) || []).filter((t) => t.id !== was && !(now && t.id === now.id));
      if (now) named.push({ id: now.id, author: s.author_uuid, base, stamp: now.stamp, published: !!now.published });
      if (named.length) thumbs.set(key, named);
      else thumbs.delete(key);
    },
    thumbName: (name) => `${thumbBase(name)}.meta.thumb`,
    // Where a script's project files may be: { base, parts: [{ n, id }] }, by name
    // (another script of the same name has parts named alike; each part says whose it
    // is). null when the script is not one of the person's own. Asks afresh.
    async sourcesOf(id) {
      if (this.mode !== 'live' || !this.session) return null;
      await this.userScripts(this.session.user_id);
      return sources.get(id) || null;
    },
    partName: (base, n) => `${base}.meta.${n}`,

    /* ----- Projects (demo store only; live ones are in holders, see project.js) ----- */

    // The source files a demo script is bundled from, kept beside the script:
    // { files, minify, built, sum }, or nothing while the script is a single file.
    async demoProject(id) {
      await lag();
      return ownScript(id).project || null;
    },
    // Merges `patch` into the script's project; null removes the project.
    async setDemoProject(id, patch) {
      await lag();
      const s = ownScript(id);
      if (patch) s.project = Object.assign({}, s.project, patch);
      else delete s.project;
      persist();
    },

    /* ----- Maps ----- */

    async maps(userId) {
      if (this.mode === 'live') return (await live(`/users/${encodeURIComponent(userId)}/maps`)).maps;
      await lag();
      const u = resolveUser(userId);
      return db.maps.filter((m) => u && m.owner === u.user_id).map((m) => ({ user_map_id: m.user_map_id, name: m.name, internal_id: m.internal_id }));
    },
    async addMap(internalId, name) {
      if (this.mode === 'live') return (await live('/maps', { method: 'POST', body: { map_internal_id: internalId, name } })).user_map;
      await lag();
      const m = { user_map_id: 'm-' + uid(6), name, internal_id: internalId, owner: db.me };
      db.maps.unshift(m);
      persist();
      return { user_map_id: m.user_map_id, name: m.name, internal_id: m.internal_id };
    },
    async updateMap(userMapId, internalId) {
      if (this.mode === 'live') return live(`/maps/${encodeURIComponent(userMapId)}`, { method: 'PATCH', body: { map_internal_id: internalId } });
      await lag();
      const m = db.maps.find((x) => x.user_map_id === userMapId);
      if (m) m.internal_id = internalId;
      persist();
    },
    async renameMap(userMapId, name) {
      if (this.mode === 'live') return live(`/maps/${encodeURIComponent(userMapId)}/name`, { method: 'PUT', body: { name } });
      await lag();
      const m = db.maps.find((x) => x.user_map_id === userMapId);
      if (m) m.name = name;
      persist();
    },
    async deleteMap(userMapId) {
      if (this.mode === 'live') return live(`/maps/${encodeURIComponent(userMapId)}`, { method: 'DELETE' });
      await lag();
      db.maps = db.maps.filter((x) => x.user_map_id !== userMapId);
      for (const s of Object.values(db.scripts)) if (s.user_map_id === userMapId) s.user_map_id = null;
      persist();
    },
  });

  void api;
})();
