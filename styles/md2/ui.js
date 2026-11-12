/*
  Material Design 2: the components everything here is built from.

    NT.md2 (M)     the kit, for this style's pages: icons, buttons, the FAB and its menu,
                  switches, sliders, button groups, text fields, lists, menus, dialogs,
                  bottom sheets, snackbars, the loading indicator, and the motion scheme
    NT.ui         what the core asks of a style: toast, confirm, menu, signIn
    NT.look       how Monaco is dressed

  Motion is Material's standard easing: quick out, gentle in, between 150 and 375
  milliseconds by how far a thing travels. Nothing overshoots.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h, clamp } = NT.util;
  const M = (NT.md2 = {});
  const UI = (NT.ui = {});

  /* ---------- Motion ---------- */

  // The standard curve, at the durations the guidelines give: small things and what
  // leaves are quick, a whole screen takes longest.
  const STANDARD = 'cubic-bezier(0.4, 0, 0.2, 1)';
  const curve = (duration) => ({ easing: STANDARD, duration });
  M.motion = {
    spatial: curve(300),
    spatialFast: curve(200),
    spatialSlow: curve(375),
    effects: curve(200),
    effectsFast: curve(150),
    effectsSlow: curve(300),
  };
  const root = document.documentElement;
  for (const [name, key] of [['spatial', 'spatial'], ['spatial-fast', 'spatialFast'], ['spatial-slow', 'spatialSlow'], ['effects', 'effects'], ['effects-fast', 'effectsFast'], ['effects-slow', 'effectsSlow']]) {
    root.style.setProperty(`--m-${name}`, M.motion[key].easing);
    root.style.setProperty(`--m-${name}-dur`, M.motion[key].duration + 'ms');
  }
  const still = () => NT.util.reducedMotion();
  const play = (el, frames, sp, more) => (still() ? null : el.animate(frames, Object.assign({ duration: sp.duration, easing: sp.easing }, more)));

  /* ---------- Icons: Material Icons, by name ---------- */

  // Until the icon font is in, an icon would show as its name spelt out; they stay
  // hidden till then (style.css), and if the font never comes the app's own drawings
  // stand in. A few are asked for by a newer name than the classic set has.
  const CLASSIC = { key: 'vpn_key', draft: 'description', upload: 'file_upload', download: 'file_download', logout: 'exit_to_app', login: 'account_circle', restart_alt: 'refresh', data_object: 'code' };
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
    const el = h('span.m-icon.msr', { 'aria-hidden': 'true', dataset: { icon: name } }, CLASSIC[name] || name);
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
      document.fonts.load('24px "Material Icons"', 'home').then((faces) => faces.length > 0),
      new Promise((r) => setTimeout(() => r(false), 4000)),
    ]).then(done, () => done(false));
  } else symbols = 'none';

  /* ---------- State layer and ripple ----------
     Anything with .m-press shows the press where it landed. */

  document.addEventListener('pointerdown', (e) => {
    const host = e.target.closest && e.target.closest('.m-press');
    if (!host || host.disabled || still()) return;
    const r = host.getBoundingClientRect();
    const size = Math.hypot(r.width, r.height) * 2;
    const ink = h('span.m-ink', { 'aria-hidden': 'true' });
    ink.style.width = ink.style.height = size + 'px';
    ink.style.left = e.clientX - r.left - size / 2 + 'px';
    ink.style.top = e.clientY - r.top - size / 2 + 'px';
    host.append(ink);
    const grow = ink.animate([{ transform: 'scale(0.08)', opacity: 0.14 }, { transform: 'scale(1)', opacity: 0.14 }], { duration: 420, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'forwards' });
    const end = () => {
      document.removeEventListener('pointerup', end, true);
      document.removeEventListener('pointercancel', end, true);
      grow.finished.catch(() => {}).then(() => {
        const out = ink.animate([{ opacity: 0.14 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
        out.onfinish = () => ink.remove();
      });
    };
    document.addEventListener('pointerup', end, true);
    document.addEventListener('pointercancel', end, true);
  }, { passive: true });

  /* ---------- Buttons ---------- */

  // o: { variant: 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated', icon, submit, danger, cls }
  M.button = function (label, onClick, o = {}) {
    return h('button.m-btn.m-press.' + (o.variant || 'filled') + (o.danger ? '.danger' : '') + (o.cls || ''), { type: o.submit ? 'submit' : 'button', disabled: !!o.disabled, onclick: onClick || null },
      o.icon ? M.icon(o.icon, { size: 20 }) : null, h('span', label));
  };
  // o: { variant: 'standard' | 'filled' | 'tonal' | 'outlined', cls }
  M.iconButton = function (icon, label, onClick, o = {}) {
    return h('button.m-iconbtn.m-press.' + (o.variant || 'standard') + (o.cls || ''), { type: 'button', 'aria-label': label, title: label, onclick: onClick || null }, M.icon(icon));
  };

  // The FAB, and the menu it opens into: the button becomes a close button and its
  // actions stand above it, the last nearest.
  //   actions: [{ label, icon, onSelect }]; one action is simply done.
  M.fab = function (icon, label, actions) {
    const btn = h('button.m-fab.m-press', { type: 'button', 'aria-label': label, title: label }, M.icon(icon), M.icon('close'));
    const list = h('div.m-fab-list', { role: 'menu', hidden: true });
    const el = h('div.m-fab-host', list, btn);
    let open = false;
    const set = (on) => {
      if (on === open) return;
      open = on;
      el.classList.toggle('is-open', on);
      btn.setAttribute('aria-expanded', String(on));
      if (on) {
        list.hidden = false;
        list.replaceChildren(...actions.map((a) => h('button.m-fab-item.m-press', { type: 'button', role: 'menuitem', onclick: () => { set(false); a.onSelect(); } }, M.icon(a.icon), h('span', a.label))));
        [...list.children].reverse().forEach((item, i) => play(item, [{ opacity: 0, transform: 'translateY(16px) scale(0.8)' }, { opacity: 1, transform: 'none' }], M.motion.spatialFast, { delay: i * 30, fill: 'backwards' }));
        document.addEventListener('pointerdown', away, true);
        document.addEventListener('keydown', key, true);
      } else {
        document.removeEventListener('pointerdown', away, true);
        document.removeEventListener('keydown', key, true);
        list.hidden = true;
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

  // The loading indicator: one shape turning into the next.
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
    let last = null;
    for (const it of items) {
      if (!it) continue;
      if (it === '-') {
        if (last && last !== '-') list.append(h('div.m-menu-sep', { role: 'separator' }));
        last = '-';
        continue;
      }
      last = it;
      list.append(h('button.m-menu-item.m-press' + (it.danger ? '.danger' : '') + (it.checked ? '.is-on' : ''), {
        type: 'button',
        role: it.checked != null ? 'menuitemradio' : 'menuitem',
        'aria-checked': it.checked != null ? String(!!it.checked) : null,
        disabled: !!it.disabled,
        onclick: () => { menu.close(); if (it.onSelect) it.onSelect(); },
      },
        checks ? h('span.m-menu-lead', it.checked ? M.icon('check', { size: 20 }) : null) : it.icon ? h('span.m-menu-lead', M.icon(matIcon(it.icon), { size: 20 })) : null,
        h('span', it.label)));
    }
    if (list.lastChild && list.lastChild.classList.contains('m-menu-sep')) list.lastChild.remove();
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
    play(list, [{ opacity: 0, transform: 'scale(0.82)' }, { opacity: 1, transform: 'none' }], M.motion.spatialFast);

    let closed = false;
    const menu = {
      el: list,
      close(keep) {
        if (closed) return;
        closed = true;
        document.removeEventListener('pointerdown', outside, true);
        window.removeEventListener('resize', away);
        if (openMenu === menu) openMenu = null;
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
    (el.querySelector('input, textarea') || el.querySelector(o.safe ? '.m-dialog-actions button:first-child' : '.m-dialog-actions button:last-child') || el).focus({ preventScroll: true });
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
    codeOptions: { padding: { top: 12, bottom: 12 }, roundedSelection: false },
    // Monaco's own boxes are surfaces lifted off the page, as a menu is.
    codeTheme(t, dark) {
      const widget = dark ? '#2e2e2e' : '#ffffff', text = dark ? '#ffffffde' : '#000000de', sel = dark ? '#ffffff29' : '#00000014';
      Object.assign(t.colors, {
        'editorWidget.background': widget,
        'editorWidget.foreground': text,
        'editorSuggestWidget.background': widget,
        'editorSuggestWidget.foreground': text,
        'editorSuggestWidget.selectedBackground': sel,
        'editorSuggestWidget.selectedForeground': text,
        'editorHoverWidget.background': widget,
        'editorHoverWidget.foreground': text,
        'input.background': dark ? '#1e1e1e' : '#f5f5f5',
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
