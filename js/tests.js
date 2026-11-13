/*
  Test runs: a script, played in a friendly battle by a game client with no screen,
  and what came of it. Whichever style shows it.

  The battle happens on a runner behind this server (ext/tests.js). A run goes
  through: waiting for a free client, a room, the battle, done. The script passes if
  the battle ran its time without the script stopping it. The saved script is what
  runs, so an editor saves before it starts one.

    NT.tests.available()        there is a runner (asked once, with the extensions)
    NT.tests.seconds            { least, most, usual }: how long a battle is watched
    NT.tests.start(script, { values, seconds })
                                → the run, at once; what goes wrong shows on it.
                                  values(parameter) → its value, as on the script's
                                  page; left out, every parameter is at its default
    NT.tests.of(scriptId)       the run for a script in this tab: going, or the last
    NT.tests.kinds              [{ id, label }]: what the objects of a battle can be
                                shown by, 'all' first
    NT.tests.state(run, { kind, query })
                                → the battle as a table, see below

  A run:
    run.state      'starting' | 'queued' | 'room' | 'battle' | 'leaving' | 'done'
    run.queue      { position, of } while queued
    run.lines      [{ kind: 'output' | 'log', level, text, t }] what the script printed,
                   and what the game complained of ('warning' | 'error'), in order
    run.shot       the last look at the battle, as the runner sent it: { tick, me,
                   players, units }; state() is how it is read
    run.result     once done: { verdict: 'passed' | 'failed' | 'error' | 'cancelled',
                   reason, detail, seconds, ticks }
    run.words()    → { title, detail, tone, progress } for a heading: the same words in
                   every style. tone: 'busy' | 'good' | 'bad' | 'off'. progress: 0…1,
                   or null while there is no telling how long
    run.on(fn)     fn(run, what) on every change; what: 'state' | 'line' | 'shot' | 'tick'
                   ('tick': only the clock moved). → a function that stops it
    run.stop()

  The battle is told in text: what this client can see of it, an object to a row.
  state() gives a style everything it writes, already in words, so the table says the
  same in each:
    { summary     'Tick 183 · 6 players · 9 objects', or '' before the first look
      columns     [{ id, label, number }]: name, kind, team, hp, x, y
      rows        [{ id, own, name, kind, team, hp, x, y }], strings; own: this client's
                  character. Characters first, this client's own at the top
      none        what to say when there are no rows }
  kind is one of NT.tests.kinds' ids; query is looked for in name, kind and team.

  On the sample data there is no runner: a run is acted out, from the script's own
  print() calls, and fails if the script calls error().
*/
(function () {
  'use strict';
  const NT = window.NT;
  const API = NT.api;
  const { h, wait } = NT.util;

  const SECONDS = { least: 5, most: 120, usual: 20 };
  const LINES = 400;
  const runs = new Map(); // script id → its run in this tab

  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // Why a run did not happen or did not pass, in words.
  const REASONS = {
    'script-error': 'The script stopped the battle',
    'script-error-at-start': 'The script stopped the battle as it began',
    'no-room': 'The game didn’t open a room',
    'no-battle': 'The battle didn’t start',
    'client-lost': 'The runner’s game stopped',
    'no-client': 'No runner came free',
    'shutting-down': 'The runner is restarting',
    internal: 'The runner failed',
    'runner-unavailable': 'The runner is offline',
    'no-runner': 'The runner is offline',
    full: 'Too many tests are waiting',
    busy: 'You already have a test running',
    'slow-down': 'Too many tests at once',
    unauthorized: 'Sign in to run tests',
    'no-connect': 'The author hasn’t linked Null’s Connect',
    'not-verified': 'The author isn’t verified',
    lost: 'Lost touch with the runner',
  };

  class Run {
    constructor(script, seconds) {
      this.scriptId = script.script_id;
      this.id = null;
      this.state = 'starting';
      this.queue = null;
      this.lines = [];
      this.shot = null;
      this.result = null;
      this.seconds = seconds;
      this.battleAt = 0;      // when the battle began, by this device's clock
      this.listeners = new Set();
      this.source = null;
      this.ticker = 0;
      this.stopped = false;
      this.act = null;        // the acted-out run on sample data
    }

    on(fn) {
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }

    tell(what) {
      for (const fn of [...this.listeners]) {
        try { fn(this, what); } catch (e) { console.error(e); }
      }
    }

    get done() {
      return this.state === 'done';
    }

    // An event of the run, as the runner sends it (its run.js).
    take(e) {
      if (this.done || !e) return;
      switch (e.kind) {
        case 'queue':
          this.state = 'queued';
          this.queue = { position: e.position, of: e.of };
          return this.tell('state');
        case 'phase':
          this.queue = null;
          this.state = e.name === 'room' || e.name === 'battle' || e.name === 'leaving' ? e.name : this.state;
          if (e.name === 'battle') {
            this.battleAt = Date.now();
            this.ticker = setInterval(() => this.tell('tick'), 250);
          } else clearInterval(this.ticker);
          return this.tell('state');
        case 'output':
        case 'log':
          this.lines.push({ kind: e.kind, level: e.kind === 'log' ? e.level : null, text: String(e.text), t: e.t });
          if (this.lines.length > LINES) this.lines.shift();
          return this.tell('line');
        case 'field':
          this.shot = { tick: e.tick, me: e.me, players: typeof e.players === 'number' ? e.players : null, units: Array.isArray(e.units) ? e.units : [] };
          return this.tell('shot');
        case 'done':
          return this.finish(e.verdict, e.reason, e.detail, e);
        default:
      }
    }

    finish(verdict, reason, detail, more) {
      if (this.done) return;
      clearInterval(this.ticker);
      if (this.source) this.source.close();
      this.source = null;
      this.queue = null;
      this.state = 'done';
      this.result = {
        verdict,
        reason: reason || null,
        detail: detail || null,
        seconds: more && typeof more.seconds === 'number' ? more.seconds : 0,
        ticks: more && typeof more.ticks === 'number' ? more.ticks : 0,
        // How long the battle itself was watched.
        battle: this.battleAt ? Math.round((Date.now() - this.battleAt) / 1000) : 0,
      };
      this.tell('state');
    }

    stop() {
      if (this.done || this.stopped) return;
      this.stopped = true;
      if (this.act) return void this.finish('cancelled', 'cancelled');
      if (!this.id) return; // not accepted yet: start() sees the flag
      fetch(NT.ext.url(`/tests/runs/${encodeURIComponent(this.id)}`), { method: 'DELETE', credentials: 'include' })
        .catch(() => {});
      // The runner answers with the run's last event; if that never comes, this stands.
      setTimeout(() => this.finish('cancelled', 'cancelled'), 6000);
    }

    words() {
      const printed = this.lines.filter((l) => l.kind === 'output').length;
      switch (this.state) {
        case 'starting':
          return { title: 'Starting', detail: '', tone: 'busy', progress: null };
        case 'queued':
          return {
            title: 'Waiting',
            detail: this.queue ? `${ordinal(this.queue.position)} in line` : '',
            tone: 'busy',
            progress: null,
          };
        case 'room':
          return { title: 'Opening a room', detail: '', tone: 'busy', progress: null };
        case 'battle': {
          const at = Math.min(this.seconds, (Date.now() - this.battleAt) / 1000);
          return { title: 'In battle', detail: `${clock(at)} of ${clock(this.seconds)}`, tone: 'busy', progress: at / this.seconds };
        }
        case 'leaving':
          return { title: 'Finishing', detail: '', tone: 'busy', progress: 1 };
        default:
      }
      const r = this.result;
      if (r.verdict === 'passed') {
        const time = r.reason === 'battle-ended' ? `Battle ended after ${plural(r.battle, 'second')}` : plural(r.battle, 'second');
        return { title: 'No errors', detail: printed ? `${time} · ${plural(printed, 'line')}` : time, tone: 'good', progress: 1 };
      }
      if (r.verdict === 'cancelled') return { title: 'Stopped', detail: '', tone: 'off', progress: null };
      if (r.verdict === 'failed') {
        const script = r.reason === 'script-error' || r.reason === 'script-error-at-start';
        return {
          title: script ? 'Script error' : 'Didn’t run',
          detail: script && r.battle && r.reason === 'script-error' ? `${REASONS[r.reason]} after ${plural(r.battle, 'second')}` : REASONS[r.reason] || 'The battle failed',
          tone: 'bad',
          progress: null,
        };
      }
      return { title: 'Couldn’t run', detail: REASONS[r.reason] || 'Try again', tone: 'bad', progress: null };
    }
  }

  /* ---------- A run on the runner ---------- */

  async function begin(run, script, values) {
    const fail = (reason) => run.finish('error', reason);
    if (!API.session) return fail('unauthorized');

    let share, params;
    try {
      [share, params] = await Promise.all([API.share(script.script_id), API.parameters(script.script_id)]);
    } catch (e) {
      // The service refuses to share a script whose author it does not vouch for.
      return fail(e && e.status === 401 ? 'unauthorized' : 'not-verified');
    }
    if (share.type !== 'success') return fail('no-connect');
    if (run.stopped) return run.finish('cancelled', 'cancelled');

    // The client has to be able to leave the battle when its time is up.
    const value = (p) => (p.name === 'allowSelfKill' ? 1 : values ? values(p) : p.default_value);
    const bp = API.battleParams((id) => {
      const p = params.find((x) => x.id === id);
      return p ? value(p) : 0;
    });

    let res, data = null;
    try {
      res = await fetch(NT.ext.url('/tests/runs'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script_id: script.script_id,
          token: share.token,
          bp,
          map: script.user_map_internal_id == null ? null : script.user_map_internal_id,
          seconds: run.seconds,
        }),
      });
      data = await res.json().catch(() => null);
    } catch (e) {
      return fail('runner-unavailable');
    }
    if (!res.ok || !data || !data.id) return fail((data && data.error) || 'runner-unavailable');
    run.id = data.id;
    if (run.stopped) {
      run.stopped = false;
      return run.stop();
    }

    // The stream picks up where it broke off by itself; a run that cannot be reached
    // several times over is given up.
    let breaks = 0;
    const source = new EventSource(NT.ext.url(`/tests/runs/${encodeURIComponent(run.id)}/events`), { withCredentials: true });
    run.source = source;
    source.onmessage = (m) => {
      breaks = 0;
      let event = null;
      try { event = JSON.parse(m.data); } catch (e) { return; }
      run.take(event);
    };
    source.onerror = () => {
      if (run.done) return;
      if (++breaks > 4 || source.readyState === EventSource.CLOSED) run.finish('error', 'lost');
    };
  }

  /* ---------- A run acted out, on the sample data ---------- */

  async function act(run, script) {
    run.act = true;
    const alive = () => !run.done;
    let code = '';
    try { code = (await API.scriptContent(script.script_id)).content || ''; } catch (e) { /* an empty script */ }
    const prints = [...code.matchAll(/\bprint\(\s*(["'])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]).slice(0, 12);
    const throws = /\berror\s*\(/.test(code);
    const seconds = Math.min(run.seconds, 8);
    run.seconds = seconds;

    await wait(350);
    if (!alive()) return;
    run.take({ kind: 'queue', position: 1, of: 1 });
    await wait(900);
    if (!alive()) return;
    run.take({ kind: 'phase', name: 'room' });
    await wait(1100);
    if (!alive()) return;
    run.take({ kind: 'phase', name: 'battle' });

    // Six players about a field, three a side, and a few boxes.
    const units = [];
    for (let i = 0; i < 6; i++) units.push([1000000 + i, 0, ['Shelly', 'Colt', 'Nita', 'Bull', 'Jessie', 'Brock'][i], i < 3 ? 0 : 1, 1500 + (i % 3) * 1650, i < 3 ? 9000 : 900, 6000, 6000]);
    for (let i = 0; i < 4; i++) units.push([4000000 + i, 3, 'Box', -1, 1200 + i * 1300, 4950, null, null]);
    const stopAt = throws ? Math.min(3, seconds) : seconds;
    for (let s = 0; s < stopAt * 2 && alive(); s++) {
      if (s % 2 === 0) {
        for (const u of units) {
          if (u[1] !== 0) continue;
          u[4] += Math.round(Math.sin(s * 0.9 + u[0]) * 260);
          u[5] += (u[3] === 0 ? -1 : 1) * 330;
          if (s > 4) u[6] = Math.max(600, u[6] - ((u[0] * 37 + s * 211) % 900));
        }
        run.take({ kind: 'field', tick: s * 10, me: 1000000, players: 6, units: units.map((u) => u.slice()) });
        const line = prints[s / 2];
        if (line !== undefined) run.take({ kind: 'output', text: line, t: s / 2 });
      }
      await wait(500);
    }
    if (!alive()) return;
    if (throws) {
      // What the game is heard to say when a battle goes from under it.
      run.take({ kind: 'log', level: 'error', text: 'ServerErrorMessage received', t: stopAt });
      return run.take({ kind: 'done', verdict: 'failed', reason: 'script-error', detail: null, seconds: 5, ticks: 60 });
    }
    run.take({ kind: 'phase', name: 'leaving' });
    await wait(400);
    run.take({ kind: 'done', verdict: 'passed', reason: 'time-up', detail: null, seconds: seconds + 3, ticks: seconds * 20 });
  }

  /* ---------- The battle as a table ---------- */

  const KINDS = [
    { id: 'all', label: 'All' },
    { id: 'character', label: 'Characters' },
    { id: 'projectile', label: 'Projectiles' },
    { id: 'area', label: 'Areas' },
    { id: 'item', label: 'Items' },
  ];
  // The runner's numbers for them, and the order they are listed in.
  const KIND_OF = ['character', 'projectile', 'area', 'item'];
  const KIND_ORDER = { character: 0, item: 1, area: 2, projectile: 3 };
  const COLUMNS = [
    { id: 'name', label: 'Name', number: false },
    { id: 'kind', label: 'Kind', number: false },
    { id: 'team', label: 'Team', number: false },
    { id: 'hp', label: 'HP', number: true },
    { id: 'x', label: 'X', number: true },
    { id: 'y', label: 'Y', number: true },
  ];
  const NONE = '—';

  // A unit is [id, kind, name, team, x, y, hp, max], as the runner sends it.
  function state(run, filter = {}) {
    const shot = run && run.shot;
    if (!shot) return { summary: '', columns: COLUMNS, rows: [], none: run && run.done ? 'The battle was never seen' : 'No battle yet' };
    const kind = filter.kind && filter.kind !== 'all' ? filter.kind : null;
    const query = String(filter.query || '').trim().toLowerCase();
    const all = shot.units.map((u) => {
      const own = u[0] === shot.me;
      const side = typeof u[3] === 'number' && u[3] >= 0 ? String(u[3]) : NONE;
      return {
        id: u[0],
        own,
        order: KIND_ORDER[KIND_OF[u[1]]] === undefined ? 9 : KIND_ORDER[KIND_OF[u[1]]],
        side: typeof u[3] === 'number' ? u[3] : 99,
        name: String(u[2] || NONE),
        kind: KIND_OF[u[1]] || 'object',
        team: own ? `${side} · you` : side,
        hp: u[6] == null || u[7] == null ? NONE : `${u[6]}/${u[7]}`,
        x: typeof u[4] === 'number' ? String(u[4]) : NONE,
        y: typeof u[5] === 'number' ? String(u[5]) : NONE,
      };
    });
    const rows = all
      .filter((r) => (!kind || r.kind === kind) && (!query || `${r.name}
${r.kind}
${r.team}`.toLowerCase().includes(query)))
      .sort((a, b) => a.order - b.order || Number(b.own) - Number(a.own) || a.side - b.side || a.id - b.id);
    const parts = [`Tick ${Math.max(0, shot.tick)}`];
    if (shot.players != null) parts.push(plural(shot.players, 'player'));
    parts.push(plural(all.length, 'object'));
    if (rows.length !== all.length) parts.push(`${rows.length} shown`);
    return { summary: parts.join(' · '), columns: COLUMNS, rows, none: all.length ? 'Nothing matches' : 'Nothing in sight' };
  }

  NT.tests = {
    seconds: SECONDS,
    available() {
      // Sample data has no runner; its runs are acted out.
      if (API.mode !== 'live') return true;
      return NT.ext.has('tests') && NT.ext.info('tests').ready === true;
    },
    of(scriptId) {
      return runs.get(scriptId) || null;
    },
    start(script, opts = {}) {
      const was = runs.get(script.script_id);
      if (was && !was.done) return was;
      const limit = (API.mode === 'live' && NT.ext.info('tests').seconds) || SECONDS;
      const seconds = Math.max(limit.least, Math.min(limit.most, Math.round(opts.seconds || limit.usual)));
      const run = new Run(script, seconds);
      runs.set(script.script_id, run);
      // (Not called valueOf: every object has one of those, asked for or not.)
      const go = API.mode === 'live' ? begin(run, script, typeof opts.values === 'function' ? opts.values : null) : act(run, script);
      go.catch((e) => {
        console.error(e);
        run.finish('error', 'internal');
      });
      return run;
    },
    kinds: KINDS,
    state,
  };
})();
