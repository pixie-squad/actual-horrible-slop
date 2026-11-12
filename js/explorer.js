/*
  The explorer: a project's files as a tree.

  It is content, not chrome: an opaque list. The editor page (editor.js) puts it beside
  the code on a wide window and in a sheet on a narrow one, and says what the project
  is through `ctx`, which every view of the same project shares:

    ctx.id                   the script (what is remembered about its tree is kept by it)
    ctx.paths()              every file
    ctx.current()            the file on screen, or null
    ctx.mark(path)           '' | 'edited' | 'error'
    ctx.text(path)
    ctx.open(path)
    ctx.create(path, text)   these three change the files and nothing else;
    ctx.rename(from, to)     ctx.changed() is called once after a set of them
    ctx.remove(path)
    ctx.changed()            the files changed: save, and draw every view again
    ctx.redraw()             only the tree changed (a fold, a choice, an empty folder)
    ctx.minify()  ctx.setMinify(on)

    NT.explorer(ctx, { onPick }) → { el, refresh(), focus() }
      onPick(path, into)     a file was opened from here (into: the code takes the keyboard)
    NT.explorer.forget(id)   the script is gone

  What it does is what a desktop editor's file tree does: files and folders are made,
  renamed, moved (dragged, or cut and pasted), copied, duplicated and deleted, one or
  several at a time; files come in from the device and go out to it; every change can
  be undone. The entry file can be copied, and nothing else.

  A folder is real only through the files in it: one with nothing inside is kept on
  this device (with which folders are open), and is not part of what is saved.

  How it moves: a folder opens and closes on a spring, and whatever a change displaces
  slides to where it now belongs (it is measured before and after, and animated from
  the one to the other). Nothing appears somewhere it did not travel to.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h, clamp, Spring, motion, store } = NT.util;
  const icon = NT.icon;
  // The style's own toast, dialog and menu, looked up when they are needed: the style
  // is loaded after this.
  const UI = {
    toast: (...a) => NT.ui.toast(...a),
    confirm: (...a) => NT.ui.confirm(...a),
    menu: (...a) => NT.ui.menu(...a),
  };
  const Project = NT.project;

  const ENTRY = Project.ENTRY;
  const INDENT = 18; // a level's indent where the style's CSS does not say (--ex-indent)
  const reduced = () => NT.util.reducedMotion();
  const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1);
  const parentOf = (path) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
  const join = (dir, name) => (dir ? dir + '/' + name : name);
  const within = (path, dir) => path.startsWith(dir + '/');
  const iconFor = (name, folder) => (folder ? 'folder' : /\.json$/i.test(name) ? 'braces' : 'doc-text');
  const unfocused = () => !document.activeElement || document.activeElement === document.body;
  const storeKey = (id) => 'nt.tree.' + id;

  // What every view of one project shares.
  function shared(ctx) {
    if (ctx.tree) return ctx.tree;
    const kept = store.get(storeKey(ctx.id), null) || {};
    const ok = (list) => (Array.isArray(list) ? list.filter((p) => typeof p === 'string' && !Project.badPath(p, true)) : []);
    const S = (ctx.tree = {
      dirs: new Set(ok(kept.dirs)), // folders that are there whether or not a file is in them
      open: new Set(ok(kept.open)), // the folders that are unfolded
      sel: new Set(),               // the rows that are chosen
      anchor: null,                 // where a range starts
      clip: null,                   // { paths, cut }
      undo: [],
      redo: [],
      busy: 0,                      // files are being changed: nothing is drawn in between
      moved: null,                  // old path → new, while the change that moved them is drawn
      born: null,                   // { path, rect }: a row that starts where its name was typed
      key: null,
      model: [],
      index: new Map(),             // path → { node, depth }
      keep() {
        const paths = ctx.paths();
        store.set(storeKey(ctx.id), {
          dirs: [...S.dirs].filter((d) => !paths.some((p) => within(p, d))),
          open: [...S.open],
        });
      },
    });
    return S;
  }

  NT.explorer = function (ctx, opts = {}) {
    const S = shared(ctx);
    const list = h('div.ex-list');
    const ghosts = h('div.ex-ghosts', { 'aria-hidden': 'true' });
    const root = h('div.ex-root', list, ghosts);
    const tree = h('div.ex-tree', { role: 'tree', 'aria-label': 'Files', 'aria-multiselectable': 'true' }, root);
    const button = (name, label, fn, cls) => h('button.ex-btn' + (cls || ''), { type: 'button', 'aria-label': label, title: label, onclick: fn }, icon(name, 20));
    const more = button('ellipsis', 'More', () => rootMenu());
    const el = h('div.explorer',
      h('div.ex-bar',
        button('doc-plus', 'New File', () => create('file'), '.new'),
        button('folder-plus', 'New Folder', () => create('folder'), '.new'),
        h('span.ex-gap'),
        button('collapse', 'Collapse All', () => { S.open.clear(); S.keep(); redraw(); }),
        more),
      tree);

    // How far the style's CSS indents a level, read once: only what slides sideways needs it.
    let indent = 0;
    const indentOf = () => indent || (indent = parseFloat(getComputedStyle(el).getPropertyValue('--ex-indent')) || INDENT);

    let nodes = new Map();   // path → { path, name, folder, depth, row, el, kids, dots, open, state }
    let shownPaths = new Set(); // the rows that could be seen when this was last drawn
    let lastSig = null;
    let lastCurrent;
    let lastOne = null;      // the one chosen row, for the highlight to travel from
    let built = false;
    let arranging = false;
    let editing = null;      // { fresh: 'file' | 'folder', dir } or { path }: a row that is a text field
    let field = null;
    let focused = null;      // the row the keyboard is on
    let pressed = 0;         // when a press-and-hold last opened a menu
    let swallow = false;     // the click that ends a drag is not a choice

    const redraw = () => (ctx.redraw ? ctx.redraw() : refresh());
    const viewOf = (target) => {
      const row = target && target.closest ? target.closest('.ex-row') : null;
      const v = row && row._v;
      return v && nodes.get(v.path) === v ? v : null;
    };

    /* ----- The tree ----- */

    function model() {
      const paths = ctx.paths();
      const files = new Set(paths);
      // A file that came from elsewhere wins over a folder of the same name.
      for (const d of [...S.dirs]) {
        for (let p = d; p; p = parentOf(p)) if (files.has(p)) { S.dirs.delete(d); break; }
      }
      const key = paths.join('\n') + '\0' + [...S.dirs].join('\n');
      if (key !== S.key) {
        S.key = key;
        S.model = Project.tree(paths, [...S.dirs]);
        S.index = new Map();
        (function walk(list, depth) {
          for (const node of list) {
            S.index.set(node.path, { node, depth });
            if (node.kids) walk(node.kids, depth + 1);
          }
        })(S.model, 0);
      }
      return S.model;
    }
    const exists = (path) => S.index.has(path);
    const isFolder = (path) => exists(path) && !!S.index.get(path).node.kids;
    const foldersIn = (path) => [...S.index.keys()].filter((p) => (p === path || within(p, path)) && isFolder(p));
    const filesIn = (path) => ctx.paths().filter((p) => within(p, path));
    // Without what is inside something else on the list.
    const tops = (paths) => paths.filter((p) => !paths.some((q) => q !== p && within(p, q)));

    function visible() {
      const out = [];
      (function walk(list) {
        for (const node of list) {
          out.push(node.path);
          if (node.kids && S.open.has(node.path)) walk(node.kids);
        }
      })(model());
      return out;
    }

    /* ----- Changes -----
       A change is a list of steps; doing one gives back the steps that undo it.

         add { path, text }   del { path }   mv { from, to }       files
         mkdir { path }       rmdir { path } mvdir { from, to }    folders, as the tree keeps them */

    function apply(steps) {
      const inverse = [];
      const has = (path) => ctx.paths().includes(path);
      // A folder outlives the last file in it.
      const hold = (path) => { for (let d = parentOf(path); d; d = parentOf(d)) S.dirs.add(d); };
      const rehome = (set, from, to) => {
        for (const p of [...set]) {
          if (p !== from && !within(p, from)) continue;
          set.delete(p);
          set.add(to + p.slice(from.length));
        }
      };
      // Files first: a folder is settled once what was in it has come or gone.
      const onFiles = (s) => s.t === 'add' || s.t === 'del' || s.t === 'mv';
      for (const s of steps.filter(onFiles).concat(steps.filter((x) => !onFiles(x)))) {
        if (s.t === 'add') {
          if (has(s.path)) continue;
          ctx.create(s.path, s.text);
          inverse.push({ t: 'del', path: s.path });
        } else if (s.t === 'del') {
          if (!has(s.path) || s.path === ENTRY) continue;
          inverse.push({ t: 'add', path: s.path, text: ctx.text(s.path) });
          hold(s.path);
          ctx.remove(s.path);
        } else if (s.t === 'mv') {
          if (!has(s.from) || has(s.to) || s.from === ENTRY) continue;
          hold(s.from);
          ctx.rename(s.from, s.to);
          S.moved.set(s.from, s.to);
          if (S.sel.delete(s.from)) S.sel.add(s.to);
          inverse.push({ t: 'mv', from: s.to, to: s.from });
        } else if (s.t === 'mkdir') {
          if (S.dirs.has(s.path)) continue;
          S.dirs.add(s.path);
          inverse.push({ t: 'rmdir', path: s.path });
        } else if (s.t === 'rmdir') {
          if (!S.dirs.delete(s.path)) continue;
          inverse.push({ t: 'mkdir', path: s.path });
        } else if (s.t === 'mvdir') {
          for (const p of S.index.keys()) if ((p === s.from || within(p, s.from)) && isFolder(p)) S.moved.set(p, s.to + p.slice(s.from.length));
          S.dirs.add(s.from);
          for (const set of [S.dirs, S.open, S.sel]) rehome(set, s.from, s.to);
          inverse.push({ t: 'mvdir', from: s.to, to: s.from });
        }
      }
      return inverse.reverse();
    }

    // Does the steps as one change. → the steps that undo it (none if nothing happened).
    function perform(steps, then) {
      S.busy++;
      S.moved = new Map();
      let inverse = [];
      try { inverse = apply(steps); } finally { S.busy--; }
      if (inverse.length && then) then();
      // Files changed, or only the tree did.
      if (inverse.some((s) => s.t === 'add' || s.t === 'del' || s.t === 'mv')) ctx.changed();
      else redraw();
      S.moved = null;
      S.keep();
      return inverse;
    }

    function run(steps, then) {
      const inverse = perform(steps, then);
      if (!inverse.length) return false;
      S.undo.push(inverse);
      if (S.undo.length > 60) S.undo.shift();
      S.redo.length = 0;
      return true;
    }

    function travel(from, to) {
      const steps = from.pop();
      if (!steps) return;
      const inverse = perform(steps);
      if (inverse.length) to.push(inverse);
      focusRow(focused);
    }

    const moveSteps = (path, to) => (isFolder(path)
      ? filesIn(path).map((p) => ({ t: 'mv', from: p, to: to + p.slice(path.length) })).concat({ t: 'mvdir', from: path, to })
      : [{ t: 'mv', from: path, to }]);

    const removeSteps = (path) => (isFolder(path)
      ? filesIn(path).map((p) => ({ t: 'del', path: p })).concat(foldersIn(path).map((p) => ({ t: 'rmdir', path: p })))
      : [{ t: 'del', path }]);

    // Why `path` cannot become `to`, or ''.
    function blocked(path, to) {
      const folder = isFolder(path);
      const wrong = Project.problem(ctx.paths(), to, path, { folder, dirs: [...S.dirs] });
      if (wrong || !folder) return wrong;
      for (const p of filesIn(path)) {
        const bad = Project.badPath(to + p.slice(path.length));
        if (bad) return bad === 'depth' ? 'Too many levels' : 'Too long';
      }
      return '';
    }

    const fail = (why, name) => {
      UI.toast(name && /name|exists/i.test(why) ? `“${name}” already exists` : why, { warn: true });
      return false;
    };

    // A name nothing in `dir` has: name, name_copy, name_copy2, …
    function unique(dir, name, folder, used) {
      const dot = folder ? -1 : name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
      let pick = name;
      for (let i = 1; used.has(join(dir, pick).toLowerCase()); i++) pick = stem + '_copy' + (i > 1 ? i : '') + ext;
      used.add(join(dir, pick).toLowerCase());
      return pick;
    }
    const taken = () => new Set([...S.index.keys()].map((p) => p.toLowerCase()));

    // Moves or copies `paths` into the folder `dest` ('' is the top).
    function transfer(paths, dest, copy) {
      model();
      const steps = [], made = [], used = taken();
      const pending = ctx.paths().slice();
      for (const path of tops(paths.filter(exists))) {
        const folder = isFolder(path);
        if (folder && (dest === path || within(dest, path))) return fail('Can’t go inside itself');
        if (!copy) {
          const to = join(dest, nameOf(path));
          if (to === path || path === ENTRY) continue;
          const wrong = blocked(path, to);
          if (wrong) return fail(wrong, nameOf(path));
          steps.push(...moveSteps(path, to));
          made.push(to);
          continue;
        }
        const to = join(dest, unique(dest, nameOf(path), folder, used));
        for (const p of folder ? filesIn(path) : [path]) {
          const target = to + p.slice(path.length);
          const wrong = Project.problem(pending, target);
          if (wrong) return fail(wrong, nameOf(target));
          steps.push({ t: 'add', path: target, text: ctx.text(p) });
          pending.push(target);
        }
        if (folder) for (const p of foldersIn(path)) steps.push({ t: 'mkdir', path: to + p.slice(path.length) });
        made.push(to);
      }
      if (!steps.length) return false;
      for (let p = dest; p; p = parentOf(p)) S.open.add(p);
      return run(steps, () => {
        S.sel = new Set(made);
        S.anchor = focused = made[made.length - 1];
      });
    }

    function copyTo(cut) {
      model();
      const paths = tops([...S.sel].filter(exists)).filter((p) => !cut || p !== ENTRY);
      S.clip = paths.length ? { paths, cut } : null;
      redraw();
    }

    function paste(dest) {
      const clip = S.clip;
      if (!clip) return;
      if (transfer(clip.paths, dest, !clip.cut) && clip.cut) S.clip = null;
      redraw();
      focusRow(focused);
    }

    // The folder something new goes into: the chosen one, or the one the chosen file is in.
    function home() {
      model();
      const path = S.sel.size === 1 ? [...S.sel][0] : null;
      return path == null || !exists(path) ? '' : isFolder(path) ? path : parentOf(path);
    }

    async function remove() {
      model();
      const paths = tops([...S.sel].filter(exists)).filter((p) => p !== ENTRY);
      if (!paths.length) return;
      const v = nodes.get(paths.includes(focused) ? focused : paths[0]);
      const ok = await UI.confirm({
        title: paths.length > 1 ? `Delete ${paths.length} Items?` : `Delete “${nameOf(paths[0])}”?`,
        confirmLabel: 'Delete',
        destructive: true,
        source: v && v.dots,
      });
      if (!ok) return;
      model();
      const gone = (p) => paths.some((d) => p === d || within(p, d));
      const rows = visible();
      const last = rows.reduce((at, p, i) => (gone(p) ? i : at), -1);
      const next = rows.slice(last + 1).find((p) => !gone(p)) || rows.filter((p) => !gone(p)).pop() || null;
      run(paths.filter(exists).flatMap(removeSteps), () => {
        S.sel = new Set(next ? [next] : []);
        S.anchor = focused = next;
      });
      // The dialog is on its way out, and its button is where the keyboard still is.
      focusRow(focused);
    }

    /* ----- In and out ----- */

    const clean = (part) => part.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[.-]+/, '_').slice(0, 64);

    // items: [{ rel, file }]: files from the device, with the folders they came in.
    async function bring(items, dest) {
      const read = [];
      let skipped = 0;
      for (const it of items) {
        if (it.file.size > 1000000 || !/\.(luau|lua|json)$/i.test(it.rel)) { skipped++; continue; }
        try { read.push({ rel: it.rel, text: (await it.file.text()).replace(/\r\n?/g, '\n') }); } catch (e) { skipped++; }
      }
      model();
      if (dest && !isFolder(dest)) dest = '';
      const steps = [], made = [], used = taken(), pending = ctx.paths().slice();
      for (const it of read) {
        const parts = it.rel.split('/').filter(Boolean).map(clean);
        const name = parts.pop();
        const dir = parts.length ? join(dest, parts.join('/')) : dest;
        const to = join(dir, unique(dir, name, false, used));
        if (Project.problem(pending, to)) { skipped++; continue; }
        steps.push({ t: 'add', path: to, text: it.text });
        pending.push(to);
        made.push(to);
      }
      if (steps.length) {
        for (let p = dest; p; p = parentOf(p)) S.open.add(p);
        run(steps, () => {
          S.sel = new Set(made);
          S.anchor = focused = made[made.length - 1];
        });
      }
      if (skipped) UI.toast(`${skipped} skipped`, { warn: true });
    }

    function browse(dest) {
      const input = h('input', { type: 'file', multiple: true, accept: '.luau,.lua,.json' });
      input.addEventListener('change', () => bring([...input.files].map((file) => ({ rel: file.name, file })), dest));
      input.click();
    }

    // What was dropped, folders and all. The entries have to be asked for before anything is awaited.
    async function dropped(data) {
      const out = [];
      const entries = [...data.items].map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
      if (!entries.length) return [...data.files].map((file) => ({ rel: file.name, file }));
      async function walk(entry, base) {
        if (out.length > 600) return;
        if (entry.isFile) {
          out.push({ rel: base + entry.name, file: await new Promise((res, rej) => entry.file(res, rej)) });
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          for (;;) {
            const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
            if (!batch.length) break;
            for (const e of batch) await walk(e, base + entry.name + '/');
          }
        }
      }
      for (const entry of entries) await walk(entry, '').catch(() => {});
      return out;
    }

    function download(path) {
      const url = URL.createObjectURL(new Blob([ctx.text(path)], { type: 'text/plain' }));
      h('a', { href: url, download: nameOf(path) }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function copyPath(path) {
      try {
        await navigator.clipboard.writeText(path);
        UI.toast('Copied', { icon: 'copy' });
      } catch (e) { UI.toast('Couldn’t copy', { warn: true }); }
    }

    /* ----- Naming: a row that is a text field ----- */

    function create(kind, dir) {
      edit({ fresh: kind, dir: dir == null ? home() : dir });
    }

    function edit(what) {
      if (field) field.input.blur();
      model();
      if (what.path && (!exists(what.path) || what.path === ENTRY)) return;
      for (let p = what.fresh ? what.dir : parentOf(what.path); p; p = parentOf(p)) S.open.add(p);
      editing = what;
      refresh();
      if (!field) return;
      const { input, row } = field;
      input.focus({ preventScroll: true });
      // The part that is usually changed: the name without its extension.
      const dot = input.value.lastIndexOf('.');
      input.setSelectionRange(0, !field.folder && dot > 0 ? dot : input.value.length);
      row.scrollIntoView({ block: 'nearest' });
    }

    function makeField() {
      const was = editing;
      const folder = was.fresh ? was.fresh === 'folder' : isFolder(was.path);
      const base = was.fresh ? was.dir : parentOf(was.path);
      const input = h('input.ex-input', { type: 'text', autocapitalize: 'off', autocomplete: 'off', spellcheck: false, 'aria-label': was.fresh ? (folder ? 'New folder' : 'New file') : 'Name', placeholder: 'Name', maxLength: 200 });
      const error = h('p.ex-error', { role: 'alert' });
      let row;
      if (was.fresh) {
        row = h('div.ex-row.ex-edit', h('span.ex-twist', folder ? icon('chevron-right', 12) : null), icon(iconFor('', folder), 18), input, error);
      } else {
        row = nodes.get(was.path).row;
        row.classList.add('ex-edit');
        row.querySelector('.ex-name').after(input);
        row.append(error);
        input.value = nameOf(was.path);
      }
      // What was typed, as the path it means: beside the row, or inside the folder.
      const target = () => {
        const typed = input.value.trim();
        if (!typed) return '';
        return Project.fix(ctx.paths().concat([...S.dirs].map((d) => d + '/')), join(base, typed), folder);
      };
      const wrong = (path) => (was.fresh ? Project.problem(ctx.paths(), path, null, { folder, dirs: [...S.dirs] }) : blocked(was.path, path));
      let finished = false;
      const close = () => {
        finished = true;
        editing = field = null;
        if (was.fresh) return;
        input.remove();
        error.remove();
        row.classList.remove('ex-edit');
      };
      const finish = (commit) => {
        if (finished) return;
        model();
        const path = target();
        const change = commit && !!path && path !== was.path;
        if (change) {
          const why = wrong(path);
          if (why) return void (error.textContent = why);
        }
        const keys = row.contains(document.activeElement);
        const rect = was.fresh && row.isConnected ? row.getBoundingClientRect() : null;
        close();
        if (!change) refresh();
        else if (!was.fresh) {
          run(moveSteps(was.path, path), () => {
            S.sel = new Set([path]);
            S.anchor = focused = path;
          });
        } else {
          const steps = [];
          for (const dir of path.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))) {
            S.open.add(dir);
            if (!exists(dir)) steps.push({ t: 'mkdir', path: dir });
          }
          steps.push(folder ? { t: 'mkdir', path } : { t: 'add', path, text: '' });
          if (folder) S.open.add(path);
          // The row starts out where its name was typed.
          S.born = { path, rect };
          run(steps, () => {
            S.sel = new Set([path]);
            S.anchor = focused = path;
          });
          S.born = null;
          if (!folder) {
            ctx.open(path);
            if (opts.onPick) opts.onPick(path, keys);
          }
        }
        // Unless opening the file has already sent the keyboard somewhere else.
        if (keys && unfocused()) focusRow(focused);
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      });
      input.addEventListener('input', () => { error.textContent = ''; });
      // Leaving the field keeps a name that is fine and drops one that is not.
      input.addEventListener('blur', () => {
        if (arranging || S.busy) return;
        model();
        const path = target();
        finish(!!path && !wrong(path));
      });
      field = { row, input, folder, close };
    }

    /* ----- Drawing ----- */

    function makeView(node) {
      const folder = !!node.kids;
      const dots = h('button.ex-dots', { type: 'button', tabIndex: -1, 'aria-label': 'More', title: 'More' }, icon('ellipsis', 18));
      const row = h('div.ex-row', { role: 'treeitem', tabIndex: -1 },
        h('span.ex-twist', folder ? icon('chevron-right', 12) : null),
        icon(iconFor(node.name, folder), 18),
        h('span.ex-name', node.name),
        h('i.ex-mark'),
        dots);
      // el: what moves when this moves (a folder takes what is in it along). up: the folder it is in.
      const v = { path: node.path, name: node.name, folder, depth: -1, was: 0, up: null, row, dots, el: row, kids: null, inner: null, open: null, state: '', fx: null };
      if (folder) {
        v.inner = h('div.ex-kids-in');
        v.kids = h('div.ex-kids', { role: 'group', hidden: true }, v.inner);
        v.el = h('div.ex-node', row, v.kids);
      }
      row._v = v;
      return v;
    }

    function dress(v, node, depth, up) {
      if (v.name !== node.name) {
        if (iconFor(v.name, v.folder) !== iconFor(node.name, v.folder)) v.row.children[1].replaceWith(icon(iconFor(node.name, v.folder), 18));
        v.name = node.name;
        v.row.querySelector('.ex-name').textContent = node.name;
      }
      v.path = node.path;
      v.up = up;
      v.was = v.depth < 0 ? depth : v.depth;
      if (v.depth === depth) return;
      v.depth = depth;
      v.row.style.setProperty('--depth', depth);
      v.row.setAttribute('aria-level', depth + 1);
      if (v.kids) v.kids.style.setProperty('--depth', depth);
    }

    // Puts `els` in `box` in that order, touching only what is out of place: an element
    // that is put back in the document loses its focus and whatever it was animating.
    function arrange(box, els) {
      let at = box.firstChild;
      for (const item of els) {
        if (item === at) at = at.nextSibling;
        else box.insertBefore(item, at);
      }
      while (at) {
        const next = at.nextSibling;
        at.remove();
        at = next;
      }
    }

    // A folder shows the mark of what is inside it, so a problem in a closed folder is not hidden.
    function marks() {
      const out = new Map();
      for (const path of ctx.paths()) {
        const m = ctx.mark(path);
        if (!m) continue;
        out.set(path, m);
        for (let d = parentOf(path); d; d = parentOf(d)) if (out.get(d) !== 'error') out.set(d, m);
      }
      return out;
    }

    /* ----- Motion -----
       Nothing here animates layout. A change is laid out at once, and what it displaced
       is carried from where it was to where it is by a transform: each row or folder
       relative to the folder it is in, so a folder full of rows is one thing on the move.
       A folder that opens or closes is likewise laid out open or shut straight away; what
       is inside is uncovered or covered by a clip whose edge travels with the rows below
       (the clip moves one way and its contents the other, so they stay where they are).
       Whatever is still on the move when the next change comes is picked up from where
       it has got to and sent on with everything else, so it all stays in step. */

    const flying = new Map();  // element → the animation carrying it
    const folding = new Set(); // the folders on their way open or shut

    function fly(target, frames, sp, more) {
      const a = target.animate(frames, Object.assign({ duration: sp.duration, easing: sp.easing }, more));
      flying.set(target, a);
      a.onfinish = () => { if (flying.get(target) === a) flying.delete(target); };
    }

    // A fold that has arrived, or is cut short: the folder is simply open or shut.
    function settle(v) {
      if (v.fx) v.fx.forEach((a) => a.cancel());
      v.fx = null;
      folding.delete(v);
      v.kids.classList.remove('is-folding', 'is-leaving');
      v.kids.inert = false;
      v.kids.hidden = !v.open;
    }

    // How much of what is in a folder can be seen right now.
    const showing = (v) => (v.kids.hidden ? 0 : v.fx ? v.kids.getBoundingClientRect().bottom - v.inner.getBoundingClientRect().top : v.kids.offsetHeight);

    function refresh() {
      if (S.busy) return;
      model();
      for (const set of [S.sel, S.open]) for (const p of [...set]) if (!exists(p)) set.delete(p);
      if (S.clip) {
        S.clip.paths = S.clip.paths.filter(exists);
        if (!S.clip.paths.length) S.clip = null;
      }
      if (editing && (editing.fresh ? editing.dir && !isFolder(editing.dir) : !exists(editing.path))) {
        if (field) field.close();
        editing = null;
      }

      // The file on screen is shown in the tree, wherever it was opened from.
      const current = ctx.current();
      let reveal = null;
      if (current !== lastCurrent) {
        lastCurrent = current;
        if (current && exists(current)) {
          for (let p = parentOf(current); p; p = parentOf(p)) S.open.add(p);
          if (S.sel.size < 2) {
            S.sel = new Set([current]);
            S.anchor = current;
          }
          if (!tree.contains(document.activeElement)) focused = current;
          reveal = current;
        }
      }
      if (focused == null || !exists(focused)) focused = current && exists(current) ? current : S.model.length ? S.model[0].path : null;
      for (let p = parentOf(focused || ''); p; p = parentOf(p)) if (!S.open.has(p)) focused = p;

      const now = visible();
      const sig = S.key + '\0' + (editing ? (editing.fresh ? editing.fresh + '>' + editing.dir : editing.path) : '');
      const structural = sig !== lastSig || !!(S.moved && S.moved.size);
      const live = built && !reduced() && tree.getClientRects().length > 0;
      const toggled = [];
      for (const v of nodes.values()) {
        if (v.folder && v.open != null && v.open !== S.open.has((S.moved && S.moved.get(v.path)) || v.path)) toggled.push(v);
      }
      const moving = live && (structural || toggled.length > 0);
      const fresh = new Set();
      const shown = new Map(); // folder → how much of it showed before
      let first = null;        // element → where it was

      // Before: where everything is, as drawn. Then what is on the move is stopped, to
      // be sent on again once it is known where everything goes.
      if (moving) {
        first = new Map([[list, list.getBoundingClientRect()]]);
        for (const path of shownPaths) {
          const v = nodes.get(path);
          if (v) first.set(v.el, v.el.getBoundingClientRect());
        }
        for (const v of new Set([...folding, ...toggled])) shown.set(v, showing(v));
        flying.forEach((a) => a.cancel());
        flying.clear();
        for (const v of folding) {
          v.fx.forEach((a) => a.cancel());
          v.fx = null;
        }
      } else if (!live) {
        flying.forEach((a) => a.cancel());
        flying.clear();
        for (const v of [...folding]) settle(v);
      }

      if (structural) {
        const had = tree.contains(document.activeElement) && !(field && field.row.contains(document.activeElement));
        // What was moved keeps its row.
        if (S.moved && S.moved.size) {
          const carried = [];
          for (const [from, to] of S.moved) {
            const v = nodes.get(from);
            if (!v) continue;
            nodes.delete(from);
            carried.push([to, v]);
          }
          for (const [to, v] of carried) if (!nodes.has(to)) nodes.set(to, v);
        }
        const next = new Map();
        arranging = true;
        (function place(kids, box, depth, up) {
          const els = [];
          if (editing && editing.fresh && editing.dir === (up ? up.path : '')) {
            if (!field) makeField();
            field.row.style.setProperty('--depth', depth);
            els.push(field.row);
          }
          for (const node of kids) {
            let v = nodes.get(node.path);
            if (!v || v.folder !== !!node.kids) {
              v = makeView(node);
              fresh.add(v);
              if (first && S.born && S.born.path === node.path && S.born.rect) first.set(v.el, S.born.rect);
            }
            dress(v, node, depth, up);
            next.set(node.path, v);
            if (node.kids) place(node.kids, v.inner, depth + 1, v);
            els.push(v.el);
          }
          arrange(box, els);
        })(S.model, list, 0, null);
        arranging = false;
        if (editing && editing.path && !field) makeField();
        // What is gone stays where it was for as long as it takes to leave.
        if (first) {
          const at = root.getBoundingClientRect();
          for (const v of nodes.values()) {
            const a = first.get(v.el);
            if (next.get(v.path) === v || !a) continue;
            const g = v.row;
            g._v = null;
            g.inert = true;
            g.classList.add('ex-ghost');
            Object.assign(g.style, { left: a.left - at.left + 'px', top: a.top - at.top + 'px', width: a.width + 'px' });
            ghosts.append(g);
            g.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.92)' }], { duration: 200, easing: 'ease-out', fill: 'forwards' }).onfinish = () => g.remove();
          }
        }
        for (const v of nodes.values()) if (v.folder && next.get(v.path) !== v) settle(v);
        nodes = next;
        if (had && unfocused() && nodes.has(focused)) nodes.get(focused).row.focus({ preventScroll: true });
      }

      // Which rows are open, chosen, cut, marked, and where the keyboard is.
      const marked = marks();
      const cut = S.clip && S.clip.cut ? S.clip.paths : null;
      // Chosen rows that touch are lit as one block.
      const joins = new Map();
      if (S.sel.size > 1) now.forEach((path, i) => { if (S.sel.has(path)) joins.set(path, (S.sel.has(now[i - 1]) ? 1 : 0) + (S.sel.has(now[i + 1]) ? 2 : 0)); });
      for (const [path, v] of nodes) {
        const join = joins.get(path) || 0;
        const state = [path === current, S.sel.has(path), !!cut && cut.some((c) => path === c || within(path, c)), marked.get(path) || '', path === focused, join].join();
        if (state !== v.state) {
          v.state = state;
          v.row.classList.toggle('is-current', path === current);
          v.row.classList.toggle('is-sel', S.sel.has(path));
          v.row.classList.toggle('joins-up', (join & 1) > 0);
          v.row.classList.toggle('joins-down', (join & 2) > 0);
          v.row.classList.toggle('is-cut', !!cut && cut.some((c) => path === c || within(path, c)));
          v.row.setAttribute('aria-selected', String(S.sel.has(path)));
          v.row.dataset.mark = marked.get(path) || '';
          v.row.tabIndex = path === focused ? 0 : -1;
        }
        if (!v.folder) continue;
        const want = S.open.has(path);
        if (v.open === want && !(moving && folding.has(v))) continue;
        const was = v.open;
        v.open = want;
        v.el.classList.toggle('is-open', want);
        v.row.setAttribute('aria-expanded', String(want));
        if (was == null || !moving) settle(v);
        else {
          // Laid out as it will be: open, or (closing) out of the way of what follows.
          v.kids.hidden = false;
          v.kids.inert = !want;
          v.kids.classList.add('is-folding');
          v.kids.classList.toggle('is-leaving', !want);
          folding.add(v);
        }
      }

      // After: where everything is now. Only reading here, and only writing below.
      if (moving) {
        const seen = now.map((path) => nodes.get(path));
        const last = new Map([[list, list.getBoundingClientRect().top]]);
        for (const v of seen) last.set(v.el, v.el.getBoundingClientRect().top);
        const full = new Map();
        for (const v of folding) full.set(v, v.inner.offsetHeight);

        const sp = structural || toggled.some((v) => v.open) ? motion.smooth : motion.snappy;
        const landed = S.moved ? new Set(S.moved.values()) : new Set();
        // How far each thing is from where it was. It is moved by that less what the
        // folder around it is already moved by.
        const shift = new Map([[list, first.get(list).top - last.get(list)]]);
        if (Math.abs(shift.get(list)) >= 0.5) fly(list, [{ transform: `translateY(${shift.get(list).toFixed(2)}px)` }, { transform: 'none' }], sp);
        for (const v of seen) {
          const around = shift.get(v.up ? v.up.el : list) || 0;
          const a = first.get(v.el);
          const own = a ? a.top - last.get(v.el) : around;
          shift.set(v.el, own);
          const dy = own - around, dx = structural && a && !fresh.has(v) ? (v.was - v.depth) * indentOf() : 0;
          if (Math.abs(dy) >= 0.5 || dx) fly(v.el, [{ transform: `translate(${dx}px, ${dy.toFixed(2)}px)` }, { transform: 'none' }], sp);
          else if (!a && (fresh.has(v) || landed.has(v.path))) fly(v.row, [{ opacity: 0, transform: 'scale(0.9)' }, { opacity: 1, transform: 'none' }], sp);
        }
        for (const v of [...folding]) {
          const all = full.get(v), to = v.open ? all : 0;
          const from = clamp(shown.has(v) ? shown.get(v) : all - to, 0, all);
          if (Math.abs(from - to) < 0.5) {
            settle(v);
            continue;
          }
          const timing = { duration: sp.duration, easing: sp.easing, fill: 'forwards' };
          const fx = (v.fx = [
            v.kids.animate([{ transform: `translateY(${(from - all).toFixed(2)}px)` }, { transform: `translateY(${to - all}px)` }], timing),
            v.inner.animate([{ transform: `translateY(${(all - from).toFixed(2)}px)` }, { transform: `translateY(${all - to}px)` }], timing),
          ]);
          fx[0].onfinish = () => { if (v.fx === fx) settle(v); };
        }
        // What is inside a folder that was shut arrives a row at a time. (Not one caught
        // half way: its rows are in view already.)
        for (const v of toggled) {
          if (!v.open || !folding.has(v) || shown.get(v) > 0.5) continue;
          [...v.inner.children].slice(0, 16).forEach((kid, i) => {
            const row = kid.classList.contains('ex-row') ? kid : kid.firstElementChild;
            fly(row, [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], motion.bouncy, { delay: i * 16, fill: 'backwards' });
          });
        }
      }

      // One chosen row after another: the highlight travels between them.
      const one = S.sel.size === 1 ? [...S.sel][0] : null;
      if (live && one && lastOne && one !== lastOne && nodes.has(one) && nodes.has(lastOne) && shownPaths.has(lastOne) && now.includes(one)) {
        const left = nodes.get(lastOne).row;
        const dy = left.getBoundingClientRect().top - nodes.get(one).row.getBoundingClientRect().top;
        if (dy) {
          nodes.get(one).row.animate([{ transform: `translateY(${dy.toFixed(2)}px)` }, { transform: 'none' }], { pseudoElement: '::before', duration: motion.snappy.duration, easing: motion.snappy.easing });
          // It has left the old row: nothing stays behind there to fade.
          left.classList.add('ex-snap');
          requestAnimationFrame(() => requestAnimationFrame(() => left.classList.remove('ex-snap')));
        }
      }
      lastOne = one;

      shownPaths = new Set(now);
      lastSig = sig;
      built = true;
      if (reveal && nodes.has(reveal) && tree.getClientRects().length) nodes.get(reveal).row.scrollIntoView({ block: 'nearest' });
    }

    /* ----- Choosing ----- */

    function select(path) {
      S.sel = new Set([path]);
      S.anchor = focused = path;
    }

    function extend(path) {
      const rows = visible();
      const a = rows.indexOf(rows.includes(S.anchor) ? S.anchor : focused), b = rows.indexOf(path);
      if (a < 0 || b < 0) select(path);
      else {
        S.sel = new Set(rows.slice(Math.min(a, b), Math.max(a, b) + 1));
        focused = path;
      }
      redraw();
    }

    function toggle(path, open = !S.open.has(path)) {
      if (open) S.open.add(path);
      else S.open.delete(path);
      S.keep();
      redraw();
    }

    function choose(v, into) {
      select(v.path);
      if (v.folder) return void toggle(v.path);
      ctx.open(v.path);
      redraw();
      if (opts.onPick) opts.onPick(v.path, !!into);
    }

    function focusRow(path) {
      const v = nodes.get(path);
      if (!v) return;
      v.row.focus({ preventScroll: true });
      v.row.scrollIntoView({ block: 'nearest' });
    }

    function go(path, range) {
      if (path == null) return;
      if (range) extend(path);
      else {
        select(path);
        redraw();
      }
      focusRow(path);
    }

    /* ----- Menus -----
       A row's menu grows out of the button at its end, which is there while the row is
       pointed at, has the keyboard, or is pressed and held. */

    function menu(v) {
      model();
      if (!S.sel.has(v.path)) select(v.path);
      else focused = v.path;
      redraw();
      const paths = tops([...S.sel].filter(exists));
      const one = paths.length === 1, fixed = paths.includes(ENTRY);
      const path = v.path, folder = v.folder;
      const items = [];
      if (one && folder) {
        items.push(
          { label: 'New File…', icon: 'doc-plus', onSelect: () => create('file', path) },
          { label: 'New Folder…', icon: 'folder-plus', onSelect: () => create('folder', path) },
          '-');
      }
      if (one) {
        if (!fixed) items.push({ label: 'Rename…', icon: 'pencil', onSelect: () => edit({ path }) });
        items.push({ label: 'Duplicate', icon: 'duplicate', onSelect: () => { transfer([path], parentOf(path), true); focusRow(focused); } }, '-');
      }
      if (!fixed) items.push({ label: 'Cut', icon: 'scissors', onSelect: () => copyTo(true) });
      items.push({ label: 'Copy', icon: 'copy', onSelect: () => copyTo(false) });
      if (S.clip) items.push({ label: 'Paste', icon: 'clipboard', onSelect: () => paste(folder ? path : parentOf(path)) });
      if (one) {
        items.push('-', { label: 'Copy Path', icon: 'link', onSelect: () => copyPath(path) });
        if (!folder) items.push({ label: 'Download', icon: 'download', onSelect: () => download(path) });
      }
      if (!fixed) items.push('-', { label: 'Delete', icon: 'trash', danger: true, onSelect: () => remove() });
      return UI.menu(v.dots, items);
    }

    function rootMenu() {
      return UI.menu(more, [
        { label: 'Import…', icon: 'upload', onSelect: () => browse(home()) },
        S.clip && { label: 'Paste', icon: 'clipboard', onSelect: () => paste('') },
        '-',
        { label: 'Minify', checked: ctx.minify(), onSelect: () => ctx.setMinify(!ctx.minify()) },
      ]);
    }

    /* ----- Pointer ----- */

    tree.addEventListener('click', (e) => {
      // The tap that ends a press-and-hold belongs to the menu it opened.
      if (swallow || Date.now() - pressed < 700 || e.target.closest('input')) return;
      const v = viewOf(e.target);
      if (!v) {
        // Beside the rows: nothing is chosen, and what is made next goes to the top.
        if (S.sel.size && !e.target.closest('.ex-row')) {
          S.sel.clear();
          redraw();
        }
        return;
      }
      if (v.row.classList.contains('ex-edit')) return;
      if (e.target.closest('.ex-dots')) return void menu(v);
      if (e.shiftKey) extend(v.path);
      else if (e.ctrlKey || e.metaKey) {
        if (!S.sel.delete(v.path)) S.sel.add(v.path);
        S.anchor = focused = v.path;
        redraw();
      } else choose(v, e.detail === 0);
    });

    // A second click hands the keyboard to the code.
    tree.addEventListener('dblclick', (e) => {
      const v = viewOf(e.target);
      if (v && !v.folder && !e.target.closest('.ex-dots, input') && opts.onPick) opts.onPick(v.path, true);
    });

    // Right-click, the menu key and Shift+F10 all arrive as this.
    tree.addEventListener('contextmenu', (e) => {
      if (e.target.closest('input')) return;
      e.preventDefault();
      const v = viewOf(e.target);
      if (hold) return void hold.fire();
      if (Date.now() - pressed < 700) return;
      if (v) menu(v);
      else rootMenu();
    });

    // Touch: press and hold for the menu (not every touch browser sends contextmenu for
    // it); keep holding and move, and the row comes along instead.
    let hold = null;
    let drag = null; // { id, x, y, v, slop } until it moves; then also { on, paths, chip, … }
    const release = () => {
      if (hold) clearTimeout(hold.timer);
      hold = null;
    };

    tree.addEventListener('pointerdown', (e) => {
      release();
      drag = null;
      const v = viewOf(e.target);
      if (!v || e.button > 0 || e.target.closest('input, .ex-dots') || v.row.classList.contains('ex-edit')) return;
      if (e.pointerType !== 'touch') {
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, v, slop: 5 };
        return;
      }
      const fire = () => {
        release();
        if (!nodes.has(v.path)) return;
        pressed = Date.now();
        const pop = menu(v);
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, v, slop: 10, pop };
        // The menu opens under the finger. Lifting it must not choose the item there:
        // the tap that ends this touch is dropped; the next touch is free again.
        const drop = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        document.addEventListener('click', drop, { capture: true, once: true });
        document.addEventListener('pointerdown', () => document.removeEventListener('click', drop, true), { capture: true, once: true });
      };
      hold = { x: e.clientX, y: e.clientY, fire, timer: setTimeout(fire, 480) };
    });

    tree.addEventListener('pointermove', (e) => {
      if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 10) release();
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.on) {
        if (e.pointerType === 'mouse' && !e.buttons) return void (drag = null);
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < drag.slop) return;
        if (!lift(e)) return void (drag = null);
      }
      follow(e);
    });
    tree.addEventListener('pointerup', (e) => { release(); drop(e, false); });
    tree.addEventListener('pointercancel', (e) => { release(); drop(e, true); });
    // (A finger's own hold on the row it touched is let go when the tree takes over: not that one.)
    tree.addEventListener('lostpointercapture', (e) => { if (e.target === tree) drop(e, true); });
    tree.addEventListener('scroll', release, { passive: true });
    // A finger that is carrying a row does not scroll the list.
    tree.addEventListener('touchmove', (e) => { if (drag && e.cancelable) e.preventDefault(); }, { passive: false });
    tree.addEventListener('dragstart', (e) => e.preventDefault());

    /* ----- Dragging ----- */

    let dropAt = null, dropEl = null;
    function aimAt(dest) {
      if (dropAt === dest) return;
      if (dropEl) dropEl.classList.remove('is-drop');
      dropAt = dest;
      dropEl = dest == null ? null : dest === '' ? root : nodes.has(dest) ? nodes.get(dest).el : null;
      if (dropEl) dropEl.classList.add('is-drop');
    }
    // The folder a point is over: the folder itself, or the one the file there is in.
    function folderAt(target) {
      const v = viewOf(target);
      return { over: v, dest: v ? (v.folder ? v.path : parentOf(v.path)) : '' };
    }

    function lift(e) {
      model();
      const v = drag.v;
      if (nodes.get(v.path) !== v) return false;
      if (!S.sel.has(v.path)) select(v.path);
      const paths = tops([...S.sel].filter(exists)).filter((p) => p !== ENTRY);
      if (!paths.length) return false;
      if (drag.pop) drag.pop.close(true);
      if (field) field.input.blur();
      try { tree.setPointerCapture(e.pointerId); } catch (err) { /* the pointer is already gone */ }
      const lead = nodes.get(paths.includes(v.path) ? v.path : paths[0]) || v;
      const chip = h('div.ex-drag', icon(iconFor(lead.name, lead.folder), 18), h('span', lead.name), paths.length > 1 ? h('b', String(paths.length)) : null);
      document.body.append(chip);
      // It leaves from its row and trails the pointer on a spring.
      const from = lead.row.children[1].getBoundingClientRect();
      const paint = () => { chip.style.transform = `translate(${sx.value.toFixed(1)}px, ${sy.value.toFixed(1)}px) scale(${(0.94 + up.value * 0.1).toFixed(4)})`; };
      const sx = new Spring({ value: from.left - 10, stiffness: 620, damping: 40, onUpdate: paint });
      const sy = new Spring({ value: from.top + from.height / 2 - 17, stiffness: 620, damping: 40, onUpdate: paint });
      const up = new Spring({ value: 0, stiffness: 380, damping: 20, precision: 0.002, onUpdate: paint });
      paint();
      up.set(1);
      if (!reduced()) chip.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' });
      for (const p of paths) nodes.get(p).el.classList.add('is-dragging');
      Object.assign(drag, { on: true, paths, chip, sx, sy, up, home: { x: sx.value, y: sy.value }, wait: null, timer: 0, raf: 0, scroll: 0, copy: false });
      swallow = true;
      document.addEventListener('keydown', dragKey, true);
      redraw();
      return true;
    }

    function follow(e) {
      const d = drag;
      d.px = e.clientX;
      d.py = e.clientY;
      d.copy = e.ctrlKey || e.altKey;
      d.sx.set(e.clientX + 12);
      d.sy.set(e.clientY - 17);
      aim();
      // Near the top or bottom edge the list moves along.
      const r = tree.getBoundingClientRect(), edge = 36;
      d.scroll = e.clientY < r.top + edge ? e.clientY - (r.top + edge) : e.clientY > r.bottom - edge ? e.clientY - (r.bottom - edge) : 0;
      if (d.scroll && !d.raf) d.raf = requestAnimationFrame(creep);
    }

    function creep() {
      const d = drag;
      if (!d || !d.on) return;
      d.raf = 0;
      if (!d.scroll) return;
      tree.scrollTop += clamp(d.scroll, -36, 36) * 0.3;
      aim();
      d.raf = requestAnimationFrame(creep);
    }

    const fits = (path, dest, copy) => !(isFolder(path) && (dest === path || within(dest, path))) && (copy || parentOf(path) !== dest);

    function aim() {
      const d = drag;
      const hit = document.elementFromPoint(d.px, d.py);
      const { over, dest } = hit && el.contains(hit) ? folderAt(hit) : { over: null, dest: null };
      aimAt(dest != null && d.paths.some((p) => fits(p, dest, d.copy)) ? dest : null);
      d.chip.classList.toggle('is-copy', d.copy);
      // A closed folder opens for what is held over it.
      const wait = over && over.folder && !S.open.has(over.path) && dropAt === over.path ? over.path : null;
      if (wait === d.wait) return;
      clearTimeout(d.timer);
      d.wait = wait;
      if (wait) d.timer = setTimeout(() => { if (drag === d && d.wait === wait) toggle(wait, true); }, 600);
    }

    function dragKey(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      drop(e, true);
    }

    function drop(e, cancel) {
      const d = drag;
      if (!d || (e.pointerId != null && e.pointerId !== d.id)) return;
      drag = null;
      if (!d.on) return;
      clearTimeout(d.timer);
      cancelAnimationFrame(d.raf);
      document.removeEventListener('keydown', dragKey, true);
      try { tree.releasePointerCapture(d.id); } catch (err) { /* already released */ }
      for (const p of d.paths) if (nodes.has(p)) nodes.get(p).el.classList.remove('is-dragging');
      setTimeout(() => { swallow = false; }, 0);
      const dest = dropAt;
      aimAt(null);
      const done = !cancel && dest != null && transfer(d.paths, dest, e.ctrlKey || e.altKey);
      if (done) focusRow(focused);
      if (done || reduced()) {
        if (reduced()) return void d.chip.remove();
        d.chip.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-out', fill: 'forwards' }).onfinish = () => d.chip.remove();
        return;
      }
      // Not moved: back to where it came from.
      d.sx.onRest = () => d.chip.remove();
      d.sx.set(d.home.x + 0.5);
      d.sy.set(d.home.y);
      d.up.set(0);
      d.chip.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, delay: 140, easing: 'ease-in', fill: 'forwards' });
    }

    // Files dragged in from the device land in the folder they are dropped on.
    const carriesFiles = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    el.addEventListener('dragover', (e) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      aimAt(folderAt(e.target).dest);
    });
    el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) aimAt(null); });
    el.addEventListener('drop', async (e) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      const dest = dropAt || '';
      aimAt(null);
      bring(await dropped(e.dataTransfer), dest);
    });

    /* ----- Keyboard ----- */

    tree.addEventListener('focusin', (e) => {
      const v = viewOf(e.target);
      if (!v || e.target !== v.row || v.path === focused) return;
      if (nodes.has(focused)) nodes.get(focused).row.tabIndex = -1;
      focused = v.path;
      v.row.tabIndex = 0;
    });

    // Typing a name goes to the next row that starts with it.
    let typed = '', typedAt = 0;
    function seek(ch) {
      const t = Date.now();
      if (t - typedAt > 700) typed = '';
      typedAt = t;
      typed += ch.toLowerCase();
      const rows = visible();
      const from = rows.indexOf(focused) + (typed.length === 1 ? 1 : 0);
      go(rows.slice(from).concat(rows.slice(0, from)).find((p) => nameOf(p).toLowerCase().startsWith(typed)), false);
    }

    // Into the one chosen folder, or beside the row the keyboard is on.
    const pasteHere = (v) => paste(S.sel.size === 1 ? home() : v.folder ? v.path : parentOf(v.path));

    // Cut, copy and paste also arrive as these, from the browser's own menus and from
    // keyboards whose shortcut never shows up as a key.
    for (const [name, act] of [['copy', () => copyTo(false)], ['cut', () => copyTo(true)], ['paste', (v) => pasteHere(v)]]) {
      tree.addEventListener(name, (e) => {
        const v = viewOf(e.target);
        if (!v || e.target !== v.row) return;
        e.preventDefault();
        act(v);
      });
    }

    tree.addEventListener('keydown', (e) => {
      const v = viewOf(e.target);
      if (!v || e.target !== v.row || e.altKey) return;
      const rows = visible();
      const i = rows.indexOf(v.path);
      const path = v.path;
      const open = v.folder && S.open.has(path);
      let act;
      if (e.ctrlKey || e.metaKey) {
        act = {
          c: () => copyTo(false),
          x: () => copyTo(true),
          v: () => pasteHere(v),
          z: () => (e.shiftKey ? travel(S.redo, S.undo) : travel(S.undo, S.redo)),
          y: () => travel(S.redo, S.undo),
          a: () => { S.sel = new Set(rows); redraw(); },
        }[e.key.toLowerCase()];
      } else {
        act = {
          ArrowDown: () => go(rows[i + 1], e.shiftKey),
          ArrowUp: () => go(rows[i - 1], e.shiftKey),
          PageDown: () => go(rows[Math.min(rows.length - 1, i + 10)], e.shiftKey),
          PageUp: () => go(rows[Math.max(0, i - 10)], e.shiftKey),
          Home: () => go(rows[0], e.shiftKey),
          End: () => go(rows[rows.length - 1], e.shiftKey),
          ArrowRight: () => (v.folder ? (open ? go(rows[i + 1], false) : toggle(path, true)) : null),
          ArrowLeft: () => (open ? toggle(path, false) : go(parentOf(path) || null, false)),
          Enter: () => choose(v, true),
          ' ': () => choose(v, false),
          F2: () => { if (S.sel.size < 2) edit({ path }); },
          Delete: () => { if (!S.sel.has(path)) select(path); remove(); },
          Escape: () => {
            if (!(S.clip && S.clip.cut) && S.sel.size < 2) return false;
            if (S.clip && S.clip.cut) S.clip = null;
            else select(path);
            redraw();
          },
        }[e.key];
        if (!act && e.key.length === 1) act = () => seek(e.key);
      }
      if (!act) return;
      if (act() !== false) e.preventDefault();
    });

    refresh();
    return {
      el,
      refresh,
      focus() { (nodes.has(focused) ? nodes.get(focused).row : more).focus({ preventScroll: true }); },
    };
  };

  NT.explorer.forget = (id) => store.remove(storeKey(id));
})();
