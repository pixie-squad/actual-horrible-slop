/* Core helpers: DOM builder, spring physics, formatting, storage, preferences. */
(function () {
  'use strict';

  const NT = (window.NT = window.NT || {});
  const U = (NT.util = {});

  /* ---------- DOM ---------- */

  // h('button.btn.filled', { onclick }, 'Label') → element
  U.h = function h(sel, ...args) {
    const [tag, ...cls] = sel.split('.');
    const el = document.createElement(tag || 'div');
    if (cls.length) el.className = cls.join(' ');
    let props = null;
    const first = args[0];
    if (first && typeof first === 'object' && !(first instanceof Node) && !Array.isArray(first)) props = args.shift();
    if (props) {
      for (const k of Object.keys(props)) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'style') {
          if (typeof v === 'string') el.style.cssText = v;
          else for (const s of Object.keys(v)) {
            if (s.startsWith('--')) el.style.setProperty(s, v[s]);
            else el.style[s] = v[s];
          }
        } else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'class') el.className = (el.className + ' ' + v).trim();
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k.includes('-') || k === 'role' || k === 'for') el.setAttribute(k, v === true ? '' : String(v));
        else if (k in el) {
          try { el[k] = v; } catch (e) { el.setAttribute(k, String(v)); }
        } else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    U.add(el, args);
    return el;
  };

  U.add = function add(el, kids) {
    for (const k of kids) {
      if (k == null || k === false || k === true) continue;
      if (Array.isArray(k)) add(el, k);
      else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return el;
  };

  /* ---------- Small utilities ---------- */

  U.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  U.wait = (ms) => new Promise((r) => setTimeout(r, ms));

  U.debounce = function (fn, ms) {
    let t = 0;
    const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    d.cancel = () => clearTimeout(t);
    return d;
  };

  // FNV-1a, used to derive stable colours from ids.
  U.hash = function (str) {
    let n = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      n ^= str.charCodeAt(i);
      n = Math.imul(n, 0x01000193);
    }
    return n >>> 0;
  };

  U.uid = function (len = 10) {
    const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < len; i++) s += a[(Math.random() * a.length) | 0];
    return s;
  };

  U.rel = function (date) {
    const d = new Date(date);
    const s = (Date.now() - d.getTime()) / 1000;
    if (!isFinite(s)) return '';
    if (s < 45) return 'just now';
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    if (s < 86400 * 7) return Math.round(s / 86400) + 'd ago';
    if (s < 86400 * 30) return Math.round(s / 604800) + 'w ago';
    return U.date(d);
  };

  U.date = function (date) {
    const d = new Date(date);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
  };

  U.store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    },
  };

  /* ---------- Generated artwork ---------- */

  // Every script gets a stable mesh-gradient cover derived from its id.
  U.cover = function (id) {
    const n = U.hash(String(id));
    const a = n % 360;
    const b = (a + 35 + ((n >>> 9) % 70)) % 360;
    const c = (a + 170 + ((n >>> 17) % 90)) % 360;
    return (
      `background:radial-gradient(110% 130% at 6% 0%,oklch(0.76 0.18 ${a}) 0%,transparent 58%),` +
      `radial-gradient(100% 120% at 100% 10%,oklch(0.68 0.22 ${b}) 0%,transparent 56%),` +
      `radial-gradient(130% 120% at 55% 125%,oklch(0.6 0.2 ${c}) 0%,transparent 62%),` +
      `oklch(0.5 0.17 ${a})`
    );
  };

  const GLYPHS = ['bolt', 'sparkles', 'target', 'shield', 'flame', 'wand', 'cube', 'code'];
  U.glyph = (id) => GLYPHS[(U.hash(String(id)) >>> 5) % GLYPHS.length];

  U.initials = function (name) {
    const parts = String(name || '?').trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  };

  /* ---------- Motion ---------- */

  const reduced = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  // Also true in a style that does not move at all (NT.look.still).
  U.reducedMotion = () => reduced.matches || !!(NT.look && NT.look.still);

  // Damped spring driven by requestAnimationFrame, for gesture-following motion.
  class Spring {
    constructor(o = {}) {
      this.value = o.value || 0;
      this.target = this.value;
      this.velocity = 0;
      this.k = o.stiffness || 300;
      this.c = o.damping || 30;
      this.eps = o.precision || 0.01;
      this.onUpdate = o.onUpdate || (() => {});
      this.onRest = o.onRest || null;
      this._raf = 0;
      this._t = 0;
      this._step = this._step.bind(this);
    }
    set(target) {
      this.target = target;
      if (U.reducedMotion()) return this.jump(target);
      if (!this._raf) {
        this._t = performance.now();
        this._raf = requestAnimationFrame(this._step);
      }
    }
    jump(value) {
      this.value = this.target = value;
      this.velocity = 0;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
      this.onUpdate(value, 0);
    }
    _step(now) {
      const dt = Math.min((now - this._t) / 1000, 0.064);
      this._t = now;
      const n = Math.max(1, Math.ceil(dt / 0.004));
      const hs = dt / n;
      for (let i = 0; i < n; i++) {
        const a = -this.k * (this.value - this.target) - this.c * this.velocity;
        this.velocity += a * hs;
        this.value += this.velocity * hs;
      }
      if (Math.abs(this.velocity) < this.eps * 10 && Math.abs(this.value - this.target) < this.eps) {
        this.value = this.target;
        this.velocity = 0;
        this._raf = 0;
        this.onUpdate(this.value, 0);
        if (this.onRest) this.onRest();
        return;
      }
      this.onUpdate(this.value, this.velocity);
      this._raf = requestAnimationFrame(this._step);
    }
  }
  U.Spring = Spring;

  // Simulate a spring from 0 → 1 and express it as a CSS linear() easing,
  // so CSS transitions and WAAPI animations move with real spring curves.
  U.springEasing = function (stiffness, damping) {
    const dt = 1 / 600;
    const pts = [];
    let x = 0, v = 0, t = 0, settled = 0;
    while (t < 3) {
      const a = -stiffness * (x - 1) - damping * v;
      v += a * dt;
      x += v * dt;
      t += dt;
      pts.push(x);
      if (Math.abs(x - 1) < 0.0015 && Math.abs(v) < 0.02) {
        if (++settled > 12) break;
      } else settled = 0;
    }
    const N = 50;
    const out = [];
    for (let i = 0; i <= N; i++) {
      const idx = Math.min(pts.length - 1, Math.round((i / N) * (pts.length - 1)));
      out.push(i === 0 ? 0 : i === N ? 1 : +pts[idx].toFixed(4));
    }
    return { easing: `linear(${out.join(',')})`, duration: Math.round(t * 1000) };
  };

  const supportsLinear = !!(window.CSS && CSS.supports && CSS.supports('transition-timing-function', 'linear(0, 1)'));
  const fallback = (bezier, duration) => ({ easing: bezier, duration });
  U.motion = supportsLinear
    ? {
        bouncy: U.springEasing(240, 17), // damping ratio ≈ 0.55: visible overshoot
        smooth: U.springEasing(260, 26), // ≈ 0.8: a hint of overshoot
        snappy: U.springEasing(520, 40), // quick settle
        nav: U.springEasing(240, 31), // critically damped: no overshoot, for full-screen slides
      }
    : {
        bouncy: fallback('cubic-bezier(0.3, 1.45, 0.45, 1)', 560),
        smooth: fallback('cubic-bezier(0.2, 0.9, 0.25, 1)', 480),
        snappy: fallback('cubic-bezier(0.2, 0.9, 0.3, 1)', 320),
        nav: fallback('cubic-bezier(0.2, 0.85, 0.25, 1)', 460),
      };
  for (const name of ['bouncy', 'smooth', 'snappy']) {
    document.documentElement.style.setProperty(`--spring-${name}`, U.motion[name].easing);
    document.documentElement.style.setProperty(`--dur-${name}`, U.motion[name].duration + 'ms');
  }

  /* ---------- Event bus ---------- */

  const listeners = {};
  NT.bus = {
    on(ev, fn) { (listeners[ev] = listeners[ev] || new Set()).add(fn); },
    off(ev, fn) { if (listeners[ev]) listeners[ev].delete(fn); },
    emit(ev, data) { if (listeners[ev]) for (const fn of [...listeners[ev]]) fn(data); },
  };

  /* ---------- Appearance preferences ----------
     Theme and accent are every style's. `style` is which one (styles.js); frost is
     Liquid Glass's own; solid (no transparency) is for the styles that have glass;
     wallpaper is the desktop picture chosen in each style that has a desktop, by the
     style's id (on <html> as data-wall; with none chosen the style shows its own). */

  const darkQuery = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  NT.prefs = {
    data: Object.assign({ theme: 'system', accent: 'blue', frost: 0.3, solid: false, wallpaper: {} }, U.store.get('nt.prefs', {})),
    // The desktop picture of the style in use: its name, or '' for the style's own.
    get wall() { return (this.data.wallpaper || {})[NT.styles.current] || ''; },
    setWall(name) { this.set({ wallpaper: Object.assign({}, this.data.wallpaper, { [NT.styles.current]: name }) }); },
    set(patch) {
      Object.assign(this.data, patch);
      U.store.set('nt.prefs', this.data);
      this.apply();
    },
    apply() {
      const d = document.documentElement;
      const theme = this.data.theme === 'system' ? (darkQuery && darkQuery.matches ? 'dark' : 'light') : this.data.theme;
      d.dataset.theme = theme;
      d.dataset.accent = this.data.accent;
      d.style.setProperty('--frost', this.data.frost);
      d.toggleAttribute('data-solid', !!this.data.solid);
      if (this.wall) d.dataset.wall = this.wall;
      else delete d.dataset.wall;
      // A style says what colour the browser's own bars take with --theme-color. Read
      // only when the theme or accent changes: asking forces every style to be worked
      // out, which a slider being dragged must not do on each step.
      const key = theme + ' ' + this.data.accent;
      if (key !== this._bars) {
        this._bars = key;
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = getComputedStyle(d).getPropertyValue('--theme-color').trim() || (theme === 'dark' ? '#000000' : '#f2f2f7');
      }
      NT.bus.emit('prefs', this.data);
    },
  };
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', () => NT.prefs.apply());
  NT.prefs.apply();
})();
