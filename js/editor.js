/*
  The editor page: a script, opened as a project.

  One file (main.luau) is the script itself and is saved as its text, exactly as
  typed. From the second file on it is a stored project (project.js): each save keeps
  the sources in the project's holder scripts, bundles them, and saves the bundle as
  the script. The explorer (explorer.js) is how files come and go; the language
  server (lsp.js) reads along where there is one.

  What can go wrong on a save, and what the line under the title then says:

    Not saved       the request failed, or the script is over the size limit; the
                    edits are kept on this device (nt.draft.<id>)
    Bundle failed   the sources are stored, but they do not bundle: the script is as it
                    was. The places are marked in the files.
    Too large       the same, with a bundle over the script size limit (which what the
                    script carries besides code, its project mark, counts towards)
    Conflict        the project was saved somewhere else since it was opened here.
                    Nothing more is saved until Save is pressed and a side is chosen.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h, debounce, motion } = NT.util;
  const icon = NT.icon;
  const API = NT.api;
  const UI = NT.ui;
  const Project = NT.project;
  const { makePage, navButton, navGroup, groupButton, emptyState, errorState, publishScript, deleteScript } = NT.kit;

  const ENTRY = Project.ENTRY;
  const SIDE = { width: 260, gap: 12 }; // as in project.css
  const wide = window.matchMedia('(min-width: 820px)');
  const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1);

  // A dialog with more than one way on. → the value of the one chosen, or null.
  function choose({ title, message, options, source }) {
    return new Promise((resolve) => {
      let result = null;
      let pop = null;
      const cancel = h('button.btn.block.gray', { type: 'button', onclick: () => pop.close() }, 'Cancel');
      const body = h('div.dialog', h('h2', title), message ? h('p', message) : null, h('div.dialog-actions',
        options.map((o, i) => h('button.btn.block.' + (i ? 'gray' : 'filled'), { type: 'button', onclick: () => { result = o.value; pop.close(); } }, o.label)),
        cancel));
      const anchored = !!source && source.isConnected;
      pop = UI.popover(anchored ? source : null, body, {
        role: 'alertdialog',
        label: title,
        dim: true,
        width: 290,
        radius: 34,
        source: anchored ? undefined : null,
        onDismiss: () => resolve(result),
      });
      cancel.focus({ preventScroll: true });
    });
  }

  // A draft from this device, as a set of files. (Before projects it was one text.)
  function draftFiles(draft, multi) {
    if (!draft) return null;
    const files = draft.files && typeof draft.files === 'object' ? draft.files : typeof draft.text === 'string' ? { [ENTRY]: draft.text } : null;
    if (!files || typeof files[ENTRY] !== 'string') return null;
    const paths = Object.keys(files);
    if (paths.some((p) => typeof files[p] !== 'string' || Project.badPath(p))) return null;
    return multi || paths.length === 1 ? files : null;
  }

  NT.pages.editor = function (id) {
    const page = makePage({ title: 'Editor', back: true, large: false, hideTabbar: true, className: 'page-editor' });
    const host = h('div.code-host');
    const side = h('aside.editor-side', { hidden: true, 'aria-label': 'Files' });
    page.inner.append(h('div.editor-split', side, host));
    const store = NT.util.store;
    const draftKey = 'nt.draft.' + id;
    const multi = Project.multi();
    let script = null, ed = null, lsp = null, saveBtn = null, filesBtn = null, ready = false, gone = false;

    let minify = true;
    let saved = { stamps: {}, minify: true }; // each file as the server has it (see stamp() in monaco.js)
    let kept = false;    // the server has a stored project
    let base = null;     // … as of this updated_at
    let stale = false;   // the sources are stored, the script is not their bundle
    let note = '';       // why: 'Bundle failed' | 'Too large'
    let clash = false;   // saved somewhere else in between
    let failed = false;  // the last save did not get through
    let saving = 0, deleted = false, leaving = false;
    let chain = Promise.resolve(); // saves run one after another, in the order asked for
    let lastShot = null;
    let failing = new Set();
    let shownDoc = null;

    /* ----- State ----- */

    const fileDirty = (path) => saved.stamps[path] !== ed.stamp(path);
    const sameAs = (stamps, flag) => {
      const paths = Object.keys(stamps);
      return paths.length === Object.keys(saved.stamps).length && paths.every((p) => saved.stamps[p] === stamps[p]) && (paths.length < 2 || flag === saved.minify);
    };
    function snapshot() {
      const files = {}, stamps = {};
      for (const path of ed.paths()) {
        files[path] = ed.text(path);
        stamps[path] = ed.stamp(path);
      }
      return { files, stamps, minify };
    }
    const dirty = () => {
      if (!ed || gone) return false;
      const stamps = {};
      for (const path of ed.paths()) stamps[path] = ed.stamp(path);
      return !sameAs(stamps, minify);
    };

    const views = new Set(); // the explorer, wherever it is showing
    function paint() {
      if (!ed || gone) return;
      const edited = dirty();
      const text = saving ? 'Saving…' : clash ? 'Conflict' : failed ? 'Not saved' : edited ? 'Edited' : note || 'Saved';
      // Which file is open is said here; nothing is added across the top for it.
      const file = shownDoc || (ed.paths().length > 1 && ed.path ? nameOf(ed.path) : '');
      page.setSubtitle(shownDoc ? file : file ? `${file} · ${text}` : text);
      if (saveBtn) saveBtn.disabled = !(edited || stale || clash);
      views.forEach((view) => view.refresh());
    }

    // Edits are also kept on this device until the server has them, so closing the tab,
    // going back mid-save or a save that fails cannot lose them: the next visit picks
    // the draft up again. It holds the whole project.
    const keepDraft = () => store.set(draftKey, { files: snapshot().files, minify, base, t: Date.now() });
    const stash = debounce(keepDraft, 300);
    const autosave = debounce(() => { if (!clash) save(); }, 1000);
    const changed = () => {
      failed = false;
      paint();
      stash();
      autosave();
    };

    /* ----- Saving ----- */

    function stored(shot) {
      saved = { stamps: shot.stamps, minify: shot.minify };
      // The draft has done its job once nothing newer than this is waiting.
      if (gone ? shot === lastShot : !dirty()) {
        stash.cancel();
        store.remove(draftKey);
      }
    }

    // One save, start to finish. → true when the script itself is now what the project says.
    async function cycle(shot, cheer, warn) {
      if (clash) return false;
      if (sameAs(shot.stamps, shot.minify) && !stale) {
        if (cheer) UI.toast('Saved');
        return true;
      }
      let done = false, problems = {}, trouble = '';
      saving++;
      paint();
      try {
        if (Object.keys(shot.files).length === 1) {
          await API.saveContent(id, shot.files[ENTRY], { project: null });
          stored(shot);
          stale = false;
          note = '';
          done = true;
          // One file again: there is nothing left for a stored project to hold.
          if (kept) {
            try {
              await Project.remove(id);
              kept = false;
              base = null;
            } catch (e) { /* asked again with the next save */ }
          }
        } else {
          const res = await Project.store(id, shot.files, shot.minify, base);
          if (res.conflict) {
            clash = true;
            base = res.base;
            autosave.cancel();
            // A save that was asked for goes on to ask which side stays (commit).
            if (!warn) UI.toast('Changed elsewhere', { warn: true });
            return false;
          }
          kept = true;
          base = res.base;
          stale = true;
          stored(shot);
          const b = res.bundle;
          if (b.code != null && Project.fits(id, b)) {
            await Project.report(id, b, base);
            stale = false;
            note = '';
            done = true;
          } else if (b.code != null) {
            note = 'Too large';
            trouble = 'Bundles are limited to 1,000,000 characters';
          } else if (b.error === 'bundle-failed') {
            note = trouble = 'Bundle failed';
            // darklua can say one mistake several ways; the first is the one to read.
            for (const d of b.diagnostics || []) {
              const list = (problems[d.path] = problems[d.path] || []);
              if (!list.some((x) => x.line === d.line)) list.push(d);
            }
          } else throw new Error(b.error);
        }
        failed = false;
        if (done && cheer) UI.toast('Saved');
        else if (trouble && warn) UI.toast(trouble, { warn: true });
      } catch (e) {
        failed = true;
        const why = String(e && e.message);
        UI.toast(why.includes('too long') ? 'Scripts are limited to 1,000,000 characters' : 'Couldn’t save', { warn: true });
      } finally {
        saving--;
        if (!gone) {
          if (done || trouble) ed.report(problems);
          paint();
        }
      }
      return done;
    }

    // What is on screen now is what gets saved, however long the save before it takes.
    function save(cheer, warn) {
      const shot = (lastShot = snapshot());
      const run = chain.then(() => cycle(shot, cheer, warn));
      chain = run.catch(() => {});
      return run;
    }

    function adopt(p, content) {
      const files = p ? Object.assign({}, p.files) : { [ENTRY]: content };
      if (typeof files[ENTRY] !== 'string') files[ENTRY] = '';
      minify = p ? p.minify : minify;
      kept = !!p;
      base = p ? p.base : null;
      stale = !!p && !p.built;
      return files;
    }

    // The other side's version takes the place of this one.
    async function takeTheirs() {
      try {
        const content = ((await API.scriptContent(id)) || {}).content || '';
        ed.reset(adopt(await Project.load(id, content), content));
      } catch (e) {
        UI.toast('Couldn’t load', { warn: true });
        return false;
      }
      saved = { stamps: snapshot().stamps, minify };
      clash = failed = false;
      note = '';
      stash.cancel();
      store.remove(draftKey);
      ed.report({});
      paint();
      if (stale) save();
      return true;
    }

    // A save someone asked for. With a conflict it first asks which side stays.
    async function commit(cheer, source) {
      autosave.cancel();
      if (!clash && (await save(cheer, true))) return true;
      if (!clash) return false;
      const pick = await choose({ title: 'Changed Elsewhere', options: [{ label: 'Keep Mine', value: 'mine' }, { label: 'Take Theirs', value: 'theirs' }], source });
      if (pick === 'theirs') return takeTheirs();
      if (pick !== 'mine') return false;
      clash = false;
      return save(cheer, true);
    }

    const onUnload = (e) => {
      if (!dirty() && !saving) return;
      if (dirty()) keepDraft();
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);

    // Back leaves once the project is with the server (or, failing that, in the draft).
    page.onBack = async () => {
      if (leaving) return;
      leaving = true;
      autosave.cancel();
      if (dirty() || clash) await commit(false, page.lead.firstElementChild);
      if (clash) return void (leaving = false);
      NT.nav.back();
    };

    /* ----- Explorer ----- */

    const ctx = {
      folded: new Set(),
      paths: () => ed.paths(),
      current: () => ed.path,
      mark: (path) => (failing.has(path) ? 'error' : fileDirty(path) ? 'edited' : ''),
      open: (path) => ed.open(path),
      create(path) {
        ed.add(path, '');
        ed.open(path);
        changed();
      },
      rename(from, to) {
        ed.rename(from, to);
        changed();
      },
      remove(path) {
        ed.remove(path);
        changed();
      },
      minify: () => minify,
      setMinify(on) {
        minify = on;
        changed();
      },
    };

    let sideView = null, sideOpen = false, sideAnim = null, sheet = null;

    function showSide(open, animate) {
      sideOpen = open;
      filesBtn.setAttribute('aria-expanded', String(open));
      if (open && !sideView) {
        // With a pointer the code takes the keyboard back once a file is picked.
        sideView = NT.explorer(ctx, { onPick: () => { if (window.matchMedia('(hover: hover)').matches) ed.focus(); } });
        views.add(sideView);
        side.append(sideView.el);
      }
      if (!open && side.contains(document.activeElement)) filesBtn.focus({ preventScroll: true });
      const shut = { width: '0px', marginRight: '0px' }, full = { width: SIDE.width + 'px', marginRight: SIDE.gap + 'px' };
      let from = open ? shut : full;
      if (sideAnim) {
        const cs = getComputedStyle(side);
        from = { width: cs.width, marginRight: cs.marginRight };
        sideAnim.cancel();
        sideAnim = null;
      }
      if (open) side.hidden = false;
      side.inert = !open;
      if (!animate || NT.util.reducedMotion() || !wide.matches) return void (side.hidden = !open);
      // The code is resized around it on every frame; the list inside keeps its width.
      const a = side.animate([from, open ? full : shut], { duration: motion.snappy.duration, easing: motion.snappy.easing, fill: 'forwards' });
      sideAnim = a;
      a.onfinish = () => {
        side.hidden = !open;
        a.cancel();
        sideAnim = null;
      };
    }

    function toggleFiles() {
      if (wide.matches) {
        // Kept without re-applying the appearance settings, which is what prefs.set is for.
        NT.prefs.data.explorer = !sideOpen;
        store.set('nt.prefs', NT.prefs.data);
        return void showSide(!sideOpen, true);
      }
      if (sheet) return;
      const view = NT.explorer(ctx, { onPick: () => sheet.close() });
      views.add(view);
      sheet = UI.sheet({ title: 'Files', body: view.el, onClose: () => { views.delete(view); sheet = null; } });
    }

    // Closed for a single file, open beside several, until the choice is made here.
    const sideWanted = () => {
      const choice = NT.prefs.data.explorer;
      return wide.matches && (typeof choice === 'boolean' ? choice : ed.paths().length > 1);
    };
    const onWidth = () => {
      if (!filesBtn) return;
      if (wide.matches && sheet) sheet.close();
      if (wide.matches && !sideOpen && sideWanted()) showSide(true, false);
    };
    wide.addEventListener('change', onWidth);

    /* ----- Details ----- */

    function infoSheet() {
      const name = UI.field('Name', { value: script.name || '', maxLength: 32, placeholder: 'Required' });
      const descId = 'f-' + NT.util.uid(6);
      const desc = h('textarea', { id: descId, rows: 4, maxLength: 1024, placeholder: 'Optional' });
      desc.value = script.description || '';
      const counter = h('span', `${desc.value.length}/1024`);
      desc.addEventListener('input', () => { counter.textContent = `${desc.value.length}/1024`; });
      let maps = null, mapId = script.user_map_id || '';
      const mapValue = h('span', '…');
      const mapPick = h('button.row-pick', { type: 'button', 'aria-label': 'Map' }, mapValue, icon('sort', 15));
      const syncMap = () => {
        const m = (maps || []).find((x) => x.user_map_id === mapId);
        mapValue.textContent = m ? m.name : 'None';
      };
      API.maps(script.author_uuid).then((list) => { maps = list; syncMap(); }).catch(() => { maps = []; syncMap(); });
      mapPick.addEventListener('click', () => {
        if (!maps) return;
        UI.menu(mapPick, [
          { label: 'None', checked: !mapId, onSelect: () => { mapId = ''; syncMap(); } },
          maps.length ? '-' : null,
          ...maps.map((m) => ({ label: m.name, checked: m.user_map_id === mapId, onSelect: () => { mapId = m.user_map_id; syncMap(); } })),
        ]);
      });
      const error = h('p.form-error', { role: 'alert' });
      const submit = h('button.btn.filled.block', { type: 'submit' }, 'Save');
      const form = h('form.form-stack', { novalidate: true },
        h('div.list', name.row, h('div.row.field.col', h('label', { for: descId }, 'Description', counter), desc), h('div.row', h('span.row-title', 'Map'), mapPick)),
        error, submit);
      const details = UI.sheet({ title: 'Details', body: form });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const n = name.input.value.trim(), d = desc.value.trim();
        if (n.length < 3 || n.length > 32) return void (error.textContent = 'Name needs 3 to 32 characters.');
        if (d && (d.length < 32 || d.length > 1024)) return void (error.textContent = 'Description needs 32 to 1024 characters, or leave it empty.');
        error.textContent = '';
        submit.disabled = true;
        try {
          if (n !== (script.name || '')) { await API.saveName(id, n); script.name = n; page.setTitle(n); }
          if (d !== (script.description || '')) { await API.saveDescription(id, d); script.description = d || null; }
          if (mapId !== (script.user_map_id || '')) { await API.setMap(id, mapId || null); script.user_map_id = mapId || null; }
          details.close();
          UI.toast('Saved');
        } catch (err) {
          error.textContent = 'Couldn’t save. Try again.';
          submit.disabled = false;
        }
      });
    }

    /* ----- Opening ----- */

    page.onShow = async () => {
      if (ready) return;
      ready = true;
      NT.code.preload();
      script = await API.script(id);
      if (!script || !API.isOwner(script)) {
        ready = false;
        host.replaceChildren(script
          ? emptyState('pencil', 'Read Only', 'Only the author can edit this script.', { label: 'View Source', onClick: () => NT.nav.go(`/scripts/${id}/view`), style: 'gray' })
          : emptyState('doc', 'Script Not Found'));
        return;
      }
      // Without the script's text and its project there is nothing safe to edit: an
      // empty editor here would save over the real thing.
      let content, project = null;
      try {
        content = ((await API.scriptContent(id)) || {}).content || '';
        if (multi) project = await Project.load(id, content);
        // The script is no longer the bundle of its project: it was edited somewhere
        // that knows nothing of projects. Which one stays is not ours to guess.
        if (project && project.inSync === false) {
          page.setTitle(script.name || 'Editor');
          const pick = await choose({ title: 'Script Changed Elsewhere', message: 'It no longer matches this project.', options: [{ label: 'Keep Project', value: 'project' }, { label: 'Use Script', value: 'script' }] });
          if (!pick) {
            ready = false;
            return void NT.nav.back();
          }
          if (pick === 'script') {
            await Project.remove(id);
            project = null;
          } else project.built = false;
        }
      } catch (e) {
        ready = false;
        host.replaceChildren(errorState(() => page.onShow()));
        return;
      }
      const files = adopt(project, content);
      const draft = store.get(draftKey, null);
      const drafted = draftFiles(draft, multi);
      const same = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((p) => a[p] === b[p]);
      const restored = !!drafted && !(same(drafted, files) && (Object.keys(files).length < 2 || draft.minify == null || draft.minify === minify));
      if (drafted && !restored) store.remove(draftKey);

      page.setTitle(script.name || 'Editor');
      host.replaceChildren();
      const mounted = await NT.code.mount(host, {
        files,
        onChange: changed,
        onSave: () => commit(true, saveBtn),
      });
      if (mounted.kind === 'none' || gone) return void mounted.dispose();
      ed = mounted;
      saved = { stamps: snapshot().stamps, minify };
      if (restored) {
        // The draft goes on top of what the server has, so it shows as unsaved; and it
        // is saved against the version it was made from, so a newer one is not overwritten.
        ed.reset(drafted);
        if (typeof draft.minify === 'boolean') minify = draft.minify;
        if ('base' in draft) base = draft.base;
      }

      // A read-only document (a definition file) is left through this.
      const back = h('button.code-return.glass.interactive', { type: 'button', hidden: true, onclick: () => ed.back() }, icon('chevron-left', 18), h('span'));
      host.append(NT.glass.refract(back));
      let lastPath = ed.path;
      ed.on('show', (path, doc) => {
        const was = shownDoc;
        shownDoc = doc;
        if (doc && !was) {
          back.lastChild.textContent = nameOf(ed.paths().includes(lastPath) ? lastPath : ENTRY);
          back.hidden = false;
          if (!NT.util.reducedMotion()) back.animate([{ transform: 'scale(0.2)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: motion.bouncy.duration, easing: motion.bouncy.easing });
        } else if (!doc) back.hidden = true;
        if (path) lastPath = path;
        paint();
      });
      ed.on('problems', () => {
        failing = ed.failing();
        paint();
      });
      if (ed.kind === 'monaco' && NT.lsp.available()) lsp = NT.lsp.attach(ed);

      const more = groupButton('ellipsis', 'More', () => {
        // With the script's page right underneath, "Script Page" would only be Back.
        const paths = NT.nav.paths();
        const under = paths[paths.length - 2] === `/scripts/${id}`;
        UI.menu(more, [
          !under && { label: 'Script Page', icon: 'doc', onSelect: () => NT.nav.go(`/scripts/${id}`) },
          !script.published_at && { label: 'Publish', icon: 'send', onSelect: async () => { if (await commit(false, more)) publishScript(script, () => { script.published_at = new Date().toISOString(); }); } },
          (!under || !script.published_at) && '-',
          { label: 'Delete', icon: 'trash', danger: true, onSelect: () => deleteScript(script, () => { deleted = true; store.remove(draftKey); NT.nav.back(); }, more) },
        ]);
      });
      // Saving keeps you where you are; only Back leaves.
      saveBtn = navButton('check', 'Save', () => commit(true, saveBtn), '.tinted');
      if (multi) filesBtn = groupButton('sidebar', 'Files', toggleFiles);
      page.setTrailing(navGroup(filesBtn, groupButton('info', 'Details', infoSheet), more), saveBtn);
      if (multi && sideWanted()) showSide(true, false);
      paint();
      if (restored) {
        UI.toast('Draft restored');
        autosave();
      } else if (stale) save();
    };

    page.onDestroy(() => {
      window.removeEventListener('beforeunload', onUnload);
      wide.removeEventListener('change', onWidth);
      autosave.cancel();
      stash.cancel();
      if (!ed) return void (gone = true);
      if (!deleted && dirty()) {
        keepDraft();
        if (!leaving && !clash) save();
      }
      gone = true;
      if (lsp) lsp.dispose();
      if (sheet) sheet.close();
      ed.dispose();
    });
    return page;
  };
})();
