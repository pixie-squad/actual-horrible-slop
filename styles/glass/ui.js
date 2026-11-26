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

  /*
    There is one toast: a piece of glass that materializes where it is and goes the same
    way (NT.liquid). Whatever is said while it is there is said by that glass.

      the same words again   it swells for a moment, as glass does when pressed, and stays
                             its time over again; nothing is redrawn
      other words            the glass takes them, closing in or opening out around them
      while it is going      it turns back from where it had got to, with the new words

    opts.action: { label, onSelect }, a text button at the toast's trailing end, as iOS
    puts Undo in a banner: no shape of its own inside the glass, the label in the accent,
    dimming while held. Choosing it puts the toast away.
  */
  let toast = null;

  // A length as layout has it. A computed style's text is rounded to a thousandth; a
  // box set that much too narrow would wrap its last word.
  const laid = (el) => {
    const cs = getComputedStyle(el);
    return { w: Math.ceil(parseFloat(cs.width) * 64) / 64, h: Math.ceil(parseFloat(cs.height) * 64) / 64 };
  };

  function newToast() {
    const el = h('div.toast.glass.thick', { role: 'status' });
    const t = { el, timer: 0, sig: '', act: null, words: null, leaving: false, motion: null, morph: null };

    // The words, the first time: the glass materializes around them.
    t.arrive = (words) => {
      t.words = words;
      el.append(words);
      NT.dom.toasts.append(el);
      NT.glass.refract(el, { bezel: 18, magnify: 0.008 });
      const m = (t.motion = NT.liquid.materialize(el, true, { content: [words], grow: 0.62, timing: motion.bouncy }));
      m.finished.then(() => { if (t.motion === m) t.motion = null; });
    };

    // New words in place of the old. Each is laid out at its own size about the middle
    // of the glass, which changes shape around them: nothing in either is laid out
    // again on the way, so no line breaks and joins as the glass passes its width.
    // The old words go first, from however much of them was showing (words that had not
    // come in yet never do), and the new come in as the glass reaches their size.
    t.swap = (words) => {
      const old = t.words;
      t.words = words;
      if (reduced() || !old || !old.isConnected) return void el.replaceChildren(words);
      const seen = parseFloat(getComputedStyle(old).opacity);
      const was = laid(old), from = laid(el);
      if (t.morph) t.morph.cancel();
      old.classList.add('toast-was');
      old.inert = true;
      old.setAttribute('aria-hidden', 'true');
      old.style.cssText = `width:${was.w}px;height:${was.h}px;left:calc(50% - ${was.w / 2}px);top:calc(50% - ${was.h / 2}px)`;
      el.prepend(words);
      const to = laid(el);
      // Held at the size they will have, whatever the glass is on the way there.
      words.style.width = to.w + 'px';
      words.style.maxWidth = 'none';
      const sp = NT.liquid.exact(motion.smooth);
      const a = (t.morph = el.animate([{ width: from.w + 'px', height: from.h + 'px' }, { width: to.w + 'px', height: to.h + 'px' }], { duration: sp.duration, easing: sp.easing }));
      a.onfinish = () => {
        if (t.morph !== a) return;
        t.morph = null;
        words.style.width = words.style.maxWidth = '';
      };
      for (const fade of old.getAnimations()) fade.cancel();
      old.animate([{ opacity: seen }, { opacity: 0 }], { duration: sp.duration * 0.2, fill: 'forwards' }).onfinish = () => old.remove();
      words.animate([{ opacity: 0 }, { opacity: 1 }], { duration: sp.duration * 0.4, delay: sp.duration * 0.2, easing: 'ease-out', fill: 'backwards' });
    };

    // Said again: the glass answers, and nothing on it changes.
    t.nudge = () => {
      if (reduced() || t.motion) return;
      el.animate([{ scale: '1', easing: 'ease-out' }, { scale: '1.045', offset: 0.18, easing: motion.bouncy.easing }, { scale: '1' }], { duration: motion.bouncy.duration * 1.2 });
    };

    t.away = () => {
      if (t.leaving || !el.isConnected) return;
      t.leaving = true;
      clearTimeout(t.timer);
      el.removeAttribute('role');
      if (t.motion) t.motion.cancel();
      const m = (t.motion = NT.liquid.materialize(el, false, { content: [t.words], grow: 0.62 }));
      m.finished.then(() => {
        if (t.motion !== m) return; // it turned back
        el.remove();
        if (toast === t) toast = null;
      });
    };

    // Wanted again while going: back from where it has got to, glass and size alike.
    t.back = (words) => {
      const k = NT.glass.state(el).k;
      const size = parseFloat(getComputedStyle(el).scale) || 1;
      const m = t.motion;
      t.motion = null;
      t.leaving = false;
      el.setAttribute('role', 'status');
      const sp = NT.liquid.exact(motion.smooth);
      const timing = { duration: sp.duration, easing: sp.easing };
      NT.glass.animate(el, [{ k }, { k: 1 }], timing);
      el.animate([{ scale: String(size) }, { scale: '1' }], timing);
      // The words are taken over as they are, before the way out is let go of.
      t.swap(words);
      if (m) m.cancel();
    };
    return t;
  }

  UI.toast = function (message, opts = {}) {
    const act = opts.action || null;
    const sig = JSON.stringify([message, opts.icon || '', !!opts.warn, act ? act.label : '']);
    let t = toast && toast.el.isConnected ? toast : null;
    const fresh = !t;
    if (fresh) t = toast = newToast();
    clearTimeout(t.timer);
    const words = () => h('div.toast-words' + (opts.warn ? '.warn' : '') + (act ? '.has-action' : ''),
      icon(opts.icon || (opts.warn ? 'warning' : 'check'), 20),
      h('span', message),
      act ? h('button.toast-action', { type: 'button', onclick: () => {
        const chosen = t.act;
        if (t.leaving || !chosen) return;
        t.away();
        chosen.onSelect();
      } }, act.label) : null);
    const same = !fresh && !t.leaving && t.sig === sig;
    // The action is the latest one's, the same words or not (the last thing deleted).
    t.act = act;
    t.sig = sig;
    t.el.classList.toggle('has-action', !!act);
    if (fresh) t.arrive(words());
    else if (t.leaving) t.back(words());
    else if (same) t.nudge();
    else t.swap(words());
    t.timer = setTimeout(t.away, opts.duration || (act ? 6000 : 2600));
  };

  /* ---------- Morphing popover ----------
     Menus and confirmation dialogs are not new layers that fade in: the control
     that was tapped becomes the popover. The glass keeps one continuous shape,
     growing from the control's exact frame and collapsing back into it, and its
     material goes with its size: it starts as the control's own glass and thickens as
     it grows, and thins back on the way home (glass.css, --lg-t). It grows from the
     control's leading or trailing corner; `align: 'center'` grows it about the
     control's centre instead. */

  let activePop = null;
  const leaving = new Set(); // popovers still collapsing: each entry completes one at once
  let goingPop = null; // the one most lately on its way back, until it is there

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
      let width = r.width, height = r.height, dx = 0, dy = 0;
      if (atRest) {
        // A press swells it (transform, scale) and a finger pulls it (translate).
        if (cs.transform && cs.transform !== 'none') {
          const m = new DOMMatrix(cs.transform);
          width /= Math.hypot(m.a, m.b) || 1;
          height /= Math.hypot(m.c, m.d) || 1;
        }
        if (cs.scale && cs.scale !== 'none') {
          const [sx, sy = sx] = cs.scale.split(' ').map(parseFloat);
          width /= sx || 1;
          height /= sy || 1;
        }
        if (cs.translate && cs.translate !== 'none') [dx = 0, dy = 0] = cs.translate.split(' ').map(parseFloat);
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
        left: r.left + (r.width - width) / 2 - hr.left - dx,
        top: r.top + (r.height - height) / 2 - hr.top - dy,
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
    // What grows is the control as it is drawn at this moment; the press it was in is over.
    if (home) NT.liquid.still(src);
    const seat = home ? geometry(src, true) : null;
    // Glass that becomes the panel lends it its own glass, so the panel starts as exactly
    // that control and thickens as it grows. Anything else (a row, a symbol in a card)
    // is not glass: the panel materializes out of it instead.
    const srcOpts = home && src.classList.contains('glass') ? NT.glass.optsOf(src) : null;
    const glassy = !!srcOpts;
    const srcT = glassy ? NT.glass.state(src).t : 0; // a thick badge is thick already
    const catcher = h('div.pop-catcher' + (opts.dim ? '.dim' : ''));
    const inner = h('div.pop-inner', content);
    // What is in the panel is clipped to its shape by a layer of its own: a clip on the
    // panel itself would trim the outer edge of its rim light, which the control's has.
    const clip = h('div.pop-clip', inner);
    const panel = h('div.pop.glass.thick', { role: opts.role || 'menu', 'aria-label': opts.label || null, 'aria-modal': opts.role === 'alertdialog' ? 'true' : null }, clip);
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
    // It is a copy of the control as it is when the copy is made: on the way back that is
    // the control as it is by then (a value picked from the menu is the new one).
    const ghostOf = (at) => {
      // Its colours are the control's own, not those of a control marked as away.
      const marked = src.classList.contains('pop-source');
      src.classList.remove('pop-source');
      const g = src.cloneNode(true);
      g.removeAttribute('id');
      g.classList.remove('glass', 'thick', 'interactive', 'tinted', 'pop-source', 'is-flexing', 'is-lit', 'is-near');
      g.classList.add('pop-ghost');
      g.style.cssText = `width:${at.width}px;height:${at.height}px;${pinned(at.width)}`;
      g.inert = true;
      g.setAttribute('aria-hidden', 'true');
      NT.liquid.typeOf(src, g);
      if (marked) src.classList.add('pop-source');
      clip.append(g);
      return g;
    };
    let ghost = null;
    if (home) {
      ghost = ghostOf(seat);
      if (from) ghost.style.opacity = '0'; // only needed on the way back
    }

    const frame = (g) => ({ left: g.left + 'px', top: g.top + 'px', width: g.width + 'px', height: g.height + 'px', borderRadius: g.radius + 'px' });
    Object.assign(panel.style, frame(to));
    // Marked for as long as its popover is about, so a control that is only shown at
    // times (a row's menu button) is there to open from and to collapse back into.
    if (src) src.classList.add('pop-source');
    if (src) src.style.visibility = 'hidden';
    // Thick glass splits no colour and magnifies less; the control's glass may do both, so
    // the panel does as the control does at its size and less as it thickens. Where it no
    // longer splits colour at all the lens drops to one pass, which keeps a growing panel
    // within its frames (glass.js).
    NT.glass.refract(panel, glassy
      ? Object.assign(srcOpts, { lens: true, bezel: 18, magnifyThick: 0.008, dispersionThick: 0 })
      : { bezel: 18, magnify: 0.008, dispersion: 0 });
    // Exactly the control's lens on the first frame; its own once it is nearly grown.
    if (glassy && !from) NT.glass.lensFrom(panel, src, true);

    let anims = [];
    if (!reduced()) {
      const sp = NT.liquid.exact(motion.smooth);
      const timing = { duration: sp.duration, easing: sp.easing };
      anims = [
        panel.animate([frame(start), frame(to)], timing),
        inner.animate([{ opacity: 0, transform: 'scale(0.7)' }, { opacity: 1, transform: 'none' }], { duration: sp.duration * 0.75, easing: sp.easing }),
      ];
      if (glassy && !from) NT.glass.lensTo(panel, { w: fw, h: fh, r: to.radius }, anims[0], sp.duration * 0.3);
      // A control's glass thickens into the panel's as it grows; anything else, and a
      // dialog with no control to come from, materializes as it grows.
      if (!from) anims.push(NT.glass.animate(panel, glassy ? [{ t: srcT }, { t: 1 }] : [{ k: 0 }, { k: 1 }], timing));
      if (ghost && !from) {
        // Starts as large as the pressed control was drawn (the panel starts where it was
        // drawn, pulled by the finger), so nothing jumps on the first frame.
        const swell = `${(home.width / seat.width).toFixed(4)} ${(home.height / seat.height).toFixed(4)}`;
        anims.push(ghost.animate([{ opacity: 1, scale: swell }, { opacity: 0, scale: '1 1' }], { duration: 150, easing: 'ease-out', fill: 'forwards' }));
      }
      if (opts.dim) catcher.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
    } else {
      if (ghost) ghost.style.opacity = '0';
      if (glassy && !from) NT.glass.lensTo(panel, { w: fw, h: fh, r: to.radius }, null, 0);
    }

    let done = false;
    let kept = false; // its control has been taken over with it (handOver)
    let settle = null; // on its way back: ends that at once
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
      // A sheet takes this panel's place, wherever it has got to: open, or on its way
      // back into its control. → what the sheet goes on from. The panel is gone at
      // once and its control stays away: it is the sheet's now (UI.sheet).
      handOver() {
        const open = !done;
        const state = NT.glass.state(panel);
        const cs = getComputedStyle(panel);
        const token = (name) => cs.getPropertyValue(name).trim();
        const given = {
          open, src, opener, panel, rect: pop.rect(), k: state.k, t: state.t,
          // What is in it, where it is, to go as the sheet comes (an open one only).
          rest: open ? inner : null,
          look: { fill: token('--glass-thick'), blur: token('--glass-blur-thick'), y: token('--shadow-y'), spread: token('--shadow-blur') },
        };
        kept = true;
        if (open) {
          if (opts.onDismiss) opts.onDismiss();
          pop.destroy();
        } else if (settle) settle();
        return given;
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
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          leaving.delete(finish);
          if (goingPop === pop) goingPop = null;
          panel.remove();
          catcher.remove();
          if (src) src.classList.remove('pop-source');
          if (kept) return; // a sheet has taken its place, and its control
          if (src) src.style.visibility = '';
          if (restore && unfocused()) refocus(opener);
          NT.tone.touch();
        };
        settle = finish;
        if (instant || reduced()) return void finish();

        const cur = pop.rect();
        const was = NT.glass.state(panel);
        anims.forEach((a) => a.cancel());
        catcher.style.pointerEvents = 'none';
        panel.style.pointerEvents = 'none'; // the control coming back underneath takes the taps
        const back = src && src.isConnected;
        const target = back
          ? geometry(src, true)
          : { left: cur.left + (ax === 'right' ? cur.width : ax === 'center' ? cur.width / 2 : 0), top: cur.top + (ay === 'bottom' ? cur.height : 0), width: 0, height: 0, radius: 0 };
        // It lands exactly on the control, so the swap is not even a fraction of a pixel.
        const sp = NT.liquid.exact(motion.snappy);
        const timing = { duration: sp.duration, easing: sp.easing, fill: 'forwards' };
        inner.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 130, easing: 'ease-out', fill: 'forwards' });
        // What it turns back into is the control as it is now, at the size it has now.
        if (back && ghost) {
          ghost.remove();
          ghost = ghostOf(target);
        }
        if (ghost) ghost.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 170, delay: sp.duration * 0.3, easing: 'ease-out', fill: 'both' });
        if (opts.dim) catcher.animate([{ opacity: 1 }, { opacity: 0 }], { duration: sp.duration, fill: 'forwards' });
        const a = panel.animate([frame(cur), frame(target)], timing);
        if (back && glassy) {
          // The panel takes the control's own lens back and thins to its glass on the way,
          // so its last frame is the control, light and all: the swap then shows nothing,
          // and nothing has to fade to hide it.
          NT.glass.lensFrom(panel, src, true);
          NT.glass.animate(panel, [{ k: was.k, t: was.t }, { k: 1, t: srcT }], timing);
        } else {
          // Into something that is not glass, or into nothing: the glass goes as it shrinks,
          // and leaves the copy of the control where the control is. The control itself is
          // not shown under it meanwhile: two of the same thing, each part there, are a
          // smear, and with a value just picked they do not even say the same.
          NT.glass.animate(panel, [{ k: was.k, t: was.t }, { k: 0, t: was.t }], timing);
        }
        leaving.add(finish);
        goingPop = pop;
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

  // The control a sheet comes from when none is named: the one that has focus, which a
  // press gives a button. (A menu's item is not it: a sheet chosen from a menu takes the
  // menu's place, and its control with it. See UI.sheet.)
  function sourceOf(el) {
    const b = el && el !== document.body && el.closest ? el.closest('button, a[href], [role="button"]') : null;
    if (!b || b.closest('.pop')) return null;
    // A button in a capsule of glass: it is the capsule that becomes the sheet.
    const piece = b.closest('.nav-group, .nav-btn, .nav-pill') || b;
    const r = piece.getBoundingClientRect();
    return r.width && r.height ? piece : null;
  }

  UI.sheet = function ({ title, body, onClose, source }) {
    const wide = () => window.matchMedia('(min-width: 820px)').matches;
    const dim = h('div.sheet-dim');
    const closeBtn = h('button.sheet-close.glass.interactive', { type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('xmark', 16));
    const header = h('header.sheet-header', h('h2', title), closeBtn);
    const bodyEl = h('div.sheet-body', body);
    const sheetGlass = h('div.sheet-glass.glass');
    const content = h('div.sheet-content', h('div.sheet-grabber'), header, bodyEl);
    const panel = h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, sheetGlass, content);
    const layer = h('div.sheet-layer', dim, panel);
    // Chosen from a menu, the sheet is what the menu becomes. The menu does not go back
    // into its button first, only for the sheet to come out of the same button, and the
    // button is not there under the sheet for the sheet to go back into: the button
    // became the menu, the menu becomes the sheet, and the sheet goes back into the
    // button. A menu already on its way back is taken over from where it has got to.
    // (A control that was pressed for the sheet is its source as ever, whatever menu
    // happens to be going away elsewhere at that moment.)
    const pressed = source === undefined ? sourceOf(document.activeElement) : null;
    const menu = source === undefined && !pressed ? activePop || goingPop : null;
    const from = menu ? menu.handOver() : null;
    const returnFocus = from ? from.opener : document.activeElement;
    const src = from ? (from.src && from.src.isConnected ? from.src : null) : source !== undefined ? source : pressed;
    overlays().append(layer);
    // A sheet is modal: everything else is out of reach until it closes. Only what this
    // sheet put out of reach is given back, so one opened over another nests.
    const held = [...NT.dom.app.children, ...overlays().children]
      .filter((n) => n !== overlays() && n !== NT.dom.toasts && n !== layer && !n.inert);
    held.forEach((n) => { n.inert = true; });
    // Grown out of glass, it starts as that glass and thickens into a sheet on the way.
    const srcOpts = src && src.classList.contains('glass') ? NT.glass.optsOf(src) : null;
    // (Its rim is as wide as the menu's where it came out of one, so the first frame bends
    // what the menu bent.)
    const bezel = from ? 18 : 22;
    const own = srcOpts
      ? Object.assign(srcOpts, { lens: true, bezel, frostThick: [4, 12], magnifyThick: 0, dispersionThick: 0 })
      : { frost: [4, 12], bezel, magnify: 0, dispersion: 0 };
    // Out of an open menu its thin end is the menu's glass, not a control's: the menu's
    // fill, frost and shadow, which it leaves for a sheet's as it grows. Once it is a
    // sheet these make no difference, and its thin end is its control's again, for the
    // way back (tuned).
    const asMenu = !!from && from.open && !reduced();
    NT.glass.refract(sheetGlass, asMenu
      ? { lens: true, bezel, magnify: 0.008, magnifyThick: 0, dispersion: 0, frostThin: [3, 8], frostThick: [4, 12] }
      : own);
    const LOOK = { '--glass-fill': (l) => l.fill, '--glass-veil': () => 'transparent', '--glass-blur': (l) => l.blur, '--shadow-y': (l) => `calc(${l.y} + 4px)`, '--shadow-blur': (l) => `calc(${l.spread} + 8px)` };
    let menuLook = asMenu;
    if (asMenu) for (const name of Object.keys(LOOK)) sheetGlass.style.setProperty(name, LOOK[name](from.look));
    const tuned = () => {
      if (!menuLook) return;
      menuLook = false;
      for (const name of Object.keys(LOOK)) sheetGlass.style.removeProperty(name);
      NT.glass.retune(sheetGlass, own);
    };
    NT.glass.shine(closeBtn);

    // The control's frame at rest, and the sheet's own, in the layer's coordinates.
    const frameOf = (el, radius) => {
      const r = el.getBoundingClientRect(), lr = layer.getBoundingClientRect();
      const rad = radius != null ? radius : Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 14, r.width / 2, r.height / 2);
      return { left: r.left - lr.left, top: r.top - lr.top, width: r.width, height: r.height, radius: rad };
    };
    const css = (g) => ({ left: g.left + 'px', top: g.top + 'px', width: g.width + 'px', height: g.height + 'px', borderRadius: g.radius + 'px' });
    // The content sits in the middle of the box, and on whole pixels once the box is the
    // sheet, so nothing shifts when the sheet goes back to its own layout.
    const pin = (g, size) => ({ left: (g.width - size.width) / 2 + 'px', top: (g.height - size.height) / 2 + 'px' });
    // While it changes shape it is a box of its own, its content held at the size it has
    // at rest and clipped by it, so nothing inside reflows on the way.
    const morphing = (at, size) => {
      panel.classList.add('is-morphing');
      Object.assign(panel.style, css(at));
      content.style.width = size.width + 'px';
      content.style.height = size.height + 'px';
    };
    const settled = () => {
      panel.classList.remove('is-morphing');
      for (const p of ['left', 'top', 'width', 'height', 'borderRadius']) panel.style[p] = '';
      content.style.width = content.style.height = '';
    };
    const showing = () => src && src.isConnected && src.getClientRects().length > 0;
    // A copy of the control's own content, held in the middle of the box: what the box
    // is while it is still the control (as a popover's is, UI.popover).
    const ghostOf = (seat) => {
      const g = src.cloneNode(true);
      g.removeAttribute('id');
      g.classList.remove('glass', 'thick', 'interactive', 'tinted');
      g.classList.add('pop-ghost');
      g.style.cssText = `left:0;top:0;width:${seat.width}px;height:${seat.height}px`;
      g.inert = true;
      g.setAttribute('aria-hidden', 'true');
      NT.liquid.typeOf(src, g);
      panel.append(g);
      return g;
    };
    const clipOf = (g, size) => `inset(${(size.height - g.height) / 2}px ${(size.width - g.width) / 2}px round ${g.radius}px)`;
    // A control that is not glass has a fill of its own (a filled button). The box is
    // that fill while it is the control, as it is the control's glass where the control
    // is glass: without it the control would be its words alone until the swap.
    const fillOf = () => {
      if (srcOpts) return null;
      const cs = getComputedStyle(src);
      if (cs.backgroundImage === 'none' && /^(transparent|rgba\(0, 0, 0, 0\))$/.test(cs.backgroundColor)) return null;
      const f = h('div.sheet-fill', { 'aria-hidden': 'true' });
      f.style.backgroundColor = cs.backgroundColor;
      f.style.backgroundImage = cs.backgroundImage;
      sheetGlass.after(f);
      return f;
    };

    let closed = false;
    // The control it came out of is away for as long as the sheet is there.
    if (src && (from || showing())) src.style.visibility = 'hidden';
    if (!reduced()) {
      const sp = NT.liquid.exact(motion.smooth);
      const timing = { duration: sp.duration, easing: sp.easing };
      if (from || showing()) {
        // It grows out of the control that brought it up, or out of that control's menu
        // from where the menu is.
        if (!from) NT.liquid.still(src);
        const start = from ? from.rect : frameOf(src);
        const end = frameOf(panel, 38);
        morphing(end, end);
        // Exactly the glass it grows out of on the first frame: its lens too.
        const lensed = from ? NT.glass.lensFrom(sheetGlass, from.panel, true) : !!srcOpts && NT.glass.lensFrom(sheetGlass, src, true);
        const grow = panel.animate([css(start), css(end)], timing);
        if (lensed) NT.glass.lensTo(sheetGlass, { w: end.width, h: end.height, r: 38 }, grow, sp.duration * 0.3);
        content.animate([pin(start, end), pin(end, end)], timing);
        // Clipped to the growing box until it has all but arrived; then not at all, so the
        // last frame is drawn exactly as the sheet at rest is.
        content.animate([{ clipPath: clipOf(start, end) }, { clipPath: clipOf(end, end), offset: 0.985 }, { clipPath: 'none', offset: 0.99 }, { clipPath: 'none' }], timing);
        NT.glass.animate(sheetGlass,
          asMenu ? [{ k: from.k, t: 0 }, { k: 1, t: 1 }]
            : from ? [{ k: from.k, t: srcOpts ? from.t : 1 }, { k: 1, t: 1 }]
              : srcOpts ? [{ t: 0 }, { t: 1 }] : [{ k: 0 }, { k: 1 }], timing);
        content.animate([{ opacity: 0, transform: 'scale(0.92)' }, { opacity: 1, transform: 'none' }], { duration: sp.duration * 0.6, delay: sp.duration * 0.12, easing: 'ease-out', fill: 'backwards' });
        if (from && from.rest) {
          // What the menu said goes with the glass, held to the corner it was held to in
          // the menu and cut by the glass's shape, as the sheet's own comes.
          const rest = h('div.pop-rest', { 'aria-hidden': 'true' }, from.rest);
          rest.inert = true;
          if (from.panel.dataset.over) rest.dataset.over = from.panel.dataset.over;
          panel.append(rest);
          rest.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 130, easing: 'ease-out', fill: 'forwards' }).onfinish = () => rest.remove();
        } else if (!from) {
          const seat = { width: start.width, height: start.height };
          const ghost = ghostOf(seat);
          ghost.animate([pin(start, seat), pin(end, seat)], timing);
          ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'ease-out', fill: 'forwards' }).onfinish = () => ghost.remove();
          const fill = fillOf();
          if (fill) fill.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'ease-out', fill: 'forwards' }).onfinish = () => fill.remove();
        }
        grow.onfinish = () => {
          if (closed) return;
          settled();
          tuned();
        };
      } else if (wide()) {
        // From nowhere in particular, it materializes where it will be.
        panel.animate([{ scale: '0.92' }, { scale: '1' }], timing);
        NT.glass.animate(sheetGlass, [{ k: 0 }, { k: 1 }], timing);
        content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: sp.duration * 0.5, delay: sp.duration * 0.12, easing: 'ease-out', fill: 'backwards' });
      } else {
        // A sheet of its own rises from the bottom edge, as on iOS.
        panel.animate([{ transform: 'translateY(calc(100% + 24px))' }, { transform: 'none' }], timing);
      }
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
        if (src) src.style.visibility = '';
        if (onClose) onClose();
      };
      if (reduced()) return void done();
      const sp = NT.liquid.exact(motion.snappy);
      const timing = { duration: sp.duration, easing: sp.easing, fill: 'forwards' };
      tuned();
      const was = NT.glass.state(sheetGlass);
      // Where it is now, dragged or still growing.
      const cur = frameOf(panel, parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 38);
      const size = { width: content.offsetWidth, height: content.offsetHeight };
      for (const a of panel.getAnimations()) a.cancel();
      panel.style.transform = '';
      content.getAnimations().forEach((a) => a.cancel());
      content.animate([{ opacity: 1 }, { opacity: 0 }], { duration: sp.duration * 0.4, easing: 'ease-in', fill: 'forwards' });
      dim.animate([{ opacity: getComputedStyle(dim).opacity }, { opacity: 0 }], { duration: sp.duration, fill: 'forwards' });
      let a;
      if (showing()) {
        // Back into the control it came from, thinning to its glass, so the last frame
        // is the control and the swap shows nothing.
        const end = frameOf(src);
        src.style.visibility = 'hidden';
        morphing(cur, size);
        a = panel.animate([css(cur), css(end)], timing);
        content.animate([Object.assign(pin(cur, size), { clipPath: clipOf(cur, size) }), Object.assign(pin(end, size), { clipPath: clipOf(end, size) })], timing);
        const seat = { width: end.width, height: end.height };
        const ghost = ghostOf(seat);
        ghost.animate([pin(cur, seat), pin(end, seat)], timing);
        const landing = { duration: sp.duration * 0.35, delay: sp.duration * 0.3, easing: 'ease-out', fill: 'both' };
        ghost.animate([{ opacity: 0 }, { opacity: 1 }], landing);
        // One still fading from the way out (closed at once) is not a second one.
        panel.querySelectorAll('.sheet-fill').forEach((f) => f.remove());
        const fill = fillOf();
        if (fill) fill.animate([{ opacity: 0 }, { opacity: 1 }], landing);
        if (srcOpts) {
          NT.glass.lensFrom(sheetGlass, src, true);
          NT.glass.animate(sheetGlass, [{ k: was.k, t: was.t }, { k: 1, t: 0 }], timing);
        } else NT.glass.animate(sheetGlass, [{ k: was.k }, { k: 0 }], timing);
      } else if (wide()) {
        a = panel.animate([{ scale: '1' }, { scale: '0.92' }], timing);
        NT.glass.animate(sheetGlass, [{ k: was.k }, { k: 0 }], timing);
      } else {
        a = panel.animate([{ transform: `translateY(${cur.top - frameOf(panel).top}px)` }, { transform: 'translateY(calc(100% + 24px))' }], timing);
      }
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

  // A knob held is a drop on its track, as iOS draws it: a flat face that shows the
  // track as it is, no larger, and a thin rim, steepest at its very edge, whose outer
  // line looks in almost to the middle and the rest of it about halfway. So a line of
  // the track runs round its edge, and at its ends the track's fill wells up round the
  // rim, split into a cyan fringe (red reaches further than blue). Its map is drawn at
  // 2×: a rim this sharp shows the steps of a 1× one. No dark band inside the rim, its
  // light from below (the lower rim is the bright one), and hazy while it is still
  // lifting out of its face, clearing as it arrives.
  const KNOB_LENS = NT.glass.drop({ bevel: 0.125, bezel: 4, bend: 3.5, tilt: 80, curve: 0.6, crisp: true, magnify: 0, dispersion: -0.25, saturate: 1.15, light: 90, bounce: 0.1, rim: 0.05, shade: 0, haze: 3.5 });

  // A knob that lifts into glass while held (glass.css, .lens): its lift is its presence
  // as glass. Its filter is there for as long as it is lifted at all or its spring is
  // still moving: a spring swings through nothing on its way to rest, and the filter
  // does not come and go with every swing.
  function lifted(knob, spring) {
    const v = clamp(spring.value, 0, 1);
    NT.glass.set(knob, { k: v });
    knob.classList.toggle('lens-on', v > 0.002 || spring.target > 0 || spring.velocity !== 0);
    return v;
  }

  // A knob that marks one of several labels is two layers that move as one: its face,
  // under the labels, which clears as the knob lifts, and its glass, over them, which
  // comes in as it does. The labels are never covered and never change layer, so they
  // bend through the glass while it is held and are as they were in every other frame.
  function knobLayers(face, glass, transform, spring) {
    face.style.transform = glass.style.transform = transform;
    face.style.setProperty('--lg-k', lifted(glass, spring).toFixed(4));
  }

  UI.toggle = function (checked, onChange, label) {
    // Its lens is made now, so the first press has it from its first frame (no filter is
    // drawn until it lifts).
    const knob = NT.glass.refract(h('span.switch-knob.lens'), KNOB_LENS);
    const el = h('button.switch', { type: 'button', role: 'switch', 'aria-checked': String(!!checked), 'aria-label': label }, knob);
    let on = !!checked;
    let drag = null;
    const TRAVEL = 21;
    // Where the knob is, how far it has lifted, and a stretch along the way it moves
    // that grows with its speed: the knob is a drop of glass, not a disc.
    const paint = () => {
      const stretch = clamp(Math.abs(pos.velocity) / 900, 0, 0.24);
      const l = lift.value;
      knob.style.transform = `translateX(${pos.value.toFixed(2)}px) scale(${((1 + l * 0.3) * (1 + stretch)).toFixed(4)}, ${((1 + l * 0.5) * (1 - stretch * 0.4)).toFixed(4)})`;
      lifted(knob, lift);
    };
    const pos = new Spring({ stiffness: 420, damping: 30, value: on ? TRAVEL : 0, onUpdate: paint });
    const lift = new Spring({ stiffness: 380, damping: 24, precision: 0.002, onUpdate: paint });
    knob.classList.add('is-sprung');
    paint();
    const set = (v, fire) => {
      if (v === on) return;
      on = v;
      el.setAttribute('aria-checked', String(on));
      if (!drag) pos.set(on ? TRAVEL : 0);
      if (fire && onChange) onChange(on);
    };
    el.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, moved: false, start: pos.value };
      el.setPointerCapture(e.pointerId);
      NT.glass.refract(knob, KNOB_LENS);
      el.classList.add('is-pressed');
      lift.set(1);
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 8) drag.moved = true;
      if (!drag.moved) return;
      // Held, the knob follows the finger along its track; past halfway it is the other state.
      const x = clamp(drag.start + dx, 0, TRAVEL);
      pos.set(x);
      set(x > TRAVEL / 2, true);
    });
    const end = (e) => {
      el.classList.remove('is-pressed');
      const tap = drag && !drag.moved && e.type === 'pointerup';
      drag = null;
      lift.set(0);
      if (tap) set(!on, true);
      pos.set(on ? TRAVEL : 0);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    // Keyboard and assistive tech activate through click with no pointer detail.
    el.addEventListener('click', (e) => { if (e.detail === 0) set(!on, true); });
    return { el, set: (v) => set(!!v, false), get value() { return on; } };
  };

  /* ---------- Slider ----------
     The thumb is a drop of glass on a track. It goes where the finger is, not where
     the steps are: its place is a spring toward the finger (so a press away from it is
     a glide, never a jump), and it lifts into a lens while it is held. The value is the
     step nearest to it, said as it changes; let go, the thumb settles on the value's
     own place.

     Held, it is jelly: pushed toward more it draws out long, pushed back toward less
     it gathers up tall, and it swings once past its own shape as it comes to rest. Its
     shape is a spring of its own, pulled by how hard the thumb is pushed along (its
     place spring's force) and a little by its speed, and it keeps its area. The numbers
     are fitted to Apple's own slider (Adopting Liquid Glass, its video): its thumb's
     path, followed by this thumb's place spring, gives this jelly's shape frame by frame. */

  const JELLY = { stiffness: 70, damping: 12, precision: 0.001 };
  // log(width / height) the jelly is pulled toward, for a thumb going at v px/s and
  // pushed at a px/s².
  const jellyTo = (v, a) => 0.1 * Math.tanh(v / 1100) + a / 10000;
  // The resting thumb against the held one (38 × 24 of 54 × 36).
  const REST_X = 38 / 54, REST_Y = 24 / 36;

  UI.slider = function ({ min = 0, max = 100, step = 1, value = 0, onInput, label }) {
    const thumb = NT.glass.refract(h('div.slider-thumb.lens'), KNOB_LENS);
    const el = h('div.slider', { role: 'slider', tabIndex: 0, 'aria-label': label, 'aria-valuemin': min, 'aria-valuemax': max },
      h('div.slider-track', h('div.slider-fill')), thumb);
    const span = max - min;
    const at = (x) => (span > 0 ? clamp((x - min) / span, 0, 1) : 0);
    let v = clamp(value, min, max);
    let held = false;
    // How far the thumb travels, for its speed in px: read at a press and on a resize.
    let travel = 0;
    const measure = () => { travel = Math.max(0, el.clientWidth - 38); };
    const paint = () => {
      const l = lift.value;
      // Only glass is jelly: the resting knob keeps its shape.
      const y = clamp(jelly.value, -0.4, 0.35) * clamp(l, 0, 1);
      const sx = Math.exp(y / 2);
      el.style.setProperty('--p', pos.value.toFixed(5));
      // Drawn at its held size, 54 × 36, it rests at 38 × 24 (glass.css).
      thumb.style.transform = `scale(${((REST_X + l * (1 - REST_X)) * sx).toFixed(4)}, ${((REST_Y + l * (1 - REST_Y)) / sx).toFixed(4)})`;
      lifted(thumb, lift);
    };
    // The thumb's own speed and the force its spring pushes it with, in px.
    const moved = () => {
      const a = -pos.k * (pos.value - pos.target) - pos.c * pos.velocity;
      jelly.set(jellyTo(pos.velocity * travel, a * travel));
      paint();
    };
    const pos = new Spring({ stiffness: 720, damping: 48, precision: 0.0004, value: at(v), onUpdate: moved });
    const lift = new Spring({ stiffness: 380, damping: 24, precision: 0.002, onUpdate: paint });
    const jelly = new Spring(Object.assign({ onUpdate: paint }, JELLY));
    const said = () => el.setAttribute('aria-valuenow', v);
    // The value takes the step nearest to `nv`. → whether it changed.
    const commit = (nv, fire) => {
      nv = clamp(+(min + Math.round((nv - min) / step) * step).toFixed(6), min, max);
      if (nv === v) return false;
      v = nv;
      said();
      if (fire && onInput) onInput(v);
      return true;
    };
    const fromX = (x) => {
      const r = el.getBoundingClientRect();
      const f = clamp((x - r.left - 19) / Math.max(1, r.width - 38), 0, 1);
      pos.set(f);
      commit(min + f * span, true);
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      held = true;
      el.setPointerCapture(e.pointerId);
      NT.glass.refract(thumb, KNOB_LENS);
      measure();
      el.classList.add('is-pressed');
      lift.set(1);
      fromX(e.clientX);
    });
    el.addEventListener('pointermove', (e) => { if (held) fromX(e.clientX); });
    const end = () => {
      if (!held) return;
      held = false;
      el.classList.remove('is-pressed');
      lift.set(0);
      pos.set(at(v));
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end); // never leave the thumb lifted
    // The slider is not selectable (see .slider). If it were, a press would start a text
    // selection and the next press would drag that selection away, cancelling the gesture.
    el.addEventListener('dragstart', (e) => e.preventDefault());
    el.addEventListener('keydown', (e) => {
      const big = Math.max(step, span / 10);
      const map = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step, PageDown: -big, PageUp: big };
      let to = null;
      if (e.key in map) to = v + map[e.key];
      else if (e.key === 'Home') to = min;
      else if (e.key === 'End') to = max;
      if (to === null) return;
      e.preventDefault();
      measure();
      if (commit(to, true)) pos.set(at(v));
    });
    if (window.ResizeObserver) new ResizeObserver(measure).observe(el);
    thumb.classList.add('is-sprung');
    said();
    paint();
    return {
      el,
      set(nv) {
        measure();
        if (commit(nv, false)) pos.set(at(v));
      },
      get value() { return v; },
    };
  };

  /* ---------- Segmented control ----------
     Tap a segment, or press and drag: the thumb lifts into a glass lens,
     follows the finger and settles on the nearest segment. */

  UI.segmented = function (options, value, onChange) {
    const face = h('span.seg-thumb.lens-face');
    const thumb = NT.glass.refract(h('span.seg-glass.lens'), NT.glass.drop({ bezel: 16, magnify: 0.04 }));
    const el = h('div.seg', { role: 'tablist' }, face);
    el.style.setProperty('--n', options.length);
    const buttons = options.map((o) => h('button.seg-item', { type: 'button', role: 'tab' }, o.label));
    el.append(...buttons, thumb);

    let index = Math.max(0, options.findIndex((o) => o.value === value));
    let drag = null;
    const cell = () => Math.max(0, (el.clientWidth - 6) / options.length);
    const paint = () => {
      const stretch = clamp(Math.abs(pos.velocity) / 2200, 0, 0.26);
      const l = lift.value;
      knobLayers(face, thumb, `translateX(${pos.value.toFixed(2)}px) scale(${((1 + stretch) * (1 + l * 0.06)).toFixed(4)}, ${((1 - stretch * 0.4) * (1 + l * 0.3)).toFixed(4)})`, lift);
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
      lift.set(1);
      follow(e.clientX);
    });
    el.addEventListener('pointermove', (e) => { if (drag) follow(e.clientX); });
    const release = (e) => {
      if (!drag) return;
      drag = null;
      el.classList.remove('is-lifting');
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
    // Off until asked for, and only where the server can keep someone signed in.
    const remember = api.canKeep ? UI.toggle(false, null, 'Remember Me') : null;
    // The sample data is a quiet way past the form, not a second way to sign in.
    const looking = api.mode === 'demo' && !!api.session;
    const form = h('form.form-stack', { novalidate: true },
      seg.el,
      h('div.list', name.row, username.row, password.row),
      remember && h('div.list', h('div.row', h('span.row-title', 'Remember Me'), remember.el)),
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
        const keep = !!remember && remember.value;
        if (mode === 'register') await api.register(n, u, p, keep);
        else await api.login(u, p, keep);
        sheet.close();
        NT.nav.reset();
        UI.toast('Signed in as ' + (api.session.name || api.session.username), { icon: 'person' });
      } catch (err) {
        if (err.message === 'live-unavailable') error.textContent = 'Start the app with “node server.js” to sign in.';
        else if (err.status === 401) error.textContent = 'Wrong username or password.';
        else if (err.status === 409) error.textContent = 'That username is taken.';
        else error.textContent = NT.api.unreachable(err) ? 'Upstream is unreachable.' : 'Could not sign in. Try again.';
      } finally {
        submit.disabled = false;
      }
    });
    return sheet;
  };

  // The name every style gives its way in (js/actions.js asks for it).
  UI.signIn = (mode) => UI.authSheet(mode);

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
        error.textContent = err.status === 401 ? 'Current password is incorrect.' : NT.api.unreachable(err) ? 'Upstream is unreachable.' : 'Could not change the password. Try again.';
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
    let el, capsule, lens, lensGlass, input, searchEl, searchBtn, accessoryHost;
    let active = 'home', minimized = false, searching = false, drag = null, currentAccessory = null;
    const tabEls = {};

    const lift = new Spring({ stiffness: 380, damping: 24, precision: 0.002, onUpdate: () => paintLens() });
    const pos = new Spring({ stiffness: 320, damping: 26, onUpdate: () => paintLens() });

    function paintLens() {
      const stretch = clamp(Math.abs(pos.velocity) / 2400, 0, 0.3);
      const l = lift.value;
      knobLayers(lens, lensGlass, `translateX(${pos.value.toFixed(2)}px) scale(${((1 + stretch) * (1 + l * 0.14)).toFixed(4)}, ${((1 - stretch * 0.4) * (1 + l * 0.24)).toFixed(4)})`, lift);
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
      lens.style.width = lensGlass.style.width = b.offsetWidth + 'px';
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

    /*
      Search opens where it is pressed and stays there: pressing it goes nowhere. On
      Scripts the page itself is what is found. Anywhere else what is found comes up
      beside the field, out of its glass, over the page as it is; one of them opens that
      script, and Return (or "All Results") is what goes to Scripts, with the words kept.
    */
    const MOST = 5;
    let searchAt = null, results = null, pool = null, resultsAnim = null;
    const onScripts = () => NT.nav.paths().join() === '/scripts';
    const asked = () => input.value.trim().toLowerCase();

    function hit(s) {
      const path = `/scripts/${s.script_id}`;
      return h('a.menu-item.search-hit', { href: NT.nav.href(path), onclick: (e) => { e.preventDefault(); NT.nav.go(path); } },
        NT.kit.cover(s, '.thumb', 18),
        h('span.row-main', h('span.row-title', s.name || s.script_id), h('span.row-sub', s.author_name || '')));
    }

    // found: the scripts that match, or null for no panel at all.
    function showResults(found) {
      if (!found) {
        const old = results;
        results = null;
        if (!old) return;
        old.inert = true;
        if (reduced()) old.remove();
        else NT.liquid.absorb(old, searchEl).finished.then(() => old.remove());
        return;
      }
      const kids = found.length
        ? found.slice(0, MOST).map(hit).concat(found.length > MOST
          ? [h('div.menu-sep', { role: 'separator' }), h('button.menu-item', { type: 'button', onclick: seeAll }, h('span', 'All Results'), h('i.search-count', String(found.length)))]
          : [])
        : [h('p.search-none', 'No Results')];
      if (!results) {
        results = h('div.search-results.glass.thick', { role: 'group', 'aria-label': 'Results' }, kids);
        if (searchEl.dataset.over) results.dataset.over = searchEl.dataset.over;
        el.append(results);
        NT.glass.refract(results, { bezel: 18, magnify: 0.008, dispersion: 0 });
        if (!reduced()) NT.liquid.split(results, searchEl);
        return;
      }
      // The glass that is there takes what is found now, and its height with it.
      const from = parseFloat(getComputedStyle(results).height);
      if (resultsAnim) resultsAnim.cancel();
      results.replaceChildren(...kids);
      const to = parseFloat(getComputedStyle(results).height);
      if (reduced() || Math.abs(to - from) < 0.5) return;
      const sp = NT.liquid.exact(motion.snappy);
      resultsAnim = results.animate([{ height: from + 'px' }, { height: to + 'px' }], { duration: sp.duration, easing: sp.easing });
    }

    async function suggest() {
      const q = asked();
      if (!searching || !q || onScripts()) return void showResults(null);
      if (!pool) {
        const me = NT.api.session;
        const mine = pool = Promise.all([NT.api.scripts(), me ? NT.api.userScripts(me.user_id).catch(() => []) : []]).then(([all, own]) => {
          const seen = new Set();
          return own.concat(all).filter((s) => !seen.has(s.script_id) && seen.add(s.script_id));
        }, () => {
          if (pool === mine) pool = null; // asked again with the next letter
          return null;
        });
      }
      const list = await pool;
      // Only for what is still being asked.
      if (!searching || asked() !== q || onScripts()) return;
      if (!list) return void showResults(null);
      showResults(list
        .filter((s) => (`${s.name} ${s.description || ''} ${s.author_name}`).toLowerCase().includes(q))
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)));
    }

    function seeAll() {
      if (!searching || !asked() || onScripts()) return;
      NT.nav.go('/scripts');
      input.focus({ preventScroll: true });
    }

    // The page on top has changed (app.js). Search goes with the page it was on; on
    // Scripts it stays, and the page is what is found.
    function onPage(top) {
      if (!searching) return;
      if (onScripts()) {
        searchAt = top;
        showResults(null);
      } else if (top !== searchAt) closeSearch(true);
    }

    function openSearch() {
      if (searching) return void input.focus({ preventScroll: true });
      searching = true;
      searchAt = NT.nav.top();
      minimized = false;
      NT.dom.app.classList.remove('tab-min');
      NT.dom.app.classList.add('tab-search');
      // While open the field is the capsule's tab stop; closed, its button is.
      input.tabIndex = 0;
      searchBtn.tabIndex = -1;
      input.focus({ preventScroll: true });
    }

    // moved: the page has changed under it, and the new page has the keyboard.
    function closeSearch(moved) {
      if (!searching) return;
      searching = false;
      NT.dom.app.classList.remove('tab-search');
      const inside = searchEl.contains(document.activeElement) || (!!results && results.contains(document.activeElement));
      showResults(null);
      pool = null;
      searchAt = null;
      input.value = '';
      input.tabIndex = -1;
      searchBtn.tabIndex = 0;
      input.blur();
      if (inside && moved !== true) {
        if (window.matchMedia('(hover: hover)').matches) searchBtn.focus({ preventScroll: true });
      } else if (inside && NT.nav.top()) NT.nav.top().page.el.focus({ preventScroll: true });
      NT.bus.emit('search', '');
      setTimeout(() => layoutLens(true), motion.smooth.duration * 0.7);
    }

    function build() {
      // The selection: its face under the tabs, its glass over them (knobLayers).
      lens = h('div.tab-lens.lens-face');
      lensGlass = h('div.tab-lens.tab-lens-glass.lens');
      const sheetOfGlass = h('div.tabbar-glass.glass');
      capsule = h('div.tabbar-capsule', { role: 'tablist', 'aria-label': 'Sections' }, sheetOfGlass, lens, lensGlass);
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
      input.addEventListener('input', () => {
        NT.bus.emit('search', input.value);
        suggest();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSearch();
        else if (e.key === 'Enter') seeAll();
        else if (e.key === 'ArrowDown' && results) {
          const first = results.querySelector('.menu-item');
          if (!first) return;
          e.preventDefault();
          first.focus({ preventScroll: true });
        }
      });
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
      // In what is found, the arrows move between them and back to the field.
      el.addEventListener('keydown', (e) => {
        if (!results || !results.contains(e.target)) return;
        if (e.key === 'Escape') return void closeSearch();
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const list = [...results.querySelectorAll('.menu-item')];
        const i = list.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : -1);
        if (i < 0) input.focus({ preventScroll: true });
        else if (i < list.length) list[i].focus({ preventScroll: true });
      });
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
      NT.glass.refract(lensGlass, NT.glass.drop({ bezel: 24, magnify: 0.05 }));
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

    // On a phone the accessory sits just above the bar: it comes out of the bar's glass and
    // goes back into it, as a drop parts from water (NT.liquid). Elsewhere it has nothing
    // beside it, and materializes where it is.
    function setAccessory(node) {
      if (node === currentAccessory) return;
      const old = currentAccessory;
      currentAccessory = node || null;
      const bar = phone.matches && !NT.dom.app.classList.contains('tab-hidden') ? capsule.querySelector('.tabbar-glass') : null;
      if (old) {
        if (reduced()) old.remove();
        else (bar ? NT.liquid.absorb(old, bar) : NT.liquid.materialize(old, false)).finished.then(() => old.remove());
      }
      if (node) {
        accessoryHost.append(node);
        NT.glass.refract(node);
        if (!reduced()) {
          if (bar) NT.liquid.split(node, bar);
          else NT.liquid.materialize(node, true, { timing: motion.bouncy });
        }
      }
    }

    return {
      build, setActive, setMinimized, setAccessory, onScroll, closeSearch, onPage,
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
