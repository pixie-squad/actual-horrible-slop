/*
  Windows XP's icons: small soft pictures with a light from above, drawn on a 32 × 32
  grid. They are this app's own drawings.

    NT.xp.icon(name, size)   → an <svg>
    NT.xp.iconUrl(name)      → the same as an address, for a stylesheet

  The ones a stylesheet needs are also put on <html> as --ico-<name>.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const W = (NT.xp = NT.xp || {});

  // A top-to-bottom gradient, named so each picture's own are told apart.
  const grad = (id, from, to) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`;
  const page = (id) => grad(id, '#ffffff', '#dfe7f5') +
    `<path d="M7.5 2.5h12l6 6v21h-18z" fill="url(#${id})" stroke="#6f7f9c"/><path d="M19.5 2.5v6h6" fill="#c9d6ee" stroke="#6f7f9c" stroke-linejoin="round"/>`;
  const disc = (id, from, to, edge) => grad(id, from, to) +
    `<circle cx="16" cy="16" r="13" fill="url(#${id})" stroke="${edge}"/><ellipse cx="16" cy="9.5" rx="9" ry="5" fill="#fff" opacity="0.28"/>`;

  const ART = {
    doc: () => page('xd') + '<path d="M11 14h10M11 18h10M11 22h7" stroke="#2f62b8" stroke-width="1.6" stroke-linecap="round"/>',
    json: () => page('xj') + '<path d="M14 13c-2 0-2 1.5-2 3s-.5 2-1.5 2c1 0 1.5.5 1.5 2s0 3 2 3M18 13c2 0 2 1.5 2 3s.5 2 1.5 2c-1 0-1.5.5-1.5 2s0 3-2 3" fill="none" stroke="#7b3fa8" stroke-width="1.5" stroke-linecap="round"/>',
    folder: () => grad('xf1', '#f9dc7a', '#e0a81e') + grad('xf2', '#fff3b4', '#f3c53c') +
      '<path d="M3.5 8.5a2 2 0 0 1 2-2h6.5l3 3h11.500a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-21a2 2 0 0 1-2-2z" fill="url(#xf1)" stroke="#a87e08"/>' +
      '<path d="M3.5 13.500h25v11a2 2 0 0 1-2 2h-21a2 2 0 0 1-2-2z" fill="url(#xf2)" stroke="#a87e08"/>',
    scripts: () => grad('xs1', '#f9dc7a', '#e0a81e') + grad('xs2', '#fff3b4', '#f3c53c') +
      '<path d="M3.5 8.500a2 2 0 0 1 2-2h6.500l3 3h10.500a2 2 0 0 1 2 2v13h-24z" fill="url(#xs1)" stroke="#a87e08"/>' +
      '<path d="M7 14.500h23.500l-4 12h-23z" fill="url(#xs2)" stroke="#a87e08" stroke-linejoin="round"/>',
    map: () => grad('xm', '#9bdc7c', '#3f9a3a') +
      '<rect x="3.500" y="5.500" width="25" height="21" rx="2" fill="url(#xm)" stroke="#2a6d2c"/>' +
      '<path d="M18 6c-3 5 4 8 1 12s2 6 0 8" fill="none" stroke="#3c8fe0" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M10 9a3.500 3.500 0 0 1 3.500 3.500c0 2.500-3.500 6.500-3.500 6.500s-3.500-4-3.500-6.500a3.500 3.500 0 0 1 3.500-3.500z" fill="#e8402a" stroke="#8f1c10"/><circle cx="10" cy="12.500" r="1.300" fill="#fff"/>',
    user: () => grad('xu1', '#ffe2b8', '#eeb074') + grad('xu2', '#6aa7ee', '#1d55b8') +
      '<path d="M4.500 28.500c0-7 5-10.500 11.500-10.500s11.500 3.500 11.500 10.500z" fill="url(#xu2)" stroke="#123c86"/>' +
      '<circle cx="16" cy="11" r="6.500" fill="url(#xu1)" stroke="#a8703a"/>',
    settings: () => grad('xg', '#fafafa', '#cfd4dc') +
      '<rect x="3.500" y="4.500" width="25" height="23" rx="2.500" fill="url(#xg)" stroke="#6f7f9c"/>' +
      '<path d="M8 10.500h16M8 16h16M8 21.500h16" stroke="#7a8496" stroke-width="1.600" stroke-linecap="round"/>' +
      '<rect x="18" y="8" width="4" height="5" rx="1" fill="#e8402a" stroke="#8f1c10"/><rect x="10" y="13.500" width="4" height="5" rx="1" fill="#2f7ae0" stroke="#123c86"/><rect x="16" y="19" width="4" height="5" rx="1" fill="#3aa83a" stroke="#1d6a1d"/>',
    app: () => grad('xa1', '#3f8cf3', '#0f4cc0') + grad('xa2', '#ffffff', '#e4ebf7') +
      '<rect x="2.500" y="4.500" width="27" height="23" rx="3" fill="url(#xa2)" stroke="#0c3c9a"/>' +
      '<path d="M2.500 7.500a3 3 0 0 1 3-3h21a3 3 0 0 1 3 3v3.500h-27z" fill="url(#xa1)" stroke="#0c3c9a"/>' +
      '<path d="M12 15l-4 4 4 4M20 15l4 4-4 4M17.500 14l-3 10" fill="none" stroke="#1d55b8" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round"/>',
    log: () => page('xl') +
      '<path d="M14 13.500h7M14 18h7M14 22.500h7" stroke="#55627a" stroke-width="1.500" stroke-linecap="round"/>' +
      '<circle cx="11" cy="13.500" r="1.400" fill="#e8402a"/><circle cx="11" cy="18" r="1.400" fill="#2f7ae0"/><circle cx="11" cy="22.500" r="1.400" fill="#3aa83a"/>',
    key: () => grad('xk', '#ffe680', '#d79a12') +
      '<path d="M14 14.500l14 .0v4h-2.500v3h-3v-3h-2v3h-3v-3h-3.500z" fill="url(#xk)" stroke="#8c6204" stroke-linejoin="round"/>' +
      '<circle cx="9.500" cy="16.500" r="6.500" fill="url(#xk)" stroke="#8c6204"/><circle cx="8" cy="16.500" r="2" fill="#fff8d8" stroke="#8c6204"/>',
    heart: () => grad('xh', '#ff8a8a', '#d8201c') + '<path d="M16 27s-11-6.500-11-14.500a6 6 0 0 1 11-3.300 6 6 0 0 1 11 3.300c0 8-11 14.500-11 14.500z" fill="url(#xh)" stroke="#8f1210"/>',
    warning: () => grad('xw', '#fff07a', '#f0b400') +
      '<path d="M16 3.500l13 23.500a1.500 1.500 0 0 1-1.300 2.200h-23.400a1.500 1.500 0 0 1-1.300-2.200z" fill="url(#xw)" stroke="#9a6c00" stroke-linejoin="round"/>' +
      '<path d="M16 12v8.500" stroke="#2a2000" stroke-width="2.800" stroke-linecap="round"/><circle cx="16" cy="24.500" r="1.700" fill="#2a2000"/>',
    error: () => disc('xe', '#ff7a6a', '#c81a10', '#7c0c06') + '<path d="M11 11l10 10M21 11l-10 10" stroke="#fff" stroke-width="3" stroke-linecap="round"/>',
    info: () => disc('xi', '#6ab0ff', '#1458c8', '#0c3888') + '<path d="M16 15v8" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="16" cy="10" r="1.900" fill="#fff"/>',
    question: () => disc('xq', '#6ab0ff', '#1458c8', '#0c3888') +
      '<path d="M12 12.500a4 4 0 1 1 6 3.400c-1.300.800-2 1.500-2 3.100" fill="none" stroke="#fff" stroke-width="2.800" stroke-linecap="round"/><circle cx="16" cy="23.500" r="1.800" fill="#fff"/>',
  };

  const markup = (name, size) =>
    `<svg xmlns="http://www.w3.org/2000/svg" class="pix" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">${(ART[name] || ART.doc)()}</svg>`;

  W.icon = function (name, size = 16) {
    const t = document.createElement('template');
    t.innerHTML = markup(name, size);
    return t.content.firstChild;
  };
  W.iconUrl = (name) => `url("data:image/svg+xml,${encodeURIComponent(markup(name, 32))}")`;

  for (const name of ['doc', 'json', 'folder', 'scripts']) document.documentElement.style.setProperty('--ico-' + name, W.iconUrl(name));
})();
