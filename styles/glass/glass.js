/*
  Liquid Glass optics.

  The shape of each lens comes from a shader (lens.js): a refraction map and a
  specular light layer rendered for the element's exact rounded outline. This
  file applies them to live content.

  The refraction is done by the browser's compositor, through an SVG filter in
  backdrop-filter (Chromium): a light frost → bend, once per colour channel
  with a different strength, so what the rim shows splits into a colour fringe.
  Where that is not available the material falls back to blur, tint and a CSS rim.

  Two rules keep it honest:

  - A lens must never sit inside another element that has a backdrop filter.
    Such a lens can only see its parent's own contents, so the bent image would
    be painted over the unbent original and everything would appear twice.
    Glass that hosts controls (the tab bar, sheets) is therefore a separate
    layer beside its content, not a wrapper around it.

  - A lens has to be right in every frame, not only once an animation has ended.
    It is made of corner pieces that keep their size and edges that stretch
    (lens.js), so following an element through a resize only means moving the
    pieces: nothing is re-rendered and nothing is pulled out of shape.

  - The filter runs again for every frame in which something moves behind the
    glass, so it is kept short, and it is reserved for the chrome that floats
    over content: bars, menus, sheets, a knob while it is held. Glass that is
    repeated through content (the heart on every card) or rests on the page's own
    background takes the shader's light but not the lens — see Glass.shine. It has
    no backdrop pass at all: each one is a separate render of what is behind it, on
    every frame of a scroll or of a page sliding in, to blur what is already smooth.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { clamp } = NT.util;
  const Glass = (NT.glass = {});

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const isChromium = /Chrome\/|HeadlessChrome\//.test(navigator.userAgent);
  Glass.refraction = isChromium && !!(window.CSS && CSS.supports('backdrop-filter', 'url(#a)')) && NT.lens.available();
  document.documentElement.classList.toggle('lg-refract', Glass.refraction);

  const DEFAULTS = {
    bezel: 16,        // widest the bevel may get, px
    bevel: 0.24,      // bevel width as a share of the element's shorter side
    bend: 1.6,        // how far the very edge reaches into the glass, in bevel widths
    tilt: 80,         // lean of the surface at the very edge, degrees
    curve: 2,         // how quickly the bevel levels out toward the flat face
    ior: 1.5,         // glass
    light: -124,      // the way the key light comes from, degrees (0 right, 90 below): upper left
    bounce: 0.72,     // how bright its reflection is on the far side of the rim
    rim: 0.24,        // how bright the rim is where neither light falls on it
    shade: 1,         // the darkened band inside the rim, which lets a slab read as glass on a plain backdrop
    crisp: false,     // the map drawn at 2× (lens.js), for a rim that bends sharply
    magnify: 0.03,    // whole-surface magnification
    dispersion: 0.12, // how much more blue bends than red (below 0: red bends more, a cyan fringe)
    saturate: 1.35,
    blur: null,       // fixed frost in px; null follows the Clear … Tinted preference
    haze: 0,          // frost in px that glass has while it is only beginning to be there, and
                      // that clears as it arrives (a knob lifting out of its face)
    frost: null,      // [px at Clear, px added by Tinted]; null picks by material
    lens: true,       // false: shader light only, no refraction filter
    // Where thick glass differs (--lg-t at 1); null: the same as above.
    magnifyThick: null,
    dispersionThick: null,
    frostThick: null, // [px at Clear, px added by Tinted]; null: that of menus
    frostThin: null,  // the same for the thin end, where it is not a plain control's (a menu growing into a sheet)
  };
  const lerp = (a, b, t) => a + (b - a) * t;

  // A knob lifted into glass is all bevel: a droplet. It bends gently from edge to
  // centre, magnifying what it rests on instead of folding it over at the rim.
  Glass.drop = (opts) => Object.assign({ bevel: 0.5, bend: 0.5, curve: 1.3, dispersion: 0.2, blur: 0.25, saturate: 1.1 }, opts);

  const entries = new Map(); // element → record
  const cache = new Map(); // corner geometry → Promise of a lens (see NT.lens.render)
  let defs = null;
  let seq = 0;

  const make = (name, attrs) => {
    const node = document.createElementNS(SVG_NS, name);
    for (const k of Object.keys(attrs)) node.setAttribute(k, attrs[k]);
    return node;
  };

  function ensureDefs() {
    if (defs) return defs;
    const svg = make('svg', { width: '0', height: '0', 'aria-hidden': 'true' });
    svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
    defs = make('defs', {});
    svg.append(defs);
    document.body.append(svg);
    return defs;
  }

  // One row of a saturation matrix: the output channel `i` of saturate(s).
  function saturationRow(i, s) {
    const luma = [0.213, 0.715, 0.072];
    return luma.map((l, j) => +(l * (1 - s) + (i === j ? s : 0)).toFixed(4));
  }

  // The lens an element of this size calls for. Only the corner matters: its radius,
  // and the bevel, which is narrower on small glass.
  function shapeOf(entry) {
    const o = entry.opts, side = Math.min(entry.w, entry.h);
    const bezel = Math.round(clamp(side * o.bevel, 3, o.bezel));
    // The edge may look as far in as the middle of the glass, never out the other side.
    const reach = +Math.min(bezel * o.bend, side * 0.48).toFixed(2);
    return { radius: entry.r, bezel, throw: reach };
  }

  // Set an attribute only when it changes: every write makes the browser rebuild the filter.
  function attr(node, name, value) {
    const seen = node._seen || (node._seen = {});
    if (seen[name] === value) return;
    seen[name] = value;
    node.setAttribute(name, value);
  }

  const density = () => clamp(Math.round((window.devicePixelRatio || 1) * 2) / 2, 1, 2);
  const keyOf = (shape) => [shape.radius, shape.bezel, shape.throw, shape.tilt, shape.curve, shape.ior, shape.light, shape.bounce, shape.rim, shape.shade, shape.crisp ? 1 : 0, shape.dpr].join('/');

  /*
    Rendering a lens reads pixels back from the GPU, which holds the page up for
    10–30 ms: a dropped frame or two if it lands in the first frames of a page sliding
    in. So the shapes this app has used are remembered, and rendered again while the
    next visit is still loading (Glass.warm). After that a new page finds its lenses ready.
  */
  const SHAPES_KEY = 'nt.lens.shapes';
  let known = NT.util.store.get(SHAPES_KEY, null);
  if (!Array.isArray(known)) known = [];
  // Shapes remembered before the light could be given were lit the usual way.
  known = known.map((s) => Object.assign({ light: DEFAULTS.light, bounce: DEFAULTS.bounce, rim: DEFAULTS.rim, shade: DEFAULTS.shade, crisp: DEFAULTS.crisp }, s));
  const knownKeys = new Set(known.map((s) => keyOf(Object.assign({ dpr: 0 }, s))));

  function lensFor(shape, key) {
    let pending = cache.get(key);
    if (!pending) {
      pending = NT.lens.render(shape);
      if (cache.size > 140) cache.delete(cache.keys().next().value);
      cache.set(key, pending);
      const plain = Object.assign({}, shape, { dpr: 0 });
      const k = keyOf(plain);
      if (!knownKeys.has(k)) {
        knownKeys.add(k);
        delete plain.dpr;
        known.push(plain);
        if (known.length > 60) known.shift();
        NT.util.store.set(SHAPES_KEY, known);
      }
    }
    return pending;
  }

  // Render every remembered shape, one per turn of the event loop so the page stays live.
  Glass.warm = async function () {
    if (!Glass.refraction) return;
    const dpr = density();
    for (const plain of known.slice()) {
      const shape = Object.assign({}, plain, { dpr });
      const key = keyOf(shape);
      if (cache.has(key)) continue;
      await lensFor(shape, key);
      await new Promise((next) => setTimeout(next));
    }
  };

  // Render (or reuse) the lens for the element's current shape and attach it.
  const fullShape = (entry, size) => {
    const o = entry.opts;
    return Object.assign(shapeOf(size ? Object.assign({}, entry, size) : entry), { tilt: o.tilt * Math.PI / 180, curve: o.curve, ior: o.ior, light: o.light, bounce: o.bounce, rim: o.rim, shade: o.shade, crisp: o.crisp, dpr: density() });
  };
  function wear(entry, lens, key) {
    const el = entry.el;
    entry.key = key;
    entry.lens = lens;
    entry.pieces.forEach((node, i) => attr(node, 'href', lens.pieces[i]));
    if (entry.ramp) attr(entry.ramp, 'href', NT.lens.ramp());
    el.style.setProperty('--glass-spec', `url("${lens.spec}")`);
    el.style.setProperty('--glass-slice', lens.slice);
    fit(entry);
    if (el.classList.contains('has-spec')) return;
    // Its light is the shader's from now on, at once: the ease there is on that light is
    // for a change of tone, and would otherwise run on every piece of glass as it is made
    // (in the dark theme, whose light is dimmer, each would arrive too bright and settle).
    el.classList.add('has-spec', 'spec-snap');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('spec-snap')));
  }

  function apply(entry) {
    if (!entry.w || !entry.h || entry.hold) return;
    const shape = fullShape(entry);
    const key = keyOf(shape);
    // Already wearing this lens. (Counting the turn drops one still on its way for a
    // shape the element has since left.)
    if (key === entry.key) return void entry.turn++;
    const pending = lensFor(shape, key);
    const turn = ++entry.turn;
    pending.then((lens) => {
      if (!lens) return void cache.delete(key);
      if (turn !== entry.turn) return; // the element has changed shape again since
      wear(entry, lens, key);
    });
  }

  // Render now the lens a shape will need, { w, h, r }, and wear it once `anim` (the
  // growth toward that shape) is `at` ms in: a panel still growing takes it once it is
  // nearly there, rather than after it has come to rest, where the change would show.
  // It goes by the animation's own time, so a frame held still is still the right one.
  Glass.lensTo = function (el, size, anim, at) {
    const entry = entries.get(el);
    if (!entry) return;
    const w = Math.round(size.w), h = Math.round(size.h);
    const r = Math.round(Math.min(size.r, w / 2, h / 2) * 2) / 2;
    const shape = fullShape(entry, { w, h, r });
    const key = keyOf(shape);
    const turn = ++entry.turn;
    entry.next = { key, lens: null, anim: anim || null, at: at || 0, turn };
    lensFor(shape, key).then((lens) => {
      if (!entry.next || entry.next.turn !== turn) return;
      if (!lens) return void (entry.next = null);
      entry.next.lens = lens;
      due(entry);
    });
    follow(el);
  };
  function due(entry) {
    const next = entry.next;
    if (!next) return;
    if (next.turn !== entry.turn) return void (entry.next = null);
    if (!next.lens) return;
    const a = next.anim;
    const over = !a || a.playState === 'finished' || a.playState === 'idle';
    if (!over && (Number(a.currentTime) || 0) < next.at) return;
    entry.next = null;
    entry.hold = false;
    wear(entry, next.lens, next.key);
  }

  /*
    Fit the attached lens to the element as it is right now. This runs on every frame
    of a resize and only moves things: the corners go to the element's corners and the
    slivers of edge between them stretch to fill, so the lens follows the shape through
    the whole animation instead of catching up when it ends.

    A lens made for a different corner (a menu still growing out of a small button) is
    scaled to the current one, and bends in proportion.
  */
  function fit(entry) {
    const { lens, w, h, el } = entry;
    if (!lens || !w || !h) return;
    const now = shapeOf(entry);
    const k = Math.max(now.radius, now.bezel) / lens.corner;
    const corner = lens.cut * k;
    // Corners too big to fit side by side shrink together; CSS does the same for the light.
    const cut = (lens.specCut * k).toFixed(2) + 'px';
    if (cut !== entry.cut) el.style.setProperty('--glass-cut', (entry.cut = cut));
    if (!entry.filter) return;

    const c = Math.round(Math.min(corner, w / 2, h / 2));
    const xs = [0, Math.min(c, w >> 1)], ys = [0, Math.min(c, h >> 1)];
    xs.push(w - Math.min(c, w - xs[1]), w);
    ys.push(h - Math.min(c, h - ys[1]), h);
    // Pieces overlap where they meet, so no seam opens between them at any scale: a
    // corner carries one pixel more of the edge beside it (lens.js), drawn at the
    // corner's own scale, and an edge, the same all along, reaches as far under the
    // corners at its ends.
    const px = lens.cut * (lens.mapScale || 1); // a corner's size in its image's pixels
    const ex = [xs[1] / px, (w - xs[2]) / px], ey = [ys[1] / px, (h - ys[2]) / px];
    const span = (at, more, k) => [at[k] - (k > 0 ? more[k - 1] : 0), at[k + 1] + (k < 2 ? more[k] : 0)];
    entry.pieces.forEach((node, i) => {
      const col = [0, 1, 2, 0, 2, 0, 1, 2][i], row = [0, 0, 0, 1, 1, 2, 2, 2][i];
      const shown = xs[col + 1] > xs[col] && ys[row + 1] > ys[row];
      const [x0, x1] = span(xs, ex, col), [y0, y1] = span(ys, ey, row);
      // A piece with nothing to cover is parked outside the filter's area.
      attr(node, 'x', shown ? +x0.toFixed(2) : -4);
      attr(node, 'y', shown ? +y0.toFixed(2) : -4);
      attr(node, 'width', shown ? +(x1 - x0).toFixed(2) : 1);
      attr(node, 'height', shown ? +(y1 - y0).toFixed(2) : 1);
    });

    // Whole-surface magnification is the ramp, laid over the map at a fraction `a` of
    // full strength. That leaves the lens's own shifts at 1 − a, so the filter bends by
    // that much more to restore them.
    const o = entry.opts, t = entry.t;
    // Glass materializes by bending more and more light, never by fading (glass.css).
    const presence = clamp(entry.k, 0, 1.25);
    const a = entry.ramp ? NT.lens.rampAlpha : 0;
    const scale = lens.reach * (now.throw / lens.throw) * 2 / (1 - a);
    // Thick glass may split colour less. Where it no longer splits at all, the filter
    // drops to one pass (shape): the three would cost a large surface its frames.
    const spread = o.dispersion !== 0 ? lerp(o.dispersion, o.dispersionThick == null ? o.dispersion : o.dispersionThick, t) : 0;
    shape(entry, Math.abs(spread) >= 0.004);
    const split = entry.passes.length > 1 ? spread : 0;
    entry.passes.forEach((node, i) => attr(node, 'scale', (scale * presence * (1 + (i - 1) * split)).toFixed(2)));
    tint(entry);
    if (entry.ramp) {
      // The ramp falls from 1 to 0 across its width and shifts by scale · a at full
      // value. Drawn scale · a / magnify px wide and centred on the element, it moves
      // every point by magnify × its distance from the centre. The edges of a very
      // large surface would ask for more than the ramp can give: there it is eased off.
      const most = scale * a * NT.lens.rampMost;
      const wanted = Math.max(1e-4, lerp(o.magnify, o.magnifyThick == null ? o.magnify : o.magnifyThick, t));
      const magnify = Math.min(wanted, most / (Math.max(w, h) / 2));
      const span = +(scale * a / magnify / NT.lens.rampSpan).toFixed(1);
      attr(entry.ramp, 'x', +(w / 2 - span / 2).toFixed(1));
      attr(entry.ramp, 'y', +(h / 2 - span / 2).toFixed(1));
      attr(entry.ramp, 'width', span);
      attr(entry.ramp, 'height', span);
    }
  }

  // Frosting happens inside the filter (Chromium does not reliably apply blur()
  // chained after an SVG reference), so it follows the Clear … Tinted preference here.
  // It stays light: Liquid Glass bends light rather than scattering it.
  function frost(entry) {
    if (!entry.blur) return;
    const o = entry.opts;
    let amount = o.blur;
    if (amount == null) {
      const at = ([base, span]) => base + NT.prefs.data.frost * span;
      // Glass that carries text diffuses more of what is under it than a clear control
      // does, and glass that grows into such a surface gains it on the way.
      const regular = at(o.frost || o.frostThin || (entry.el.classList.contains('tinted') ? [2.5, 6] : [0.5, 4]));
      amount = o.frost ? regular : lerp(regular, at(o.frostThick || [3, 8]), entry.t);
    }
    const k = clamp(entry.k, 0, 1);
    // Haze is there while the glass is only beginning to be, not before it is there at all.
    const haze = o.haze * (1 - k) * Math.min(1, k * 10);
    attr(entry.blur, 'stdDeviation', (amount * k + haze).toFixed(2));
  }
  NT.bus.on('prefs', () => entries.forEach(frost));

  // The steps after the frost: one bend, or, where the glass splits colour, one for each
  // channel at a slightly different strength. Built again only when that choice changes.
  function shape(entry, split) {
    const mode = split ? 'split' : 'one';
    if (entry.mode === mode) return;
    entry.mode = mode;
    for (const node of entry.tail) node.remove();
    entry.tail = [];
    entry.passes = [];
    entry.tints = [];
    const add = (...nodes) => {
      entry.filter.append(...nodes);
      entry.tail.push(...nodes);
    };
    const bend = (result) => {
      const node = make('feDisplacementMap', { in: 'soft', in2: 'map', scale: '0', xChannelSelector: 'R', yChannelSelector: 'G', result });
      entry.passes.push(node);
      return node;
    };
    if (split) {
      // Red bends least, blue most (the other way round below 0). Each pass keeps one
      // channel (and applies that channel's share of the saturation boost, saving a
      // pass); the three are summed.
      for (let i = 0; i < 3; i++) {
        const matrix = make('feColorMatrix', { in: 'b' + i, type: 'matrix', values: '', result: 'c' + i });
        entry.tints.push(matrix);
        add(bend('b' + i), matrix);
      }
      add(make('feBlend', { in: 'c0', in2: 'c1', mode: 'screen', result: 'rg' }),
        make('feBlend', { in: 'rg', in2: 'c2', mode: 'screen' }));
    } else {
      const matrix = make('feColorMatrix', { in: 'bent', type: 'saturate', values: '1' });
      entry.tints.push(matrix);
      add(bend('bent'), matrix);
    }
  }

  // Saturation comes in with the glass: at no presence the backdrop is left as it is.
  function tint(entry) {
    const s = +lerp(1, entry.opts.saturate, clamp(entry.k, 0, 1)).toFixed(4);
    if (entry.mode === 'split') {
      entry.tints.forEach((node, i) => {
        const rows = [0, 1, 2].map((j) => (j === i ? saturationRow(i, s).join(' ') + ' 0 0' : '0 0 0 0 0'));
        attr(node, 'values', rows.join('  ') + '  0 0 0 1 0');
      });
    } else if (entry.tints[0]) attr(entry.tints[0], 'values', String(s));
  }

  /*
    Presence and thickness (--lg-k, --lg-t: glass.css). Whatever sets them, a class, an
    animation or a transition, the lens takes the same values in the same frame: an
    element whose values may be moving is read on every frame until they rest (follow).
  */
  const num = (v, d) => {
    const n = parseFloat(v);
    return isFinite(n) ? n : d;
  };
  function settleState(entry, k, t) {
    if (k === entry.k && t === entry.t) return false;
    entry.k = k;
    entry.t = t;
    frost(entry);
    fit(entry);
    return true;
  }
  function read(entry, cs = getComputedStyle(entry.el)) {
    return settleState(entry, clamp(num(cs.getPropertyValue('--lg-k'), 1), 0, 1.25), clamp(num(cs.getPropertyValue('--lg-t'), 0), 0, 1));
  }

  const live = new Set();
  let ticking = 0;
  function tick() {
    ticking = 0;
    for (const entry of live) {
      if (!entry.el.isConnected) { live.delete(entry); continue; }
      // Paused animations count too: a frame held still for a look must be right as well.
      due(entry);
      if (read(entry) || entry.el.getAnimations().length || entry.next) entry.quiet = 0;
      else if (++entry.quiet > 2) live.delete(entry);
    }
    if (live.size) ticking = requestAnimationFrame(tick);
  }
  function follow(el) {
    const entry = entries.get(el);
    if (!entry) return;
    entry.quiet = 0;
    live.add(entry);
    if (!ticking) ticking = requestAnimationFrame(tick);
  }
  document.addEventListener('transitionrun', (e) => {
    if (e.propertyName === '--lg-k' || e.propertyName === '--lg-t') follow(e.target);
  }, true);

  // Animate an element's presence and thickness: frames of { k, t, offset }.
  Glass.animate = function (el, frames, timing) {
    const keyframes = frames.map((f) => {
      const o = {};
      if (f.k != null) o['--lg-k'] = f.k;
      if (f.t != null) o['--lg-t'] = f.t;
      if (f.offset != null) o.offset = f.offset;
      return o;
    });
    const anim = el.animate(keyframes, timing);
    const entry = entries.get(el);
    if (entry) {
      // The first frame is painted before the next read, so it is given now.
      const f = frames[0];
      settleState(entry, f.k != null ? clamp(f.k, 0, 1.25) : entry.k, f.t != null ? clamp(f.t, 0, 1) : entry.t);
      follow(el);
    }
    return anim;
  };

  // Set them outright (a knob following a spring sets its lift on every frame).
  Glass.set = function (el, { k, t } = {}) {
    if (k != null) el.style.setProperty('--lg-k', (+k).toFixed(4));
    if (t != null) el.style.setProperty('--lg-t', (+t).toFixed(4));
    const entry = entries.get(el);
    if (entry) settleState(entry, k != null ? clamp(+(+k).toFixed(4), 0, 1.25) : entry.k, t != null ? clamp(+(+t).toFixed(4), 0, 1) : entry.t);
  };

  // What the lens shows now.
  Glass.state = function (el) {
    const entry = entries.get(el);
    if (entry) return { k: entry.k, t: entry.t };
    const cs = getComputedStyle(el);
    return { k: num(cs.getPropertyValue('--lg-k'), 1), t: num(cs.getPropertyValue('--lg-t'), 0) };
  };

  // How much it frosts what is behind it now, as a blur's standard deviation in px
  // (null where the lens filter does not run, and CSS frosts it instead).
  Glass.frostOf = (el) => {
    const entry = entries.get(el);
    return entry && entry.blur ? num(entry.blur.getAttribute('stdDeviation'), 0) : null;
  };

  // Other options for glass that is there already: what it is at either end of its
  // thickness changes with what it is to grow out of or go back into (a sheet that came
  // out of a menu goes back into the menu's button). Its lens is kept where the new
  // options ask for the same one.
  Glass.retune = function (el, opts) {
    const entry = entries.get(el);
    if (!entry) return;
    entry.opts = Object.assign({}, DEFAULTS, opts);
    frost(entry);
    fit(entry);
    if (!entry.hold && !entry.next) apply(entry);
  };

  // The options an element's glass was made with, for glass that is to become it.
  Glass.optsOf = (el) => {
    const entry = entries.get(el);
    return entry ? Object.assign({}, entry.opts) : null;
  };

  /*
    Wear another element's lens: exactly that one, scaled to this element's shape. A
    panel that grows out of a button starts as the button's very glass, and takes it
    back before it collapses into it, so the last frame is the button. With `hold`,
    no lens of its own is rendered meanwhile.
  */
  Glass.lensFrom = function (el, src, hold) {
    const entry = entries.get(el), from = entries.get(src);
    if (!entry || !from || !from.lens) return false;
    entry.hold = !!hold;
    clearTimeout(entry.timer);
    entry.turn++; // a lens still on its way for this element is dropped
    wear(entry, from.lens, from.key);
    return true;
  };

  function measure(entry) {
    const el = entry.el;
    const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
    if (!w || !h) return;
    const cs = getComputedStyle(el);
    const r = Math.round(Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2) * 2) / 2;
    const first = !entry.w;
    // Presence and thickness are known once the element is in the page.
    if (first) read(entry, cs);
    if (w === entry.w && h === entry.h && r === entry.r) return;
    entry.w = w;
    entry.h = h;
    entry.r = r;
    fit(entry);
    clearTimeout(entry.timer);
    if (first) return void apply(entry);
    if (entry.hold) return;
    // A change of size alone needs nothing more: the lens fits any size. If the corner
    // itself changed (a menu morphing out of a button) the lens is scaled for now, and
    // one for the new corner is rendered once the shape settles: rendering mid-animation
    // would cost the very frames the animation needs.
    entry.timer = setTimeout(() => apply(entry), 140);
  }

  const observer = window.ResizeObserver
    ? new ResizeObserver((list) => {
        for (const item of list) {
          const entry = entries.get(item.target);
          if (entry) measure(entry);
        }
      })
    : null;

  // Give an element real refraction. Safe to call repeatedly and on any browser.
  Glass.refract = function (el, opts = {}) {
    if (!Glass.refraction || !observer || entries.has(el)) return el;
    const o = Object.assign({}, DEFAULTS, opts);
    const entry = {
      el, filter: null, pieces: [], ramp: null, blur: null, passes: [], tints: [], tail: [], mode: '', opts: o,
      lens: null, key: '', cut: '', w: 0, h: 0, r: -1, timer: 0, missing: 0, turn: 0,
      k: 1, t: 0, quiet: 0, hold: false, next: null,
    };

    if (o.lens) {
      const id = 'lg-' + ++seq;
      const filter = make('filter', { id, x: '0', y: '0', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' });

      // The map is put together from the lens's corner and edge pieces, laid on neutral
      // grey: the flat face of the glass, and all of it until the lens has loaded, reads
      // "no shift" rather than throwing the backdrop aside. Pieces are placed in px: a
      // percentage would resolve against the (empty) SVG that holds the filter.
      const merge = make('feMerge', { result: 'map' });
      merge.append(make('feMergeNode', { in: 'flat' }));
      filter.append(make('feFlood', { 'flood-color': 'rgb(128,128,128)', result: 'flat' }));
      for (let i = 0; i < 8; i++) {
        const piece = make('feImage', { x: '-4', y: '-4', width: '1', height: '1', preserveAspectRatio: 'none', result: 'p' + i });
        entry.pieces.push(piece);
        filter.append(piece);
        merge.append(make('feMergeNode', { in: 'p' + i }));
      }
      if (o.magnify > 0) {
        // Magnification is laid over the pieces here rather than drawn into the lens, so
        // it is right for whatever size the element has in this frame (see fit). It goes
        // into the same merge: a separate step to add it costs several ms a frame.
        entry.ramp = make('feImage', { x: '-4', y: '-4', width: '1', height: '1', preserveAspectRatio: 'none', result: 'ramp' });
        filter.append(entry.ramp);
        merge.append(make('feMergeNode', { in: 'ramp' }));
      }
      filter.append(merge);
      const blur = make('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '0', edgeMode: 'duplicate', result: 'soft' });
      filter.append(blur);
      entry.filter = filter;
      entry.blur = blur;
      // The bend itself (shape): split into colours until the glass's thickness says not.
      shape(entry, o.dispersion !== 0);
      tint(entry);
      ensureDefs().append(filter);
      el.style.setProperty('--glass-refract', `url(#${id})`);
    }

    // Light only: no backdrop pass of any kind (see .no-lens).
    if (!o.lens) el.classList.add('no-lens');
    entries.set(el, entry);
    observer.observe(el);
    frost(entry);
    measure(entry);
    return el;
  };

  // The shader's rim light without the lens, for glass repeated through content.
  Glass.shine = (el, opts) => Glass.refract(el, Object.assign({}, opts, { lens: false }));

  // Drop records whose elements have left the document.
  setInterval(() => {
    for (const [el, entry] of entries) {
      if (el.isConnected) { entry.missing = 0; continue; }
      if (++entry.missing < 2) continue;
      observer.unobserve(el);
      clearTimeout(entry.timer);
      if (entry.filter) entry.filter.remove();
      entries.delete(el);
    }
  }, 4000);

  // Specular highlight follows the pointer across any glass surface. A finger does not
  // move before it lands, so the press itself places the light too.
  const light = (e) => {
    const el = e.target && e.target.closest ? e.target.closest('.glass') : null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', (e.clientX - r.left).toFixed(1) + 'px');
    el.style.setProperty('--my', (e.clientY - r.top).toFixed(1) + 'px');
  };
  document.addEventListener('pointermove', light, { passive: true });
  document.addEventListener('pointerdown', light, { passive: true, capture: true });

  /*
    Tone. Glass that floats at the top takes its tone from what is under it: dark
    glass with a light glyph while artwork passes beneath, back to the theme's own over
    the page. Each piece decides for itself.

    Artwork is marked where it is made (Tone.mark). What is under a piece of glass is
    then found by asking the browser which elements are painted at two or three points
    of it, so there is nothing to keep up to date as content loads, scrolls or is
    dragged sideways. All points are read before anything is written, and the only
    write is one attribute on a piece whose answer changed. A page with no artwork is
    never asked.

    Asking is cheap while the page is still (about 0.04 ms a point) but not while two
    pages slide over each other (about 0.3 ms a point, 3-5 ms a frame), so a slide is
    not asked about frame by frame. Both pages are asked once, before they move, and
    each piece then follows the edge between them by arithmetic (Tone.split).
  */
  const Tone = (NT.tone = {});
  const root = document.documentElement;
  let queued = 0;

  const isDark = (x, y) => {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el.closest('.page-scroll')) return !!el.closest('.tone-dark');
    }
    return false;
  };

  // The glass that takes a tone on these pages, and the points of each piece that are asked about.
  const glassOf = (pages) => {
    const els = [];
    for (const page of pages) els.push(...page.navbar.querySelectorAll('.navbar-side > .glass:not(.tinted), .navbar-title-pill.glass'));
    return els;
  };
  const pointsOf = (el) => {
    if (el.style.visibility === 'hidden') return null; // a menu has grown out of it; it keeps its tone
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const n = r.width > 120 ? 3 : 2;
    return Array.from({ length: n }, (_, i) => {
      const f = i / (n - 1);
      return { x: r.left + r.width * (0.3 + 0.4 * f), y: r.top + r.height * (0.4 + 0.2 * f) };
    });
  };
  const usable = () => {
    const stage = NT.dom && NT.dom.stage;
    return !!stage && !stage.inert; // under a sheet nothing moves, and nothing can be asked
  };
  const wanted = (pages) => !root.hasAttribute('data-solid') && pages.some((page) => page.art.length);

  // Glass that has only just been built or revealed arrives in its tone; it does not
  // fade to it. Such pieces hold their transitions off until settle(), which costs one
  // style flush for all of them together.
  const snapped = [];
  function set(el, dark, snap) {
    if ((el.dataset.over === 'dark') === dark) return;
    if (snap) {
      el.classList.add('tone-snap');
      snapped.push(el);
    }
    if (dark) el.dataset.over = 'dark';
    else delete el.dataset.over;
  }
  function settle() {
    if (!snapped.length) return;
    void snapped[0].offsetWidth;
    for (const el of snapped.splice(0)) el.classList.remove('tone-snap');
  }

  function pass(pages, snap) {
    if (!usable()) return;
    const bar = NT.tabbar;
    const els = glassOf(pages);
    const live = wanted(pages);
    if (bar.wide && live) els.push(...bar.chrome());
    else for (const el of bar.chrome()) set(el, false, snap);
    if (live) {
      const tones = els.map((el) => {
        const pts = pointsOf(el);
        return pts && pts.filter((p) => isDark(p.x, p.y)).length * 2 >= pts.length;
      });
      els.forEach((el, i) => { if (tones[i] != null) set(el, tones[i], snap); });
    } else for (const el of els) set(el, false, snap);
    settle();
  }

  const topPage = () => {
    const top = NT.nav && NT.nav.top();
    return top ? [top.page] : [];
  };

  // Mark an element as artwork: content that wants a light glyph over it in either theme.
  Tone.mark = (el) => {
    el.classList.add('tone-dark');
    return el;
  };

  // Look again on the next frame. Cheap to call from anything that may have moved content.
  Tone.touch = () => {
    if (queued) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      // Not while pages are sliding: that is followed by Tone.split, and the navigator
      // asks again once they have settled.
      if (NT.nav && NT.nav._pending) return;
      pass(topPage(), false);
    });
  };

  // Look now, and take the tone without a transition.
  Tone.sync = (...pages) => pass(pages, true);

  /*
    Two pages share the screen, `front` sliding across `back` with a straight edge
    between them. Call this while both are in place, before anything moves: each point
    is asked once what it shows on either page. The result's at(x) then gives every
    piece of glass its tone for the edge at x (front covers what is to the right of
    it), reading nothing from the page.
  */
  Tone.split = (front, back) => {
    const pages = [front, back];
    if (!usable() || !wanted(pages)) {
      if (usable()) pass(pages, true);
      return { at() {} };
    }
    const els = glassOf(pages);
    if (NT.tabbar.wide) els.push(...NT.tabbar.chrome());
    const pieces = [];
    for (const el of els) {
      const pts = pointsOf(el);
      if (pts) pieces.push({ el, pts });
    }
    for (const piece of pieces) {
      for (const p of piece.pts) {
        p.front = p.back = null;
        for (const el of document.elementsFromPoint(p.x, p.y)) {
          const scroll = el.closest('.page-scroll');
          if (scroll === front.scroll) { if (p.front === null) p.front = !!el.closest('.tone-dark'); }
          else if (scroll === back.scroll) { if (p.back === null) p.back = !!el.closest('.tone-dark'); }
          if (p.front !== null && p.back !== null) break;
        }
      }
    }
    return {
      at(x, snap) {
        for (const { el, pts } of pieces) {
          let dark = 0;
          for (const p of pts) if (p.x >= x ? p.front : p.back) dark++;
          set(el, dark * 2 >= pts.length, snap);
        }
        settle();
      },
    };
  };

  window.addEventListener('resize', Tone.touch, { passive: true });
  NT.bus.on('prefs', Tone.touch);

  // A new theme is every colour at once, in one frame. Anything that eases its colour
  // (a label, a row's fill) would otherwise be the old theme's for a moment on the new
  // one's surface: light words on a light card.
  let theme = root.dataset.theme;
  NT.bus.on('prefs', () => {
    if (root.dataset.theme === theme) return;
    theme = root.dataset.theme;
    root.classList.add('tone-snap');
    void root.offsetWidth;
    root.classList.remove('tone-snap');
  });
  // A new accent eases instead: the accent is one colour going over to the next
  // (--accent, tokens.css), so nothing is ever two accents at once. What took the accent
  // as a value while it was on its way (the editor's own colours) takes it again once
  // it is there.
  root.addEventListener('transitionend', (e) => {
    if (e.target === root && e.propertyName === '--accent') NT.bus.emit('prefs', NT.prefs.data);
  });

  // What the core asks a style for (js/styles.js). Monaco's popups take the same
  // material and lens as the app's own menus.
  NT.look = {
    // The code's well is set 10px into its card (app.css, .code-well): with this the
    // first line is as far from the card's edge as it was.
    codeOptions: { padding: { top: 4, bottom: 4 } },
    pane(el) {
      el.classList.add('glass', 'thick');
      Glass.refract(el, { bezel: 18, magnify: 0.008, dispersion: 0 });
    },
  };
})();
