/*
  Liquid Glass's side of thumbnails and avatars (js/media.js reads and writes them).

    NT.media.editable(el, kind, id, label)
                                   → el with a glass badge on its lower edge that opens
                                     the items to choose and remove that image (el itself
                                     when there are none)

  and the tone of top glass over bright images.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h } = NT.util;
  const Media = NT.media;

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

  // A picture arrived, changed or went (media.js): what is over it may need another tone.
  NT.bus.on('art', () => tone.touch());
})();
