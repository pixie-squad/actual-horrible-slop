/*
  Windows 95's icons: small pictures on a 16 × 16 grid in the sixteen system colours.
  They are this app's own drawings, written out here a character a pixel.

    NT.w95.icon(name, size)   → an <svg>, each pixel a crisp square (size: 16 or 32)
    NT.w95.iconUrl(name)      → the same as an address, for a stylesheet

  The ones a stylesheet needs are also put on <html> as --ico-<name>.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const W = (NT.w95 = NT.w95 || {});

  const COLOURS = {
    k: '#000000', w: '#ffffff', g: '#808080', s: '#c0c0c0',
    y: '#ffff00', Y: '#808000', b: '#0000ff', n: '#000080',
    c: '#00ffff', t: '#008080', r: '#ff0000', m: '#800000',
    G: '#008000', l: '#00ff00', p: '#800080', f: '#ff00ff',
  };

  const ART = {
    // A script: a page with its corner folded and lines of code on it.
    doc: [
      '................',
      '...kkkkkkkk.....',
      '...kwwwwwwkk....',
      '...kwwwwwwkwk...',
      '...kwwwwwwkkkk..',
      '...kwnnnwwwwwk..',
      '...kwwwwwwwwwk..',
      '...kwwnnnnnwwk..',
      '...kwwwwwwwwwk..',
      '...kwwnnnwwwwk..',
      '...kwwwwwwwwwk..',
      '...kwnnnnwwwwk..',
      '...kwwwwwwwwwk..',
      '...kwwwwwwwwwk..',
      '...kkkkkkkkkkk..',
    ],
    // The same page with braces on it: a data file.
    json: [
      '................',
      '...kkkkkkkk.....',
      '...kwwwwwwkk....',
      '...kwwwwwwkwk...',
      '...kwwwwwwkkkk..',
      '...kwwwwwwwwwk..',
      '...kwwppwppwwk..',
      '...kwwpwwwpwwk..',
      '...kwppwwwppwk..',
      '...kwwpwwwpwwk..',
      '...kwwppwppwwk..',
      '...kwwwwwwwwwk..',
      '...kwwwwwwwwwk..',
      '...kwwwwwwwwwk..',
      '...kkkkkkkkkkk..',
    ],
    folder: [
      '................',
      '................',
      '..kkkk..........',
      '.kyyyykkkkkkkk..',
      '.kyyyyyyyyyyyyk.',
      '.kywwwwwwwwwwyk.',
      '.kyyyyyyyyyyyyk.',
      '.kyyyyyyyyyyyyk.',
      '.kyyyyyyyyyyyyk.',
      '.kyyyyyyyyyyyyk.',
      '.kyyyyyyyyyyyyk.',
      '.kyyyyyyyyyyyyk.',
      '.kkkkkkkkkkkkkk.',
    ],
    // A folder standing open.
    scripts: [
      '................',
      '..kkkk..........',
      '.kyyyykkkkkkk...',
      '.kyyyyyyyyyyyk..',
      '.kyyyyyyyyyyyk..',
      '.kykkkkkkkkkkkkk',
      '.kykYYYYYYYYYYYk',
      '.kkYYYYYYYYYYYk.',
      '.kkYYYYYYYYYYYk.',
      '.kYYYYYYYYYYYk..',
      '.kYYYYYYYYYYYk..',
      '.kkkkkkkkkkkk...',
    ],
    map: [
      '................',
      '.kkkkkkkkkkkkkk.',
      '.kGGGGGGccGGGGk.',
      '.kGGGGGccGGGGGk.',
      '.kGGrrGccGGGGGk.',
      '.kGrrrrGccGGGGk.',
      '.kGrwwrGGccGGGk.',
      '.kGrrrrGGGccGGk.',
      '.kGGrrGGGGGccGk.',
      '.kGGrrGGGGGGcck.',
      '.kGGGrGGGGGGGck.',
      '.kGGGGGGGGGGGGk.',
      '.kkkkkkkkkkkkkk.',
    ],
    user: [
      '................',
      '.....kkkkkk.....',
      '....kyyyyyyk....',
      '....kyyyyyyk....',
      '....kyyyyyyk....',
      '....kyyyyyyk....',
      '.....kyyyyk.....',
      '......kkkk......',
      '...kkkbbbbkkk...',
      '..kbbbbbbbbbbk..',
      '.kbbbbbbbbbbbbk.',
      '.kbbbbbbbbbbbbk.',
      '.kbbbbbbbbbbbbk.',
      '.kbbbbbbbbbbbbk.',
      '.kkkkkkkkkkkkkk.',
    ],
    // A panel of sliders.
    settings: [
      '................',
      '.kkkkkkkkkkkkkk.',
      '.kssssssssssssk.',
      '.kskkkkkkrrkksk.',
      '.kssssssgrrsssk.',
      '.kssssssssssssk.',
      '.kskkbbkkkkkksk.',
      '.kssgbbsssssssk.',
      '.kssssssssssssk.',
      '.kskkkkkGGkkksk.',
      '.ksssssgGGssssk.',
      '.kssssssssssssk.',
      '.kkkkkkkkkkkkkk.',
    ],
    // The app: a window with code in it.
    app: [
      '................',
      '.kkkkkkkkkkkkkk.',
      '.knnnnnnnnnnnnk.',
      '.knnnnnnnnswswk.',
      '.kkkkkkkkkkkkkk.',
      '.kwwwwwwwwwwwwk.',
      '.kwwwkwwwwkwwwk.',
      '.kwwkwwwkwwkwwk.',
      '.kwkwwwkwwwwkwk.',
      '.kwwkwwkwwwkwwk.',
      '.kwwwkwwwwkwwwk.',
      '.kwwwwwwwwwwwwk.',
      '.kkkkkkkkkkkkkk.',
    ],
    // A page of entries: the audit log.
    log: [
      '................',
      '..kkkkkkkkkkkk..',
      '..kwwwwwwwwwwk..',
      '..kwrwkkkkkkwk..',
      '..kwwwwwwwwwwk..',
      '..kwbwkkkkkwwk..',
      '..kwwwwwwwwwwk..',
      '..kwGwkkkkkkwk..',
      '..kwwwwwwwwwwk..',
      '..kwrwkkkkwwwk..',
      '..kwwwwwwwwwwk..',
      '..kwbwkkkkkkwk..',
      '..kwwwwwwwwwwk..',
      '..kkkkkkkkkkkk..',
    ],
    key: [
      '................',
      '................',
      '..kkkk..........',
      '.kyyyyk.........',
      'kyykkyyk........',
      'kykwwkykkkkkkkk.',
      'kykwwkyyyyyyyyyk',
      'kyykkyykkykykyk.',
      '.kyyyyk.k.k.k...',
      '..kkkk..........',
    ],
    heart: [
      '................',
      '................',
      '..kkk....kkk....',
      '.krrrk..krrrk...',
      'krrwrrkkrrrrrk..',
      'krrrrrrrrrrrrk..',
      'krrrrrrrrrrrrk..',
      '.krrrrrrrrrrk...',
      '..krrrrrrrrk....',
      '...krrrrrrk.....',
      '....krrrrk......',
      '.....krrk.......',
      '......kk........',
    ],
    warning: [
      '................',
      '.......kk.......',
      '......kyyk......',
      '......kyyk......',
      '.....kyyyyk.....',
      '.....kykkyk.....',
      '....kyykkyyk....',
      '....kyykkyyk....',
      '...kyyykkyyyk...',
      '...kyyykkyyyk...',
      '..kyyyyyyyyyyk..',
      '..kyyyykkyyyyk..',
      '.kyyyyykkyyyyyk.',
      '.kyyyyyyyyyyyyk.',
      '.kkkkkkkkkkkkkk.',
    ],
    error: [
      '................',
      '.....kkkkkk.....',
      '...kkrrrrrrkk...',
      '..krrrrrrrrrrk..',
      '..krwwrrrrwwrk..',
      '.krrwwwrrwwwrrk.',
      '.krrrwwwwwwrrrk.',
      '.krrrrwwwwrrrrk.',
      '.krrrrwwwwrrrrk.',
      '.krrrwwwwwwrrrk.',
      '.krrwwwrrwwwrrk.',
      '..krwwrrrrwwrk..',
      '..krrrrrrrrrrk..',
      '...kkrrrrrrkk...',
      '.....kkkkkk.....',
    ],
    info: [
      '................',
      '.....kkkkkk.....',
      '...kkbbbbbbkk...',
      '..kbbbbwwbbbbk..',
      '..kbbbbwwbbbbk..',
      '.kbbbbbbbbbbbbk.',
      '.kbbbbwwwbbbbbk.',
      '.kbbbbbwwbbbbbk.',
      '.kbbbbbwwbbbbbk.',
      '.kbbbbbwwbbbbbk.',
      '.kbbbbbwwbbbbbk.',
      '..kbbbwwwwbbbk..',
      '..kbbbbbbbbbbk..',
      '...kkbbbbbbkk...',
      '.....kkkkkk.....',
    ],
    question: [
      '................',
      '.....kkkkkk.....',
      '...kkbbbbbbkk...',
      '..kbbbwwwwbbbk..',
      '..kbbwwbbwwbbk..',
      '.kbbbwwbbwwbbbk.',
      '.kbbbbbbbwwbbbk.',
      '.kbbbbbbwwbbbbk.',
      '.kbbbbbwwbbbbbk.',
      '.kbbbbbwwbbbbbk.',
      '.kbbbbbbbbbbbbk.',
      '..kbbbbwwbbbbk..',
      '..kbbbbwwbbbbk..',
      '...kkbbbbbbkk...',
      '.....kkkkkk.....',
    ],
  };

  // Runs of one colour along a row become one rectangle.
  function rects(name) {
    const rows = ART[name] || ART.doc;
    let out = '';
    rows.forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        const c = row[x];
        let n = 1;
        while (x + n < row.length && row[x + n] === c) n++;
        if (COLOURS[c]) out += `<rect x="${x}" y="${y}" width="${n}" height="1" fill="${COLOURS[c]}"/>`;
        x += n;
      }
    });
    return out;
  }
  const markup = (name, size) =>
    `<svg xmlns="http://www.w3.org/2000/svg" class="pix" width="${size}" height="${size}" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${rects(name)}</svg>`;

  W.icon = function (name, size = 16) {
    const t = document.createElement('template');
    t.innerHTML = markup(name, size);
    return t.content.firstChild;
  };
  W.iconUrl = (name) => `url("data:image/svg+xml,${encodeURIComponent(markup(name, 16))}")`;

  for (const name of ['doc', 'json', 'folder', 'scripts']) document.documentElement.style.setProperty('--ico-' + name, W.iconUrl(name));
})();
