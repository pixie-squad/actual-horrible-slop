/*
  An editing session: one script, opened as a project, and everything about keeping it.

  Every style's editor page is built on this. The page draws; what is saved, when, and
  what happens when that goes wrong is here, the same in each.

  One file (main.luau) is the script itself and is saved as its text, exactly as
  typed. From the second file on it is a stored project (project.js): each save keeps
  the sources in the project's holder scripts, bundles them, and saves the bundle as
  the script.

    const s = NT.session(id, { paint(status), choose(o) })
      paint     called whenever what the page says about the session may have changed
      choose    a dialog with more than one way on: { title, message, options: [{ label,
                value }], source } → Promise of the value chosen, or null

    await s.open()      → 'ok' | 'missing' | 'readonly' | 'failed' | 'left'
                          'left': asked which side stays, and neither was chosen
    s.script  s.files   after 'ok': the script, and the files to mount (NT.code.mount,
                        with onChange: s.changed)
    s.attach(ed)        the mounted editor; a draft from this device goes on top
    s.start()           once the page is built: paints, and saves what is waiting
    s.status()          → { text, edited, canSave, saving, clash, failed }
    s.paint()           the page changed what it shows of the session (another file):
                        paint, and draw the explorers, again
    s.changed()         the files changed
    s.commit(cheer, source)   a save someone asked for → true when the script is now
                        what the project says. With a conflict it asks which side stays.
    s.leave(source)     → true when the page may be left (saved, or kept in the draft)
    s.ctx               what the explorer is given (explorer.js); s.views, the explorers
                        showing it, are drawn again with every paint
    s.removed()         the script was deleted
    s.close()           the page is going: keeps a draft, sends what it can
    s.multi  s.gone

  What can go wrong on a save, and what status().text then says:

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
  const { debounce, store } = NT.util;
  const API = NT.api;
  const Project = NT.project;
  const ENTRY = Project.ENTRY;
  const toast = (...a) => NT.ui.toast(...a);

  // A draft from this device, as a set of files. (Before projects it was one text.)
  function draftFiles(draft, multi) {
    if (!draft) return null;
    const files = draft.files && typeof draft.files === 'object' ? draft.files : typeof draft.text === 'string' ? { [ENTRY]: draft.text } : null;
    if (!files || typeof files[ENTRY] !== 'string') return null;
    const paths = Object.keys(files);
    if (paths.some((p) => typeof files[p] !== 'string' || Project.badPath(p))) return null;
    return multi || paths.length === 1 ? files : null;
  }

  NT.session = function (id, hooks) {
    const draftKey = 'nt.draft.' + id;
    const multi = Project.multi();
    let script = null, ed = null, gone = false;

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
    let draft = null, drafted = null, restored = false;
    const views = new Set(); // the explorer, wherever it is showing

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

    function status() {
      const edited = dirty();
      return {
        text: saving ? 'Saving…' : clash ? 'Conflict' : failed ? 'Not saved' : edited ? 'Edited' : note || 'Saved',
        edited,
        canSave: edited || stale || clash,
        saving: saving > 0,
        clash,
        failed,
      };
    }
    function paint() {
      if (!ed || gone) return;
      hooks.paint(status());
      views.forEach((view) => view.refresh());
    }

    // Edits are also kept on this device until the server has them, so closing the tab,
    // going back mid-save or a save that fails cannot lose them: the next visit picks
    // the draft up again. It holds the whole project.
    const keepDraft = () => store.set(draftKey, { files: snapshot().files, minify, base, t: Date.now() });
    const stash = debounce(keepDraft, 300);
    // With autosave off the edits still go to the draft; Save and Back send them.
    const autosave = debounce(() => { if (!clash && NT.editorPrefs.data.autosave) save(); }, 1000);
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
        if (cheer) toast('Saved');
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
            if (!warn) toast('Changed elsewhere', { warn: true });
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
        if (done && cheer) toast('Saved');
        else if (trouble && warn) toast(trouble, { warn: true });
      } catch (e) {
        failed = true;
        const why = String(e && e.message);
        toast(why.includes('too long') ? 'Scripts are limited to 1,000,000 characters' : 'Couldn’t save', { warn: true });
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
        toast('Couldn’t load', { warn: true });
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
      const pick = await hooks.choose({ title: 'Changed Elsewhere', options: [{ label: 'Keep Mine', value: 'mine' }, { label: 'Take Theirs', value: 'theirs' }], source });
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

    const S = {
      id,
      multi,
      views,
      get script() { return script; },
      get gone() { return gone; },
      files: null,
      status,
      paint,
      changed,
      commit,
      dirty,

      async open() {
        script = await API.script(id);
        if (!script) return 'missing';
        if (!API.isOwner(script)) return 'readonly';
        // Without the script's text and its project there is nothing safe to edit: an
        // empty editor here would save over the real thing.
        let content, project = null;
        try {
          content = ((await API.scriptContent(id)) || {}).content || '';
          if (multi) project = await Project.load(id, content);
          // The script is no longer the bundle of its project: it was edited somewhere
          // that knows nothing of projects. Which one stays is not ours to guess.
          if (project && project.inSync === false) {
            const pick = await hooks.choose({ title: 'Script Changed Elsewhere', message: 'It no longer matches this project.', options: [{ label: 'Keep Project', value: 'project' }, { label: 'Use Script', value: 'script' }] });
            if (!pick) return 'left';
            if (pick === 'script') {
              await Project.remove(id);
              project = null;
            } else project.built = false;
          }
        } catch (e) {
          return 'failed';
        }
        const files = adopt(project, content);
        draft = store.get(draftKey, null);
        drafted = draftFiles(draft, multi);
        const same = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((p) => a[p] === b[p]);
        restored = !!drafted && !(same(drafted, files) && (Object.keys(files).length < 2 || draft.minify == null || draft.minify === minify));
        if (drafted && !restored) store.remove(draftKey);
        S.files = files;
        return 'ok';
      },

      attach(mounted) {
        ed = mounted;
        saved = { stamps: snapshot().stamps, minify };
        if (restored) {
          // The draft goes on top of what the server has, so it shows as unsaved; and it
          // is saved against the version it was made from, so a newer one is not overwritten.
          ed.reset(drafted);
          if (typeof draft.minify === 'boolean') minify = draft.minify;
          if ('base' in draft) base = draft.base;
        }
        ed.on('problems', () => {
          failing = ed.failing();
          paint();
        });
      },

      start() {
        paint();
        if (restored) {
          toast('Draft restored');
          autosave();
        } else if (stale) save();
      },

      // Leaving waits until the project is with the server (or, failing that, in the draft).
      async leave(source) {
        if (leaving) return false;
        leaving = true;
        autosave.cancel();
        if (dirty() || clash) await commit(false, source);
        if (clash) return (leaving = false);
        return true;
      },

      ctx: {
        id,
        paths: () => ed.paths(),
        current: () => ed.path,
        mark: (path) => (failing.has(path) ? 'error' : fileDirty(path) ? 'edited' : ''),
        text: (path) => ed.text(path),
        open: (path) => ed.open(path),
        create: (path, text) => ed.add(path, text || ''),
        rename: (from, to) => ed.rename(from, to),
        remove: (path) => ed.remove(path),
        changed: () => changed(),
        redraw: () => views.forEach((view) => view.refresh()),
        minify: () => minify,
        setMinify(on) {
          minify = on;
          changed();
        },
      },

      removed() {
        deleted = true;
        store.remove(draftKey);
        NT.explorer.forget(id);
      },

      close() {
        window.removeEventListener('beforeunload', onUnload);
        autosave.cancel();
        stash.cancel();
        if (!ed) return void (gone = true);
        if (!deleted && dirty()) {
          keepDraft();
          if (!leaving && !clash) save();
        }
        gone = true;
      },
    };
    return S;
  };
})();
