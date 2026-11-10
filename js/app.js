/* App shell and navigator: a tab root with pages pushed on top, like a navigation stack. */
(function () {
  'use strict';
  const NT = window.NT;
  const { h, clamp, motion } = NT.util;
  const P = NT.pages;
  const UI = NT.ui;

  // Opened straight from disk there is no server to rewrite paths, so route with the hash.
  const useHash = location.protocol === 'file:';
  const TAB_ROOTS = { '/': 'home', '/scripts': 'scripts', '/maps': 'maps', '/profile': 'profile' };

  const href = (path) => (useHash ? '#' + path : path);
  const currentPath = () => (useHash ? location.hash.slice(1) || '/' : location.pathname + location.search);
  const decode = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };

  function match(path) {
    const [rawPath, query = ''] = String(path).split('?');
    const pn = rawPath.replace(/\/+$/, '') || '/';
    const q = new URLSearchParams(query);
    const full = pn + (query ? '?' + query : '');
    let m;
    if (TAB_ROOTS[pn]) return { path: pn, tab: true, root: pn, make: () => P[TAB_ROOTS[pn]]() };
    if ((m = pn.match(/^\/scripts\/([^/]+)$/))) return { path: pn, root: '/scripts', make: () => P.script(decode(m[1])) };
    if ((m = pn.match(/^\/scripts\/([^/]+)\/view$/))) return { path: full, root: '/scripts', parents: [`/scripts/${m[1]}`], make: () => P.viewer(decode(m[1]), q.get('revision')) };
    if ((m = pn.match(/^\/scripts\/([^/]+)\/edit$/))) return { path: pn, root: '/scripts', parents: [`/scripts/${m[1]}`], make: () => P.editor(decode(m[1])) };
    if ((m = pn.match(/^\/users\/([^/]+)\/audit$/) || pn.match(/^\/(@[^/]+)\/audit$/))) return { path: pn, root: '/profile', make: () => P.audit(decode(m[1])) };
    if ((m = pn.match(/^\/users\/([^/]+)\/maps$/))) return { path: '/maps', tab: true, root: '/maps', make: () => P.maps() };
    if ((m = pn.match(/^\/users\/([^/]+)(?:\/scripts)?$/) || pn.match(/^\/(@[^/]+)(?:\/scripts)?$/))) return { path: pn, root: '/scripts', make: () => P.user(decode(m[1])) };
    if (pn === '/settings') return { path: pn, root: '/profile', make: () => P.settings() };
    if (pn === '/login' || pn === '/register') return { path: '/', tab: true, root: '/', modal: pn.slice(1), make: () => P.home() };
    if (pn === '/logout') return { path: '/', tab: true, root: '/', action: 'logout', make: () => P.home() };
    return { path: pn, root: '/', make: () => P.notFound() };
  }

  function defaultStack(path) {
    const r = match(path);
    return r.tab ? [r.path] : [r.root, ...(r.parents || []), r.path];
  }

  let stage;

  // Toolbar glass reshapes between pages rather than cross-fading. On each side the
  // outermost item stretches or shrinks into its counterpart on the next page; items
  // with no counterpart materialise or dissolve where they sit.
  function morphBars(from, to) {
    const anims = [];
    const sp = motion.smooth;
    for (const side of ['lead', 'trail']) {
      const a = [...from[side].children].filter((n) => n.classList.contains('glass'));
      const b = [...to[side].children].filter((n) => n.classList.contains('glass'));
      const outer = (list) => (side === 'lead' ? list[0] : list[list.length - 1]);
      const ea = outer(a), eb = outer(b);
      for (const el of b) {
        if (el === eb && ea) {
          const w0 = ea.offsetWidth, w1 = el.offsetWidth;
          if (Math.abs(w0 - w1) > 1) anims.push(el.animate([{ width: w0 + 'px' }, { width: w1 + 'px' }], { duration: sp.duration, easing: sp.easing }));
          for (const child of el.children) {
            anims.push(child.animate([{ opacity: 0, transform: 'scale(0.5)' }, { opacity: 1, transform: 'scale(1)' }],
              { duration: sp.duration * 0.7, delay: 50, easing: sp.easing, fill: 'backwards' }));
          }
        } else {
          anims.push(el.animate([{ transform: 'scale(0.2)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
            { duration: motion.bouncy.duration, easing: motion.bouncy.easing }));
        }
      }
      for (const el of a) {
        if (el === ea && eb) anims.push(el.animate([{ opacity: 0 }, { opacity: 0 }], { duration: sp.duration, fill: 'forwards' }));
        else anims.push(el.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.2)', opacity: 0 }], { duration: 220, easing: 'ease-in', fill: 'forwards' }));
      }
    }
    const tf = from.navbar.querySelector('.navbar-title-pill'), tt = to.navbar.querySelector('.navbar-title-pill');
    if (tf) anims.push(tf.animate([{ opacity: getComputedStyle(tf).opacity }, { opacity: 0 }], { duration: 140, fill: 'forwards' }));
    if (tt) anims.push(tt.animate([{ opacity: 0 }, { opacity: getComputedStyle(tt).opacity }], { duration: 260, delay: 120, easing: 'ease-out', fill: 'backwards' }));
    return anims;
  }

  const Nav = (NT.nav = {
    stack: [], // [{ path, page }]
    roots: new Map(), // tab root pages stay alive so they keep their scroll position
    _pending: null,
    _instant: false,
    href,
    paths() { return this.stack.map((e) => e.path); },
    top() { return this.stack[this.stack.length - 1] || null; },

    start() {
      window.addEventListener('popstate', (e) => {
        this.apply((e.state && e.state.stack) || defaultStack(currentPath()));
      });
      const first = match(currentPath());
      const state = history.state;
      const initial = (state && state.stack) || defaultStack(currentPath());
      history.replaceState({ stack: initial, n: (state && state.n) || 0, p: !!(state && state.p) }, '', href(initial[initial.length - 1]));
      this.apply(initial);
      if (first.modal) UI.authSheet(first.modal);
      if (first.action === 'logout' && NT.api.session) NT.api.logout().then(() => this.reset(['/']));
    },

    go(path) {
      const r = match(path);
      if (r.modal) return void UI.authSheet(r.modal);
      const cur = this.paths();
      let next;
      let pushed = false;
      if (r.tab) {
        if (cur.length === 1 && cur[0] === r.path) {
          this.stack[0].page.scroll.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
        next = [r.path];
      } else if (cur[cur.length - 1] === r.path) return;
      else if (cur.length > 1 && cur[cur.length - 2] === r.path) return void this.back();
      else {
        next = [...cur, r.path];
        pushed = true;
      }
      const n = ((history.state && history.state.n) || 0) + 1;
      history.pushState({ stack: next, n, p: pushed }, '', href(r.path));
      this.apply(next);
    },

    back(opts) {
      if (this.stack.length < 2) return;
      if (opts && opts.instant) this._instant = true;
      const state = history.state;
      // Only walk the browser history when the previous entry is the page underneath.
      if (state && state.p && state.n > 0) history.back();
      else {
        const next = this.paths().slice(0, -1);
        history.replaceState({ stack: next, n: (state && state.n) || 0, p: false }, '', href(next[next.length - 1]));
        this.apply(next);
      }
    },

    // Rebuild every page, e.g. after signing in or out.
    reset(paths) {
      const keep = paths || this.paths();
      this._flush();
      for (const e of this.stack) this._dispose(e);
      for (const e of this.roots.values()) this._dispose(e);
      this.roots.clear();
      this.stack = [];
      if (paths) history.replaceState({ stack: keep, n: (history.state && history.state.n) || 0, p: false }, '', href(keep[keep.length - 1]));
      this.apply(keep.length ? keep : ['/']);
    },

    // Off-screen pages are parked (see .is-parked), except the one a step back. A parked
    // page forgets how far it was scrolled, so that is noted here and put back.
    _park() {
      const under = this.stack[this.stack.length - 2];
      for (const e of new Set([...this.stack, ...this.roots.values()])) {
        const el = e.page.el;
        const park = e !== under && el.classList.contains('is-off');
        if (park === el.classList.contains('is-parked')) continue;
        if (park) {
          e.scrolls = [e.page.scroll, ...el.querySelectorAll('.carousel, .code-area')]
            .filter((n) => n.scrollTop || n.scrollLeft)
            .map((n) => [n, n.scrollLeft, n.scrollTop]);
          el.classList.add('is-parked');
        } else {
          el.classList.remove('is-parked');
          for (const [n, x, y] of e.scrolls || []) { n.scrollLeft = x; n.scrollTop = y; }
          e.scrolls = null;
        }
      }
    },

    updateChrome() {
      const top = this.top();
      if (!top) return;
      this._park();
      NT.tabbar.setActive(TAB_ROOTS[this.stack[0].path] || 'home');
      NT.dom.app.classList.toggle('tab-hidden', !!top.page.hideTabbar);
      NT.tabbar.setAccessory(top.page.accessory || null);
      NT.tabbar.setMinimized(false);
      if (NT.tabbar.searching && this.paths().join() !== '/scripts') NT.tabbar.closeSearch();
      this.retitle();
      NT.tone.touch();
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
        if (!e) {
          e = { path: r.path, page: r.make(), root: true };
          this.roots.set(r.path, e);
        }
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
      if (!e.page.el.isConnected) stage.append(e.page.el);
      else stage.append(e.page.el); // keep stacking order: last child is on top
      if (e.page.onShow) Promise.resolve(e.page.onShow()).catch((err) => console.error(err));
    },

    // Focus follows the navigation: into the page that has come to the front, and when
    // that page is being returned to, back onto what was last used in it. Nothing
    // scrolls, and the page itself shows no ring.
    _focus(e, restore) {
      const cur = document.activeElement;
      if (cur && cur.closest && cur.closest('.tabbar, .overlays')) return; // the tab bar and sheets keep theirs
      let to = restore ? e.page.lastFocus : null;
      if (to && (!to.isConnected || !to.getClientRects().length)) to = null;
      // Not onto a text field where that would raise an on-screen keyboard.
      if (to && to.matches('input, textarea') && !window.matchMedia('(hover: hover)').matches) to = null;
      (to || e.page.el).focus({ preventScroll: true });
    },

    _flush() {
      if (this._pending) {
        const fn = this._pending;
        this._pending = null;
        fn();
      }
    },

    // While one page slides across the other, each piece of top glass has the tone of
    // whichever page is under it: the edge between the two is followed from the slide's
    // own progress (see NT.tone.split). `edge` maps that progress to the edge's place,
    // as a share of the width.
    _tone(tone, slide, edge) {
      const run = this._pending;
      const w = window.innerWidth;
      tone.at(edge(0) * w, true);
      const step = () => {
        if (this._pending !== run) return;
        const p = slide.effect.getComputedTiming().progress;
        if (p != null) tone.at(edge(p) * w);
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },

    _run(anims, cleanup) {
      const done = () => {
        anims.forEach((a) => a.cancel());
        cleanup();
        NT.tone.touch();
      };
      this._pending = done;
      anims[0].onfinish = () => {
        if (this._pending === done) {
          this._pending = null;
          done();
        }
      };
    },

    apply(next) {
      this._flush();
      const cur = this.stack;
      const curPaths = cur.map((e) => e.path);
      let common = 0;
      while (common < cur.length && common < next.length && curPaths[common] === next[common]) common++;
      if (common === cur.length && common === next.length) return this.updateChrome();

      const instant = this._instant || NT.util.reducedMotion();
      this._instant = false;
      const nav = motion.nav;

      // Push: one new page slides in over the current one.
      if (cur.length && common === cur.length && next.length === cur.length + 1) {
        const from = cur[cur.length - 1];
        const to = this._entry(next[next.length - 1]);
        this.stack = [...cur, to];
        this._show(to);
        this.updateChrome();
        this._focus(to, false);
        if (instant) { from.page.el.classList.add('is-off'); NT.tone.sync(to.page); return; }
        const tone = NT.tone.split(to.page, from.page);
        const slide = to.page.scroll.animate([{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], { duration: nav.duration, easing: nav.easing });
        this._run([
          slide,
          from.page.scroll.animate([{ transform: 'translateX(0)', filter: 'brightness(1)' }, { transform: 'translateX(-24%)', filter: 'brightness(0.86)' }], { duration: nav.duration, easing: nav.easing }),
          ...morphBars(from.page, to.page),
        ], () => from.page.el.classList.add('is-off'));
        this._tone(tone, slide, (p) => 1 - p);
        return;
      }

      // Pop: the top page slides away, revealing the one beneath.
      if (common === next.length && common >= 1 && cur.length > next.length) {
        const from = cur[cur.length - 1];
        const to = cur[common - 1];
        const removed = cur.slice(common);
        this.stack = cur.slice(0, common);
        for (const e of removed) if (e !== from) this._dispose(e);
        to.page.el.classList.remove('is-off');
        if (to.page.onShow) Promise.resolve(to.page.onShow()).catch((err) => console.error(err));
        this.updateChrome();
        this._focus(to, true);
        if (instant) { this._dispose(from); NT.tone.sync(to.page); return; }
        const tone = NT.tone.split(from.page, to.page);
        const slide = from.page.scroll.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }], { duration: nav.duration * 0.9, easing: nav.easing, fill: 'forwards' });
        this._run([
          slide,
          to.page.scroll.animate([{ transform: 'translateX(-24%)', filter: 'brightness(0.86)' }, { transform: 'translateX(0)', filter: 'brightness(1)' }], { duration: nav.duration * 0.9, easing: nav.easing }),
          ...morphBars(from.page, to.page),
        ], () => this._dispose(from));
        this._tone(tone, slide, (p) => p);
        return;
      }

      // Anything else (tab switch, deep link): rebuild the stack and cross-fade.
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
      this.updateChrome();
      this._focus(this.top(), true);
      NT.tone.sync(this.top().page);
      if (!instant && cur.length) {
        this.top().page.el.animate([{ opacity: 0, transform: 'scale(0.985)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      }
    },
  });

  // Touch: drag from the left edge to peel the top page back.
  function edgeSwipe() {
    let g = null;
    stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.clientX > 26 || Nav.stack.length < 2 || Nav._pending) return;
      g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, p: 0, v: 0, lastX: e.clientX, lastT: e.timeStamp, top: Nav.stack[Nav.stack.length - 1], under: Nav.stack[Nav.stack.length - 2] };
    }, { passive: true });

    stage.addEventListener('pointermove', (e) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (!g.active) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { g = null; return; }
        if (dx < 10) return;
        g.active = true;
        g.under.page.el.classList.remove('is-off');
        g.tone = NT.tone.split(g.top.page, g.under.page);
        g.tone.at(0, true);
        try { stage.setPointerCapture(e.pointerId); } catch (err) { /* pointer already released */ }
      }
      g.p = clamp(dx / stage.clientWidth, 0, 1);
      g.v = (e.clientX - g.lastX) / Math.max(1, e.timeStamp - g.lastT);
      g.lastX = e.clientX;
      g.lastT = e.timeStamp;
      g.tone.at(g.p * window.innerWidth);
      g.top.page.scroll.style.transform = `translateX(${(g.p * 100).toFixed(2)}%)`;
      g.under.page.scroll.style.transform = `translateX(${(-24 * (1 - g.p)).toFixed(2)}%)`;
      g.top.page.navbar.style.opacity = String(1 - g.p);
      g.under.page.navbar.style.opacity = String(g.p);
    }, { passive: true });

    const end = (e) => {
      if (!g || e.pointerId !== g.id) return;
      const s = g;
      g = null;
      if (!s.active) return;
      const complete = e.type === 'pointerup' && (s.p > 0.4 || s.v > 0.5);
      const opts = { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' };
      const a = s.top.page.scroll.animate([{ transform: s.top.page.scroll.style.transform }, { transform: complete ? 'translateX(100%)' : 'translateX(0)' }], opts);
      const b = s.under.page.scroll.animate([{ transform: s.under.page.scroll.style.transform }, { transform: complete ? 'translateX(0)' : 'translateX(-24%)' }], opts);
      // The top glass keeps to the edge while the page settles either way.
      const w = window.innerWidth, x0 = s.p * w, x1 = complete ? w : 0;
      const settle = () => {
        if (a.playState !== 'running') return;
        s.tone.at(x0 + (x1 - x0) * (a.effect.getComputedTiming().progress || 0));
        requestAnimationFrame(settle);
      };
      requestAnimationFrame(settle);
      a.onfinish = () => {
        a.cancel();
        b.cancel();
        for (const en of [s.top, s.under]) {
          en.page.scroll.style.transform = '';
          en.page.navbar.style.opacity = '';
        }
        if (complete) {
          s.top.page.el.style.visibility = 'hidden';
          Nav.back({ instant: true });
        } else {
          s.under.page.el.classList.add('is-off');
          NT.tone.touch();
        }
      };
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
  }

  async function boot() {
    const app = document.getElementById('app');
    stage = h('div.stage');
    const overlays = h('div.overlays');
    const toasts = h('div.toasts', { 'aria-live': 'polite' });
    const splash = h('div.boot', h('div.spinner'));
    const tab = NT.tabbar.build();
    NT.dom = { app, stage, overlays, toasts };
    // The tab bar waits off-screen while the session loads, then springs in.
    app.classList.add('tab-hidden');
    app.append(stage, tab.accessoryHost, tab.el, overlays, toasts, splash);

    // Lenses are made ready behind the splash, not in the first frames of a page.
    NT.glass.warm();
    await NT.api.init();
    splash.remove();
    app.removeAttribute('aria-busy');
    Nav.start();
    edgeSwipe();
    requestAnimationFrame(() => NT.tabbar.relayout());
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => NT.tabbar.relayout());
  }

  boot().catch((err) => {
    console.error(err);
    const app = document.getElementById('app');
    app.replaceChildren(h('div.empty', h('h3', 'NT Scripting could not start'), h('p', String((err && err.message) || err))));
  });
})();
