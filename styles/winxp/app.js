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

  // The window in front is where the browser is.
  function fronted(push) {
    if (quiet) return;
    const win = W.active();
    const path = win ? win.path : '/';
    document.title = win && win.title && win.path !== '/' ? `${win.title} · NT Scripting` : 'NT Scripting';
    if (push) history.pushState({ path }, '', R.href(path));
    else if ((history.state && history.state.path) !== path) history.replaceState({ path }, '', R.href(path));
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
      window.addEventListener('popstate', (e) => show((e.state && e.state.path) || R.current(), false));
      const first = R.match(R.current());
      history.replaceState({ path: first.path }, '', R.href(first.path));
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
    },
  });

  /* ---------- Taskbar ---------- */

  function taskbar() {
    const start = h('button.w-start-btn', { type: 'button', 'aria-haspopup': 'menu' }, W.icon('app', 16), h('b', 'start'));
    const tasks = h('div.w-tasks', { role: 'toolbar', 'aria-label': 'Windows' });
    const clock = h('span.w-clock');
    const el = h('footer.w-taskbar', start, tasks, h('div.w-tray', clock));

    // The Start menu: who is signed in across the top, what this app is for down the
    // white side, the person's own places down the blue side, and the way in or out
    // along the bottom.
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
      const item = (label, icon, size, fn) => h('button.w-sm-item', { type: 'button', role: 'menuitem', onclick: () => { close(); fn(); } }, W.icon(icon, size), h('span', label));
      menu = h('div.w-startmenu', { role: 'menu', 'aria-label': 'Start' },
        h('header.w-sm-head', W.icon(me ? 'user' : 'app', 32), h('b', me ? me.name || me.username : 'NT Scripting')),
        h('div.w-sm-cols',
          h('div.w-sm-left',
            item('Home', 'app', 32, () => Nav.go('/')),
            item('Scripts', 'scripts', 32, () => Nav.go('/scripts')),
            item('Maps', 'map', 32, () => Nav.go('/maps')),
            h('i.w-sm-sep'),
            item('New Script', 'doc', 32, NT.actions.create)),
          h('div.w-sm-right',
            item('Profile', 'user', 24, () => Nav.go('/profile')),
            item('Settings', 'settings', 24, () => Nav.go('/settings')))),
        h('footer.w-sm-foot', signedIn
          ? item('Log Off', 'key', 24, async () => { await NT.api.logout(); Nav.reset(['/']); })
          : item('Sign In…', 'key', 24, () => UI.authDialog('login'))));
      W.layers.pop.append(menu);
      start.classList.add('is-open');
      const all = () => [...menu.querySelectorAll('.w-sm-item')];
      menu.addEventListener('keydown', (e) => {
        const list = all(), i = list.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); (list[i + 1] || list[0]).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (list[i - 1] || list[list.length - 1]).focus(); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); start.focus(); }
      });
      document.addEventListener('pointerdown', away, true);
      window.addEventListener('blur', close);
      all()[0].focus({ preventScroll: true });
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
        onclick: () => {
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
      const b = h('button.w-desk-icon', { type: 'button' }, W.icon(p.icon, 32), h('span', p.label));
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
  }

  boot().catch((err) => {
    console.error(err);
    const app = document.getElementById('app');
    app.replaceChildren(h('div.w-blank', h('p', 'NT Scripting could not start'), h('p', String((err && err.message) || err))));
  });
})();
