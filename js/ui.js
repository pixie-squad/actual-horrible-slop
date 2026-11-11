/* Reusable interface pieces: controls, morphing popovers, sheets, toasts and the tab bar. */
(function () {
  'use strict';
  const NT = window.NT;
  const { h, clamp, Spring, motion } = NT.util;
  const icon = NT.icon;
  const UI = (NT.ui = {});

  const overlays = () => NT.dom.overlays;
  const reduced = () => NT.util.reducedMotion();

  /* ---------- Focus ---------- */

  const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

  // Tab stays inside `root` (a menu, a dialog, a sheet), wrapping at either end.
  function keepFocus(e, root) {
    if (e.key !== 'Tab') return;
    const stops = [...root.querySelectorAll(FOCUSABLE)].filter((n) => n.getClientRects().length && !n.closest('[inert]'));
    const cur = document.activeElement;
    const edge = stops[e.shiftKey ? 0 : stops.length - 1];
    if (stops.length && cur !== edge && root.contains(cur)) return;
    e.preventDefault();
    if (stops.length) stops[e.shiftKey ? stops.length - 1 : 0].focus({ preventScroll: true });
  }

  const refocus = (el) => { if (el && el.isConnected) el.focus({ preventScroll: true }); };
  const unfocused = () => !document.activeElement || document.activeElement === document.body;

  // One tab stop for a set of choices; the arrow keys move between them.
  UI.arrows = function (el, items, pick) {
    el.addEventListener('keydown', (e) => {
      const list = items();
      const i = list.indexOf(document.activeElement);
      if (i < 0) return;
      const to = { ArrowLeft: i - 1, ArrowUp: i - 1, ArrowRight: i + 1, ArrowDown: i + 1, Home: 0, End: list.length - 1 }[e.key];
      if (to == null) return;
      e.preventDefault();
      const next = (to + list.length) % list.length;
      pick(next);
      list[next].focus({ preventScroll: true });
    });
  };

  /* ---------- Toast (sits below the top bar, never over its buttons) ---------- */

  let currentToast = null;

  UI.toast = function (message, opts = {}) {
    if (currentToast) currentToast.remove();
    const el = h('div.toast.glass.thick' + (opts.warn ? '.warn' : ''), { role: 'status' },
      icon(opts.icon || (opts.warn ? 'warning' : 'check'), 20), h('span', message));
    currentToast = el;
    NT.dom.toasts.append(el);
    NT.glass.refract(el, { bezel: 18, magnify: 0.008 });
    if (!reduced()) {
      el.animate(
        [{ transform: 'translateY(-16px) scale(0.6)', opacity: 0, filter: 'blur(10px)' }, { transform: 'none', opacity: 1, filter: 'blur(0px)' }],
        { duration: motion.bouncy.duration, easing: motion.bouncy.easing });
    }
    setTimeout(() => {
      if (!el.isConnected) return;
      if (currentToast === el) currentToast = null;
      if (reduced()) return void el.remove();
      const a = el.animate(
        [{ transform: 'none', opacity: 1, filter: 'blur(0px)' }, { transform: 'translateY(-12px) scale(0.7)', opacity: 0, filter: 'blur(8px)' }],
        { duration: 240, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' });
      a.onfinish = () => el.remove();
    }, opts.duration || 2600);
  };

  /* ---------- Morphing popover ----------
     Menus and confirmation dialogs are not new layers that fade in: the control
     that was tapped becomes the popover. The glass keeps one continuous shape,
     growing from the control's exact frame and collapsing back into it. It grows from
     the control's leading or trailing corner; `align: 'center'` grows it about the
     control's centre instead. */

  let activePop = null;
  const leaving = new Set(); // popovers still collapsing: each entry completes one at once

  UI.popover = function (anchor, content, opts = {}) {
    const host = overlays();
    const hr = host.getBoundingClientRect();
    const src = opts.source === null || !anchor
      ? null
      : opts.source || anchor.closest('.nav-group, .nav-btn, .nav-pill') || anchor;

    // The control's frame as drawn right now, or (`atRest`) as it is once it has sprung
    // back from a press: a tapped button is still swollen when its menu opens.
    const geometry = (el, atRest) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      let width = r.width, height = r.height;
      if (atRest && cs.transform && cs.transform !== 'none') {
        const m = new DOMMatrix(cs.transform);
        width /= Math.hypot(m.a, m.b) || 1;
        height /= Math.hypot(m.c, m.d) || 1;
      }
      // A row that fills a rounded list is drawn with that list's corners.
      let radius = parseFloat(cs.borderTopLeftRadius);
      for (let p = el.parentElement; !radius && p; p = p.parentElement) {
        const pr = p.getBoundingClientRect();
        if (Math.abs(pr.width - r.width) > 1 || Math.abs(pr.height - r.height) > 1) break;
        radius = parseFloat(getComputedStyle(p).borderTopLeftRadius);
      }
      radius = radius || 14;
      return {
        left: r.left + (r.width - width) / 2 - hr.left,
        top: r.top + (r.height - height) / 2 - hr.top,
        width,
        height,
        radius: Math.min(radius, width / 2, height / 2),
      };
    };

    // Where focus goes back to when this closes: the control it came from. A dialog that
    // takes over from a menu hands back to the menu's control.
    const opener = (activePop && src && activePop.src === src && activePop.opener)
      || (anchor && anchor.isConnected ? anchor : document.activeElement);

    // A popover that is still collapsing would un-hide its control under this one.
    leaving.forEach((settle) => settle());

    // Taking over from a popover that grew out of the same control (menu → dialog)
    // continues from its current shape instead of starting again.
    let from = null;
    if (activePop) {
      if (src && activePop.src === src) { from = activePop.rect(); activePop.destroy(); }
      else activePop.close(true);
    }

    const home = src && src.isConnected ? geometry(src) : null;
    const seat = home ? geometry(src, true) : null;
    const catcher = h('div.pop-catcher' + (opts.dim ? '.dim' : ''));
    const inner = h('div.pop-inner', content);
    const panel = h('div.pop.glass.thick', { role: opts.role || 'menu', 'aria-label': opts.label || null, 'aria-modal': opts.role === 'alertdialog' ? 'true' : null }, inner);
    // Glass that is dark over artwork (NT.tone) opens into a panel of the same tone, so
    // the control turning into the panel and back never changes colour at the swap.
    if (src && src.dataset.over) panel.dataset.over = src.dataset.over;
    if (opts.width) inner.style.width = Math.min(opts.width, hr.width - 16) + 'px';
    host.append(catcher, panel);

    const fw = inner.offsetWidth, fh = inner.offsetHeight, m = 8;
    let to, ax = 'left', ay = 'top';
    if (home) {
      const right = home.left + home.width / 2 > hr.width / 2 + 1;
      // `align: 'center'`: the control sits on the centre line of what it belongs to, and
      // opens about its own centre (where there is room to).
      const centred = home.left + (home.width - fw) / 2;
      const mid = opts.align === 'center' && centred >= m && centred + fw <= hr.width - m;
      let left = mid ? centred : right ? home.left + home.width - fw : home.left;
      left = clamp(left, m, Math.max(m, hr.width - fw - m));
      let top = home.top;
      if (top + fh > hr.height - m) { top = home.top + home.height - fh; ay = 'bottom'; }
      top = clamp(top, m, Math.max(m, hr.height - fh - m));
      ax = mid ? 'center' : right ? 'right' : 'left';
      to = { left, top, width: fw, height: fh };
    } else {
      to = { left: (hr.width - fw) / 2, top: (hr.height - fh) / 2, width: fw, height: fh };
    }
    to.radius = Math.min(opts.radius || 28, fh / 2);
    const start = from || home || { left: to.left + fw / 2 - 30, top: to.top + fh / 2 - 30, width: 60, height: 60, radius: 30 };

    // What is inside the panel is pinned to the part of it that does not move: the corner
    // it grows from, or its centre line.
    const pinned = (width) => (ax === 'center' ? `left:calc(50% - ${width / 2}px)` : `${ax}:0`) + `;${ay}:0;transform-origin:${ax} ${ay}`;
    inner.style.cssText += ';' + pinned(fw);

    // A copy of the control's own content, so it visibly turns into the popover and back.
    // It is laid out at the control's resting size, pinned to the corner the panel grows
    // from: that is exactly where the real content sits once the panel has collapsed.
    let ghost = null;
    if (home) {
      ghost = src.cloneNode(true);
      ghost.removeAttribute('id');
      ghost.classList.remove('glass', 'thick', 'interactive', 'tinted');
      ghost.classList.add('pop-ghost');
      ghost.style.cssText = `width:${seat.width}px;height:${seat.height}px;${pinned(seat.width)}`;
      if (from) ghost.style.opacity = '0'; // only needed on the way back
      ghost.inert = true;
      ghost.setAttribute('aria-hidden', 'true');
      panel.append(ghost);
    }

    const frame = (g) => ({ left: g.left + 'px', top: g.top + 'px', width: g.width + 'px', height: g.height + 'px', borderRadius: g.radius + 'px' });
    Object.assign(panel.style, frame(to));
    // Marked for as long as its popover is about, so a control that is only shown at
    // times (a row's menu button) is there to open from and to collapse back into.
    if (src) src.classList.add('pop-source');
    if (src) src.style.visibility = 'hidden';
    // No colour split here: the panel changes size on every frame of its morph, and the
    // three-pass filter cannot keep up with that. Its thick fill would hide the fringe anyway.
    NT.glass.refract(panel, { bezel: 18, magnify: 0.008, dispersion: 0 });

    let anims = [];
    if (!reduced()) {
      const sp = motion.smooth;
      anims = [
        panel.animate([frame(start), frame(to)], { duration: sp.duration, easing: sp.easing }),
        inner.animate([{ opacity: 0, transform: 'scale(0.7)', filter: 'blur(8px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }],
          { duration: sp.duration * 0.75, easing: sp.easing }),
      ];
      if (ghost && !from) {
        // Starts as large as the pressed control was drawn, so nothing jumps on the first frame.
        const swell = `${(home.width / seat.width).toFixed(4)} ${(home.height / seat.height).toFixed(4)}`;
        anims.push(ghost.animate([{ opacity: 1, scale: swell }, { opacity: 0, scale: '1 1' }], { duration: 150, easing: 'ease-out', fill: 'forwards' }));
      }
      if (opts.dim) catcher.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
    } else if (ghost) ghost.style.opacity = '0';

    let done = false;
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        pop.close();
      } else if (e.key === 'Tab') {
        keepFocus(e, panel);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const list = [...panel.querySelectorAll('.menu-item:not(:disabled)')];
        if (!list.length) return;
        e.preventDefault();
        const i = list.indexOf(document.activeElement);
        list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].focus();
      }
    }

    const pop = {
      src,
      panel,
      opener,
      rect() {
        const r = panel.getBoundingClientRect();
        return { left: r.left - hr.left, top: r.top - hr.top, width: r.width, height: r.height, radius: parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 0 };
      },
      // Remove without animating or releasing the source (a successor takes over).
      destroy() {
        if (done) return;
        done = true;
        if (activePop === pop) activePop = null;
        document.removeEventListener('keydown', onKey, true);
        panel.remove();
        catcher.remove();
        if (src) src.classList.remove('pop-source');
      },
      close(instant) {
        if (done) return;
        done = true;
        if (activePop === pop) activePop = null;
        document.removeEventListener('keydown', onKey, true);
        if (opts.onDismiss) opts.onDismiss();
        // Focus returns to the control once it is back, unless what was chosen has
        // already sent it somewhere else. A closing panel takes no more keys.
        const restore = unfocused() || panel.contains(document.activeElement);
        panel.inert = true;
        let handover = [];
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          leaving.delete(finish);
          panel.remove();
          catcher.remove();
          if (src) src.style.visibility = '';
          if (src) src.classList.remove('pop-source');
          handover.forEach((a) => a.cancel());
          if (restore && unfocused()) refocus(opener);
          NT.tone.touch();
        };
        if (instant || reduced()) return void finish();

        const cur = pop.rect();
        anims.forEach((a) => a.cancel());
        catcher.style.pointerEvents = 'none';
        panel.style.pointerEvents = 'none'; // the control coming back underneath takes the taps
        const back = src && src.isConnected;
        const target = back
          ? geometry(src, true)
          : { left: cur.left + (ax === 'right' ? cur.width : ax === 'center' ? cur.width / 2 : 0), top: cur.top + (ay === 'bottom' ? cur.height : 0), width: 0, height: 0, radius: 0 };
        const sp = motion.snappy;
        inner.animate([{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(6px)' }], { duration: 130, easing: 'ease-out', fill: 'forwards' });
        if (ghost) ghost.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 170, delay: sp.duration * 0.3, easing: 'ease-out', fill: 'both' });
        if (opts.dim) catcher.animate([{ opacity: 1 }, { opacity: 0 }], { duration: sp.duration, fill: 'forwards' });
        const a = panel.animate([frame(cur), frame(target)], { duration: sp.duration, easing: sp.easing, fill: 'forwards' });
        if (back) {
          // The panel is thick glass with its own light; the control is not. Swapping one
          // for the other on the last frame shows as a jump, however well the frames line
          // up. So once the shape has all but arrived (the spring covers ~90% of the way
          // in the first 40% of its time) the real control comes back underneath and the
          // panel's material clears away over it. Removing the panel then changes nothing.
          const at = sp.duration * 0.4, span = sp.duration - at;
          handover = [
            src.animate([{ visibility: 'visible', opacity: 0 }, { visibility: 'visible' }], { delay: at, duration: span * 0.4, easing: 'ease-out', fill: 'forwards' }),
            panel.animate([{ opacity: 1 }, { opacity: 0 }], { delay: at, duration: span, easing: 'ease-in-out', fill: 'forwards' }),
          ];
        }
        leaving.add(finish);
        a.onfinish = finish;
      },
    };

    catcher.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      // The press that dismisses is spent. A finger's tap is aimed again once it lifts,
      // and would otherwise land on whatever the popover was covering.
      const spent = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      document.addEventListener('click', spent, { capture: true, once: true });
      document.addEventListener('pointerdown', () => document.removeEventListener('click', spent, true), { capture: true, once: true });
      pop.close();
    });
    document.addEventListener('keydown', onKey, true);
    activePop = pop;
    return pop;
  };

  /* ---------- Menu ---------- */

  UI.menu = function (anchor, items, opts = {}) {
    const list = h('div.menu-list');
    const hasChecks = items.some((it) => it && it !== '-' && it.checked != null);
    for (const it of items) {
      if (!it) continue;
      if (it === '-') { list.append(h('div.menu-sep', { role: 'separator' })); continue; }
      list.append(h('button.menu-item' + (it.danger ? '.danger' : ''), {
        type: 'button',
        role: it.checked != null ? 'menuitemradio' : 'menuitem',
        'aria-checked': it.checked != null ? String(!!it.checked) : null,
        disabled: !!it.disabled,
        onclick: () => {
          const self = activePop;
          try { if (it.onSelect) it.onSelect(); }
          finally { if (self && activePop === self) self.close(); }
        },
      },
        hasChecks ? h('i.menu-check', it.checked ? icon('check', 17) : null) : null,
        it.icon ? icon(it.icon, 20) : null,
        h('span', it.label)));
    }
    const pop = UI.popover(anchor, list, { role: 'menu', source: opts.source, align: opts.align });
    const first = list.querySelector('.menu-item:not(:disabled)');
    if (first) first.focus({ preventScroll: true });
    return pop;
  };

  /* ---------- Confirmation dialog (grows out of `source`, about its centre, when one is given) ---------- */

  UI.confirm = function ({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', destructive = false, source }) {
    return new Promise((resolve) => {
      let result = false;
      let pop = null;
      const ok = h('button.btn.block.filled' + (destructive ? '.danger' : ''), { type: 'button', onclick: () => { result = true; pop.close(); } }, confirmLabel);
      const cancel = h('button.btn.block.gray', { type: 'button', onclick: () => pop.close() }, cancelLabel);
      const body = h('div.dialog', h('h2', title), message ? h('p', message) : null, h('div.dialog-actions', ok, cancel));
      const anchored = source && source.isConnected;
      pop = UI.popover(anchored ? source : null, body, {
        role: 'alertdialog',
        label: title,
        dim: true,
        width: 290,
        radius: 34,
        align: 'center',
        source: anchored ? undefined : null,
        onDismiss: () => resolve(result),
      });
      cancel.focus({ preventScroll: true });
    });
  };

  /* ---------- Sheet (inset from the screen edges; drag down to dismiss) ---------- */

  UI.sheet = function ({ title, body, onClose }) {
    const wide = () => window.matchMedia('(min-width: 820px)').matches;
    const dim = h('div.sheet-dim');
    const closeBtn = h('button.sheet-close.glass.interactive', { type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('xmark', 16));
    const header = h('header.sheet-header', h('h2', title), closeBtn);
    const bodyEl = h('div.sheet-body', body);
    const panel = h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div.sheet-glass.glass'), h('div.sheet-grabber'), header, bodyEl);
    const layer = h('div.sheet-layer', dim, panel);
    const returnFocus = document.activeElement;
    overlays().append(layer);
    // A sheet is modal: everything else is out of reach until it closes. Only what this
    // sheet put out of reach is given back, so one opened over another nests.
    const held = [...NT.dom.app.children, ...overlays().children]
      .filter((n) => n !== overlays() && n !== NT.dom.toasts && n !== layer && !n.inert);
    held.forEach((n) => { n.inert = true; });
    NT.glass.refract(panel.firstElementChild, { frost: [4, 12], bezel: 22, magnify: 0, dispersion: 0 });
    NT.glass.shine(closeBtn);

    let closed = false;
    if (!reduced()) {
      panel.animate(wide()
        ? [{ transform: 'scale(0.86)' }, { transform: 'none' }]
        : [{ transform: 'translateY(calc(100% + 24px))' }, { transform: 'none' }],
      { duration: motion.smooth.duration, easing: motion.smooth.easing });
      if (wide()) for (const part of panel.children) part.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
      dim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
    }

    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      const inside = unfocused() || layer.contains(document.activeElement);
      layer.inert = true;
      held.forEach((n) => { n.inert = false; });
      if (inside) refocus(returnFocus);
      NT.tone.touch();
      const done = () => {
        layer.remove();
        if (onClose) onClose();
      };
      if (reduced()) return void done();
      const from = getComputedStyle(panel).transform;
      const sp = motion.snappy;
      panel.animate(wide()
        ? [{ transform: 'none' }, { transform: 'scale(0.88)' }]
        : [{ transform: from === 'none' ? 'none' : from }, { transform: 'translateY(calc(100% + 24px))' }],
      { duration: sp.duration, easing: sp.easing, fill: 'forwards' });
      if (wide()) for (const part of panel.children) part.animate([{ opacity: 1 }, { opacity: 0 }], { duration: sp.duration * 0.8, fill: 'forwards' });
      const a = dim.animate([{ opacity: getComputedStyle(dim).opacity }, { opacity: 0 }], { duration: sp.duration, fill: 'forwards' });
      a.onfinish = done;
    }

    function onKey(e) {
      if (activePop) return; // a menu opened from the sheet handles its own keys
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else keepFocus(e, panel);
    }
    document.addEventListener('keydown', onKey, true);
    dim.addEventListener('click', close);

    // Drag the header to pull the sheet down; past a threshold it dismisses.
    let drag = null;
    const follow = new Spring({ stiffness: 420, damping: 36, onUpdate: (y) => { panel.style.transform = y ? `translateY(${y}px)` : ''; } });
    header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || wide()) return;
      drag = { y: e.clientY, last: e.clientY, t: e.timeStamp, v: 0 };
      header.setPointerCapture(e.pointerId);
    });
    header.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = e.clientY - drag.y;
      drag.v = (e.clientY - drag.last) / Math.max(1, e.timeStamp - drag.t);
      drag.last = e.clientY;
      drag.t = e.timeStamp;
      follow.jump(dy > 0 ? dy : -Math.pow(-dy, 0.7)); // rubber-band when pulled upward
      dim.style.opacity = String(clamp(1 - dy / 500, 0.3, 1));
    });
    const release = () => {
      if (!drag) return;
      const dy = follow.value, v = drag.v;
      drag = null;
      if (dy > 120 || v > 0.6) close();
      else { follow.set(0); dim.style.opacity = ''; }
    };
    header.addEventListener('pointerup', release);
    header.addEventListener('pointercancel', release);

    const focusTarget = bodyEl.querySelector('input, textarea');
    if (focusTarget && window.matchMedia('(hover: hover)').matches) setTimeout(() => focusTarget.focus({ preventScroll: true }), 60);
    else closeBtn.focus({ preventScroll: true });

    return { close, panel, body: bodyEl };
  };

  /* ---------- Switch ---------- */

  const KNOB_LENS = NT.glass.drop({ bezel: 12, magnify: 0.04 });

  UI.toggle = function (checked, onChange, label) {
    const knob = h('span.switch-knob');
    const el = h('button.switch', { type: 'button', role: 'switch', 'aria-checked': String(!!checked), 'aria-label': label }, knob);
    let on = !!checked;
    let drag = null;
    const set = (v, fire) => {
      if (v === on) return;
      on = v;
      el.setAttribute('aria-checked', String(on));
      if (fire && onChange) onChange(on);
    };
    el.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, moved: false, start: on };
      el.setPointerCapture(e.pointerId);
      NT.glass.refract(knob, KNOB_LENS);
      el.classList.add('is-pressed');
      knob.classList.add('lens-held');
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 8) drag.moved = true;
      if (drag.moved) set(drag.start ? dx > -8 : dx > 8, true);
    });
    const end = (e) => {
      el.classList.remove('is-pressed');
      knob.classList.remove('lens-held');
      if (drag && !drag.moved && e.type === 'pointerup') set(!on, true);
      drag = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    // Keyboard and assistive tech activate through click with no pointer detail.
    el.addEventListener('click', (e) => { if (e.detail === 0) set(!on, true); });
    return { el, set: (v) => set(!!v, false), get value() { return on; } };
  };

  /* ---------- Slider ---------- */

  UI.slider = function ({ min = 0, max = 100, step = 1, value = 0, onInput, label }) {
    const thumb = h('div.slider-thumb');
    const el = h('div.slider', { role: 'slider', tabIndex: 0, 'aria-label': label, 'aria-valuemin': min, 'aria-valuemax': max },
      h('div.slider-track', h('div.slider-fill')), thumb);
    let v = value;
    const paint = () => {
      el.style.setProperty('--p', max > min ? ((v - min) / (max - min)).toFixed(4) : '0');
      el.setAttribute('aria-valuenow', v);
    };
    const commit = (nv, fire) => {
      nv = clamp(+(Math.round(nv / step) * step).toFixed(6), min, max);
      if (nv === v) return;
      v = nv;
      paint();
      if (fire && onInput) onInput(v);
    };
    const fromX = (x) => {
      const r = el.getBoundingClientRect();
      commit(min + clamp((x - r.left - 19) / (r.width - 38), 0, 1) * (max - min), true);
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      el.setPointerCapture(e.pointerId);
      NT.glass.refract(thumb, KNOB_LENS);
      el.classList.add('is-pressed');
      thumb.classList.add('lens-held');
      fromX(e.clientX);
    });
    el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) fromX(e.clientX); });
    const end = () => { el.classList.remove('is-pressed'); thumb.classList.remove('lens-held'); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    // The slider is not selectable (see .slider). If it were, a press would start a text
    // selection and the next press would drag that selection away, cancelling the gesture.
    el.addEventListener('dragstart', (e) => e.preventDefault());
    el.addEventListener('keydown', (e) => {
      const big = Math.max(step, (max - min) / 10);
      const map = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step, PageDown: -big, PageUp: big };
      if (e.key in map) { e.preventDefault(); commit(v + map[e.key], true); }
      else if (e.key === 'Home') { e.preventDefault(); commit(min, true); }
      else if (e.key === 'End') { e.preventDefault(); commit(max, true); }
    });
    paint();
    return { el, set: (nv) => commit(nv, false), get value() { return v; } };
  };

  /* ---------- Segmented control ----------
     Tap a segment, or press and drag: the thumb lifts into a glass lens,
     follows the finger and settles on the nearest segment. */

  UI.segmented = function (options, value, onChange) {
    const thumb = h('span.seg-thumb');
    const el = h('div.seg', { role: 'tablist' }, thumb);
    el.style.setProperty('--n', options.length);
    const buttons = options.map((o) => h('button.seg-item', { type: 'button', role: 'tab' }, o.label));
    el.append(...buttons);

    let index = Math.max(0, options.findIndex((o) => o.value === value));
    let drag = null;
    const cell = () => Math.max(0, (el.clientWidth - 6) / options.length);
    const paint = () => {
      const stretch = clamp(Math.abs(pos.velocity) / 2200, 0, 0.26);
      const l = lift.value;
      thumb.style.transform = `translateX(${pos.value.toFixed(2)}px) scale(${((1 + stretch) * (1 + l * 0.06)).toFixed(4)}, ${((1 - stretch * 0.4) * (1 + l * 0.3)).toFixed(4)})`;
      if (drag) mark(nearest());
    };
    const pos = new Spring({ stiffness: 340, damping: 27, onUpdate: paint });
    const lift = new Spring({ stiffness: 380, damping: 24, precision: 0.002, onUpdate: paint });
    const nearest = () => clamp(Math.round(pos.value / (cell() || 1)), 0, options.length - 1);
    const mark = (i) => buttons.forEach((b, j) => b.setAttribute('aria-selected', String(j === i)));
    // The control is one tab stop, on the chosen segment; arrow keys move the choice.
    const rove = () => buttons.forEach((b, j) => { b.tabIndex = j === index ? 0 : -1; });
    const place = (instant) => {
      const x = index * cell();
      if (instant) pos.jump(x);
      else pos.set(x);
    };
    function select(i, fire) {
      const changed = i !== index;
      index = i;
      value = options[i].value;
      mark(i);
      rove();
      place(false);
      if (fire && changed) onChange(value);
    }

    const follow = (clientX) => {
      const r = el.getBoundingClientRect();
      pos.set(clamp(clientX - r.left - 3 - cell() / 2, 0, (options.length - 1) * cell()));
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      drag = { x: e.clientX };
      el.setPointerCapture(e.pointerId);
      NT.glass.refract(thumb, NT.glass.drop({ bezel: 16, magnify: 0.04 }));
      el.classList.add('is-lifting');
      thumb.classList.add('lens-held');
      lift.set(1);
      follow(e.clientX);
    });
    el.addEventListener('pointermove', (e) => { if (drag) follow(e.clientX); });
    const release = (e) => {
      if (!drag) return;
      drag = null;
      el.classList.remove('is-lifting');
      thumb.classList.remove('lens-held');
      lift.set(0);
      if (e.type === 'pointerup') {
        const r = el.getBoundingClientRect();
        select(clamp(Math.floor((e.clientX - r.left - 3) / (cell() || 1)), 0, options.length - 1), true);
      } else select(index, false);
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release); // never leave the thumb lifted
    buttons.forEach((b, i) => b.addEventListener('click', (e) => { if (e.detail === 0) select(i, true); }));
    UI.arrows(el, () => buttons, (i) => select(i, true));

    if (window.ResizeObserver) new ResizeObserver(() => { if (!drag) place(true); }).observe(el);
    mark(index);
    rove();
    place(true);
    return {
      el,
      set(v) {
        const i = options.findIndex((o) => o.value === v);
        if (i >= 0) select(i, false);
      },
      get value() { return value; },
    };
  };

  /* ---------- Form fields ---------- */

  UI.field = function (label, attrs = {}) {
    const id = 'f-' + NT.util.uid(6);
    const input = h('input', Object.assign({ id, type: 'text', autocapitalize: 'off', spellcheck: false }, attrs));
    return { row: h('div.row.field', h('label', { for: id }, label), input), input };
  };

  /* ---------- Sign in / create account ---------- */

  UI.authSheet = function (initial = 'login') {
    const api = NT.api;
    let mode = initial === 'register' ? 'register' : 'login';
    const name = UI.field('Display Name', { autocomplete: 'name', placeholder: 'Required', enterKeyHint: 'next' });
    const username = UI.field('Username', { autocomplete: 'username', placeholder: 'Required', enterKeyHint: 'next' });
    const password = UI.field('Password', { type: 'password', autocomplete: 'current-password', placeholder: 'Required', enterKeyHint: 'done' });
    const error = h('p.form-error', { role: 'alert' });
    const submit = h('button.btn.filled.block', { type: 'submit' }, 'Log In');
    const seg = UI.segmented([{ value: 'login', label: 'Log In' }, { value: 'register', label: 'Create Account' }], mode, (v) => { mode = v; sync(); });
    // The sample data is a quiet way past the form, not a second way to sign in.
    const looking = api.mode === 'demo' && !!api.session;
    const form = h('form.form-stack', { novalidate: true },
      seg.el,
      h('div.list', name.row, username.row, password.row),
      error,
      submit,
      looking ? null : h('button.text-btn', { type: 'button', onclick: lookAround }, 'Just look around'));

    function sync() {
      name.row.hidden = mode !== 'register';
      submit.textContent = mode === 'register' ? 'Create Account' : 'Log In';
      password.input.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
      error.textContent = '';
    }
    sync();

    const sheet = UI.sheet({ title: 'Sign In', body: form });

    async function lookAround() {
      await api.demoSignIn();
      sheet.close();
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
        sheet.close();
        NT.nav.reset();
        UI.toast('Signed in as ' + (api.session.name || api.session.username), { icon: 'person' });
      } catch (err) {
        if (err.message === 'live-unavailable') error.textContent = 'Start the app with “node server.js” to sign in.';
        else if (err.status === 401) error.textContent = 'Wrong username or password.';
        else if (err.status === 409) error.textContent = 'That username is taken.';
        else error.textContent = 'Could not sign in. Try again.';
      } finally {
        submit.disabled = false;
      }
    });
    return sheet;
  };

  UI.passwordSheet = function () {
    const api = NT.api;
    const hasPassword = !!api.session.has_password;
    const oldPw = UI.field('Current', { type: 'password', autocomplete: 'current-password', placeholder: 'Required' });
    const newPw = UI.field('New', { type: 'password', autocomplete: 'new-password', placeholder: '8 or more characters' });
    const confirmPw = UI.field('Confirm', { type: 'password', autocomplete: 'new-password', placeholder: 'Repeat' });
    const error = h('p.form-error', { role: 'alert' });
    const submit = h('button.btn.filled.block', { type: 'submit' }, 'Save');
    oldPw.row.hidden = !hasPassword;
    const form = h('form.form-stack', { novalidate: true }, h('div.list', oldPw.row, newPw.row, confirmPw.row), error, submit);
    const sheet = UI.sheet({ title: hasPassword ? 'Change Password' : 'Set Password', body: form });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (hasPassword && !oldPw.input.value) return void (error.textContent = 'Enter your current password.');
      if (newPw.input.value.length < 8) return void (error.textContent = 'New password needs at least 8 characters.');
      if (newPw.input.value !== confirmPw.input.value) return void (error.textContent = 'The new passwords do not match.');
      error.textContent = '';
      submit.disabled = true;
      try {
        await api.changePassword(oldPw.input.value, newPw.input.value);
        sheet.close();
        NT.bus.emit('session');
        UI.toast('Password changed');
      } catch (err) {
        error.textContent = err.status === 401 ? 'Current password is incorrect.' : 'Could not change the password. Try again.';
        submit.disabled = false;
      }
    });
    return sheet;
  };

  /* ---------- Tab bar ---------- */

  const TABS = [
    { id: 'home', path: '/', label: 'Home', icon: 'home' },
    { id: 'scripts', path: '/scripts', label: 'Scripts', icon: 'code' },
    { id: 'maps', path: '/maps', label: 'Maps', icon: 'map' },
    { id: 'profile', path: '/profile', label: 'Profile', icon: 'person' },
  ];

  NT.tabbar = (function () {
    const phone = window.matchMedia('(max-width: 819.98px)');
    let el, capsule, lens, input, searchEl, searchBtn, accessoryHost;
    let active = 'home', minimized = false, searching = false, drag = null, currentAccessory = null;
    const tabEls = {};

    const lift = new Spring({ stiffness: 380, damping: 24, precision: 0.002, onUpdate: () => paintLens() });
    const pos = new Spring({ stiffness: 320, damping: 26, onUpdate: () => paintLens() });

    function paintLens() {
      const stretch = clamp(Math.abs(pos.velocity) / 2400, 0, 0.3);
      const l = lift.value;
      lens.style.transform = `translateX(${pos.value.toFixed(2)}px) scale(${((1 + stretch) * (1 + l * 0.14)).toFixed(4)}, ${((1 - stretch * 0.4) * (1 + l * 0.24)).toFixed(4)})`;
      if (drag) markUnderLens();
    }

    function markUnderLens() {
      const center = pos.value + lens.offsetWidth / 2;
      let best = active, dist = Infinity;
      for (const t of TABS) {
        const b = tabEls[t.id];
        const d = Math.abs(b.offsetLeft + b.offsetWidth / 2 - center);
        if (d < dist) { dist = d; best = t.id; }
      }
      for (const t of TABS) tabEls[t.id].classList.toggle('is-active', t.id === best);
      return best;
    }

    function layoutLens(instant) {
      const b = tabEls[active];
      if (!b || !b.offsetWidth) return;
      lens.style.width = b.offsetWidth + 'px';
      if (instant) pos.jump(b.offsetLeft);
      else pos.set(b.offsetLeft);
    }

    function setActive(id) {
      active = id;
      for (const t of TABS) {
        const on = t.id === id;
        tabEls[t.id].classList.toggle('is-active', on);
        tabEls[t.id].setAttribute('aria-selected', String(on));
      }
      layoutLens(false);
    }

    function choose(id) {
      const tab = TABS.find((t) => t.id === id);
      if (tab) NT.nav.go(tab.path);
    }

    function setMinimized(v) {
      v = !!v && phone.matches && !searching;
      if (v === minimized) return;
      minimized = v;
      NT.dom.app.classList.toggle('tab-min', v);
      if (!v) setTimeout(() => layoutLens(true), motion.smooth.duration * 0.7);
    }

    function openSearch() {
      if (searching) return void input.focus({ preventScroll: true });
      searching = true;
      minimized = false;
      NT.dom.app.classList.remove('tab-min');
      NT.dom.app.classList.add('tab-search');
      if (NT.nav.paths().join() !== '/scripts') NT.nav.go('/scripts');
      // While open the field is the capsule's tab stop; closed, its button is.
      input.tabIndex = 0;
      searchBtn.tabIndex = -1;
      input.focus({ preventScroll: true });
    }

    function closeSearch() {
      if (!searching) return;
      searching = false;
      NT.dom.app.classList.remove('tab-search');
      const inside = searchEl.contains(document.activeElement);
      input.value = '';
      input.tabIndex = -1;
      searchBtn.tabIndex = 0;
      input.blur();
      if (inside && window.matchMedia('(hover: hover)').matches) searchBtn.focus({ preventScroll: true });
      NT.bus.emit('search', '');
      setTimeout(() => layoutLens(true), motion.smooth.duration * 0.7);
    }

    function build() {
      lens = h('div.tab-lens');
      const sheetOfGlass = h('div.tabbar-glass.glass');
      capsule = h('div.tabbar-capsule', { role: 'tablist', 'aria-label': 'Sections' }, sheetOfGlass, lens);
      for (const t of TABS) {
        const b = h('button.tab', { type: 'button', role: 'tab', 'aria-selected': 'false', dataset: { tab: t.id } }, icon(t.icon, 24), h('span', t.label));
        // Pointer input is handled on the capsule; this covers keyboard and assistive tech.
        b.addEventListener('click', (e) => { if (e.detail === 0) choose(t.id); });
        tabEls[t.id] = b;
        capsule.append(b);
      }

      input = h('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search scripts', enterKeyHint: 'search', autocomplete: 'off', spellcheck: false });
      searchBtn = h('button.tabbar-search-btn', { type: 'button', 'aria-label': 'Search', onclick: openSearch }, icon('search', 24));
      const clearBtn = h('button.tabbar-search-clear', { type: 'button', 'aria-label': 'Close search', onclick: (e) => { e.stopPropagation(); closeSearch(); } }, icon('xmark', 18));
      searchEl = h('div.tabbar-search.glass.interactive', { onclick: (e) => { if (!searching && !e.target.closest('button')) openSearch(); } }, searchBtn, input, clearBtn);
      input.addEventListener('input', () => NT.bus.emit('search', input.value));
      input.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearch(); });
      input.tabIndex = -1;
      // "/" or Ctrl/Cmd+K opens search from anywhere the tab bar is showing.
      document.addEventListener('keydown', (e) => {
        const slash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey;
        const k = (e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
        if (!slash && !k) return;
        const t = e.target && e.target.closest ? e.target : null;
        if (t && t.closest(slash ? 'input, textarea, select, [contenteditable], .monaco-editor' : '.monaco-editor')) return;
        if (NT.dom.overlays.childElementCount || NT.dom.app.classList.contains('tab-hidden')) return;
        e.preventDefault();
        openSearch();
      });

      el = h('nav.tabbar', { 'aria-label': 'Primary' }, capsule, searchEl);
      accessoryHost = h('div.accessory');

      // Press and drag the lens between tabs; it stretches with speed and lifts into clear glass.
      capsule.addEventListener('pointerdown', (e) => {
        if (e.button > 0) return;
        if (minimized) { setMinimized(false); return; }
        if (searching && phone.matches) { closeSearch(); return; }
        drag = { x: e.clientX, moved: false };
        capsule.setPointerCapture(e.pointerId);
        capsule.classList.add('is-lifting');
        lift.set(1);
        follow(e.clientX);
      });
      capsule.addEventListener('pointermove', (e) => {
        if (!drag) return;
        if (Math.abs(e.clientX - drag.x) > 3) drag.moved = true;
        follow(e.clientX);
      });
      const release = (e) => {
        if (!drag) return;
        const target = e.type === 'pointerup' ? tabAt(e.clientX) : active;
        drag = null;
        capsule.classList.remove('is-lifting');
        lift.set(0);
        if (target === active) setActive(active);
        else choose(target);
      };
      capsule.addEventListener('pointerup', release);
      capsule.addEventListener('pointercancel', release);

      if (window.ResizeObserver) new ResizeObserver(() => { if (!drag) layoutLens(true); }).observe(capsule);
      // The tabs can still be easing into their widths after the capsule has stopped
      // changing size; place the lens once more when they have arrived.
      capsule.addEventListener('transitionend', (e) => { if (e.propertyName === 'flex-grow' && !drag) layoutLens(true); });
      phone.addEventListener('change', () => { setMinimized(false); layoutLens(true); NT.tone.touch(); });

      NT.glass.refract(sheetOfGlass);
      NT.glass.refract(searchEl);
      NT.glass.refract(lens, NT.glass.drop({ bezel: 24, magnify: 0.05 }));
      return { el, accessoryHost };
    }

    function follow(clientX) {
      const r = capsule.getBoundingClientRect();
      const w = lens.offsetWidth;
      pos.set(clamp(clientX - r.left - w / 2, 4, r.width - w - 4));
    }

    function tabAt(clientX) {
      const x = clientX - capsule.getBoundingClientRect().left;
      let best = active, dist = Infinity;
      for (const t of TABS) {
        const b = tabEls[t.id];
        const d = Math.abs(b.offsetLeft + b.offsetWidth / 2 - x);
        if (d < dist) { dist = d; best = t.id; }
      }
      return best;
    }

    // Scrolling down recedes the bar so content gets the space; scrolling up brings it back.
    function onScroll(y, lastY, scroller) {
      if (!phone.matches || searching) return;
      const top = NT.nav.top();
      if (!top || top.page.scroll !== scroller) return;
      const max = scroller.scrollHeight - scroller.clientHeight;
      if (y > lastY + 4 && y > 72 && y < max - 4) setMinimized(true);
      else if (y < lastY - 4 || y < 24) setMinimized(false);
    }

    function setAccessory(node) {
      if (node === currentAccessory) return;
      const old = currentAccessory;
      currentAccessory = node || null;
      if (old) {
        if (reduced()) old.remove();
        else old.animate([{ opacity: 1, transform: 'none', filter: 'blur(0px)' }, { opacity: 0, transform: 'scale(0.8)', filter: 'blur(8px)' }], { duration: 200, easing: 'ease-in', fill: 'forwards' }).onfinish = () => old.remove();
      }
      if (node) {
        accessoryHost.append(node);
        NT.glass.refract(node);
        if (!reduced()) {
          node.animate([{ opacity: 0, transform: 'translateY(20px) scale(0.8)', filter: 'blur(8px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }],
            { duration: motion.bouncy.duration, easing: motion.bouncy.easing });
        }
      }
    }

    return {
      build, setActive, setMinimized, setAccessory, onScroll, closeSearch,
      get searching() { return searching; },
      get query() { return input ? input.value : ''; },
      relayout: () => layoutLens(true),
      tabs: TABS,
      // On wide screens the bar floats at the top, over content (see NT.tone).
      get wide() { return !phone.matches; },
      chrome: () => (capsule ? [capsule, searchEl] : []),
    };
  })();
})();
