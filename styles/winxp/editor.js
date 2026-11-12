/*
  Windows XP's editor: a script, opened as a project, in a window.

  What is saved, when, and what the status bar says when that goes wrong is the
  session's (js/session.js). This is the window around it: the menu bar and toolbar,
  the file tree (js/explorer.js) in a pane on the left, the code (js/monaco.js) and the
  status bar. The language server (js/lsp.js) reads along where there is one.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h } = NT.util;
  const API = NT.api;
  const UI = NT.ui;
  const W = NT.xp;
  const A = NT.actions;
  const { blank, failed, closeItem, nameOf: scriptName, sep } = W.kit;

  const ENTRY = NT.project.ENTRY;
  const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1);

  NT.pages.editor = function (id) {
    const win = W.window({ title: 'Editor', icon: 'doc', width: 760, height: 520 });
    const code = W.code(), host = code.host;
    const side = h('aside.w-side', { hidden: true, 'aria-label': 'Files' });
    const split = h('div.w-split', side, code.el);
    win.body.append(split);
    const store = NT.util.store;
    let script = null, ed = null, lsp = null, ready = false, shownDoc = null, lastPath = ENTRY;
    let sideView = null, sideOpen = false;

    const saveBtn = W.tool('Save', 'save', () => S.commit(true), { disabled: true, cls: '.keep-text' });
    const filesBtn = W.tool('Files', 'folder', () => showSide(!sideOpen), { cls: '.keep-text' });
    const detailsBtn = W.tool('Details', 'props', () => details(), { cls: '.keep-text' });
    // A read-only document (a definition file) is left through this.
    const backBtn = W.tool('Back', 'back', () => ed.back(), { cls: '.keep-text' });
    backBtn.hidden = true;

    const S = NT.session(id, {
      paint(status) {
        // Which file is open is said in the title, as an editor's window does.
        const file = shownDoc || (ed.path ? nameOf(ed.path) : '');
        win.setTitle(file && (shownDoc || ed.paths().length > 1) ? `${file} - ${scriptName(script)}` : scriptName(script));
        win.setStatus(shownDoc ? 'Read only' : status.text);
        win.setInfo(file);
        saveBtn.disabled = !status.canSave;
      },
      choose: UI.choose,
    });

    // Closing waits until the project is with the server (or, failing that, in the draft).
    win.beforeClose = () => S.leave();

    /* ----- Files ----- */

    function showSide(open) {
      sideOpen = open;
      if (open && !sideView) {
        // The tree keeps the keyboard while files are looked through; Enter, a second
        // click or a new file hands it to the code. On a small screen the tree is the
        // whole window until a file is picked.
        sideView = NT.explorer(S.ctx, { onPick: (path, into) => {
          if (W.narrow.matches) showSide(false);
          if (into || W.narrow.matches) ed.focus();
        } });
        S.views.add(sideView);
        side.append(sideView.el);
      }
      side.hidden = !open;
      split.classList.toggle('has-side', open);
      filesBtn.classList.toggle('is-down', open);
      if (!W.narrow.matches) {
        NT.prefs.data.explorer = open;
        store.set('nt.prefs', NT.prefs.data);
      }
      if (open && sideView) sideView.refresh();
    }
    // Closed for a single file, open beside several, until the choice is made here.
    const sideWanted = () => {
      const choice = NT.prefs.data.explorer;
      return !W.narrow.matches && (typeof choice === 'boolean' ? choice : ed.paths().length > 1);
    };

    /* ----- Details ----- */

    function details() {
      const name = W.field('Name:', { value: script.name || '', maxLength: 32 });
      const desc = h('textarea.w-edit', { rows: 5, maxLength: 1024, 'aria-label': 'Description' });
      desc.value = script.description || '';
      const counter = h('span.w-count', `${desc.value.length}/1024`);
      desc.addEventListener('input', () => { counter.textContent = `${desc.value.length}/1024`; });
      let mapId = script.user_map_id || '';
      const mapHost = h('span.w-combo-host', '…');
      API.maps(script.author_uuid).catch(() => []).then((maps) => {
        const combo = W.combo([['', 'None'], ...maps.map((m) => [m.user_map_id, m.name])], mapId, (v) => { mapId = v; }, 'Map');
        mapHost.replaceChildren(combo.el);
      });
      const error = h('p.w-error', { role: 'alert' });
      const submit = W.button('OK', null, { primary: true, submit: true });
      const dialog = W.dialog({ title: 'Details', icon: 'doc', width: 340 });
      const form = h('form.w-form', { novalidate: true },
        h('div.w-fields',
          name.row,
          h('div.w-field.top', h('label', 'Description:'), h('div.w-field-box', desc, counter)),
          h('div.w-field', h('label', 'Map:'), mapHost),
          error),
        h('div.w-buttons', h('span.w-gap'), submit, W.button('Cancel', () => dialog.close())));
      dialog.body.append(form);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const n = name.input.value.trim(), d = desc.value.trim();
        if (n.length < 3 || n.length > 32) return void (error.textContent = 'Name needs 3 to 32 characters.');
        if (d && (d.length < 32 || d.length > 1024)) return void (error.textContent = 'Description needs 32 to 1024 characters, or leave it empty.');
        error.textContent = '';
        submit.disabled = true;
        try {
          if (n !== (script.name || '')) { await API.saveName(id, n); script.name = n; }
          if (d !== (script.description || '')) { await API.saveDescription(id, d); script.description = d || null; }
          if (mapId !== (script.user_map_id || '')) { await API.setMap(id, mapId || null); script.user_map_id = mapId || null; }
          dialog.close();
          S.paint();
          UI.toast('Saved');
        } catch (err) {
          error.textContent = 'Couldn’t save. Try again.';
          submit.disabled = false;
        }
      });
      dialog.open();
    }

    /* ----- Menus ----- */

    const remove = () => A.remove(script, () => { S.removed(); win.destroy(); });
    const publish = async () => {
      if (await S.commit(false)) A.publish(script, () => { script.published_at = new Date().toISOString(); });
    };
    function menus() {
      win.setMenus([
        {
          label: 'File',
          items: () => [
            { label: 'Save', disabled: saveBtn.disabled, onSelect: () => S.commit(true) },
            !script.published_at && { label: 'Publish', onSelect: publish },
            '-',
            { label: 'Details…', onSelect: details },
            { label: 'Script Page', onSelect: () => NT.nav.go(`/scripts/${id}`) },
            '-',
            { label: 'Delete', onSelect: remove },
            '-',
            closeItem(win),
          ],
        },
        {
          label: 'View',
          items: () => [
            S.multi && { label: 'Files', checked: sideOpen, radio: false, onSelect: () => showSide(!sideOpen) },
            S.multi && '-',
            { label: 'Editor Settings', onSelect: () => NT.nav.go('/settings/editor') },
          ],
        },
      ]);
      win.setToolbar(saveBtn, sep(), S.multi ? filesBtn : null, detailsBtn, backBtn);
    }

    /* ----- Opening ----- */

    win.onShow = async () => {
      if (ready) return;
      ready = true;
      win.busy(true);
      NT.code.preload();
      const state = await S.open();
      script = S.script;
      if (state !== 'ok') win.busy(false);
      if (state === 'missing' || state === 'readonly') {
        ready = false;
        host.replaceChildren(script
          ? blank('Only the author can edit this script.', { label: 'View Source', onClick: () => NT.nav.go(`/scripts/${id}/view`) })
          : blank('Script Not Found'));
        return;
      }
      if (state === 'left') {
        ready = false;
        return void win.destroy();
      }
      if (state === 'failed') {
        ready = false;
        host.replaceChildren(failed(() => win.onShow()));
        return;
      }

      win.setTitle(scriptName(script));
      host.replaceChildren();
      const mounted = await NT.code.mount(host, {
        files: S.files,
        onChange: S.changed,
        onSave: () => S.commit(true),
      });
      win.busy(false);
      if (mounted.kind === 'none' || S.gone) return void mounted.dispose();
      ed = mounted;
      S.attach(ed);

      lastPath = ed.path;
      ed.on('show', (path, doc) => {
        const was = shownDoc;
        shownDoc = doc;
        if (doc && !was) {
          backBtn.querySelector('span').textContent = 'Back to ' + nameOf(ed.paths().includes(lastPath) ? lastPath : ENTRY);
          backBtn.hidden = false;
        } else if (!doc) backBtn.hidden = true;
        if (path) lastPath = path;
        S.paint();
      });
      if (ed.kind === 'monaco' && NT.lsp.available()) lsp = NT.lsp.attach(ed);

      menus();
      if (S.multi && sideWanted()) showSide(true);
      S.start();
    };

    win.onDestroy(() => {
      S.close();
      if (!ed) return;
      if (lsp) lsp.dispose();
      ed.dispose();
    });
    return win;
  };
})();
