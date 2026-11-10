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
  const cache = new Map(); // lens geometry → Promise<{ map, spec, reach }>
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

  // Render (or reuse) the lens for the element's current shape and attach it.
  function apply(entry) {
    const { w, h, r, opts: o, el } = entry;
    if (!w || !h) return;
    const side = Math.min(w, h);
    const bezel = Math.round(clamp(side * o.bevel, 3, o.bezel));
    // The edge may look as far in as the middle of the glass, never out the other side.
    const reach = Math.min(bezel * o.bend, side * 0.48);
    // Large surfaces (sheets) get their light layer at 1× to keep the image small.
    const dpr = w * h > 120000 ? 1 : clamp(Math.round((window.devicePixelRatio || 1) * 2) / 2, 1, 2);
    const shape = { w, h, radius: r, bezel, throw: +reach.toFixed(2), tilt: o.tilt * Math.PI / 180, curve: o.curve, ior: o.ior, magnify: o.magnify, dpr };
    const key = Object.values(shape).join('/');
    let pending = cache.get(key);
    if (!pending) {
      pending = NT.lens.render(shape);
      if (cache.size > 140) cache.delete(cache.keys().next().value);
      cache.set(key, pending);
    }
    const turn = ++entry.turn;
    pending.then((lens) => {
      if (!lens) return void cache.delete(key);
      if (turn !== entry.turn) return; // the element has changed shape again since
      if (entry.image) {
        entry.image.setAttribute('href', lens.map);
        const scale = lens.reach * 2;
        const spread = entry.passes.length > 1 ? o.dispersion : 0;
        entry.passes.forEach((node, i) => node.setAttribute('scale', (scale * (1 + (i - 1) * spread)).toFixed(2)));
      }
      el.style.setProperty('--glass-spec', `url("${lens.spec}")`);
      el.classList.add('has-spec');
    });
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
    const r = Math.round(Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2));
    if (w === entry.w && h === entry.h && r === entry.r) return;
    const first = !entry.w;
    entry.w = w;
    entry.h = h;
    entry.r = r;
    if (entry.image) {
      // The map is sized in px: a percentage here resolves against the (empty) SVG that
      // holds the filter rather than the element, and the map would not be drawn at all.
      entry.image.setAttribute('width', w);
      entry.image.setAttribute('height', h);
    }
    if (first) return void apply(entry);
    // While an element is being resized (morphs, the tab bar collapsing) the current
    // lens simply stretches with it. A fresh one is rendered once the size settles:
    // rendering mid-animation would cost the very frames the animation needs.
    clearTimeout(entry.timer);
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
    const entry = { el, filter: null, image: null, blur: null, passes: [], opts: o, w: 0, h: 0, r: -1, timer: 0, missing: 0, turn: 0 };

    if (o.lens) {
      const id = 'lg-' + ++seq;
      const filter = make('filter', { id, x: '0', y: '0', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' });

      // The map is laid on neutral grey, so until it has loaded (and wherever it does
      // not reach) the filter reads "no shift" rather than throwing the backdrop aside.
      const image = make('feImage', { x: '0', y: '0', width: '1', height: '1', preserveAspectRatio: 'none', result: 'lens' });
      const merge = make('feMerge', { result: 'map' });
      merge.append(make('feMergeNode', { in: 'flat' }), make('feMergeNode', { in: 'lens' }));
      const blur = make('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '0', edgeMode: 'duplicate', result: 'soft' });
      filter.append(make('feFlood', { 'flood-color': 'rgb(128,128,128)', result: 'flat' }), image, merge, blur);

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
      entry.image = image;
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
