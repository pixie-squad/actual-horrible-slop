/*
  Liquid: how glass comes, goes, moves and answers a touch, after Apple's Liquid Glass
  ("Meet Liquid Glass", WWDC25; SwiftUI GlassEffectContainer and GlassEffectTransition).

    materialize – glass appears by bending more and more light, never by fading. Its
                  presence (--lg-k, glass.css) runs from 0 while it swells out of a
                  droplet, and what is on it fades in. It goes the same way back.
    split       – glass that appears beside other glass comes out of it, as a drop pulls
                  away from water: a neck joins the two until it thins and parts.
                  absorb is the way back in. The neck (bridge) is the region their smooth
                  union fills and neither piece does.
    flex        – a press swells the glass, and the finger pulls it after itself.
    light       – the light of a touch starts under the finger, spreads through the
                  glass and reaches the glass beside it.

  Everything here is right in every frame, paused or not: what moves is a Web
  Animation, and anything drawn to follow it (a neck) is drawn from where things are
  in that frame, read on each animation frame.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { clamp, motion } = NT.util;
  const Glass = NT.glass;
  const Liquid = (NT.liquid = {});
  const reduced = () => NT.util.reducedMotion();
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  /*
    A spring that lands exactly. A spring curve creeps toward its end, so its last frames
    are a fraction of a pixel short, and the element that takes over after it is drawn
    on a whole pixel: the swap shows as a shimmer of every edge and glyph. From where
    what is left of the way is too small to see (under 0.15 %), this one is there.
  */
  Liquid.exact = function (sp) {
    const m = /^linear\((.*)\)$/.exec(sp.easing);
    if (!m) return sp;
    const pts = m[1].split(',').map(Number);
    let i = pts.length - 1;
    while (i > 0 && Math.abs(pts[i - 1] - 1) < 0.0015) i--;
    for (let j = i; j < pts.length; j++) pts[j] = 1;
    return { duration: sp.duration, easing: `linear(${pts.join(',')})` };
  };

  // The same for CSS transitions that end in a swap or at rest (the title capsule).
  for (const name of ['smooth', 'snappy']) document.documentElement.style.setProperty(`--land-${name}`, Liquid.exact(motion[name]).easing);

  // A copy of a control's content stands in for it somewhere else (a panel growing out of
  // it): it takes the type the control has where it is, so its words fall on the same
  // pixels as the control's own.
  Liquid.typeOf = function (from, to) {
    const cs = getComputedStyle(from);
    for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'color', 'textAlign']) to.style[p] = cs[p];
    return to;
  };

  // What is on a piece of glass: what fades while the glass itself materializes.
  const contentOf = (el, opts) => opts.content || [...el.children];

  // Where an animation is, 0 … 1 of its own time (paused ones too).
  const progressOf = (anim, duration) => clamp((Number(anim.currentTime) || 0) / (duration || 1), 0, 1);

  // A handle on a group of animations: finished when all are, cancelled together.
  function group(anims, onEnd) {
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      if (onEnd) onEnd();
    };
    const finished = Promise.all(anims.map((a) => a.finished)).then(end, end);
    return {
      anims,
      finished,
      cancel() {
        anims.forEach((a) => a.cancel());
        end();
      },
    };
  }
  const done = () => ({ anims: [], finished: Promise.resolve(), cancel() {} });

  /* ---------- Materialize ----------
     show: from nothing to the glass it is; !show: back to nothing, and it stays at
     nothing (fill: forwards) until whoever asked removes or hides it. */
  Liquid.materialize = function (el, show, opts = {}) {
    if (reduced()) return done();
    const sp = Liquid.exact(opts.timing || (show ? motion.smooth : motion.snappy));
    const d = sp.duration;
    const grow = opts.grow == null ? 0.7 : opts.grow;
    const origin = opts.origin || null;
    if (origin) el.style.transformOrigin = origin;
    const anims = [];
    if (show) {
      anims.push(Glass.animate(el, [{ k: 0 }, { k: 1 }], { duration: d, easing: sp.easing }));
      anims.push(el.animate([{ scale: String(grow) }, { scale: '1' }], { duration: d, easing: sp.easing }));
      for (const n of contentOf(el, opts)) {
        anims.push(n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: d * 0.5, delay: d * 0.14, easing: 'ease-out', fill: 'backwards' }));
      }
    } else {
      const from = Glass.state(el).k;
      anims.push(Glass.animate(el, [{ k: from }, { k: 0 }], { duration: d, easing: sp.easing, fill: 'forwards' }));
      anims.push(el.animate([{ scale: '1' }, { scale: String(grow) }], { duration: d, easing: sp.easing, fill: 'forwards' }));
      for (const n of contentOf(el, opts)) {
        anims.push(n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: d * 0.45, easing: 'ease-in', fill: 'forwards' }));
      }
    }
    return group(anims, () => { if (origin) el.style.transformOrigin = ''; });
  };

  /* ---------- The neck between two pieces ----------
     F = max(smin(dA, dB), −dA, −dB) is below zero exactly where the smooth union of the
     two shapes is filled and neither shape is. Its zero line is traced on a fine grid
     (marching squares) and becomes the neck's clip path; where the line runs free, not
     along a piece, it is the neck's own rim. */

  const box = (el, host) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // The corner as drawn: the radius scales with the element's own scale.
    const sx = r.width / (el.offsetWidth || r.width || 1);
    const radius = Math.min(parseFloat(cs.borderTopLeftRadius) * sx || 0, r.width / 2, r.height / 2);
    return { x: r.left - host.left, y: r.top - host.top, w: r.width, h: r.height, r: radius };
  };
  function sdBox(px, py, b) {
    const qx = Math.abs(px - (b.x + b.w / 2)) - (b.w / 2 - b.r);
    const qy = Math.abs(py - (b.y + b.h / 2)) - (b.h / 2 - b.r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - b.r;
  }
  function smin(a, b, k) {
    if (k <= 0) return Math.min(a, b);
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  }

  const CELL = 1.25;

  // The neck's outline for boxes A and B and a union radius k: { frame, clip, rim,
  // seamA, seamB } with the paths in the frame's coordinates, or null where there is none.
  function neckOf(A, B, k) {
    if (k <= 0.5) return null;
    // It can only be where both shapes are within reach.
    const pad = k * 1.25 + CELL * 2;
    const fx0 = Math.max(A.x, B.x) - pad, fx1 = Math.min(A.x + A.w, B.x + B.w) + pad;
    const fy0 = Math.max(A.y, B.y) - pad, fy1 = Math.min(A.y + A.h, B.y + B.h) + pad;
    if (fx1 - fx0 < 1 || fy1 - fy0 < 1) return null;
    const nx = Math.ceil((fx1 - fx0) / CELL), ny = Math.ceil((fy1 - fy0) / CELL);
    if (nx * ny > 80000) return null;
    const W = nx + 1;
    const F = new Float32Array(W * (ny + 1));
    let any = false;
    for (let j = 0; j <= ny; j++) {
      const py = fy0 + j * CELL;
      for (let i = 0; i <= nx; i++) {
        const px = fx0 + i * CELL;
        const a = sdBox(px, py, A), b = sdBox(px, py, B);
        let f = Math.max(smin(a, b, k), -a, -b);
        // The frame's own border is outside, so every outline closes.
        if (i === 0 || j === 0 || i === nx || j === ny) f = Math.max(f, 0.01);
        F[j * W + i] = f;
        if (f < 0) any = true;
      }
    }
    if (!any) return null;

    // Marching squares. A crossing is named by the edge it is on, so the segments of the
    // outline join into loops by the names of their ends. Horizontal edges first
    // (between (i, j) and (i + 1, j)), then vertical ones.
    const H = nx * (ny + 1);
    const point = (e) => {
      let i, j, i2, j2;
      if (e < H) { j = Math.floor(e / nx); i = e % nx; i2 = i + 1; j2 = j; }
      else { const v = e - H; j = Math.floor(v / W); i = v % W; i2 = i; j2 = j + 1; }
      const fa = F[j * W + i], fb = F[j2 * W + i2];
      const u = fa / (fa - fb);
      return [(i + (i2 - i) * u) * CELL, (j + (j2 - j) * u) * CELL];
    };
    const hEdge = (i, j) => j * nx + i;
    const vEdge = (i, j) => H + j * W + i;
    const next = new Map();
    const free = [];
    const seam = [null, [Infinity, Infinity, -Infinity, -Infinity], [Infinity, Infinity, -Infinity, -Infinity]];
    const link = (e1, e2) => {
      // The outline runs from e1 to e2 with the inside on its right.
      next.set(e1, e2);
      const p = point(e1), q = point(e2);
      const mx = fx0 + (p[0] + q[0]) / 2, my = fy0 + (p[1] + q[1]) / 2;
      const a = sdBox(mx, my, A), b = sdBox(mx, my, B);
      const s = smin(a, b, k);
      const which = s >= -a && s >= -b ? 0 : -a >= -b ? 1 : 2;
      if (which === 0) free.push(p, q);
      else {
        const sb = seam[which];
        sb[0] = Math.min(sb[0], p[0], q[0]); sb[1] = Math.min(sb[1], p[1], q[1]);
        sb[2] = Math.max(sb[2], p[0], q[0]); sb[3] = Math.max(sb[3], p[1], q[1]);
      }
    };
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const tl = F[j * W + i] < 0, tr = F[j * W + i + 1] < 0;
        const br = F[(j + 1) * W + i + 1] < 0, bl = F[(j + 1) * W + i] < 0;
        const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
        if (c === 0 || c === 15) continue;
        const top = hEdge(i, j), bottom = hEdge(i, j + 1), left = vEdge(i, j), right = vEdge(i + 1, j);
        const centre = (F[j * W + i] + F[j * W + i + 1] + F[(j + 1) * W + i + 1] + F[(j + 1) * W + i]) / 4 < 0;
        switch (c) {
          case 1: link(left, bottom, i, j); break;
          case 2: link(bottom, right, i, j); break;
          case 3: link(left, right, i, j); break;
          case 4: link(right, top, i, j); break;
          case 5: if (centre) { link(left, top, i, j); link(right, bottom, i, j); } else { link(left, bottom, i, j); link(right, top, i, j); } break;
          case 6: link(bottom, top, i, j); break;
          case 7: link(left, top, i, j); break;
          case 8: link(top, left, i, j); break;
          case 9: link(top, bottom, i, j); break;
          case 10: if (centre) { link(top, right, i, j); link(bottom, left, i, j); } else { link(top, left, i, j); link(bottom, right, i, j); } break;
          case 11: link(top, right, i, j); break;
          case 12: link(right, left, i, j); break;
          case 13: link(right, bottom, i, j); break;
          case 14: link(bottom, left, i, j); break;
          default: break;
        }
      }
    }
    const f2 = (n) => Math.round(n * 100) / 100;
    let clip = '', open = 0;
    const seen = new Set();
    for (const start of next.keys()) {
      if (seen.has(start)) continue;
      let e = start, guard = 0, part = '';
      while (e != null && !seen.has(e) && guard++ < 100000) {
        seen.add(e);
        const p = point(e);
        part += (part ? 'L' : 'M') + f2(p[0]) + ' ' + f2(p[1]);
        e = next.get(e);
      }
      // Only an outline that comes back to where it began: a piece of one, closed by a
      // straight line, would fill what is not the neck at all.
      if (part && e === start) clip += part + 'Z';
      else if (part) open++;
    }
    let rim = '';
    for (let n = 0; n < free.length; n += 2) rim += 'M' + f2(free[n][0]) + ' ' + f2(free[n][1]) + 'L' + f2(free[n + 1][0]) + ' ' + f2(free[n + 1][1]);
    // Seams are given in the boxes' own coordinates.
    const rect = (b) => (b[0] === Infinity ? null : { x: fx0 + b[0], y: fy0 + b[1], w: b[2] - b[0], h: b[3] - b[1] });
    return { frame: { x: fx0, y: fy0, w: nx * CELL, h: ny * CELL }, clip, rim, open, seamA: rect(seam[1]), seamB: rect(seam[2]) };
  }
  Liquid._neckOf = neckOf; // for checks

  const SVG_NS = 'http://www.w3.org/2000/svg';

  // A neck between pieces `a` and `b`, kept in the overlay layer. update(k) draws it for
  // where both are now; remove() takes it and the seams away.
  function bridge(a, b) {
    const host = NT.dom.overlays;
    const neck = document.createElement('div');
    neck.className = 'glass lg-neck';
    neck.setAttribute('aria-hidden', 'true');
    if (a.dataset.over) neck.dataset.over = a.dataset.over;
    const tone = Glass.state(a);
    neck.style.setProperty('--lg-t', String(tone.t));
    const blur = Glass.frostOf ? Glass.frostOf(a) : null;
    if (blur != null) neck.style.setProperty('--_blur', blur.toFixed(2) + 'px');
    // Its colour runs from one piece's to the other's (a tinted piece out of a plain one).
    const ca = getComputedStyle(a).backgroundColor, cb = getComputedStyle(b).backgroundColor;
    const blend = ca !== cb;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'lg-neck-rim');
    const path = document.createElementNS(SVG_NS, 'path');
    svg.append(path);
    neck.append(svg);
    host.prepend(neck);

    const seam = (el, r, at) => {
      if (!r) return void el.classList.remove('lg-seamed');
      // In the piece's own (untransformed) frame.
      const sx = at.w / (el.offsetWidth || at.w), sy = at.h / (el.offsetHeight || at.h);
      el.classList.add('lg-seamed');
      el.style.setProperty('--seam-x', ((r.x - at.x) / sx - 3).toFixed(2) + 'px');
      el.style.setProperty('--seam-y', ((r.y - at.y) / sy - 3).toFixed(2) + 'px');
      el.style.setProperty('--seam-w', (r.w / sx + 6).toFixed(2) + 'px');
      el.style.setProperty('--seam-h', (r.h / sy + 6).toFixed(2) + 'px');
    };

    return {
      update(k) {
        const hr = host.getBoundingClientRect();
        const A = box(a, hr), B = box(b, hr);
        // One wholly within the other is one piece of glass already: there is no neck.
        const within = (p, q) => p.x >= q.x - 0.5 && p.y >= q.y - 0.5 && p.x + p.w <= q.x + q.w + 0.5 && p.y + p.h <= q.y + q.h + 0.5;
        const shape = within(A, B) || within(B, A) ? null : neckOf(A, B, k);
        if (!shape || !shape.clip) {
          neck.style.visibility = 'hidden';
          seam(a, null);
          seam(b, null);
          return;
        }
        neck.style.visibility = '';
        const fr = shape.frame;
        neck.style.left = fr.x.toFixed(2) + 'px';
        neck.style.top = fr.y.toFixed(2) + 'px';
        neck.style.width = fr.w.toFixed(2) + 'px';
        neck.style.height = fr.h.toFixed(2) + 'px';
        neck.style.clipPath = `path(evenodd, '${shape.clip}')`;
        if (blend) {
          const deg = Math.atan2((B.x + B.w / 2) - (A.x + A.w / 2), -((B.y + B.h / 2) - (A.y + A.h / 2))) * 180 / Math.PI;
          neck.style.backgroundColor = 'transparent';
          neck.style.backgroundImage = `linear-gradient(${deg.toFixed(1)}deg, ${ca} 30%, ${cb} 70%)`;
        }
        path.setAttribute('d', shape.rim);
        seam(a, shape.seamA, A);
        seam(b, shape.seamB, B);
      },
      remove() {
        neck.remove();
        for (const el of [a, b]) {
          el.classList.remove('lg-seamed');
          for (const p of ['--seam-x', '--seam-y', '--seam-w', '--seam-h']) el.style.removeProperty(p);
        }
      },
    };
  }

  // Clip `el` to what lies outside `other`, so the part still inside is not glass over glass.
  function outside(el, other) {
    const r = el.getBoundingClientRect(), o = other.getBoundingClientRect();
    const sx = r.width / (el.offsetWidth || r.width || 1), sy = r.height / (el.offsetHeight || r.height || 1);
    const w = el.offsetWidth, h = el.offsetHeight;
    const x = (o.left - r.left) / sx, y = (o.top - r.top) / sy, ow = o.width / sx, oh = o.height / sy;
    const rad = Math.min(parseFloat(getComputedStyle(other).borderTopLeftRadius) * (o.width / (other.offsetWidth || o.width)) / sx || 0, ow / 2, oh / 2);
    const f = (n) => Math.round(n * 100) / 100;
    const m = 60; // room for the drop shadow
    const outer = `M${-m} ${-m}H${w + m}V${h + m}H${-m}Z`;
    const ry = Math.min(rad * sx / sy, oh / 2);
    const inner = `M${f(x + rad)} ${f(y)}H${f(x + ow - rad)}A${f(rad)} ${f(ry)} 0 0 1 ${f(x + ow)} ${f(y + ry)}V${f(y + oh - ry)}A${f(rad)} ${f(ry)} 0 0 1 ${f(x + ow - rad)} ${f(y + oh)}H${f(x + rad)}A${f(rad)} ${f(ry)} 0 0 1 ${f(x)} ${f(y + oh - ry)}V${f(y + ry)}A${f(rad)} ${f(ry)} 0 0 1 ${f(x + rad)} ${f(y)}Z`;
    el.style.clipPath = `path(evenodd, '${outer}${inner}')`;
  }

  // Where `el` is while wholly inside `from`: at its centre, small enough to fit in it.
  // Out of sight there (it is clipped to what lies outside `from`), it can start or end.
  function inside(el, from) {
    const r = el.getBoundingClientRect(), o = from.getBoundingClientRect();
    const dx = (o.left + o.width / 2) - (r.left + r.width / 2);
    const dy = (o.top + o.height / 2) - (r.top + r.height / 2);
    const fit = Math.min(o.width / (r.width || 1), o.height / (r.height || 1)) * 0.86;
    return { dx, dy, fit };
  }

  /*
    Split `el` (in its place already) out of `from`, or (absorb) take it back in. The
    neck's reach falls as they part, so it always parts before the end; on the way in it
    grows as they meet. opts: timing, reach (px, default about half the smaller height).
  */
  function pull(el, from, out, opts = {}) {
    if (reduced() || !from || !from.isConnected || !el.isConnected) return done();
    const sp = Liquid.exact(opts.timing || (out ? motion.smooth : motion.snappy));
    const d = sp.duration;
    const { dx, dy, fit } = inside(el, from);
    const start = `${dx.toFixed(2)}px ${dy.toFixed(2)}px`;
    const small = String(+Math.min(opts.grow == null ? 0.62 : opts.grow, fit).toFixed(4));
    const keys = out
      ? [{ translate: start, scale: small }, { translate: '0px 0px', scale: '1' }]
      : [{ translate: '0px 0px', scale: '1' }, { translate: start, scale: small }];
    const anims = [el.animate(keys, { duration: d, easing: sp.easing, fill: out ? 'none' : 'forwards' })];
    for (const n of contentOf(el, opts)) {
      anims.push(out
        ? n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: d * 0.45, delay: d * 0.2, easing: 'ease-out', fill: 'backwards' })
        : n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: d * 0.35, easing: 'ease-in', fill: 'forwards' }));
    }
    const reach = opts.reach || Math.min(el.offsetHeight, from.offsetHeight) * 0.55;
    const neck = bridge(from, el);
    const clock = anims[0];
    let raf = 0;
    const frame = () => {
      raf = 0;
      if (!el.isConnected || !from.isConnected) return;
      const p = progressOf(clock, d);
      outside(el, from);
      // Out: thick at first, parted by two thirds of the way. In: forms as they meet.
      const k = out ? reach * (1 - smoothstep(0.15, 0.62, p)) : reach * smoothstep(0.08, 0.55, p);
      neck.update(k);
      if (clock.playState !== 'finished' && clock.playState !== 'idle') raf = requestAnimationFrame(frame);
    };
    frame();
    return group(anims, () => {
      if (raf) cancelAnimationFrame(raf);
      neck.remove();
      el.style.clipPath = '';
    });
  }
  Liquid.split = (el, from, opts) => pull(el, from, true, opts);
  Liquid.absorb = (el, into, opts) => pull(el, into, false, opts);

  /* ---------- Flex ----------
     A press swells the glass at once; held and moved, the glass leans after the finger,
     and pulled past its edge it stretches toward it, up to a point. Let go, it springs
     back. Driven through the `scale` and `translate` properties, which compose with any
     transform the element is given elsewhere. */

  const STIFF = { press: [700, 38], release: [240, 17] };
  const pressing = new Map();

  function spring(state, dt) {
    const [kk, c] = state.held ? STIFF.press : STIFF.release;
    const n = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / n;
    let moving = false;
    for (const key of ['x', 'y', 'sx', 'sy']) {
      let v = state.v[key], x = state.p[key];
      const target = state.t[key];
      for (let i = 0; i < n; i++) {
        v += (-kk * (x - target) - c * v) * h;
        x += v * h;
      }
      state.v[key] = v;
      state.p[key] = x;
      if (Math.abs(v) > 0.002 || Math.abs(x - target) > 0.0005) moving = true;
    }
    return moving;
  }

  function aim(state, px, py) {
    const { cx, cy, w, h, swell } = state;
    const lean = (d, half) => {
      const out = Math.abs(d) - half;
      const inner = Math.min(Math.abs(d), half) * 0.07;
      return Math.sign(d) * (inner + (out > 0 ? 9 * (1 - Math.exp(-out / 36)) : 0));
    };
    const ox = lean(px - cx, w / 2), oy = lean(py - cy, h / 2);
    const ax = Math.abs(ox) / w, ay = Math.abs(oy) / h;
    state.t.x = ox;
    state.t.y = oy;
    state.t.sx = swell * (1 + ax * 0.55) / (1 + ay * 0.25);
    state.t.sy = swell * (1 + ay * 0.55) / (1 + ax * 0.25);
  }

  let flexRaf = 0, flexT = 0;
  function flexFrame(now) {
    flexRaf = 0;
    const dt = Math.min((now - flexT) / 1000, 0.064);
    flexT = now;
    for (const [el, s] of pressing) {
      const moving = spring(s, dt);
      el.style.translate = `${s.p.x.toFixed(2)}px ${s.p.y.toFixed(2)}px`;
      el.style.scale = `${s.p.sx.toFixed(4)} ${s.p.sy.toFixed(4)}`;
      if (!moving && !s.held) {
        pressing.delete(el);
        el.style.translate = '';
        el.style.scale = '';
        el.classList.remove('is-flexing');
      }
    }
    if (pressing.size) flexRaf = requestAnimationFrame(flexFrame);
  }
  const runFlex = () => {
    if (flexRaf) return;
    flexT = performance.now();
    flexRaf = requestAnimationFrame(flexFrame);
  };

  function press(el, e) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    // The frame at rest, whatever a spring still has it doing.
    let s = pressing.get(el);
    const w = el.offsetWidth, h = el.offsetHeight;
    const tx = s ? s.p.x : 0, ty = s ? s.p.y : 0;
    const cx = r.left + r.width / 2 - tx, cy = r.top + r.height / 2 - ty;
    const swell = parseFloat(cs.getPropertyValue('--press')) || 1.08;
    if (!s) {
      s = { p: { x: 0, y: 0, sx: 1, sy: 1 }, v: { x: 0, y: 0, sx: 0, sy: 0 }, t: { x: 0, y: 0, sx: 1, sy: 1 } };
      pressing.set(el, s);
    }
    Object.assign(s, { held: true, id: e.pointerId, cx, cy, w, h, swell });
    el.classList.add('is-flexing');
    aim(s, e.clientX, e.clientY);
    runFlex();
  }
  function release(el) {
    const s = pressing.get(el);
    if (!s) return;
    s.held = false;
    s.t = { x: 0, y: 0, sx: 1, sy: 1 };
    runFlex();
  }
  // Let go at once, without the spring (a control that turns into something else).
  Liquid.still = function (el) {
    if (!pressing.has(el)) return;
    pressing.delete(el);
    el.style.translate = '';
    el.style.scale = '';
    el.classList.remove('is-flexing');
  };
  Liquid.pressing = (el) => pressing.has(el);

  /* ---------- Light ---------- */

  const lit = new Map(); // el → { anim, near: [els] }

  // Glass close enough to share the light: in the same bar, within a short gap.
  function neighbours(el) {
    const bar = el.closest('.navbar, .tabbar, .accessory, .sheet-header, .tests-head') || el.parentElement;
    if (!bar) return [];
    const r = el.getBoundingClientRect();
    const out = [];
    for (const n of bar.querySelectorAll('.glass')) {
      if (n === el || n.contains(el) || el.contains(n) || n.classList.contains('lg-neck')) continue;
      const q = n.getBoundingClientRect();
      if (!q.width || !q.height) continue;
      const gx = Math.max(q.left - r.right, r.left - q.right, 0);
      const gy = Math.max(q.top - r.bottom, r.top - q.bottom, 0);
      if (Math.hypot(gx, gy) <= 28) out.push(n);
    }
    return out;
  }

  function lightUp(el, x, y) {
    dim(el, true);
    const r = el.getBoundingClientRect();
    const reach = Math.hypot(r.width, r.height) + 40;
    el.classList.add('is-lit');
    const anim = el.animate([{ '--glow-r': '16px' }, { '--glow-r': reach.toFixed(0) + 'px' }], { duration: 520, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'forwards' });
    const near = neighbours(el).map((n) => {
      const q = n.getBoundingClientRect();
      // The light enters the neighbour at the point of it nearest the touch.
      const nx = clamp(x, q.left, q.right) - q.left, ny = clamp(y, q.top, q.bottom) - q.top;
      n.style.setProperty('--mx', nx.toFixed(1) + 'px');
      n.style.setProperty('--my', ny.toFixed(1) + 'px');
      n.classList.add('is-near');
      const a = n.animate([{ '--glow-r': '0px' }, { '--glow-r': '0px', offset: 0.25 }, { '--glow-r': Math.max(q.height, 40).toFixed(0) + 'px' }],
        { duration: 600, easing: 'ease-out', fill: 'forwards' });
      return { n, a };
    });
    lit.set(el, { anim, near });
  }
  function dim(el, now) {
    const l = lit.get(el);
    if (!l) return;
    lit.delete(el);
    el.classList.remove('is-lit');
    for (const { n } of l.near) n.classList.remove('is-near');
    // The light fades (glass.css, 0.4 s); the reach it had stays until it has.
    const clear = () => {
      if (lit.has(el)) return;
      l.anim.cancel();
      l.near.forEach(({ a }) => a.cancel());
    };
    if (now) clear();
    else setTimeout(clear, 450);
  }

  /* ---------- Wiring ---------- */

  let held = null;
  document.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    // A group of buttons is one piece of glass: it is the glass that answers.
    const el = e.target && e.target.closest ? e.target.closest('.glass.interactive, .nav-group.glass') : null;
    if (!el || el.disabled || el.closest('[inert]')) return;
    held = { el, id: e.pointerId };
    lightUp(el, e.clientX, e.clientY);
    if (!reduced()) press(el, e);
  }, { capture: true, passive: true });
  document.addEventListener('pointermove', (e) => {
    if (!held || e.pointerId !== held.id) return;
    const s = pressing.get(held.el);
    if (s && s.held) {
      aim(s, e.clientX, e.clientY);
      runFlex();
    }
  }, { passive: true });
  const up = (e) => {
    if (!held || e.pointerId !== held.id) return;
    const el = held.el;
    held = null;
    release(el);
    dim(el);
  };
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);
})();
