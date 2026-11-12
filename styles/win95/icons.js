/*
  Windows 95's icons: the system's own, as it drew them at 16 × 16 and 32 × 32 in its
  sixteen colours. The pictures are in icons/ (see DESIGN.md for where they are from).

    NT.w95.icon(name, size)   → an <img> (size: 16 or 32)
    NT.w95.iconUrl(name, size) → the same as an address, for a stylesheet

  A name is what the picture is for here; the file is what Windows drew.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const W = (NT.w95 = NT.w95 || {});

  const DIR = 'styles/win95/icons/';

  // name → [file, drawn small as well as large]
  const ART = {
    app: ['app', true],            // a program's window
    doc: ['script', true],         // a script: a page of text that does something
    json: ['text', true],          // a text document
    folder: ['folder', true],
    scripts: ['folder-open', true],
    map: ['globe', true],
    user: ['user', true],
    settings: ['controls', true],  // Control Panel
    log: ['notepad', true],
    logo: ['logo', true],          // the flag on the Start button
    key: ['keys', false],          // Passwords
    warning: ['warning', false],   // the four a message box shows
    error: ['error', false],
    info: ['info', false],
    question: ['question', false],
  };

  const file = (name, size) => {
    const [stem, small] = ART[name] || ART.doc;
    return DIR + stem + (size <= 16 && small ? '-16' : '-32') + '.png';
  };

  W.icon = function (name, size = 16) {
    const [stem, small] = ART[name] || ART.doc;
    const img = document.createElement('img');
    img.className = 'pix';
    img.alt = '';
    img.width = size;
    img.height = size;
    img.draggable = false;
    img.decoding = 'sync';
    img.src = file(name, size);
    // A small one on a dense screen is the large drawing, which has the pixels for it.
    if (size <= 16 && small) img.srcset = `${DIR}${stem}-16.png 1x, ${DIR}${stem}-32.png 2x`;
    // One drawn only large is shrunk to fit a small place; that cannot keep its pixels.
    if (size <= 16 && !small) img.style.imageRendering = 'auto';
    return img;
  };
  W.iconUrl = (name, size = 16) => `url("${file(name, size)}")`;
})();
