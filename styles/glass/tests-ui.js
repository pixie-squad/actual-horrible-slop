/*
  A test run, drawn. What a run is, and every word said about it, is the core's
  (js/tests.js); this is its panel: a heading that says where the run stands, and
  under it either what the script printed or the battle as a table.

    NT.kit.testsView({ onRun(source), onClose })  → { el, show(run), dispose() }
      onRun     the button in the heading, when no run is going
      onClose   given where the panel has no way out of its own (docked under the code)

  The panel is content, like the code it sits under: opaque. What is pressed in it is
  glass, as everywhere: the button, the close button, and the two switches, whose
  thumbs lift into a lens while they are held.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h, debounce } = NT.util;
  const icon = NT.icon;
  const UI = NT.ui;

  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // What the sheet shows of a script that has to be asked for: its parameters and its
  // author's maps. Asked for once the editor knows tests can run (testSettings.ready),
  // so the sheet has them when it opens; kept for the visit, and asked again behind
  // each opening so the next one is up to date.
  const asked = new Map(); // script id → { data, pending }
  function ask(script) {
    const API = NT.api;
    const id = script.script_id;
    const entry = asked.get(id) || { data: null, pending: null };
    asked.set(id, entry);
    if (!entry.pending) {
      entry.pending = Promise.all([
        API.parameters(id).catch(() => []),
        API.maps(script.author_uuid).catch(() => []),
      ]).then(([params, maps]) => {
        entry.pending = null;
        return (entry.data = { params, maps });
      });
    }
    return entry;
  }

  // What a script's tests run with (NT.tests.setup): how long, on which map, and its
  // parameters as its page shows them. A change holds from the next run on.
  // The sheet opens with the press: what has not arrived yet is its own layout with the
  // words left out, and comes in place.
  function testSettings(script) {
    const API = NT.api;
    const { hold, settle, ph } = NT.kit;
    const id = script.script_id;
    const set = NT.tests.setup(id);
    const values = Object.assign({}, set.values);
    let seconds = set.seconds, map = set.map;
    const limit = (API.mode === 'live' && NT.ext.info('tests').seconds) || NT.tests.seconds;
    const keep = () => NT.tests.configure(id, { seconds, map, values });
    const entry = ask(script);
    const known = entry.data;
    let maps = known ? known.maps : null;

    const shown = () => (seconds == null ? limit.usual : seconds);
    const time = h('span.param-value', clock(shown()));
    const timeReset = h('button.param-reset', { type: 'button', hidden: seconds == null }, 'Reset');
    const setTime = (v) => {
      seconds = v === limit.usual ? null : v;
      time.textContent = clock(v);
      timeReset.hidden = seconds == null;
      keep();
    };
    const slider = UI.slider({ min: limit.least, max: limit.most, step: 5, value: shown(), label: 'Duration', onInput: setTime });
    timeReset.addEventListener('click', () => { slider.set(limit.usual); setTime(limit.usual); });

    const mapValue = h('span');
    const mapPick = h('button.row-pick', { type: 'button', 'aria-label': 'Map' }, mapValue, icon('updown', 15));
    // A map of the author's is known by its name once their maps have arrived.
    const syncMap = () => {
      const m = map && maps && maps.find((x) => x.user_map_id === map.id);
      const waiting = !!map && !maps;
      mapValue.classList.toggle('ph', waiting);
      if (waiting) mapValue.replaceChildren(h('span.ph-bar', { style: { '--w': '5em' } }));
      else mapValue.textContent = map === undefined ? 'Default' : m ? m.name : 'None';
    };
    const pickMap = (next) => () => { map = next; syncMap(); keep(); };
    mapPick.addEventListener('click', () => UI.menu(mapPick, [
      { label: 'Default', checked: map === undefined, onSelect: pickMap(undefined) },
      { label: 'None', checked: map === null, onSelect: pickMap(null) },
      maps && maps.length ? '-' : null,
      ...(maps || []).map((m) => ({ label: m.name, checked: !!map && map.id === m.user_map_id, onSelect: pickMap({ id: m.user_map_id, internal: m.internal_id }) })),
    ]));
    syncMap();

    const groups = (params) => (params.length ? [h('h3.list-header', 'Parameters'), NT.kit.paramGroups(params, values, keep)] : []);
    const rest = h('div');
    if (known) rest.append(...groups(known.params));
    else hold(rest, [h('h3.list-header.ph', h('span.ph-bar', { style: { '--w': '6em' } })), h('div.param-groups', [0, 1, 2].map((i) => h('div.list', ph.row({}, i))))]);

    const body = h('div',
      h('div.list',
        h('div.row.param.col', h('div.param-head', h('span.row-title', 'Duration'), timeReset, time), slider.el),
        h('div.row', h('span.row-title', 'Map'), mapPick)),
      rest);
    const sheet = UI.sheet({ title: 'Test Settings', body });
    if (!known) {
      entry.pending.then((data) => {
        maps = data.maps;
        if (!sheet.panel.isConnected) return;
        syncMap();
        settle(rest, groups(data.params));
      });
    }
    return sheet;
  }
  // The editor says a script's tests can be set up, before anyone asks to.
  testSettings.ready = (script) => void ask(script);

  function testsView({ onRun, onClose, onSettings }) {
    let run = null, off = null, drawn = 0, tone = '';
    let view = 'output', kind = 'all', query = '';

    const mark = h('span.tests-mark', { 'aria-hidden': 'true' });
    // Announced when it changes. The detail beside it is a running clock, and is not.
    const title = h('b', { 'aria-live': 'polite' }), detail = h('span');
    const label = h('span', 'Run');
    // On the page's own surface there is nothing to bend: the light, without the lens.
    const act = NT.glass.shine(h('button.pill-btn.glass.interactive.tests-act', { type: 'button' }, label));
    const close = onClose
      ? NT.glass.shine(h('button.tests-close.glass.interactive', { type: 'button', 'aria-label': 'Close', title: 'Close', onclick: onClose }, icon('xmark', 15)))
      : null;
    const settings = onSettings
      ? NT.glass.shine(h('button.tests-close.tests-settings.glass.interactive', { type: 'button', 'aria-label': 'Test Settings', title: 'Test Settings', onclick: () => onSettings() }, icon('sliders', 16)))
      : null;
    const views = UI.segmented([{ value: 'output', label: 'Output' }, { value: 'state', label: 'State' }], view, (v) => {
      view = v;
      lines.hidden = v !== 'output';
      state.hidden = v !== 'state';
      if (v === 'state') table();
      else lines.scrollTop = lines.scrollHeight;
    });
    views.el.classList.add('seg-inline', 'tests-views');
    views.el.setAttribute('aria-label', 'Show');

    const fill = h('i');
    const bar = h('div.tests-bar', { role: 'progressbar', 'aria-label': 'Progress' }, fill);
    const lines = h('ol.tests-lines', { role: 'log', 'aria-label': 'Output', tabindex: '0' });

    // The battle: which objects, a search, and a row for each.
    const kinds = UI.segmented(NT.tests.kinds.map((k) => ({ value: k.id, label: k.label })), kind, (v) => { kind = v; table(); });
    kinds.el.classList.add('tests-kinds');
    kinds.el.setAttribute('aria-label', 'Kind');
    const search = h('input.tests-search', { type: 'search', placeholder: 'Search', 'aria-label': 'Search', autocapitalize: 'off', spellcheck: false });
    search.addEventListener('input', debounce(() => { query = search.value; table(); }, 120));
    const summary = h('p.tests-summary');
    const head = h('thead'), body = h('tbody');
    const none = h('p.tests-none');
    const grid = h('div.tests-grid', { tabindex: '0', 'aria-label': 'Battle' }, h('table.tests-table', head, body), none);
    const state = h('div.tests-state', { hidden: true }, h('div.tests-tools', kinds.el, search), summary, grid);

    const el = h('section.tests', { 'aria-label': 'Test' },
      h('header.tests-head', mark, h('div.tests-title', title, detail), views.el, act, settings, close),
      bar, h('div.tests-body', lines, state));

    act.addEventListener('click', () => {
      if (run && !run.done) run.stop();
      else onRun(act);
    });

    function heading() {
      const w = run.words();
      title.textContent = w.title;
      detail.textContent = w.detail;
      label.textContent = run.done ? 'Run Again' : 'Stop';
      if (w.tone !== tone) {
        tone = w.tone;
        el.dataset.tone = tone;
        mark.replaceChildren(tone === 'busy' ? h('span.spinner') : icon(tone === 'good' ? 'check' : tone === 'bad' ? 'xmark' : 'reset', 13));
      }
      // No telling how long: the line travels. Otherwise it fills.
      const open = w.progress === null && tone === 'busy';
      bar.classList.toggle('is-open', open);
      if (open) bar.removeAttribute('aria-valuenow');
      else bar.setAttribute('aria-valuenow', String(Math.round((w.progress || 0) * 100)));
      fill.style.transform = open ? '' : `scaleX(${w.progress || 0})`;
    }

    // New lines go on the end; the list follows them unless it has been scrolled back.
    function print() {
      const follow = lines.scrollHeight - lines.scrollTop - lines.clientHeight < 24;
      const empty = lines.querySelector('.tests-none');
      if (empty && run.lines.length) empty.remove();
      for (; drawn < run.lines.length; drawn++) {
        const line = run.lines[drawn];
        // A level is what the game said: beside the script (log), or that it stopped it.
        lines.append(h('li' + (line.level ? '.is-' + line.level : ''), line.text));
      }
      if (run.done && !run.lines.length && !lines.firstChild) lines.append(h('li.tests-none', 'Nothing printed'));
      if (follow) lines.scrollTop = lines.scrollHeight;
    }

    // Drawn only while it is looked at: a battle is a new table every second.
    function table() {
      if (view !== 'state' || !run) return;
      const s = NT.tests.state(run, { kind, query });
      summary.textContent = s.summary;
      if (!head.firstChild) head.append(h('tr', s.columns.map((c) => h('th' + (c.number ? '.is-number' : ''), { scope: 'col' }, c.label))));
      body.replaceChildren(...s.rows.map((r) => h('tr' + (r.own ? '.is-own' : ''),
        s.columns.map((c) => h('td' + (c.number ? '.is-number' : ''), r[c.id])))));
      none.textContent = s.rows.length ? '' : s.none;
      none.hidden = !!s.rows.length;
    }

    function show(next) {
      if (next === run) return;
      if (off) off();
      run = next;
      drawn = 0;
      tone = '';
      lines.replaceChildren();
      off = run.on((r, what) => {
        if (what === 'line') return void print();
        if (what === 'shot') return void table();
        heading();
        if (what === 'state') {
          print();
          table();
        }
      });
      heading();
      print();
      table();
    }

    return {
      el,
      show,
      dispose() {
        if (off) off();
      },
    };
  }

  NT.kit.testsView = testsView;
  NT.kit.testSettings = testSettings;
})();
