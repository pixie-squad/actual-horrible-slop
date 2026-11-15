/*
  States: a control at rest, under the pointer, held down, with keyboard focus and
  with what it opens open, and a frame from the middle of the animation that brings
  it up, in each style, theme and size asked for. The control is found by what it
  says (input.js), so one scenario serves every style.

    <out>/states/<scenario>/<style>-<theme>-<size>-<state>.png

  A scenario:
    { name, path, out?        where, signed out or not
      fail?                   failures the mock is to make first (POST /_mock/fail bodies)
      bring?(page)            in the page, what brings the control up (a toast, say)
      label                   what the control says, or a list to try in order
      states                  any of rest, hover, press, focus, open, mid
      expect?(page)           after a real press: → '' when it did what it should, else why }
  A press for `press` is released away from the control, so it does not act; `open`
  presses it for real and shoots what opened, then Escape.
*/
'use strict';

const fs = require('fs');
const path = require('path');
const App = require('./page');
const Input = require('./input');
const { wait } = require('./cdp');

// In the page: freezes every animation running at the given fraction of its length
// (delay and all). With `clock` (ms) they share one clock instead, as in a real frame:
// each is put at `at` × clock, or at its own end if that comes first. 'last' is 1 ms
// before the end (of the clock, or of each), and no animation is put further than 1 ms
// before its own end, so what an end does (a finish handler swapping one element for
// another) has not happened yet.
function freeze(at, clock) {
  const list = document.getAnimations().filter((a) => a.playState === 'running' || a.playState === 'paused');
  for (const a of list) {
    const t = a.effect && a.effect.getComputedTiming();
    if (!t || !isFinite(t.endTime)) continue;
    a.pause();
    const span = (t.delay || 0) + (t.activeDuration || 0);
    const end = Math.max(0, span - 1);
    if (clock) a.currentTime = Math.min(at === 'last' ? clock - 1 : clock * at, end);
    else a.currentTime = at === 'last' ? end : span * at;
  }
  return list.length;
}
function thaw() {
  for (const a of document.getAnimations()) if (a.playState === 'paused') a.play();
}

// In the page: keyboard focus on the control with that name (the last key was a key, so
// it shows as keyboard focus).
function focusOn(labels) {
  const SEL = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], input[type="button"], input[type="submit"]';
  const said = (el) => {
    let out = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeType === 1 && n.getAttribute('aria-hidden') !== 'true') out += ' ' + said(n) + ' ';
    }
    return out;
  };
  for (const label of labels) {
    for (const el of document.querySelectorAll(SEL)) {
      const name = (el.getAttribute('aria-label') || said(el)).replace(/\s+/g, ' ').trim();
      if (name !== label || !el.checkVisibility({ visibilityProperty: true })) continue;
      el.focus();
      return document.activeElement === el;
    }
  }
  return false;
}

// Counts the presses a toast's action got, for expect().
const acted = () => { window.__acted = (window.__acted || 0) + 1; };
const pressedOnce = () => (window.__acted === 1 ? '' : `the action ran ${window.__acted || 0} times`);

const SCENARIOS = [
  // A card's own menu (the Windows styles have none: their lists have menus instead).
  {
    name: 'script-menu',
    path: '/scripts',
    label: ['Script actions', 'More'],
    states: ['rest', 'hover', 'press', 'focus', 'open'],
    optional: true,
  },
  // A toast that can be taken back (a delete), as each platform offers one. Windows 95
  // keeps Undo in the window's first menu, which is opened to find it.
  {
    name: 'toast-undo',
    path: '/scripts',
    bring: new Function(`window.__acted = 0; NT.ui.toast('Deleted', { icon: 'trash', duration: 60000, action: { label: 'Undo', onSelect: ${acted} } });`),
    label: 'Undo',
    reveal: async (page) => {
      const bar = await Input.find(page, ['File'], { within: '.w-window.is-active [role="menubar"]' });
      if (bar) await Input.click(page, bar.x, bar.y);
      await wait(300);
    },
    states: ['mid', 'rest', 'hover', 'press', 'focus', 'open'],
    expect: pressedOnce,
  },
  // A failure that can be tried again: a message box with Retry where that is the platform's way.
  {
    name: 'toast-retry',
    path: '/scripts',
    bring: new Function(`window.__acted = 0; NT.ui.toast('Couldn’t publish: no connection', { warn: true, duration: 60000, action: { label: 'Try Again', onSelect: ${acted} } });`),
    label: ['Try Again', 'Retry'],
    states: ['mid', 'rest', 'hover', 'press', 'focus', 'open'],
    expect: pressedOnce,
  },
  // A page whose list could not be had: the service out of reach.
  {
    name: 'load-failed',
    path: '/scripts',
    fail: { path: '^/api/users/[^/]+/scripts$', status: 0, times: -1 },
    label: 'Try Again',
    states: ['rest', 'hover', 'press', 'focus'],
  },
  // The service out of reach as the app starts.
  {
    name: 'boot-down',
    path: '/',
    fail: { path: '^/api/users/me$', status: 0, times: -1 },
    label: ['Try Again', 'Retry'],
    states: ['rest', 'hover', 'press', 'focus'],
  },
];

