/*
  Styles: whole looks of the app.

  A style is its own shell and its own set of pages (styles/<id>/), on the core in js/:
  the service, projects, the editor engine, the explorer. Nothing is shared between
  two styles but that core, so one can be built as its platform would build it.

  This file is the list of them and the loader. It runs in <head>, before anything is
  painted: it reads which style this browser uses, puts the saved appearance on <html>
  and writes that style's stylesheets into the page. NT.styles.scripts(), called at the
  end of <body>, writes the core's scripts and then the style's. Each is asked for by
  the version the server lists in the page, where it does.

    NT.styles.list        [{ id, name }]
    NT.styles.current     the id in use
    NT.styles.use(id)     keep the choice and load the app again in that style

  ?style=<id> in the address chooses a style and keeps it: the way out of one that
  does not work.

  What a style provides (see styles/glass for the first):
    NT.nav        go(path), back(), reset(paths?), paths(), href(path)
    NT.ui         toast(text, { warn, icon, duration, action }), confirm({ title, message,
                  confirmLabel, destructive, source }) → Promise<bool>,
                  menu(anchor, items, { align }), signIn(mode)
                  action: { label, onSelect }: a way to act on what the toast says
                  (Undo, Try Again, Sign In), drawn as the platform draws one; it stays
                  as long as `duration` says, and onSelect is called at most once
    NT.look       optional: { pane(el), codeFont, still }   (monaco.js, util.js)
    a page for every route name in NT.routes, and a way to change style in its settings
    when NT.api.down (the service did not answer as the app started), a screen that says
    "Upstream is unreachable" with Try Again in place of the pages
    NT.bus 'scripts' heard by the pages that list scripts: a delete was taken back
    Remember Me on its way in, off until chosen, where NT.api.canKeep (api.login and
    api.register take it last)
    in the editor: Test Settings where tests run, and a run started with the session's
    DEBUG build (NT.tests.start(script, { debug: session.debug })), History
    (NT.history, ed.replace) with Restore and Undo, Library in Details (session.library,
    setLibrary), and .nt-inactive drawn on the lines an #if leaves out (macro-view.js)
    on Scripts, a Libraries list when signed in where NT.libs.available() (NT.libs.list);
    on a library's page, the line that uses it, to copy (NT.libs.spec)
*/
(function () {
  'use strict';
  var NT = (window.NT = window.NT || {});

  var CORE = ['util', 'icons', 'data', 'pack', 'api', 'ext', 'luau', 'editor-prefs', 'format', 'macro', 'libs', 'project', 'monaco', 'macro-view', 'lsp', 'media', 'explorer', 'routes', 'session', 'actions', 'tests', 'compare', 'seen', 'history'];

  var STYLES = [
    {
      id: 'glass',
      name: 'Liquid Glass',
      fonts: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap',
      css: ['tokens', 'glass', 'app', 'media', 'project', 'tests'],
      js: ['lens', 'glass', 'liquid', 'ui', 'media-ui', 'pages', 'tests-ui', 'editor', 'app'],
    },
    {
      id: 'md3',
      name: 'Material 3 Expressive',
      fonts: 'https://fonts.googleapis.com/css2?family=Roboto+Flex:opsz,wght@8..144,100..1000&family=Roboto+Mono:wght@400;500&family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap',
      css: ['style'],
      js: ['ui', 'pages', 'tests', 'editor', 'app'],
    },
    {
      id: 'md2',
      name: 'Material Design 2',
      fonts: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Roboto+Mono:wght@400;500&family=Material+Icons&display=swap',
      css: ['style'],
      js: ['ui', 'pages', 'tests', 'editor', 'app'],
    },
    {
      id: 'win95',
      name: 'Windows 95',
      css: ['style'],
      js: ['icons', 'ui', 'pages', 'tests', 'editor', 'app'],
    },
    {
      id: 'winxp',
      name: 'Windows XP',
      css: ['style'],
      js: ['icons', 'ui', 'pages', 'tests', 'editor', 'app'],
    },
    {
      id: 'win7',
      name: 'Windows 7',
      css: ['style'],
      js: ['icons', 'ui', 'pages', 'tests', 'editor', 'app'],
    },
  ];

  // What each of the app's files holds, by a tag, where the server says (server.js): a
  // file asked for by its tag is one the browser may keep without asking again.
  var V = {};
  var listed = document.querySelector('meta[name="nt-files"]');
  if (listed) {
    listed.content.split(' ').forEach(function (x) {
      var i = x.lastIndexOf(':');
      if (i > 0) V[x.slice(0, i)] = x.slice(i + 1);
    });
  }
  var at = function (file) { return V[file] ? file + '?v=' + V[file] : file; };

  var KEY = 'nt.prefs';
  var p = {};
  try { p = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
  var find = function (id) {
    for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === id) return STYLES[i];
    return null;
  };

  var asked = null;
  try { asked = new URLSearchParams(location.search).get('style'); } catch (e) {}
  if (asked && find(asked) && asked !== p.style) {
    p.style = asked;
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {}
  }
  var style = find(p.style) || STYLES[0];

  // The saved appearance, before first paint.
  var d = document.documentElement;
  var theme = p.theme === 'light' || p.theme === 'dark' ? p.theme
    : (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  d.dataset.style = style.id;
  d.dataset.theme = theme;
  d.dataset.accent = p.accent || 'blue';
  if (typeof p.frost === 'number') d.style.setProperty('--frost', p.frost);
  if (p.solid) d.setAttribute('data-solid', '');
  // The desktop picture chosen in this style, where it has desktops.
  if (p.wallpaper && p.wallpaper[style.id]) d.dataset.wall = p.wallpaper[style.id];

  // Written by the parser, so they are in order and hold the first paint until they are in.
  var out = '';
  if (style.fonts) {
    out += '<link rel="preconnect" href="https://fonts.googleapis.com">' +
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
      '<link rel="stylesheet" href="' + style.fonts + '">';
  }
  for (var i = 0; i < style.css.length; i++) out += '<link rel="stylesheet" href="' + at('styles/' + style.id + '/' + style.css[i] + '.css') + '">';
  document.write(out);

  NT.styles = {
    list: STYLES.map(function (s) { return { id: s.id, name: s.name }; }),
    current: style.id,
    scripts: function () {
      var tags = '';
      for (var i = 0; i < CORE.length; i++) tags += '<script src="' + at('js/' + CORE[i] + '.js') + '"><\/script>';
      for (var j = 0; j < style.js.length; j++) tags += '<script src="' + at('styles/' + style.id + '/' + style.js[j] + '.js') + '"><\/script>';
      document.write(tags);
    },
    use: function (id) {
      if (!find(id) || id === style.id) return;
      NT.prefs.set({ style: id });
      // The same place, without a ?style= that would choose again.
      var url = new URL(location.href);
      url.searchParams.delete('style');
      if (url.href === location.href) location.reload();
      else location.replace(url.href);
    },
  };
})();
