/*
  Material Design 2: a test run, drawn. What a run is, and every word said about it, is
  the core's (js/tests.js); this is how this style shows it. The editor puts the panel
  in a standard side sheet beside the code on a wide window and in a bottom sheet on a
  narrow one (editor.js).

    NT.md2.tests({ onRun, onClose, onSettings })  → { el, show(run), dispose() }
      onRun(source)   the button in the heading, once the run is over
      onClose         the side sheet's own close button (a bottom sheet closes itself;
                      it is hidden there)
      onSettings      Test Settings, an icon button beside it
    NT.md2.testSettings(script)   the dialog of what its tests run with

  From the top: the run's own words, the linear progress indicator edge to edge, tabs
  for Output and State, and under them either what the script printed or the battle as
  a table: its kinds as choice chips, a search bar, how many, and Material's data table.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h, clamp, debounce } = NT.util;
  const M = NT.md2;
  const UI = NT.ui;

  /* ---------- Test Settings ----------
     What a script's tests run with (NT.tests.setup): how long, on which map, and its
     parameters as its page shows them. Each change holds at once, from the next run on,
     so the dialog has no Cancel, only Done. */

  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  let settingsOpen = false;

  M.testSettings = async function (script) {
    if (settingsOpen) return;
    settingsOpen = true;
    const API = NT.api;
    const id = script.script_id;
    const set = NT.tests.setup(id);
    const values = Object.assign({}, set.values);
    let seconds = set.seconds, map = set.map;
    const limit = (API.mode === 'live' && NT.ext.info('tests').seconds) || NT.tests.seconds;
    const keep = () => NT.tests.configure(id, { seconds, map, values });
    const [params, maps] = await Promise.all([
      API.parameters(id).catch(() => []),
      API.maps(script.author_uuid).catch(() => []),
    ]);

    // How long, as m:ss, with the way back to the usual where it is not that.
    const shown = () => (seconds == null ? limit.usual : seconds);
    const time = h('span.m-param-value', clock(shown()));
    // (Reset goes once it has done its work; the keyboard moves on to the slider.)
    const reset = M.button('Reset', () => { slider.set(limit.usual); setTime(limit.usual); slider.el.querySelector('input').focus({ preventScroll: true }); }, { variant: 'text' });
    reset.hidden = seconds == null;
    const setTime = (v) => {
      seconds = v === limit.usual ? null : v;
      time.textContent = clock(v);
      reset.hidden = seconds == null;
      keep();
    };
    const slider = M.slider({ min: limit.least, max: limit.most, step: 5, value: shown(), label: 'Duration', onInput: setTime });

    // Which map: the script's own, none, or one of its author's.
    const mapValue = h('span');
    const mapPick = h('button.m-pick.m-press', { type: 'button', 'aria-label': 'Map' }, mapValue, M.icon('expand_more', { size: 20 }));
    const syncMap = () => {
      const m = map && maps.find((x) => x.user_map_id === map.id);
      mapValue.textContent = map === undefined ? 'Default' : m ? m.name : 'None';
    };
    const pickMap = (next) => () => { map = next; syncMap(); keep(); };
    mapPick.addEventListener('click', () => UI.menu(mapPick, [
      { label: 'Default', checked: map === undefined, onSelect: pickMap(undefined) },
      { label: 'None', checked: map === null, onSelect: pickMap(null) },
      maps.length ? '-' : null,
      ...maps.map((m) => ({ label: m.name, checked: !!map && map.id === m.user_map_id, onSelect: pickMap({ id: m.user_map_id, internal: m.internal_id }) })),
    ]));
    syncMap();

    const body = h('div.m-settings',
      M.list(
        h('div.m-item.col', h('div.m-param-head', h('span.m-item-headline', 'Duration'), reset, time), slider.el),
        h('div.m-item', h('span.m-item-text', h('span.m-item-headline', 'Map')), mapPick)),
      params.length ? M.header('Parameters') : null,
      params.length ? M.kit.paramGroups(params, values, keep) : null);
    const d = M.dialog({
      title: 'Test Settings',
      body,
      scroll: true,
      wide: true,
      actions: [M.button('Done', () => d.close(), { variant: 'text' })],
      onClose: () => { settingsOpen = false; },
    });
    return d;
  };

  /* ---------- The linear progress indicator ----------
     As Material Components draws it (mdc-linear-progress): 4 high, a bar of primary on
     its track. Determinate, the bar grows over 250 ms; with no telling how long, two
     bars cross the track in a 2 s cycle (style.css has the keyframes). Once it is over
     it fades away over 250 ms and leaves its place. */

  function progress() {
    const bar = h('div.m-progress-bar.primary', h('span'));
    const el = h('div.m-progress', { role: 'progressbar', 'aria-label': 'Test', 'aria-valuemin': '0', 'aria-valuemax': '100' },
      h('div.m-progress-track'), bar, h('div.m-progress-bar.secondary', h('span')));
    return {
      el,
      // 'open' (no telling how long), a number from 0 to 1, or 'off' (gone).
      set(next, jump) {
        el.classList.toggle('is-off', next === 'off');
        // Going, it keeps doing what it did.
        if (next === 'off') return;
        // A value it comes to from crossing the track is where it starts.
        if (el.classList.contains('is-open') && next !== 'open') jump = true;
        el.classList.toggle('is-open', next === 'open');
        if (next === 'open') return void el.removeAttribute('aria-valuenow');
        const p = clamp(next, 0, 1);
        el.setAttribute('aria-valuenow', String(Math.round(p * 100)));
        if (jump) bar.style.transition = 'none';
        bar.style.transform = `scaleX(${p})`;
        if (jump) {
          void bar.offsetWidth;
          bar.style.transition = '';
        }
      },
      dispose() {},
    };
  }

  /* ---------- Choice chips ----------
     One kind of object at a time, as Material Components' choice chip: 32 high and
     round, body 2, 12 either side, on surface at 10 %; the chosen one primary at 24 %
     with its label in primary, and no check, so that it is as wide chosen as not. The
     arrow keys move the choice, as in any group of radio buttons. */

  function chips(options, value, onChange) {
    const el = h('div.m-chips', { role: 'radiogroup' });
    let cur = value;
    const items = options.map((o) => {
      const b = h('button.m-chip.m-press', { type: 'button', role: 'radio', onclick: () => { if (cur !== o.value) { set(o.value); onChange(o.value); } } },
        h('span', o.label));
      el.append(b);
      return [o.value, b];
    });
    function set(v) {
      cur = v;
      for (const [val, b] of items) {
        b.setAttribute('aria-checked', String(val === v));
        b.tabIndex = val === v ? 0 : -1;
      }
    }
    el.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      const i = items.findIndex(([v]) => v === cur) + step;
      if (!step || !items[i]) return;
      e.preventDefault();
      items[i][1].focus();
      items[i][1].click();
    });
    set(value);
    return { el, set };
  }

  /* ---------- The panel ---------- */

  M.tests = function ({ onRun, onClose, onSettings }) {
    let run = null, off = null, drawn = 0, tone = '';
    let view = 'output', kind = 'all', query = '';

    const verdict = h('span.m-tests-verdict');
    const title = h('span', { 'aria-live': 'polite' });
    const detail = h('p.m-tests-detail');
    const act = M.button('Stop', () => {
      if (run && !run.done) run.stop();
      else onRun(act);
    }, { variant: 'outlined', cls: '.m-tests-act' });
    const actLabel = act.querySelector('span');
    const close = M.iconButton('close', 'Close', onClose, { cls: '.m-tests-close' });
    const settings = onSettings ? M.iconButton('tune', 'Test Settings', () => onSettings(), { cls: '.m-tests-settings' }) : null;
    const bar = progress();

    // What is shown under it: tabs, as every choice between views of something here.
    const views = M.group([{ value: 'output', label: 'Output' }, { value: 'state', label: 'State' }], view, (v) => {
      view = v;
      lines.hidden = v !== 'output';
      state.hidden = v !== 'state';
      if (v === 'state') table();
      else lines.scrollTop = lines.scrollHeight;
    });
    views.el.classList.add('m-tests-views');
    views.el.setAttribute('aria-label', 'Show');

    const lines = h('ol.m-tests-lines', { role: 'log', 'aria-label': 'Output', tabindex: '0' });

    // The battle: which objects, a search, how many, and a row for each.
    const kinds = chips(NT.tests.kinds.map((k) => ({ value: k.id, label: k.label })), kind, (v) => { kind = v; table(); });
    kinds.el.classList.add('m-tests-kinds');
    kinds.el.setAttribute('aria-label', 'Kind');
    const search = h('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search', autocapitalize: 'off', spellcheck: false, enterKeyHint: 'search' });
    search.addEventListener('input', debounce(() => { query = search.value; table(); }, 120));
    const summary = h('p.m-tests-summary');
    const head = h('thead'), body = h('tbody');
    const none = h('p.m-tests-none', { hidden: true });
    const grid = h('div.m-tests-grid', { tabindex: '0', role: 'region', 'aria-label': 'Battle' }, h('table.m-table', head, body), none);
    const state = h('div.m-tests-state', { hidden: true },
      kinds.el, h('label.m-search.m-tests-search', M.icon('search'), search), summary, grid);

    const el = h('section.m-tests', { 'aria-label': 'Test' },
      h('header.m-tests-head', h('h3.m-tests-title', verdict, title), h('div.m-tests-tools', settings, close), detail, act),
      bar.el, views.el, h('div.m-tests-body', lines, state));

    function heading(jump) {
      const w = run.words();
      title.textContent = w.title;
      detail.textContent = w.detail;
      actLabel.textContent = run.done ? 'Run Again' : 'Stop';
      if (w.tone !== tone) {
        tone = w.tone;
        el.dataset.tone = tone;
        const mark = tone === 'good' ? 'check_circle' : tone === 'bad' ? 'error' : null;
        verdict.replaceChildren(...(mark ? [M.icon(mark)] : []));
        if (mark && !jump) M.play(verdict, [{ transform: 'scale(0.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], M.motion.spatialFast);
      }
      bar.set(run.done ? 'off' : w.progress === null ? (tone === 'busy' ? 'open' : 'off') : w.progress, jump);
    }

    // New lines go on the end; the list follows them unless it has been scrolled back.
    function print() {
      const follow = lines.scrollHeight - lines.scrollTop - lines.clientHeight < 24;
      const empty = lines.querySelector('.m-tests-none');
      if (empty && run.lines.length) empty.remove();
      for (; drawn < run.lines.length; drawn++) {
        const line = run.lines[drawn];
        // A level is what the game said: beside the script (log), or that it stopped it.
        const log = !!line.level;
        lines.append(h('li' + (log ? '.is-' + (line.level === 'error' ? 'error' : 'warning') : ''),
          log ? M.icon(line.level === 'error' ? 'error' : 'warning', { size: 16 }) : null,
          h('span', line.text)));
      }
      if (run.done && !run.lines.length && !lines.firstChild) lines.append(h('li.m-tests-none', 'Nothing printed'));
      if (follow) lines.scrollTop = lines.scrollHeight;
    }

    // Drawn only while it is looked at: a battle is a new table every second. Every
    // object in sight has its row, and what the filter leaves out is collapsed, so the
    // columns are as wide as all of them need and do not move as the filter changes.
    function table() {
      if (view !== 'state' || !run) return;
      const shown = NT.tests.state(run, { kind, query });
      const all = kind === 'all' && !query.trim() ? shown : NT.tests.state(run);
      const keep = all === shown ? null : new Set(shown.rows.map((r) => r.id));
      summary.textContent = shown.summary;
      if (!head.firstChild) head.append(h('tr', all.columns.map((c) => h('th' + (c.number ? '.is-number' : ''), { scope: 'col' }, c.label))));
      body.replaceChildren(...all.rows.map((r) => h('tr' + (r.own ? '.is-own' : '') + (keep && !keep.has(r.id) ? '.is-out' : ''),
        all.columns.map((c) => h('td' + (c.number ? '.is-number' : ''), r[c.id])))));
      none.textContent = shown.rows.length ? '' : shown.none;
      none.hidden = !!shown.rows.length;
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
        heading(false);
        if (what === 'state') {
          print();
          table();
        }
      });
      heading(true);
      print();
      table();
    }

    return {
      el,
      show,
      dispose() {
        if (off) off();
        bar.dispose();
      },
    };
  };
})();
