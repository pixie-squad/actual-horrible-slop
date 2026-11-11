/*
  Backend extensions, as seen from the app.

  The local server can do more than proxy the API (thumbnails, avatars, an audit
  log, projects, bundling, a language server; see ext/index.js). Which of these it
  has is asked once at start-up. Opened from disk, or against a server without
  them, nothing is there and the app behaves as it did before they existed.

    NT.ext.has('media')    → true when that extension answered
    NT.ext.info('lsp')     → what it reported about itself ({} if nothing)
    NT.ext.url('/media/…') → the address of something under /x
*/
(function () {
  'use strict';
  const NT = window.NT;
  const BASE = '/x';
  let found = {};

  NT.ext = {
    base: BASE,
    async init() {
      found = {};
      if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4500);
        const res = await fetch(BASE, { credentials: 'include', signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.extensions && typeof data.extensions === 'object') found = data.extensions;
      } catch (e) { /* no extensions: a static host, or the server is not ours */ }
    },
    has(name) {
      return Object.prototype.hasOwnProperty.call(found, name);
    },
    info(name) {
      return (this.has(name) && found[name]) || {};
    },
    url(path) {
      return BASE + path;
    },
  };
})();
