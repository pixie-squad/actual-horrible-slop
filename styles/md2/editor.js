/*
  Material Design 2's editor page: a script, opened as a project.

  What is saved, when, and what the line under the title says when that goes wrong is
  the session's (js/session.js). This is the page around it: the code, the files
  (js/explorer.js) in a pane beside it on a wide window and in a bottom sheet on a
  narrow one, and the app bar's actions. The language server (js/lsp.js) reads along
  where there is one.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h } = NT.util;
  const API = NT.api;
  const UI = NT.ui;
  const M = NT.md2;
  const A = NT.actions;
  const { makePage, empty, failed } = M.kit;

  const ENTRY = NT.project.ENTRY;
  const wide = window.matchMedia('(min-width: 840px)');
  const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1);

  NT.pages.editor = function (id) {
    const page = makePage({ title: 'Editor', back: true, hideNav: true, className: 'm-codepage' });
    const host = h('div.m-code');
    const side = h('aside.m-side', { hidden: true, 'aria-label': 'Files' });
    // A read-only document (a definition file) is left through this.
    const back = M.button('', () => ed.back(), { variant: 'tonal', icon: 'arrow_back', cls: '.m-code-return' });
    back.hidden = true;
    page.inner.append(h('div.m-split', side, h('div.m-code-wrap', host, back)));
    const store = NT.util.store;
    let script = null, ed = null, lsp = null, saveBtn = null, filesBtn = null, ready = false, shownDoc = null;
    let sideView = null, sideOpen = false, sheet = null;

    const S = NT.session(id, {
      paint(status) {
        // Which file is open is said under the title.
        const file = shownDoc || (ed.paths().length > 1 && ed.path ? nameOf(ed.path) : '');
        page.setSubtitle(shownDoc ? file : file ? `${file} · ${status.text}` : status.text);
        if (saveBtn) saveBtn.disabled = !status.canSave;
      },
      // Asked before the page is built as well (a script that no longer matches its project).
      choose(o) {
        if (S.script) page.setTitle(S.script.name || 'Editor');
        return UI.choose(o);
      },
    });

    // Back leaves once the project is with the server (or, failing that, in the draft).
    page.onBack = async () => {
      if (await S.leave()) NT.nav.back();
    };

    /* ----- Files ----- */

    function showSide(open) {
      sideOpen = open;
      filesBtn.setAttribute('aria-pressed', String(open));
      if (open && !sideView) {
        // The tree keeps the keyboard while files are looked through; Enter, a second
        // click or a new file hands it to the code.
        sideView = NT.explorer(S.ctx, { onPick: (path, into) => { if (into) ed.focus(); } });
        S.views.add(sideView);
        side.append(sideView.el);
      }
      if (!open && side.contains(document.activeElement)) filesBtn.focus({ preventScroll: true });
      side.hidden = !open;
      if (open) {
        sideView.refresh();
        M.play(side, [{ opacity: 0, transform: 'translateX(-24px)' }, { opacity: 1, transform: 'none' }], M.motion.spatialFast);
      }
    }
    function toggleFiles() {
      if (wide.matches) {
        NT.prefs.data.explorer = !sideOpen;
        store.set('nt.prefs', NT.prefs.data);
        return void showSide(!sideOpen);
      }
      if (sheet) return;
      const view = NT.explorer(S.ctx, { onPick: () => sheet.close() });
      S.views.add(view);
      sheet = M.sheet({ title: 'Files', body: view.el, onClose: () => { S.views.delete(view); sheet = null; } });
    }
    // Closed for a single file, open beside several, until the choice is made here.
    const sideWanted = () => {
      const choice = NT.prefs.data.explorer;
      return wide.matches && (typeof choice === 'boolean' ? choice : ed.paths().length > 1);
    };
    const onWidth = () => {
      if (!filesBtn) return;
      if (wide.matches && sheet) sheet.close();
      if (!wide.matches && sideOpen) showSide(false);
      if (wide.matches && !sideOpen && sideWanted()) showSide(true);
    };
    wide.addEventListener('change', onWidth);

    /* ----- Details ----- */

    function details() {
      const name = M.field('Name', { value: script.name || '', maxLength: 32 });
      const desc = M.field('Description', { rows: 4, maxLength: 1024 });
      desc.input.value = script.description || '';
      const count = () => { desc.note.textContent = `${desc.input.value.length}/1024`; };
      desc.input.addEventListener('input', count);
      count();
      let maps = null, mapId = script.user_map_id || '';
      const mapValue = h('span', '…');
      const mapPick = h('button.m-pick.m-press', { type: 'button', 'aria-label': 'Map' }, mapValue, M.icon('expand_more', { size: 20 }));
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
      const error = h('p.m-error', { role: 'alert' });
      const submit = M.button('Save', null, { submit: true });
      const form = h('form.m-form', { novalidate: true }, name.row, desc.row,
        h('div.m-item.plain', h('span.m-item-text', h('span.m-item-headline', 'Map')), mapPick),
        error,
        h('div.m-dialog-actions', M.button('Cancel', () => d.close(), { variant: 'text' }), submit));
      const d = M.dialog({ title: 'Details', body: form, wide: true });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const n = name.input.value.trim(), t = desc.input.value.trim();
        if (n.length < 3 || n.length > 32) return void (error.textContent = 'Name needs 3 to 32 characters.');
        if (t && (t.length < 32 || t.length > 1024)) return void (error.textContent = 'Description needs 32 to 1024 characters, or leave it empty.');
        error.textContent = '';
        submit.disabled = true;
        try {
          if (n !== (script.name || '')) { await API.saveName(id, n); script.name = n; page.setTitle(n); }
          if (t !== (script.description || '')) { await API.saveDescription(id, t); script.description = t || null; }
          if (mapId !== (script.user_map_id || '')) { await API.setMap(id, mapId || null); script.user_map_id = mapId || null; }
          d.close();
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
      host.replaceChildren(M.loading('.block'));
      NT.code.preload();
      const state = await S.open();
      script = S.script;
      if (state === 'missing' || state === 'readonly') {
        ready = false;
        host.replaceChildren(script
          ? empty('edit', 'Read Only', 'Only the author can edit this script.', { label: 'View Source', onClick: () => NT.nav.go(`/scripts/${id}/view`), variant: 'tonal' })
          : empty('draft', 'Script Not Found'));
        return;
      }
      if (state === 'left') {
        ready = false;
        return void NT.nav.back();
      }
      if (state === 'failed') {
        ready = false;
        host.replaceChildren(failed(() => page.onShow()));
        return;
      }

      page.setTitle(script.name || 'Editor');
      host.replaceChildren();
      const mounted = await NT.code.mount(host, {
        files: S.files,
        onChange: S.changed,
        onSave: () => S.commit(true),
      });
      if (mounted.kind === 'none' || S.gone) return void mounted.dispose();
      ed = mounted;
      S.attach(ed);

      let lastPath = ed.path;
      ed.on('show', (path, doc) => {
        const was = shownDoc;
        shownDoc = doc;
        if (doc && !was) {
          back.lastChild.textContent = nameOf(ed.paths().includes(lastPath) ? lastPath : ENTRY);
          back.hidden = false;
          M.play(back, [{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], M.motion.spatialFast);
        } else if (!doc) back.hidden = true;
        if (path) lastPath = path;
        S.paint();
      });
      if (ed.kind === 'monaco' && NT.lsp.available()) lsp = NT.lsp.attach(ed);

      const more = M.iconButton('more_vert', 'More', () => {
        // With the script's page right underneath, "Script Page" would only be Back.
        const paths = NT.nav.paths();
        const under = paths[paths.length - 2] === `/scripts/${id}`;
        UI.menu(more, [
          !under && { label: 'Script Page', icon: 'doc', onSelect: () => NT.nav.go(`/scripts/${id}`) },
          !script.published_at && { label: 'Publish', icon: 'send', onSelect: async () => { if (await S.commit(false)) A.publish(script, () => { script.published_at = new Date().toISOString(); }); } },
          { label: 'Details', icon: 'info', onSelect: details },
          '-',
          { label: 'Editor Settings', icon: 'gear', onSelect: () => NT.nav.go('/settings/editor') },
          '-',
          { label: 'Delete', icon: 'trash', danger: true, onSelect: () => A.remove(script, () => { S.removed(); NT.nav.back(); }) },
        ]);
      });
      // Saving keeps you where you are; only Back leaves.
      saveBtn = M.iconButton('save', 'Save', () => S.commit(true), { variant: 'filled' });
      if (S.multi) filesBtn = M.iconButton('folder_open', 'Files', toggleFiles);
      page.setTrailing(filesBtn, more, saveBtn);
      if (S.multi && sideWanted()) showSide(true);
      S.start();
    };

    page.onDestroy(() => {
      wide.removeEventListener('change', onWidth);
      S.close();
      if (!ed) return;
      if (lsp) lsp.dispose();
      if (sheet) sheet.close();
      ed.dispose();
    });
    return page;
  };
})();
