/*
  Windows 7's shell: the desktop and its icons; the taskbar, with the Start button, the
  places pinned to it and a button for every other window, the notification area, the
  clock and the sliver that shows the desktop; the Start menu; and the navigator.

  Every address is a window. Going somewhere opens its window, or brings it to the
  front if it is open; the address the browser shows is the window in front. Closing
  a window is going back. A window that shows a place goes to another place in its own
  frame, as Explorer does, and keeps its own Back and Forward.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h } = NT.util;
  const W = NT.w7;
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
  // Pinned to the taskbar: there whether or not their window is open.
  const PINS = PLACES.slice(0, 3);
  // The pages that are places: their windows have the address row.
  const PLACE = { home: true, scripts: true, maps: true };

  let quiet = false; // true while several windows are closed and opened at once

  // The scripts worked on last, for the Start menu. Read when the app starts, when
  // someone signs in or out and each time the menu opens, so it has them as it is drawn.
  let recent = [];
  async function readRecent() {
    const me = NT.api.session;
    if (!me) return (recent = []);
    try {
      const list = await NT.api.userScripts(me.user_id);
      recent = list.slice().sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 9);
    } catch (e) { /* what was read last stands */ }
    return recent;
  }

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

  function make(r) {
    const win = (P[r.name] || P.home)(...r.args);
    win.path = r.path;
    win.trail = [r.path];
    win.at = 0;
    return win;
  }

  function show(path, push) {
    const r = R.match(path);
    let win = W.windows().find((w) => w.path === r.path);
    if (win) win.front();
    else {
      win = make(r);
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

    // From a window that shows a place, to another place in the same frame.
    // to: an address, or -1 / 1 along the places the window has shown (Back, Forward).
    travel(from, to) {
      let trail = from.trail || [from.path], at = from.at || 0, path;
      if (typeof to === 'number') {
        at += to;
        path = trail[at];
        if (!path) return;
      } else {
        path = R.match(to).path;
        if (path === from.path) return;
        trail = trail.slice(0, at + 1).concat(path);
        at = trail.length - 1;
      }
      const r = R.match(path);
      // Somewhere that is not a place, or a place already open, is its own window.
      if (!PLACE[r.name] || !PLACE[R.match(from.path).name] || W.windows().some((w) => w.path === r.path)) return void this.go(path);
      const win = make(r);
      win.trail = trail;
      win.at = at;
      win.takeFrame(from);
      quiet = true;
      win.open({ swap: true });
      from.destroy({ swap: true });
      quiet = false;
      fronted(true);
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
      for (const win of W.windows()) win.destroy({ swap: true });
      const opened = (keep.length ? keep : ['/']).map((p) => show(p, false));
      quiet = false;
      // The one in front is shown by fronted(); the ones behind it are read as well.
      for (const win of opened.slice(0, -1)) if (win.onShow) Promise.resolve(win.onShow()).catch((err) => console.error(err));
      fronted(false);
      readRecent();
    },
  });

  /* ---------- The Start menu ----------
     Down the white side: the places, pinned; under the line the scripts worked on last,
     as many as there is room for; All Scripts; the search box. On the glass side whoever
     is signed in, their own lists, the settings, and the way in or out at the bottom. */

  function startMenu(start) {
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
    const then = (fn) => () => { close(); fn(); };

    start.addEventListener('click', () => {
      if (menu) return void close();
      const me = NT.api.session;
      const signedIn = !!me && NT.api.mode !== 'demo';
      const name = me ? me.name || me.username : '';
      const item = (label, icon, fn) => h('button.w-sm-item', { type: 'button', role: 'menuitem', onclick: then(fn) }, W.icon(icon, 32), h('span', label));
      const side = (label, fn) => h('button.w-sm-item', { type: 'button', role: 'menuitem', onclick: then(fn) }, h('span', label));
      // Scripts, opened on one of its lists.
      const scripts = (list) => () => { W.openOn = list; Nav.go('/scripts'); };
      const last = h('div.w-sm-recent');
      const drawRecent = () => last.replaceChildren(...recent.map((s) => item(s.name || s.script_id, 'doc', () => Nav.go('/scripts/' + s.script_id))));
      drawRecent();
      const find = W.search({ placeholder: 'Search Scripts', 'aria-label': 'Search Scripts' });
      // Enter looks for it among the scripts.
      find.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !find.value.trim()) return;
        e.preventDefault();
        W.find = find.value.trim();
        close();
        Nav.go('/scripts');
      });
      menu = h('div.w-startmenu', { role: 'menu', 'aria-label': 'Start' },
        h('div.w-sm-left',
          h('div.w-sm-list',
            item('Home', 'app', () => Nav.go('/')),
            item('Scripts', 'scripts', () => Nav.go('/scripts')),
            item('Maps', 'map', () => Nav.go('/maps')),
            item('New Script', 'doc', NT.actions.create),
            h('i.w-sm-sep'),
            last),
          h('button.w-sm-item.w-sm-all', { type: 'button', role: 'menuitem', onclick: then(scripts('all')) }, h('i', W.glyph('right', 7, 7)), h('span', 'All Scripts')),
          h('div.w-sm-foot', find)),
        h('div.w-sm-right',
          h('div.w-sm-user', { 'aria-hidden': 'true' }, me ? W.kit.avatar(name, 48, me.user_id) : W.icon('user', 48)),
          me ? side(name, () => Nav.go('/profile')) : null,
          me ? side('My Scripts', scripts('mine')) : null,
          me ? side('Favorites', scripts('favorites')) : null,
          me ? h('i.w-sm-sep') : null,
          side('Settings', () => Nav.go('/settings')),
          side('Editor Settings', () => Nav.go('/settings/editor')),
          h('span.w-gap'),
          signedIn
            ? h('button.w-sm-power', { type: 'button', onclick: then(async () => { await NT.api.logout(); Nav.reset(['/']); }) }, 'Log off')
            : h('button.w-sm-power', { type: 'button', onclick: then(() => UI.authDialog('login')) }, 'Sign in')));
      W.layers.pop.append(menu);
      start.classList.add('is-open');
      const el = menu;
      // Read again: what has changed since is put in while the menu is up. The list has
      // its room either way, so nothing else in the menu moves.
      const had = JSON.stringify(recent);
      readRecent().then(() => { if (menu === el && JSON.stringify(recent) !== had) drawRecent(); });
      // The rows there is room for; one cut off by the pane's edge is not reached.
      const all = () => [...el.querySelectorAll('.w-sm-item, .w-find, .w-sm-power')].filter((b) => !last.contains(b) || b.offsetLeft < last.parentNode.offsetLeft + last.parentNode.clientWidth);
      menu.addEventListener('keydown', (e) => {
        if (!menu) return; // Enter in the search box has just closed it
        const list = all(), i = list.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); (list[i + 1] || list[0]).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (list[i - 1] || list[list.length - 1]).focus(); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); start.focus(); }
      });
      document.addEventListener('pointerdown', away, true);
      window.addEventListener('blur', close);
      // The keyboard starts in the search box, as it does there; a finger's keyboard
      // would cover the menu, so a finger starts on the first item.
      (W.coarse.matches ? all()[0] : find).focus({ preventScroll: true });
    });
  }

  /* ---------- The taskbar ---------- */

  function taskbar() {
    const start = h('button.w-start-btn', { type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'Start', title: 'Start' }, W.picture('orb', 40));
    const tasks = h('div.w-tasks', { role: 'toolbar', 'aria-label': 'Windows' });
    // The app's own icon in the notification area: balloons come from it.
    const tray = h('button.w-tray-icon', { type: 'button', 'aria-label': 'NT Scripting', title: 'NT Scripting', onclick: () => Nav.go('/') }, W.icon('app', 16));
    W.layers.tray = tray;
    const clock = h('span.w-clock');
    // The sliver at the far end puts every window away, to show the desktop, and brings
    // them back.
    let away = [];
    const peek = h('button.w-peek', { type: 'button', 'aria-label': 'Show desktop', title: 'Show desktop', onclick: () => {
      const up = W.windows().filter((w) => !w.minimised);
      if (up.length) {
        away = up;
        for (const w of up) w.minimise();
      } else {
        for (const w of away) if (w.mounted) w.front();
        away = [];
        fronted(false);
      }
    } });
    const el = h('footer.w-taskbar', start, tasks, h('div.w-tray', tray, clock), peek);
    startMenu(start);

    // A button for each pinned place, then one for every other window in the order they
    // were opened. A button with a window open has the frame; the one in front is lit.
    const buttons = new Map(); // a pinned place's address, or a window → its button
    const order = [];
    function button(key) {
      let b = buttons.get(key);
      if (b) return b;
      b = h('button.w-task', { type: 'button' });
      // Under the pointer it glows in the colour of its own picture, from where the pointer is.
      b.addEventListener('pointermove', (e) => b.style.setProperty('--mx', Math.round(e.clientX - b.getBoundingClientRect().left) + 'px'));
      b.addEventListener('click', () => {
        const win = b._win;
        if (!win) return void Nav.go(b._path);
        // The button of the window in front puts it away.
        if (W.active() === win) win.minimise();
        else {
          win.front();
          fronted(false);
        }
      });
      buttons.set(key, b);
      return b;
    }
    W.onChange = () => {
      const open = W.windows();
      for (const w of open) if (!PINS.some((p) => p.path === w.path) && !order.includes(w)) order.push(w);
      for (let i = order.length - 1; i >= 0; i--) if (!open.includes(order[i]) || PINS.some((p) => p.path === order[i].path)) order.splice(i, 1);
      const front = W.active();
      const slots = PINS.map((p) => ({ key: p.path, path: p.path, icon: p.icon, label: p.label, win: open.find((w) => w.path === p.path) || null }))
        .concat(order.map((w) => ({ key: w, path: w.path, icon: w.icon, label: w.title, win: w })));
      const live = new Set(slots.map((s) => s.key));
      for (const key of [...buttons.keys()]) if (!live.has(key)) buttons.delete(key);
      const els = slots.map((s) => {
        const b = button(s.key);
        b._win = s.win;
        b._path = s.path;
        if (b._icon !== s.icon) {
          b._icon = s.icon;
          b.replaceChildren(W.icon(s.icon, 32));
          b.style.setProperty('--tint', W.iconTint(s.icon));
        }
        const label = s.win ? s.win.title || s.label : s.label;
        b.title = label;
        b.setAttribute('aria-label', label);
        b.classList.toggle('is-open', !!s.win);
        b.classList.toggle('is-front', !!s.win && s.win === front);
        return b;
      });
      // Only moved when the row is not already as it should be: a button under the
      // pointer stays under it.
      if (els.length !== tasks.children.length || els.some((b, i) => tasks.children[i] !== b)) tasks.replaceChildren(...els);
    };
    W.onFront = () => fronted(false);
    W.onChange();

    // The time over the date.
    const tick = () => {
      const now = new Date();
      clock.replaceChildren(h('span', now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })), h('span', now.toLocaleDateString([], { year: 'numeric', month: 'numeric', day: 'numeric' })));
    };
    tick();
    setInterval(tick, 15000);
    return el;
  }

  /* ---------- The desktop ---------- */

  function desktop() {
    const icons = h('div.w-desk-icons', PLACES.map((p) => {
      const b = h('button.w-desk-icon', { type: 'button' }, W.icon(p.icon, 48), h('span', p.label));
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
    W.layers = { desk, modal, pop, tray: null };
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
