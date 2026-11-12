/*
  Windows 7: the parts everything here is built from.

  Windows of glass on a desktop, each with a caption, an address row, a command bar,
  a client area and a status bar; the navigation pane down the left of a window that
  shows a place and the details pane along its bottom; dialog boxes and message boxes
  over them; popup menus; balloons from the notification area; and the common
  controls: push buttons, check boxes, option buttons, edit fields, drop-down lists,
  trackbars, tabs, group boxes and the list view.

    NT.w7 (W)            the kit, for this style's pages
    NT.ui                 what the core asks of a style: toast, confirm, menu
    NT.look               still (the core's own parts do not move), and how Monaco is dressed

  A window and a menu fade in, and a window fades out, as Windows 7's do (style.css).
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h, clamp } = NT.util;
  const W = (NT.w7 = NT.w7 || {});
  const UI = (NT.ui = {});

  const narrow = window.matchMedia('(max-width: 700px)');
  const coarse = window.matchMedia('(any-pointer: coarse)');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- Glyphs: small marks drawn in the text colour ---------- */

  const GLYPHS = {
    min: 'M2 8h6v2H2z',
    max: 'M1 1h9v9H1zM2 3v6h7V3z',
    restore: 'M3 0h7v7H8V6h1V2H4v1H3zM1 3h7v7H1zM2 5v4h5V5z',
    close: 'M1 2h2v1h1v1h2V3h1V2h2v1H8v1H7v1H6v1h1v1h1v1h1v1H7V9H6V8H4v1H3v1H1V9h1V8h1V7h1V6H3V5H2V4H1z',
    down: 'M0 2h7v1H6v1H5v1H4v1H3V5H2V4H1V3H0z',
    up: 'M3 2h1v1h1v1h1v1h1v1H0V5h1V4h1V3h1z',
    right: 'M2 0v7h1V6h1V5h1V4h1V3H5V2H4V1H3V0z',
    check: 'M0 3h1v1h1v1h1V4h1V3h1V2h1V1h1v2H6v1H5v1H4v1H3v1H2V6H1V5H0z',
    bullet: 'M2 1h3v1h1v3H5v1H2V5H1V2h1z',
  };
  W.glyph = function (name, w = 11, hgt = 11) {
    const box = { min: '0 0 11 11', max: '0 0 11 11', restore: '0 0 11 11', close: '0 0 11 11', down: '0 0 7 7', up: '0 0 7 7', right: '0 0 7 7', check: '0 0 7 7', bullet: '0 0 7 7' }[name];
    const t = document.createElement('template');
    t.innerHTML = `<svg class="w-glyph" width="${w}" height="${hgt}" viewBox="${box}" shape-rendering="crispEdges" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${GLYPHS[name]}"/></svg>`;
    return t.content.firstChild;
  };

  // The marks on the caption buttons: white, with a dark line round them (style.css).
  const CAPTION = {
    min: 'M1.5 6.5h9v3h-9z',
    max: 'M1.5 1.5h10v8h-10zM3.5 4.5v3h6v-3z',
    restore: 'M3.5 .5h8v7h-2v-2h-6zM5.5 3v.5h4V3zM1.5 3.500h8v6.500h-8zM3.500 6v2h4V6z',
    close: 'M1.5 1h2.800L6.500 3.300 8.700 1h2.800L8 5l3.500 4H8.700L6.500 6.700 4.300 9H1.500L5 5z',
  };
  const caption = (name) => {
    const t = document.createElement('template');
    t.innerHTML = `<svg width="13" height="10" viewBox="0 0 13 10" aria-hidden="true"><path fill-rule="evenodd" d="${CAPTION[name]}"/></svg>`;
    return t.content.firstChild;
  };

  /* ---------- Layers ---------- */

  // Built by the shell (app.js) before anything else is: the desktop that windows sit
  // on, the layer for dialog boxes, and the one for menus.
  W.layers = { desk: null, modal: null, pop: null };
  let seq = 0;

  /* ---------- Popup menus ---------- */

  let openMenu = null;
  W.closeMenu = () => { if (openMenu) openMenu.close(); };

  // at: an element (the menu drops from its lower left corner; { align: 'right' } from
  // its lower right) or { x, y }.
  // items: { label, onSelect, checked, radio, disabled, pix } | '-' | falsy (left out)
  // opts: { align, owner, onClose, onSide, icons (their size: items show their `pix`), cls, band }
  W.menu = function (at, items, opts = {}) {
    W.closeMenu();
    const list = h('div.w-menu', { role: 'menu', tabIndex: -1 });
    let closed = false;
    const back = document.activeElement;
    const menu = {
      el: list,
      close(keep) {
        if (closed) return;
        closed = true;
        list.remove();
        document.removeEventListener('pointerdown', outside, true);
        window.removeEventListener('blur', away);
        window.removeEventListener('resize', away);
        if (openMenu === menu) openMenu = null;
        if (opts.onClose) opts.onClose();
        if (!keep && back && back.isConnected) back.focus({ preventScroll: true });
      },
    };
    let last = null;
    for (const it of items) {
      if (!it) continue;
      if (it === '-') {
        if (last && last !== '-') list.append(h('div.w-menu-sep', { role: 'separator' }));
        last = '-';
        continue;
      }
      last = it;
      list.append(h('button.w-menu-item', {
        type: 'button',
        role: it.checked != null ? (it.radio === false ? 'menuitemcheckbox' : 'menuitemradio') : 'menuitem',
        'aria-checked': it.checked != null ? String(!!it.checked) : null,
        disabled: !!it.disabled,
        tabIndex: -1,
        onclick: () => {
          menu.close();
          if (it.onSelect) it.onSelect();
        },
        onpointerenter: (e) => { if (!e.currentTarget.disabled) e.currentTarget.focus({ preventScroll: true }); },
      },
        // Every item has its place in the gutter, marked or not.
        h('i.w-menu-mark', it.checked ? W.glyph(it.radio === false ? 'check' : 'bullet', 7, 7) : null),
        h('span', it.label)));
    }
    if (list.lastChild && list.lastChild.classList.contains('w-menu-sep')) list.lastChild.remove();
    if (opts.cls) list.classList.add(opts.cls);

    W.layers.pop.append(list);
    // Where it fits: below the control, or above it; never off the screen.
    const mw = list.offsetWidth, mh = list.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let x, y;
    if (at instanceof Element) {
      const r = at.getBoundingClientRect();
      x = opts.align === 'right' ? r.right - mw : opts.align === 'center' ? r.left + (r.width - mw) / 2 : r.left;
      y = r.bottom;
      if (y + mh > vh && r.top - mh >= 0) y = r.top - mh;
    } else {
      x = at.x;
      y = at.y;
      if (y + mh > vh) y = Math.max(0, y - mh);
    }
    list.style.left = Math.round(clamp(x, 0, Math.max(0, vw - mw))) + 'px';
    list.style.top = Math.round(clamp(y, 0, Math.max(0, vh - mh))) + 'px';

    const enabled = () => [...list.querySelectorAll('.w-menu-item:not(:disabled)')];
    list.addEventListener('keydown', (e) => {
      const all = enabled();
      const i = all.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (all[i + 1] || all[0] || list).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (all[i - 1] || all[all.length - 1] || list).focus(); }
      else if (e.key === 'Home') { e.preventDefault(); if (all[0]) all[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); if (all.length) all[all.length - 1].focus(); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); menu.close(); }
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && opts.onSide) { e.preventDefault(); opts.onSide(e.key === 'ArrowRight' ? 1 : -1); }
    });
    const outside = (e) => {
      if (list.contains(e.target)) return;
      // A press on the control that opened it closes it and is not passed on to open it again.
      if (opts.owner && opts.owner.contains(e.target)) return;
      menu.close(true);
    };
    const away = () => menu.close(true);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', away);
    window.addEventListener('resize', away);
    openMenu = menu;
    const first = enabled()[0];
    (opts.keyboard === false ? list : first || list).focus({ preventScroll: true });
    return menu;
  };

  /* ---------- Controls ---------- */

  // opts: { primary (the default button of its dialog), disabled, title, cls }
  W.button = function (label, onClick, opts = {}) {
    return h('button.w-btn' + (opts.primary ? '.is-default' : '') + (opts.cls || ''), {
      type: opts.submit ? 'submit' : 'button', disabled: !!opts.disabled, title: opts.title || null, onclick: onClick || null,
    }, h('span', label));
  };

  W.check = function (label, checked, onChange) {
    const input = h('input', { type: 'checkbox', checked: !!checked });
    input.addEventListener('change', () => { if (onChange) onChange(input.checked); });
    return {
      el: h('label.w-check', input, h('i.w-box'), h('span', label)),
      input,
      get value() { return input.checked; },
      set(v) { input.checked = !!v; },
    };
  };

  // options: [[value, label]]
  W.radios = function (options, value, onChange) {
    const name = 'r' + ++seq;
    const inputs = [];
    const el = h('div.w-radios', { role: 'radiogroup' }, options.map(([v, label]) => {
      const input = h('input', { type: 'radio', name, checked: v === value });
      input.addEventListener('change', () => { if (input.checked && onChange) onChange(v); });
      inputs.push([v, input]);
      return h('label.w-check.w-radio', input, h('i.w-box'), h('span', label));
    }));
    return { el, set(v) { for (const [val, input] of inputs) input.checked = val === v; } };
  };

  W.input = (attrs = {}) => h('input.w-edit', Object.assign({ type: 'text', autocapitalize: 'off', spellcheck: false }, attrs));

  // A search box: the field with the magnifying glass at its end.
  W.search = (attrs = {}) => h('input.w-find', Object.assign({ type: 'search', autocapitalize: 'off', spellcheck: false }, attrs));

  // A label and the field it names, side by side.
  W.field = function (label, attrs = {}) {
    const id = 'f' + ++seq;
    const input = W.input(Object.assign({ id }, attrs));
    return { row: h('div.w-field', h('label', { for: id }, label), input), input };
  };

  // A drop-down list. options: [[value, label]]
  W.combo = function (options, value, onChange, label) {
    let cur = value;
    const text = h('span.w-combo-text');
    const el = h('button.w-combo', { type: 'button', 'aria-haspopup': 'listbox', 'aria-label': label || null }, text, h('i.w-combo-btn', W.glyph('down', 7, 7)));
    const sync = () => { text.textContent = (options.find((o) => o[0] === cur) || options[0] || ['', ''])[1]; };
    let menu = null;
    el.addEventListener('click', () => {
      if (menu) return void menu.close();
      menu = W.menu(el, options.map(([v, l]) => ({ label: l, checked: v === cur, onSelect: () => { cur = v; sync(); if (onChange) onChange(v); } })), { owner: el, cls: 'w-droplist', onClose: () => { menu = null; el.removeAttribute('aria-expanded'); } });
      el.setAttribute('aria-expanded', 'true');
      menu.el.style.minWidth = el.offsetWidth + 'px';
      // The list opens on the value the field has.
      const at = menu.el.querySelector('[aria-checked="true"]');
      if (at) at.focus({ preventScroll: true });
    });
    el.addEventListener('keydown', (e) => {
      const i = options.findIndex((o) => o[0] === cur);
      const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : -1;
      if (to < 0 || to >= options.length || menu) return;
      e.preventDefault();
      cur = options[to][0];
      sync();
      if (onChange) onChange(cur);
    });
    sync();
    return { el, get value() { return cur; }, set(v) { cur = v; sync(); } };
  };

  W.trackbar = function ({ min = 0, max = 100, step = 1, value = 0, onInput, label }) {
    const input = h('input.w-track', { type: 'range', min, max, step, value, 'aria-label': label || null });
    input.addEventListener('input', () => { if (onInput) onInput(Number(input.value)); });
    return { el: input, set(v) { input.value = v; } };
  };

  W.group = (legend, ...kids) => h('fieldset.w-group', legend ? h('legend', legend) : null, kids);

  // The field code is shown in: Monaco fills `host`, and the frame around it is the bevel.
  W.code = function () {
    const host = h('div.w-code');
    return { host, el: h('div.w-code-frame', host) };
  };

  // tabs: [{ id, label, body }]. One page shows at a time, inside the raised frame under the tabs.
  W.tabs = function (tabs, active, onChange) {
    const strip = h('div.w-tabstrip', { role: 'tablist' });
    const frame = h('div.w-tabpage');
    const el = h('div.w-tabs', strip, frame);
    let cur = null;
    const buttons = new Map();
    function show(id, quiet) {
      const tab = tabs.find((t) => t.id === id) || tabs[0];
      if (!tab) return;
      cur = tab.id;
      for (const [tid, b] of buttons) {
        b.setAttribute('aria-selected', String(tid === cur));
        b.tabIndex = tid === cur ? 0 : -1;
      }
      frame.replaceChildren(tab.body);
      if (!quiet && onChange) onChange(cur);
    }
    for (const t of tabs) {
      const b = h('button.w-tab', { type: 'button', role: 'tab', onclick: () => show(t.id) }, t.label);
      buttons.set(t.id, b);
      strip.append(b);
    }
    strip.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const i = tabs.findIndex((t) => t.id === cur) + (e.key === 'ArrowRight' ? 1 : -1);
      if (!tabs[i]) return;
      e.preventDefault();
      show(tabs[i].id);
      buttons.get(tabs[i].id).focus();
    });
    show(active, true);
    return { el, show: (id) => show(id, true), get value() { return cur; } };
  };

  /* ---------- Navigation and details panes ---------- */

  // The navigation pane: a tree of places, the one this window shows marked.
  // nodes: [{ id, label, icon, onSelect, kids: [node], open (its kids show), gap (space above it) }]
  // → { el, mark(id) }   A node with kids has the triangle that opens and shuts it.
  W.tree = function (nodes, here) {
    const rows = new Map();
    const build = (node, depth) => {
      const kids = node.kids && node.kids.length ? h('div.w-np-kids', { role: 'group', hidden: !node.open }, node.kids.map((k) => build(k, depth + 1))) : null;
      const twist = h('i.w-np-twist' + (kids ? '.has' : '') + (kids && node.open ? '.is-open' : ''));
      const row = h('button.w-np-item' + (node.gap ? '.gap' : ''), { type: 'button', role: 'treeitem', style: { '--depth': depth }, 'aria-expanded': kids ? String(!!node.open) : null },
        twist, W.icon(node.icon, 16), h('span', node.label));
      const toggle = (on) => {
        kids.hidden = !on;
        twist.classList.toggle('is-open', on);
        row.setAttribute('aria-expanded', String(on));
      };
      row.addEventListener('click', (e) => {
        if (kids && twist.contains(e.target)) return void toggle(kids.hidden);
        node.onSelect();
      });
      row.addEventListener('keydown', (e) => {
        if (kids && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); toggle(e.key === 'ArrowRight'); }
      });
      rows.set(node.id, row);
      return kids ? [row, kids] : row;
    };
    const el = h('nav.w-navpane', { role: 'tree', 'aria-label': 'Places' }, nodes.map((n) => build(n, 0)));
    const mark = (id) => { for (const [k, row] of rows) row.classList.toggle('is-here', k === id); };
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const all = [...el.querySelectorAll('.w-np-item')].filter((r) => r.getClientRects().length);
      const next = all[all.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) { e.preventDefault(); next.focus(); }
    });
    mark(here);
    return { el, mark };
  };
  // The details pane along the bottom of such a window: what is chosen, and facts about
  // it. A fact written "Label: value" has its label greyed.
  W.details = function () {
    const el = h('div.w-details');
    return {
      el,
      set(icon, title, ...facts) {
        el.replaceChildren(W.icon(icon, 48), h('div.w-details-text', h('b', title), h('div.w-details-facts', facts.filter(Boolean).map((f) => {
          const at = String(f).indexOf(': ');
          return at > 0 ? h('span', h('i', f.slice(0, at + 2)), f.slice(at + 2)) : h('span', f);
        }))));
      },
    };
  };

  /* ---------- List view (details) ----------
     columns: [{ label, width (a grid track: '1fr', '120px'), cell(item) → text or node,
                 sort(a, b) (clicking the header sorts by it), icon(item) (first column) }]
     o: { empty (what the field says with nothing in it: text or node),
          onOpen(item)  double-click or Enter,
          onPick(item)  the selection changed (null: nothing chosen),
          menu(item) → items for the right-click menu,
          keys: { Delete(item), F2(item) }, sortBy: [column index, 1 | -1], label } */
  W.list = function (columns, o = {}) {
    const BATCH = 200;
    const head = h('div.w-list-head');
    const body = h('div.w-list-body', { role: 'listbox', tabIndex: 0, 'aria-label': o.label || null });
    const el = h('div.w-list', head, body);
    el.style.setProperty('--cols', columns.map((c) => c.width || '1fr').join(' '));
    let items = [], shown = [], picked = null, built = 0;
    let sortBy = o.sortBy ? o.sortBy.slice() : null;
    const rows = new Map(); // item → row
    const end = h('div.w-list-end');
    const watch = new IntersectionObserver((seen) => { if (seen[seen.length - 1].isIntersecting) more(); }, { root: el, rootMargin: '0px 0px 400px 0px' });

    columns.forEach((c, i) => {
      const b = h('button.w-col', { type: 'button', tabIndex: -1, disabled: !c.sort }, h('span', c.label));
      if (c.sort) b.addEventListener('click', () => {
        sortBy = sortBy && sortBy[0] === i ? [i, -sortBy[1]] : [i, 1];
        if (o.onSort) o.onSort(sortBy);
        draw();
      });
      head.append(b);
    });

    function row(item) {
      const r = h('div.w-row', { role: 'option', 'aria-selected': 'false' }, columns.map((c, i) => {
        const v = c.cell(item);
        return h('span.w-cell' + (c.align === 'right' ? '.right' : ''), i === 0 && c.icon ? W.icon(c.icon(item), 16) : null, v instanceof Node ? v : h('span', v == null ? '' : String(v)));
      }));
      r._item = item;
      rows.set(item, r);
      return r;
    }
    function more() {
      const next = shown.slice(built, built + BATCH).map(row);
      built += next.length;
      end.before(...next);
      if (built >= shown.length) { watch.disconnect(); end.remove(); }
      else { watch.unobserve(end); watch.observe(end); }
    }
    function draw() {
      shown = items.slice();
      if (sortBy && columns[sortBy[0]] && columns[sortBy[0]].sort) {
        const fn = columns[sortBy[0]].sort, dir = sortBy[1];
        shown.sort((a, b) => dir * fn(a, b));
      }
      head.querySelectorAll('.w-col').forEach((b, i) => {
        const old = b.querySelector('.w-glyph');
        if (old) old.remove();
        if (sortBy && sortBy[0] === i) b.append(W.glyph(sortBy[1] > 0 ? 'up' : 'down', 7, 7));
      });
      watch.disconnect();
      rows.clear();
      built = 0;
      body.replaceChildren(end);
      if (!shown.length) {
        end.remove();
        if (o.empty) body.append(h('div.w-list-empty', typeof o.empty === 'function' ? o.empty() : o.empty));
      } else more();
      if (picked && !shown.includes(picked)) pick(null);
      else if (picked && rows.has(picked)) rows.get(picked).setAttribute('aria-selected', 'true');
    }
    function pick(item, quiet) {
      if (picked && rows.has(picked)) rows.get(picked).setAttribute('aria-selected', 'false');
      picked = item || null;
      if (picked) {
        // A row further down than has been built is built up to.
        while (!rows.has(picked) && built < shown.length) more();
        const r = rows.get(picked);
        if (r) {
          r.setAttribute('aria-selected', 'true');
          r.scrollIntoView({ block: 'nearest' });
        }
      }
      if (!quiet && o.onPick) o.onPick(picked);
    }
    const itemAt = (target) => {
      const r = target.closest && target.closest('.w-row');
      return r && body.contains(r) ? r._item : null;
    };
    const popup = (item, at) => {
      const list = item && o.menu ? o.menu(item) : null;
      if (list && list.length) W.menu(at, list);
    };

    body.addEventListener('pointerdown', (e) => {
      const item = itemAt(e.target);
      if (e.target.closest('a, button, input')) return;
      if (item !== picked) pick(item);
    });
    body.addEventListener('dblclick', (e) => {
      const item = itemAt(e.target);
      if (item && o.onOpen && !e.target.closest('a, button, input')) o.onOpen(item);
    });
    body.addEventListener('contextmenu', (e) => {
      const item = itemAt(e.target);
      if (!item || !o.menu) return;
      e.preventDefault();
      if (item !== picked) pick(item);
      popup(item, { x: e.clientX, y: e.clientY });
    });
    body.addEventListener('keydown', (e) => {
      if (e.target !== body) return;
      const i = shown.indexOf(picked);
      const to = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? shown.length - 1
        : e.key === 'PageDown' ? i + 10 : e.key === 'PageUp' ? i - 10 : null;
      if (to != null) {
        e.preventDefault();
        if (shown.length) pick(shown[clamp(to, 0, shown.length - 1)]);
      } else if (e.key === 'Enter' && picked && o.onOpen) {
        e.preventDefault();
        o.onOpen(picked);
      } else if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && picked) {
        e.preventDefault();
        const r = rows.get(picked);
        const box = r.getBoundingClientRect();
        popup(picked, { x: box.left + 24, y: box.bottom });
      } else if (picked && o.keys && o.keys[e.key]) {
        e.preventDefault();
        o.keys[e.key](picked);
      }
    });

    return {
      el,
      // same: the item that stands for the one chosen before, when the list was read again
      set(list, same) {
        const was = picked;
        items = list || [];
        picked = was && same ? items.find((x) => same(x, was)) || null : items.includes(was) ? was : null;
        draw();
        if (was && !picked && o.onPick) o.onPick(null);
      },
      get picked() { return picked; },
      pick,
      rowOf: (item) => rows.get(item) || null,
      // The item's row was changed in place.
      redraw(item) {
        const r = rows.get(item);
        if (!r) return;
        const on = r.getAttribute('aria-selected');
        const fresh = row(item);
        fresh.setAttribute('aria-selected', on);
        r.replaceWith(fresh);
      },
      focus() { body.focus({ preventScroll: true }); },
      // What the field says when it is empty, or while something is being read.
      say(node) { items = []; picked = null; watch.disconnect(); rows.clear(); body.replaceChildren(h('div.w-list-empty', node)); },
    };
  };

  /* ---------- Windows ----------
     o: { title, icon, width, height, dialog (no minimise or maximise, not resizable),
          menus: [{ label, items: () => [...] }], toolbar: [nodes], status: false (no status bar) } */

  const wins = [];   // every window on the desktop, lowest first
  const MIN_W = 260, MIN_H = 180;
  const EDGES = [['n', 0, -1], ['s', 0, 1], ['w', -1, 0], ['e', 1, 0], ['nw', -1, -1], ['ne', 1, -1], ['sw', -1, 1], ['se', 1, 1]];
  W.windows = () => wins.slice();
  W.active = () => {
    for (let i = wins.length - 1; i >= 0; i--) if (!wins[i].minimised) return wins[i];
    return null;
  };
  W.onChange = () => {}; // set by the shell: the taskbar follows

  function restack() {
    const top = W.active();
    wins.forEach((w, i) => {
      w.el.style.zIndex = String(10 + i);
      w.el.classList.toggle('is-active', w === top);
      w.el.hidden = !!w.minimised;
    });
    W.onChange();
  }

  W.window = function (o = {}) {
    const titleText = h('span.w-title-text', o.title || '');
    const iconHost = h('span.w-title-icon', W.icon(o.icon || 'app', 16));
    const btn = (name, label, fn) => h('button.w-tb', { type: 'button', tabIndex: -1, 'aria-label': label, title: label, onclick: fn }, caption(name));
    const maxBtn = btn('max', 'Maximize', () => win.maximise(!win.maximised));
    // The caption buttons hang from the top edge as one piece.
    const title = h('div.w-title', iconHost, titleText,
      h('div.w-caption',
        o.dialog ? null : btn('min', 'Minimize', () => win.minimise()),
        o.dialog ? null : maxBtn,
        btn('close', 'Close', () => win.close())));
    const menubar = h('div.w-menubar', { role: 'menubar', hidden: true });
    const toolbar = h('div.w-toolbar', { hidden: true });
    const body = h('div.w-body');
    const notes = h('span.w-status-pane.main');
    const extra = h('span.w-status-pane.extra', { hidden: true });
    // The grip is the status bar's: a window without one is sized by its frame alone.
    const grip = o.dialog || o.status === false ? null : h('i.w-grip');
    const status = o.status === false ? null : h('div.w-status', notes, extra, grip);
    // Where the window is, as a trail of places, with Back and Forward before it and
    // room for a search field after it. It sits on the glass, over what is inside.
    const addr = h('div.w-addr', { hidden: true });
    // Inside the frame: the command bar (the menus, as buttons that drop down, and then
    // what is done most), the content, the status bar.
    const client = h('div.w-client', h('div.w-command', menubar, toolbar), body, status);
    const el = h('section.w-window' + (o.dialog ? '.w-dialog' : ''), { tabIndex: -1, role: o.dialog ? 'dialog' : null, 'aria-label': o.title || null },
      title, addr, client);

    const disposers = [];
    let noteTimer = 0, resting = '', back = null, forward = null, frame = null;
    // The streaks of light on the glass stay where they are on the screen: the frame
    // is told where it is, and shows the part of them it is over (style.css).
    const lit = (x, y) => {
      el.style.setProperty('--wx', Math.round(x) + 'px');
      el.style.setProperty('--wy', Math.round(y) + 'px');
    };
    const litHere = () => {
      if (win.maximised || narrow.matches) return lit(0, 0);
      const host = el.parentNode.getBoundingClientRect();
      lit(host.left + el.offsetLeft, host.top + el.offsetTop);
    };
    const win = {
      el, body,
      path: null,
      trail: null,        // a place's window: the places it has shown, and which it is at
      at: 0,
      minimised: false,
      maximised: false,
      mounted: false,
      onShow: null,       // it has come to the front
      beforeClose: null,  // async () → false keeps it open
      get title() { return titleText.textContent; },
      setTitle(t) {
        titleText.textContent = t;
        el.setAttribute('aria-label', t);
        W.onChange();
      },
      setIcon(name) {
        win.icon = name;
        iconHost.replaceChildren(W.icon(name, 16));
        W.onChange();
      },
      icon: o.icon || 'app',
      // menus: [{ label, items: () => [...] }], read each time one is opened
      setMenus(menus) {
        menubar.hidden = !menus || !menus.length;
        let open = null;
        const buttons = (menus || []).map((m, i) => {
          const b = h('button.w-menubtn', { type: 'button', role: 'menuitem', 'aria-haspopup': 'menu', tabIndex: i ? -1 : 0 }, m.label);
          const drop = () => {
            b.classList.add('is-open');
            open = W.menu(b, m.items(), {
              owner: menubar,
              onClose: () => { b.classList.remove('is-open'); if (open && open.el.isConnected === false) open = null; },
              onSide: (d) => { const n = buttons[(i + d + buttons.length) % buttons.length]; n.focus(); n.click(); },
            });
          };
          b.addEventListener('click', () => {
            if (b.classList.contains('is-open')) return void W.closeMenu();
            drop();
          });
          // With one menu open, pointing at another opens that one.
          b.addEventListener('pointerenter', () => { if (menubar.querySelector('.is-open') && !b.classList.contains('is-open')) drop(); });
          b.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault();
              buttons[(i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length].focus();
            } else if (e.key === 'ArrowDown') { e.preventDefault(); drop(); }
          });
          return b;
        });
        menubar.replaceChildren(...buttons);
      },
      // crumbs: the places down to this one; the first is Home, and goes there.
      setAddress(crumbs, extra) {
        addr.hidden = !crumbs;
        if (!crumbs) return;
        el.classList.add('has-addr');
        const travel = (label, name, step) => h('button', { type: 'button', 'aria-label': label, title: label, disabled: true, onclick: () => NT.nav.travel(win, step) }, W.picture(name, 26));
        back = travel('Back', 'back', -1);
        forward = travel('Forward', 'forward', 1);
        addr.replaceChildren(...[
          h('div.w-travel', back, forward),
          h('div.w-crumbs', W.icon(win.icon, 16), crumbs.map((c, i) => [
            h('i.w-crumb-sep', W.glyph('right', 7, 7)),
            i === 0 && crumbs.length > 1 ? h('button.w-crumb', { type: 'button', onclick: () => NT.nav.travel(win, '/') }, c) : h('span.w-crumb', c),
          ]),
          // Reads the place again.
          h('button.w-refresh', { type: 'button', 'aria-label': 'Refresh', title: 'Refresh', onclick: () => { if (win.onShow) Promise.resolve(win.onShow()).catch((err) => console.error(err)); } }, W.picture('refresh', 16))),
          extra,
        ].filter(Boolean));
        win.syncTravel();
      },
      // Back and Forward can be pressed when there is somewhere to go.
      syncTravel() {
        if (!back) return;
        back.disabled = !(win.at > 0);
        forward.disabled = !(win.trail && win.at < win.trail.length - 1);
      },
      setToolbar(...nodes) {
        const list = nodes.flat().filter(Boolean);
        toolbar.hidden = !list.length;
        toolbar.replaceChildren(...list);
      },
      // What the status bar says at rest.
      setStatus(text) {
        resting = text || '';
        if (!noteTimer && status) notes.textContent = resting;
      },
      setInfo(text) {
        if (!status) return;
        extra.hidden = !text;
        extra.textContent = text || '';
      },
      // … and for a moment, over that (a toast). → false in a window with no status bar.
      note(text, opts = {}) {
        if (!status) return false;
        clearTimeout(noteTimer);
        notes.textContent = text;
        notes.classList.toggle('warn', !!opts.warn);
        noteTimer = setTimeout(() => {
          noteTimer = 0;
          notes.classList.remove('warn');
          notes.textContent = resting;
        }, opts.duration || (opts.warn ? 5000 : 2800));
        return true;
      },
      busy(on) { el.classList.toggle('is-busy', !!on); },
      listen(ev, fn) {
        NT.bus.on(ev, fn);
        disposers.push(() => NT.bus.off(ev, fn));
      },
      onDestroy(fn) { disposers.push(fn); },

      // Opens where another window is, at its size: a place shown in the same frame.
      takeFrame(from) {
        frame = { left: from.el.style.left, top: from.el.style.top, width: from.el.style.width, height: from.el.style.height, max: from.maximised };
      },
      // opts: { swap } it takes another window's place, so it does not fade in
      open(opts = {}) {
        if (win.mounted) return win.front();
        win.mounted = true;
        if (opts.swap) el.classList.add('is-swap');
        place();
        (o.dialog ? W.layers.modal : W.layers.desk).append(el);
        if (!o.dialog) wins.push(win);
        litHere();
        win.syncTravel();
        restack();
        el.focus({ preventScroll: true });
        return win;
      },
      // To the front. → true when it was not there already.
      front() {
        const was = W.active() === win;
        win.minimised = false;
        if (!o.dialog) {
          const i = wins.indexOf(win);
          if (i >= 0) wins.splice(i, 1);
          wins.push(win);
        }
        restack();
        if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
        return !was;
      },
      minimise() {
        win.minimised = true;
        restack();
        if (W.onFront) W.onFront();
      },
      maximise(on) {
        win.maximised = on;
        el.classList.toggle('is-max', on);
        maxBtn.replaceChildren(caption(on ? 'restore' : 'max'));
        maxBtn.title = on ? 'Restore Down' : 'Maximize';
        maxBtn.setAttribute('aria-label', maxBtn.title);
        if (win.mounted) litHere();
      },
      // Asked to close: by its own button, the menu, the keyboard.
      async close() {
        if (win.closing) return false;
        if (win.beforeClose) {
          win.closing = true;
          let ok = false;
          try { ok = (await win.beforeClose()) !== false; } finally { win.closing = false; }
          if (!ok) return false;
        }
        win.destroy();
        return true;
      },
      // opts: { swap } another window is taking its place, so it does not fade out
      destroy(opts = {}) {
        if (!win.mounted) return;
        win.mounted = false;
        clearTimeout(noteTimer);
        disposers.splice(0).forEach((d) => d());
        const i = wins.indexOf(win);
        if (i >= 0) wins.splice(i, 1);
        if (opts.swap || win.minimised || win.maximised || narrow.matches || still.matches) el.remove();
        else {
          // It fades away where it stood, out of reach, while what is under it carries on.
          const r = el.getBoundingClientRect();
          el.inert = true;
          el.classList.remove('is-swap', 'is-max');
          el.classList.add('is-active', 'is-shut');
          Object.assign(el.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', zIndex: '' });
          W.layers.pop.append(el);
          const gone = () => el.remove();
          el.addEventListener('animationend', gone, { once: true });
          setTimeout(gone, 500);
        }
        restack();
        if (win.onClosed) win.onClosed();
        if (W.onFront && !o.dialog) W.onFront();
      },
    };

    // Each new window opens a step down and right of the last, as the desktop does it.
    function place() {
      if (frame) {
        Object.assign(el.style, { left: frame.left, top: frame.top, width: frame.width, height: frame.height });
        if (frame.max !== win.maximised) win.maximise(frame.max);
        return;
      }
      const desk = W.layers.desk.getBoundingClientRect();
      const w = Math.min(o.width || 560, desk.width - 8), ht = Math.min(o.height || 420, desk.height - 8);
      el.style.width = w + 'px';
      el.style.height = o.dialog && !o.height ? '' : ht + 'px';
      if (o.dialog) return; // dialog boxes are centred by their layer
      // Clear of the column of icons down the desktop's left edge, where there is room.
      const n = wins.length % 8;
      el.style.left = Math.round(clamp(100 + n * 26, 0, Math.max(0, desk.width - w))) + 'px';
      el.style.top = Math.round(clamp(14 + n * 26, 0, Math.max(0, desk.height - ht))) + 'px';
    }

    el.addEventListener('pointerdown', () => {
      if (o.dialog || W.active() === win) return;
      win.front();
      if (W.onFront) W.onFront();
    }, true);

    // The glass at the top moves the window; twice on it maximises or restores.
    const grab = (e) => {
      if (e.button || e.target.closest('button, input, .w-crumbs') || win.maximised || narrow.matches) return;
      const r = el.getBoundingClientRect(), host = el.parentNode.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      if (o.dialog) {
        // Taken out of the centring it was placed by.
        el.style.position = 'absolute';
        el.style.left = r.left - host.left + 'px';
        el.style.top = r.top - host.top + 'px';
      }
      const bar = e.currentTarget;
      bar.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const x = Math.round(clamp(ev.clientX - dx - host.left, 60 - r.width, host.width - 60));
        const y = Math.round(clamp(ev.clientY - dy - host.top, 0, host.height - 24));
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        lit(host.left + x, host.top + y);
      };
      const up = () => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
    };
    const flip = (e) => { if (!e.target.closest('button, input, .w-crumbs') && !narrow.matches) win.maximise(!win.maximised); };
    for (const bar of [title, addr]) {
      bar.addEventListener('pointerdown', grab);
      if (!o.dialog) bar.addEventListener('dblclick', flip);
    }

    // Any edge or corner of the frame sizes the window, and so does the grip in the
    // status bar. dx, dy: the edge taken (-1 the left or top one, 1 the right or bottom one).
    const size = (dx, dy) => (e) => {
      if (e.button || win.maximised || narrow.matches) return;
      e.preventDefault();
      const r = el.getBoundingClientRect(), host = el.parentNode.getBoundingClientRect();
      const left = Math.round(r.left - host.left), top = Math.round(r.top - host.top);
      const right = left + Math.round(r.width), bottom = top + Math.round(r.height);
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const mx = Math.round(ev.clientX - e.clientX), my = Math.round(ev.clientY - e.clientY);
        let x = left, y = top, w = right - left, ht = bottom - top;
        if (dx > 0) w = Math.max(MIN_W, w + mx);
        if (dx < 0) { w = Math.max(MIN_W, w - mx); x = right - w; }
        if (dy > 0) ht = Math.max(MIN_H, ht + my);
        // The top edge stops at the top of the desktop: the caption stays in reach.
        if (dy < 0) { ht = clamp(ht - my, MIN_H, bottom); y = bottom - ht; }
        Object.assign(el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: ht + 'px' });
        lit(host.left + x, host.top + y);
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    };
    if (!o.dialog) {
      for (const [name, dx, dy] of EDGES) el.append(h('i.w-size.' + name, { 'aria-hidden': 'true', onpointerdown: size(dx, dy) }));
      if (grip) grip.addEventListener('pointerdown', size(1, 1));
    }

    el.addEventListener('keydown', (e) => {
      // Alt+F4 belongs to the browser's own window; Escape closes a dialog box.
      if (e.key === 'Escape' && o.dialog && !e.defaultPrevented) { e.preventDefault(); win.close(); }
      if (e.key === 'F10' && !e.shiftKey && !menubar.hidden) { e.preventDefault(); menubar.firstChild.focus(); }
      // Alt and an arrow go back and forward in a window that shows a place.
      if (back && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        NT.nav.travel(win, e.key === 'ArrowLeft' ? -1 : 1);
      }
    });

    if (o.menus) win.setMenus(o.menus);
    if (o.toolbar) win.setToolbar(o.toolbar);
    return win;
  };

  /* ---------- Dialog boxes ----------
     A dialog is a window in the layer above the desktop: nothing under it can be used
     until it is closed, and the keyboard stays inside it. */

  let dialogs = 0;
  W.dialog = function (o) {
    const win = W.window(Object.assign({ dialog: true, status: false }, o));
    const back = document.activeElement;
    const open = win.open;
    win.open = () => {
      dialogs++;
      W.layers.modal.hidden = false;
      W.layers.desk.inert = true;
      open();
      const first = win.el.querySelector('.w-body input:not([type=hidden]), .w-body textarea, .w-body .is-default') || win.el.querySelector('.w-body button');
      if (first) first.focus({ preventScroll: true });
      return win;
    };
    win.onClosed = () => {
      dialogs--;
      if (!dialogs) {
        W.layers.modal.hidden = true;
        W.layers.desk.inert = false;
      } else {
        const below = W.layers.modal.lastElementChild;
        if (below) below.focus({ preventScroll: true });
      }
      if (o.onClose) o.onClose();
      if (!dialogs && back && back.isConnected) back.focus({ preventScroll: true });
    };
    // Tab goes round inside the dialog; Enter presses its default button.
    win.el.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        const all = [...win.el.querySelectorAll('button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), textarea, select, [tabindex="0"]')].filter((n) => n.getClientRects().length);
        if (!all.length) return;
        const i = all.indexOf(document.activeElement);
        const to = e.shiftKey ? (i <= 0 ? all.length - 1 : i - 1) : (i === all.length - 1 ? 0 : i + 1);
        e.preventDefault();
        all[to].focus();
      } else if (e.key === 'Enter' && !e.target.closest('textarea, button, .w-list-body')) {
        const def = win.el.querySelector('.is-default:not(:disabled)');
        if (def) { e.preventDefault(); def.click(); }
      }
    });
    return win;
  };

  // A message box. buttons: [{ label, value, primary }] → the value of the one pressed,
  // or null when it was closed any other way.
  W.message = function ({ title, text, detail, icon = 'info', buttons }) {
    return new Promise((resolve) => {
      let result = null;
      const win = W.dialog({ title: title || 'NT Scripting', icon: 'app', width: 340, onClose: () => resolve(result) });
      win.body.append(
        h('div.w-msg', W.icon(icon, 32), h('div.w-msg-text', h('p', text), detail ? h('p', detail) : null)),
        h('div.w-buttons.centre', (buttons || [{ label: 'OK', value: true, primary: true }]).map((b) =>
          W.button(b.label, () => { result = b.value; win.close(); }, { primary: b.primary }))));
      win.open();
    });
  };

  /* ---------- What the core asks for ---------- */

  // A balloon from the notification area: what just happened, for a moment. One at a
  // time; a press on it puts it away.
  let balloon = null;
  W.balloon = function (text, opts = {}) {
    if (balloon) balloon.close(true);
    const el = h('div.w-balloon', { role: 'status' }, W.icon(opts.warn ? 'warning' : 'info', 16), h('span', text));
    let timer = 0;
    const self = {
      close(now) {
        clearTimeout(timer);
        if (balloon === self) balloon = null;
        if (now || still.matches) return void el.remove();
        el.classList.add('is-going');
        el.addEventListener('animationend', () => el.remove(), { once: true });
        setTimeout(() => el.remove(), 600);
      },
    };
    el.addEventListener('click', () => self.close());
    W.layers.pop.append(el);
    // Its tail points at the app's own icon there.
    const tray = W.layers.tray;
    if (tray && tray.getClientRects().length) {
      const t = tray.getBoundingClientRect(), b = el.getBoundingClientRect();
      el.style.setProperty('--tail', Math.max(10, Math.round(b.right - (t.left + t.width / 2) - 6)) + 'px');
    }
    timer = setTimeout(() => self.close(), opts.duration || (opts.warn ? 5000 : 2800));
    balloon = self;
    return self;
  };

  // Said in the status bar of the window in front, for a moment. A window that shows
  // a place has no status bar, and with no window there is none either: then it is a
  // balloon from the notification area.
  UI.toast = function (message, opts = {}) {
    const win = W.active();
    if (win && !W.layers.modal.lastElementChild && win.note(message, opts)) return;
    W.balloon(message, opts);
  };

  UI.confirm = function ({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', destructive = false }) {
    return W.message({
      title: 'NT Scripting',
      text: title,
      detail: message,
      icon: destructive ? 'warning' : 'question',
      buttons: [{ label: confirmLabel, value: true, primary: !destructive }, { label: cancelLabel, value: false, primary: destructive }],
    }).then((v) => v === true);
  };

  // items as every style is given them: { label, icon, checked, danger, disabled, onSelect } | '-'
  UI.menu = function (anchor, items, opts = {}) {
    return W.menu(anchor, items, { align: opts.align === 'center' ? 'center' : undefined });
  };
  UI.signIn = (mode) => UI.authDialog(mode);

  // A dialog with more than one way on. → the value of the one chosen, or null.
  UI.choose = function ({ title, message, options }) {
    return W.message({
      text: title,
      detail: message,
      icon: 'question',
      buttons: options.map((o, i) => ({ label: o.label, value: o.value, primary: i === 0 })).concat([{ label: 'Cancel', value: null }]),
    });
  };

  /* ---------- Sign in / create account ---------- */

  UI.authDialog = function (initial = 'login') {
    const api = NT.api;
    let mode = initial === 'register' ? 'register' : 'login';
    const name = W.field('Display name:', { autocomplete: 'name' });
    const username = W.field('User name:', { autocomplete: 'username' });
    const password = W.field('Password:', { type: 'password', autocomplete: 'current-password' });
    const error = h('p.w-error', { role: 'alert' });
    const submit = W.button('OK', null, { primary: true, submit: true });
    const looking = api.mode === 'demo' && !!api.session;
    const which = W.radios([['login', 'Log In'], ['register', 'Create Account']], mode, (v) => { mode = v; sync(); });
    const win = W.dialog({ title: 'Sign In', icon: 'key', width: 330 });
    const form = h('form.w-form', { novalidate: true },
      h('div.w-msg', W.icon('key', 32), h('div.w-fields', which.el, name.row, username.row, password.row, error)),
      h('div.w-buttons',
        looking ? null : W.button('Just look around', lookAround),
        h('span.w-gap'),
        submit,
        W.button('Cancel', () => win.close())));
    win.body.append(form);

    function sync() {
      name.row.hidden = mode !== 'register';
      password.input.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
      error.textContent = '';
    }
    sync();

    async function lookAround() {
      await api.demoSignIn();
      win.close();
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
        win.close();
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
    win.open();
    (mode === 'register' ? name : username).input.focus({ preventScroll: true });
    return win;
  };

  UI.passwordDialog = function () {
    const api = NT.api;
    const hasPassword = !!api.session.has_password;
    const oldPw = W.field('Current:', { type: 'password', autocomplete: 'current-password' });
    const newPw = W.field('New:', { type: 'password', autocomplete: 'new-password' });
    const confirmPw = W.field('Confirm:', { type: 'password', autocomplete: 'new-password' });
    const error = h('p.w-error', { role: 'alert' });
    const submit = W.button('OK', null, { primary: true, submit: true });
    oldPw.row.hidden = !hasPassword;
    const win = W.dialog({ title: hasPassword ? 'Change Password' : 'Set Password', icon: 'key', width: 310 });
    const form = h('form.w-form', { novalidate: true },
      h('div.w-msg', W.icon('key', 32), h('div.w-fields', oldPw.row, newPw.row, confirmPw.row, error)),
      h('div.w-buttons', h('span.w-gap'), submit, W.button('Cancel', () => win.close())));
    win.body.append(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (hasPassword && !oldPw.input.value) return void (error.textContent = 'Enter your current password.');
      if (newPw.input.value.length < 8) return void (error.textContent = 'New password needs at least 8 characters.');
      if (newPw.input.value !== confirmPw.input.value) return void (error.textContent = 'The new passwords do not match.');
      error.textContent = '';
      submit.disabled = true;
      try {
        await api.changePassword(oldPw.input.value, newPw.input.value);
        win.close();
        NT.bus.emit('session');
        UI.toast('Password changed');
      } catch (err) {
        error.textContent = err.status === 401 ? 'Current password is incorrect.' : 'Could not change the password. Try again.';
        submit.disabled = false;
      }
    });
    win.open();
    return win;
  };

  /* ---------- How the core's own parts are dressed ---------- */

  NT.look = {
    still: true,
    codeFont: 'Consolas, "Lucida Console", "Courier New", monospace',
    codeOptions: {
      smoothScrolling: false,
      cursorBlinking: 'blink',
      cursorSmoothCaretAnimation: 'off',
      roundedSelection: false,
      padding: { top: 2, bottom: 2 },
      lineDecorationsWidth: 6,
      scrollbar: { vertical: 'visible', verticalScrollbarSize: 17, horizontalScrollbarSize: 17, useShadows: false },
    },
    // Monaco's own lists and boxes are the system's: a menu's grey, a list's white, the
    // selection in the highlight colour.
    codeTheme(t, dark) {
      const cs = getComputedStyle(document.documentElement);
      const tok = (name, fallback) => {
        const v = cs.getPropertyValue(name).trim();
        return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
      };
      const face = tok('--face', dark ? '#2d3036' : '#f0f0f0'), text = tok('--text', dark ? '#e9e9ea' : '#000000');
      const sel = tok('--sel', '#3399ff'), field = tok('--window', dark ? '#1c1e23' : '#ffffff');
      Object.assign(t.colors, {
        'editorWidget.background': face,
        'editorWidget.foreground': text,
        'editorWidget.border': '#00000000',
        'editorSuggestWidget.background': field,
        'editorSuggestWidget.foreground': text,
        'editorSuggestWidget.border': '#00000000',
        'editorSuggestWidget.selectedBackground': sel,
        'editorSuggestWidget.selectedForeground': '#ffffff',
        'editorSuggestWidget.highlightForeground': text,
        'editorSuggestWidget.focusHighlightForeground': '#ffffff',
        'editorHoverWidget.background': dark ? '#33363d' : '#ffffff',
        'editorHoverWidget.foreground': tok('--tip-text', dark ? '#e9e9ea' : '#575757'),
        'editorHoverWidget.border': '#00000000',
        'input.background': field,
        'input.foreground': text,
        'input.border': '#00000000',
        'menu.background': face,
        'menu.foreground': text,
        'menu.selectionBackground': sel,
        'menu.selectionForeground': '#ffffff',
        'menu.separatorBackground': tok('--menu-gutter', '#e2e3e3'),
        'list.hoverBackground': '#00000000',
        'list.focusBackground': sel,
        'list.focusForeground': '#ffffff',
        'list.activeSelectionBackground': sel,
        'list.activeSelectionForeground': '#ffffff',
      });
      return t;
    },
    pane(el) { el.classList.add('w-pane'); },
  };

  W.narrow = narrow;
  W.coarse = coarse;
})();
