/*
  Real thumbnails and avatars, where the server keeps them (ext/media.js).

  Covers and avatars are drawn from an id (pages.js). Each one is handed to this
  file as it is built; if someone has uploaded an image for that id it takes the
  generated art's place, in that element and every other one showing it.

    NT.media.cover(el, scriptId)   → el
    NT.media.avatar(el, userId)    → el
    NT.media.items(kind, id)       → menu items to choose and remove that image:
                                     [choose] or [choose, remove], [] when it cannot be set here
    NT.media.editable(el, kind, id, label)
                                   → el with a glass badge on its lower edge that opens
                                     those items (el itself when there are none)

  kind is 'thumbs' (by script id) or 'avatars' (by user id). Whether the person may
  change an image is the caller's to know; the server checks it again.

  - Most ids have no image, so what a render asks about goes out as one question,
    and the answers are kept for the session. The generated art is on screen until
    an image has been decoded; nothing is ever blank and nothing changes size.
  - An image is shown with its average colour behind it. That colour also says
    whether it is a bright image: type and glass resting on it then turn dark, and
    top glass passing over it takes the light tone (see Tone below).
  - Without the extension, opened from disk or on demo data this does nothing at
    all: no requests, no controls.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h } = NT.util;
  const Media = (NT.media = {});

  const ID = /^[A-Za-z0-9_-]{1,64}$/;
  const KINDS = {
    // side: the longest side worth keeping. shape: width over height.
    thumbs: { name: 'Thumbnail', shape: 16 / 9, side: 1280, maxBytes: 512 * 1024, maxSide: 1600, minSide: 64 },
    avatars: { name: 'Photo', shape: 1, side: 384, maxBytes: 256 * 1024, maxSide: 512, minSide: 32 },
  };
  // Above this relative luminance an image carries dark type better than light.
  const BRIGHT = 0.36;

  // Demo data has made-up ids and no account to upload as.
  const on = () => NT.ext.has('media') && NT.api.mode === 'live';
  const about = () => NT.ext.info('media');
  const address = (key, v) => NT.ext.url(`/media/${key}`) + (v ? `?v=${v}` : '');

  /* ---------- What exists ---------- */

  const known = new Map(); // 'thumbs/<id>' → { v, color }, or null when it has no image
  const waiting = new Map(); // key → the elements to patch when its answer arrives
  const unsent = new Set();
  let queued = false;

  // What the server said about one image, checked: { v, color, light }.
  function valid(info) {
    if (!info || !/^[0-9a-f]{12}$/.test(info.v)) return null;
    const color = /^[0-9a-f]{6}$/.test(info.color) ? info.color : null;
    return { v: info.v, color, light: !!color && luminance(color) > BRIGHT };
  }

  async function ask(part) {
    let found = null;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(NT.ext.url('/media/lookup'), {
        method: 'POST', credentials: 'include', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(part),
      });
      clearTimeout(timer);
      if (res.ok) found = await res.json();
    } catch (e) { /* offline: the generated art stays, and a later render asks again */ }
    for (const kind of Object.keys(KINDS)) {
      for (const id of part[kind]) {
        const key = `${kind}/${id}`;
        const els = waiting.get(key) || [];
        waiting.delete(key);
        if (!found) continue;
        // An image set or removed here while the question was out is newer than the answer.
        if (!known.has(key)) known.set(key, valid(found[kind] && Object.hasOwn(found[kind], id) && found[kind][id]));
        for (const el of els) paint(el, key, known.get(key), false);
      }
    }
  }

  // Everything one render asked about, in as few questions as the server's limit allows.
  function flush() {
    queued = false;
    const ids = { thumbs: [], avatars: [] };
    for (const key of unsent) {
      const cut = key.indexOf('/');
      ids[key.slice(0, cut)].push(key.slice(cut + 1));
    }
    unsent.clear();
    const most = about().lookupMax || 500;
    while (ids.thumbs.length || ids.avatars.length) ask({ thumbs: ids.thumbs.splice(0, most), avatars: ids.avatars.splice(0, most) });
  }

  function attach(el, kind, id) {
    id = String(id == null ? '' : id);
    if (!on() || !ID.test(id)) return el;
    const key = `${kind}/${id}`;
    el.setAttribute('data-art', key);
    if (el.classList.contains('tone-dark')) artwork.add(el);
    if (known.has(key)) {
      paint(el, key, known.get(key), true);
      return el;
    }
    if (!waiting.has(key)) {
      waiting.set(key, []);
      unsent.add(key);
    }
    waiting.get(key).push(el);
    if (!queued) {
      queued = true;
      queueMicrotask(flush);
    }
    return el;
  }

  Media.cover = (el, scriptId) => attach(el, 'thumbs', scriptId);
  Media.avatar = (el, userId) => attach(el, 'avatars', userId);

  /* ---------- Showing an image ----------
     The picture is the element's own background, over its average colour: no element
     is added, so nothing in the cover or the avatar has to move or be restacked. It
     is written where the generated art was, as one more inline style, and that is
     what keeps a card as cheap to build with a picture as without. Measured in the
     frame a grid adds 18 cards while scrolling, as style work over generated art:
     this, about 1.5 ms; the picture handed to the stylesheet in a custom property,
     about 3.5 ms (what is inside each cover inherits it, and is then styled cover by
     cover); an <img> in each, a fifth more time for the whole build. */

  const arts = new WeakMap(); // element → the version it shows, or is about to
  const made = new WeakMap(); // element → the generated art its picture stands in for
  const artwork = new WeakSet(); // covers that top glass takes a tone from (NT.tone.mark)

  // The pictures seen most recently, one spare Image for each. While it is held the
  // browser keeps its copy of the picture, decoded, so a list that is rebuilt or
  // scrolled again draws from that instead of fetching and decoding each one again
  // (measured: 30 thumbnails cost about 160 ms of decoding per pass without this).
  // It is also how a picture that has gone missing is heard about.
  const held = new Map(); // address → Image, oldest first
  const HOLD = 64;
  function hold(key, v) {
    const src = address(key, v);
    let img = held.get(src);
    held.delete(src);
    if (!img) {
      img = new Image();
      // Removed since it was asked about: back to the generated art wherever it
      // shows, and the next render asks again.
      img.addEventListener('error', () => {
        held.delete(src);
        const info = known.get(key);
        if (info && info.v === v) known.delete(key);
        for (const el of document.querySelectorAll(`[data-art="${key}"]`)) if (arts.get(el) === v) strip(el);
      }, { once: true });
      img.src = src;
    }
    held.set(src, img);
    if (held.size > HOLD) held.delete(held.keys().next().value);
    return img;
  }

  function luminance(hex) {
    const n = parseInt(hex, 16);
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * lin((n >> 16) / 255) + 0.7152 * lin(((n >> 8) & 255) / 255) + 0.0722 * lin((n & 255) / 255);
  }

  // The element as that image: the picture where the generated art was, its colour
  // behind it, and the tone the colour calls for.
  function show(el, key, info) {
    if (!made.has(el)) made.set(el, el.style.background);
    el.style.background = `url("${address(key, info.v)}") center / cover no-repeat, ${info.color ? '#' + info.color : 'var(--fill-2)'}`;
    // The colour again, by name: the shade under a cover's type is mixed from it (media.css).
    if (info.color) el.style.setProperty('--art', '#' + info.color);
    else el.style.removeProperty('--art');
    el.classList.add('art-on');
    if (!artwork.has(el) || el.classList.contains('tone-light') === info.light) return;
    el.classList.toggle('tone-dark', !info.light);
    el.classList.toggle('tone-light', info.light);
    NT.tone.touch();
  }

  // Back to the generated art.
  function strip(el) {
    if (!arts.has(el)) return;
    arts.delete(el);
    if (!made.has(el)) return; // its picture never arrived
    el.style.background = made.get(el);
    made.delete(el);
    el.style.removeProperty('--art');
    el.classList.remove('art-on');
    if (!artwork.has(el) || !el.classList.contains('tone-light')) return;
    el.classList.add('tone-dark');
    el.classList.remove('tone-light');
    NT.tone.touch();
  }

  // fresh: the element is still being built, and starts out as the image (its colour,
  // until the picture is there). Otherwise it is on screen as something else, which
  // stays until the new picture has been decoded and can take its place in one frame.
  function paint(el, key, info, fresh) {
    if (!info) return void strip(el);
    const was = arts.get(el);
    arts.set(el, info.v);
    const spare = hold(key, info.v);
    if (fresh || (was === info.v && el.classList.contains('art-on'))) return void show(el, key, info);
    const land = () => { if (arts.get(el) === info.v) show(el, key, info); };
    spare.decode().then(land, land);
  }

  // The answer for a key has changed here: every element showing it follows.
  function publish(key, info) {
    known.set(key, info);
    for (const el of document.querySelectorAll(`[data-art="${key}"]`)) paint(el, key, info, false);
  }

  /* ---------- Choosing, uploading, removing ---------- */

  const busy = new Set();

  const encode = (canvas, type, quality) => new Promise((done) => canvas.toBlob(done, type, quality));

  // The mean colour of a canvas, as rrggbb.
  function average(canvas) {
    const small = h('canvas', { width: 16, height: 16 });
    const g = small.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(canvas, 0, 0, 16, 16);
    const px = g.getImageData(0, 0, 16, 16).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += px[i + c];
    return sum.map((s) => Math.round(s / 256).toString(16).padStart(2, '0')).join('');
  }

  // The file as the server wants it: cropped about its centre to the kind's shape,
  // no larger than is useful, re-encoded (which also drops whatever the camera wrote
  // into the file) and within the size limit. → { blob, color }
  async function prepare(file, kind) {
    const k = Object.assign({}, KINDS[kind], about()[kind]);
    let bmp;
    try { bmp = await createImageBitmap(file); } catch (e) { throw new Error('not-image'); }
    try {
      let cw = bmp.width, ch = bmp.height;
      if (cw / ch > k.shape) cw = Math.round(ch * k.shape);
      else ch = Math.round(cw / k.shape);
      if (Math.min(cw, ch) < k.minSide) throw new Error('too-small');
      const fit = Math.min(1, Math.min(k.side, k.maxSide) / Math.max(cw, ch));
      for (let scale = fit; ; scale *= 0.75) {
        const w = Math.round(cw * scale), t = Math.round(ch * scale);
        if (Math.min(w, t) < k.minSide) throw new Error('too-large');
        const canvas = h('canvas', { width: w, height: t });
        const g = canvas.getContext('2d', { alpha: false });
        // A see-through picture is flattened onto white, as it would sit on a page.
        g.fillStyle = '#fff';
        g.fillRect(0, 0, w, t);
        g.imageSmoothingQuality = 'high';
        g.drawImage(bmp, (bmp.width - cw) / 2, (bmp.height - ch) / 2, cw, ch, 0, 0, w, t);
        for (const quality of [0.86, 0.7, 0.5]) {
          let blob = await encode(canvas, 'image/webp', quality);
          // A browser that cannot write WebP hands back a PNG instead.
          if (!blob || blob.type !== 'image/webp') blob = await encode(canvas, 'image/jpeg', quality);
          if (blob && blob.size <= k.maxBytes) return { blob, color: average(canvas) };
        }
      }
    } finally {
      bmp.close();
    }
  }

  const FAILED = {
    'not-image': 'That isn’t an image',
    'too-small': 'That image is too small',
    429: 'Too many uploads. Try again later.',
  };

  async function upload(kind, id, file) {
    const key = `${kind}/${id}`;
    if (busy.has(key)) return;
    busy.add(key);
    // Said only if it takes long enough to wonder about.
    const slow = setTimeout(() => NT.ui.toast('Uploading…', { icon: 'upload', duration: 60000 }), 700);
    try {
      const { blob, color } = await prepare(file, kind);
      const res = await fetch(`${address(key)}?color=${color}`, { method: 'PUT', credentials: 'include', body: blob });
      if (!res.ok) throw new Error(String(res.status));
      const info = valid(await res.json());
      if (!info) throw new Error('bad-answer');
      // Fetched and decoded once here, so every copy on screen changes in the same frame.
      await hold(key, info.v).decode().catch(() => {});
      publish(key, info);
      NT.ui.toast(`${KINDS[kind].name} updated`);
    } catch (e) {
      NT.ui.toast(FAILED[e.message] || 'Couldn’t upload', { warn: true });
    } finally {
      clearTimeout(slow);
      busy.delete(key);
    }
  }

  async function remove(kind, id) {
    const key = `${kind}/${id}`;
    if (busy.has(key)) return;
    busy.add(key);
    try {
      const res = await fetch(address(key), { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(String(res.status));
      publish(key, null);
      NT.ui.toast(`${KINDS[kind].name} removed`, { icon: 'trash' });
    } catch (e) {
      NT.ui.toast('Couldn’t remove', { warn: true });
    } finally {
      busy.delete(key);
    }
  }

  // One hidden file input serves every picker.
  let input = null, target = null;
  function choose(kind, id) {
    if (!input) {
      input = h('input', { type: 'file', hidden: true, tabIndex: -1 });
      input.addEventListener('change', () => {
        const file = input.files[0];
        input.value = '';
        if (file && target) upload(target.kind, target.id, file);
      });
      document.body.append(input);
    }
    input.accept = (about().types || ['image/png', 'image/jpeg', 'image/webp']).join(',');
    target = { kind, id };
    input.click();
  }

  Media.items = function (kind, id) {
    id = String(id == null ? '' : id);
    if (!on() || !NT.api.session || !KINDS[kind] || !ID.test(id)) return [];
    const name = KINDS[kind].name;
    const items = [{ label: `Choose ${name}…`, icon: 'photo', onSelect: () => choose(kind, id) }];
    if (known.get(`${kind}/${id}`)) items.push({ label: `Remove ${name}`, icon: 'xmark', danger: true, onSelect: () => remove(kind, id) });
    return items;
  };

  // The picture is content and stays where it is, in view while its replacement is
  // chosen. What turns into the menu is a control of a control's size: a badge of glass
  // on the picture's lower edge, on its centre line, so the menu opens centred under it.
  // A tap anywhere on the picture counts as a tap on the badge.
  Media.editable = function (el, kind, id, label) {
    if (!Media.items(kind, id).length) return el;
    const badge = h('button.art-badge.glass.thick.interactive', { type: 'button', 'aria-label': label, title: label, 'aria-haspopup': 'menu' }, NT.icon('pencil', 16));
    NT.glass.refract(badge, { bezel: 9, magnify: 0.008 });
    const wrap = h('span.art-edit', el, badge);
    wrap.addEventListener('click', () => {
      const [pick, drop] = Media.items(kind, id);
      if (pick) NT.ui.menu(badge, [pick, drop && '-', drop], { align: 'center' });
    });
    return wrap;
  };

  /*
    Tone over bright images.

    NT.tone (glass.js) knows one kind of artwork: generated covers and dark images,
    marked tone-dark, over which top glass turns dark with a light glyph. A bright
    image is the opposite case. In the light theme the glass over it is right as it
    is; in the dark theme it has to turn light, with a dark glyph. That third tone,
    data-over="light", is kept here, alongside NT.tone and by the same rules: what is
    under each piece is read before anything is written, a slide is asked about once
    before it starts and then followed by arithmetic, and dark wins where both apply.
    NT.tone never clears a light piece; this does, right after each of its passes.

    What is under a piece is worked out from where the bright artwork lies, not by
    asking the browser what is painted at a point: on a list that scrolls, those
    questions doubled the hit-testing done in every frame (measured), and artwork is
    never covered by anything else in its page.
  */
  const root = document.documentElement;
  const TOP_GLASS = '.navbar-side > .glass:not(.tinted), .navbar-title-pill.glass';
  const brightOf = new WeakMap(); // page → live list of its bright artwork

  const bright = (page) => {
    let list = brightOf.get(page);
    if (!list) brightOf.set(page, (list = page.scroll.getElementsByClassName('tone-light')));
    return list;
  };
  const wanted = (pages) => root.dataset.theme === 'dark' && !root.hasAttribute('data-solid') && pages.some((page) => bright(page).length);
  const usable = () => !!(NT.dom && NT.dom.stage) && !NT.dom.stage.inert;
  const glassOf = (pages) => {
    const els = [];
    for (const page of pages) els.push(...page.navbar.querySelectorAll(TOP_GLASS));
    return els;
  };
  const centre = (el) => {
    if (el.style.visibility === 'hidden') return null; // a menu has grown out of it; it keeps its tone
    const r = el.getBoundingClientRect();
    return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  };
  const boxes = (page) => Array.from(bright(page), (el) => el.getBoundingClientRect());
  const within = (rects, p) => rects.some((r) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom);

  const snapped = [];
  function set(el, light, snap) {
    const over = el.dataset.over;
    if (over === 'dark' || (over === 'light') === light) return;
    if (snap) {
      el.classList.add('tone-snap');
      snapped.push(el);
    }
    if (light) el.dataset.over = 'light';
    else delete el.dataset.over;
  }
  function settle() {
    if (!snapped.length) return;
    void snapped[0].offsetWidth;
    for (const el of snapped.splice(0)) el.classList.remove('tone-snap');
  }

  function pass(pages, snap) {
    if (!usable()) return;
    const live = wanted(pages);
    const bar = NT.tabbar.chrome();
    const els = glassOf(pages);
    if (NT.tabbar.wide) els.push(...bar);
    const rects = live ? pages.flatMap(boxes) : [];
    const tones = els.map((el) => {
      const p = live && centre(el);
      return live ? p && within(rects, p) : false;
    });
    els.forEach((el, i) => { if (tones[i] != null) set(el, tones[i], snap); });
    if (!NT.tabbar.wide) for (const el of bar) set(el, false, snap);
    settle();
  }

  const tone = NT.tone;
  const { touch, sync, split } = tone;
  let frame = 0;

  tone.touch = () => {
    touch();
    if (frame) return;
    // Asked for after NT.tone's own frame, so this pass sees what that one decided.
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (NT.nav && NT.nav._pending) return;
      const top = NT.nav && NT.nav.top();
      pass(top ? [top.page] : [], false);
    });
  };

  tone.sync = (...pages) => {
    sync(...pages);
    pass(pages, true);
  };

  tone.split = (front, back) => {
    const dark = split(front, back);
    const pages = [front, back];
    if (!usable() || !wanted(pages)) {
      if (usable()) pass(pages, true);
      return dark;
    }
    const els = glassOf(pages);
    if (NT.tabbar.wide) els.push(...NT.tabbar.chrome());
    const ahead = boxes(front), behind = boxes(back);
    const pieces = [];
    for (const el of els) {
      const p = centre(el);
      if (p) pieces.push({ el, x: p.x, front: within(ahead, p), back: within(behind, p) });
    }
    return {
      at(x, snap) {
        dark.at(x, snap);
        for (const piece of pieces) set(piece.el, piece.x >= x ? piece.front : piece.back, snap);
        settle();
      },
    };
  };

  // NT.tone hears these itself, and only looks again on a scroll when the page has
  // artwork of its own kind.
  window.addEventListener('resize', () => tone.touch(), { passive: true });
  NT.bus.on('prefs', () => tone.touch());
  document.addEventListener('scroll', () => {
    const top = NT.nav && NT.nav.top();
    if (top && wanted([top.page])) tone.touch();
  }, { capture: true, passive: true });
})();
