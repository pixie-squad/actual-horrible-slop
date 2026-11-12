/*
  Windows 7's screens. Each is a window: a caption, the command bar with everything
  that can be done in it (a menu first, then what is done most), the content, a status
  bar. A window that shows a place (Home, Scripts, Maps) is Explorer's: the address
  row with Back, Forward and where it is, the navigation pane down its left with the
  other places, and the details pane along its bottom with what is chosen in place of
  a status bar.

  A factory returns the window (ui.js, W.window) without opening it; the shell (app.js)
  opens it, and calls its onShow each time it comes to the front.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h, rel, store } = NT.util;
  const API = NT.api;
  const UI = NT.ui;
  const W = NT.w7;
  const A = NT.actions;
  const P = (NT.pages = {});
  const state = {}; // what one window leaves for the next (which list Scripts opens on)

  /* ---------- Building blocks ---------- */

  const go = (path) => NT.nav.go(path);
  const signIn = () => UI.authDialog('login');
  const byRecent = (list) => list.slice().sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  const nameOf = (s) => s.name || s.script_id;
  const text = (a, b) => String(a).localeCompare(String(b));
  const when = (a, b) => new Date(a) - new Date(b);
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  const link = (path, label) => h('a.w-link', { href: NT.nav.href(path), onclick: (e) => { e.preventDefault(); go(path); } }, label);
  const label = (t) => h('p.w-label', t);
  const sep = () => h('i.w-sep');
  const gap = () => h('span.w-gap');

  // What a field says instead of content: a line, and the button for what it suggests.
  const blank = (title, action) => h('div.w-blank', h('p', title), action ? W.button(action.label, action.onClick) : null);
  const failed = (retry) => blank('Couldn’t Load', { label: 'Try Again', onClick: retry });

  // The columns a list of scripts can have.
  const COL = {
    name: { label: 'Name', width: 'minmax(110px, 2fr)', icon: () => 'doc', cell: nameOf, sort: (a, b) => text(nameOf(a), nameOf(b)) },
    author: { label: 'Author', width: 'minmax(70px, 1fr)', cell: (s) => s.author_name, sort: (a, b) => text(a.author_name, b.author_name) },
    modified: { label: 'Modified', width: '84px', cell: (s) => rel(s.updated_at), sort: (a, b) => when(a.updated_at, b.updated_at) },
    status: { label: 'Status', width: '64px', cell: (s) => (s.published_at ? '' : 'Draft') },
  };

  // Everything that can be done with one script, as menu items. ctx: { refresh, removed, here, art }
  //   here: the menu is in the script's own window, so there is no "Open"
  function scriptItems(s, ctx = {}) {
    const id = s.script_id;
    const owner = API.isOwner(s);
    const [thumb, noThumb] = owner && ctx.art ? NT.media.items('thumbs', id) : [];
    return [
      !ctx.here && { label: 'Open', onSelect: () => go(`/scripts/${id}`) },
      API.session && { label: 'View Source', onSelect: () => go(`/scripts/${id}/view`) },
      owner && { label: 'Edit', onSelect: () => go(`/scripts/${id}/edit`) },
      '-',
      API.session && { label: 'Favorite', checked: !!s.is_favorite, radio: false, onSelect: () => favorite(s, !s.is_favorite, ctx) },
      { label: 'Share', onSelect: () => A.share(s) },
      owner && !s.published_at && { label: 'Publish', onSelect: () => A.publish(s, ctx.refresh) },
      (thumb || noThumb) && '-',
      thumb,
      noThumb,
      owner && '-',
      owner && { label: 'Delete', onSelect: () => A.remove(s, ctx.removed || ctx.refresh) },
    ];
  }

  async function favorite(s, on, ctx) {
    if (!API.session) return void signIn();
    if (ctx.onFavorite) ctx.onFavorite(s, on);
    if (!(await A.favorite(s, on)) && ctx.onFavorite) ctx.onFavorite(s, !on);
    else if (ctx.refresh) ctx.refresh();
  }

  // A list of scripts: Enter or twice on one opens it, the right button has its menu.
  function scriptList(columns, ctx, o = {}) {
    return W.list(columns, Object.assign({
      label: 'Scripts',
      onOpen: (s) => go(`/scripts/${s.script_id}`),
      menu: (s) => scriptItems(s, ctx),
      keys: { Delete: (s) => { if (API.isOwner(s)) A.remove(s, ctx.removed || ctx.refresh); } },
    }, o));
  }
  const sameScript = (a, b) => a.script_id === b.script_id;

  // A picture of a size, in the sunken frame a bitmap sits in.
  function picture(el, w, ht) {
    el.style.width = w + 'px';
    el.style.height = ht + 'px';
    return h('span.w-picture', el);
  }
  function avatar(name, size, seed) {
    const a = NT.util.hash(String(seed || name)) % 360;
    return NT.media.avatar(h('span.w-avatar', {
      'aria-hidden': 'true',
      style: { fontSize: Math.round(size * 0.4) + 'px', background: `linear-gradient(140deg, oklch(0.74 0.16 ${a}), oklch(0.55 0.2 ${(a + 55) % 360}))` },
    }, NT.util.initials(name)), seed);
  }
  function cover(s) {
    return NT.media.cover(h('div.w-cover', { style: NT.util.cover(s.script_id) }), s);
  }

  // The navigation pane of a window that shows a place: the places as a tree, the one
  // shown marked. Going to a place from it stays in the window's frame.
  // filters, in the Scripts window: { get(), set(id) }, the lists under Scripts.
  function places(win, here, filters) {
    const to = (path) => () => NT.nav.travel(win, path);
    const list = (id, title, icon) => ({
      id: 'scripts:' + id,
      label: title,
      icon,
      onSelect: () => {
        if (filters) return void filters.set(id);
        state.scriptsFilter = id;
        NT.nav.travel(win, '/scripts');
      },
    });
    return W.tree([
      { id: '/', label: 'NT Scripting', icon: 'app', onSelect: to('/'), open: true, kids: [
        { id: '/scripts', label: 'Scripts', icon: 'scripts', onSelect: to('/scripts'), open: !!filters,
          kids: [list('mine', 'Mine', 'mine'), list('favorites', 'Favorites', 'star'), list('all', 'All', 'folder')] },
        { id: '/maps', label: 'Maps', icon: 'map', onSelect: to('/maps') },
      ] },
      { id: '/profile', label: 'Profile', icon: 'user', onSelect: () => go('/profile'), gap: true },
      { id: '/settings', label: 'Settings', icon: 'settings', onSelect: () => go('/settings') },
    ], filters ? 'scripts:' + filters.get() : here);
  }

  // The window's own File menu ends the same way everywhere.
  const closeItem = (win) => ({ label: 'Close', onSelect: () => win.close() });
  const goMenu = () => ({
    label: 'Go',
    items: () => [
      { label: 'Home', onSelect: () => go('/') },
      { label: 'Scripts', onSelect: () => go('/scripts') },
      { label: 'Maps', onSelect: () => go('/maps') },
      { label: 'Profile', onSelect: () => go('/profile') },
      '-',
      { label: 'Settings', onSelect: () => go('/settings') },
    ],
  });

  function filePicker(win) {
    const input = h('input', { type: 'file', accept: '.lua,.luau,.txt,text/plain', hidden: true });
    input.addEventListener('change', () => { A.upload(input.files[0]); input.value = ''; });
    win.body.append(input);
    return () => input.click();
  }

  // Reads for a window: the hourglass while it is out, and no two at once.
  function reader(win, fn) {
    let running = null;
    return () => {
      if (running) return running;
      win.busy(true);
      running = Promise.resolve().then(fn).catch((e) => console.error(e)).finally(() => {
        running = null;
        win.busy(false);
      });
      return running;
    };
  }

  /* ---------- Home ---------- */

  P.home = function () {
    const win = W.window({ title: 'NT Scripting', icon: 'app', width: 780, height: 520, status: false });
    const body = h('div.w-page');
    const pickFile = filePicker(win);
    const detail = W.details();
    let loaded = false, stamp = '';
    win.body.append(h('div.w-explorer', places(win, '/').el, body), detail.el);
    win.setAddress(['NT Scripting']);
    detail.set('app', 'NT Scripting');
    win.setToolbar(
      W.button('New Script', A.create),
      W.button('Upload File', () => (API.session ? pickFile() : signIn())),
      !API.session || API.mode === 'demo' ? W.button('Sign In', signIn) : null);

    win.setMenus([
      {
        label: 'Organize',
        items: () => [
          { label: 'New Script', onSelect: A.create },
          { label: 'Upload File…', onSelect: () => (API.session ? pickFile() : signIn()) },
          '-',
          (!API.session || API.mode === 'demo') && { label: 'Sign In…', onSelect: signIn },
          '-',
          closeItem(win),
        ],
      },
      goMenu(),
    ]);

    function lead(s, o) {
      return W.group(o.eyebrow,
        h('div.w-lead',
          W.icon('doc', 32),
          h('div.w-lead-text', h('b', nameOf(s)), h('span', o.meta)),
          h('div.w-buttons', o.actions.map(([text, onClick, primary]) => W.button(text, onClick, { primary })))));
    }

    function render(me, all, mine, favs) {
      const ctx = { refresh: load };
      const kids = [];
      const section = (title, list, columns, more) => {
        const view = scriptList(columns, ctx);
        view.el.classList.add('fit');
        view.set(list);
        kids.push(h('div.w-section', h('div.w-section-head', label(title), more ? h('button.w-link', { type: 'button', onclick: more }, 'See All') : null), view.el));
      };

      const latest = byRecent(mine)[0];
      const featured = byRecent(all.filter((s) => !me || s.author_uuid !== me.user_id))[0];
      if (latest) {
        kids.push(lead(latest, {
          eyebrow: 'Continue Editing',
          meta: `Edited ${rel(latest.updated_at)}${latest.published_at ? '' : ' · Draft'}`,
          actions: [['Edit', () => go(`/scripts/${latest.script_id}/edit`), true], ['Open', () => go(`/scripts/${latest.script_id}`)]],
        }));
      } else if (featured) {
        kids.push(lead(featured, {
          eyebrow: 'Featured',
          meta: `${featured.author_name} · ${rel(featured.updated_at)}`,
          actions: me ? [['Open', () => go(`/scripts/${featured.script_id}`), true]] : [['Open', () => go(`/scripts/${featured.script_id}`), true], ['Sign In', signIn]],
        }));
      }

      const seeAll = (filter) => () => { state.scriptsFilter = filter; NT.nav.travel(win, '/scripts'); };
      if (me) {
        if (mine.length) section('My Scripts', byRecent(mine).slice(0, 10), [COL.name, COL.modified, COL.status], seeAll('mine'));
        else kids.push(h('div.w-section', label('My Scripts'), blank('No Scripts Yet', { label: 'New Script', onClick: A.create })));
        if (favs.length) section('Favorites', favs.slice(0, 10), [COL.name, COL.author, COL.modified], seeAll('favorites'));
      }
      const recent = byRecent(all.filter((s) => !me || s.author_uuid !== me.user_id)).slice(0, 6);
      if (recent.length) section('Recently Updated', recent, [COL.name, COL.author, COL.modified], seeAll('all'));
      else if (!me) kids.push(blank('Sign In to Browse', { label: 'Sign In', onClick: signIn }));
      body.replaceChildren(...kids);
      detail.set('app', 'NT Scripting', me ? plural(mine.length, 'script') : null);
    }

    const load = reader(win, async () => {
      const me = API.session;
      try {
        const [all, mine, favs] = await Promise.all([
          API.scripts().catch(() => []),
          me ? API.userScripts(me.user_id) : [],
          me ? API.favorites(me.user_id).catch(() => []) : [],
        ]);
        // Coming back to the window reads again; if nothing changed, it is left as it is.
        const fresh = JSON.stringify([all, mine, favs]);
        if (loaded && fresh === stamp) return;
        stamp = fresh;
        render(me, all, mine, favs);
        loaded = true;
      } catch (e) {
        loaded = false;
        stamp = '';
        body.replaceChildren(failed(load));
      }
    });

    win.onShow = load;
    return win;
  };

  /* ---------- Scripts ---------- */

  P.scripts = function () {
    const win = W.window({ title: 'Scripts', icon: 'scripts', width: 780, height: 500, status: false });
    const pickFile = filePicker(win);
    // Your own scripts come first. The window reopens on whichever list was used last.
    const FILTERS = ['mine', 'favorites', 'all'], SORTS = { name: [0, 1], author: [1, 1], recent: [2, -1] };
    const kept = API.session ? store.get('nt.scripts.filter') : null;
    let chosen = FILTERS.includes(kept) ? kept : API.session ? 'mine' : 'all';
    let query = '';
    let filter = chosen;
    let data = null, signedOut = false, stamp = '';
    const sortKey = SORTS[store.get('nt.scripts.sort')] ? store.get('nt.scripts.sort') : 'recent';

    const ctx = {
      refresh: () => load(),
      onFavorite(s, on) {
        if (!data) return;
        for (const list of [data.all, data.mine]) for (const x of list) if (x.script_id === s.script_id) x.is_favorite = on;
        data.favs = data.favs.filter((x) => x.script_id !== s.script_id);
        if (on) data.favs.unshift(Object.assign({}, s, { is_favorite: true }));
        render();
      },
    };

    const list = scriptList([COL.name, COL.author, COL.modified, COL.status], ctx, {
      sortBy: SORTS[sortKey],
      onSort: ([i]) => store.set('nt.scripts.sort', ['name', 'author', 'recent'][i] || 'recent'),
      onPick: () => sync(),
    });
    list.el.classList.add('fill');
    // Mine, Favorites and All are under Scripts in the navigation pane, and in View.
    const nav = places(win, '/scripts', { get: () => filter, set: (v) => { choose(v); render(); } });
    const detail = W.details();
    win.body.append(h('div.w-explorer', nav.el, h('div.w-page.fill', list.el)), detail.el);

    const find = W.search({ placeholder: 'Search Scripts', 'aria-label': 'Search Scripts' });
    const openBtn = W.button('Open', () => { if (list.picked) go(`/scripts/${list.picked.script_id}`); });
    const editBtn = W.button('Edit', () => { if (list.picked) go(`/scripts/${list.picked.script_id}/edit`); });
    const delBtn = W.button('Delete', () => { if (list.picked) A.remove(list.picked, ctx.refresh); });
    win.setToolbar(W.button('New Script', A.create), openBtn, editBtn, delBtn);
    win.setAddress(['NT Scripting', 'Scripts'], find);
    function sync() {
      const s = list.picked;
      openBtn.disabled = !s;
      editBtn.disabled = delBtn.disabled = !s || !API.isOwner(s);
      if (s) detail.set('doc', nameOf(s), s.published_at ? 'Script' : 'Draft', `Author: ${s.author_name}`, `Modified: ${rel(s.updated_at)}`);
      else detail.set('scripts', 'Scripts', data ? plural((filter === 'mine' ? data.mine : filter === 'favorites' ? data.favs : data.all).length, 'script') : null);
    }
    sync();

    function choose(v) {
      filter = chosen = v;
      store.set('nt.scripts.filter', v);
    }

    win.setMenus([
      {
        label: 'Organize',
        items: () => [
          { label: 'New Script', onSelect: A.create },
          { label: 'Upload File…', onSelect: () => (API.session ? pickFile() : signIn()) },
          '-',
          ...(list.picked ? scriptItems(list.picked, ctx) : [{ label: 'Open', disabled: true }]),
          '-',
          closeItem(win),
        ],
      },
      {
        label: 'View',
        items: () => [
          { label: 'Mine', checked: filter === 'mine', onSelect: () => { choose('mine'); render(); } },
          { label: 'Favorites', checked: filter === 'favorites', onSelect: () => { choose('favorites'); render(); } },
          { label: 'All', checked: filter === 'all', onSelect: () => { choose('all'); render(); } },
          '-',
          { label: 'Refresh', onSelect: () => load() },
        ],
      },
      goMenu(),
    ]);

    // A search looks through everything; `chosen` is the list to return to after it.
    find.addEventListener('input', () => {
      const next = find.value.trim().toLowerCase();
      const to = next && !query ? 'all' : !next && query ? chosen : filter;
      query = next;
      filter = to;
      if (data) render();
      else nav.mark('scripts:' + filter);
    });

    function render() {
      nav.mark('scripts:' + filter);
      if (signedOut) {
        list.say(blank('Sign In to Browse', { label: 'Sign In', onClick: signIn }));
        win.setStatus('');
        return sync();
      }
      let rows = filter === 'mine' ? data.mine : filter === 'favorites' ? data.favs : data.all;
      if (query) rows = rows.filter((s) => (`${s.name} ${s.description || ''} ${s.author_name}`).toLowerCase().includes(query));
      if (rows.length) list.set(rows, sameScript);
      else {
        list.say(query ? blank(`Nothing matches “${query}”.`)
          : filter === 'mine' ? blank('No Scripts Yet', API.session ? { label: 'New Script', onClick: A.create } : { label: 'Sign In', onClick: signIn })
            : filter === 'favorites' ? blank('No Favorites')
              : blank('No Scripts'));
      }
      win.setStatus(query ? plural(rows.length, 'result') : plural(rows.length, 'script'));
      sync();
    }

    const load = reader(win, async () => {
      const me = API.session;
      const first = !data;
      try {
        const [all, mine, favs] = await Promise.all([
          API.scripts(),
          me ? API.userScripts(me.user_id) : [],
          me ? API.favorites(me.user_id).catch(() => []) : [],
        ]);
        const fresh = JSON.stringify([all, mine, favs]);
        if (!first && !signedOut && fresh === stamp) return;
        stamp = fresh;
        signedOut = false;
        data = { all, mine, favs };
        render();
      } catch (e) {
        stamp = '';
        if (e && e.status === 401) { signedOut = true; data = { all: [], mine: [], favs: [] }; render(); }
        else list.say(failed(load));
      }
    });

    win.onShow = () => {
      // The Start menu opens Scripts on one of its lists.
      if (W.openOn) {
        state.scriptsFilter = W.openOn;
        W.openOn = null;
      }
      if (state.scriptsFilter) {
        choose(state.scriptsFilter);
        delete state.scriptsFilter;
        if (data) render();
        else nav.mark('scripts:' + filter);
      }
      // What was typed into the Start menu's search box is looked for here.
      if (W.find) {
        find.value = W.find;
        W.find = null;
        find.dispatchEvent(new Event('input'));
      }
      load();
    };
    return win;
  };

  /* ---------- Script ---------- */

  P.script = function (id) {
    // A property sheet: its tabs, then its buttons along the bottom, and no status bar.
    const win = W.window({ title: 'Script', icon: 'doc', width: 470, height: 480, status: false });
    const body = h('div.w-page.fill');
    win.body.append(body);
    const changed = h('span.w-note');

    let script = null, params = [], releases = [], tab = 'general';
    const values = {};
    const valueOf = (p) => (p.id in values ? values[p.id] : p.default_value);
    const ctx = { refresh: () => load(), removed: () => win.destroy(), here: true, art: true };

    const battle = W.button('Start Friendly Battle', startBattle, { primary: true });

    win.setMenus([
      { label: 'File', items: () => [...(script ? scriptItems(script, ctx) : []), '-', closeItem(win)] },
      goMenu(),
    ]);

    async function startBattle() {
      if (!script) return;
      if (!API.session) return void signIn();
      battle.disabled = true;
      try {
        const res = await API.share(script.script_id);
        if (res.type === 'authorDoesNotHaveConnect') {
          UI.toast('The author hasn’t linked Null’s Connect', { warn: true });
        } else if (API.mode === 'live') {
          const byId = (pid) => {
            const p = params.find((x) => x.id === pid);
            return p ? valueOf(p) : 0;
          };
          window.location.href = API.battleLink(script, res.token, byId);
        } else {
          UI.toast('Battle ready (demo)');
        }
      } catch (e) {
        UI.toast('The author isn’t verified', { warn: true });
      } finally {
        battle.disabled = false;
      }
    }

    function paramRow(p, onChange) {
      const name = API.paramLabel(p);
      if (p.type === 'bool') {
        return W.check(name, valueOf(p) === 1, (on) => {
          values[p.id] = on ? 1 : 0;
          if (values[p.id] === p.default_value) delete values[p.id];
          onChange();
        }).el;
      }
      const valueEl = h('span.w-param-value', String(valueOf(p)));
      const reset = W.button('Default', () => { bar.set(p.default_value); apply(p.default_value); });
      reset.disabled = valueOf(p) === p.default_value;
      const apply = (v) => {
        if (v === p.default_value) delete values[p.id];
        else values[p.id] = v;
        valueEl.textContent = String(v);
        reset.disabled = v === p.default_value;
        onChange();
      };
      const bar = W.trackbar({ min: p.min_value == null ? 0 : p.min_value, max: p.max_value == null ? 100 : p.max_value, value: valueOf(p), label: name, onInput: apply });
      return h('div.w-param', h('span.w-param-name', name), bar.el, valueEl, reset);
    }

    function general(s) {
      const owner = API.isOwner(s);
      const flags = [];
      if (!s.published_at) flags.push('Draft');
      if (API.isOutdated(s)) flags.push('Outdated');
      // The box says what is so: it goes back if the change does not go through.
      const fav = W.check('Favorite', !!s.is_favorite, (on) => favorite(s, on, {}).then(() => fav.set(!!s.is_favorite)));
      const [thumb] = owner ? NT.media.items('thumbs', s.script_id) : [];
      const art = picture(cover(s), 128, 72);
      const pictureBtn = W.button('Picture…', () => W.menu(pictureBtn, NT.media.items('thumbs', s.script_id)));
      return h('div.w-prop',
        h('div.w-prop-head', art,
          h('div.w-prop-text',
            h('b', nameOf(s)),
            h('span', avatarLine(s)),
            h('span', `Modified ${rel(s.updated_at)}`),
            flags.length ? h('span', flags.join(', ')) : null)),
        h('i.w-rule'),
        s.description ? h('p.w-desc', s.description) : null,
        API.isOutdated(s) ? h('div.w-callout', W.icon('warning', 16), h('span', 'Released before the latest scripting API change. It may not work as expected.')) : null,
        API.session ? fav.el : null,
        h('div.w-buttons.left',
          API.session ? W.button('View Source', () => go(`/scripts/${s.script_id}/view`)) : null,
          owner ? W.button('Edit', () => go(`/scripts/${s.script_id}/edit`)) : null,
          owner && !s.published_at ? W.button('Publish', () => A.publish(s, load)) : null,
          W.button('Share', () => A.share(s)),
          thumb ? pictureBtn : null));
    }
    const avatarLine = (s) => ['by ', link(`/users/${s.author_uuid}`, s.author_name)];

    function parameters() {
      const groups = new Map();
      for (const p of params) {
        if (!groups.has(p.group_id)) groups.set(p.group_id, []);
        groups.get(p.group_id).push(p);
      }
      const count = () => {
        const n = params.filter((p) => valueOf(p) !== p.default_value).length;
        changed.textContent = n ? `${n} changed` : '';
      };
      count();
      return h('div.w-scroll', [...groups].map(([gid, list]) => W.group(API.groupLabel(gid), list.map((p) => paramRow(p, count)))));
    }

    function history() {
      const sorted = releases.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const view = W.list([
        { label: 'Released', width: '120px', cell: (r) => new Date(r.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) + (r === sorted[0] ? ' (Latest)' : '') },
        { label: 'Notes', width: 'minmax(80px, 1fr)', cell: (r) => r.description || '' },
        { label: 'When', width: '84px', cell: (r) => rel(r.created_at) },
      ], { label: 'Releases' });
      view.set(sorted);
      return view.el;
    }

    function render() {
      const s = script;
      win.setTitle(nameOf(s));
      const pages = [{ id: 'general', label: 'General', body: general(s) }];
      if (params && params.length) pages.push({ id: 'parameters', label: 'Parameters', body: parameters() });
      if (releases && releases.length) pages.push({ id: 'releases', label: 'Releases', body: history() });
      const tabs = W.tabs(pages, pages.some((p) => p.id === tab) ? tab : 'general', (v) => { tab = v; });
      tabs.el.classList.add('fill');
      body.replaceChildren(tabs.el, h('div.w-buttons', changed, gap(), battle));
    }

    const load = reader(win, async () => {
      let s;
      try {
        s = await API.script(id);
      } catch (e) {
        if (!script) body.replaceChildren(failed(load));
        return;
      }
      if (!s) {
        script = null;
        // Signed out, the service answers for nothing: that is not the script missing.
        body.replaceChildren(API.session || API.mode !== 'live'
          ? blank('Script Not Found', { label: 'Browse Scripts', onClick: () => go('/scripts') })
          : blank('Sign In to View', { label: 'Sign In', onClick: signIn }));
        return;
      }
      const [ps, rs] = await Promise.all([API.parameters(id).catch(() => null), API.releases(id).catch(() => [])]);
      const fresh = JSON.stringify([s, ps, rs]);
      // Read again on return (after editing or publishing); parameter choices stay as they were set.
      if (script && fresh === load.stamp) return;
      load.stamp = fresh;
      script = s;
      params = ps || [];
      releases = rs || [];
      render();
    });

    win.onShow = load;
    return win;
  };

  /* ---------- Source viewer ---------- */

  P.viewer = function (id, revision) {
    const win = W.window({ title: 'Source', icon: 'doc', width: 640, height: 460 });
    const code = W.code(), host = code.host;
    win.body.append(code.el);
    let view = null, ready = false, content = '';
    const copy = W.button('Copy', () => A.copy(content), { disabled: true });
    win.setToolbar(copy);
    win.setMenus([{ label: 'File', items: () => [{ label: 'Copy', disabled: !content, onSelect: () => A.copy(content) }, { label: 'Script Page', onSelect: () => go(`/scripts/${id}`) }, '-', closeItem(win)] }]);

    win.onShow = async () => {
      if (ready) return;
      ready = true;
      win.busy(true);
      try {
        const script = await API.script(id);
        if (script) win.setTitle(`${nameOf(script)} - Source`);
        let res;
        try {
          res = await API.scriptContent(id, revision);
        } catch (e) {
          ready = false;
          host.replaceChildren(API.session ? blank('Source Unavailable') : blank('Sign In to View Source', { label: 'Sign In', onClick: signIn }));
          return;
        }
        content = (res && res.content) || '';
        const lines = content ? content.split('\n').length : 0;
        const rev = revision || (res && res.revision);
        win.setStatus(plural(lines, 'line'));
        win.setInfo(rev ? 'Revision ' + rev : '');
        copy.disabled = !content;
        if (!content) return void host.replaceChildren(blank('Empty Script'));
        view = await NT.code.mount(host, { value: content, readOnly: true });
      } finally {
        win.busy(false);
      }
    };
    win.onDestroy(() => { if (view) view.dispose(); });
    return win;
  };

  /* ---------- Maps ---------- */

  P.maps = function () {
    const win = W.window({ title: 'Maps', icon: 'map', width: 720, height: 460, status: false });
    const page = h('div.w-page.fill');
    const detail = W.details();
    win.body.append(h('div.w-explorer', places(win, '/maps').el, page), detail.el);
    win.setAddress(['NT Scripting', 'Maps']);
    let maps = null, listed = '', busy = false;

    const input = W.input({ type: 'url', inputMode: 'url', autocomplete: 'off', placeholder: 'Paste a map link', 'aria-label': 'Map link' });
    // What came of adding a map is said where a place's window says things.
    const say = (t) => { if (t) UI.toast(t); };

    function rename(m) {
      const row = list.rowOf(m);
      if (!row) return;
      const cell = row.querySelector('.w-cell > span');
      const field = W.input({ value: m.name, minLength: 3, maxLength: 64, 'aria-label': 'Map name', class: 'w-inline' });
      let finished = false;
      const finish = async (commit) => {
        if (finished) return;
        finished = true;
        const next = field.value.trim();
        field.replaceWith(cell);
        list.focus();
        if (!commit || !next || next === m.name) return;
        if (next.length < 3) return void UI.toast('Names need at least 3 characters', { warn: true });
        const old = m.name;
        m.name = next;
        cell.textContent = next;
        try { await API.renameMap(m.user_map_id, next); }
        catch (e) { m.name = old; cell.textContent = old; UI.toast('Couldn’t rename', { warn: true }); }
      };
      field.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') finish(false);
      });
      field.addEventListener('blur', () => finish(true));
      cell.replaceWith(field);
      field.focus();
      field.select();
    }
    async function remove(m) {
      const ok = await UI.confirm({ title: `Delete “${m.name}”?`, message: 'This can’t be undone.', confirmLabel: 'Delete', destructive: true });
      if (!ok) return;
      try {
        await API.deleteMap(m.user_map_id);
        maps = maps.filter((x) => x !== m);
        show();
      } catch (e) { UI.toast('Couldn’t delete', { warn: true }); }
    }
    const items = (m) => [
      { label: 'Rename', onSelect: () => rename(m) },
      { label: 'Copy ID', onSelect: () => A.copy(m.internal_id) },
      '-',
      { label: 'Delete', onSelect: () => remove(m) },
    ];

    const list = W.list([
      { label: 'Name', width: 'minmax(100px, 1fr)', icon: () => 'map', cell: (m) => m.name, sort: (a, b) => text(a.name, b.name) },
      { label: 'ID', width: 'minmax(100px, 1fr)', cell: (m) => m.internal_id },
    ], { label: 'Maps', menu: items, onOpen: rename, onPick: () => sync(), keys: { Delete: remove, F2: rename } });
    list.el.classList.add('fill');

    const renameBtn = W.button('Rename', () => { if (list.picked) rename(list.picked); });
    const copyBtn = W.button('Copy ID', () => { if (list.picked) A.copy(list.picked.internal_id); });
    const delBtn = W.button('Delete', () => { if (list.picked) remove(list.picked); });
    const sync = () => {
      const m = list.picked;
      renameBtn.disabled = copyBtn.disabled = delBtn.disabled = !m;
      if (m) detail.set('map', m.name, 'Map', `ID: ${m.internal_id}`);
      else detail.set('map', 'Maps', maps ? plural(maps.length, 'map') : null);
    };
    sync();

    async function submit(value) {
      if (busy || !String(value).trim() || !maps) return;
      const parsed = A.mapLink(value);
      if (parsed.error) return say(parsed.error);
      if (maps.some((m) => m.internal_id === parsed.id)) { input.value = ''; return say('Already added.'); }
      busy = true;
      try {
        const existing = maps.find((m) => m.internal_id.startsWith(parsed.id.split(':')[0]));
        if (existing) {
          await API.updateMap(existing.user_map_id, parsed.id);
          existing.internal_id = parsed.id;
          show();
          say('Updated.');
        } else {
          maps.unshift(await API.addMap(parsed.id, `New map ${maps.length + 1}`));
          show();
          say('Saved.');
        }
        input.value = '';
      } catch (e) {
        say('Couldn’t save. Try again.');
      } finally {
        busy = false;
      }
    }
    const paste = async () => {
      if (!navigator.clipboard || !navigator.clipboard.readText) return say('Paste the link into the field.');
      try {
        const value = await navigator.clipboard.readText();
        if (!value.trim()) return say('Clipboard is empty.');
        input.value = value;
        submit(value);
      } catch (e) {
        say('Paste the link into the field.');
      }
    };
    input.addEventListener('paste', () => setTimeout(() => submit(input.value), 0));
    input.addEventListener('input', () => say(''));
    const form = h('form.w-bar', { onsubmit: (e) => { e.preventDefault(); submit(input.value); } },
      h('label', 'Map link:'), input, W.button('Paste', paste), W.button('Add', null, { submit: true }));

    function show() {
      if (maps.length) list.set(maps);
      else list.say(blank('No Maps Yet'));
      say('');
      sync();
    }

    win.setMenus([
      { label: 'Organize', items: () => [...(list.picked ? items(list.picked) : [{ label: 'Rename', disabled: true }]), '-', closeItem(win)] },
      goMenu(),
    ]);

    // The form is built once: coming back to the window must not wipe a half-typed link.
    let built = false;
    win.onShow = reader(win, async () => {
      if (!API.session) {
        page.replaceChildren(blank('Sign In to Add Maps', { label: 'Sign In', onClick: signIn }));
        return;
      }
      if (!built) {
        win.setToolbar(renameBtn, copyBtn, delBtn);
        page.replaceChildren(form, list.el);
        built = true;
      }
      try {
        const next = await API.maps(API.session.user_id);
        const fresh = JSON.stringify(next);
        if (maps && fresh === listed) return;
        listed = fresh;
        maps = next;
        show();
      } catch (e) {
        listed = '';
        list.say(failed(() => win.onShow()));
      }
    });
    return win;
  };

  /* ---------- Profile ---------- */

  function userWindow(userId) {
    const win = W.window({ title: 'Profile', icon: 'user', width: 520, height: 460, status: false });
    const body = h('div.w-page.fill');
    win.body.append(body);
    let loaded = false, stamp = '', tab = 'scripts';
    win.setMenus([{ label: 'File', items: () => [{ label: 'Settings', onSelect: () => go('/settings') }, '-', closeItem(win)] }, goMenu()]);

    const load = reader(win, async () => {
      const me = API.session;
      const target = userId || (me && me.user_id);
      if (!target) return void body.replaceChildren(blank('Not Signed In', { label: 'Sign In', onClick: signIn }));
      let user, scripts, favs;
      try {
        [user, scripts, favs] = await Promise.all([
          userId ? API.user(userId) : Promise.resolve(me),
          API.userScripts(target),
          API.favorites(target).catch(() => []),
        ]);
      } catch (e) {
        body.replaceChildren(e && e.status === 404 ? blank('User Not Found')
          : e && e.status === 401 && !me ? blank('Sign In to View', { label: 'Sign In', onClick: signIn })
            : failed(load));
        loaded = false;
        return;
      }
      const fresh = JSON.stringify([user, scripts, favs]);
      if (loaded && fresh === stamp) return;
      stamp = fresh;
      const own = !!me && user.user_id === me.user_id;
      const name = user.name || user.username;
      win.setTitle(name);
      const ctx = { refresh: load };
      const drafts = scripts.filter((s) => !s.published_at).length;

      const face = picture(avatar(name, 48, user.user_id), 48, 48);
      const photo = W.button('Picture…', () => W.menu(photo, NT.media.items('avatars', user.user_id)));
      const mine = scriptList([COL.name, COL.modified, COL.status], ctx);
      if (scripts.length) mine.set(byRecent(scripts));
      else mine.say(blank('No Scripts Yet', own ? { label: 'New Script', onClick: A.create } : null));
      const liked = scriptList([COL.name, COL.author, COL.modified], ctx);
      if (favs.length) liked.set(favs);
      else liked.say(blank('No Favorites'));
      const tabs = W.tabs([
        { id: 'scripts', label: 'Scripts', body: mine.el },
        { id: 'favorites', label: 'Favorites', body: liked.el },
      ], tab, (v) => { tab = v; });
      tabs.el.classList.add('fill');

      body.replaceChildren(
        h('div.w-prop-head', face,
          h('div.w-prop-text', h('b', name), h('span', '@' + user.username),
            h('span', [plural(scripts.length, 'script'), plural(favs.length, 'favorite'), own ? plural(drafts, 'draft') : null].filter(Boolean).join(', '))),
          own ? h('div.w-buttons.stack',
            NT.media.items('avatars', user.user_id).length ? photo : null,
            W.button('Audit Log', () => go(`/users/${user.user_id}/audit`)),
            W.button('Settings', () => go('/settings'))) : null),
        tabs.el);
      loaded = true;
    });

    win.onShow = load;
    return win;
  }

  P.profile = () => userWindow(null);
  P.user = (id) => userWindow(id);

  /* ---------- Settings ---------- */

  P.settings = function () {
    const win = W.window({ title: 'Settings', icon: 'settings', width: 400, height: 492, status: false });
    const body = h('div.w-page.fill');
    win.body.append(body);
    let tab = 'general';

    function render() {
      const me = API.session;
      const prefs = NT.prefs.data;
      const demo = API.mode === 'demo';

      const account = me
        ? [h('div.w-lead', W.icon('user', 32),
          h('div.w-lead-text', h('b', me.name || me.username), h('span', demo ? 'Demo account' : '@' + me.username)),
          h('div.w-buttons', W.button('Profile', () => go('/profile')))),
        !demo ? h('div.w-line', h('span', `Password: ${me.has_password ? 'On' : 'Not set'}`), gap(), W.button('Change…', () => UI.passwordDialog())) : null,
        h('div.w-line', gap(),
          demo ? W.button('Sign In With Your Account', signIn) : null,
          // Nothing is lost by logging out (drafts stay on this device), so it does not ask.
          W.button('Log Out', async (e) => {
            e.currentTarget.disabled = true;
            await API.logout();
            NT.nav.reset(['/']);
          }))]
        : [h('div.w-line', h('span', 'Not signed in.'), gap(), W.button('Sign In', signIn))];

      const general = h('div.w-scroll',
        W.group('Account', account),
        W.group('Editor', h('div.w-line', h('span', 'How the code editor behaves.'), gap(), W.button('Editor Settings', () => go('/settings/editor')))),
        demo ? W.group('Demo Data', h('div.w-line', h('span', 'Put the sample data back as it was.'), gap(), W.button('Reset', async () => {
          const ok = await UI.confirm({ title: 'Reset Demo Data?', confirmLabel: 'Reset', destructive: true });
          if (!ok) return;
          API.resetDemo();
          UI.toast('Demo data reset');
        }))) : null);

      // Another whole look of the app (js/styles.js). Choosing one loads it.
      const styles = NT.styles.list;
      const style = W.combo(styles.map((s) => [s.id, s.name]), NT.styles.current, (id) => NT.styles.use(id), 'Style');
      const theme = W.radios([['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], prefs.theme, (v) => NT.prefs.set({ theme: v }));
      const accents = ['blue', 'indigo', 'purple', 'pink', 'orange', 'green', 'teal'];
      const swatches = h('div.w-swatches', { role: 'radiogroup', 'aria-label': 'Accent color' }, accents.map((a) => {
        const b = h('button.w-swatch', { type: 'button', role: 'radio', 'aria-label': a, title: a[0].toUpperCase() + a.slice(1), 'aria-checked': String(prefs.accent === a), dataset: { accent: a } });
        b.addEventListener('click', () => {
          NT.prefs.set({ accent: a });
          swatches.querySelectorAll('.w-swatch').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        });
        return b;
      }));
      // Glass that is not see-through, as Windows 7's own window colours offer.
      const glass = W.check('Enable transparency', !prefs.solid, (on) => NT.prefs.set({ solid: !on }));
      // The desktop's picture: Harmony and one from each of Windows 7's themes (style.css),
      // chosen from their pictures as its Desktop Background has them.
      const WALLS = [['', 'Harmony'], ['nature', 'Nature'], ['landscapes', 'Landscapes'], ['architecture', 'Architecture'], ['characters', 'Characters'], ['scenes', 'Scenes'], ['none', 'Solid color']];
      const walls = h('div.w-walls', { role: 'radiogroup', 'aria-label': 'Desktop background' }, WALLS.map(([id, name]) => {
        const b = h('button.w-wall', { type: 'button', role: 'radio', 'aria-label': name, title: name, 'aria-checked': String(NT.prefs.wall === id) },
          id === 'none' ? h('i') : h('img', { src: new URL(`styles/win7/wallpapers/${id || 'harmony'}-thumb.jpg`, document.baseURI).href, alt: '', width: 64, height: 40, draggable: false }));
        b.addEventListener('click', () => {
          NT.prefs.setWall(id);
          walls.querySelectorAll('.w-wall').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        });
        return b;
      }));
      const appearance = h('div.w-scroll',
        h('div.w-line', h('label', 'Style:'), style.el),
        W.group('Theme', theme.el),
        W.group('Color', swatches, glass.el),
        W.group('Desktop Background', walls));

      const tabs = W.tabs([
        { id: 'general', label: 'General', body: general },
        { id: 'appearance', label: 'Appearance', body: appearance },
      ], tab, (v) => { tab = v; });
      tabs.el.classList.add('fill');
      body.replaceChildren(tabs.el, h('div.w-buttons', W.button('Close', () => win.close(), { primary: true })));
    }

    win.listen('session', render);
    win.onShow = render;
    return win;
  };

  /* ---------- Editor settings ----------
     How the editor behaves (js/editor-prefs.js). Reached from Settings and from the
     editor's own menu; an editor that is open takes each change as it is made. */

  const EP = NT.editorPrefs;
  const flag = (title, key) => W.check(title, EP.data[key], (on) => EP.set({ [key]: on })).el;
  // options: [[value, label]]
  const choice = (title, key, options) => h('div.w-line', h('label', title + ':'), gap(), W.combo(options, EP.data[key], (v) => EP.set({ [key]: v }), title).el);

  P.editorSettings = function () {
    const win = W.window({ title: 'Editor', icon: 'settings', width: 400, height: 440, status: false });
    const body = h('div.w-page.fill');
    win.body.append(body);
    let tab = 'editing', reset = null;

    function render() {
      const indent = W.radios([[false, 'Tabs'], [true, 'Spaces']], EP.data.spaces, (v) => EP.set({ spaces: v }));
      const pages = [
        { id: 'editing', label: 'Editing', body: h('div.w-scroll',
          flag('Auto-Insert end', 'closeBlocks'),
          flag('Auto-Close Brackets', 'closeBrackets'),
          flag('Auto-Close Quotes', 'closeQuotes'),
          flag('Suggest While Typing', 'suggest'),
          flag('Autosave', 'autosave'),
          choice('Accept on Enter', 'acceptEnter', [['smart', 'Smart'], ['on', 'Always'], ['off', 'Never']]),
          W.group('Indent With', indent.el),
          choice('Width', 'tabSize', [2, 3, 4, 8].map((n) => [n, String(n)])),
          flag('Detect From File', 'detectIndent')) },
        { id: 'display', label: 'Display', body: h('div.w-scroll',
          choice('Font Size', 'fontSize', EP.CHOICES.fontSize.slice().sort((a, b) => a - b).map((n) => [n, String(n)])),
          choice('Line Numbers', 'lineNumbers', [['on', 'On'], ['relative', 'Relative'], ['off', 'Off']]),
          flag('Word Wrap', 'wrap'),
          flag('Minimap', 'minimap'),
          flag('Sticky Scroll', 'sticky'),
          flag('Show Whitespace', 'whitespace'),
          flag('Indent Guides', 'guides'),
          flag('Bracket Colors', 'bracketColors'),
          flag('Smooth Caret', 'smoothCaret')) },
      ];
      // The rest is the language server's to act on, where there is one.
      if (NT.lsp.available()) {
        const off = Object.keys(EP.data.lint).length;
        pages.push({ id: 'analysis', label: 'Analysis', body: h('div.w-scroll',
          choice('Type Checking', 'mode', [['nonstrict', 'Nonstrict'], ['strict', 'Strict'], ['nocheck', 'Off']]),
          h('div.w-line', h('span', `Lint Rules: ${off ? `${off} Off` : 'All On'}`), gap(), W.button('Lint Rules', () => go('/settings/editor/lint'))),
          W.group('Completion',
            flag('Add Parentheses', 'parens'),
            flag('Fill Arguments', 'fillArgs'),
            flag('Parameter Hints', 'signatures')),
          W.group('Inlay Hints',
            choice('Parameter Names', 'hintNames', [['none', 'Off'], ['literals', 'Literals'], ['all', 'All']]),
            flag('Variable Types', 'hintVars'),
            flag('Parameter Types', 'hintParams'),
            flag('Return Types', 'hintReturns'))) });
      }
      const tabs = W.tabs(pages, pages.some((p) => p.id === tab) ? tab : 'editing', (v) => { tab = v; });
      tabs.el.classList.add('fill');
      reset = W.button('Reset', async () => {
        const ok = await UI.confirm({ title: 'Reset Editor Settings?', confirmLabel: 'Reset', destructive: true });
        if (!ok) return;
        EP.reset();
        render();
      }, { disabled: !EP.changed() });
      body.replaceChildren(tabs.el, h('div.w-buttons', reset, gap(), W.button('Close', () => win.close(), { primary: true })));
    }

    // Reset is there to press once there is something to reset.
    win.listen('editor', () => { if (reset) reset.disabled = !EP.changed(); });
    let built = false;
    win.onShow = () => {
      if (!built) render();
      built = true;
    };
    return win;
  };

  P.lintRules = function () {
    const win = W.window({ title: 'Lint Rules', icon: 'settings', width: 300, height: 400, status: false });
    // Named as a problem names them ("LocalUnused: …"), with the words apart.
    win.body.append(h('div.w-page.fill', h('div.w-checklist', EP.LINTS.map((name) =>
      W.check(name.replace(/([a-z])([A-Z])/g, '$1 $2'), EP.data.lint[name] !== false, (on) => {
        const lint = Object.assign({}, EP.data.lint);
        if (on) delete lint[name];
        else lint[name] = false;
        EP.set({ lint });
      }).el)),
    h('div.w-buttons', W.button('Close', () => win.close(), { primary: true }))));
    return win;
  };

  /* ---------- Audit log ---------- */

  P.audit = function (userId) {
    const win = W.window({ title: 'Audit Log', icon: 'log', width: 540, height: 400 });
    let stamp = null;
    const list = W.list([
      { label: 'Event', width: 'minmax(110px, 1fr)', icon: () => 'log', cell: (e) => e.title },
      { label: 'Subject', width: 'minmax(110px, 1.4fr)', cell: (e) => e.notes.join(', ') },
      { label: 'When', width: '84px', cell: (e) => rel(e.at), sort: (a, b) => when(a.at, b.at) },
    ], { label: 'Audit Log', sortBy: [2, -1], onOpen: (e) => { if (e.path) go(e.path); }, menu: (e) => (e.path ? [{ label: 'Open', onSelect: () => go(e.path) }] : []) });
    list.el.classList.add('fill');
    win.body.append(h('div.w-page.fill', list.el));
    win.setMenus([{ label: 'File', items: () => [{ label: 'Open', disabled: !list.picked || !list.picked.path, onSelect: () => go(list.picked.path) }, '-', closeItem(win)] }, goMenu()]);

    const load = reader(win, async () => {
      const me = API.session;
      if (!me) {
        stamp = null;
        list.say(blank('Not Signed In', { label: 'Sign In', onClick: signIn }));
        return;
      }
      let events, mine, all;
      try {
        [events, mine, all] = await Promise.all([
          API.audit(userId),
          API.userScripts(me.user_id).catch(() => []),
          API.scripts().catch(() => []),
        ]);
      } catch (e) {
        stamp = null;
        list.say(blank('Audit Log Unavailable', { label: 'Try Again', onClick: load }));
        return;
      }
      events = (Array.isArray(events) ? events : []).filter((ev) => ev && ev.event_type && ev.occurred_at);
      const scripts = new Map([...(all || []), ...(mine || [])].map((s) => [s.script_id, s]));
      const fresh = JSON.stringify([events, [...scripts].map(([id, s]) => [id, s.name])]);
      if (fresh === stamp) return;
      stamp = fresh;
      if (events.length) list.set(events.map((ev) => Object.assign(A.event(ev, scripts), { at: ev.occurred_at })));
      else list.say(blank('No Activity Yet'));
      win.setStatus(plural(events.length, 'event'));
    });

    win.onShow = load;
    return win;
  };

  /* ---------- Not found ---------- */

  P.notFound = function () {
    const win = W.window({ title: 'Not Found', icon: 'app', width: 320, height: 170, status: false });
    win.body.append(h('div.w-page.fill',
      h('div.w-msg', W.icon('error', 32), h('div.w-msg-text', h('p', 'Page Not Found'))),
      h('div.w-buttons.centre', W.button('Go Home', () => { win.destroy(); go('/'); }, { primary: true }))));
    return win;
  };

  W.kit = { blank, failed, closeItem, goMenu, nameOf, plural, sep, gap, signIn, avatar };
})();
