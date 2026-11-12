/*
  Windows XP's icons. They are Windows XP's own pictures, as PNG files in icons/, at the
  sizes XP drew them (16, 24, 32, 48). Where they came from is in DESIGN.md.

    NT.xp.icon(name, size)     → an <img> of that size (16 by default)
    NT.xp.iconUrl(name, size)  → the same as an address, for a style set from here

  A picture is chosen for the size it is shown at and for the screen's scaling: at 150 %
  a 16-pixel icon is drawn from the 24 or 32-pixel picture, not stretched from the small
  one. Only the sizes something here shows are kept as files. The pictures a stylesheet
  draws by itself are named there (style.css).
*/
(function () {
  'use strict';
  const NT = window.NT;
  const W = (NT.xp = NT.xp || {});

  const ALL = [16, 32, 48], SMALL = [16, 32], TOOL = [16, 24], BIG = [32, 48];
  // name → the sizes there are files for (icons/<name>-<size>.png)
  const SIZES = {
    // places and things: in title bars and lists (16), on the desktop and in the Start menu (32)
    app: ALL, scripts: ALL, map: ALL, user: ALL, doc: ALL, key: ALL, warning: ALL,
    settings: [16, 24, 32, 48],
    // in lists, title bars and the task pane only
    text: SMALL, log: SMALL, rename: SMALL, share: SMALL, publish: SMALL, folder: SMALL,
    // a message box's
    error: BIG, info: BIG, question: BIG,
    // the Start menu's own: the way out, and Favorites
    logoff: [24, 48], star: [16, 24, 32, 48],
    // what a toolbar or the task pane shows beside its words
    new: TOOL, open: TOOL, save: TOOL, props: TOOL, copy: TOOL, delete: TOOL, up: TOOL, back: TOOL,
    // an Explorer toolbar's own, at the one size XP drew them (a file each: icons/<name>.png)
    'tb-back': 0, 'tb-forward': 0, 'tb-up': 0, 'tb-search': 0,
  };

  const base = new URL('styles/winxp/icons/', document.baseURI).href;
  // The smallest picture that is at least `px`, or the largest there is.
  const pick = (name, px) => {
    const sizes = SIZES[name];
    if (!sizes) return base + name + '.png';
    return base + name + '-' + (sizes.find((s) => s >= px) || sizes[sizes.length - 1]) + '.png';
  };

  W.icon = function (name, size = 16) {
    if (!(name in SIZES)) name = 'doc';
    const img = document.createElement('img');
    img.className = 'pix';
    img.alt = '';
    img.width = img.height = size;
    img.draggable = false;
    img.src = pick(name, size);
    img.srcset = `${pick(name, size)} 1x, ${pick(name, size * 1.5)} 1.5x, ${pick(name, size * 2)} 2x`;
    return img;
  };
  W.iconUrl = (name, size = 16) => `url("${pick(name in SIZES ? name : 'doc', size * 1.5)}")`;
})();
