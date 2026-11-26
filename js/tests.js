/*
  Test runs: a script, played in a friendly battle by a game client with no screen,
  and what came of it. Whichever style shows it.

  The battle happens on a runner behind this server (ext/tests.js). A run goes
  through: waiting for a free client, a room, the battle, done. The script passes if
  the battle ran its time without the script stopping it. The saved script is what
  runs, so an editor saves before it starts one; built with DEBUG defined where that
  changes it (opts.debug), which goes into a holder (<script>.meta.debug, api.js) for
  the length of the run and is played from there.

  That alone does not say the script ran: the game server starts the battle all the
  same when it cannot fetch the script, and the battle then looks no different. What
  a client sees of a script is what it printed and a battle it stopped, so a pass
  with nothing printed is told as no sign of the script, not as a pass.

  Nor does it say the script kept running. One that throws, or spends more than the
  game allows it, is stopped where it is and the battle goes on without it; the game
  says so in the same place the script prints, as text:

    Lua error is thrown!
    attempt to call a nil value

    Runtime quota exceeded (12.642456 ms, 16931650 bytes)

  Those lines are read for what they are (run.fault, and level 'error' on the line),
  and the run is then told as a script error however long the battle lasted. A script
  can print the same words itself; it is then told the same.

    NT.tests.available()        there is a runner (asked once, with the extensions)
    NT.tests.seconds            { least, most, usual }: how long a battle is watched
    NT.tests.start(script, { values, seconds, debug })
                                → the run, at once; what goes wrong shows on it.
                                  values(parameter) → its value, as on the script's
                                  page; left out, what setup() says. debug() → Promise
                                  of { code, warnings }: the code to play, null for
                                  the saved script, and what its #warning lines say,
                                  [{ path, line, message }], which open the run's
                                  lines (session.debug); it rejects with an Error
                                  whose reason is one of REASONS' keys
    NT.tests.setup(scriptId)    what this browser runs a script's tests with (nt.test.<id>):
                                { seconds, map, values }. seconds: null is the usual.
                                map: undefined is the script's own, null none, else
                                { id, internal } of one of the author's maps. values:
                                { [parameter id]: value } for those not at their default
    NT.tests.configure(scriptId, patch)
                                change some of it; null puts all of it back
    NT.tests.changed(scriptId)  how many settings are not at their default
    NT.tests.expect()           someone is at work on a script of theirs and may test it
                                soon. The runner keeps no client waiting for runs, and
                                one started for a run spends the battle's first
                                seconds getting ready to read it; told this, it has one
                                standing by. Passed on at most every few minutes
                                (session.js says it as a script is opened and edited)
    NT.tests.of(scriptId)       the run for a script in this tab: going, or the last
    NT.tests.kinds              [{ id, label }]: what the objects of a battle can be
                                shown by, 'all' first
    NT.tests.state(run, { kind, query })
                                → the battle as a table, see below

  A run:
    run.state      'starting' | 'queued' | 'room' | 'battle' | 'leaving' | 'done'
    run.queue      { position, of } while queued
    run.lines      [{ kind: 'output' | 'log', level, text, t }] what the script printed,
                   and what the game complained of ('warning' | 'error'), in order.
                   level is null on a line the script printed, 'error' on one that
                   is the game saying the script was stopped
    run.fault      null, or what stopped the script: { kind: 'error' | 'quota', text }
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
  print() calls, and is told its error as the game would if the script calls error().
*/
(function () {
  'use strict';
  const NT = window.NT;
  const API = NT.api;
  const { h, wait } = NT.util;

  const SECONDS = { least: 5, most: 120, usual: 20 };
  const LINES = 400;
  const EXPECT_EVERY = 4 * 60 * 1000;   // the runner lets a client stand by for five
  let expected = 0;
  const runs = new Map(); // script id → its run in this tab

  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // What the game prints, among the script's own lines, when it stops a script: that it
  // threw (what it threw follows, on that line or the next), or that it took more time
  // or memory than a script gets.
  const THROWN = /^Lua error is thrown!?\s*$/;
  const QUOTA = /^Runtime quota exceeded \((\d+(?:\.\d+)?) ms, (\d+) bytes\)/;
  const spent = (ms, bytes) => `${+(+ms).toFixed(2)} ms, ${+(bytes / 1e6).toFixed(1)} MB`;

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
    'debug-failed': 'The DEBUG build failed',
    'debug-too-large': 'The DEBUG build is over 1,000,000 characters',
    'debug-unsaved': 'Couldn’t upload the DEBUG build',
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
      this.fault = null;      // what stopped the script, as the game said it
      this.thrown = false;    // the game said it threw, and what it threw is the next line
      this.seconds = seconds;
      this.battleAt = 0;      // when the battle began, by this device's clock
      this.listeners = new Set();
      this.source = null;
      this.ticker = 0;
      this.stopped = false;
      this.act = null;        // the acted-out run on sample data
      this.after = null;      // what has to go once the run is over (the DEBUG holder)
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

    // A line from where the script prints: the script's own, or the game saying it
    // stopped the script. → its level. Only the first stop is kept: a script that is
    // stopped prints nothing after it.
    read(text) {
      const [first, ...rest] = text.split(/\r?\n/);
      if (this.thrown) {
        this.thrown = false;
        if (this.fault && !this.fault.text) this.fault.text = first.trim();
        return 'error';
      }
      const quota = QUOTA.exec(first);
      if (!quota && !THROWN.test(first)) return null;
      const said = rest.join(' ').trim();
      if (!quota && !said) this.thrown = true;
      if (!this.fault) this.fault = quota ? { kind: 'quota', text: spent(quota[1], quota[2]) } : { kind: 'error', text: said };
      return 'error';
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
        case 'log': {
          const text = String(e.text);
          const said = this.fault && this.fault.text;
          this.lines.push({ kind: e.kind, level: e.kind === 'log' ? e.level : this.read(text), text, t: e.t });
          if (this.lines.length > LINES) this.lines.shift();
          // The heading says a stop as soon as it is read, and why as soon as that is.
          return this.tell(this.fault && this.fault.text !== said ? 'state' : 'line');
        }
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
      if (this.after) {
        this.after();
        this.after = null;
      }
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
      // The game stopped the script. The battle may still be on; the script is not.
      const fault = this.fault && {
        title: this.fault.kind === 'quota' ? 'Quota exceeded' : 'Script error',
        detail: this.fault.text || (this.fault.kind === 'quota' ? 'The script was stopped' : 'The script threw an error'),
        tone: 'bad',
      };
      if (fault && this.state === 'battle') {
        return Object.assign(fault, { progress: Math.min(1, (Date.now() - this.battleAt) / 1000 / this.seconds) });
      }
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
      // Stopped by the game, the battle running its time says nothing for the script.
      if (fault && (r.verdict === 'passed' || r.verdict === 'cancelled')) return Object.assign(fault, { progress: null });
      if (r.verdict === 'passed') {
        const ended = r.reason === 'battle-ended';
        if (!printed) {
          return {
            title: 'No sign it ran',
            detail: ended ? `Battle ended after ${plural(r.battle, 'second')} · nothing printed` : `Nothing printed in ${plural(r.battle, 'second')}`,
            tone: 'off',
            progress: null,
          };
        }
        const time = ended ? `Battle ended after ${plural(r.battle, 'second')}` : plural(r.battle, 'second');
        return { title: 'No errors', detail: `${time} · ${plural(printed, 'line')}`, tone: 'good', progress: 1 };
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

  /* ---------- What a script is tested with ---------- */

  const setupKey = (id) => 'nt.test.' + id;
  function setup(id) {
    const raw = NT.util.store.get(setupKey(id), null) || {};
    const values = {};
    for (const [k, v] of Object.entries(raw.values && typeof raw.values === 'object' ? raw.values : {})) {
      if (typeof v === 'number' && Number.isFinite(v)) values[k] = v;
    }
    const map = raw.map === null ? null
      : raw.map && typeof raw.map.id === 'string' && raw.map.internal != null ? { id: raw.map.id, internal: raw.map.internal } : undefined;
    return { seconds: typeof raw.seconds === 'number' && Number.isFinite(raw.seconds) ? raw.seconds : null, map, values };
  }
  function configure(id, patch) {
    if (patch === null) return NT.util.store.remove(setupKey(id));
    const next = Object.assign(setup(id), patch);
    const out = {};
    if (next.seconds != null) out.seconds = next.seconds;
    if (next.map !== undefined) out.map = next.map;
    if (Object.keys(next.values).length) out.values = next.values;
    if (Object.keys(out).length) NT.util.store.set(setupKey(id), out);
    else NT.util.store.remove(setupKey(id));
  }

  // The code a run plays instead of the saved script, or null: debug() as start() has it.
  // What the build warned of (#warning) is the first thing the run says.
  async function debugged(run, debug) {
    if (!debug) return null;
    try {
      const made = await debug();
      if (!made || typeof made !== 'object') return made == null ? null : made;
      for (const w of made.warnings || []) {
        run.lines.push({ kind: 'log', level: 'warning', text: `${w.path}${w.line ? ':' + w.line : ''}: ${w.message}`, t: 0 });
      }
      if (made.warnings && made.warnings.length) run.tell('line');
      return made.code == null ? null : made.code;
    } catch (e) {
      run.finish('error', e && REASONS[e.reason] ? e.reason : 'debug-failed');
      return undefined;
    }
  }

  async function begin(run, script, values, map, debug) {
    const fail = (reason) => run.finish('error', reason);
    if (!API.session) return fail('unauthorized');

    // A DEBUG build is played from a holder of its own, there only while the run is.
    const code = await debugged(run, debug);
    if (code === undefined) return;
    if (run.stopped) return run.finish('cancelled', 'cancelled');
    let played = script.script_id;
    if (code !== null) {
      try {
        played = (await API.hold(null, { name: API.debugName(script.name), content: code })).id;
      } catch (e) {
        return fail(e && e.status === 413 ? 'debug-too-large' : 'debug-unsaved');
      }
      const holder = played;
      run.after = () => API.drop(holder).catch(() => {});
      if (run.stopped) return run.finish('cancelled', 'cancelled');
    }

    let share, params;
    try {
      [share, params] = await Promise.all([API.share(played), API.parameters(script.script_id)]);
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
          script_id: played,
          token: share.token,
          bp,
          map: map === undefined ? (script.user_map_internal_id == null ? null : script.user_map_internal_id) : map,
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

  async function act(run, script, debug) {
    run.act = true;
    const alive = () => !run.done;
    let code = await debugged(run, debug);
    if (code === undefined) return;
    if (code === null) {
      try { code = (await API.scriptContent(script.script_id)).content || ''; } catch (e) { code = ''; }
    }
    // Calls as they are written, and as a minified bundle writes them (print'…').
    const prints = [...code.matchAll(/\bprint\s*\(?\s*(["'])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]).slice(0, 12);
    const thrown = /\berror\s*(?:\(\s*(?:(["'])((?:\\.|(?!\1).)*)\1)?|(["'])((?:\\.|(?!\3).)*)\3)/.exec(code);
    const throws = !!thrown;
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
    // A script that throws is stopped there, and the battle goes on without it.
    const stopAt = throws ? Math.min(3, seconds) : seconds;
    for (let s = 0; s < seconds * 2 && alive(); s++) {
      if (throws && s === stopAt * 2) run.take({ kind: 'output', text: 'Lua error is thrown!\n' + (thrown[2] || thrown[4] || 'error'), t: stopAt });
      if (s % 2 === 0) {
        for (const u of units) {
          if (u[1] !== 0) continue;
          u[4] += Math.round(Math.sin(s * 0.9 + u[0]) * 260);
          u[5] += (u[3] === 0 ? -1 : 1) * 330;
          if (s > 4) u[6] = Math.max(600, u[6] - ((u[0] * 37 + s * 211) % 900));
        }
        run.take({ kind: 'field', tick: s * 10, me: 1000000, players: 6, units: units.map((u) => u.slice()) });
        const line = prints[s / 2];
        if (line !== undefined && !run.fault) run.take({ kind: 'output', text: line, t: s / 2 });
      }
      await wait(500);
    }
    if (!alive()) return;
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
    expect() {
      if (API.mode !== 'live' || !API.session || !this.available()) return;
      if (Date.now() - expected < EXPECT_EVERY) return;
      expected = Date.now();
      fetch(NT.ext.url('/tests/warm'), { method: 'POST', credentials: 'include' }).catch(() => {});
    },
    of(scriptId) {
      return runs.get(scriptId) || null;
    },
    start(script, opts = {}) {
      const was = runs.get(script.script_id);
      if (was && !was.done) return was;
      const limit = (API.mode === 'live' && NT.ext.info('tests').seconds) || SECONDS;
      const set = setup(script.script_id);
      const seconds = Math.max(limit.least, Math.min(limit.most, Math.round(opts.seconds || set.seconds || limit.usual)));
      const run = new Run(script, seconds);
      runs.set(script.script_id, run);
      // (Not called valueOf: every object has one of those, asked for or not.)
      const values = typeof opts.values === 'function' ? opts.values : (p) => (p.id in set.values ? set.values[p.id] : p.default_value);
      const map = set.map === undefined ? undefined : set.map && set.map.internal;
      const debug = typeof opts.debug === 'function' ? opts.debug : null;
      const go = API.mode === 'live' ? begin(run, script, values, map, debug) : act(run, script, debug);
      go.catch((e) => {
        console.error(e);
        run.finish('error', 'internal');
      });
      return run;
    },
    setup,
    configure,
    changed(id) {
      const s = setup(id);
      return (s.seconds != null ? 1 : 0) + (s.map !== undefined ? 1 : 0) + Object.keys(s.values).length;
    },
    kinds: KINDS,
    state,
  };
})();
