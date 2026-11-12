/*
  Material 3 Expressive's screens. Each factory returns a page the navigator (app.js)
  mounts: a top app bar, the content under it, and the page's floating action button
  where it has one.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h, rel, store } = NT.util;
  const API = NT.api;
  const UI = NT.ui;
  const M = NT.md;
  const A = NT.actions;
  const P = (NT.pages = {});
  const state = {}; // what one page leaves for the next (which list Scripts opens on)

  /* ---------- Building blocks ---------- */

  const go = (path) => (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    NT.nav.go(path);
  };
  const link = (path, ...kids) => h('a.m-link', { href: NT.nav.href(path), onclick: go(path) }, kids);
  const signIn = () => UI.authDialog('login');
  const byRecent = (list) => list.slice().sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  const nameOf = (s) => s.name || s.script_id;
  const onActivate = (el, fn) => el.addEventListener('keydown', (e) => {
    if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    fn();
  });

  // o: { title, back, large (the title starts large in the page and moves up into the
  //      bar when it is scrolled away), narrow, hideNav, className }
  function makePage(o = {}) {
    const inner = h('div.m-inner' + (o.narrow ? '.narrow' : ''));
    const scroll = h('div.m-scroll', inner);
    const titleText = h('span', o.title || '');
    const subtitle = h('small');
    const lead = h('div.m-bar-side');
    const trail = h('div.m-bar-side');
    const bar = h('header.m-bar', lead, h('div.m-bar-title', titleText, subtitle), trail);
    const fabHost = h('div.m-fab-slot');
    const el = h('section.m-page' + (o.className ? '.' + o.className : ''), { tabIndex: -1, 'aria-label': o.title || null }, bar, scroll, fabHost);
    let large = null;
    if (o.large) {
      large = h('h1.m-large', o.title || '');
      inner.append(large);
      bar.classList.add('has-large');
    }
    const disposers = [];
    const page = {
      el, scroll, inner, bar, lead, trail,
      hideNav: !!o.hideNav,
      onBack: null,
      get title() { return titleText.textContent; },
      setTitle(t) {
        titleText.textContent = t;
        if (large) large.textContent = t;
        el.setAttribute('aria-label', t);
        if (NT.nav) NT.nav.retitle();
      },
      setSubtitle(t) { subtitle.textContent = t || ''; },
      setTrailing(...nodes) { trail.replaceChildren(...nodes.flat().filter(Boolean)); },
      // The page's floating action button: { el } from M.fab, a node, or nothing.
      setFab(fab) {
        fabHost.replaceChildren(...(fab ? [fab.el || fab] : []));
        el.classList.toggle('has-fab', !!fab);
      },
      listen(ev, fn) {
        NT.bus.on(ev, fn);
        disposers.push(() => NT.bus.off(ev, fn));
      },
      onDestroy(fn) { disposers.push(fn); },
      destroy() { disposers.forEach((d) => d()); },
    };
    // A page with something to finish first (the editor saving) sets page.onBack.
    if (o.back) lead.append(M.iconButton('arrow_back', 'Back', () => (page.onBack ? page.onBack() : NT.nav.back())));
    el.addEventListener('focusin', (e) => { if (e.target !== el) page.lastFocus = e.target; });
    // The bar takes a container colour once something has scrolled under it.
    scroll.addEventListener('scroll', () => {
      const y = scroll.scrollTop;
      bar.classList.toggle('is-raised', y > 4);
      if (large) bar.classList.toggle('is-collapsed', y > large.offsetTop + large.offsetHeight - 20);
    }, { passive: true });
    return page;
  }

  function avatar(name, size, seed) {
    const a = NT.util.hash(String(seed || name)) % 360;
    return NT.media.avatar(h('span.m-avatar', {
      'aria-hidden': 'true',
      style: { width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.4) + 'px', background: `linear-gradient(140deg, oklch(0.74 0.16 ${a}), oklch(0.55 0.2 ${(a + 55) % 360}))` },
    }, NT.util.initials(name)), seed);
  }
  // s: the script, as a list item or whole.
  const cover = (s, sel) => NT.media.cover(h('div.m-cover' + (sel || ''), { style: NT.util.cover(s.script_id) }), s);

  function empty(icon, title, text, action) {
    return h('div.m-empty', M.icon(icon, { size: 48 }), h('h3', title), text ? h('p', text) : null,
      action ? M.button(action.label, action.onClick, { variant: action.variant || 'filled' }) : null);
  }
  const failed = (retry) => empty('error', 'Couldn’t Load', null, { label: 'Try Again', onClick: retry, variant: 'tonal' });
  // While a page reads for the first time.
  const wait = (host) => host.replaceChildren(M.loading('.block'));

  /* ---------- Script pieces ---------- */

  function scriptMenu(anchor, s, ctx) {
    const id = s.script_id;
    const owner = API.isOwner(s);
    // The script's own page is where its thumbnail is chosen and removed.
    const [thumb, noThumb] = owner && ctx.art ? NT.media.items('thumbs', id) : [];
    UI.menu(anchor, [
      { label: 'Share', icon: 'share', onSelect: () => A.share(s) },
      API.session && { label: 'View Source', icon: 'code', onSelect: () => NT.nav.go(`/scripts/${id}/view`) },
      owner && '-',
      owner && { label: 'Edit', icon: 'pencil', onSelect: () => NT.nav.go(`/scripts/${id}/edit`) },
      owner && !s.published_at && { label: 'Publish', icon: 'send', onSelect: () => A.publish(s, ctx.refresh) },
      thumb,
      noThumb,
      owner && '-',
      owner && { label: 'Delete', icon: 'trash', danger: true, onSelect: () => A.remove(s, ctx.removed || ctx.refresh) },
    ]);
  }

  // A toggle: the heart fills, and the button's shape answers the press.
  function favButton(s, ctx, variant) {
    const b = M.iconButton('favorite', 'Favorite', null, { variant: variant || 'standard', cls: '.m-fav' });
    const sync = () => {
      const on = !!s.is_favorite;
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? 'Remove from favorites' : 'Add to favorites');
      b.title = on ? 'Remove from favorites' : 'Add to favorites';
      b.firstElementChild.classList.toggle('is-filled', on);
    };
    sync();
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!API.session) return void signIn();
      const next = !s.is_favorite;
      const done = A.favorite(s, next);
      sync();
      if (next) M.play(b.firstElementChild, [{ transform: 'scale(0.6)' }, { transform: 'none' }], M.motion.spatialFast);
      if (await done) { if (ctx && ctx.onFavorite) ctx.onFavorite(s, next); }
      else sync();
    });
    return b;
  }

  function scriptCard(s, ctx) {
    const more = M.iconButton('more_vert', 'Script actions', (e) => { e.stopPropagation(); scriptMenu(more, s, ctx); });
    const art = cover(s);
    if (!s.published_at) art.append(h('span.m-badge', 'Draft'));
    if (API.session) art.append(favButton(s, ctx, 'tonal'));
    const card = h('article.m-card.m-press', { tabIndex: 0 },
      art,
      h('div.m-card-body',
        h('h3', nameOf(s)),
        h('p', s.description || 'No description'),
        h('footer', avatar(s.author_name, 24, s.author_uuid), link(`/users/${s.author_uuid}`, s.author_name), h('time', { dateTime: s.updated_at }, rel(s.updated_at)), h('span.m-gap'), more)));
    const open = () => NT.nav.go(`/scripts/${s.script_id}`);
    card.addEventListener('click', (e) => { if (!e.target.closest('button, a')) open(); });
    onActivate(card, open);
    return card;
  }

  // A grid of cards built a screenful at a time; more are added as the page scrolls
  // toward the end. The full list can run to thousands of scripts.
  //   keep: build at least this many up front, to hold the scroll position on a refresh.
  function lazyGrid(grid, scroller, list, build, keep = 0) {
    const BATCH = 24;
    if (grid._watch) grid._watch.disconnect();
    const end = h('div.m-grid-end', { 'aria-hidden': 'true' });
    let shown = 0;
    const watch = new IntersectionObserver((seen) => { if (seen[seen.length - 1].isIntersecting) add(BATCH); }, { root: scroller, rootMargin: '0px 0px 1200px 0px' });
    function add(n) {
      const next = list.slice(shown, shown + n).map(build);
      shown += next.length;
      grid._shown = shown;
      end.before(...next);
      if (shown >= list.length) { watch.disconnect(); end.remove(); }
      else { watch.unobserve(end); watch.observe(end); }
    }
    grid._watch = watch;
    grid.replaceChildren(end);
    add(Math.max(BATCH, keep));
    return grid;
  }

  const scriptItem = (s) => M.item({
    href: NT.nav.href(`/scripts/${s.script_id}`),
    onClick: go(`/scripts/${s.script_id}`),
    leading: cover(s, '.thumb'),
    headline: nameOf(s),
    supporting: `${s.author_name} · ${rel(s.updated_at)}`,
    chevron: true,
  });

  function filePicker(page) {
    const input = h('input', { type: 'file', accept: '.lua,.luau,.txt,text/plain', hidden: true });
    input.addEventListener('change', () => { A.upload(input.files[0]); input.value = ''; });
    page.inner.append(input);
    return () => input.click();
  }
  const newFab = (pick) => M.fab('add', 'New', [
    { label: 'Upload File', icon: 'upload', onSelect: pick },
    { label: 'New Script', icon: 'edit', onSelect: A.create },
  ]);

  /* ---------- Home ---------- */

  // The lead card is real content: the script last worked on, or the newest published.
  function lead(s, o) {
    const card = h('article.m-hero.m-press', { tabIndex: 0 },
      cover(s),
      h('div.m-hero-body',
        h('span.m-eyebrow', o.eyebrow),
        h('h2', nameOf(s)),
        h('p', o.meta),
        h('div.m-actions', o.actions.map(([label, icon, onClick, primary]) => M.button(label, (e) => { e.stopPropagation(); onClick(); }, { icon, variant: primary ? 'filled' : 'tonal' })))));
    const open = () => NT.nav.go(`/scripts/${s.script_id}`);
    card.addEventListener('click', (e) => { if (!e.target.closest('button')) open(); });
    onActivate(card, open);
    return card;
  }

  P.home = function () {
    const page = makePage({ title: 'Home', large: true });
    const body = h('div.m-stack');
    page.inner.append(body);
    const pick = filePicker(page);
    let loaded = false, stamp = '';

    if (API.session) page.setFab(newFab(pick));
    // While looking around, the way to the real thing stays in reach.
    if (!API.session || API.mode === 'demo') page.setTrailing(M.button('Sign In', signIn, { variant: 'tonal' }));

    function render(me, all, mine, favs) {
      const ctx = { refresh: load, onFavorite: () => load() };
      const kids = [];
      const card = (s) => scriptCard(s, ctx);
      const latest = byRecent(mine)[0];
      const featured = byRecent(all.filter((s) => !me || s.author_uuid !== me.user_id))[0];
      if (latest) {
        kids.push(lead(latest, {
          eyebrow: 'Continue Editing',
          meta: `Edited ${rel(latest.updated_at)}${latest.published_at ? '' : ' · Draft'}`,
          actions: [['Edit', 'edit', () => NT.nav.go(`/scripts/${latest.script_id}/edit`), true], ['Open', null, () => NT.nav.go(`/scripts/${latest.script_id}`)]],
        }));
      } else if (featured) {
        kids.push(lead(featured, {
          eyebrow: 'Featured',
          meta: `${featured.author_name} · ${rel(featured.updated_at)}`,
          actions: me ? [['Open', null, () => NT.nav.go(`/scripts/${featured.script_id}`), true]] : [['Open', null, () => NT.nav.go(`/scripts/${featured.script_id}`), true], ['Sign In', null, signIn]],
        }));
      }
      const seeAll = (filter) => ({ label: 'See All', onClick: () => { state.scriptsFilter = filter; NT.nav.go('/scripts'); } });
      if (me) {
        kids.push(M.header('My Scripts', mine.length ? seeAll('mine') : null));
        kids.push(mine.length
          ? h('div.m-carousel', { dataset: { row: 'mine' } }, byRecent(mine).slice(0, 10).map(card))
          : empty('draft', 'No Scripts Yet', null, { label: 'New Script', onClick: A.create }));
        if (favs.length) {
          kids.push(M.header('Favorites', seeAll('favorites')));
          kids.push(h('div.m-carousel', { dataset: { row: 'favs' } }, favs.slice(0, 10).map(card)));
        }
      }
      const recent = byRecent(all.filter((s) => !me || s.author_uuid !== me.user_id)).slice(0, 6);
      if (recent.length) {
        kids.push(M.header('Recently Updated', seeAll('all')));
        kids.push(M.list(recent.map(scriptItem)));
      } else if (!me) kids.push(empty('code', 'Sign In to Browse', null, { label: 'Sign In', onClick: signIn }));
      // A refresh keeps each row where it was scrolled.
      const at = {};
      for (const row of body.querySelectorAll('.m-carousel[data-row]')) at[row.dataset.row] = row.scrollLeft;
      body.replaceChildren(...kids);
      for (const row of body.querySelectorAll('.m-carousel[data-row]')) if (at[row.dataset.row]) row.scrollLeft = at[row.dataset.row];
    }

    async function load() {
      const me = API.session;
      if (!loaded) wait(body);
      try {
        const [all, mine, favs] = await Promise.all([
          API.scripts().catch(() => []),
          me ? API.userScripts(me.user_id) : [],
          me ? API.favorites(me.user_id).catch(() => []) : [],
        ]);
        // Coming back to Home reads again; if nothing changed, the page is left as it is.
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
    }
    page.onShow = load;
    return page;
  };

  /* ---------- Scripts ---------- */

  P.scripts = function () {
    const page = makePage({ title: 'Scripts', large: true });
    const pick = filePicker(page);
    // Your own scripts come first. The page reopens on whichever list was used last.
    const FILTERS = ['mine', 'favorites', 'all'], SORTS = ['recent', 'name', 'author'];
    const kept = API.session ? store.get('nt.scripts.filter') : null;
    let chosen = FILTERS.includes(kept) ? kept : API.session ? 'mine' : 'all';
    let sort = SORTS.includes(store.get('nt.scripts.sort')) ? store.get('nt.scripts.sort') : 'recent';
    let query = '', filter = chosen;
    let data = null, signedOut = false, stamp = '';
    const choose = (v) => { filter = chosen = v; store.set('nt.scripts.filter', v); };
    const sortBy = (v) => { sort = v; store.set('nt.scripts.sort', v); render(); };

    const find = h('input', { type: 'search', placeholder: 'Search scripts', 'aria-label': 'Search scripts', enterKeyHint: 'search' });
    const search = h('label.m-search', M.icon('search'), find);
    const group = M.group([{ value: 'mine', label: 'Mine' }, { value: 'favorites', label: 'Favorites' }, { value: 'all', label: 'All' }], filter, (v) => { choose(v); render(); });
    const sortBtn = M.iconButton('sort', 'Sort', () => UI.menu(sortBtn, [
      { label: 'Recently Updated', checked: sort === 'recent', onSelect: () => sortBy('recent') },
      { label: 'Name', checked: sort === 'name', onSelect: () => sortBy('name') },
      { label: 'Author', checked: sort === 'author', onSelect: () => sortBy('author') },
    ]));
    const count = h('p.m-count');
    const grid = h('div.m-grid');
    const note = h('div');
    page.inner.append(search, h('div.m-filter', group.el, h('span.m-gap'), sortBtn), count, grid, note);
    if (API.session) page.setFab(newFab(pick));

    // A search looks through everything; `chosen` is the list to return to after it.
    find.addEventListener('input', () => {
      const next = find.value.trim().toLowerCase();
      const to = next && !query ? 'all' : !next && query ? chosen : filter;
      query = next;
      if (to !== filter) { filter = to; group.set(to); }
      if (data) render();
    });

    const ctx = {
      refresh: () => load(),
      onFavorite(s, on) {
        if (!data) return;
        for (const list of [data.all, data.mine]) for (const x of list) if (x.script_id === s.script_id) x.is_favorite = on;
        data.favs = data.favs.filter((x) => x.script_id !== s.script_id);
        if (on) data.favs.unshift(Object.assign({}, s, { is_favorite: true }));
        if (filter === 'favorites') render(true);
      },
    };
    const clear = () => {
      if (grid._watch) grid._watch.disconnect();
      grid.replaceChildren();
    };

    // keep: the same list is being drawn again, so build as far as it was built.
    function render(keep) {
      note.replaceChildren();
      if (signedOut) {
        count.textContent = '';
        clear();
        note.append(empty('code', 'Sign In to Browse', null, { label: 'Sign In', onClick: signIn }));
        return;
      }
      let list = filter === 'mine' ? data.mine : filter === 'favorites' ? data.favs : data.all;
      if (query) list = list.filter((s) => (`${s.name} ${s.description || ''} ${s.author_name}`).toLowerCase().includes(query));
      list = list.slice();
      if (sort === 'name') list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      else if (sort === 'author') list.sort((a, b) => String(a.author_name).localeCompare(String(b.author_name)));
      else list.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      count.textContent = query ? `${list.length} result${list.length === 1 ? '' : 's'}` : `${list.length} script${list.length === 1 ? '' : 's'}`;
      lazyGrid(grid, page.scroll, list, (s) => scriptCard(s, ctx), keep ? grid._shown || 0 : 0);
      if (!keep) page.scroll.scrollTop = 0;
      if (!list.length) {
        note.append(query ? empty('search', 'No Results', `Nothing matches “${query}”.`)
          : filter === 'mine' ? empty('draft', 'No Scripts Yet', null, API.session ? { label: 'New Script', onClick: A.create } : { label: 'Sign In', onClick: signIn })
            : filter === 'favorites' ? empty('favorite', 'No Favorites', 'Tap the heart on a script to keep it here.')
              : empty('code', 'No Scripts'));
      }
    }

    async function load() {
      const me = API.session;
      const first = !data;
      if (first) wait(note);
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
        render(!first);
      } catch (e) {
        stamp = '';
        if (e && e.status === 401) { signedOut = true; data = { all: [], mine: [], favs: [] }; render(); }
        else {
          clear();
          note.replaceChildren(failed(load));
        }
      }
    }

    page.onShow = () => {
      if (state.scriptsFilter) {
        choose(state.scriptsFilter);
        group.set(filter);
        delete state.scriptsFilter;
        if (data) render();
      }
      load();
    };
    return page;
  };

  /* ---------- Script ---------- */

  P.script = function (id) {
    const page = makePage({ title: 'Script', back: true, narrow: true });
    const body = h('div.m-stack');
    page.inner.append(body);
    wait(body);

    let script = null, params = [], releases = [];
    const values = {};
    const valueOf = (p) => (p.id in values ? values[p.id] : p.default_value);

    const battle = h('button.m-fab.extended.m-press', { type: 'button', onclick: startBattle }, M.icon('play_arrow', { fill: true }), h('span', 'Start Friendly Battle'));
    page.setFab(battle);

    const more = M.iconButton('more_vert', 'More', () => { if (script) scriptMenu(more, script, { refresh: load, removed: () => NT.nav.back(), art: true }); });
    const share = M.iconButton('share', 'Share', () => { if (script) A.share(script); });
    page.setTrailing(share, more);

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
      const label = API.paramLabel(p);
      if (p.type === 'bool') {
        const t = M.switch(valueOf(p) === 1, (on) => { values[p.id] = on ? 1 : 0; if (values[p.id] === p.default_value) delete values[p.id]; onChange(); }, label);
        return h('div.m-item', h('span.m-item-text', h('span.m-item-headline', label)), t.el);
      }
      const valueEl = h('span.m-param-value', String(valueOf(p)));
      const reset = M.button('Reset', () => { s.set(p.default_value); apply(p.default_value); }, { variant: 'text' });
      reset.hidden = valueOf(p) === p.default_value;
      const apply = (v) => {
        if (v === p.default_value) delete values[p.id];
        else values[p.id] = v;
        valueEl.textContent = String(v);
        reset.hidden = v === p.default_value;
        onChange();
      };
      const s = M.slider({ min: p.min_value == null ? 0 : p.min_value, max: p.max_value == null ? 100 : p.max_value, value: valueOf(p), label, onInput: apply });
      return h('div.m-item.col', h('div.m-param-head', h('span.m-item-headline', label), reset, valueEl), s.el);
    }

    // A group of parameters opens and closes; closed is how it starts.
    function paramGroup(groupId, list) {
      const badge = h('span.m-badge.tonal', { hidden: true });
      const sync = () => {
        const n = list.filter((p) => valueOf(p) !== p.default_value).length;
        badge.hidden = n === 0;
        badge.textContent = `${n} changed`;
      };
      const head = h('button.m-item.m-press.m-disclosure', { type: 'button', 'aria-expanded': 'false' },
        h('span.m-item-text', h('span.m-item-headline', API.groupLabel(groupId))), badge, M.icon('expand_more'));
      const inner = h('div.m-fold-in', list.map((p) => paramRow(p, sync)));
      const wrap = h('div.m-fold', inner);
      head.addEventListener('click', () => {
        const next = head.getAttribute('aria-expanded') !== 'true';
        head.setAttribute('aria-expanded', String(next));
        wrap.classList.toggle('is-open', next);
      });
      sync();
      return h('div.m-list', head, wrap);
    }

    function render() {
      const s = script;
      const owner = API.isOwner(s);
      page.setTitle(nameOf(s));
      page.setTrailing(favButton(s, null), share, more);

      const art = cover(s, '.detail');
      const flags = [];
      if (!s.published_at) flags.push(h('span.m-badge', 'Draft'));
      if (API.isOutdated(s)) flags.push(h('span.m-badge', 'Outdated'));
      if (flags.length) art.append(h('div.m-badges', flags));
      const kids = [art,
        h('h1.m-headline', nameOf(s)),
        h('div.m-byline', avatar(s.author_name, 28, s.author_uuid), link(`/users/${s.author_uuid}`, s.author_name), h('span', '· ' + rel(s.updated_at)))];
      if (s.description) kids.push(h('p.m-desc', s.description));

      const actions = [];
      if (API.session) actions.push(M.button('View Source', go(`/scripts/${s.script_id}/view`), { icon: 'code', variant: 'tonal' }));
      if (owner) actions.push(M.button('Edit', go(`/scripts/${s.script_id}/edit`), { icon: 'edit', variant: 'tonal' }));
      if (owner && !s.published_at) actions.push(M.button('Publish', () => A.publish(s, load), { icon: 'send' }));
      if (actions.length) kids.push(h('div.m-actions', actions));
      if (API.isOutdated(s)) kids.push(h('div.m-banner', M.icon('warning'), h('span', 'Released before the latest scripting API change. It may not work as expected.')));

      if (params && params.length) {
        const groups = new Map();
        for (const p of params) {
          if (!groups.has(p.group_id)) groups.set(p.group_id, []);
          groups.get(p.group_id).push(p);
        }
        kids.push(M.header('Parameters'));
        kids.push(h('div.m-stack.tight', [...groups].map(([gid, list]) => paramGroup(gid, list))));
      }
      if (releases && releases.length) {
        const sorted = releases.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        kids.push(M.header('Releases'));
        kids.push(M.list(sorted.map((r, i) => M.item({
          icon: 'history',
          headline: new Date(r.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
          supporting: r.description || null,
          value: i === 0 ? 'Latest' : rel(r.created_at),
        }))));
      }
      body.replaceChildren(...kids);
    }

    async function load() {
      const s = await API.script(id);
      if (!s) {
        script = null;
        page.setFab(null);
        page.setTrailing();
        // Signed out, the service answers for nothing: that is not the script missing.
        body.replaceChildren(API.session || API.mode !== 'live'
          ? empty('draft', 'Script Not Found', null, { label: 'Browse Scripts', onClick: () => NT.nav.go('/scripts') })
          : empty('draft', 'Sign In to View', null, { label: 'Sign In', onClick: signIn }));
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
    }

    let shown = false;
    page.onShow = () => {
      load().catch(() => { if (!shown) body.replaceChildren(failed(() => page.onShow())); });
      shown = true;
    };
    return page;
  };

  /* ---------- Source viewer ---------- */

  P.viewer = function (id, revision) {
    const page = makePage({ title: 'Source', back: true, className: 'm-codepage' });
    const host = h('div.m-code');
    page.inner.append(host);
    let view = null, ready = false;

    page.onShow = async () => {
      if (ready) return;
      ready = true;
      const script = await API.script(id);
      if (script) page.setTitle(nameOf(script));
      let res;
      try {
        res = await API.scriptContent(id, revision);
      } catch (e) {
        ready = false;
        host.replaceChildren(API.session ? empty('draft', 'Source Unavailable') : empty('draft', 'Sign In to View Source', null, { label: 'Sign In', onClick: signIn }));
        return;
      }
      const content = (res && res.content) || '';
      const lines = content ? content.split('\n').length : 0;
      const rev = revision || (res && res.revision);
      page.setSubtitle(`${lines} line${lines === 1 ? '' : 's'}${rev ? ' · Revision ' + rev : ''}`);
      page.setTrailing(M.iconButton('content_copy', 'Copy', () => A.copy(content)));
      if (!content) return void host.replaceChildren(empty('draft', 'Empty Script'));
      view = await NT.code.mount(host, { value: content, readOnly: true });
    };
    page.onDestroy(() => { if (view) view.dispose(); });
    return page;
  };

  /* ---------- Editor ---------- */

  // The editor page is a module of its own (editor.js), built from these pieces.
  M.kit = { makePage, empty, failed };

  /* ---------- Maps ---------- */

  P.maps = function () {
    const page = makePage({ title: 'Maps', large: true, narrow: true });
    const body = h('div.m-stack');
    page.inner.append(body);
    let maps = null, listHost = null;

    function mapItem(m) {
      const title = h('span.m-item-headline', m.name);
      const more = M.iconButton('more_vert', 'Map actions');
      const el = h('div.m-item', h('span.m-item-icon', M.icon('map')), h('span.m-item-text', title, h('span.m-item-supporting.mono', m.internal_id)), more);

      function rename() {
        const input = h('input.m-inline', { value: m.name, minLength: 3, maxLength: 64, 'aria-label': 'Map name' });
        let finished = false;
        const finish = async (commit) => {
          if (finished) return;
          finished = true;
          const next = input.value.trim();
          input.replaceWith(title);
          if (!commit || !next || next === m.name) return;
          if (next.length < 3) return void UI.toast('Names need at least 3 characters', { warn: true });
          const old = m.name;
          m.name = next;
          title.textContent = next;
          try { await API.renameMap(m.user_map_id, next); }
          catch (e) { m.name = old; title.textContent = old; UI.toast('Couldn’t rename', { warn: true }); }
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); finish(true); }
          if (e.key === 'Escape') finish(false);
        });
        input.addEventListener('blur', () => finish(true));
        title.replaceWith(input);
        input.focus();
        input.select();
      }

      more.addEventListener('click', () => UI.menu(more, [
        { label: 'Rename', icon: 'pencil', onSelect: () => setTimeout(rename, 200) },
        { label: 'Copy ID', icon: 'copy', onSelect: () => A.copy(m.internal_id) },
        '-',
        { label: 'Delete', icon: 'trash', danger: true, onSelect: async () => {
          const ok = await UI.confirm({ title: `Delete “${m.name}”?`, message: 'This can’t be undone.', confirmLabel: 'Delete', destructive: true });
          if (!ok) return;
          try {
            await API.deleteMap(m.user_map_id);
            maps = maps.filter((x) => x !== m);
            renderList();
          } catch (e) { UI.toast('Couldn’t delete', { warn: true }); }
        } },
      ]));
      return el;
    }

    function renderList() {
      listHost.replaceChildren(maps.length ? M.list(maps.map(mapItem)) : empty('map', 'No Maps Yet', 'Paste a room link to add one.'));
    }

    function render() {
      if (!API.session) return void body.replaceChildren(empty('map', 'Sign In to Add Maps', null, { label: 'Sign In', onClick: signIn }));
      const field = M.field('Map link', { type: 'url', inputMode: 'url', autocomplete: 'off' });
      const say = (text, bad) => { field.note.textContent = text; field.row.classList.toggle('is-error', !!bad); };
      let busy = false;

      async function submit(text) {
        if (busy || !String(text).trim()) return;
        const parsed = A.mapLink(text);
        if (parsed.error) return say(parsed.error, true);
        if (maps.some((m) => m.internal_id === parsed.id)) { field.input.value = ''; return say('Already added.'); }
        busy = true;
        try {
          const existing = maps.find((m) => m.internal_id.startsWith(parsed.id.split(':')[0]));
          if (existing) {
            await API.updateMap(existing.user_map_id, parsed.id);
            existing.internal_id = parsed.id;
            say('Updated.');
          } else {
            maps.unshift(await API.addMap(parsed.id, `New map ${maps.length + 1}`));
            say('Saved.');
          }
          field.input.value = '';
          renderList();
        } catch (e) {
          say('Couldn’t save. Try again.', true);
        } finally {
          busy = false;
        }
      }
      const paste = async () => {
        if (!navigator.clipboard || !navigator.clipboard.readText) return say('Paste the link into the field.');
        try {
          const text = await navigator.clipboard.readText();
          if (!text.trim()) return say('Clipboard is empty.');
          field.input.value = text;
          submit(text);
        } catch (e) {
          say('Paste the link into the field.');
        }
      };
      field.input.addEventListener('paste', () => setTimeout(() => submit(field.input.value), 0));
      field.input.addEventListener('input', () => say(''));

      listHost = h('div');
      body.replaceChildren(
        h('form.m-mapform', { onsubmit: (e) => { e.preventDefault(); submit(field.input.value); } }, field.row, M.button('Paste', paste, { variant: 'tonal', icon: 'content_paste' })),
        listHost);
      if (maps) renderList();
      else wait(listHost);
    }

    // The form is built once: coming back to the page must not wipe a half-typed link.
    let built = false, listed = '';
    page.onShow = async () => {
      if (!built) {
        render();
        built = true;
      }
      if (!API.session) return;
      try {
        const next = await API.maps(API.session.user_id);
        const fresh = JSON.stringify(next);
        if (maps && fresh === listed) return;
        listed = fresh;
        maps = next;
        renderList();
      } catch (e) {
        listed = '';
        listHost.replaceChildren(failed(() => page.onShow()));
      }
    };
    return page;
  };

  /* ---------- Profile ---------- */

  function userPage(userId, isRoot) {
    const page = makePage({ title: 'Profile', back: !isRoot });
    const body = h('div.m-stack');
    page.inner.append(body);
    let loaded = false, stamp = '';
    if (isRoot) page.setTrailing(M.iconButton('settings', 'Settings', () => NT.nav.go('/settings')));

    async function load() {
      const me = API.session;
      const target = userId || (me && me.user_id);
      if (!target) return void body.replaceChildren(empty('person', 'Not Signed In', null, { label: 'Sign In', onClick: signIn }));
      if (!loaded) wait(body);
      let user, scripts, favs;
      try {
        [user, scripts, favs] = await Promise.all([
          userId ? API.user(userId) : Promise.resolve(me),
          API.userScripts(target),
          API.favorites(target).catch(() => []),
        ]);
      } catch (e) {
        body.replaceChildren(e && e.status === 404 ? empty('person', 'User Not Found')
          : e && e.status === 401 && !me ? empty('person', 'Sign In to View', null, { label: 'Sign In', onClick: signIn })
            : failed(load));
        loaded = false;
        return;
      }
      const fresh = JSON.stringify([user, scripts, favs]);
      if (loaded && fresh === stamp) return;
      stamp = fresh;
      const own = !!me && user.user_id === me.user_id;
      const name = user.name || user.username;
      page.setTitle(name);
      const ctx = { refresh: load, onFavorite: () => { if (own) load(); } };
      const card = (s) => scriptCard(s, ctx);
      const drafts = scripts.filter((s) => !s.published_at).length;

      // Your own photo carries the button that changes it.
      const face = avatar(name, 104, user.user_id);
      const items = own ? NT.media.items('avatars', user.user_id) : [];
      const edit = M.iconButton('edit', 'Profile Photo', () => UI.menu(edit, NT.media.items('avatars', user.user_id), { align: 'center' }), { variant: 'tonal', cls: '.m-face-edit' });
      const kids = [h('div.m-profile',
        h('span.m-face', face, items.length ? edit : null),
        h('h1.m-headline', name),
        h('span.m-handle', '@' + user.username),
        h('div.m-stats',
          h('div', h('b', String(scripts.length)), h('span', 'Scripts')),
          h('div', h('b', String(favs.length)), h('span', 'Favorites')),
          own ? h('div', h('b', String(drafts)), h('span', 'Drafts')) : null))];
      if (own) kids.push(M.list(M.item({ icon: 'list_alt', headline: 'Audit Log', chevron: true, onClick: () => NT.nav.go(`/users/${user.user_id}/audit`) })));
      if (favs.length) {
        kids.push(M.header('Favorites'));
        kids.push(lazyGrid(h('div.m-grid'), page.scroll, favs, card));
      }
      kids.push(M.header('Scripts'));
      kids.push(scripts.length
        ? lazyGrid(h('div.m-grid'), page.scroll, byRecent(scripts), card)
        : empty('draft', 'No Scripts Yet', null, own ? { label: 'New Script', onClick: A.create } : null));
      body.replaceChildren(...kids);
      loaded = true;
    }
    page.onShow = load;
    return page;
  }
  P.profile = () => userPage(null, true);
  P.user = (id) => userPage(id, false);

  /* ---------- Settings ---------- */

  // An item whose value opens a menu of the values it can take. options: [[value, label]]
  function pickItem(headline, value, options, onPick, icon) {
    const val = h('span');
    const pick = h('button.m-pick.m-press', { type: 'button', 'aria-label': headline }, val, M.icon('expand_more', { size: 20 }));
    let cur = value;
    const sync = () => { val.textContent = (options.find((o) => o[0] === cur) || options[0])[1]; };
    pick.addEventListener('click', () => UI.menu(pick, options.map(([v, label]) => ({ label, checked: cur === v, onSelect: () => { cur = v; sync(); onPick(v); } }))));
    sync();
    return M.item({ icon, headline, trailing: pick });
  }

  P.settings = function () {
    const page = makePage({ title: 'Settings', back: true, large: true, narrow: true });
    const body = h('div.m-stack');
    page.inner.append(body);

    function render() {
      const me = API.session;
      const prefs = NT.prefs.data;
      const demo = API.mode === 'demo';
      const kids = [];

      const account = [];
      if (me) account.push(M.item({ icon: 'person', headline: me.name || me.username, supporting: demo ? 'Demo account' : '@' + me.username, chevron: true, onClick: () => NT.nav.go('/profile') }));
      if (me && !demo) account.push(M.item({ icon: 'key', headline: 'Password', value: me.has_password ? 'On' : 'Not set', chevron: true, onClick: () => UI.passwordDialog() }));
      if (!me || demo) account.push(M.item({ icon: 'login', headline: me ? 'Sign In With Your Account' : 'Sign In', onClick: signIn }));
      kids.push(M.list(account));
      kids.push(M.list(M.item({ icon: 'code', headline: 'Editor', chevron: true, onClick: () => NT.nav.go('/settings/editor') })));

      // Another whole look of the app (js/styles.js). Choosing one loads it.
      const styles = NT.styles.list;
      const theme = M.group([{ value: 'system', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }], prefs.theme, (v) => NT.prefs.set({ theme: v }));
      const accents = ['blue', 'indigo', 'purple', 'pink', 'orange', 'green', 'teal'];
      const swatches = h('div.m-swatches', { role: 'radiogroup', 'aria-label': 'Accent color' }, accents.map((a) => {
        const b = h('button.m-swatch', { type: 'button', role: 'radio', 'aria-label': a, title: a[0].toUpperCase() + a.slice(1), 'aria-checked': String(prefs.accent === a), dataset: { accent: a } }, M.icon('check', { size: 20 }));
        b.addEventListener('click', () => {
          NT.prefs.set({ accent: a });
          swatches.querySelectorAll('.m-swatch').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        });
        return b;
      }));
      kids.push(M.header('Appearance'));
      kids.push(M.list(
        styles.length > 1 ? pickItem('Style', NT.styles.current, styles.map((s) => [s.id, s.name]), (id) => NT.styles.use(id), 'palette') : null,
        h('div.m-item', h('span.m-item-text', h('span.m-item-headline', 'Theme')), theme.el),
        h('div.m-item', swatches)));

      if (demo) {
        kids.push(M.header('Demo Data'));
        kids.push(M.list(M.item({ icon: 'restart_alt', headline: 'Reset', onClick: async () => {
          const ok = await UI.confirm({ title: 'Reset Demo Data?', confirmLabel: 'Reset', destructive: true });
          if (!ok) return;
          API.resetDemo();
          UI.toast('Demo data reset');
        } })));
      }
      if (me) {
        // Nothing is lost by logging out (drafts stay on this device), so it does not ask.
        kids.push(M.list(M.item({ icon: 'logout', headline: 'Log Out', danger: true, onClick: async (e) => {
          e.currentTarget.disabled = true;
          await API.logout();
          NT.nav.reset(['/']);
        } })));
      }
      body.replaceChildren(...kids);
    }
    page.listen('session', render);
    page.onShow = render;
    return page;
  };

  /* ---------- Editor settings ----------
     How the editor behaves (js/editor-prefs.js). Reached from Settings and from the
     editor's own menu; an editor that is open takes each change as it is made. */

  const EP = NT.editorPrefs;
  const switchItem = (title, key) =>
    h('div.m-item', h('span.m-item-text', h('span.m-item-headline', title)), M.switch(EP.data[key], (on) => EP.set({ [key]: on }), title).el);
  const choiceItem = (title, key, options) => pickItem(title, EP.data[key], options, (v) => EP.set({ [key]: v }));

  P.editorSettings = function () {
    const page = makePage({ title: 'Editor', back: true, large: true, narrow: true, hideNav: true });
    const body = h('div.m-stack');
    page.inner.append(body);
    let reset = null;

    function render() {
      const indent = M.group([{ value: false, label: 'Tabs' }, { value: true, label: 'Spaces' }], EP.data.spaces, (v) => EP.set({ spaces: v }));
      const kids = [
        M.list(
          switchItem('Auto-Insert end', 'closeBlocks'),
          switchItem('Auto-Close Brackets', 'closeBrackets'),
          switchItem('Auto-Close Quotes', 'closeQuotes'),
          switchItem('Suggest While Typing', 'suggest'),
          choiceItem('Accept on Enter', 'acceptEnter', [['smart', 'Smart'], ['on', 'Always'], ['off', 'Never']]),
          switchItem('Autosave', 'autosave')),
        M.header('Indentation'),
        M.list(
          h('div.m-item', h('span.m-item-text', h('span.m-item-headline', 'Indent With')), indent.el),
          choiceItem('Width', 'tabSize', [2, 3, 4, 8].map((n) => [n, String(n)])),
          switchItem('Detect From File', 'detectIndent')),
        M.header('Display'),
        M.list(
          choiceItem('Font Size', 'fontSize', EP.CHOICES.fontSize.slice().sort((a, b) => a - b).map((n) => [n, String(n)])),
          choiceItem('Line Numbers', 'lineNumbers', [['on', 'On'], ['relative', 'Relative'], ['off', 'Off']]),
          switchItem('Word Wrap', 'wrap'),
          switchItem('Minimap', 'minimap'),
          switchItem('Sticky Scroll', 'sticky'),
          switchItem('Show Whitespace', 'whitespace'),
          switchItem('Indent Guides', 'guides'),
          switchItem('Bracket Colors', 'bracketColors'),
          switchItem('Smooth Caret', 'smoothCaret')),
      ];
      // The rest is the language server's to act on, where there is one.
      if (NT.lsp.available()) {
        const off = Object.keys(EP.data.lint).length;
        kids.push(
          M.header('Analysis'),
          M.list(
            choiceItem('Type Checking', 'mode', [['nonstrict', 'Nonstrict'], ['strict', 'Strict'], ['nocheck', 'Off']]),
            M.item({ headline: 'Lint Rules', value: off ? `${off} Off` : 'All On', chevron: true, onClick: () => NT.nav.go('/settings/editor/lint') })),
          M.header('Completion'),
          M.list(switchItem('Add Parentheses', 'parens'), switchItem('Fill Arguments', 'fillArgs'), switchItem('Parameter Hints', 'signatures')),
          M.header('Inlay Hints'),
          M.list(
            choiceItem('Parameter Names', 'hintNames', [['none', 'Off'], ['literals', 'Literals'], ['all', 'All']]),
            switchItem('Variable Types', 'hintVars'),
            switchItem('Parameter Types', 'hintParams'),
            switchItem('Return Types', 'hintReturns')));
      }
      reset = h('div.m-actions', { hidden: !EP.changed() }, M.button('Reset', async () => {
        const ok = await UI.confirm({ title: 'Reset Editor Settings?', confirmLabel: 'Reset', destructive: true });
        if (!ok) return;
        EP.reset();
        render();
      }, { variant: 'outlined', icon: 'restart_alt' }));
      kids.push(reset);
      body.replaceChildren(...kids);
    }
    // Reset is there once there is something to reset.
    page.listen('editor', () => { if (reset) reset.hidden = !EP.changed(); });
    page.onShow = render;
    return page;
  };

  P.lintRules = function () {
    const page = makePage({ title: 'Lint Rules', back: true, large: true, narrow: true, hideNav: true });
    // Named as a problem names them ("LocalUnused: …"), with the words apart.
    page.inner.append(M.list(EP.LINTS.map((name) => {
      const title = name.replace(/([a-z])([A-Z])/g, '$1 $2');
      return h('div.m-item', h('span.m-item-text', h('span.m-item-headline', title)), M.switch(EP.data.lint[name] !== false, (on) => {
        const lint = Object.assign({}, EP.data.lint);
        if (on) delete lint[name];
        else lint[name] = false;
        EP.set({ lint });
      }, title).el);
    })));
    return page;
  };

  /* ---------- Audit log ---------- */

  const EVENT_ICON = {
    UserRegister: 'person', UserLogin: 'login', UserLogout: 'logout', UserPasswordChange: 'key',
    ScriptCreate: 'add', ScriptUpdate: 'edit', ScriptPublish: 'send', ScriptDelete: 'delete',
    FavoriteAdd: 'favorite', FavoriteRemove: 'favorite', MapCreate: 'map', MapUpdate: 'map', MapDelete: 'delete',
  };

  P.audit = function (userId) {
    const page = makePage({ title: 'Audit Log', back: true, large: true, narrow: true });
    const body = h('div.m-stack');
    page.inner.append(body);
    let stamp = null;

    async function load() {
      const me = API.session;
      if (!me) {
        stamp = null;
        return void body.replaceChildren(empty('list_alt', 'Not Signed In', null, { label: 'Sign In', onClick: signIn }));
      }
      if (stamp === null) wait(body);
      let events, mine, all;
      try {
        [events, mine, all] = await Promise.all([
          API.audit(userId),
          API.userScripts(me.user_id).catch(() => []),
          API.scripts().catch(() => []),
        ]);
      } catch (e) {
        stamp = null;
        return void body.replaceChildren(empty('list_alt', 'Audit Log Unavailable', null, { label: 'Try Again', onClick: load, variant: 'tonal' }));
      }
      events = (Array.isArray(events) ? events : [])
        .filter((ev) => ev && ev.event_type && ev.occurred_at)
        .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
      const scripts = new Map([...(all || []), ...(mine || [])].map((s) => [s.script_id, s]));
      const fresh = JSON.stringify([events, [...scripts].map(([id, s]) => [id, s.name])]);
      if (fresh === stamp) return;
      stamp = fresh;
      body.replaceChildren(events.length
        ? M.list(events.map((ev) => {
          const e = A.event(ev, scripts);
          return M.item({
            icon: EVENT_ICON[e.type] || 'info',
            headline: e.title,
            supporting: e.notes.length ? e.notes.join(' · ') : null,
            mono: e.onScript && !e.script,
            value: rel(ev.occurred_at),
            chevron: !!e.path,
            onClick: e.path ? () => NT.nav.go(e.path) : null,
          });
        }))
        : empty('list_alt', 'No Activity Yet'));
    }
    page.onShow = load;
    return page;
  };

  /* ---------- Not found ---------- */

  P.notFound = function () {
    const page = makePage({ title: 'Not Found', back: true });
    page.inner.append(empty('search', 'Page Not Found', null, { label: 'Go Home', onClick: () => NT.nav.go('/') }));
    return page;
  };
})();
