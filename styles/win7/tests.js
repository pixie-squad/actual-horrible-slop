/*
  A test run (js/tests.js), as Windows 7 shows it: a pane docked along the bottom of
  the editor's window, headed in the pale blue of Explorer's command bar with the
  pane's name and a flat Close that lights under the pointer as the bar's buttons do.

  Under the heading: where the run stands, said as Windows 7 says it in a progress
  dialog, larger and in the heading colour; the Aero progress bar; a push button. Then
  a tab control with two pages. Output is what the script printed, in a white field in
  the code's font, with Windows 7's warning and error icons on what the game complained
  of, as Event Viewer marks them. State is the battle as a list view in details view: a
  drop-down list of the kinds of object and a search box, the count beside them, and a
  row for each object under a header whose headings sort it.

    W.testsPane({ onRun, onClose })  → { el, show(run), run, dispose() }
      onRun     Run Again
      onClose   the heading's Close; the run goes on

  Every word is the core's (run.words(), NT.tests.state()). The bar is Windows 7's
  glossy green, with the light that runs along it while it is filling; while there is
  no telling how long, its marquee goes along the well instead.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h, debounce } = NT.util;
  const W = NT.w7;
  let seq = 0;

  const cross = () => {
    const t = document.createElement('template');
    t.innerHTML = '<svg width="9" height="9" viewBox="0 0 9 9" aria-hidden="true"><path d="M1.2 1.2l6.6 6.6M7.8 1.2L1.2 7.8" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
    return t.content.firstChild;
  };

  // A number column sorts by its number (HP by what is left); one with none goes first.
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isNaN(n) ? -Infinity : n;
  };

  W.testsPane = function ({ onRun, onClose }) {
    let run = null, off = null, drawn = 0;
    let view = 'output', kind = 'all', query = '', table = null;
    const id = 'tests' + ++seq;

    const title = h('span.w-tests-title');
    const detail = h('span.w-tests-detail');
    const fill = h('i');
    const bar = h('div.w-progress', { role: 'progressbar', 'aria-label': 'Test', 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill);
    const act = W.button('Stop', () => {
      if (run && !run.done) run.stop();
      else onRun();
    });
    const close = h('button.w-tests-x', { type: 'button', 'aria-label': 'Close', title: 'Close', onclick: () => onClose() }, cross());

    // Output: what the script printed.
    const lines = h('div.w-tests-out', { role: 'log', 'aria-label': 'Output', tabIndex: 0 });

    // State: which objects, a search, how many, and the list view.
    const kinds = W.combo(NT.tests.kinds.map((k) => [k.id, k.label]), kind, (v) => { kind = v; draw(); });
    kinds.el.id = id + '-kind';
    // Windows 7's search box: its cue in the field, the magnifying glass at its end.
    const search = W.search({ placeholder: 'Search', 'aria-label': 'Search' });
    search.addEventListener('input', debounce(() => { query = search.value; draw(); }, 120));
    const summary = h('span.w-tests-summary');
    const columns = NT.tests.state(null).columns;
    const list = W.list(columns.map((c) => ({
      label: c.label,
      width: `var(--tc-${c.id}, 80px)`,
      align: c.number ? 'right' : null,
      // This client's own character is in bold.
      cell: (r) => (r.own ? h('span.is-own', r[c.id]) : r[c.id]),
      sort: c.number ? (a, b) => num(a[c.id]) - num(b[c.id]) : (a, b) => a[c.id].localeCompare(b[c.id]),
    })), { label: 'Battle', empty: () => (table ? table.none : '') });
    list.el.classList.add('w-tests-list');
    // A column of numbers has its heading at the same side as they are.
    list.el.querySelectorAll('.w-col').forEach((b, i) => b.classList.toggle('right', !!columns[i].number));
    const state = h('div.w-tests-state',
      h('div.w-tests-tools', h('label', { for: kinds.el.id }, 'Kind:'), kinds.el, search, summary),
      list.el);

    const tabs = W.tabs([{ id: 'output', label: 'Output', body: lines }, { id: 'state', label: 'State', body: state }], view, (v) => {
      view = v;
      if (v === 'state') draw();
      else lines.scrollTop = lines.scrollHeight;
    });
    tabs.el.classList.add('w-tests-tabs');

    const el = h('section.w-tests', { 'aria-label': 'Test', hidden: true },
      h('div.w-tests-cap', h('span', 'Test'), close),
      h('div.w-tests-head', h('div.w-tests-words', { 'aria-live': 'polite' }, title, detail), bar, act),
      tabs.el);

    function head() {
      const w = run.words();
      title.textContent = w.title;
      detail.textContent = w.detail;
      detail.hidden = !w.detail;
      act.firstChild.textContent = run.done ? 'Run Again' : 'Stop';
      el.dataset.tone = w.tone;
      const open = w.progress === null && w.tone === 'busy';
      bar.classList.toggle('is-open', open);
      const part = open || run.done ? 0 : w.progress || 0;
      if (open) bar.removeAttribute('aria-valuenow');
      else bar.setAttribute('aria-valuenow', String(Math.round(part * 100)));
      fill.style.setProperty('--p', String(part));
    }

    // New lines go on the end; the field follows them unless it has been scrolled back.
    function print() {
      const follow = lines.scrollHeight - lines.scrollTop - lines.clientHeight < 18;
      const none = lines.querySelector('.w-tests-none');
      if (none && run.lines.length) none.remove();
      for (; drawn < run.lines.length; drawn++) {
        const line = run.lines[drawn];
        const level = line.kind === 'log' ? (line.level === 'error' ? 'error' : 'warning') : null;
        lines.append(level
          ? h('div.is-' + level, W.icon(level, 16), h('span', line.text))
          : h('div', h('span', line.text)));
      }
      if (run.done && !run.lines.length && !lines.firstChild) lines.append(h('div.w-tests-none', 'Nothing printed'));
      if (follow) lines.scrollTop = lines.scrollHeight;
    }

    // Read again only while it is looked at: a battle is a new table every second. The
    // row that was chosen stays chosen.
    function draw() {
      if (view !== 'state' || !run) return;
      table = NT.tests.state(run, { kind, query });
      summary.textContent = table.summary;
      list.set(table.rows, (a, b) => a.id === b.id);
    }

    function show(next) {
      if (next === run) return;
      if (off) off();
      run = next;
      drawn = 0;
      lines.replaceChildren();
      off = run.on((r, what) => {
        if (what === 'line') return void print();
        if (what === 'shot') return void draw();
        head();
        if (what === 'state') {
          print();
          draw();
        }
      });
      head();
      print();
      draw();
    }

    return {
      el,
      show,
      get run() { return run; },
      dispose() {
        if (off) off();
      },
    };
  };
})();
