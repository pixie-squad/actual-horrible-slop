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
    repeated through content (the heart on every card) takes the shader's light
    but not the lens — see Glass.shine.
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
    magnify: 0.03,    // whole-surface magnification
    dispersion: 0.12, // how much more blue bends than red
    saturate: 1.35,
    blur: null,       // fixed frost in px; null follows the Clear … Tinted preference
    lens: true,       // false: shader light only, no refraction filter
  };

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

  // Render (or reuse) the lens for the element's current shape and attach it.
  function apply(entry) {
    const { opts: o, el } = entry;
    if (!entry.w || !entry.h) return;
    const dpr = clamp(Math.round((window.devicePixelRatio || 1) * 2) / 2, 1, 2);
    const shape = Object.assign(shapeOf(entry), { tilt: o.tilt * Math.PI / 180, curve: o.curve, ior: o.ior, dpr });
    const key = Object.values(shape).join('/');
    // Already wearing this lens. (Counting the turn drops one still on its way for a
    // shape the element has since left.)
    if (key === entry.key) return void entry.turn++;
    let pending = cache.get(key);
    if (!pending) {
      pending = NT.lens.render(shape);
      if (cache.size > 140) cache.delete(cache.keys().next().value);
      cache.set(key, pending);
    }
    const turn = ++entry.turn;
    Promise.all([pending, entry.ramp ? NT.lens.ramp() : null]).then(([lens, ramp]) => {
      if (!lens) return void cache.delete(key);
      if (turn !== entry.turn) return; // the element has changed shape again since
      entry.key = key;
      entry.lens = lens;
      entry.pieces.forEach((node, i) => attr(node, 'href', lens.pieces[i]));
      if (ramp) attr(entry.ramp, 'href', ramp);
      el.style.setProperty('--glass-spec', `url("${lens.spec}")`);
      el.style.setProperty('--glass-slice', lens.slice);
      fit(entry);
      el.classList.add('has-spec');
    });
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
    entry.pieces.forEach((node, i) => {
      const col = [0, 1, 2, 0, 2, 0, 1, 2][i], row = [0, 0, 0, 1, 1, 2, 2, 2][i];
      const pw = xs[col + 1] - xs[col], ph = ys[row + 1] - ys[row];
      const shown = pw > 0 && ph > 0;
      // A piece with nothing to cover is parked outside the filter's area.
      attr(node, 'x', shown ? xs[col] : -4);
      attr(node, 'y', shown ? ys[row] : -4);
      attr(node, 'width', shown ? pw : 1);
      attr(node, 'height', shown ? ph : 1);
    });

    // Whole-surface magnification is the ramp, laid over the map at a fraction `a` of
    // full strength. That leaves the lens's own shifts at 1 − a, so the filter bends by
    // that much more to restore them.
    const o = entry.opts;
    const a = entry.ramp ? NT.lens.rampAlpha : 0;
    const scale = lens.reach * (now.throw / lens.throw) * 2 / (1 - a);
    const spread = entry.passes.length > 1 ? o.dispersion : 0;
    entry.passes.forEach((node, i) => attr(node, 'scale', (scale * (1 + (i - 1) * spread)).toFixed(2)));
    if (entry.ramp) {
      // The ramp falls from 1 to 0 across its width and shifts by scale · a at full
      // value. Drawn scale · a / magnify px wide and centred on the element, it moves
      // every point by magnify × its distance from the centre. The edges of a very
      // large surface would ask for more than the ramp can give: there it is eased off.
      const most = scale * a * NT.lens.rampMost;
      const magnify = Math.min(o.magnify, most / (Math.max(w, h) / 2));
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
    const amount = o.blur != null ? o.blur : entry.el.classList.contains('thick') ? 6 : 0.5 + NT.prefs.data.frost * 4;
    entry.blur.setAttribute('stdDeviation', amount.toFixed(2));
  }
  NT.bus.on('prefs', () => entries.forEach(frost));

  function measure(entry) {
    const el = entry.el;
    const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
    if (!w || !h) return;
    const r = Math.round(Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2) * 2) / 2;
    if (w === entry.w && h === entry.h && r === entry.r) return;
    const first = !entry.w;
    entry.w = w;
    entry.h = h;
    entry.r = r;
    fit(entry);
    clearTimeout(entry.timer);
    if (first) return void apply(entry);
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
    const entry = { el, filter: null, pieces: [], ramp: null, blur: null, passes: [], opts: o, lens: null, key: '', cut: '', w: 0, h: 0, r: -1, timer: 0, missing: 0, turn: 0 };

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

      const bend = (result) => {
        const node = make('feDisplacementMap', { in: 'soft', in2: 'map', scale: '0', xChannelSelector: 'R', yChannelSelector: 'G', result });
        entry.passes.push(node);
        return node;
      };
      if (o.dispersion > 0) {
        // Red bends least, blue most. Each pass keeps one channel (and applies that
        // channel's share of the saturation boost, saving a pass); the three are summed.
        for (let i = 0; i < 3; i++) {
          const rows = [0, 1, 2].map((j) => (j === i ? saturationRow(i, o.saturate).join(' ') + ' 0 0' : '0 0 0 0 0'));
          filter.append(bend('b' + i), make('feColorMatrix', { in: 'b' + i, type: 'matrix', values: rows.join('  ') + '  0 0 0 1 0', result: 'c' + i }));
        }
        filter.append(
          make('feBlend', { in: 'c0', in2: 'c1', mode: 'screen', result: 'rg' }),
          make('feBlend', { in: 'rg', in2: 'c2', mode: 'screen' }));
      } else {
        filter.append(bend('bent'), make('feColorMatrix', { in: 'bent', type: 'saturate', values: String(o.saturate) }));
      }
      ensureDefs().append(filter);
      entry.filter = filter;
      entry.blur = blur;
      el.style.setProperty('--glass-refract', `url(#${id})`);
    }

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

  // Specular highlight follows the pointer across any glass surface.
  document.addEventListener('pointermove', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('.glass') : null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', (e.clientX - r.left).toFixed(1) + 'px');
    el.style.setProperty('--my', (e.clientY - r.top).toFixed(1) + 'px');
  }, { passive: true });
})();