async function run(ctx) {
  const { opt, browser, mock, here, say, SIZES, problems } = ctx;
  const started = Date.now();
  const list = SCENARIOS.concat(ctx.scenarios || []);
  let shots = 0;
  for (const size of opt.sizes) {
    const page = await browser.page(Object.assign({ isolated: true }, SIZES[size]));
    for (const style of opt.styles) {
      for (const theme of opt.themes) {
        await App.prefs(page, { style, theme });
        for (const sc of list) {
          const where = `${style} ${theme} ${size} ${sc.name}`;
          const dir = path.join(opt.out, 'states', sc.name);
          fs.mkdirSync(dir, { recursive: true });
          const file = (state) => path.join(dir, `${style}-${theme}-${size}-${state}.png`);
          await fetch(mock.url + '/_mock/clear', { method: 'POST' });
          for (const f of [].concat(sc.fail || [])) await fetch(mock.url + '/_mock/fail', { method: 'POST', body: JSON.stringify(f) });
          if (sc.out) await App.signOut(page);
          else await App.signIn(page, mock, 'ada');
          const w = App.watch(page, { expected: () => true });
          w.label(where);
          const res = await App.open(page, here.url + sc.path, w);
          if (!res.ok) { problems.push({ kind: 'state', where, text: res.why }); continue; }
          const errors = () => w.problems.filter((p) => p.kind === 'exception');
          const labels = [].concat(sc.label);
          const bring = async () => {
            if (sc.bring) await page.eval(sc.bring);
            await wait(sc.bring ? 60 : 0);
          };
          await bring();
          if (sc.states.includes('mid')) {
            await page.eval(freeze, 0.5);
            await page.shot(file('mid'));
            await page.eval(thaw);
            shots++;
          }
          await wait(600);
          let at = await Input.find(page, labels);
          if (!at && sc.reveal) {
            await sc.reveal(page);
            at = await Input.find(page, labels);
          }
          if (!at) {
            if (!sc.optional) problems.push({ kind: 'state', where, text: `no control named ${labels.join(' / ')}` });
            continue;
          }
          const clip = { x: Math.max(0, at.x - at.w / 2 - 24), y: Math.max(0, at.y - at.h / 2 - 24), width: at.w + 48, height: at.h + 48 };
          for (const state of sc.states) {
            if (state === 'mid') continue;
            // A control in a menu is gone once the menu closes: brought back for each state.
            if (sc.reveal && !(await Input.find(page, labels))) await sc.reveal(page);
            at = (await Input.find(page, labels)) || at;
            if (state === 'rest') {
              await Input.hover(page, 1, 1);
              await wait(250);
              await page.shot(file('rest'));
            } else if (state === 'hover') {
              await Input.hover(page, at.x, at.y);
              await wait(300);
              await page.shot(file('hover'), clip);
            } else if (state === 'press') {
              await Input.press(page, at.x, at.y);
              await wait(220);
              await page.shot(file('press'), clip);
              // Let go somewhere else, so the press does not count as a click.
              await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1, buttons: 1 });
              await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1, y: 1, button: 'left', buttons: 0, clickCount: 1 });
              await wait(200);
            } else if (state === 'focus') {
              await Input.hover(page, 1, 1);
              // A key first, so focus shows as keyboard focus; in an open menu an arrow,
              // since Tab would close it.
              const inMenu = await page.eval((x, y) => !!(document.elementFromPoint(x, y) || document.body).closest('[role="menu"]'), at.x, at.y);
              if (inMenu) {
                await Input.key(page, 'ArrowDown');
                await Input.key(page, 'ArrowUp');
              } else await Input.key(page, 'Tab', { shift: true });
              const ok = await page.eval(focusOn, labels);
              if (!ok) problems.push({ kind: 'state', where, text: 'could not take keyboard focus' });
              await wait(250);
              await page.shot(file('focus'), clip);
            } else if (state === 'open') {
              at = (await Input.find(page, labels)) || at;
              await Input.click(page, at.x, at.y);
              await wait(700);
              await page.shot(file('open'));
              if (sc.expect) {
                const why = await page.eval(sc.expect).catch((e) => e.message);
                if (why) problems.push({ kind: 'state', where, text: why });
              }
              await Input.key(page, 'Escape');
              await wait(400);
            }
            shots++;
          }
          for (const e of errors()) problems.push(e);
        }
        await fetch(mock.url + '/_mock/clear', { method: 'POST' });
      }
      say(`  states: ${style} ${size} done`);
    }
    await page.close();
  }
  return { summary: `states: ${shots} shots of ${list.length} scenario(s) in ${Math.round((Date.now() - started) / 1000)} s, in ${path.join(opt.out, 'states')}` };
}

module.exports = { run, SCENARIOS, freeze, thaw };
