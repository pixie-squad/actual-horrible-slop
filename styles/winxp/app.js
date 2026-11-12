/*
  Windows XP's shell: the desktop, its icons, the taskbar with the two-sided Start menu
  and the clock, and the navigator.

  Every address is a window. Going somewhere opens its window, or brings it to the
  front if it is open; the address the browser shows is the window in front. Closing
  a window is going back.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h } = NT.util;
  const W = NT.xp;
  const UI = NT.ui;
  const P = NT.pages;
  const R = NT.routes;

  const PLACES = [
    { label: 'NT Scripting', icon: 'app', path: '/' },
    { label: 'Scripts', icon: 'scripts', path: '/scripts' },
    { label: 'Maps', icon: 'map', path: '/maps' },
    { label: 'Profile', icon: 'user', path: '/profile' },
    { label: 'Settings', icon: 'settings', path: '/settings' },
  ];

  let quiet = false; // true while several windows are closed and opened at once

  // The scripts worked on last, for the Start menu. Read when the app starts, when
  // someone signs in or out and each time the menu opens, so it has them as it is drawn.
  let recent = [];
  async function readRecent() {
    const me = NT.api.session;
    if (!me) return (recent = []);
    try {
      const list = await NT.api.userScripts(me.user_id);
      recent = list.slice().sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 8);
    } catch (e) { /* what was read last stands */ }
    return recent;
  }
  // Where the browser's own history is, and how far forward it goes: what the Back and
  // Forward buttons of a window can do.
  let at = 0, top = 0;

  // The window in front is where the browser is.
  function fronted(push) {
    if (quiet) return;
    const win = W.active();
    const path = win ? win.path : '/';
    document.title = win && win.title && win.path !== '/' ? `${win.title} · NT Scripting` : 'NT Scripting';
    if (push) {
      top = at += 1;
      history.pushState({ path, i: at }, '', R.href(path));
    } else if ((history.state && history.state.path) !== path) history.replaceState({ path, i: at }, '', R.href(path));
    W.navChanged();
    if (win && win.onShow) Promise.resolve(win.onShow()).catch((err) => console.error(err));
  }

  function show(path, push) {
    const r = R.match(path);
    let win = W.windows().find((w) => w.path === r.path);
    if (win) win.front();
    else {
      win = (P[r.name] || P.home)(...r.args);
      win.path = r.path;
      // On a small screen a window is the whole screen.
      if (W.narrow.matches) win.maximise(true);
      win.open();
    }
    fronted(push);
    return win;
  }

  const Nav = (NT.nav = {
    href: R.href,
    // The open windows' addresses, the one in front last.
    paths() { return W.windows().map((w) => w.path); },

    start() {
      window.addEventListener('popstate', (e) => {
        at = (e.state && e.state.i) || 0;
        top = Math.max(top, at);
        show((e.state && e.state.path) || R.current(), false);
      });
      const first = R.match(R.current());
      at = top = (history.state && history.state.i) || 0;
      history.replaceState({ path: first.path, i: at }, '', R.href(first.path));
      show(first.path, false);
      if (first.modal) UI.authDialog(first.modal);
      if (first.action === 'logout' && NT.api.session) NT.api.logout().then(() => this.reset(['/']));
    },

    go(path) {
      const r = R.match(path);
      if (r.modal) return void UI.authDialog(r.modal);
      const front = W.active();
      show(path, !front || front.path !== r.path);
    },

    canBack: () => at > 0,
    canForward: () => at < top,

    // Closes the window in front, without asking it.
    back() {
      const win = W.active();
      if (win) win.destroy();
    },

    // Every window again, e.g. after signing in or out.
    reset(paths) {
      const keep = paths || this.paths();
      quiet = true;
      for (const win of W.windows()) win.destroy();
      const opened = (keep.length ? keep : ['/']).map((p) => show(p, false));
      quiet = false;
      // The one in front is shown by fronted(); the ones behind it are read as well.
      for (const win of opened.slice(0, -1)) if (win.onShow) Promise.resolve(win.onShow()).catch((err) => console.error(err));
      fronted(false);
      readRecent();
    },
  });

  /* ---------- Taskbar ---------- */

  const art = (name) => new URL('styles/winxp/icons/' + name, document.baseURI).href;

  function taskbar() {
    const start = h('button.w-start-btn', { type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'Start' },
      h('img', { src: art('flag.png'), alt: '', draggable: false }), 'start');
    const tasks = h('div.w-tasks', { role: 'toolbar', 'aria-label': 'Windows' });
    const clock = h('span.w-clock');
    const el = h('footer.w-taskbar', start, tasks, h('div.w-tray', clock));

    // The Start menu: who is signed in across the top. Down the white side the places,
    // pinned, then the scripts worked on last (as many as there is room for) and All
    // Scripts. Down the blue side the person's own lists and the settings. The way in
    // or out along the bottom.
    let menu = null;
    const close = () => {
      if (!menu) return;
      menu.remove();
      menu = null;
      start.classList.remove('is-open');
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('blur', close);
    };
    const away = (e) => { if (menu && !menu.contains(e.target) && !start.contains(e.target)) close(); };
    start.addEventListener('click', () => {
      if (menu) return void close();
      const me = NT.api.session;
      const signedIn = !!me && NT.api.mode !== 'demo';
      const item = (label, icon, size, fn, cls) => h('button.w-sm-item' + (cls || ''), { type: 'button', role: 'menuitem', onclick: () => { close(); fn(); } }, W.icon(icon, size), h('span', label));
      // Scripts, opened on one of its lists.
      const scripts = (list) => () => { W.openOn = list; Nav.go('/scripts'); };
      const last = h('div.w-sm-recent');
      const drawRecent = () => last.replaceChildren(...recent.map((s) => item(s.name || s.script_id, 'doc', 32, () => Nav.go('/scripts/' + s.script_id), '.plain')));
      drawRecent();
      // The person's picture, where they have one; Windows' own otherwise.
      const tile = me ? NT.media.avatar(h('span.w-sm-tile', { 'aria-hidden': 'true' }), me.user_id) : h('span.w-sm-tile.app', { 'aria-hidden': 'true' }, W.icon('app', 32));
      menu = h('div.w-startmenu', { role: 'menu', 'aria-label': 'Start', tabIndex: -1 },
        h('header.w-sm-head', tile, h('b', me ? me.name || me.username : 'NT Scripting')),
        h('div.w-sm-cols',
          h('div.w-sm-left',
            item('Home', 'app', 32, () => Nav.go('/')),
            item('Scripts', 'scripts', 32, () => Nav.go('/scripts')),
            item('Maps', 'map', 32, () => Nav.go('/maps')),
            item('New Script', 'doc', 32, NT.actions.create),
            h('i.w-sm-sep'),
            h('div.w-sm-list', last),
            h('i.w-sm-sep'),
            h('button.w-sm-item.w-sm-all', { type: 'button', role: 'menuitem', onclick: () => { close(); scripts('all')(); } }, h('span', 'All Scripts'), h('img', { src: art('all.png'), alt: '', width: 16, height: 16, draggable: false }))),
          h('div.w-sm-right',
            me ? item('My Scripts', 'scripts', 24, scripts('mine')) : null,
            me ? item('Favorites', 'star', 24, scripts('favorites')) : null,
            me ? h('i.w-sm-sep') : null,
            item('Profile', 'user', 24, () => Nav.go('/profile'), '.plain'),
            item('Settings', 'settings', 24, () => Nav.go('/settings'), '.plain'),
            item('Editor Settings', 'props', 24, () => Nav.go('/settings/editor'), '.plain'))),
        h('footer.w-sm-foot', signedIn
          ? item('Log Off', 'logoff', 24, async () => { await NT.api.logout(); Nav.reset(['/']); })
          : item('Sign In…', 'key', 24, () => UI.authDialog('login'))));
      W.layers.pop.append(menu);
      start.classList.add('is-open');
      // Read again: what has changed since is put in while the menu is up. The list has
      // its room either way, so nothing else in the menu moves.
      const el = menu, had = JSON.stringify(recent);
      readRecent().then(() => { if (menu === el && JSON.stringify(recent) !== had) drawRecent(); });
      // The rows there is room for; one cut off by the pane's edge is not reached.
      const all = () => [...el.querySelectorAll('.w-sm-item')].filter((b) => !last.contains(b) || b.offsetLeft < last.parentNode.offsetLeft + last.parentNode.clientWidth);
      menu.addEventListener('keydown', (e) => {
        const list = all(), i = list.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); (list[i + 1] || list[0]).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (list[i - 1] || list[list.length - 1]).focus(); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); start.focus(); }
      });
      // What the pointer is on is what is lit, as in any menu.
      menu.addEventListener('pointerover', (e) => {
        const it = e.target.closest('.w-sm-item');
        if (it) it.focus({ preventScroll: true });
      });
      document.addEventListener('pointerdown', away, true);
      window.addEventListener('blur', close);
      menu.focus({ preventScroll: true });
    });
    // Opened from the keyboard, the first item has it.
    start.addEventListener('keyup', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && menu) menu.querySelector('.w-sm-item').focus({ preventScroll: true });
    });

    // One button a window, in the order they were opened; the one in front is pressed in.
    const order = [];
    W.onChange = () => {
      const open = W.windows();
      for (const w of open) if (!order.includes(w)) order.push(w);
      for (let i = order.length - 1; i >= 0; i--) if (!open.includes(order[i])) order.splice(i, 1);
      const front = W.active();
      tasks.replaceChildren(...order.map((w) => h('button.w-task' + (w === front ? '.is-active' : ''), {
        type: 'button',
        title: w.title,
        // The button of the window in front puts it away; any other brings its window forward.
        onclick: () => {
          if (w === W.active()) return void w.minimise();
          w.front();
          fronted(false);
        },
      }, W.icon(w.icon, 16), h('span', w.title))));
    };
    W.onFront = () => fronted(false);

    const tick = () => { clock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
    tick();
    setInterval(tick, 15000);
    return el;
  }

  /* ---------- Desktop ---------- */

  function desktop() {
    const icons = h('div.w-desk-icons', PLACES.map((p) => {
      const b = h('button.w-desk-icon', { type: 'button' },
        h('span.w-desk-pix', { style: { '--pix': W.iconUrl(p.icon, 32) } }, W.icon(p.icon, 32)), h('span.w-desk-label', p.label));
      // Twice opens it, as on the desktop; a finger has one tap to give, and Enter is Enter.
      b.addEventListener('dblclick', () => Nav.go(p.path));
      b.addEventListener('click', (e) => { if (W.coarse.matches || e.detail === 0) Nav.go(p.path); });
      return b;
    }));
    return h('main.w-desk', icons);
  }

  async function boot() {
    const app = document.getElementById('app');
    const desk = desktop();
    const modal = h('div.w-modal', { hidden: true });
    const pop = h('div.w-pops');
    W.layers = { desk, modal, pop };
    app.append(desk, taskbar(), modal, pop);
    app.classList.add('is-busy');
    await Promise.all([NT.api.init(), NT.ext.init()]);
    app.classList.remove('is-busy');
    app.removeAttribute('aria-busy');
    Nav.start();
    readRecent();
  }

  boot().catch((err) => {
    console.error(err);
    const app = document.getElementById('app');
    app.replaceChildren(h('div.w-blank', h('p', 'NT Scripting could not start'), h('p', String((err && err.message) || err))));
  });
})();
