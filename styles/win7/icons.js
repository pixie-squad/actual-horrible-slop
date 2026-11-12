/*
  Windows 7's icons. They are Windows 7's own pictures (styles/win7/icons/; DESIGN.md
  says where they are from), kept at the sizes they are shown at, each also at one and
  a half times and twice that, so they are sharp at 100 %, 150 % and 200 % scaling.

    NT.w7.icon(name, size)     → an <img>
    NT.w7.iconUrl(name, size)  → the same as an image for a stylesheet
    NT.w7.iconTint(name)       → the colour a taskbar button glows in under the pointer
    NT.w7.picture(name, size)  → an <img> of one of the pictures that are not icons

  The ones a stylesheet needs are also put on <html> as --ico-<name>.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const W = (NT.w7 = NT.w7 || {});

  // name → [the colour that stands out in the picture, the sizes it is kept for]
  const ICONS = {
    app: ['#e8843c', [16, 32, 48]],       // Home: the house
    scripts: ['#f0c44c', [16, 32, 48]],   // a folder of documents
    folder: ['#f0c44c', [16]],
    open: ['#f0c44c', [16]],              // a folder, open
    doc: ['#7f9fd0', [16, 32, 48]],       // a script: the window with a gear in it that a batch file has
    map: ['#3a9a4e', [16, 32, 48]],       // the globe
    user: ['#6f9f4a', [16, 32, 48]],      // user accounts
    mine: ['#f0c44c', [16]],              // your own folder
    settings: ['#4a9be0', [16, 32, 48]],  // Control Panel
    log: ['#5a7fc0', [16, 32]],           // the event log
    key: ['#e8b040', [16, 32]],
    star: ['#f4b820', [16]],              // Favorites
    warning: ['#f0c020', [16, 32]],
    error: ['#d83a2a', [32]],
    info: ['#2a62c8', [16, 32]],
    question: ['#2a62c8', [32]],
  };
  const BASE = 'styles/win7/icons/';
  const known = (name) => (ICONS[name] ? name : 'doc');
  // The files of a picture shown at `size`: the kept size that covers it, then that at 1.5 and 2 times.
  const files = (name, size) => {
    const kept = ICONS[name][1];
    const base = kept.find((s) => s >= size) || kept[kept.length - 1];
    return [1, 1.5, 2].map((k) => `${BASE}${name}-${base * k}.png`);
  };

  W.icon = function (name, size = 16) {
    const [x1, x15, x2] = files(known(name), size);
    const img = document.createElement('img');
    img.className = 'pix';
    img.width = img.height = size;
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.src = x1;
    img.srcset = `${x1} 1x, ${x15} 1.5x, ${x2} 2x`;
    img.setAttribute('aria-hidden', 'true');
    return img;
  };
  // A stylesheet's addresses are read from where the stylesheet is; these are whole, so
  // they mean the same wherever they are used.
  const abs = (path) => new URL(path, document.baseURI).href;
  const set = ([x1, x15, x2]) => `image-set(url("${abs(x1)}") 1x, url("${abs(x15)}") 1.5x, url("${abs(x2)}") 2x)`;
  W.iconUrl = (name, size = 16) => set(files(known(name), size));
  W.iconTint = (name) => ICONS[known(name)][0];

  // The pictures that are not icons of things: the Start button (40 px), Back and
  // Forward (26 px), and the small marks of the address row and the file tree (16 px).
  const at = (name, size) => [1, 1.5, 2].map((k) => `${BASE}${name}-${Math.round(size * k)}.png`);
  W.picture = function (name, size) {
    const [x1, x15, x2] = at(name, size);
    const img = document.createElement('img');
    img.width = img.height = size;
    img.alt = '';
    img.draggable = false;
    img.src = x1;
    img.srcset = `${x1} 1x, ${x15} 1.5x, ${x2} 2x`;
    img.setAttribute('aria-hidden', 'true');
    return img;
  };

  const root = document.documentElement;
  for (const name of ['doc', 'folder', 'open']) root.style.setProperty('--ico-' + name, W.iconUrl(name, 16));
  for (const name of ['find', 'newfile', 'newfolder']) root.style.setProperty('--ico-' + name, set(at(name, 16)));
})();
