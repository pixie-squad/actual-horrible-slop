/*
  Material 3 Expressive's shell: the navigation bar (a rail on a wide window) for the
  four places, and the navigator: a place's own page with pages opened on top of it.

  Going deeper moves forward along the horizontal axis and Back moves back along it;
  changing place fades through. All of it on the expressive springs (ui.js).
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h } = NT.util;
  const M = NT.md;
  const UI = NT.ui;
  const P = NT.pages;
  const R = NT.routes;

  const PLACES = [
    { id: 'home', path: '/', label: 'Home', icon: 'home' },
    { id: 'scripts', path: '/scripts', label: 'Scripts', icon: 'code' },
    { id: 'maps', path: '/maps', label: 'Maps', icon: 'map' },
    { id: 'profile', path: '/profile', label: 'Profile', icon: 'person' },
  ];
  const match = (path) => {
    const r = R.match(path);
    r.make = () => (P[r.name] || P.notFound)(...r.args);
    return r;
  };

  let app, stage, items;

  function navigation() {
    items = new Map();
    const el = h('nav.m-nav', { 'aria-label': 'Places' }, PLACES.map((p) => {
      const b = h('button.m-nav-item', { type: 'button', onclick: () => Nav.go(p.path) },
        h('span.m-nav-ind.m-press', M.icon(p.icon)), h('span.m-nav-label', p.label));
      items.set(p.id, b);
      return b;
    }));
    return el;
  }
  function setPlace(id) {
    for (const [pid, b] of items) {
      const on = pid === id;
      if (on && b.getAttribute('aria-current') !== 'page') {
        // The indicator grows out from the middle of the symbol.
        M.play(b.firstChild, [{ clipPath: 'inset(0 40% round 16px)' }, { clipPath: 'inset(0 0 round 16px)' }], M.motion.spatialFast);
      }
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
  }

  const Nav = (NT.nav = {
    stack: [], // [{ path, page }]
    roots: new Map(), // a place's page stays alive, so it keeps where it was scrolled
    _busy: null,
    href: R.href,
    paths() { return this.stack.map((e) => e.path); },
    top() { return this.stack[this.stack.length - 1] || null; },

    start() {
      window.addEventListener('popstate', (e) => this.apply((e.state && e.state.stack) || R.stack(R.current())));
      const first = R.match(R.current());
      const state = history.state;
      const initial = (state && state.stack) || R.stack(R.current());
      history.replaceState({ stack: initial, n: (state && state.n) || 0, p: !!(state && state.p) }, '', R.href(initial[initial.length - 1]));
      this.apply(initial);
      if (first.modal) UI.authDialog(first.modal);
      if (first.action === 'logout' && NT.api.session) NT.api.logout().then(() => this.reset(['/']));
    },

    go(path) {
      const r = R.match(path);
      if (r.modal) return void UI.authDialog(r.modal);
      const cur = this.paths();
      let next, pushed = false;
      if (r.tab) {
        if (cur.length === 1 && cur[0] === r.path) return void this.stack[0].page.scroll.scrollTo({ top: 0, behavior: 'smooth' });
        next = [r.path];
      } else if (cur[cur.length - 1] === r.path) return;
      else if (cur.length > 1 && cur[cur.length - 2] === r.path) return void this.back();
      else {
        next = [...cur, r.path];
        pushed = true;
      }
      history.pushState({ stack: next, n: ((history.state && history.state.n) || 0) + 1, p: pushed }, '', R.href(r.path));
      this.apply(next);
    },

    back() {
      if (this.stack.length < 2) return;
      const state = history.state;
      // Only walk the browser history when the entry before this one is the page underneath.
      if (state && state.p && state.n > 0) history.back();
      else {
        const next = this.paths().slice(0, -1);
        history.replaceState({ stack: next, n: (state && state.n) || 0, p: false }, '', R.href(next[next.length - 1]));
        this.apply(next);
      }
    },

    // Every page again, e.g. after signing in or out.
    reset(paths) {
      const keep = paths || this.paths();
      this._flush();
      for (const e of this.stack) this._dispose(e);
      for (const e of this.roots.values()) this._dispose(e);
      this.roots.clear();
      this.stack = [];
      if (paths) history.replaceState({ stack: keep, n: (history.state && history.state.n) || 0, p: false }, '', R.href(keep[keep.length - 1]));
      this.apply(keep.length ? keep : ['/']);
    },

    chrome() {
      const top = this.top();
      if (!top) return;
      setPlace(R.tabs[this.stack[0].path] || 'home');
      app.classList.toggle('nav-hidden', !!top.page.hideNav);
      this.retitle();
    },
    retitle() {
      const top = this.top();
      const name = top && top.page.title;
      document.title = name ? `${name} · NT Scripting` : 'NT Scripting';
    },

    _entry(path) {
      const r = match(path);
      if (r.tab) {
        let e = this.roots.get(r.path);
        if (!e) this.roots.set(r.path, (e = { path: r.path, page: r.make(), root: true }));
        return e;
      }
      return { path: r.path, page: r.make(), root: false };
    },
    _dispose(e) {
      if (e.page.destroy) e.page.destroy();
      e.page.el.remove();
    },
    _show(e) {
      e.page.el.classList.remove('is-off');
      stage.append(e.page.el); // last child is on top
      if (e.page.onShow) Promise.resolve(e.page.onShow()).catch((err) => console.error(err));
    },
    _focus(e, restore) {
      const cur = document.activeElement;
      if (cur && cur.closest && cur.closest('.m-nav, .m-overlay')) return;
      let to = restore ? e.page.lastFocus : null;
      if (to && (!to.isConnected || !to.getClientRects().length)) to = null;
      if (to && to.matches('input, textarea') && !window.matchMedia('(hover: hover)').matches) to = null;
      (to || e.page.el).focus({ preventScroll: true });
    },
    _flush() {
      if (this._busy) {
        const fn = this._busy;
        this._busy = null;
        fn();
      }
    },
    // The animations of one change, and what is left to do when they end (or are cut short).
    _run(anims, cleanup) {
      const live = anims.filter(Boolean);
      const done = () => {
        live.forEach((a) => a.cancel());
        cleanup();
      };
      if (!live.length) return void cleanup();
      this._busy = done;
      Promise.all(live.map((a) => a.finished.catch(() => {}))).then(() => {
        if (this._busy === done) {
          this._busy = null;
          done();
        }
      });
    },

    apply(next) {
      this._flush();
      const cur = this.stack;
      const curPaths = cur.map((e) => e.path);
      let common = 0;
      while (common < cur.length && common < next.length && curPaths[common] === next[common]) common++;
      if (common === cur.length && common === next.length) return this.chrome();
      const sp = M.motion.spatial, fx = M.motion.effects;
      const slide = (el, from, to, more) => M.play(el, [{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], sp, more);
      const fade = (el, from, to, more) => M.play(el, [{ opacity: from }, { opacity: to }], fx, more);

      // Forward: the new page comes in from the trailing side as the old one leaves to the leading side.
      if (cur.length && common === cur.length && next.length === cur.length + 1) {
        const from = cur[cur.length - 1];
        const to = this._entry(next[next.length - 1]);
        this.stack = [...cur, to];
        this._show(to);
        this.chrome();
        this._focus(to, false);
        this._run([
          slide(to.page.el, 64, 0), fade(to.page.el, 0, 1),
          slide(from.page.el, 0, -64), fade(from.page.el, 1, 0, { fill: 'forwards' }),
        ], () => from.page.el.classList.add('is-off'));
        return;
      }

      // Back: the same, the other way.
      if (common === next.length && common >= 1 && cur.length > next.length) {
        const from = cur[cur.length - 1];
        const to = cur[common - 1];
        const removed = cur.slice(common);
        this.stack = cur.slice(0, common);
        for (const e of removed) if (e !== from) this._dispose(e);
        to.page.el.classList.remove('is-off');
        if (to.page.onShow) Promise.resolve(to.page.onShow()).catch((err) => console.error(err));
        this.chrome();
        this._focus(to, true);
        this._run([
          slide(from.page.el, 0, 64), fade(from.page.el, 1, 0, { fill: 'forwards' }),
          slide(to.page.el, -64, 0), fade(to.page.el, 0, 1),
        ], () => this._dispose(from));
        return;
      }

      // Another place, or a deep link: the stack is rebuilt and the new page fades through.
      for (const e of cur) {
        if (e.root) e.page.el.classList.add('is-off');
        else this._dispose(e);
      }
      this.stack = next.map((p) => this._entry(p));
      this.stack.forEach((e, i) => {
        if (i === this.stack.length - 1) this._show(e);
        else {
          if (!e.page.el.isConnected) stage.append(e.page.el);
          e.page.el.classList.add('is-off');
        }
      });
      this.chrome();
      this._focus(this.top(), true);
      if (cur.length) {
        const el = this.top().page.el;
        this._run([M.play(el, [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], sp)], () => {});
      }
    },
  });

  async function boot() {
    app = document.getElementById('app');
    stage = h('div.m-stage');
    const overlay = h('div.m-overlay');
    const snack = h('div.m-snacks', { 'aria-live': 'polite' });
    const splash = h('div.m-boot', M.loading());
    const nav = navigation();
    M.layers = { overlay, snack, stage, nav };
    app.classList.add('m-app', 'nav-hidden');
    app.append(nav, stage, overlay, snack, splash);
    await Promise.all([NT.api.init(), NT.ext.init()]);
    splash.remove();
    app.removeAttribute('aria-busy');
    Nav.start();
  }

  boot().catch((err) => {
    console.error(err);
    const el = document.getElementById('app');
    el.replaceChildren(h('div.m-empty', h('h3', 'NT Scripting could not start'), h('p', String((err && err.message) || err))));
  });
})();
