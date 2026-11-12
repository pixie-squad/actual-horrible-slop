/*
  Real thumbnails and avatars, kept as text in scripts (pack.js).

  Covers and avatars are drawn from an id by each style's pages. Each one is handed
  to this file as it is built; if there is an image for it, that takes the generated
  art's place, in that element and every other one showing it.

    NT.media.cover(el, script)     → el (script: a list item, or the script itself)
    NT.media.avatar(el, userId)    → el
    NT.media.items(kind, id)       → menu items to choose and remove that image:
                                     [choose] or [choose, remove], [] when it cannot be set here
                                     (a script's, only once its cover has been built)

  How the control that opens those items looks is the style's own. An element shown
  as an image has the class art-on and its colour in --art; one the style marked
  tone-dark is tone-light instead while a bright image is on it, and 'art' is said on
  NT.bus whenever that changes.

  kind is 'thumbs' (by script id) or 'avatars' (by user id). Whether the person may
  change an image is the caller's to know; the upstream checks it again, since the
  image is written into a script of theirs.

  Where an image is: in a holder, a script of its owner's that has one block and
  nothing else (api.js). None of it is in the script it belongs to, whose
  1,000,000 characters stay its code's.

    thumbs    <script name>.meta.thumb, published when its script is. At most 96 KB.
                --[=[nt:thumb for=<script id> v=<version> color=<rrggbb> type=webp
                <the image, in base64>
                ]=]
    avatars   pfp.meta, published. The same block (nt:face, no `for`), at most 32 KB.

  Only still PNG, JPEG and WebP are shown, decided from the bytes, and the size is
  read from the image's own header before anything is decoded: the text is someone
  else's. `color` is the image's average colour as its uploader measured it; it is a
  placeholder while the image loads and decides the contrast of anything drawn on it.

  - Holders are found by name in the lists of scripts already read, so what has no
    image costs no request, and no script is read for its thumbnail but the holder.
  - Reading an image means reading its holder, so each answer is kept in this
    browser (IndexedDB, nt-media) under the holder's stamp: its id and when it was
    updated and published. A holder is read again only once that changes. Lookups
    run four at a time, for what is on the page first.
  - The generated art is on screen until an image has been decoded; nothing is ever
    blank and nothing changes size.
  - An image is shown with its average colour behind it. That colour also says
    whether it is a bright image, for whatever the style rests on it.
  - Opened from disk or on demo data this does nothing at all: no requests, no controls.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h } = NT.util;
  const API = NT.api;
  const Pack = NT.pack;
  const Media = (NT.media = {});

  const ID = /^[A-Za-z0-9_-]{1,64}$/;
  const KINDS = {
    // side: the longest side worth keeping. shape: width over height. maxBytes: the
    // largest image written; one up to `reads` is still shown.
    thumbs: { name: 'Thumbnail', block: 'thumb', shape: 16 / 9, side: 960, maxBytes: 96 * 1024, reads: 256 * 1024, maxSide: 1600, minSide: 64 },
    avatars: { name: 'Photo', block: 'face', shape: 1, side: 320, maxBytes: 32 * 1024, reads: 96 * 1024, maxSide: 512, minSide: 32 },
  };
  const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
  const SHORT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  // Above this relative luminance an image carries dark type better than light.
  const BRIGHT = 0.36;
  // The stamp of what was set or removed in this tab: it holds until the page is loaded again.
  const LOCAL = 'here';

  // Demo data has made-up ids and no account to upload as.
  const on = () => API.mode === 'live' && !!API.session;
  // What an image's holders looked like when it was read: it is read again once that changes.
  const stampOf = (holders) => (holders.some((t) => t.stamp === LOCAL) ? LOCAL : holders.map((t) => t.stamp).sort().join(' '));
  const version = (body) => NT.util.hash(body).toString(36) + (body.length % 1296).toString(36);

  /* ---------- Reading image headers ---------- */

  // → { ext, width, height } of a still PNG, JPEG or WebP, or null for anything else.
  function sniff(b) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const tag = (at, n) => String.fromCharCode.apply(null, b.subarray(at, at + n));
    try {
      if (b.length >= 8 && v.getUint32(0) === 0x89504e47 && v.getUint32(4) === 0x0d0a1a0a) return png(b, v, tag);
      if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return jpeg(b, v);
      if (b.length >= 12 && tag(0, 4) === 'RIFF' && tag(8, 4) === 'WEBP') return webp(b, v, tag);
    } catch (e) { /* cut short */ }
    return null;
  }

  function png(b, v, tag) {
    // Chunks are length, type, data, CRC. IHDR is first; an APNG announces itself with
    // acTL before the first image data, so walking up to IDAT is enough.
    let at = 8, size = null;
    while (at + 12 <= b.length) {
      const len = v.getUint32(at), type = tag(at + 4, 4), data = at + 8;
      if (data + len + 4 > b.length) break;
      if (!size) {
        if (type !== 'IHDR' || len !== 13) break;
        size = [v.getUint32(data), v.getUint32(data + 4)];
      } else if (type === 'acTL') break;
      else if (type === 'IDAT') return { ext: 'png', width: size[0], height: size[1] };
      at = data + len + 4;
    }
    return null;
  }

  function jpeg(b, v) {
    // Marker segments up to the frame header, which holds the size. Each segment is
    // FF, a marker byte, and a length that counts itself; RSTn and TEM have no length.
    let at = 2;
    while (at + 4 <= b.length) {
      if (b[at] !== 0xff) break;
      const marker = b[at + 1];
      if (marker === 0xff) { at++; continue; } // fill byte
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
      if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) break; // no frame before the scan
      const len = v.getUint16(at + 2);
      if (len < 2 || at + 2 + len > b.length) break;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        // A frame header: precision, height, width. Only the kinds a browser decodes:
        // baseline, extended and progressive.
        if (marker > 0xc2 || len < 8) break;
        return { ext: 'jpg', width: v.getUint16(at + 7), height: v.getUint16(at + 5) };
      }
      at += 2 + len;
    }
    return null;
  }

  function webp(b, v, tag) {
    // A RIFF container. A still image is one VP8 (lossy) or VP8L (lossless) chunk,
    // optionally after a VP8X header that gives the canvas size and says whether it animates.
    const end = 8 + v.getUint32(4, true);
    if (end > b.length) return null;
    const u24 = (i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
    let at = 12, canvas = null;
    while (at + 8 <= end) {
      const type = tag(at, 4), len = v.getUint32(at + 4, true), data = at + 8;
      if (data + len > end) break;
      if (type === 'ANIM' || type === 'ANMF') break;
      if (type === 'VP8X') {
        if (at !== 12 || len < 10 || b[data] & 0x02) break;
        canvas = [u24(data + 4) + 1, u24(data + 7) + 1];
      } else if (type === 'VP8 ' || type === 'VP8L') {
        let size = null;
        if (type === 'VP8 ') {
          // A 3-byte frame tag (bit 0 clear on a key frame), the start code 9d 01 2a,
          // then width and height in 14 bits each.
          if (len >= 10 && !(b[data] & 1) && b[data + 3] === 0x9d && b[data + 4] === 0x01 && b[data + 5] === 0x2a) {
            size = [v.getUint16(data + 6, true) & 0x3fff, v.getUint16(data + 8, true) & 0x3fff];
          }
        } else if (len >= 5 && b[data] === 0x2f) {
          // The signature 2f, then width-1 and height-1 in 14 bits each, alpha, and a version of 0.
          const bits = v.getUint32(data + 1, true);
          if (bits >>> 29 === 0) size = [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
        }
        if (!size || (canvas && (canvas[0] !== size[0] || canvas[1] !== size[1]))) break;
        return { ext: 'webp', width: size[0], height: size[1] };
      }
      at = data + len + (len & 1);
    }
    return null;
  }

  // A block as the image it holds: { v, color, type, bytes }, or null when it is not
  // one that is shown here.
  function image(kind, block) {
    const k = KINDS[kind];
    if (!block || !block.body || block.body.length > k.reads * 1.4) return null;
    const bytes = Pack.bytes(block);
    const img = bytes && sniff(bytes);
    if (!img || !(img.width > 0 && img.height > 0) || Math.max(img.width, img.height) > k.maxSide) return null;
    const head = block.head || {};
    return {
      v: /^[0-9a-z]{1,16}$/.test(head.v) ? head.v : version(block.body),
      color: /^[0-9a-f]{6}$/.test(head.color) ? head.color : null,
      type: TYPES[img.ext],
      bytes,
    };
  }

  /* ---------- What was read before ---------- */

  // key → { key, stamp, t, v, color, type, bytes }, or { key, stamp, t, none: true }.
  // Without IndexedDB every call answers null and nothing is kept.
  const KEEP = 600;
  const cache = (() => {
    let opening = null;
    const open = () => opening || (opening = new Promise((resolve) => {
      try {
        const req = indexedDB.open('nt-media', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('art', { keyPath: 'key' }).createIndex('t', 't');
        req.onsuccess = () => resolve(req.result);
        req.onerror = req.onblocked = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    }));
    const run = async (mode, job) => {
      const db = await open();
      if (!db) return null;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction('art', mode);
          const req = job(tx.objectStore('art'));
          tx.oncomplete = () => resolve((req && req.result) || null);
          tx.onerror = tx.onabort = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    };
    return {
      get: (key) => run('readonly', (s) => s.get(key)),
      put: (rec) => run('readwrite', (s) => void s.put(Object.assign({ t: Date.now() }, rec))),
      remove: (key) => run('readwrite', (s) => void s.delete(key)),
      // The newest KEEP stay.
      trim: () => run('readwrite', (s) => {
        const count = s.count();
        count.onsuccess = () => {
          let extra = count.result - KEEP;
          if (extra > 0) s.index('t').openCursor().onsuccess = (e) => {
            const at = e.target.result;
            if (!at || extra-- <= 0) return;
            at.delete();
            at.continue();
          };
        };
      }),
    };
  })();
  setTimeout(() => { if (on()) cache.trim(); }, 10000);

  /* ---------- What exists ---------- */

  const known = new Map();   // 'thumbs/<id>' → { stamp, info }; info is null when it has no image
  const scripts = new Map(); // script id → { script_id, author_uuid, name, published_at } as last shown: what finds its holder
  const waiting = new Map(); // key → { els, stamp }: the elements to patch when its answer arrives
  const queue = [];          // the keys being asked about, oldest first
  const urls = new Map();    // key → { v, url }: the picture it last had, as an address
  const AT_ONCE = 4;
  let running = 0, pumping = false;

  // An image as it is shown: { v, color, light, url }.
  function made(key, img) {
    let u = urls.get(key);
    if (!u || u.v !== img.v) {
      // The one before may still be on screen until every copy has been repainted.
      if (u) { const old = u.url; setTimeout(() => URL.revokeObjectURL(old), 30000); }
      u = { v: img.v, url: URL.createObjectURL(new Blob([img.bytes], { type: img.type })) };
      urls.set(key, u);
    }
    return { v: img.v, color: img.color, light: !!img.color && luminance(img.color) > BRIGHT, url: u.url };
  }

  // → { stamp, info } for one key, from this browser's copy when its holder has not
  // changed since, otherwise from the holder. Rejects when the holder cannot be read.
  async function find(kind, id, key) {
    let holders, read;
    if (kind === 'avatars') {
      const face = await API.face(id);
      holders = face ? [face] : [];
      read = async () => (await API.blocks(face.id)).blocks[KINDS[kind].block];
    } else {
      const s = scripts.get(id);
      holders = (s && (await API.thumbsOf(s))) || [];
      // Scripts named alike have holders named alike: the one that names this script is its own.
      read = async () => ((await API.thumbOf(s)) || {}).block;
    }
    if (!holders.length) return { stamp: '', info: null };
    const stamp = stampOf(holders);
    const have = known.get(key);
    if (have && have.stamp === stamp) return have;
    const saved = stamp !== LOCAL ? await cache.get(key) : null;
    if (saved && saved.stamp === stamp) return { stamp, info: saved.none ? null : made(key, saved) };
    const img = image(kind, await read());
    if (stamp !== LOCAL) cache.put(img ? { key, stamp, v: img.v, color: img.color, type: img.type, bytes: img.bytes } : { key, stamp, none: true });
    return { stamp, info: img ? made(key, img) : null };
  }

  async function look(key) {
    const cut = key.indexOf('/');
    const asked = waiting.get(key).stamp;
    let found = null;
    try {
      found = await find(key.slice(0, cut), key.slice(cut + 1), key);
    } catch (e) {
      // Gone, or not ours to read: no image. Anything else is asked again by a later render.
      if (e && (e.status === 403 || e.status === 404)) found = { stamp: asked || '', info: null };
    }
    const w = waiting.get(key);
    waiting.delete(key);
    if (!found) return;
    // An image set or removed here while the question was out is newer than the answer.
    const have = known.get(key);
    if (have && have.stamp === LOCAL) found = have;
    publish(key, found);
    for (const el of w.els) if (!el.isConnected) paint(el, key, found.info, false);
  }

  function pump() {
    pumping = false;
    while (running < AT_ONCE && queue.length) {
      // What is on the page goes first. What was asked for by a page that has gone
      // since is not asked at all: a later render asks again.
      const i = queue.findIndex((key) => waiting.get(key).els.some((el) => el.isConnected));
      if (i < 0) {
        for (const key of queue.splice(0)) waiting.delete(key);
        return;
      }
      const key = queue.splice(i, 1)[0];
      running++;
      const next = () => { running--; pump(); };
      look(key).then(next, next);
    }
  }

  // script: for a thumbnail, the script it is of.
  function attach(el, kind, id, script) {
    id = String(id == null ? '' : id);
    if (!on() || !ID.test(id) || (kind === 'thumbs' && !script.author_uuid)) return el;
    const key = `${kind}/${id}`;
    el.setAttribute('data-art', key);
    if (el.classList.contains('tone-dark')) artwork.add(el);
    let holders;
    if (kind === 'avatars') {
      const face = API.peekFace(id);
      holders = face && [face];
    } else {
      scripts.set(id, { script_id: id, author_uuid: script.author_uuid, name: script.name, published_at: script.published_at });
      holders = API.peekThumb(script);
    }
    // Whether there is an image at all is usually known from the lists already read.
    if (holders === null) {
      known.delete(key);
      return el;
    }
    const stamp = holders ? stampOf(holders) : undefined;
    const have = known.get(key);
    // What was last seen is shown at once; whether it still holds is asked behind it.
    if (have) paint(el, key, have.info, true);
    if (have && (have.stamp === LOCAL || have.stamp === stamp)) return el;
    let w = waiting.get(key);
    if (!w) {
      waiting.set(key, (w = { els: [], stamp }));
      queue.push(key);
    }
    w.els.push(el);
    w.stamp = stamp;
    // After the render that is building this element has put it on the page.
    if (!pumping) {
      pumping = true;
      queueMicrotask(pump);
    }
    return el;
  }

  Media.cover = (el, script) => (script ? attach(el, 'thumbs', script.script_id, script) : el);
  Media.avatar = (el, userId) => attach(el, 'avatars', userId);

  // Someone else's images are not this person's.
  NT.bus.on('session', () => known.clear());

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
  const drawn = new WeakMap(); // element → the generated art its picture stands in for
  const artwork = new WeakSet(); // covers a style marked tone-dark: what rests on them follows how bright they are

  // The pictures seen most recently, one spare Image for each. While it is held the
  // browser keeps its copy of the picture, decoded, so a list that is rebuilt or
  // scrolled again draws from that instead of decoding each one again (measured: 30
  // thumbnails cost about 160 ms of decoding per pass without this). It is also how
  // a picture that does not decode is heard about.
  const held = new Map(); // address → Image, oldest first
  const HOLD = 64;
  function hold(key, info) {
    const src = info.url;
    let img = held.get(src);
    held.delete(src);
    if (!img) {
      img = new Image();
      // Not a picture after all: back to the generated art wherever it shows, and it
      // is not asked about again until its script changes.
      img.addEventListener('error', () => {
        held.delete(src);
        const have = known.get(key);
        if (have && have.info && have.info.url === src) known.set(key, { stamp: have.stamp, info: null });
        for (const el of document.querySelectorAll(`[data-art="${key}"]`)) if (arts.get(el) === info.v) strip(el);
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
  function show(el, info) {
    if (!drawn.has(el)) drawn.set(el, el.style.background);
    el.style.background = `url("${info.url}") center / cover no-repeat, ${info.color ? '#' + info.color : 'var(--fill-2)'}`;
    // The colour again, by name: the shade under a cover's type is mixed from it (media.css).
    if (info.color) el.style.setProperty('--art', '#' + info.color);
    else el.style.removeProperty('--art');
    el.classList.add('art-on');
    if (!artwork.has(el) || el.classList.contains('tone-light') === info.light) return;
    el.classList.toggle('tone-dark', !info.light);
    el.classList.toggle('tone-light', info.light);
    NT.bus.emit('art');
  }

  // Back to the generated art.
  function strip(el) {
    if (!arts.has(el)) return;
    arts.delete(el);
    if (!drawn.has(el)) return; // its picture never arrived
    el.style.background = drawn.get(el);
    drawn.delete(el);
    el.style.removeProperty('--art');
    el.classList.remove('art-on');
    if (!artwork.has(el) || !el.classList.contains('tone-light')) return;
    el.classList.add('tone-dark');
    el.classList.remove('tone-light');
    NT.bus.emit('art');
  }

  // fresh: the element is still being built, and starts out as the image (its colour,
  // until the picture is there). Otherwise it is on screen as something else, which
  // stays until the new picture has been decoded and can take its place in one frame.
  function paint(el, key, info, fresh) {
    if (!info) return void strip(el);
    const was = arts.get(el);
    arts.set(el, info.v);
    const spare = hold(key, info);
    if (fresh || (was === info.v && el.classList.contains('art-on'))) return void show(el, info);
    const land = () => { if (arts.get(el) === info.v) show(el, info); };
    spare.decode().then(land, land);
  }

  // The answer for a key has changed here: every element showing it follows.
  function publish(key, found) {
    known.set(key, found);
    for (const el of document.querySelectorAll(`[data-art="${key}"]`)) paint(el, key, found.info, false);
  }

  /* ---------- Choosing, writing, removing ---------- */

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

  // The file as it is kept: cropped about its centre to the kind's shape, no larger
  // than is useful, re-encoded (which also drops whatever the camera wrote into the
  // file) and within `most` bytes: first by quality, then by size. → { blob, color }
  async function prepare(file, kind, most) {
    const k = KINDS[kind];
    let bmp;
    try { bmp = await createImageBitmap(file); } catch (e) { throw new Error('not-image'); }
    try {
      let cw = bmp.width, ch = bmp.height;
      if (cw / ch > k.shape) cw = Math.round(ch * k.shape);
      else ch = Math.round(cw / k.shape);
      if (Math.min(cw, ch) < k.minSide) throw new Error('too-small');
      const fit = Math.min(1, k.side / Math.max(cw, ch));
      for (let scale = fit; ; scale *= 0.75) {
        const w = Math.round(cw * scale), t = Math.round(ch * scale);
        if (Math.min(w, t) < k.minSide) throw new Error('no-room');
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
          if (blob && blob.size <= most) return { blob, color: average(canvas) };
        }
      }
    } finally {
      bmp.close();
    }
  }

  const FAILED = {
    'not-image': 'That isn’t an image',
    'too-small': 'That image is too small',
    'no-room': 'That image is too large',
  };

  async function upload(kind, id, file) {
    const key = `${kind}/${id}`;
    if (busy.has(key)) return;
    busy.add(key);
    // Said only if it takes long enough to wonder about.
    const slow = setTimeout(() => NT.ui.toast('Uploading…', { icon: 'upload', duration: 60000 }), 700);
    try {
      const k = KINDS[kind];
      const { blob, color } = await prepare(file, kind, k.maxBytes);
      const block = Pack.block({}, new Uint8Array(await blob.arrayBuffer()));
      block.head = { v: version(block.body), color, type: SHORT[blob.type] || 'webp' };
      let hidden = false;
      // The holder there is now, wherever it was made, is the one written.
      if (kind === 'thumbs') {
        const s = scripts.get(id);
        block.head = Object.assign({ for: id }, block.head);
        await API.userScripts(s.author_uuid);
        const had = await API.thumbOf(s);
        const out = await API.hold(had ? had.id : null, { name: API.thumbName(s.name), content: Pack.join('', { [k.block]: block }), publish: !!s.published_at });
        API.setThumb(s, had && had.id, { id: out.id, stamp: LOCAL, published: out.published });
        hidden = !!s.published_at && !out.published;
      } else {
        await API.userScripts(id);
        const had = API.peekFace(id);
        const out = await API.hold(had ? had.id : null, { name: API.FACE, content: Pack.join('', { [k.block]: block }), publish: true });
        API.setFace(id, { id: out.id, stamp: LOCAL, published: out.published });
        hidden = !out.published;
      }
      const img = image(kind, block);
      if (!img) throw new Error('unreadable');
      cache.remove(key);
      const info = made(key, img);
      // Decoded once here, so every copy on screen changes in the same frame.
      await hold(key, info).decode().catch(() => {});
      publish(key, { stamp: LOCAL, info });
      if (hidden) NT.ui.toast(`${k.name} saved, but not published`, { warn: true });
      else NT.ui.toast(`${k.name} updated`);
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
      if (kind === 'thumbs') {
        const s = scripts.get(id);
        await API.userScripts(s.author_uuid);
        const had = await API.thumbOf(s);
        if (had) await API.drop(had.id);
        API.setThumb(s, had && had.id, null);
      } else {
        await API.userScripts(id);
        const had = API.peekFace(id);
        if (had) await API.drop(had.id);
        API.setFace(id, null);
      }
      cache.remove(key);
      publish(key, { stamp: LOCAL, info: null });
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
      input = h('input', { type: 'file', hidden: true, tabIndex: -1, accept: Object.values(TYPES).join(',') });
      input.addEventListener('change', () => {
        const file = input.files[0];
        input.value = '';
        if (file && target) upload(target.kind, target.id, file);
      });
      document.body.append(input);
    }
    target = { kind, id };
    input.click();
  }

  Media.items = function (kind, id) {
    id = String(id == null ? '' : id);
    if (!on() || !KINDS[kind] || !ID.test(id) || (kind === 'thumbs' && !scripts.has(id))) return [];
    const name = KINDS[kind].name;
    const items = [{ label: `Choose ${name}…`, icon: 'photo', onSelect: () => choose(kind, id) }];
    if ((known.get(`${kind}/${id}`) || {}).info) items.push({ label: `Remove ${name}`, icon: 'xmark', danger: true, onSelect: () => remove(kind, id) });
    return items;
  };
})();
