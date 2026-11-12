/*
  Routes: what each address is, whichever style shows it.

    NT.routes.match(path) → {
      name, args      the page: home, scripts, maps, profile, script(id), viewer(id, revision),
                      editor(id), audit(userId), user(userId), settings, editorSettings,
                      lintRules, notFound
      path            the address as it is kept
      tab, root       a tab's own page, or the tab a page belongs under
      parents         the pages between that tab and this one, for a shell that stacks them
      modal           'login' | 'register': the page is home, with that sheet over it
      action          'logout'
    }
    NT.routes.tabs       { path: name } of the tab pages
    NT.routes.href(path) the address to put in a link
    NT.routes.current()  the address the browser is at
    NT.routes.stack(path) the pages a stacking shell has open for an address, bottom first

  A style that has no page for a name shows its home.
*/
(function () {
  'use strict';
  const NT = window.NT;

  // Opened straight from disk there is no server to rewrite paths, so route with the hash.
  const useHash = location.protocol === 'file:';
  const TABS = { '/': 'home', '/scripts': 'scripts', '/maps': 'maps', '/profile': 'profile' };
  const decode = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };

  function match(path) {
    const [rawPath, query = ''] = String(path).split('?');
    const pn = rawPath.replace(/\/+$/, '') || '/';
    const q = new URLSearchParams(query);
    // What chooses a style is not part of where the page is.
    q.delete('style');
    const rest = q.toString();
    const full = pn + (rest ? '?' + rest : '');
    let m;
    if (TABS[pn]) return { name: TABS[pn], args: [], path: pn, tab: true, root: pn };
    if ((m = pn.match(/^\/scripts\/([^/]+)$/))) return { name: 'script', args: [decode(m[1])], path: pn, root: '/scripts' };
    if ((m = pn.match(/^\/scripts\/([^/]+)\/view$/))) return { name: 'viewer', args: [decode(m[1]), q.get('revision')], path: full, root: '/scripts', parents: [`/scripts/${m[1]}`] };
    if ((m = pn.match(/^\/scripts\/([^/]+)\/edit$/))) return { name: 'editor', args: [decode(m[1])], path: pn, root: '/scripts', parents: [`/scripts/${m[1]}`] };
    if ((m = pn.match(/^\/users\/([^/]+)\/audit$/) || pn.match(/^\/(@[^/]+)\/audit$/))) return { name: 'audit', args: [decode(m[1])], path: pn, root: '/profile' };
    if ((m = pn.match(/^\/users\/([^/]+)\/maps$/))) return { name: 'maps', args: [], path: '/maps', tab: true, root: '/maps' };
    if ((m = pn.match(/^\/users\/([^/]+)(?:\/scripts)?$/) || pn.match(/^\/(@[^/]+)(?:\/scripts)?$/))) return { name: 'user', args: [decode(m[1])], path: pn, root: '/scripts' };
    if (pn === '/settings') return { name: 'settings', args: [], path: pn, root: '/profile' };
    if (pn === '/settings/editor') return { name: 'editorSettings', args: [], path: pn, root: '/profile', parents: ['/settings'] };
    if (pn === '/settings/editor/lint') return { name: 'lintRules', args: [], path: pn, root: '/profile', parents: ['/settings', '/settings/editor'] };
    if (pn === '/login' || pn === '/register') return { name: 'home', args: [], path: '/', tab: true, root: '/', modal: pn.slice(1) };
    if (pn === '/logout') return { name: 'home', args: [], path: '/', tab: true, root: '/', action: 'logout' };
    return { name: 'notFound', args: [], path: pn, root: '/' };
  }

  NT.routes = {
    useHash,
    tabs: TABS,
    match,
    href: (path) => (useHash ? '#' + path : path),
    current: () => (useHash ? location.hash.slice(1) || '/' : location.pathname + location.search),
    stack(path) {
      const r = match(path);
      return r.tab ? [r.path] : [r.root, ...(r.parents || []), r.path];
    },
  };
})();
