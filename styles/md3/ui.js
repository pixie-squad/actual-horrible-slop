/*
  Material 3 Expressive: the components everything here is built from.

    NT.md (M)     the kit, for this style's pages: icons, buttons, the FAB and its menu,
                  switches, sliders, button groups, text fields, lists, menus, dialogs,
                  bottom sheets, snackbars, the loading indicator, and the motion scheme
    NT.ui         what the core asks of a style: toast, confirm, menu, signIn
    NT.look       how Monaco is dressed

  Motion is the expressive scheme's springs (the values are the ones in Compose's
  ExpressiveMotionTokens): spatial springs for what moves or changes size, which may
  overshoot, and effects springs for colour and opacity, which never do. Which spring a
  component uses is the one its Compose source uses, named where it is used.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h, clamp, springEasing } = NT.util;
  const M = (NT.md = {});
  const UI = (NT.ui = {});

  /* ---------- Motion ---------- */

  // stiffness and damping ratio → the easing and time of a spring of mass 1
  const spring = (stiffness, ratio) => springEasing(stiffness, 2 * ratio * Math.sqrt(stiffness));
  M.motion = {
    spatial: spring(380, 0.8),
    spatialFast: spring(800, 0.6),
    spatialSlow: spring(200, 0.8),
    effects: spring(1600, 1),
    effectsFast: spring(3800, 1),
    effectsSlow: spring(800, 1),
  };
  const root = document.documentElement;
  for (const [name, key] of [['spatial', 'spatial'], ['spatial-fast', 'spatialFast'], ['spatial-slow', 'spatialSlow'], ['effects', 'effects'], ['effects-fast', 'effectsFast'], ['effects-slow', 'effectsSlow']]) {
    root.style.setProperty(`--m-${name}`, M.motion[key].easing);
    root.style.setProperty(`--m-${name}-dur`, M.motion[key].duration + 'ms');
  }
  const still = () => NT.util.reducedMotion();
  const play = (el, frames, sp, more) => (still() ? null : el.animate(frames, Object.assign({ duration: sp.duration, easing: sp.easing }, more)));

  /* ---------- Icons: Material Symbols, by name ---------- */

  // Until the symbol font is in, a symbol would show as its name spelt out; they stay
  // hidden till then (style.css), and if the font never comes the app's own drawings
  // stand in.
  const OWN = {
    home: 'home', code: 'code', map: 'map', person: 'person', search: 'search', add: 'plus', favorite: 'heart', share: 'share',
    more_vert: 'ellipsis', arrow_back: 'chevron-left', chevron_right: 'chevron-right', settings: 'gear', edit: 'pencil', delete: 'trash',
    visibility: 'eye', play_arrow: 'play', check: 'check', close: 'xmark', schedule: 'clock', description: 'doc', content_copy: 'copy',
    link: 'link', key: 'key', palette: 'appearance', info: 'info', warning: 'warning', sort: 'sort', send: 'send', logout: 'logout',
    upload: 'upload', image: 'photo', list_alt: 'list', folder_open: 'sidebar', save: 'check', restart_alt: 'reset', expand_more: 'chevron-down',
    history: 'clock', tune: 'gear', error: 'warning', login: 'person', content_paste: 'clipboard', draft: 'doc',
  };
  let symbols = 'wait';
  M.icon = function (name, opts = {}) {
    if (symbols === 'none') {
      const svg = NT.icon(OWN[name] || 'info', opts.size || 24);
      svg.classList.add('m-icon');
      return svg;
    }
    const el = h('span.m-icon.msr' + (opts.fill ? '.is-filled' : ''), { 'aria-hidden': 'true', dataset: { icon: name } }, name);
    if (opts.size) el.style.fontSize = opts.size + 'px';
    return el;
  };
  if (document.fonts && document.fonts.load) {
    const done = (ok) => {
      symbols = ok ? 'on' : 'none';
      root.classList.toggle('m-symbols', ok);
      if (ok) return;
      for (const el of document.querySelectorAll('.msr')) {
        const svg = NT.icon(OWN[el.dataset.icon] || 'info', parseFloat(el.style.fontSize) || 24);
        svg.classList.add('m-icon');
        el.replaceWith(svg);
      }
    };
    Promise.race([
      document.fonts.load('24px "Material Symbols Rounded"', 'home').then((faces) => faces.length > 0),
      new Promise((r) => setTimeout(() => r(false), 4000)),
    ]).then(done, () => done(false));
  } else symbols = 'none';

  /* ---------- Ripple ----------
     A press on anything with .m-press is a circle of the content's colour at 10 %
     (StateTokens.PressedStateLayerOpacity) that grows from where the press landed to
     cover the component, as Compose's ripple does: in over 75 ms, out to its full
     radius and to the middle over 225 ms, and gone over 150 ms once the press is let go. */

  function ripple(host, x, y) {
    const r = host.getBoundingClientRect();
    const end = Math.hypot(r.width, r.height) + 20;
    const start = Math.max(r.width, r.height) * 0.6;
    const cx = r.width / 2, cy = r.height / 2;
    const dx = x == null ? 0 : x - r.left - cx, dy = y == null ? 0 : y - r.top - cy;
    const ink = h('span.m-ink', { 'aria-hidden': 'true' });
    ink.style.width = ink.style.height = end + 'px';
    ink.style.left = cx - end / 2 + 'px';
    ink.style.top = cy - end / 2 + 'px';
    host.append(ink);
    const grow = ink.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${start / end})` }, { transform: 'none' }], { duration: 225, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });
    ink.animate([{ opacity: 0 }, { opacity: 0.1 }], { duration: 75, fill: 'forwards' });
    return () => grow.finished.catch(() => {}).then(() => {
      const out = ink.animate([{ opacity: 0.1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' });
      out.onfinish = out.oncancel = () => ink.remove();
    });
  }
  document.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    const host = e.target.closest && e.target.closest('.m-press');
    if (!host || host.disabled || host.closest(':disabled') || still()) return;
    const done = ripple(host, e.clientX, e.clientY);
    const end = () => {
      document.removeEventListener('pointerup', end, true);
      document.removeEventListener('pointercancel', end, true);
      done();
    };
    document.addEventListener('pointerup', end, true);
    document.addEventListener('pointercancel', end, true);
  }, { passive: true });
  // From the keyboard it starts in the middle.
  document.addEventListener('keydown', (e) => {
    if (e.repeat || (e.key !== 'Enter' && e.key !== ' ') || still()) return;
    const t = e.target;
    const host = !t.matches ? null : t.matches('.m-press') ? t : t.querySelector(':scope > .m-press');
    if (!host || host.disabled || t.matches('input, textarea')) return;
    const done = ripple(host);
    const end = () => { document.removeEventListener('keyup', end, true); done(); };
    document.addEventListener('keyup', end, true);
  });

  /* ---------- Buttons ---------- */

  // o: { variant: 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated', icon, submit, danger, cls,
  //      size: 'md' (56 high, for the one action a screen leads with; 40 otherwise) }
  // With no label it is a symbol alone.
  M.button = function (label, onClick, o = {}) {
    return h('button.m-btn.m-press.' + (o.variant || 'filled') + (o.size === 'md' ? '.md' : '') + (label ? '' : '.icon-only') + (o.danger ? '.danger' : '') + (o.cls || ''),
      { type: o.submit ? 'submit' : 'button', disabled: !!o.disabled, onclick: onClick || null },
      o.icon ? M.icon(o.icon) : null, label ? h('span', label) : null);
  };
  // o: { variant: 'standard' | 'filled' | 'tonal' | 'outlined', cls }
  M.iconButton = function (icon, label, onClick, o = {}) {
    return h('button.m-iconbtn.m-press.' + (o.variant || 'standard') + (o.cls || ''), { type: 'button', 'aria-label': label, title: label, onclick: onClick || null }, M.icon(icon));
  };

  // The FAB, and the menu it opens into (FloatingActionButtonMenu.kt): the button
  // becomes the round close button, and its actions come out above it one after
  // another, the nearest first, each growing from its trailing edge (fast spatial)
  // as it fades in (fast effects). Closing is the same, the other way.
  //   actions: [{ label, icon, onSelect }]; one action is simply done.
  // When the nth of count items shows: the menu counts them in on the slow effects
  // spring (stiffness 800, critically damped).
  const staggerAt = (n, count) => {
    const w = Math.sqrt(800), want = n / count;
    let t = 0;
    while (t < 1 && 1 - (1 + w * t) * Math.exp(-w * t) < want) t += 0.002;
    return Math.round(t * 1000);
  };
  M.fab = function (icon, label, actions) {
    const btn = h('button.m-fab.m-press', { type: 'button', 'aria-label': label, title: label, 'aria-expanded': 'false' }, M.icon(icon), M.icon('close'));
    const list = h('div.m-fab-list', { role: 'menu', hidden: true });
    const el = h('div.m-fab-host', list, btn);
    let open = false;
    const set = (on) => {
      if (on === open) return;
      open = on;
      el.classList.toggle('is-open', on);
      btn.setAttribute('aria-expanded', String(on));
      for (const a of list.getAnimations({ subtree: true })) a.cancel();
      if (on) {
        list.hidden = false;
        const items = actions.map((a) => h('button.m-fab-item.m-press', { type: 'button', role: 'menuitem', onclick: () => { set(false); a.onSelect(); } },
          h('span.m-fab-item-in', M.icon(a.icon), h('span', a.label))));
        list.replaceChildren(...items);
        const widths = items.map((item) => item.offsetWidth);
        items.forEach((item, i) => {
          const delay = staggerAt(items.length - 1 - i, items.length);
          play(item, [{ width: '0px' }, { width: widths[i] + 'px' }], M.motion.spatialFast, { delay, fill: 'backwards' });
          play(item, [{ opacity: 0 }, { opacity: 1 }], M.motion.effectsFast, { delay, fill: 'backwards' });
        });
        document.addEventListener('pointerdown', away, true);
        document.addEventListener('keydown', key, true);
      } else {
        document.removeEventListener('pointerdown', away, true);
        document.removeEventListener('keydown', key, true);
        const items = [...list.children];
        const widths = items.map((item) => item.offsetWidth);
        const out = items.map((item, i) => {
          const delay = staggerAt(i, items.length);
          item.inert = true;
          play(item, [{ width: widths[i] + 'px' }, { width: '0px' }], M.motion.spatialFast, { delay, fill: 'both' });
          return play(item, [{ opacity: 1 }, { opacity: 0 }], M.motion.effectsFast, { delay, fill: 'both' });
        }).filter(Boolean);
        const gone = () => { if (!open) { list.hidden = true; list.replaceChildren(); } };
        if (out.length) Promise.all(out.map((a) => a.finished)).then(gone, () => {});
        else gone();
      }
    };
    const away = (e) => { if (!el.contains(e.target)) set(false); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); set(false); btn.focus(); } };
    btn.addEventListener('click', () => {
      if (actions.length === 1 && !open) return void actions[0].onSelect();
      set(!open);
    });
    return { el, close: () => set(false) };
  };

  /* ---------- Selection controls ---------- */

  M.switch = function (checked, onChange, label) {
    const input = h('input', { type: 'checkbox', role: 'switch', checked: !!checked, 'aria-label': label || null });
    const el = h('label.m-switch', input, h('span.m-switch-track', h('span.m-switch-handle', M.icon('check', { size: 16 }))));
    input.addEventListener('change', () => { if (onChange) onChange(input.checked); });
    return { el, input, set(v) { input.checked = !!v; } };
  };

  // The expressive slider: a thick track with a gap either side of an upright handle.
  M.slider = function ({ min = 0, max = 100, step = 1, value = 0, onInput, label }) {
    const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label || null });
    const el = h('span.m-slider', input, h('span.m-slider-track', { 'aria-hidden': 'true' }, h('i.on'), h('i.handle'), h('i.off')));
    const sync = () => el.style.setProperty('--at', String(max > min ? (Number(input.value) - min) / (max - min) : 0));
    input.addEventListener('input', () => { sync(); if (onInput) onInput(Number(input.value)); });
    sync();
    return { el, set(v) { input.value = v; sync(); } };
  };

  // A connected button group: one of them is chosen, and the chosen one is the round one.
  //   options: [{ value, label }]
  M.group = function (options, value, onChange) {
    const el = h('div.m-group', { role: 'radiogroup' });
    let cur = value;
    const buttons = options.map((o) => {
      const b = h('button.m-group-btn.m-press', { type: 'button', role: 'radio', onclick: () => { if (cur !== o.value) { set(o.value); if (onChange) onChange(o.value); } } }, h('span', o.label));
      el.append(b);
      return [o.value, b];
    });
    function set(v) {
      cur = v;
      for (const [val, b] of buttons) {
        b.setAttribute('aria-checked', String(val === v));
        b.tabIndex = val === v ? 0 : -1;
      }
    }
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const i = buttons.findIndex(([v]) => v === cur) + (e.key === 'ArrowRight' ? 1 : -1);
      if (!buttons[i]) return;
      e.preventDefault();
      buttons[i][1].focus();
      buttons[i][1].click();
    });
    set(value);
    return { el, set };
  };

  /* ---------- Text fields (outlined; the label rides up into the outline) ---------- */

  M.field = function (label, attrs = {}) {
    const id = 'f-' + NT.util.uid(6);
    const area = attrs.rows != null;
    const input = h(area ? 'textarea' : 'input', Object.assign({ id, placeholder: ' ', autocapitalize: 'off', spellcheck: false }, area ? {} : { type: 'text' }, attrs));
    const note = h('span.m-field-note');
    const row = h('div.m-field' + (area ? '.area' : ''), input, h('label', { for: id }, label), note);
    return { row, input, note };
  };

  /* ---------- Lists ----------
     The expressive list: items are separate pieces a hair apart, and the run of them
     has large corners at its two ends. */

  // o: { icon, tint, leading (a node), headline, supporting, value, trailing (a node), chevron, onClick, href, danger }
  M.item = function (o) {
    const tag = o.href ? 'a' : o.onClick ? 'button' : 'div';
    const attrs = o.href ? { href: o.href, onclick: o.onClick } : o.onClick ? { type: 'button', onclick: o.onClick } : {};
    return h(tag + '.m-item' + (o.onClick || o.href ? '.m-press' : '') + (o.danger ? '.danger' : ''), attrs,
      o.leading || (o.icon ? h('span.m-item-icon', M.icon(o.icon)) : null),
      h('span.m-item-text', h('span.m-item-headline', o.headline), o.supporting != null ? h('span.m-item-supporting' + (o.mono ? '.mono' : ''), o.supporting) : null),
      o.value != null ? h('span.m-item-value', o.value) : null,
      o.trailing || null,
      o.chevron ? M.icon('chevron_right') : null);
  };
  M.list = (...items) => h('div.m-list', items);
  M.header = (text, action) => h('div.m-section', h('h2', text), action ? M.button(action.label, action.onClick, { variant: 'text' }) : null);

  /* ---------- The loading indicator ----------
     LoadingIndicator.kt: seven of Material's shapes, each becoming the next every
     650 ms on a spring (stiffness 200, damping 0.6) and turning a quarter as it does,
     while the whole turns once in 4666 ms. The shapes are built here from their
     definitions in MaterialShapes.kt, and the animation is CSS (style.css has the turn). */

  function loadingShapes(N) {
    const TAU = Math.PI * 2;
    const rot = (p, deg, c) => {
      const a = (deg * Math.PI) / 180, x = p.x - c.x, y = p.y - c.y;
      return { x: x * Math.cos(a) - y * Math.sin(a) + c.x, y: x * Math.sin(a) + y * Math.cos(a) + c.y, r: p.r };
    };
    // customPolygon / doRepeat: the listed points, turned `reps` times about the centre,
    // every other copy mirrored when `mirror` is set.
    function custom(pts, reps, mirror) {
      const c = { x: 0.5, y: 0.5 };
      const out = [];
      if (!mirror) {
        for (let i = 0; i < pts.length * reps; i++) out.push(rot(pts[i % pts.length], (Math.floor(i / pts.length) * 360) / reps, c));
        return { v: out, c };
      }
      const ang = pts.map((p) => (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI);
      const dist = pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
      const n = reps * 2, section = 360 / n;
      for (let k = 0; k < n; k++) {
        pts.forEach((_, index) => {
          const i = k % 2 === 0 ? index : pts.length - 1 - index;
          if (i > 0 || k % 2 === 0) {
            const a = ((section * k + (k % 2 === 0 ? ang[i] : section - ang[i] + 2 * ang[0])) * Math.PI) / 180;
            out.push({ x: Math.cos(a) * dist[i] + c.x, y: Math.sin(a) * dist[i] + c.y, r: pts[i].r });
          }
        });
      }
      return { v: out, c };
    }
    // RoundedPolygon.star: outer radius 1, the same rounding on every corner.
    function star(n, inner, r, turn) {
      const c = { x: 0, y: 0 }, out = [];
      for (let i = 0; i < n; i++) {
        const a = (Math.PI / n) * 2 * i, b = (Math.PI / n) * (2 * i + 1);
        out.push({ x: Math.cos(a), y: Math.sin(a), r }, { x: Math.cos(b) * inner, y: Math.sin(b) * inner, r });
      }
      return { v: turn ? out.map((p) => rot(p, turn, c)) : out, c };
    }
    // The outline with its corners rounded: each corner is cut back along its two edges
    // and joined by an arc; where two cuts would overlap on an edge both give way in
    // proportion (as RoundedPolygon does).
    function outline(shape) {
      const v = shape.v, n = v.length;
      const cut = [], half = [], e1 = [], e2 = [];
      for (let i = 0; i < n; i++) {
        const p = v[(i + n - 1) % n], q = v[(i + 1) % n], o = v[i];
        const a = { x: p.x - o.x, y: p.y - o.y }, b = { x: q.x - o.x, y: q.y - o.y };
        const la = Math.hypot(a.x, a.y), lb = Math.hypot(b.x, b.y);
        e1[i] = { x: a.x / la, y: a.y / la, l: la };
        e2[i] = { x: b.x / lb, y: b.y / lb, l: lb };
        half[i] = Math.acos(Math.max(-1, Math.min(1, e1[i].x * e2[i].x + e1[i].y * e2[i].y))) / 2;
        cut[i] = (o.r || 0) / Math.tan(half[i]);
      }
      const fit = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, sum = cut[i] + cut[j];
        fit[i] = sum > e2[i].l ? e2[i].l / sum : 1; // the edge from i to i + 1
      }
      const pts = [];
      for (let i = 0; i < n; i++) {
        const o = v[i];
        const d = cut[i] * Math.min(fit[i], fit[(i + n - 1) % n]);
        if (d < 1e-6) { pts.push({ x: o.x, y: o.y }); continue; }
        const bis = { x: e1[i].x + e2[i].x, y: e1[i].y + e2[i].y }, bl = Math.hypot(bis.x, bis.y);
        const centre = { x: o.x + (bis.x / bl) * (d / Math.cos(half[i])), y: o.y + (bis.y / bl) * (d / Math.cos(half[i])) };
        const from = { x: o.x + e1[i].x * d, y: o.y + e1[i].y * d }, to = { x: o.x + e2[i].x * d, y: o.y + e2[i].y * d };
        const a0 = Math.atan2(from.y - centre.y, from.x - centre.x);
        let da = Math.atan2(to.y - centre.y, to.x - centre.x) - a0;
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        const rad = Math.hypot(from.x - centre.x, from.y - centre.y);
        for (let k = 0; k <= 12; k++) pts.push({ x: centre.x + Math.cos(a0 + (da * k) / 12) * rad, y: centre.y + Math.sin(a0 + (da * k) / 12) * rad });
      }
      return pts;
    }
    const oval = () => {
      const pts = [];
      for (let i = 0; i < 96; i++) pts.push(rot({ x: Math.cos((i / 96) * TAU), y: Math.sin((i / 96) * TAU) * 0.64 }, -45, { x: 0, y: 0 }));
      return pts;
    };
    const P = (x, y, r) => ({ x, y, r: r || 0 });
    const raw = [
      { c: { x: 0.5, y: 0.5 }, pts: outline(custom([P(0.193, 0.277, 0.053), P(0.176, 0.055, 0.053)], 10)) }, // SoftBurst
      { c: { x: 0, y: 0 }, pts: outline(star(9, 0.8, 0.5, -90)) }, // Cookie9Sided
      { c: { x: 0.5, y: 0.5 }, pts: outline(custom([P(0.5, -0.009, 0.172), P(1.03, 0.365, 0.164), P(0.828, 0.97, 0.169)], 1, true)) }, // Pentagon
      { c: { x: 0.5, y: 0.5 }, pts: outline(custom([P(0.961, 0.039, 0.426), P(1.001, 0.428), P(1.0, 0.609, 1.0)], 2, true)) }, // Pill
      { c: { x: 0, y: 0 }, pts: outline(star(8, 0.8, 0.15)) }, // Sunny
      { c: { x: 0.5, y: 0.5 }, pts: outline(custom([P(1.237, 1.236, 0.258), P(0.5, 0.918, 0.233)], 4)) }, // Cookie4Sided
      { c: { x: 0, y: 0 }, pts: oval() }, // Oval
    ];
    // As the indicator draws them: each fitted to a unit square about the middle of its
    // bounds, then all scaled by the one factor that lets the widest turn without clipping.
    let scale = 1;
    const fitted = raw.map(({ c, pts }) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, far = 0;
      for (const p of pts) {
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
        far = Math.max(far, Math.hypot(p.x - c.x, p.y - c.y));
      }
      scale = Math.min(scale, Math.max((x1 - x0) / (2 * far), (y1 - y0) / (2 * far)));
      const side = Math.max(x1 - x0, y1 - y0), mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      return pts.map((p) => ({ x: (p.x - mx) / side, y: (p.y - my) / side }));
    });
    // N points a shape, by angle from the middle, so one shape's points pair with the next's.
    return fitted.map((pts) => {
      const out = [];
      for (let k = 0; k < N; k++) {
        const a = (k / N) * TAU, dx = Math.cos(a), dy = Math.sin(a);
        let best = 0;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i], q = pts[(i + 1) % pts.length];
          const ex = q.x - p.x, ey = q.y - p.y, den = dx * ey - dy * ex;
          if (Math.abs(den) < 1e-12) continue;
          const t = (p.x * ey - p.y * ex) / den, u = (p.x * dy - p.y * dx) / den;
          if (t > best && u >= -1e-9 && u <= 1 + 1e-9) best = t;
        }
        out.push([dx * best * scale, dy * best * scale]);
      }
      return out;
    });
  }

  (function () {
    const N = 120, shapes = loadingShapes(N);
    // The indicator's 38 in its 48 container.
    const at = (v) => (50 + v * (38 / 48) * 100).toFixed(2) + '%';
    const poly = (pts) => 'polygon(' + pts.map(([x, y]) => at(x) + ' ' + at(y)).join(',') + ')';
    // The morph's spring over its 650 ms.
    const w = Math.sqrt(200), z = 0.6 * w, wd = w * Math.sqrt(1 - 0.36);
    const ease = [];
    for (let i = 0; i <= 40; i++) {
      const t = (0.65 * i) / 40;
      ease.push(i === 40 ? 1 : +(1 - Math.exp(-z * t) * (Math.cos(wd * t) + (z / wd) * Math.sin(wd * t))).toFixed(4));
    }
    const fn = `animation-timing-function: linear(${ease.join(',')});`;
    const n = shapes.length;
    const morph = shapes.map((sh, i) => `${((i / n) * 100).toFixed(4)}% { clip-path: ${poly(sh)}; ${fn} }`).join('\n') + `\n100% { clip-path: ${poly(shapes[0])}; }`;
    const quarter = [0, 1, 2, 3].map((i) => `${i * 25}% { rotate: ${90 + i * 90}deg; ${fn} }`).join('\n') + '\n100% { rotate: 450deg; }';
    document.head.append(h('style', `@keyframes m-morph {\n${morph}\n}\n@keyframes m-quarter {\n${quarter}\n}\n` +
      `.m-loading i::before { clip-path: ${poly(shapes[0])}; rotate: 90deg; animation: m-morph ${n * 650}ms infinite, m-quarter 2600ms infinite; }`));
  })();
  M.loading = (cls) => h('div.m-loading' + (cls || ''), { role: 'progressbar', 'aria-label': 'Loading' }, h('i'));

  /* ---------- Layers: menus, dialogs, sheets, snackbars ---------- */

  M.layers = { overlay: null, snack: null, stage: null, nav: null }; // built by the shell (app.js)

  let openMenu = null;
  M.closeMenu = () => { if (openMenu) openMenu.close(); };

  // items: { label, icon, checked, danger, disabled, onSelect } | '-' | falsy
  M.menu = function (anchor, items, opts = {}) {
    M.closeMenu();
    const list = h('div.m-menu', { role: 'menu', tabIndex: -1 });
    const checks = items.some((it) => it && it !== '-' && it.checked != null);
    // What a divider would part is a group of its own.
    let group = null;
    for (const it of items) {
      if (!it) continue;
      if (it === '-') { group = null; continue; }
      if (!group) list.append((group = h('div.m-menu-group', { role: 'group' })));
      group.append(h('button.m-menu-item.m-press' + (it.danger ? '.danger' : '') + (it.checked ? '.is-on' : ''), {
        type: 'button',
        role: it.checked != null ? 'menuitemradio' : 'menuitem',
        'aria-checked': it.checked != null ? String(!!it.checked) : null,
        disabled: !!it.disabled,
        onclick: () => { menu.close(); if (it.onSelect) it.onSelect(); },
      },
        checks ? h('span.m-menu-lead', it.checked ? M.icon('check', { size: 20 }) : null) : it.icon ? h('span.m-menu-lead', M.icon(matIcon(it.icon), { size: 20 })) : null,
        h('span', it.label)));
    }
    const back = document.activeElement;
    M.layers.overlay.append(list);
    const mw = list.offsetWidth, mh = list.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    const r = anchor.getBoundingClientRect();
    let x = opts.align === 'center' ? r.left + (r.width - mw) / 2 : r.right - mw > 8 ? r.right - mw : r.left;
    let y = r.bottom + 4, up = false;
    if (y + mh > vh - 8 && r.top - mh - 4 >= 8) { y = r.top - mh - 4; up = true; }
    x = clamp(x, 8, Math.max(8, vw - mw - 8));
    y = clamp(y, 8, Math.max(8, vh - mh - 8));
    list.style.left = Math.round(x) + 'px';
    list.style.top = Math.round(y) + 'px';
    list.style.transformOrigin = `${Math.round(clamp(r.left + r.width / 2 - x, 0, mw))}px ${up ? '100%' : '0'}`;
    // Menu.kt: it grows from 0.8 on the fast spatial spring and fades in on the fast effects one.
    play(list, [{ transform: 'scale(0.8)' }, { transform: 'none' }], M.motion.spatialFast);
    play(list, [{ opacity: 0 }, { opacity: 1 }], M.motion.effectsFast);

    let closed = false;
    const menu = {
      el: list,
      close(keep) {
        if (closed) return;
        closed = true;
        document.removeEventListener('pointerdown', outside, true);
        window.removeEventListener('resize', away);
        if (openMenu === menu) openMenu = null;
        list.inert = true;
        play(list, [{ transform: 'none' }, { transform: 'scale(0.8)' }], M.motion.spatialFast, { fill: 'forwards' });
        const out = play(list, [{ opacity: 1 }, { opacity: 0 }], M.motion.effectsFast, { fill: 'forwards' });
        if (out) out.onfinish = () => list.remove();
        else list.remove();
        if (!keep && back && back.isConnected) back.focus({ preventScroll: true });
      },
    };
    const enabled = () => [...list.querySelectorAll('.m-menu-item:not(:disabled)')];
    list.addEventListener('keydown', (e) => {
      const all = enabled();
      const i = all.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (all[i + 1] || all[0] || list).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (all[i - 1] || all[all.length - 1] || list).focus(); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); menu.close(); }
    });
    const outside = (e) => { if (!list.contains(e.target)) menu.close(true); };
    const away = () => menu.close(true);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', away);
    openMenu = menu;
    (enabled()[0] || list).focus({ preventScroll: true });
    return menu;
  };
  // The names the core's menu items give their symbols, as Material's.
  const MAT = {
    share: 'share', code: 'code', pencil: 'edit', send: 'send', trash: 'delete', plus: 'add', upload: 'upload', photo: 'image', xmark: 'close',
    copy: 'content_copy', doc: 'description', gear: 'settings', link: 'link', heart: 'favorite', 'doc-plus': 'note_add', 'folder-plus': 'create_new_folder',
    scissors: 'content_cut', clipboard: 'content_paste', duplicate: 'file_copy', download: 'download', collapse: 'unfold_less', folder: 'folder',
    check: 'check', person: 'person', key: 'key', reset: 'restart_alt', sort: 'sort', 'doc-text': 'description', braces: 'data_object', sidebar: 'folder_open',
  };
  const matIcon = (name) => MAT[name] || name;

  // Scrimmed layers stack; the page under them cannot be used.
  const modals = [];
  function modal(el, o = {}) {
    const scrim = h('div.m-scrim');
    const layer = h('div.m-layer' + (o.cls || ''), scrim, el);
    const back = document.activeElement;
    M.layers.overlay.append(layer);
    // Nothing under it can be used: the pages and the navigation, or the layer below.
    const under = (on) => { for (const n of [M.layers.stage, M.layers.nav]) if (n) n.inert = on; };
    if (!modals.length) under(true);
    else modals[modals.length - 1].layer.inert = true;
    let closed = false;
    const rec = {
      layer,
      close() {
        if (closed) return;
        closed = true;
        modals.splice(modals.indexOf(rec), 1);
        if (!modals.length) under(false);
        else modals[modals.length - 1].layer.inert = false;
        layer.inert = true;
        const done = () => layer.remove();
        const out = o.leave ? o.leave() : null;
        play(scrim, [{ opacity: 1 }, { opacity: 0 }], M.motion.effects, { fill: 'forwards' });
        if (out) out.onfinish = done;
        else done();
        if (o.onClose) o.onClose();
        if (back && back.isConnected) back.focus({ preventScroll: true });
      },
    };
    modals.push(rec);
    play(scrim, [{ opacity: 0 }, { opacity: 1 }], M.motion.effects);
    if (o.dismiss !== false) scrim.addEventListener('click', () => rec.close());
    layer.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); rec.close(); }
      if (e.key === 'Tab') {
        const all = [...el.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea, a[href], [tabindex="0"]')].filter((n) => n.getClientRects().length);
        if (!all.length) return;
        const i = all.indexOf(document.activeElement);
        const to = e.shiftKey ? (i <= 0 ? all.length - 1 : i - 1) : (i === all.length - 1 ? 0 : i + 1);
        e.preventDefault();
        all[to].focus();
      }
    });
    return rec;
  }

  // o: { icon, title, text, body (a node), actions: [nodes], onClose, wide, safe }
  M.dialog = function (o) {
    const el = h('div.m-dialog' + (o.wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || null, tabIndex: -1 },
      o.icon ? h('div.m-dialog-icon', M.icon(o.icon)) : null,
      o.title ? h('h2', o.title) : null,
      o.text ? h('p', o.text) : null,
      o.body || null,
      o.actions && o.actions.length ? h('div.m-dialog-actions', o.actions) : null);
    const rec = modal(el, {
      onClose: o.onClose,
      leave: () => play(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.94)' }], M.motion.effects, { fill: 'forwards' }),
    });
    play(el, [{ opacity: 0, transform: 'scale(0.86)' }, { opacity: 1, transform: 'none' }], M.motion.spatial);
    // The keyboard starts in the first field, or on the action that goes on; where
    // that one destroys something, on the one that does not.
    // (A field that is not shown, like the name when logging in, cannot take it.)
    ([...el.querySelectorAll('input, textarea')].find((n) => n.getClientRects().length) || el.querySelector(o.safe ? '.m-dialog-actions button:first-child' : '.m-dialog-actions button:last-child') || el).focus({ preventScroll: true });
    return { el, close: rec.close };
  };

  // A modal bottom sheet: it comes up from the bottom edge and is dragged, or tapped off, away.
  M.sheet = function ({ title, body, onClose }) {
    const handle = h('div.m-sheet-handle', { 'aria-hidden': 'true' }, h('i'));
    const el = h('div.m-sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || null, tabIndex: -1 },
      handle, title ? h('h2', title) : null, h('div.m-sheet-body', body));
    const rec = modal(el, {
      cls: '.bottom',
      onClose,
      leave: () => play(el, [{ transform: getComputedStyle(el).transform === 'none' ? 'none' : getComputedStyle(el).transform }, { transform: 'translateY(105%)' }], M.motion.effects, { fill: 'forwards' }),
    });
    play(el, [{ transform: 'translateY(100%)' }, { transform: 'none' }], M.motion.spatial);
    // Dragged down by its handle or its title.
    let drag = null;
    const down = (e) => {
      if (e.button) return;
      drag = { y: e.clientY, id: e.pointerId, dy: 0 };
      e.currentTarget.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag.dy = Math.max(0, e.clientY - drag.y);
      el.style.transform = `translateY(${drag.dy}px)`;
    };
    const up = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = drag.dy;
      drag = null;
      if (dy > 110) return void rec.close();
      el.style.transform = '';
      play(el, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], M.motion.spatialFast);
    };
    for (const grip of [handle, el.querySelector('h2')].filter(Boolean)) {
      grip.addEventListener('pointerdown', down);
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    }
    el.focus({ preventScroll: true });
    return { el, close: rec.close };
  };

  let snack = null;
  M.snackbar = function (message, opts = {}) {
    if (snack) snack.remove();
    const el = h('div.m-snackbar' + (opts.warn ? '.warn' : ''), { role: opts.warn ? 'alert' : 'status' }, h('span', message));
    snack = el;
    M.layers.snack.append(el);
    play(el, [{ opacity: 0, transform: 'translateY(24px) scale(0.92)' }, { opacity: 1, transform: 'none' }], M.motion.spatial);
    setTimeout(() => {
      if (snack !== el) return;
      snack = null;
      const out = play(el, [{ opacity: 1 }, { opacity: 0 }], M.motion.effects, { fill: 'forwards' });
      if (out) out.onfinish = () => el.remove();
      else el.remove();
    }, opts.duration || (opts.warn ? 5000 : 3000));
  };

  /* ---------- What the core asks for ---------- */

  UI.toast = (message, opts) => M.snackbar(message, opts);
  UI.menu = (anchor, items, opts) => M.menu(anchor, items, opts);

  UI.confirm = function ({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', destructive = false }) {
    return new Promise((resolve) => {
      let result = false;
      const d = M.dialog({
        icon: destructive ? 'delete' : null,
        title,
        text: message,
        safe: destructive,
        actions: [
          M.button(cancelLabel, () => d.close(), { variant: 'text' }),
          M.button(confirmLabel, () => { result = true; d.close(); }, { variant: 'text', danger: destructive }),
        ],
        onClose: () => resolve(result),
      });
    });
  };

  // A dialog with more than one way on. → the value of the one chosen, or null.
  UI.choose = function ({ title, message, options }) {
    return new Promise((resolve) => {
      let result = null;
      const d = M.dialog({
        title,
        text: message,
        actions: [
          M.button('Cancel', () => d.close(), { variant: 'text' }),
          ...options.slice().reverse().map((o) => M.button(o.label, () => { result = o.value; d.close(); }, { variant: 'text' })),
        ],
        onClose: () => resolve(result),
      });
    });
  };

  /* ---------- Sign in / create account ---------- */

  UI.authDialog = function (initial = 'login') {
    const api = NT.api;
    let mode = initial === 'register' ? 'register' : 'login';
    const name = M.field('Display name', { autocomplete: 'name', enterKeyHint: 'next' });
    const username = M.field('Username', { autocomplete: 'username', enterKeyHint: 'next' });
    const password = M.field('Password', { type: 'password', autocomplete: 'current-password', enterKeyHint: 'done' });
    const error = h('p.m-error', { role: 'alert' });
    const submit = M.button('Log In', null, { submit: true });
    const which = M.group([{ value: 'login', label: 'Log In' }, { value: 'register', label: 'Create Account' }], mode, (v) => { mode = v; sync(); });
    // The sample data is a quiet way past the form, not a second way to sign in.
    const looking = api.mode === 'demo' && !!api.session;
    const form = h('form.m-form', { novalidate: true }, which.el, name.row, username.row, password.row, error,
      h('div.m-dialog-actions',
        looking ? null : M.button('Just look around', lookAround, { variant: 'text' }),
        h('span.m-gap'),
        M.button('Cancel', () => d.close(), { variant: 'text' }),
        submit));
    function sync() {
      name.row.hidden = mode !== 'register';
      submit.lastChild.textContent = mode === 'register' ? 'Create Account' : 'Log In';
      password.input.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
      error.textContent = '';
    }
    sync();
    const d = M.dialog({ title: 'Sign In', body: form, wide: true });

    async function lookAround() {
      await api.demoSignIn();
      d.close();
      NT.nav.reset();
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const u = username.input.value.trim(), p = password.input.value, n = name.input.value.trim();
      if (mode === 'register' && n.length < 3) return void (error.textContent = 'Display name needs at least 3 characters.');
      if (u.length < (mode === 'register' ? 3 : 1)) return void (error.textContent = mode === 'register' ? 'Username needs at least 3 characters.' : 'Enter your username.');
      if (!p) return void (error.textContent = 'Enter your password.');
      if (mode === 'register' && p.length < 8) return void (error.textContent = 'Password needs at least 8 characters.');
      error.textContent = '';
      submit.disabled = true;
      try {
        if (mode === 'register') await api.register(n, u, p);
        else await api.login(u, p);
        d.close();
        NT.nav.reset();
        UI.toast('Signed in as ' + (api.session.name || api.session.username));
      } catch (err) {
        if (err.message === 'live-unavailable') error.textContent = 'Start the app with “node server.js” to sign in.';
        else if (err.status === 401) error.textContent = 'Wrong username or password.';
        else if (err.status === 409) error.textContent = 'That username is taken.';
        else error.textContent = 'Could not sign in. Try again.';
      } finally {
        submit.disabled = false;
      }
    });
    return d;
  };
  UI.signIn = (mode) => UI.authDialog(mode);

  UI.passwordDialog = function () {
    const api = NT.api;
    const hasPassword = !!api.session.has_password;
    const oldPw = M.field('Current password', { type: 'password', autocomplete: 'current-password' });
    const newPw = M.field('New password', { type: 'password', autocomplete: 'new-password' });
    const confirmPw = M.field('Confirm', { type: 'password', autocomplete: 'new-password' });
    const error = h('p.m-error', { role: 'alert' });
    const submit = M.button('Save', null, { submit: true });
    oldPw.row.hidden = !hasPassword;
    const form = h('form.m-form', { novalidate: true }, oldPw.row, newPw.row, confirmPw.row, error,
      h('div.m-dialog-actions', M.button('Cancel', () => d.close(), { variant: 'text' }), submit));
    const d = M.dialog({ title: hasPassword ? 'Change Password' : 'Set Password', body: form, wide: true });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (hasPassword && !oldPw.input.value) return void (error.textContent = 'Enter your current password.');
      if (newPw.input.value.length < 8) return void (error.textContent = 'New password needs at least 8 characters.');
      if (newPw.input.value !== confirmPw.input.value) return void (error.textContent = 'The new passwords do not match.');
      error.textContent = '';
      submit.disabled = true;
      try {
        await api.changePassword(oldPw.input.value, newPw.input.value);
        d.close();
        NT.bus.emit('session');
        UI.toast('Password changed');
      } catch (err) {
        error.textContent = err.status === 401 ? 'Current password is incorrect.' : 'Could not change the password. Try again.';
        submit.disabled = false;
      }
    });
    return d;
  };

  /* ---------- How the core's own parts are dressed ---------- */

  NT.look = {
    codeFont: '"Roboto Mono", ui-monospace, "Cascadia Mono", Consolas, monospace',
    codeOptions: { padding: { top: 12, bottom: 12 }, roundedSelection: true },
    // Monaco's own boxes sit on the container colours, as a menu does.
    codeTheme(t, dark) {
      const widget = dark ? '#2b2930' : '#ece6f0', text = dark ? '#e6e0e9' : '#1d1b20', sel = dark ? '#4a4458' : '#e8def8';
      Object.assign(t.colors, {
        'editorWidget.background': widget,
        'editorWidget.foreground': text,
        'editorSuggestWidget.background': widget,
        'editorSuggestWidget.foreground': text,
        'editorSuggestWidget.selectedBackground': sel,
        'editorSuggestWidget.selectedForeground': text,
        'editorHoverWidget.background': widget,
        'editorHoverWidget.foreground': text,
        'input.background': dark ? '#141218' : '#fef7ff',
        'input.foreground': text,
        'menu.background': widget,
        'menu.foreground': text,
        'menu.selectionBackground': sel,
        'menu.selectionForeground': text,
        'list.hoverBackground': dark ? '#ffffff14' : '#00000014',
        'list.focusBackground': sel,
        'list.activeSelectionBackground': sel,
        'list.activeSelectionForeground': text,
      });
      return t;
    },
    pane(el) { el.classList.add('m-pane'); },
  };

  M.play = play;
  M.matIcon = matIcon;
})();
