/* Original icon set, drawn on a 24pt grid with 2pt rounded strokes. */
(function () {
  'use strict';
  const NT = window.NT;

  const F = 'fill="currentColor" stroke="none"';

  // 16-point burst used as the outline of the settings gear.
  function gear() {
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const r = i % 2 ? 7.4 : 9.6;
      const a = (i * Math.PI) / 8 - Math.PI / 2;
      pts.push((12 + r * Math.cos(a)).toFixed(2) + ' ' + (12 + r * Math.sin(a)).toFixed(2));
    }
    return `<path d="M${pts.join('L')}Z"/><circle cx="12" cy="12" r="3"/>`;
  }

  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h3.5v-6h5v6H18a1 1 0 0 0 1-1V9.5"/>',
    code: '<path d="m8 7-5 5 5 5"/><path d="m16 7 5 5-5 5"/><path d="m13.5 4.5-3 15"/>',
    map: '<path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z"/><path d="M9 4v14"/><path d="M15 6v14"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.9-3.9"/>',
    heart: '<path d="M12 20.5s-8-4.9-8-11A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5c0 6.1-8 11-8 11Z"/>',
    share: '<path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M6 11h-.5A1.5 1.5 0 0 0 4 12.5v7A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    photo: `<rect x="3" y="4.5" width="18" height="15" rx="3"/><circle cx="8.3" cy="9.3" r="1.5" ${F}/><path d="m3.5 17 4-4 3 3 4.5-4.5 5.5 5.5"/>`,
    upload: '<path d="M12 15V4"/><path d="m8 8 4-4 4 4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    ellipsis: `<circle cx="5" cy="12" r="1.7" ${F}/><circle cx="12" cy="12" r="1.7" ${F}/><circle cx="19" cy="12" r="1.7" ${F}/>`,
    'chevron-left': '<path d="m15 5-7 7 7 7"/>',
    'chevron-right': '<path d="m9 5 7 7-7 7"/>',
    'chevron-down': '<path d="m5 9 7 7 7-7"/>',
    gear: gear(),
    pencil: '<path d="m4 20 1-4.5L16.5 4a2.1 2.1 0 0 1 3 3L8 18.5 4 20Z"/><path d="m14.5 6 3.5 3.5"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="m6 7 1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7"/><path d="M10 11v6M14 11v6"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    play: `<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" ${F}/>`,
    bolt: `<path d="M13.5 2 4.5 13.5H11L10 22l9.5-12H13l.5-8Z" ${F}/>`,
    sparkles: `<path d="m10 3 1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8L10 3Z" ${F}/><path d="m18 14 .9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9L18 14Z" ${F}/>`,
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    xmark: '<path d="m6 6 12 12M18 6 6 18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    doc: '<path d="M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
    clipboard: '<rect x="5" y="4.5" width="14" height="16.5" rx="2.5"/><path d="M9 3h6v3H9z"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16 7l2.5 2.5M13.5 9.5l2 2"/>',
    appearance: `<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18Z" ${F}/>`,
    info: `<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r="1.2" ${F}/>`,
    warning: `<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.3" r="1.1" ${F}/>`,
    sort: '<path d="M7 4v16M3.5 7.5 7 4l3.5 3.5"/><path d="M17 20V4M13.5 16.5 17 20l3.5-3.5"/>',
    send: '<path d="M21 3 10.5 13.5"/><path d="m21 3-6.5 18-4-7.5L3 9.5 21 3Z"/>',
    logout: '<path d="M10 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H10"/><path d="m15 8 4 4-4 4"/><path d="M19 12H9"/>',
    shield: '<path d="m12 3 7.5 3v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6L12 3Z"/>',
    target: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" ${F}/>`,
    flame: '<path d="M12 3c.5 3.5 5.5 5.5 5.5 11a5.5 5.5 0 0 1-11 0c0-2 .8-3.4 2-4.5.2 1.6 1 2.5 2 3C10 9.5 10.5 6 12 3Z"/>',
    wand: '<path d="M5 19 16 8"/><path d="M15 3.5v3M13.5 5h3"/><path d="M19.5 10v3M18 11.5h3"/><path d="M8.5 4v2M7.5 5h2"/>',
    cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5"/><path d="M12 12v9"/>',
    list: `<path d="M8.5 6H20M8.5 12H20M8.5 18H20"/><circle cx="4.2" cy="6" r="1.3" ${F}/><circle cx="4.2" cy="12" r="1.3" ${F}/><circle cx="4.2" cy="18" r="1.3" ${F}/>`,
    drop: '<path d="M12 3s6.5 6.6 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 9.6 12 3 12 3Z"/>',
    database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
    reset: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4.5h4.5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"/>',
    sidebar: '<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="M9.5 4.5v15"/>',
    folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2.5h8.5A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V7.5Z"/>',
    'folder-plus': '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2.5h8.5A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V7.5Z"/><path d="M12 11.5v5M9.5 14h5"/>',
    'doc-plus': '<path d="M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/><path d="M12 11.5v6M9 14.5h6"/>',
    'doc-text': '<path d="M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
    braces: '<path d="M9 4H8a2 2 0 0 0-2 2v3.5c0 1.4-.9 2.5-2 2.5 1.1 0 2 1.1 2 2.5V18a2 2 0 0 0 2 2h1"/><path d="M15 4h1a2 2 0 0 1 2 2v3.5c0 1.4.9 2.5 2 2.5-1.1 0-2 1.1-2 2.5V18a2 2 0 0 1-2 2h-1"/>',
    collapse: '<path d="m7 4 5 5 5-5"/><path d="m7 20 5-5 5 5"/>',
    scissors: '<circle cx="6.5" cy="6.5" r="2.5"/><circle cx="6.5" cy="17.5" r="2.5"/><path d="M8.6 8.2 20 18"/><path d="M8.6 15.8 20 6"/>',
    duplicate: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/><path d="M14 11.5v5M11.5 14h5"/>',
    download: '<path d="M12 4v11"/><path d="m8 11 4 4 4-4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  };

  NT.icon = function (name, size = 24) {
    const t = document.createElement('template');
    t.innerHTML =
      `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
      `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
    return t.content.firstChild;
  };
})();
