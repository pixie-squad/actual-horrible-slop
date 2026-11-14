/*
  A person's hands, through the DevTools protocol: real pointer presses (held, so
  press states show), wheel turns, keys, and finding a control the way a person
  does, by what it says. The words are the same in every style (DESIGN.md §4), so
  one label finds the control in all six.

    await Input.find(page, ['Scripts', 'Maps'], { within })  → { x, y, label, tag } | null
    await Input.click(page, x, y, { hold })                  hold: ms between press and release
    await Input.hover(page, x, y)
    await Input.wheel(page, x, y, dy, { times, every })
    await Input.key(page, 'Escape' | 'Tab' | 'Enter' | …, { shift })
*/
'use strict';

const { wait } = require('./cdp');

// In the page: the visible control whose accessible name or text is one of `labels`,
// the topmost at its own centre. Controls are what can be pressed: buttons, links,
// tabs, menu items, and anything with a click role.
function finder(labels, within, all) {
  const root = within ? document.querySelector(within) : document;
  if (!root) return null;
  const found = [];
  const SEL = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="link"], [role="option"], [role="treeitem"], summary, input[type="button"], input[type="submit"]';
  // Its text without what is hidden from assistive technology (an icon font's ligature).
  const said = (el) => {
    let out = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeType === 1 && n.getAttribute('aria-hidden') !== 'true') out += ' ' + said(n) + ' ';
    }
    return out;
  };
  const name = (el) => (el.getAttribute('aria-label') || said(el) || el.value || '').replace(/\s+/g, ' ').trim();
  for (const label of labels) {
    for (const el of root.querySelectorAll(SEL)) {
      if (name(el) !== label && el.getAttribute('title') !== label) continue;
      if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
      const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
      const y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
      // What a press there lands on: the control, a part of it, or the bar it sits in
      // when the bar takes the presses for it (a tab bar dragged across).
      const top = document.elementFromPoint(x, y);
      if (!top || (top !== el && !el.contains(top) && !top.contains(el))) continue;
      const hit = { x, y, label, tag: el.tagName.toLowerCase(), w: r.width, h: r.height };
      if (!all) return hit;
      found.push(hit);
    }
  }
  return all ? found : null;
}

const find = (page, labels, { within } = {}) => page.eval(finder, [].concat(labels), within || null, false);
// Every one that matches, in the order of the labels and then of the page.
const findAll = (page, labels, { within } = {}) => page.eval(finder, [].concat(labels), within || null, true);

async function hover(page, x, y) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
}

async function click(page, x, y, { hold = 90 } = {}) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await wait(hold);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

// Twice, as a desktop icon is opened.
async function double(page, x, y) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  for (const clickCount of [1, 2]) {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount });
    await wait(40);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount });
    await wait(60);
  }
}

async function press(page, x, y) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  return () => page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

async function wheel(page, x, y, dy, { times = 1, every = 16 } = {}) {
  for (let i = 0; i < times; i++) {
    await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy });
    if (every) await wait(every);
  }
}

const KEYS = {
  Escape: { code: 'Escape', keyCode: 27 },
  Tab: { code: 'Tab', keyCode: 9 },
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ' ': { code: 'Space', keyCode: 32, text: ' ' },
};

// Sent as keyDown, not rawKeyDown: headless Helium drops some rawKeyDown chords.
async function key(page, k, { shift = false } = {}) {
  const d = KEYS[k] || { code: 'Key' + k.toUpperCase(), keyCode: k.toUpperCase().charCodeAt(0), text: k };
  const base = { key: k, code: d.code, windowsVirtualKeyCode: d.keyCode, nativeVirtualKeyCode: d.keyCode, modifiers: shift ? 8 : 0 };
  await page.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, base, d.text ? { text: d.text } : null));
  await page.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
}

module.exports = { find, findAll, finder, hover, click, double, press, wheel, key };
