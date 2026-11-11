/*
  The explorer: a project's files as a tree.

  It is content, not chrome: an opaque list. The editor page (editor.js) puts it beside
  the code on a wide window and in a sheet on a narrow one, and says what the project
  is through `ctx`, which every view of the same project shares:

    ctx.paths()              every file
    ctx.current()            the file on screen, or null
    ctx.mark(path)           '' | 'edited' | 'error'
    ctx.open(path)
    ctx.create(path)         a new, empty file
    ctx.rename(from, to)
    ctx.remove(path)
    ctx.minify()  ctx.setMinify(on)
    ctx.folded               Set of the folders that are closed

    NT.explorer(ctx, { onPick })  → { el, refresh(), focus() }
      onPick(path, keys)     a file was chosen here (keys: with the keyboard)

  Folders exist only as part of a path: typing lib/util.luau makes lib. The entry file
  can be neither renamed nor deleted.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h } = NT.util;
  const icon = NT.icon;
  const UI = NT.ui;
  const Project = NT.project;

  const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1);
  const parentOf = (path) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

  NT.explorer = function (ctx, opts = {}) {
    const tree = h('div.ex-tree', { role: 'tree', 'aria-label': 'Files' });
    const add = h('button.ex-new', { type: 'button', onclick: () => edit({ fresh: true }) }, icon('plus', 20), h('span', 'New File'));
    const more = h('button.ex-more', { type: 'button', 'aria-label': 'More', title: 'More', onclick: () => UI.menu(more, [
      { label: 'Minify', checked: ctx.minify(), onSelect: () => ctx.setMinify(!ctx.minify()) },
    ]) }, icon('ellipsis', 20));
    const el = h('div.explorer', h('div.ex-bar', add, more), tree);

    const rows = new Map(); // path → row; kept between refreshes so a row can animate and keep focus
    let editing = null;     // { fresh: true } or { path }: the row that is a text field
    let field = null;
    let focused = null;     // the row the keyboard is on
    let pressed = 0;        // when a press-and-hold last opened a menu

    function visible() {
      const out = [];
      (function walk(nodes, depth) {
        for (const node of nodes) {
          out.push({ node, depth });
          if (node.kids && !ctx.folded.has(node.path)) walk(node.kids, depth + 1);
        }
      })(Project.tree(ctx.paths()), 0);
      return out;
    }

    function makeRow(node) {
      const row = h('div.ex-row', { role: 'treeitem', tabIndex: -1, dataset: { path: node.path } },
        node.kids ? h('span.ex-twist', icon('chevron-right', 12)) : h('span.ex-twist'),
        icon(node.kids ? 'folder' : 'doc', 18),
        h('span.ex-name', node.name),
        h('i.ex-mark'));
      row._folder = !!node.kids;
      return row;
    }

    // A folder shows the mark of what is inside it, so a problem in a closed folder is not hidden.
    function markOf(node) {
      if (!node.kids) return ctx.mark(node.path);
      let worst = '';
      for (const path of ctx.paths()) {
        if (!path.startsWith(node.path + '/')) continue;
        const m = ctx.mark(path);
        if (m === 'error') return m;
        worst = worst || m;
      }
      return worst;
    }

    function fieldRow() {
      const input = h('input.ex-input', { type: 'text', autocapitalize: 'off', autocomplete: 'off', spellcheck: false, 'aria-label': editing.fresh ? 'New file' : 'Name', placeholder: 'lib/util.luau', maxLength: 200 });
      const error = h('p.ex-error', { role: 'alert' });
      const row = h('div.ex-row.ex-edit', h('span.ex-twist'), icon('doc', 18), input, error);
      const was = editing;
      input.value = was.path || '';
      let finished = false;
      const finish = (commit) => {
        if (finished) return;
        const typed = input.value.trim();
        const path = Project.fix(ctx.paths(), typed);
        if (commit && typed && path !== was.path) {
          const wrong = Project.problem(ctx.paths(), path, was.path);
          if (wrong) return void (error.textContent = wrong);
        }
        finished = true;
        editing = field = null;
        const keys = row.contains(document.activeElement);
        if (commit && typed && path !== was.path) {
          if (was.fresh) {
            ctx.create(path);
            if (opts.onPick) opts.onPick(path, keys);
          } else ctx.rename(was.path, path);
          focused = path;
        }
        refresh();
        // Unless choosing the file has already sent the keyboard somewhere else.
        if (keys && (!document.activeElement || document.activeElement === document.body)) (rows.get(focused) || add).focus({ preventScroll: true });
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      });
      input.addEventListener('input', () => { error.textContent = ''; });
      // Leaving the field keeps a name that is fine and drops one that is not.
      input.addEventListener('blur', () => {
        const path = Project.fix(ctx.paths(), input.value.trim());
        finish(!!input.value.trim() && !Project.problem(ctx.paths(), path, was.path));
      });
      field = { row, input };
      return row;
    }

    function edit(what) {
      if (field) field.input.blur();
      if (what.path) {
        // Its folders have to be open for the row to be there.
        for (let p = parentOf(what.path); p; p = parentOf(p)) ctx.folded.delete(p);
      }
      editing = what;
      refresh();
      field.input.focus({ preventScroll: true });
      // The part that is usually changed: the name without its extension.
      const v = field.input.value, slash = v.lastIndexOf('/') + 1, dot = v.lastIndexOf('.');
      field.input.setSelectionRange(slash, dot > slash ? dot : v.length);
      field.row.scrollIntoView({ block: 'nearest' });
    }

    function refresh() {
      const list = visible();
      const live = new Set(list.map((it) => it.node.path));
      for (const path of [...rows.keys()]) if (!live.has(path)) rows.delete(path);
      const current = ctx.current();
      const had = tree.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.path : null;
      if (focused == null || !live.has(focused)) focused = live.has(current) ? current : list.length ? list[0].node.path : null;

      const kids = [];
      if (editing && editing.fresh) kids.push(field ? field.row : fieldRow());
      for (const { node, depth } of list) {
        if (editing && editing.path === node.path) {
          const row = field ? field.row : fieldRow();
          row.style.setProperty('--depth', depth);
          kids.push(row);
          continue;
        }
        let row = rows.get(node.path);
        if (!row || row._folder !== !!node.kids) rows.set(node.path, (row = makeRow(node)));
        row.style.setProperty('--depth', depth);
        row.setAttribute('aria-level', depth + 1);
        if (node.kids) row.setAttribute('aria-expanded', String(!ctx.folded.has(node.path)));
        else row.setAttribute('aria-selected', String(node.path === current));
        row.classList.toggle('is-open', node.path === current);
        row.dataset.mark = markOf(node);
        row.tabIndex = node.path === focused ? 0 : -1;
        kids.push(row);
      }
      // Only when the rows differ: putting a row back in the document drops its focus
      // and restarts whatever it was animating.
      if (kids.length !== tree.childElementCount || kids.some((k, i) => tree.children[i] !== k)) {
        tree.replaceChildren(...kids);
        if (had && rows.has(had)) rows.get(had).focus({ preventScroll: true });
      }
    }

    const rowOf = (target) => (target && target.closest ? target.closest('.ex-row:not(.ex-edit)') : null);

    function pick(row, keys) {
      const path = row.dataset.path;
      focused = path;
      if (row._folder) {
        if (ctx.folded.has(path)) ctx.folded.delete(path);
        else ctx.folded.add(path);
        return void refresh();
      }
      ctx.open(path);
      refresh();
      if (opts.onPick) opts.onPick(path, keys);
    }

    const fixed = (row) => row._folder || row.dataset.path === Project.ENTRY;

    async function remove(row) {
      if (fixed(row)) return;
      const path = row.dataset.path;
      const ok = await UI.confirm({ title: `Delete “${nameOf(path)}”?`, message: 'This can’t be undone.', confirmLabel: 'Delete', destructive: true, source: row });
      if (!ok || !ctx.paths().includes(path)) return;
      const list = visible().map((it) => it.node.path);
      const i = list.indexOf(path);
      focused = list[i + 1] || list[i - 1] || null;
      ctx.remove(path);
      refresh();
      if (rows.has(focused)) rows.get(focused).focus({ preventScroll: true });
    }

    function menu(row) {
      if (fixed(row)) return;
      const path = row.dataset.path;
      UI.menu(row, [
        // The menu closes back into its row first; then the row becomes the field.
        { label: 'Rename…', icon: 'pencil', onSelect: () => setTimeout(() => { if (ctx.paths().includes(path)) edit({ path }); }, NT.util.motion.snappy.duration) },
        '-',
        { label: 'Delete', icon: 'trash', danger: true, onSelect: () => remove(row) },
      ]);
    }

    tree.addEventListener('click', (e) => {
      const row = rowOf(e.target);
      // The tap that ends a press-and-hold belongs to the menu it opened.
      if (!row || Date.now() - pressed < 700) return;
      pick(row, e.detail === 0);
    });

    // Right-click, the menu key and Shift+F10 all arrive as this.
    tree.addEventListener('contextmenu', (e) => {
      const row = rowOf(e.target);
      if (!row) return;
      e.preventDefault();
      if (Date.now() - pressed > 700) menu(row);
    });

    // Touch: press and hold. (Not every touch browser sends contextmenu for it.)
    let hold = null;
    const release = () => {
      if (hold) clearTimeout(hold.timer);
      hold = null;
    };
    tree.addEventListener('pointerdown', (e) => {
      const row = rowOf(e.target);
      release();
      if (!row || e.pointerType === 'mouse') return;
      hold = { x: e.clientX, y: e.clientY, timer: setTimeout(() => {
        hold = null;
        if (fixed(row)) return;
        pressed = Date.now();
        menu(row);
        // The menu opens under the finger. Lifting it must not choose the item there:
        // the tap that ends this touch is dropped; the next touch is free again.
        const drop = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        document.addEventListener('click', drop, { capture: true, once: true });
        document.addEventListener('pointerdown', () => document.removeEventListener('click', drop, true), { capture: true, once: true });
      }, 480) };
    });
    tree.addEventListener('pointermove', (e) => { if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 10) release(); });
    tree.addEventListener('pointerup', release);
    tree.addEventListener('pointercancel', release);
    tree.addEventListener('scroll', release, { passive: true });

    tree.addEventListener('focusin', (e) => {
      const row = rowOf(e.target);
      if (!row || row.dataset.path === focused) return;
      if (rows.has(focused)) rows.get(focused).tabIndex = -1;
      focused = row.dataset.path;
      row.tabIndex = 0;
    });

    tree.addEventListener('keydown', (e) => {
      const row = rowOf(e.target);
      if (!row || e.target !== row || e.ctrlKey || e.metaKey || e.altKey) return;
      const list = [...tree.querySelectorAll('.ex-row:not(.ex-edit)')];
      const i = list.indexOf(row);
      const path = row.dataset.path;
      const to = (next) => {
        if (!next) return;
        next.focus({ preventScroll: true });
        next.scrollIntoView({ block: 'nearest' });
      };
      const open = row._folder && !ctx.folded.has(path);
      const act = {
        ArrowDown: () => to(list[i + 1]),
        ArrowUp: () => to(list[i - 1]),
        Home: () => to(list[0]),
        End: () => to(list[list.length - 1]),
        ArrowRight: () => (row._folder ? (open ? to(list[i + 1]) : pick(row, true)) : null),
        ArrowLeft: () => (open ? pick(row, true) : to(rows.get(parentOf(path)))),
        Enter: () => pick(row, true),
        ' ': () => pick(row, true),
        F2: () => { if (!fixed(row)) edit({ path }); },
        Delete: () => remove(row),
      }[e.key];
      if (!act) return;
      e.preventDefault();
      act();
    });

    refresh();
    return {
      el,
      refresh,
      focus() { (rows.get(focused) || add).focus({ preventScroll: true }); },
    };
  };
})();
