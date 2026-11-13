/*
  A test run (js/tests.js), as Windows 95 shows it: a tool window docked along the
  bottom of the editor's window, the way Visual Basic docks its Immediate window.

  Top to bottom: the small caption, with the pane's name and Close, in the window's
  colours while the pane has the keyboard and grey while it does not; a line with where
  the run stands, the progress bar and a push button; then a tab control with two
  pages. Output is what the script printed, in a sunken white field in the code's font.
  State is the battle as a list view in report view: a drop-down list of the kinds of
  object and a field to search by, the count beside them, and a row for each object
  under a header whose headings sort it.

    W.testsPane({ onRun, onClose })  → { el, show(run), run, dispose() }
      onRun     Run Again
      onClose   the caption's Close; the run goes on

  Every word is the core's (run.words(), NT.tests.state()). The bar is Windows 95's:
  blocks of the highlight colour in a thin sunken well. Windows 95's bar had no way to
  say it could not tell how long: while that is so the well stays empty and the pointer
  over the pane is the arrow with the hourglass, which is how Windows 95 said work was
  going on behind.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h, debounce } = NT.util;
  const W = NT.w95;
  let seq = 0;

  // The small caption's Close: Marlett's cross, at the size a tool window draws it.
  const cross = () => {
    const t = document.createElement('template');
    t.innerHTML = '<svg class="w-glyph" width="7" height="6" viewBox="0 0 7 6" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" d="M0 0h2v1H0zM5 0h2v1H5zM1 1h2v1H1zM4 1h2v1H4zM2 2h3v2H2zM1 4h2v1H1zM4 4h2v1H4zM0 5h2v1H0zM5 5h2v1H5z"/></svg>';
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
    const close = h('button.w-tb.w-tests-x', { type: 'button', tabIndex: -1, 'aria-label': 'Close', title: 'Close', onclick: () => onClose() }, cross());

    // Output: what the script printed.
    const lines = h('div.w-tests-out', { role: 'log', 'aria-label': 'Output', tabIndex: 0 });

    // State: which objects, a search, how many, and the list view.
    const kinds = W.combo(NT.tests.kinds.map((k) => [k.id, k.label]), kind, (v) => { kind = v; draw(); });
    kinds.el.id = id + '-kind';
    const search = W.input({ type: 'search', id: id + '-search' });
    search.addEventListener('input', debounce(() => { query = search.value; draw(); }, 120));
    const summary = h('span.w-tests-summary');
    const columns = NT.tests.state(null).columns;
    const list = W.list(columns.map((c) => ({
      label: c.label,
      width: `var(--tc-${c.id}, 80px)`,
      align: c.number ? 'right' : null,
      // This client's own character is in bold, as the thing a window is about is.
      cell: (r) => (r.own ? h('span.is-own', r[c.id]) : r[c.id]),
      sort: c.number ? (a, b) => num(a[c.id]) - num(b[c.id]) : (a, b) => a[c.id].localeCompare(b[c.id]),
    })), { label: 'Battle', empty: () => (table ? table.none : '') });
    list.el.classList.add('w-tests-list');
    // A column of numbers has its heading at the same side as they are.
    list.el.querySelectorAll('.w-col').forEach((b, i) => b.classList.toggle('right', !!columns[i].number));
    const state = h('div.w-tests-state',
      h('div.w-tests-tools',
        h('label', { for: kinds.el.id }, 'Kind:'), kinds.el,
        h('label.w-tests-find', { for: search.id }, 'Search:'), search,
        summary),
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
      // No telling how long: the well stays empty. Otherwise it fills, block by block.
      const open = w.progress === null && w.tone === 'busy';
      el.classList.toggle('is-waiting', open);
      const part = open || run.done ? 0 : w.progress || 0;
      if (open) bar.removeAttribute('aria-valuenow');
      else bar.setAttribute('aria-valuenow', String(Math.round(part * 100)));
      fill.style.setProperty('--p', String(part));
    }

    // New lines go on the end; the field follows them unless it has been scrolled back.
    function print() {
      const follow = lines.scrollHeight - lines.scrollTop - lines.clientHeight < 16;
      const none = lines.querySelector('.w-tests-none');
      if (none && run.lines.length) none.remove();
      for (; drawn < run.lines.length; drawn++) {
        const line = run.lines[drawn];
        lines.append(h('div' + (line.kind === 'log' ? '.is-' + line.level : ''), line.text));
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
