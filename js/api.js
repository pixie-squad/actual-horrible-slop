/*
  Data layer with two interchangeable backends.

  live – the scripting.nulls.gg API, reached through the local proxy in
         server.js (same endpoints and payloads the original site uses).
  demo – an in-browser store seeded from data.js and saved to localStorage.

  Pages only ever call NT.api.*, so they behave the same on either.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { store, wait, uid, debounce } = NT.util;

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

  async function live(path, opts = {}) {
    const init = { method: opts.method || 'GET', credentials: 'include', headers: {} };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(LIVE_BASE + path, init);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON body */ }
    if (!res.ok) throw new StatusError(res.status, data && data.error);
    return data;
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

  function loadDemo() {
    db = store.get(DEMO_KEY, null);
    if (!db || db.version !== 3) {
      db = NT.seed();
      store.set(DEMO_KEY, db);
    }
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
      this.session = await live('/users/me');
      this.mode = 'live';
    },
    async register(name, username, password) {
      if (!this.liveAvailable) throw new StatusError(0, 'live-unavailable');
      await live('/auth/register', { method: 'POST', body: { name, username, password } });
      this.session = await live('/users/me');
      this.mode = 'live';
    },
    async demoSignIn() {
      await lag();
      db.signedIn = true;
      persist();
      this.mode = 'demo';
      this.session = Object.assign({}, db.users[db.me]);
    },
    async logout() {
      if (this.mode === 'live') {
        try { await live('/auth/logout', { method: 'POST' }); } catch (e) { /* session may already be gone */ }
      } else await lag();
      db.signedIn = false;
      persist();
      this.mode = 'demo';
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
      // The local server keeps this log itself where it can (ext/audit.js) and only
      // answers for the person asking; without it, the upstream's own log.
      if (this.mode === 'live' && NT.ext.has('audit')) {
        const own = userId === this.session.user_id || userId === '@' + this.session.username;
        const res = await fetch(NT.ext.url(`/audit/users/${own ? 'me' : encodeURIComponent(userId)}`), { credentials: 'include' });
        if (!res.ok) throw new StatusError(res.status);
        return (await res.json()).events;
      }
      if (this.mode === 'live') return (await live(`/users/${encodeURIComponent(userId)}/audit`)).events;
      await lag();
      return db.audit.slice();
    },

    /* ----- Scripts ----- */

    async scripts() {
      if (this.mode === 'live') return (await live('/scripts')).scripts;
      await lag();
      return Object.values(db.scripts).filter((s) => s.published_at).map(listItem);
    },
    async userScripts(userId) {
      if (this.mode === 'live') return (await live(`/users/${encodeURIComponent(userId)}/scripts`)).scripts;
      await lag();
      const u = resolveUser(userId);
      if (!u) return [];
      const mine = u.user_id === demoMe();
      return Object.values(db.scripts).filter((s) => s.author_uuid === u.user_id && (mine || s.published_at)).map(listItem);
    },
    async favorites(userId) {
      if (this.mode === 'live') return (await live(`/users/${encodeURIComponent(userId)}/favorites`)).scripts;
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
        return live(`/scripts/${encodeURIComponent(id)}/content${q}`);
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
    async saveContent(id, content) {
      if (this.mode === 'live') return live(`/scripts/${encodeURIComponent(id)}/content`, { method: 'PUT', body: { content } });
      await lag();
      if (content.length > 1000000) throw new StatusError(400, 'content too long');
      const s = ownScript(id);
      s.content = content;
      s.updated_at = new Date().toISOString();
      persist();
    },
    async saveName(id, name) {
      if (this.mode === 'live') return live(`/scripts/${encodeURIComponent(id)}/name`, { method: 'PUT', body: { name } });
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
      if (this.mode === 'live') return (await live(`/scripts/${encodeURIComponent(id)}/publish`, { method: 'POST' })).uuid;
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
      if (this.mode === 'live') return live(`/scripts/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

    /* ----- Projects (demo store only; live ones are the server's, see project.js) ----- */

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
