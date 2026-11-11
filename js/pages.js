/* Screens. Each factory returns a page object the navigator mounts and animates. */
(function () {
  'use strict';
  const NT = window.NT;
  const { h, rel } = NT.util;
  const icon = NT.icon;
  const API = NT.api;
  const UI = NT.ui;
  const P = (NT.pages = {});
  NT.state = {};

  /* ---------- Building blocks ---------- */

  const go = (path) => (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    NT.nav.go(path);
  };
  const link = (path, sel, ...kids) => h('a' + (sel || ''), { href: NT.nav.href(path), onclick: go(path) }, kids);
  const signIn = () => UI.authSheet('login');
  // Enter or Space on a focused card does what a tap on it does.
  const onActivate = (el, fn) => el.addEventListener('keydown', (e) => {
    if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    fn();
  });

  function navButton(name, label, onClick, extra = '') {
    const b = h('button.nav-btn.glass.interactive' + extra, { type: 'button', 'aria-label': label, title: label, onclick: onClick }, icon(name, 22));
    NT.glass.refract(b);
    return b;
  }
  function navPill(label, onClick, extra = '') {
    const b = h('button.nav-pill.glass.interactive' + extra, { type: 'button', onclick: onClick }, h('span', label));
    NT.glass.refract(b);
    return b;
  }
  // Related toolbar actions share one piece of glass.
  function navGroup(...buttons) {
    const g = h('div.nav-group.glass', buttons);
    NT.glass.refract(g);
    return g;
  }
  // A glass action that sits in the page. It rests on the page's own background, where
  // there is nothing to bend, so it takes the shader's light without the lens.
  function glassButton(label, iconName, onClick, extra = '') {
    return NT.glass.shine(h('button.pill-btn.glass.interactive' + extra, { type: 'button', onclick: onClick }, iconName ? icon(iconName, 18) : null, h('span', label)));
  }
  const groupButton = (name, label, onClick, extra = '') =>
    h('button.nav-group-btn' + extra, { type: 'button', 'aria-label': label, title: label, onclick: onClick }, icon(name, 22));

  function makePage(opts = {}) {
    const scroll = h('div.page-scroll');
    const inner = h('div.page-inner' + (opts.narrow ? '.narrow' : ''));
    scroll.append(h('div.ambient', { 'aria-hidden': 'true' }), inner);
    const lead = h('div.navbar-side');
    const trail = h('div.navbar-side');
    const titleText = h('span', opts.title || '');
    const subtitle = h('small');
    const pill = h('div.navbar-title-pill', titleText, subtitle);
    const navTitle = h('div.navbar-title', pill);
    const navbar = h('header.navbar', lead, navTitle, trail);
    const el = h('section.page' + (opts.className ? '.' + opts.className : ''), { tabIndex: -1, 'aria-label': opts.title || null }, scroll, navbar);

    let large = null;
    if (opts.large !== false) {
      large = h('h1.large-title', opts.title || '');
      inner.append(large);
    } else if (!opts.titleAt) navbar.classList.add('always-title');
    // A title that arrives by scrolling floats over content, so it is glass like the
    // buttons beside it. One that is always there has nothing passing under it.
    if (!navbar.classList.contains('always-title')) {
      pill.classList.add('glass', 'thick');
      NT.glass.refract(pill, { bezel: 14, magnify: 0.008 });
    }
    // A page with something to finish first (the editor saving) sets page.onBack.
    if (opts.back) lead.append(navButton('chevron-left', 'Back', () => (page.onBack ? page.onBack() : NT.nav.back())));

    const disposers = [];
    const page = {
      el, scroll, inner, navbar, lead, trail,
      // Artwork on this page (a live list): what the glass above it turns dark over.
      art: scroll.getElementsByClassName('tone-dark'),
      hideTabbar: !!opts.hideTabbar,
      accessory: null,
      get title() { return titleText.textContent; },
      setTitle(t) {
        titleText.textContent = t;
        if (large) large.textContent = t;
        el.setAttribute('aria-label', t);
        if (NT.nav) NT.nav.retitle();
      },
      setSubtitle(t) { subtitle.textContent = t || ''; },
      setTrailing(...nodes) {
        trail.replaceChildren(...nodes.flat().filter(Boolean));
        NT.tone.touch();
      },
      listen(ev, fn) {
        NT.bus.on(ev, fn);
        disposers.push(() => NT.bus.off(ev, fn));
      },
      onDestroy(fn) { disposers.push(fn); },
      destroy() { disposers.forEach((d) => d()); },
    };

    // Keep the inline title clear of the buttons on either side: centred when
    // there is room, otherwise leading-aligned next to the back button.
    function layoutTitle() {
      const w = navbar.clientWidth;
      if (!w) return;
      const l = lead.offsetWidth, t = trail.offsetWidth;
      const left = 16 + l + (l ? 8 : 4), right = 16 + t + (t ? 8 : 4);
      const sym = Math.max(left, right);
      const centred = w - sym * 2 >= 130;
      navTitle.style.left = (centred ? sym : left) + 'px';
      navTitle.style.right = (centred ? sym : right) + 'px';
      navTitle.style.textAlign = centred || !l ? 'center' : 'left';
      navTitle.style.alignItems = centred || !l ? 'center' : 'flex-start';
    }
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(layoutTitle);
      ro.observe(navbar);
      ro.observe(lead);
      ro.observe(trail);
      // Content arriving or changing height moves what is under the top glass.
      new ResizeObserver(() => NT.tone.touch()).observe(inner);
    }
    // What was last focused here is where focus returns when the page comes back.
    el.addEventListener('focusin', (e) => { if (e.target !== el) page.lastFocus = e.target; });
    // Capture, so a row scrolling sideways inside the page is heard as well.
    scroll.addEventListener('scroll', () => { if (page.art.length) NT.tone.touch(); }, { capture: true, passive: true });

    const threshold = opts.titleAt || (large ? 40 : 8);
    let lastY = 0;
    scroll.addEventListener('scroll', () => {
      const y = scroll.scrollTop;
      navbar.classList.toggle('is-scrolled', y > threshold);
      NT.tabbar.onScroll(y, lastY, scroll);
      lastY = y;
    }, { passive: true });
    return page;
  }

  function avatar(name, size, seed) {
    const a = NT.util.hash(String(seed || name)) % 360;
    return NT.media.avatar(h('span.avatar', {
      'aria-hidden': 'true',
      style: {
        width: size + 'px',
        height: size + 'px',
        fontSize: Math.round(size * 0.4) + 'px',
        background: `linear-gradient(140deg, oklch(0.74 0.16 ${a}), oklch(0.55 0.2 ${(a + 55) % 360}))`,
      },
    }, NT.util.initials(name)), seed);
  }

  // s: the script, as a list item or whole.
  function cover(s, sel, glyphSize) {
    const id = s.script_id;
    const el = h('div.cover' + (sel || ''), { style: NT.util.cover(id) });
    // Top glass turns dark over artwork, though not for a row's small thumbnail.
    if (sel !== '.thumb') NT.tone.mark(el);
    const g = icon(NT.util.glyph(id), glyphSize);
    g.classList.add('cover-glyph');
    el.append(g);
    // The script's own thumbnail takes the generated art's place (media.js).
    return NT.media.cover(el, s);
  }

  function emptyState(iconName, title, text, action, compact) {
    return h('div.empty' + (compact ? '.compact' : ''),
      icon(iconName, compact ? 34 : 48),
      h('h3', title),
      text ? h('p', text) : null,
      action ? h('button.btn.' + (action.style || 'filled') + '.small', { type: 'button', onclick: action.onClick }, action.label) : null);
  }

  function sectionHeader(title, action) {
    return h('div.section-header', h('h2', title),
      action ? h('button', { type: 'button', onclick: action.onClick }, action.label) : null);
  }

  function row(o) {
    const attrs = o.onClick ? { type: 'button', onclick: o.onClick } : {};
    return h((o.onClick ? 'button' : 'div') + '.row' + (o.icon ? '.has-icon' : '') + (o.accent ? '.accent' : ''), attrs,
      o.icon ? h('span.row-icon', { style: { background: o.tint || 'var(--accent)' } }, icon(o.icon, 18)) : null,
      o.subtitle != null
        ? h('span.row-main', h('span.row-title', o.title), h('span.row-sub' + (o.mono ? '.mono' : ''), o.subtitle))
        : h('span.row-title', o.title),
      o.value != null ? h('span.row-value', o.value) : null,
      o.trailing || null,
      o.chevron ? h('span.row-chevron', icon('chevron-right', 16)) : null);
  }

  /* ---------- Placeholders ---------- */

  // What a page shows before its content arrives: the same components, with a bar where
  // each run of words would be and a plain block for artwork (see .ph in app.css).
  const times = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
  const pick = (list, i) => list[i % list.length];
  const bar = (w) => h('span.ph-bar', { style: { '--w': w } });
  const block = (sel, w, ht) => h(sel + '.ph-block', { style: { width: w + 'px', height: (ht || w) + 'px' } });

  const ph = {
    card: (i) => h('article.card.script-card.ph',
      h('div.cover'),
      h('div.script-card-body',
        h('h3', bar(pick(['58%', '44%', '66%', '50%'], i))),
        h('p', bar('94%'), bar(pick(['62%', '38%', '74%', '52%'], i))),
        h('footer', block('span.avatar', 22), bar(pick(['34%', '28%', '40%'], i))))),
    cards: (n) => times(n, ph.card),
    // o: { thumb | icon, sub, value }
    row: (o, i) => h('div.row.ph' + (o.icon ? '.has-icon' : ''),
      o.thumb ? h('div.thumb.ph-block') : null,
      o.icon ? h('span.row-icon.ph-block') : null,
      h('span.row-main',
        h('span.row-title', bar(pick(['9em', '7em', '10.5em', '8em'], i))),
        o.sub ? h('span.row-sub', bar(pick(['8em', '11em', '7em'], i))) : null),
      o.value ? h('span.row-value', bar('52px')) : null),
    list: (n, o) => h('div.list', times(n, (i) => ph.row(o, i))),
    header: () => h('div.section-header.ph', h('h2', bar('6em'))),
    // widths: of the buttons that will rest on the artwork.
    spotlight: (widths) => h('div.cover.spotlight.ph',
      h('span.spotlight-eyebrow', bar('10em')),
      h('h2', bar('min(8em, 86%)')),
      h('p', bar('7em')),
      h('div.spotlight-actions', widths.map((w) => block('span.art-btn', w, 48)))),
    detail: (signedIn) => [
      h('div.cover.detail-hero.ph',
        h('h1', bar('min(9em, 86%)')),
        h('div.detail-meta', block('span.avatar', 26), bar('9em'))),
      h('p.detail-desc.ph', bar('96%'), bar('58%')),
      signedIn ? h('div.detail-actions.ph', block('span.pill-btn', 150, 40)) : null,
      ph.header(),
      h('div.param-groups', times(3, (i) => h('div.list', h('div.row.ph', h('span.row-title.headline', bar(pick(['8em', '11em', '9em'], i))))))),
    ],
    profile: (own) => [
      h('div.profile-head',
        h('span.avatar.ph-block.ph-ink', { style: { width: '104px', height: '104px' } }),
        h('h1.ph', bar('6.4em')),
        h('span.handle.ph', bar('4.6em')),
        h('div.stats', times(own ? 3 : 2, () => h('div.stat.ph', h('b', bar('1.1em')), h('span', bar('3.6em')))))),
      own ? h('div.list', { style: { marginTop: '22px' } }, ph.row({ icon: true }, 3)) : null,
      ph.header(),
      h('div.grid', ph.cards(3)),
    ],
  };

  // What breathes inside a placeholder.
  const INK = '.ph > *, .ph-ink';

  // Stands a placeholder in `host` until its content arrives.
  function hold(host, nodes, sel = '') {
    const layer = h('div.ph-layer' + sel, { 'aria-hidden': 'true', inert: true }, nodes);
    // The breath passes down the page: each piece starts a moment after the one before.
    layer.querySelectorAll(INK).forEach((n, i) => n.style.setProperty('--i', i));
    host.setAttribute('aria-busy', 'true');
    host.replaceChildren(layer);
  }

  // Puts the content in `host` (nodes, or a function that does it). Where a placeholder
  // was standing, it stays over the content and the two cross-fade: the first frame is
  // the placeholder, the last is the content, and nothing moves in between.
  //   beside: elements outside `host` that the content fills in as well.
  function settle(host, fill, beside = []) {
    const layer = [...host.children].find((n) => n.classList.contains('ph-layer'));
    const fade = !!layer && !NT.util.reducedMotion() && host.getClientRects().length > 0;
    // Taking the placeholder out of the page restarts its breath, so it is held where it was.
    const ink = fade ? [...layer.querySelectorAll(INK)] : [];
    const breath = ink.map((n) => getComputedStyle(n).opacity);
    if (typeof fill === 'function') fill();
    else host.replaceChildren(...fill.filter(Boolean));
    host.removeAttribute('aria-busy');
    if (layer) layer.remove();
    if (!fade) return;
    ink.forEach((n, i) => {
      n.style.animation = 'none';
      n.style.opacity = breath[i];
    });
    const timing = { duration: 300, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' };
    // Only what is on screen is worth a layer of its own.
    const edge = window.innerHeight;
    const seen = [...host.children, ...beside].filter((n) => {
      const r = n.getBoundingClientRect();
      return r.height && r.bottom > 0 && r.top < edge;
    });
    host.classList.add('ph-host');
    layer.classList.add('is-clearing');
    host.append(layer);
    for (const n of seen) n.animate([{ opacity: 0 }, { opacity: 1 }], timing);
    const done = () => {
      layer.remove();
      if (!host.querySelector(':scope > .ph-layer')) host.classList.remove('ph-host');
    };
    layer.animate([{ opacity: 1 }, { opacity: 0 }], Object.assign({ fill: 'forwards' }, timing)).finished.then(done, done);
  }

  const byRecent = (list) => list.slice().sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  const errorState = (retry) => emptyState('warning', 'Couldn’t Load', null, { label: 'Try Again', onClick: retry, style: 'gray' });

  /* ---------- Script actions ---------- */

  async function shareScript(s) {
    const url = new URL(NT.nav.href(`/scripts/${s.script_id}`), location.href).href;
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title: s.name || s.script_id, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(url);
      UI.toast('Link copied', { icon: 'link' });
    } catch (e) {
      UI.toast('Couldn’t copy the link', { warn: true });
    }
  }

  async function publishScript(s, done) {
    try {
      await API.publish(s.script_id);
      UI.toast('Published', { icon: 'send' });
      if (done) done();
    } catch (e) {
      UI.toast('Couldn’t publish', { warn: true });
    }
  }

  async function deleteScript(s, done, source) {
    const ok = await UI.confirm({
      title: `Delete “${s.name || s.script_id}”?`,
      message: 'This can’t be undone.',
      confirmLabel: 'Delete',
      destructive: true,
      source,
    });
    if (!ok) return;
    try {
      await API.deleteScript(s.script_id);
      UI.toast('Deleted', { icon: 'trash' });
      if (done) done();
    } catch (e) {
      UI.toast('Couldn’t delete', { warn: true });
    }
  }

  async function newScript() {
    if (!API.session) return void signIn();
    try {
      const mine = await API.userScripts(API.session.user_id);
      const id = await API.createScript(`New Script ${mine.length + 1}`, '');
      NT.nav.go(`/scripts/${id}/edit`);
    } catch (e) {
      UI.toast('Couldn’t create a script', { warn: true });
    }
  }

  async function uploadScript(file) {
    if (!file) return;
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    } catch (e) {
      return void UI.toast('That file isn’t UTF-8 text', { warn: true });
    }
    if (text.length > 1000000) return void UI.toast('Scripts are limited to 1,000,000 characters', { warn: true });
    let name = file.name.replace(/\.(luau?|txt)$/i, '').slice(0, 32);
    if (name.length < 3) name = (name + ' script').slice(0, 32);
    try {
      const id = await API.createScript(name, text);
      NT.nav.go(`/scripts/${id}/edit`);
    } catch (e) {
      UI.toast('Couldn’t upload', { warn: true });
    }
  }

  function scriptMenu(anchor, s, ctx) {
    const id = s.script_id;
    const owner = API.isOwner(s);
    // The script's own page is where its thumbnail is chosen and removed.
    const [thumb, noThumb] = owner && ctx.art ? NT.media.items('thumbs', id) : [];
    UI.menu(anchor, [
      { label: 'Share', icon: 'share', onSelect: () => shareScript(s) },
      API.session && { label: 'View Source', icon: 'code', onSelect: () => NT.nav.go(`/scripts/${id}/view`) },
      owner && '-',
      owner && { label: 'Edit', icon: 'pencil', onSelect: () => NT.nav.go(`/scripts/${id}/edit`) },
      owner && !s.published_at && { label: 'Publish', icon: 'send', onSelect: () => publishScript(s, ctx.refresh) },
      thumb,
      noThumb && '-',
      noThumb,
      owner && { label: 'Delete', icon: 'trash', danger: true, onSelect: () => deleteScript(s, ctx.removed || ctx.refresh, anchor) },
    ]);
  }

  function favButton(s, ctx, sel) {
    const b = h('button.fav-btn' + sel, { type: 'button' }, icon('heart', 20));
    const sync = () => {
      b.setAttribute('aria-pressed', String(!!s.is_favorite));
      b.setAttribute('aria-label', s.is_favorite ? 'Remove from favorites' : 'Add to favorites');
      b.title = s.is_favorite ? 'Remove from favorites' : 'Add to favorites';
    };
    sync();
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!API.session) return void signIn();
      const next = !s.is_favorite;
      s.is_favorite = next;
      sync();
      b.classList.remove('is-popping');
      void b.offsetWidth;
      if (next) b.classList.add('is-popping');
      try {
        await API.setFavorite(s.script_id, next);
        if (ctx && ctx.onFavorite) ctx.onFavorite(s, next);
      } catch (err) {
        s.is_favorite = !next;
        sync();
        UI.toast('Couldn’t update favorites', { warn: true });
      }
    });
    return b;
  }

  // rise: the card's place in a staggered entrance; left out, it is simply there.
  function scriptCard(s, ctx, rise) {
    const fav = API.session ? favButton(s, ctx, '.glass.on-art.interactive') : null;
    if (fav) NT.glass.shine(fav);
    const more = h('button.more-btn', { type: 'button', 'aria-label': 'Script actions', title: 'Script actions', onclick: (e) => { e.stopPropagation(); scriptMenu(more, s, ctx); } }, icon('ellipsis', 20));
    const art = cover(s, '', 96);
    if (!s.published_at) art.append(h('span.badge.on-art', 'Draft'));
    if (fav) art.append(fav);
    const card = h('article.card.script-card.pressable' + (rise == null ? '' : '.rise'), { tabIndex: 0, style: { '--i': rise || 0 } },
      art,
      h('div.script-card-body',
        h('h3', s.name || s.script_id),
        h('p', s.description || 'No description'),
        h('footer',
          avatar(s.author_name, 22, s.author_uuid),
          link(`/users/${s.author_uuid}`, '', s.author_name),
          h('span', '·'),
          h('time', { dateTime: s.updated_at }, rel(s.updated_at)),
          h('span.spacer'),
          more)));
    const open = () => NT.nav.go(`/scripts/${s.script_id}`);
    card.addEventListener('click', (e) => { if (!e.target.closest('button, a')) open(); });
    onActivate(card, open);
    return card;
  }

  // A grid of cards built a screenful at a time; more are added as the page scrolls
  // toward the end. The full list can run to thousands of scripts, and building every
  // card at once stalls the page (and makes every later style change crawl).
  //   keep: build at least this many up front, to hold the scroll position on a refresh.
  function lazyGrid(grid, scroller, items, build, keep = 0) {
    const BATCH = 24;
    if (grid._watch) grid._watch.disconnect();
    const end = h('div.grid-end', { 'aria-hidden': 'true' });
    let shown = 0;
    const watch = new IntersectionObserver((seen) => {
      if (seen[seen.length - 1].isIntersecting) add(BATCH);
    }, { root: scroller, rootMargin: '0px 0px 1200px 0px' });
    function add(n) {
      const from = shown;
      const next = items.slice(from, from + n).map((s, i) => build(s, from + i));
      shown += next.length;
      grid._shown = shown;
      end.before(...next);
      if (shown >= items.length) {
        watch.disconnect();
        end.remove();
      } else {
        // Observing afresh reports again, so the grid keeps filling while its end is in range.
        watch.unobserve(end);
        watch.observe(end);
      }
    }
    grid._watch = watch;
    grid.replaceChildren(end);
    add(Math.max(BATCH, keep));
    return grid;
  }

  function scriptRow(s) {
    return h('a.row', { href: NT.nav.href(`/scripts/${s.script_id}`), onclick: go(`/scripts/${s.script_id}`) },
      cover(s, '.thumb', 24),
      h('span.row-main', h('span.row-title', s.name || s.script_id), h('span.row-sub', `${s.author_name} · ${rel(s.updated_at)}`)),
      h('span.row-chevron', icon('chevron-right', 16)));
  }

  /* ---------- Home ---------- */

  // The lead card is real content, not decoration: the script you last worked on
  // (or the newest one published), with glass controls resting on its artwork.
  function spotlight(s, o) {
    const art = cover(s, '.spotlight.pressable', 220);
    art.tabIndex = 0;
    const button = ([label, iconName, onClick, solid]) => NT.glass.refract(
      h('button.art-btn.glass.on-art.interactive' + (solid ? '.solid' : ''), { type: 'button', onclick: (e) => { e.stopPropagation(); onClick(); } },
        iconName ? icon(iconName, 20) : null, h('span', label)));
    art.append(
      h('span.spotlight-eyebrow', o.eyebrow),
      h('h2', s.name || s.script_id),
      h('p', o.meta),
      h('div.spotlight-actions', o.actions.map(button)));
    const open = () => NT.nav.go(`/scripts/${s.script_id}`);
    art.addEventListener('click', (e) => { if (!e.target.closest('button')) open(); });
    onActivate(art, open);
    return art;
  }

  P.home = function () {
    const page = makePage({ title: 'Home' });
    const body = h('div');
    const fileInput = h('input', { type: 'file', accept: '.lua,.luau,.txt,text/plain', hidden: true });
    fileInput.addEventListener('change', () => { uploadScript(fileInput.files[0]); fileInput.value = ''; });
    page.inner.append(body, fileInput);
    let loaded = false, stamp = '';

    if (API.session) {
      const add = navButton('plus', 'New', () => UI.menu(add, [
        { label: 'New Script', icon: 'plus', onSelect: newScript },
        { label: 'Upload File', icon: 'upload', onSelect: () => fileInput.click() },
      ]));
      // While looking around, the way to the real thing stays in reach.
      page.setTrailing(API.mode === 'demo' ? navPill('Sign In', signIn) : null, add);
    } else page.setTrailing(navPill('Sign In', signIn));

    async function load() {
      const me = API.session;
      if (!loaded) {
        hold(body, me
          ? [ph.spotlight([103, 87]), sectionHeader('My Scripts'), h('div.carousel', ph.cards(5))]
          : [ph.spotlight([87, 104]), sectionHeader('Recently Updated'), ph.list(5, { thumb: true, sub: true })]);
      }
      try {
        const [all, mine, favs] = await Promise.all([
          API.scripts().catch(() => []),
          me ? API.userScripts(me.user_id) : [],
          me ? API.favorites(me.user_id).catch(() => []) : [],
        ]);
        // Coming back to Home reloads it; if nothing changed, leave the page as it is.
        const fresh = JSON.stringify([all, mine, favs]);
        if (loaded && fresh === stamp) return;
        stamp = fresh;
        render(me, all, mine, favs);
        loaded = true;
      } catch (e) {
        loaded = false;
        stamp = '';
        settle(body, [errorState(load)]);
      }
    }

    function render(me, all, mine, favs) {
      const ctx = { refresh: load, onFavorite: () => load() };
      const kids = [];
      const card = (s) => scriptCard(s, ctx);

      const latest = byRecent(mine)[0];
      const featured = byRecent(all.filter((s) => !me || s.author_uuid !== me.user_id))[0];
      if (latest) {
        kids.push(spotlight(latest, {
          eyebrow: 'Continue Editing',
          meta: `Edited ${rel(latest.updated_at)}${latest.published_at ? '' : ' · Draft'}`,
          actions: [
            ['Edit', 'pencil', () => NT.nav.go(`/scripts/${latest.script_id}/edit`), true],
            ['Open', null, () => NT.nav.go(`/scripts/${latest.script_id}`)],
          ],
        }));
      } else if (featured) {
        kids.push(spotlight(featured, {
          eyebrow: 'Featured',
          meta: `${featured.author_name} · ${rel(featured.updated_at)}`,
          actions: me
            ? [['Open', null, () => NT.nav.go(`/scripts/${featured.script_id}`), true]]
            : [['Open', null, () => NT.nav.go(`/scripts/${featured.script_id}`), true], ['Sign In', null, signIn]],
        }));
      }

      if (me) {
        kids.push(sectionHeader('My Scripts', mine.length ? { label: 'See All', onClick: () => { NT.state.scriptsFilter = 'mine'; NT.nav.go('/scripts'); } } : null));
        kids.push(mine.length
          ? h('div.carousel', { dataset: { row: 'mine' } }, byRecent(mine).slice(0, 10).map(card))
          : emptyState('doc', 'No Scripts Yet', null, { label: 'New Script', onClick: newScript }, true));
        if (favs.length) {
          kids.push(sectionHeader('Favorites', { label: 'See All', onClick: () => { NT.state.scriptsFilter = 'favorites'; NT.nav.go('/scripts'); } }));
          kids.push(h('div.carousel', { dataset: { row: 'favs' } }, favs.slice(0, 10).map(card)));
        }
      }

      const recent = byRecent(all.filter((s) => !me || s.author_uuid !== me.user_id)).slice(0, 6);
      if (recent.length) {
        kids.push(sectionHeader('Recently Updated', { label: 'See All', onClick: () => { NT.state.scriptsFilter = 'all'; NT.nav.go('/scripts'); } }));
        kids.push(h('div.list', recent.map(scriptRow)));
      } else if (!me) {
        kids.push(emptyState('code', 'Sign In to Browse', null, { label: 'Sign In', onClick: signIn }));
      }
      // A refresh (a favourite changed, a script was published) keeps each row where it was scrolled.
      const at = {};
      for (const row of body.querySelectorAll('.carousel[data-row]')) at[row.dataset.row] = row.scrollLeft;
      settle(body, kids);
      for (const row of body.querySelectorAll('.carousel[data-row]')) if (at[row.dataset.row]) row.scrollLeft = at[row.dataset.row];
    }

    page.onShow = load;
    return page;
  };

  /* ---------- Scripts ---------- */

  P.scripts = function () {
    const page = makePage({ title: 'Scripts' });
    // Your own scripts come first. The tab reopens on whichever list was used last.
    const store = NT.util.store;
    const FILTERS = ['mine', 'favorites', 'all'], SORTS = ['recent', 'name', 'author'];
    const kept = API.session ? store.get('nt.scripts.filter') : null;
    let chosen = FILTERS.includes(kept) ? kept : API.session ? 'mine' : 'all';
    let sort = SORTS.includes(store.get('nt.scripts.sort')) ? store.get('nt.scripts.sort') : 'recent';
    let query = NT.tabbar.query.trim().toLowerCase();
    // A search looks through everything; `chosen` is the list to return to after it.
    let filter = query ? 'all' : chosen;
    let data = null, signedOut = false, stamp = '';
    const choose = (v) => {
      filter = chosen = v;
      store.set('nt.scripts.filter', v);
    };
    const sortBy = (v) => {
      sort = v;
      store.set('nt.scripts.sort', v);
      render(true);
    };

    const seg = UI.segmented([
      { value: 'mine', label: 'Mine' },
      { value: 'favorites', label: 'Favorites' },
      { value: 'all', label: 'All' },
    ], filter, (v) => { choose(v); render(true); });
    const count = h('p.footnote.count-line');
    const grid = h('div.grid');
    page.inner.append(h('div.filter-bar', seg.el), count, grid);

    const sortBtn = navButton('sort', 'Sort', () => UI.menu(sortBtn, [
      { label: 'Recently Updated', checked: sort === 'recent', onSelect: () => sortBy('recent') },
      { label: 'Name', checked: sort === 'name', onSelect: () => sortBy('name') },
      { label: 'Author', checked: sort === 'author', onSelect: () => sortBy('author') },
    ]));
    page.setTrailing(sortBtn);

    page.listen('search', (q) => {
      const next = String(q || '').trim().toLowerCase();
      const to = next && !query ? 'all' : !next && query ? chosen : filter;
      query = next;
      if (to !== filter) {
        filter = to;
        seg.set(to);
      }
      if (data) render(false);
    });

    const ctx = {
      refresh: () => load(),
      onFavorite(s, on) {
        if (!data) return;
        for (const list of [data.all, data.mine]) for (const x of list) if (x.script_id === s.script_id) x.is_favorite = on;
        data.favs = data.favs.filter((x) => x.script_id !== s.script_id);
        if (on) data.favs.unshift(Object.assign({}, s, { is_favorite: true }));
        if (filter === 'favorites') render(false, true);
      },
    };

    const clearStates = () => grid.parentNode.querySelectorAll('.empty').forEach((n) => n.remove());
    const emptyGrid = () => {
      if (grid._watch) grid._watch.disconnect();
      grid.replaceChildren();
    };

    // keep: the same list is being refreshed, so build as far as it was already built.
    function render(animate, keep) {
      clearStates();
      if (signedOut) {
        count.textContent = '';
        emptyGrid();
        grid.after(emptyState('code', 'Sign In to Browse', null, { label: 'Sign In', onClick: signIn }));
        return;
      }
      let list = filter === 'mine' ? data.mine : filter === 'favorites' ? data.favs : data.all;
      if (query) list = list.filter((s) => (`${s.name} ${s.description || ''} ${s.author_name}`).toLowerCase().includes(query));
      list = list.slice();
      if (sort === 'name') list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      else if (sort === 'author') list.sort((a, b) => String(a.author_name).localeCompare(String(b.author_name)));
      else list.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

      count.textContent = query
        ? `${list.length} result${list.length === 1 ? '' : 's'}`
        : `${list.length} script${list.length === 1 ? '' : 's'}`;
      lazyGrid(grid, page.scroll, list, (s, i) => scriptCard(s, ctx, animate && i < 24 ? Math.min(i, 12) : null), keep ? grid._shown || 0 : 0);
      if (!keep) page.scroll.scrollTop = 0; // a different list starts from its top
      if (!list.length) {
        grid.after(query
          ? emptyState('search', 'No Results', `Nothing matches “${query}”.`)
          : filter === 'mine'
            ? emptyState('doc', 'No Scripts Yet', null, API.session ? { label: 'New Script', onClick: newScript } : { label: 'Sign In', onClick: signIn })
            : filter === 'favorites'
              ? emptyState('heart', 'No Favorites', 'Tap the heart on a script to keep it here.')
              : emptyState('code', 'No Scripts'));
      }
    }

    async function load() {
      const me = API.session;
      const first = !data;
      if (first) hold(grid, ph.cards(6), '.grid');
      try {
        const [all, mine, favs] = await Promise.all([
          API.scripts(),
          me ? API.userScripts(me.user_id) : [],
          me ? API.favorites(me.user_id).catch(() => []) : [],
        ]);
        // Coming back to the tab reloads the list; if nothing changed, leave the page alone.
        const fresh = JSON.stringify([all, mine, favs]);
        if (!first && !signedOut && fresh === stamp) return;
        stamp = fresh;
        signedOut = false;
        data = { all, mine, favs };
        settle(grid, () => render(false, !first), [count]);
      } catch (e) {
        stamp = '';
        if (e && e.status === 401) { signedOut = true; data = { all: [], mine: [], favs: [] }; settle(grid, () => render(false)); }
        else {
          settle(grid, emptyGrid);
          clearStates();
          grid.after(errorState(load));
        }
      }
    }

    page.onShow = () => {
      if (NT.state.scriptsFilter) {
        choose(NT.state.scriptsFilter);
        seg.set(filter);
        delete NT.state.scriptsFilter;
        if (data) render(true);
      }
      load();
    };
    return page;
  };

  /* ---------- Script detail ---------- */

  P.script = function (id) {
    const page = makePage({ title: 'Script', back: true, large: false, titleAt: 150, narrow: true });
    page.el.classList.add('has-acc');
    const body = h('div');
    page.inner.append(body);
    hold(body, ph.detail(!!API.session));

    let script = null, params = [], releases = [];
    const values = {};
    const valueOf = (p) => (p.id in values ? values[p.id] : p.default_value);

    const battle = h('button.accessory-btn.glass.tinted.interactive', { type: 'button', onclick: startBattle }, icon('play', 20), h('span', 'Start Friendly Battle'));
    page.accessory = battle;

    // The toolbar exists from the first frame, so it can reshape out of the
    // previous page's toolbar while this page is still loading.
    const more = groupButton('ellipsis', 'More', () => { if (script) scriptMenu(more, script, { refresh: load, removed: () => NT.nav.back(), art: true }); });
    const group = navGroup(
      groupButton('heart', 'Favorite', () => {}),
      groupButton('share', 'Share', () => { if (script) shareScript(script); }),
      more);
    page.setTrailing(group);

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
          UI.toast('Battle ready (demo)', { icon: 'play' });
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
        const t = UI.toggle(valueOf(p) === 1, (on) => { values[p.id] = on ? 1 : 0; if (values[p.id] === p.default_value) delete values[p.id]; onChange(); }, label);
        return h('div.row.param', h('span.row-title', label), t.el);
      }
      const valueEl = h('span.param-value', String(valueOf(p)));
      const resetBtn = h('button.param-reset', { type: 'button', hidden: valueOf(p) === p.default_value }, 'Reset');
      const apply = (v) => {
        if (v === p.default_value) delete values[p.id];
        else values[p.id] = v;
        valueEl.textContent = String(v);
        resetBtn.hidden = v === p.default_value;
        onChange();
      };
      const s = UI.slider({ min: p.min_value == null ? 0 : p.min_value, max: p.max_value == null ? 100 : p.max_value, value: valueOf(p), label, onInput: apply });
      resetBtn.addEventListener('click', () => { s.set(p.default_value); apply(p.default_value); });
      return h('div.row.param.col', h('div.param-head', h('span.row-title', label), resetBtn, valueEl), s.el);
    }

    function paramGroup(groupId, list) {
      const badge = h('span.badge.accent.param-count', { hidden: true });
      const sync = () => {
        const n = list.filter((p) => valueOf(p) !== p.default_value).length;
        badge.hidden = n === 0;
        badge.textContent = `${n} changed`;
      };
      const head = h('button.row.disclosure', { type: 'button', 'aria-expanded': 'false' },
        h('span.row-title.headline', API.groupLabel(groupId)), badge, icon('chevron-down', 18));
      const wrap = h('div.collapsible', h('div.collapsible-inner', list.map((p) => paramRow(p, sync))));
      head.addEventListener('click', () => {
        const next = head.getAttribute('aria-expanded') !== 'true';
        head.setAttribute('aria-expanded', String(next));
        wrap.classList.toggle('is-open', next);
      });
      sync();
      return h('div.list', head, wrap);
    }

    function render() {
      const s = script;
      const owner = API.isOwner(s);
      page.setTitle(s.name || 'Script');

      group.firstElementChild.replaceWith(favButton(s, null, '.nav-group-btn'));

      const heroEl = cover(s, '.detail-hero', 190);
      const badges = [];
      if (!s.published_at) badges.push(h('span.badge.on-art', 'Draft'));
      if (API.isOutdated(s)) badges.push(h('span.badge.on-art', 'Outdated'));
      if (badges.length) heroEl.append(h('div.badges', badges));
      heroEl.append(
        h('h1', s.name || s.script_id),
        h('div.detail-meta', avatar(s.author_name, 26, s.author_uuid),
          link(`/users/${s.author_uuid}`, '', s.author_name),
          h('span', '· ' + rel(s.updated_at))));

      const kids = [heroEl];
      if (s.description) kids.push(h('p.detail-desc', s.description));

      const actions = [];
      if (API.session) actions.push(glassButton('View Source', 'code', go(`/scripts/${s.script_id}/view`)));
      if (owner) actions.push(glassButton('Edit', 'pencil', go(`/scripts/${s.script_id}/edit`)));
      if (owner && !s.published_at) actions.push(glassButton('Publish', 'send', () => publishScript(s, load), '.tinted'));
      if (actions.length) kids.push(h('div.detail-actions', actions));

      if (API.isOutdated(s)) {
        kids.push(h('div.callout', icon('warning', 22), h('span', 'Released before the latest scripting API change. It may not work as expected.')));
      }

      if (params && params.length) {
        const groups = new Map();
        for (const p of params) {
          if (!groups.has(p.group_id)) groups.set(p.group_id, []);
          groups.get(p.group_id).push(p);
        }
        kids.push(sectionHeader('Parameters'));
        kids.push(h('div.param-groups', [...groups].map(([gid, list]) => paramGroup(gid, list))));
      }

      if (releases && releases.length) {
        const sorted = releases.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        kids.push(sectionHeader('Releases'));
        kids.push(h('ol.timeline', sorted.map((r, i) => h('li',
          h('span.tl-dot'),
          h('div.tl-head', new Date(r.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
            i === 0 ? h('span.badge.green', 'Latest') : null,
            h('time', { dateTime: r.created_at }, rel(r.created_at))),
          r.description ? h('p', r.description) : null))));
      }
      settle(body, kids);
    }

    async function load() {
      const s = await API.script(id);
      if (!s) {
        script = null;
        page.accessory = null;
        page.el.classList.remove('has-acc');
        page.setTrailing();
        // Signed out, the service answers for nothing: that is not the script missing.
        settle(body, [API.session || API.mode !== 'live'
          ? emptyState('doc', 'Script Not Found', null, { label: 'Browse Scripts', onClick: () => NT.nav.go('/scripts') })
          : emptyState('doc', 'Sign In to View', null, { label: 'Sign In', onClick: signIn })]);
        NT.nav.updateChrome();
        return;
      }
      script = s;
      const [ps, rs] = await Promise.all([API.parameters(id).catch(() => null), API.releases(id).catch(() => [])]);
      params = ps || [];
      releases = rs || [];
      render();
    }

    let shown = false;
    page.onShow = () => {
      // Re-read on return (after editing or publishing) without resetting parameter choices.
      load().catch(() => { if (!shown) settle(body, [errorState(() => page.onShow())]); });
      shown = true;
    };
    return page;
  };

  /* ---------- Source viewer ---------- */

  P.viewer = function (id, revision) {
    const page = makePage({ title: 'Source', back: true, large: false, className: 'page-editor.page-code' });
    const host = h('div.code-host');
    page.inner.append(host);
    let view = null, ready = false;

    page.onShow = async () => {
      if (ready) return;
      ready = true;
      const script = await API.script(id);
      if (script) page.setTitle(script.name || 'Source');
      let res;
      try {
        res = await API.scriptContent(id, revision);
      } catch (e) {
        ready = false;
        host.replaceChildren(API.session
          ? emptyState('doc', 'Source Unavailable')
          : emptyState('doc', 'Sign In to View Source', null, { label: 'Sign In', onClick: signIn }));
        return;
      }
      const content = (res && res.content) || '';
      const lines = content ? content.split('\n').length : 0;
      const rev = revision || (res && res.revision);
      page.setSubtitle(`${lines} line${lines === 1 ? '' : 's'}${rev ? ' · Revision ' + rev : ''}`);
      page.setTrailing(navButton('copy', 'Copy', async () => {
        try { await navigator.clipboard.writeText(content); UI.toast('Copied', { icon: 'copy' }); }
        catch (e) { UI.toast('Couldn’t copy', { warn: true }); }
      }));
      if (!content) return void host.replaceChildren(emptyState('doc', 'Empty Script'));
      view = await NT.code.mount(host, { value: content, readOnly: true });
    };
    page.onDestroy(() => { if (view) view.dispose(); });
    return page;
  };

  /* ---------- Editor ---------- */

  // The editor page is a module of its own (editor.js), built from these pieces.
  NT.kit = { makePage, navButton, navGroup, groupButton, emptyState, errorState, publishScript, deleteScript };

  /* ---------- Maps ---------- */

  function parseMapLink(text) {
    let url;
    try { url = new URL(String(text).trim()); } catch (e) { return { error: 'That isn’t a link.' }; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'That isn’t a web link.' };
    if (url.hostname.toLowerCase() !== 'link.nulls.gg') return { error: 'Use a link.nulls.gg map link.' };
    const id = (url.searchParams.get('roomname') || '').trim();
    if (!id) return { error: 'That link has no map in it.' };
    return { id: id.replace(/^map:/, '') };
  }

  P.maps = function () {
    const page = makePage({ title: 'Maps', narrow: true });
    const body = h('div');
    page.inner.append(body);
    let maps = null;

    function mapRow(m) {
      const title = h('span.row-title', m.name);
      const main = h('span.row-main', title, h('span.row-sub.mono', m.internal_id));
      const more = h('button.more-btn', { type: 'button', 'aria-label': 'Map actions', title: 'Map actions' }, icon('ellipsis', 20));
      const el = h('div.row.has-icon', h('span.row-icon', { style: { background: 'var(--green)' } }, icon('map', 18)), main, more);

      function rename() {
        const input = h('input.inline-edit', { value: m.name, minLength: 3, maxLength: 64, 'aria-label': 'Map name' });
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
        { label: 'Rename', icon: 'pencil', onSelect: () => setTimeout(rename, 260) },
        { label: 'Copy ID', icon: 'copy', onSelect: async () => {
          try { await navigator.clipboard.writeText(m.internal_id); UI.toast('Copied', { icon: 'copy' }); }
          catch (e) { UI.toast('Couldn’t copy', { warn: true }); }
        } },
        '-',
        { label: 'Delete', icon: 'trash', danger: true, onSelect: async () => {
          const ok = await UI.confirm({ title: `Delete “${m.name}”?`, message: 'This can’t be undone.', confirmLabel: 'Delete', destructive: true, source: more });
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

    let listHost = null;
    function renderList() {
      settle(listHost, [maps.length
        ? h('div.list', maps.map(mapRow))
        : emptyState('map', 'No Maps Yet', 'Paste a room link to add one.', null, true)]);
    }

    function render() {
      if (!API.session) {
        body.replaceChildren(emptyState('map', 'Sign In to Add Maps', null, { label: 'Sign In', onClick: signIn }));
        return;
      }
      const input = h('input', { type: 'url', inputMode: 'url', autocomplete: 'off', placeholder: 'Paste a map link', 'aria-label': 'Map link' });
      const msg = h('p.form-msg', { role: 'status' });
      const say = (text, kind) => { msg.textContent = text; msg.className = 'form-msg' + (kind ? ' ' + kind : ''); };
      const pasteBtn = h('button.btn.tint.small', { type: 'button' }, 'Paste');
      let busy = false;

      async function submit(text) {
        if (busy || !String(text).trim()) return;
        const parsed = parseMapLink(text);
        if (parsed.error) return say(parsed.error, 'err');
        if (maps.some((m) => m.internal_id === parsed.id)) { input.value = ''; return say('Already added.'); }
        busy = true;
        try {
          const existing = maps.find((m) => m.internal_id.startsWith(parsed.id.split(':')[0]));
          if (existing) {
            await API.updateMap(existing.user_map_id, parsed.id);
            existing.internal_id = parsed.id;
            say('Updated.', 'ok');
          } else {
            maps.unshift(await API.addMap(parsed.id, `New map ${maps.length + 1}`));
            say('Saved.', 'ok');
          }
          input.value = '';
          renderList();
        } catch (e) {
          say('Couldn’t save. Try again.', 'err');
        } finally {
          busy = false;
        }
      }

      pasteBtn.addEventListener('click', async () => {
        if (!navigator.clipboard || !navigator.clipboard.readText) return say('Paste the link into the field.');
        try {
          const text = await navigator.clipboard.readText();
          if (!text.trim()) return say('Clipboard is empty.');
          input.value = text;
          submit(text);
        } catch (e) {
          say('Paste the link into the field.');
        }
      });
      input.addEventListener('paste', () => setTimeout(() => submit(input.value), 0));
      input.addEventListener('input', () => say(''));

      listHost = h('div');
      body.replaceChildren(
        h('form.map-form', { onsubmit: (e) => { e.preventDefault(); submit(input.value); } }, icon('link', 20), input, pasteBtn),
        msg,
        listHost);
      if (maps) renderList();
      else hold(listHost, ph.list(3, { icon: true, sub: true }));
    }

    // The form is built once: coming back to the tab must not wipe a half-typed link.
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
        settle(listHost, [errorState(() => page.onShow())]);
      }
    };
    return page;
  };

  /* ---------- Profile ---------- */

  function userPage(userId, isRoot) {
    const page = makePage({ title: 'Profile', back: !isRoot, large: false, titleAt: 170 });
    const body = h('div');
    page.inner.append(body);
    let loaded = false, stamp = '';

    if (isRoot) page.setTrailing(navButton('gear', 'Settings', () => NT.nav.go('/settings')));

    async function load() {
      const me = API.session;
      const target = userId || (me && me.user_id);
      if (!target) return void body.replaceChildren(emptyState('person', 'Not Signed In', null, { label: 'Sign In', onClick: signIn }));
      if (!loaded) hold(body, ph.profile(!userId || (!!me && (userId === me.user_id || userId === '@' + me.username))));
      let user, scripts, favs;
      try {
        [user, scripts, favs] = await Promise.all([
          userId ? API.user(userId) : Promise.resolve(me),
          API.userScripts(target),
          API.favorites(target).catch(() => []),
        ]);
      } catch (e) {
        settle(body, [e && e.status === 404 ? emptyState('person', 'User Not Found')
          : e && e.status === 401 && !me ? emptyState('person', 'Sign In to View', null, { label: 'Sign In', onClick: signIn })
            : errorState(load)]);
        loaded = false;
        return;
      }
      // Coming back to the page reloads it; if nothing changed, leave it (and its scroll position) alone.
      const fresh = JSON.stringify([user, scripts, favs]);
      if (loaded && fresh === stamp) return;
      stamp = fresh;
      const own = !!me && user.user_id === me.user_id;
      page.setTitle(user.name || user.username);
      const ctx = { refresh: load, onFavorite: () => { if (own) load(); } };
      const card = (s) => scriptCard(s, ctx);
      const drafts = scripts.filter((s) => !s.published_at).length;

      // Your own avatar is the control that changes it (media.js).
      const face = avatar(user.name || user.username, 104, user.user_id);
      const kids = [h('div.profile-head',
        own ? NT.media.editable(face, 'avatars', user.user_id, 'Profile Photo') : face,
        h('h1', user.name || user.username),
        h('span.handle', '@' + user.username),
        h('div.stats',
          h('div.stat', h('b', String(scripts.length)), h('span', 'Scripts')),
          h('div.stat', h('b', String(favs.length)), h('span', 'Favorites')),
          own ? h('div.stat', h('b', String(drafts)), h('span', 'Drafts')) : null))];

      if (own) {
        kids.push(h('div.list', { style: { marginTop: '22px' } },
          row({ icon: 'list', tint: 'var(--indigo)', title: 'Audit Log', chevron: true, onClick: () => NT.nav.go(`/users/${user.user_id}/audit`) })));
      }
      if (favs.length) {
        kids.push(sectionHeader('Favorites'));
        kids.push(lazyGrid(h('div.grid'), page.scroll, favs, card));
      }
      kids.push(sectionHeader('Scripts'));
      kids.push(scripts.length
        ? lazyGrid(h('div.grid'), page.scroll, byRecent(scripts), card)
        : emptyState('doc', 'No Scripts Yet', null, own ? { label: 'New Script', onClick: newScript } : null, true));
      settle(body, kids);
      loaded = true;
    }

    page.onShow = load;
    return page;
  }

  P.profile = () => userPage(null, true);
  P.user = (id) => userPage(id, false);

  /* ---------- Settings ---------- */

  P.settings = function () {
    const page = makePage({ title: 'Settings', back: true, narrow: true });
    const body = h('div');
    page.inner.append(body);
    const header = (text) => h('h2.list-header', text);

    function render() {
      const me = API.session;
      const prefs = NT.prefs.data;
      const demo = API.mode === 'demo';
      const kids = [];

      // Account
      const account = [];
      if (me) account.push(row({ icon: 'person', title: me.name || me.username, subtitle: demo ? 'Demo account' : '@' + me.username, chevron: true, onClick: () => NT.nav.go('/profile') }));
      if (me && !demo) account.push(row({ icon: 'key', tint: 'var(--label-3)', title: 'Password', value: me.has_password ? 'On' : 'Not set', chevron: true, onClick: () => UI.passwordSheet() }));
      if (!me || demo) account.push(row({ title: me ? 'Sign In With Your Account' : 'Sign In', accent: true, onClick: signIn }));
      kids.push(h('div.list', account));
      kids.push(h('div.list', { style: { marginTop: '26px' } },
        row({ icon: 'code', tint: 'var(--indigo)', title: 'Editor', chevron: true, onClick: () => NT.nav.go('/settings/editor') })));

      // Appearance
      const theme = UI.segmented([
        { value: 'system', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' },
      ], prefs.theme, (v) => NT.prefs.set({ theme: v }));
      theme.el.classList.add('seg-inline');
      const accents = ['blue', 'indigo', 'purple', 'pink', 'orange', 'green', 'teal'];
      const swatches = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Accent color' }, accents.map((a) => {
        const b = h('button.swatch', { type: 'button', role: 'radio', 'aria-label': a, title: a[0].toUpperCase() + a.slice(1), 'aria-checked': String(prefs.accent === a), tabIndex: prefs.accent === a ? 0 : -1, style: { background: `var(--${a})`, color: `var(--${a})` } });
        b.addEventListener('click', () => {
          NT.prefs.set({ accent: a });
          swatches.querySelectorAll('.swatch').forEach((x) => { x.setAttribute('aria-checked', String(x === b)); x.tabIndex = x === b ? 0 : -1; });
        });
        return b;
      }));
      UI.arrows(swatches, () => [...swatches.children], (i) => swatches.children[i].click());
      kids.push(header('Appearance'));
      kids.push(h('div.list', h('div.row', h('span.row-title', 'Theme'), theme.el), swatches));

      // Liquid Glass: Clear … Tinted
      const sample = NT.glass.refract(h('div.glass', h('span', 'Aa')));
      const frost = UI.slider({ min: 0, max: 100, value: Math.round(prefs.frost * 100), label: 'Liquid Glass tint', onInput: (v) => NT.prefs.set({ frost: v / 100 }) });
      kids.push(header('Liquid Glass'));
      kids.push(h('div.list',
        h('div.glass-preview', h('div.glass-preview-art', { style: NT.util.cover('liquid-glass-preview') }, h('span', 'Liquid Glass bends what is behind it')), sample),
        h('div.slider-row', h('span', 'Clear'), frost.el, h('span', 'Tinted')),
        h('div.row', h('span.row-title', 'Reduce Transparency'),
          UI.toggle(!!prefs.solid, (on) => NT.prefs.set({ solid: on }), 'Reduce Transparency').el)));

      // Data
      if (demo) {
        kids.push(header('Demo Data'));
        kids.push(h('div.list', row({ title: 'Reset', accent: true, onClick: async (e) => {
          const ok = await UI.confirm({ title: 'Reset Demo Data?', confirmLabel: 'Reset', destructive: true, source: e.currentTarget });
          if (!ok) return;
          API.resetDemo();
          UI.toast('Demo data reset', { icon: 'reset' });
        } })));
      }

      if (me) {
        kids.push(h('div.list', { style: { marginTop: '26px' } }, h('button.row.danger', { type: 'button', onclick: async (e) => {
          const ok = await UI.confirm({ title: 'Log Out?', confirmLabel: 'Log Out', destructive: true, source: e.currentTarget });
          if (!ok) return;
          await API.logout();
          NT.nav.reset(['/']);
        } }, 'Log Out')));
      }
      body.replaceChildren(...kids);
    }

    page.listen('session', render);
    page.onShow = render;
    return page;
  };

  /* ---------- Editor settings ----------
     How the editor behaves (editor-prefs.js). Reached from Settings and from the
     editor's own menu; an editor that is open takes each change as it is made. */

  const EP = NT.editorPrefs;

  const switchRow = (title, key) =>
    h('div.row', h('span.row-title', title), UI.toggle(EP.data[key], (on) => EP.set({ [key]: on }), title).el);

  // A row whose value opens a menu of the values it can take. options: [[value, label]]
  function pickRow(title, key, options) {
    const value = h('span');
    const pick = h('button.row-pick', { type: 'button', 'aria-label': title }, value, icon('sort', 15));
    const sync = () => { value.textContent = (options.find((o) => o[0] === EP.data[key]) || options[0])[1]; };
    pick.addEventListener('click', () => UI.menu(pick, options.map(([v, label]) => ({
      label,
      checked: EP.data[key] === v,
      onSelect: () => { EP.set({ [key]: v }); sync(); },
    }))));
    sync();
    return h('div.row', h('span.row-title', title), pick);
  }

  P.editorSettings = function () {
    const page = makePage({ title: 'Editor', back: true, narrow: true, hideTabbar: true });
    const body = h('div');
    page.inner.append(body);
    const header = (text) => h('h2.list-header', text);
    let reset = null;

    function render() {
      const indent = UI.segmented([{ value: false, label: 'Tabs' }, { value: true, label: 'Spaces' }], EP.data.spaces, (v) => EP.set({ spaces: v }));
      indent.el.classList.add('seg-inline');
      const kids = [
        h('div.list',
          switchRow('Auto-Insert end', 'closeBlocks'),
          switchRow('Auto-Close Brackets', 'closeBrackets'),
          switchRow('Auto-Close Quotes', 'closeQuotes'),
          switchRow('Suggest While Typing', 'suggest'),
          pickRow('Accept on Enter', 'acceptEnter', [['smart', 'Smart'], ['on', 'Always'], ['off', 'Never']]),
          switchRow('Autosave', 'autosave')),
        header('Indentation'),
        h('div.list',
          h('div.row', h('span.row-title', 'Indent With'), indent.el),
          pickRow('Width', 'tabSize', [2, 3, 4, 8].map((n) => [n, String(n)])),
          switchRow('Detect From File', 'detectIndent')),
        header('Display'),
        h('div.list',
          pickRow('Font Size', 'fontSize', EP.CHOICES.fontSize.slice().sort((a, b) => a - b).map((n) => [n, String(n)])),
          pickRow('Line Numbers', 'lineNumbers', [['on', 'On'], ['relative', 'Relative'], ['off', 'Off']]),
          switchRow('Word Wrap', 'wrap'),
          switchRow('Minimap', 'minimap'),
          switchRow('Sticky Scroll', 'sticky'),
          switchRow('Show Whitespace', 'whitespace'),
          switchRow('Indent Guides', 'guides'),
          switchRow('Bracket Colors', 'bracketColors'),
          switchRow('Smooth Caret', 'smoothCaret')),
      ];
      // The rest is the language server's to act on, where there is one.
      if (NT.lsp.available()) {
        const off = Object.keys(EP.data.lint).length;
        kids.push(
          header('Analysis'),
          h('div.list',
            pickRow('Type Checking', 'mode', [['nonstrict', 'Nonstrict'], ['strict', 'Strict'], ['nocheck', 'Off']]),
            row({ title: 'Lint Rules', value: off ? `${off} Off` : 'All On', chevron: true, onClick: () => NT.nav.go('/settings/editor/lint') })),
          header('Completion'),
          h('div.list',
            switchRow('Add Parentheses', 'parens'),
            switchRow('Fill Arguments', 'fillArgs'),
            switchRow('Parameter Hints', 'signatures')),
          header('Inlay Hints'),
          h('div.list',
            pickRow('Parameter Names', 'hintNames', [['none', 'Off'], ['literals', 'Literals'], ['all', 'All']]),
            switchRow('Variable Types', 'hintVars'),
            switchRow('Parameter Types', 'hintParams'),
            switchRow('Return Types', 'hintReturns')));
      }
      reset = h('div.list', { style: { marginTop: '26px' }, hidden: !EP.changed() }, row({ title: 'Reset', accent: true, onClick: async (e) => {
        const ok = await UI.confirm({ title: 'Reset Editor Settings?', confirmLabel: 'Reset', destructive: true, source: e.currentTarget });
        if (!ok) return;
        EP.reset();
        render();
      } }));
      kids.push(reset);
      body.replaceChildren(...kids);
    }

    // Reset is there once there is something to reset.
    page.listen('editor', () => { if (reset) reset.hidden = !EP.changed(); });
    page.onShow = render;
    return page;
  };

  P.lintRules = function () {
    const page = makePage({ title: 'Lint Rules', back: true, narrow: true, hideTabbar: true });
    // Named as a problem names them ("LocalUnused: …"), with the words apart.
    page.inner.append(h('div.list', EP.LINTS.map((name) => {
      const title = name.replace(/([a-z])([A-Z])/g, '$1 $2');
      return h('div.row', h('span.row-title', title), UI.toggle(EP.data.lint[name] !== false, (on) => {
        const lint = Object.assign({}, EP.data.lint);
        if (on) delete lint[name];
        else lint[name] = false;
        EP.set({ lint });
      }, title).el);
    })));
    return page;
  };

  /* ---------- Audit log ---------- */

  // What each kind of event is called, its symbol and its tint.
  const EVENT = {
    UserRegister: ['Account Created', 'person', 'var(--indigo)'],
    UserLogin: ['Signed In', 'person', 'var(--indigo)'],
    UserLogout: ['Signed Out', 'logout', 'var(--label-3)'],
    UserPasswordChange: ['Password Changed', 'key', 'var(--label-3)'],
    ScriptCreate: ['Script Created', 'plus', 'var(--blue)'],
    ScriptUpdate: ['Script Edited', 'pencil', 'var(--orange)'],
    ScriptPublish: ['Script Published', 'send', 'var(--green)'],
    ScriptDelete: ['Script Deleted', 'trash', 'var(--red)'],
    FavoriteAdd: ['Favorite Added', 'heart', 'var(--pink)'],
    FavoriteRemove: ['Favorite Removed', 'heart', 'var(--label-3)'],
    MapCreate: ['Map Added', 'map', 'var(--green)'],
    MapUpdate: ['Map Updated', 'map', 'var(--green)'],
    MapDelete: ['Map Deleted', 'trash', 'var(--red)'],
  };
  // An update that says which part changed is called by that part.
  const CHANGED = {
    ScriptUpdate: { name: 'Script Renamed', description: 'Description Edited', map: 'Map Changed' },
    MapUpdate: { name: 'Map Renamed' },
  };

  P.audit = function (userId) {
    const page = makePage({ title: 'Audit Log', back: true, narrow: true });
    const body = h('div');
    page.inner.append(body);
    let stamp = null;

    // scripts: the ones that still exist, by id. Only those have a name and a page to go to.
    function eventRow(ev, scripts) {
      const type = String(ev.event_type);
      const changes = ev.changes && typeof ev.changes === 'object' ? ev.changes : {};
      const [title, symbol, tint] = EVENT[type] || [type.replace(/([a-z])([A-Z])/g, '$1 $2'), 'info', 'var(--label-3)'];
      const part = Object.keys(CHANGED[type] || {}).find((k) => changes[k]);
      const onScript = /^(Script|Favorite)/.test(type);
      const script = onScript ? scripts.get(ev.target_id) : null;
      const notes = [];
      if (onScript) notes.push(script ? script.name || script.script_id : String(ev.target_id));
      if (changes.revision != null) notes.push(`Revision ${changes.revision}`);
      // Saves in one sitting arrive as one event.
      if (changes.count > 1) notes.push(`${changes.count} ${changes.content ? 'saves' : 'changes'}`);
      const path = !script ? null
        : type === 'ScriptPublish' && changes.revision != null ? `/scripts/${script.script_id}/view?revision=${changes.revision}`
          : `/scripts/${script.script_id}`;
      return row({
        icon: symbol, tint,
        title: part ? CHANGED[type][part] : title,
        subtitle: notes.length ? notes.join(' · ') : null,
        mono: onScript && !script,
        value: rel(ev.occurred_at),
        chevron: !!path,
        onClick: path ? () => NT.nav.go(path) : null,
      });
    }

    async function load() {
      const me = API.session;
      if (!me) {
        stamp = null;
        body.replaceChildren(emptyState('list', 'Not Signed In', null, { label: 'Sign In', onClick: signIn }));
        return;
      }
      if (stamp === null) hold(body, ph.list(6, { icon: true, sub: true, value: true }));
      let events, mine, all;
      try {
        [events, mine, all] = await Promise.all([
          API.audit(userId),
          API.userScripts(me.user_id).catch(() => []),
          API.scripts().catch(() => []),
        ]);
      } catch (e) {
        stamp = null;
        settle(body, [emptyState('list', 'Audit Log Unavailable', null, { label: 'Try Again', onClick: load, style: 'gray' })]);
        return;
      }
      events = (Array.isArray(events) ? events : [])
        .filter((ev) => ev && ev.event_type && ev.occurred_at)
        .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
      const scripts = new Map([...(all || []), ...(mine || [])].map((s) => [s.script_id, s]));
      // Coming back to the page reloads it; if nothing changed, leave it where it was scrolled.
      const fresh = JSON.stringify([events, [...scripts].map(([id, s]) => [id, s.name])]);
      if (fresh === stamp) return;
      stamp = fresh;
      settle(body, [events.length
        ? h('div.list', events.map((ev) => eventRow(ev, scripts)))
        : emptyState('list', 'No Activity Yet')]);
    }

    page.onShow = load;
    return page;
  };

  /* ---------- Not found ---------- */

  P.notFound = function () {
    const page = makePage({ title: 'Not Found', back: true, large: false });
    page.inner.append(emptyState('search', 'Page Not Found', null, { label: 'Go Home', onClick: () => NT.nav.go('/') }));
    return page;
  };
})();
