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

  function testsView({ onRun, onClose }) {
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
      h('header.tests-head', mark, h('div.tests-title', title, detail), views.el, act, close),
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
        lines.append(h('li' + (line.kind === 'log' ? '.is-' + line.level : ''), line.text));
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
})();
