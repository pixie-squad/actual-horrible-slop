/*
  The editor page: a script, opened as a project.

  What is saved, when, and what the line under the title says when that goes wrong is
  the session's (js/session.js), the same in every style. This is the page around it:
  the code, the explorer (js/explorer.js) beside it or in a sheet, a test run
  (js/tests.js) under it or in a sheet, and the toolbar. The language server
  (js/lsp.js) reads along where there is one.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h, motion } = NT.util;
  const icon = NT.icon;
  const API = NT.api;
  const UI = NT.ui;
  const { makePage, navButton, navGroup, groupButton, emptyState, errorState, publishScript, deleteScript } = NT.kit;

  const ENTRY = NT.project.ENTRY;
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
        align: 'center',
        source: anchored ? undefined : null,
        onDismiss: () => resolve(result),
      });
      cancel.focus({ preventScroll: true });
    });
  }

  NT.pages.editor = function (id) {
    const page = makePage({ title: 'Editor', back: true, large: false, hideTabbar: true, className: 'page-editor' });
    const host = h('div.code-host');
    const side = h('aside.editor-side', { hidden: true, 'aria-label': 'Files' });
    const dock = h('div.tests-dock', { hidden: true });
    page.inner.append(h('div.editor-split', side, h('div.editor-main', host, dock)));
    const store = NT.util.store;
    let script = null, ed = null, lsp = null, saveBtn = null, filesBtn = null, testBtn = null, ready = false;
    let shownDoc = null;

    const S = NT.session(id, {
      paint(status) {
        // Which file is open is said here; nothing is added across the top for it.
        const file = shownDoc || (ed.paths().length > 1 && ed.path ? nameOf(ed.path) : '');
        page.setSubtitle(shownDoc ? file : file ? `${file} · ${status.text}` : status.text);
        if (saveBtn) saveBtn.disabled = !status.canSave;
      },
      // Asked before the page is built as well (a script that no longer matches its project).
      choose(o) {
        if (S.script) page.setTitle(S.script.name || 'Editor');
        return choose(o);
      },
    });
    const multi = S.multi, ctx = S.ctx, views = S.views;
    const commit = S.commit, paint = S.paint;

    // Back leaves once the project is with the server (or, failing that, in the draft).
    page.onBack = async () => {
      if (await S.leave(page.lead.firstElementChild)) NT.nav.back();
    };

    /* ----- Explorer ----- */

    let sideView = null, sideOpen = false, sideAnim = null, sheet = null;

    function showSide(open, animate) {
      sideOpen = open;
      filesBtn.setAttribute('aria-expanded', String(open));
      if (open && !sideView) {
        // The tree keeps the keyboard while files are looked through; Enter, a second
        // click or a new file hands it to the code.
        sideView = NT.explorer(ctx, { onPick: (path, into) => { if (into) ed.focus(); } });
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

    /* ----- Tests ----- */

    // One panel, under the code where there is room and in a sheet where there is not.
    let tests = null, testsOpen = false, testsAnim = null, testsSheet = null;

    function testsView() {
      if (!tests) tests = NT.kit.testsView({ onRun: runTest, onClose: () => showTests(false, true) });
      return tests;
    }

    function showTests(open, animate) {
      if (!wide.matches) {
        if (open && !testsSheet) {
          testsSheet = UI.sheet({ title: 'Test', body: testsView().el, onClose: () => { testsSheet = null; testsOpen = false; } });
          testsOpen = true;
        } else if (!open && testsSheet) testsSheet.close();
        return;
      }
      if (open === testsOpen && dock.firstChild) return;
      testsOpen = open;
      testBtn.setAttribute('aria-expanded', String(open));
      if (open) dock.append(testsView().el);
      if (!open && dock.contains(document.activeElement)) testBtn.focus({ preventScroll: true });
      const shut = { height: '0px', marginTop: '0px' }, full = { height: '264px', marginTop: '12px' };
      let from = open ? shut : full;
      if (testsAnim) {
        const cs = getComputedStyle(dock);
        from = { height: cs.height, marginTop: cs.marginTop };
        testsAnim.cancel();
        testsAnim = null;
      }
      if (open) dock.hidden = false;
      dock.inert = !open;
      if (!animate || NT.util.reducedMotion()) return void (dock.hidden = !open);
      // As with the explorer: the code is resized around it on every frame.
      const a = dock.animate([from, open ? full : shut], { duration: motion.snappy.duration, easing: motion.snappy.easing, fill: 'forwards' });
      testsAnim = a;
      a.onfinish = () => {
        dock.hidden = !open;
        a.cancel();
        testsAnim = null;
      };
    }

    // The saved script is what runs, so what is on screen is saved first.
    async function runTest(source) {
      const going = NT.tests.of(id);
      if (!going || going.done) {
        if (!(await commit(false, source || testBtn))) return;
        testsView().show(NT.tests.start(script));
      } else testsView().show(going);
      showTests(true, true);
    }

    // The panel changes places with the window's width.
    const onTestsWidth = () => {
      if (!tests || !testsOpen) return;
      if (wide.matches && testsSheet) {
        testsSheet.close();
        testsOpen = false;
        showTests(true, false);
      } else if (!wide.matches && !testsSheet) {
        dock.hidden = true;
        testsOpen = false;
        showTests(true, false);
      }
    };
    wide.addEventListener('change', onTestsWidth);

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
      const state = await S.open();
      script = S.script;
      if (state === 'missing' || state === 'readonly') {
        ready = false;
        host.replaceChildren(script
          ? emptyState('pencil', 'Read Only', 'Only the author can edit this script.', { label: 'View Source', onClick: () => NT.nav.go(`/scripts/${id}/view`), style: 'gray' })
          : emptyState('doc', 'Script Not Found'));
        return;
      }
      if (state === 'left') {
        ready = false;
        return void NT.nav.back();
      }
      if (state === 'failed') {
        ready = false;
        host.replaceChildren(errorState(() => page.onShow()));
        return;
      }

      page.setTitle(script.name || 'Editor');
      host.replaceChildren();
      const mounted = await NT.code.mount(host, {
        files: S.files,
        onChange: S.changed,
        onSave: () => commit(true, saveBtn),
      });
      if (mounted.kind === 'none' || S.gone) return void mounted.dispose();
      ed = mounted;
      S.attach(ed);

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
      if (ed.kind === 'monaco' && NT.lsp.available()) lsp = NT.lsp.attach(ed);

      const more = groupButton('ellipsis', 'More', () => {
        // With the script's page right underneath, "Script Page" would only be Back.
        const paths = NT.nav.paths();
        const under = paths[paths.length - 2] === `/scripts/${id}`;
        UI.menu(more, [
          testBtn && { label: 'Details', icon: 'info', onSelect: infoSheet },
          !under && { label: 'Script Page', icon: 'doc', onSelect: () => NT.nav.go(`/scripts/${id}`) },
          !script.published_at && { label: 'Publish', icon: 'send', onSelect: async () => { if (await commit(false, more)) publishScript(script, () => { script.published_at = new Date().toISOString(); }); } },
          (testBtn || !under || !script.published_at) && '-',
          { label: 'Editor Settings', icon: 'gear', onSelect: () => NT.nav.go('/settings/editor') },
          '-',
          { label: 'Delete', icon: 'trash', danger: true, onSelect: () => deleteScript(script, () => { S.removed(); NT.nav.back(); }, more) },
        ]);
      });
      // Saving keeps you where you are; only Back leaves.
      saveBtn = navButton('check', 'Save', () => commit(true, saveBtn), '.tinted');
      if (multi) filesBtn = groupButton('sidebar', 'Files', toggleFiles);
      // Three to a capsule: with testing there, Details is in the menu beside it.
      if (NT.tests.available()) testBtn = groupButton('play', 'Test', () => runTest(testBtn));
      page.setTrailing(navGroup(filesBtn, testBtn || groupButton('info', 'Details', infoSheet), more), saveBtn);
      if (multi && sideWanted()) showSide(true, false);
      // A run begun before the page was left is still this script's.
      const going = NT.tests.of(id);
      if (testBtn && going && !going.done) {
        testsView().show(going);
        showTests(true, false);
      }
      S.start();
    };

    page.onDestroy(() => {
      wide.removeEventListener('change', onWidth);
      wide.removeEventListener('change', onTestsWidth);
      if (testsSheet) testsSheet.close();
      if (tests) tests.dispose();
      S.close();
      if (!ed) return;
      if (lsp) lsp.dispose();
      if (sheet) sheet.close();
      ed.dispose();
    });
    return page;
  };
})();
