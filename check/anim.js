/*
  Animations frame by frame, measured (DESIGN.md §2, styles/glass/DESIGN.md §7: an
  animation is right in every frame, and its last frame and the frame after the swap
  are identical).

    node check/run.js --only anim --styles glass [--scenarios menu-close,toast-in]

  Each scenario loads its page afresh, brings the app to a state, and sets an animation
  going with a real press or key where it can (the app's own call where it cannot).
  The moment the animation exists, every animation in the document is stopped: WAAPI
  animations, CSS transitions and animations alike (document.getAnimations(), custom
  properties too), the app's JS springs (NT.util.Spring), which are held by keeping
  their frames back, and its timers of more than 20 ms, which wait with what they have
  left (shorter ones are left alone: they wait for work, such as a lens being read back
  from the GPU, not for time). The pointer is moved to a corner where nothing reacts to
  it (a held press stays where it is until it is let go), and focus rings are not drawn
  at all: neither a hover glow nor a ring handed back on close is what is measured.

  Frames are read from one clock, as real frames are: T is 0, 10, 25, 50, 75 or 90 % of
  the longest delay + duration among what was caught (springs' time to rest included),
  and `last` is 1 ms before that end. Each animation is put at T, or 1 ms before its own
  end if that comes first, so nothing ends and no finish handler (an element swapped
  for another) runs. Two frames are let through for anything that follows animated
  values from requestAnimationFrame, and a clip of where things move is shot at device
  scale. Then everything plays on; once nothing has moved for three frames the same
  clip is shot again (`after`), and 700 ms later once more (`settled`).

    <out>/anim/<scenario>/<theme>-<size>-<frame>.png
      before          the frame before the input that starts it
      0 … 0.9, last   the frozen frames
      after           three frames after the end
      settled         700 ms after that
      released        a held press, let go and settled (switch, slider, segmented)
      diff            last against after: changed pixels in magenta over a faded after
      diff-start      before against 0
      diff-drift      the 0.5 frame against itself two frames later, when they differ
    <out>/anim/results.json, results.txt (the table)

  Numbers, per scenario, theme and size (pixels at device scale; a pixel has changed
  when any channel differs by more than 8):
    end      last → after: what jumps when the animation hands over (the rule says 0)
    start    before → 0: what jumps on its first frame
    drift    the 0.5 frame shot twice, two frames apart: anything not 0 moves on its own
             while everything is meant to be stopped (a timer, a rAF loop)
    late     after → settled: what still changes once it has ended (a lens rendered
             for the final shape, a timer)

  A spring is put at T (or 1 ms short of rest) from where it was when stopped, by
  running its own step with made-up frame times; a spring that starts after the stop
  stays where it began.
*/
'use strict';

const fs = require('fs');
const path = require('path');
const App = require('./page');
const Input = require('./input');
const PNG = require('./png');
const States = require('./states');
const { wait } = require('./cdp');

const FRACTIONS = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 'last'];
const PAD = 24; // css px around what moves
const HOLD = 250; // ms a real press is held

/* ---------- In the page (each is sent as its own source, so each stands alone) ---------- */

// Once per load: springs are noted as they are set, and their frames can be held back.
function install() {
  if (window.__anim) return !!window.__anim.spring;
  const raf = window.requestAnimationFrame.bind(window);
  const caf = window.cancelAnimationFrame.bind(window);
  const S = (window.__anim = { hold: false, held: new Map(), springs: new Set(), snaps: new Map(), fake: -1, raf, caf, spring: false, clock: 1 });
  // Focus going back to a control when something closes draws its ring on the frame of
  // the swap; that is not what is being measured, so no ring is drawn at all.
  const style = document.createElement('style');
  style.textContent = '*:focus-visible { outline: none !important; }';
  document.head.append(style);
  // A spring asks for its next frame with its own bound step (util.js).
  window.requestAnimationFrame = function (cb) {
    if (S.hold && typeof cb === 'function' && cb.name === 'bound _step') {
      const id = S.fake--;
      S.held.set(id, cb);
      return id;
    }
    return raf(cb);
  };
  window.cancelAnimationFrame = function (id) {
    if (S.held.delete(id)) return;
    caf(id);
  };
  const Spring = window.NT && NT.util && NT.util.Spring;
  if (Spring) {
    for (const k of ['set', 'jump']) {
      const own = Spring.prototype[k];
      Spring.prototype[k] = function (...args) {
        S.springs.add(this);
        return own.apply(this, args);
      };
    }
    S.spring = true;
  }
  // Timers that measure time keep to the animations' clock: while they are stopped such a
  // timer neither fires nor comes any closer. Otherwise a toast's time runs out in the
  // middle of its frames, and a lens is rendered for a shape that only stands still
  // because the test stopped it (glass.js renders one 140 ms after the last change of
  // size, which a moving shape never gets to). A timer of 20 ms or less is a way to wait
  // for work (lens.js polls the GPU every 2 ms): it runs as it would.
  const st = window.setTimeout, ct = window.clearTimeout;
  const timers = new Map(); // the id the page holds → { due, cb, args, native }
  let tid = 1e7;
  const arm = (id, t, ms) => { t.native = st.call(window, () => { timers.delete(id); t.cb(...t.args); }, ms); };
  S.frozenAt = null;
  window.setTimeout = function (cb, ms, ...args) {
    if (typeof cb !== 'function' || !(Number(ms) > 20)) return st.call(window, cb, ms, ...args);
    ms = Number(ms);
    const id = ++tid;
    const t = { cb, args, native: null, due: (S.frozenAt != null ? S.frozenAt : performance.now()) + ms };
    timers.set(id, t);
    if (S.frozenAt == null) arm(id, t, ms);
    return id;
  };
  window.clearTimeout = function (id) {
    const t = timers.get(id);
    if (!t) return ct.call(window, id);
    timers.delete(id);
    if (t.native != null) ct.call(window, t.native);
  };
  S.stopClock = () => {
    if (S.frozenAt != null) return;
    S.frozenAt = performance.now();
    for (const t of timers.values()) if (t.native != null) { ct.call(window, t.native); t.native = null; }
  };
  S.startClock = () => {
    if (S.frozenAt == null) return;
    const now = performance.now();
    for (const [id, t] of timers) {
      const left = Math.max(0, t.due - S.frozenAt);
      t.due = now + left;
      arm(id, t, left);
    }
    S.frozenAt = null;
  };
  return S.spring;
}

// After the input: waits (frame by frame) for a finite animation, on or in `sel` when
// given, then stops every one there is, and every spring that is moving.
async function catchAnims(sel, timeout) {
  const S = window.__anim;
  const t0 = performance.now();
  const finite = (a) => {
    const t = a.effect && a.effect.getComputedTiming();
    return !!t && isFinite(t.endTime);
  };
  const live = () => document.getAnimations().filter((a) => (a.playState === 'running' || a.playState === 'paused') && finite(a));
  const matches = (a) => {
    if (!sel) return true;
    const el = a.effect && a.effect.target;
    return !!el && !!el.closest && !!el.closest(sel);
  };
  for (;;) {
    const list = live();
    // A control moved by springs alone (a switch's knob, a segmented thumb) starts when a
    // spring does.
    if (list.some(matches) || [...S.springs].some((s) => s._raf)) {
      for (const a of list) a.pause();
      S.stopClock();
      break;
    }
    if (performance.now() - t0 > timeout) return { ok: false, waited: Math.round(performance.now() - t0), running: list.length };
    await new Promise((r) => S.raf(r));
  }
  S.hold = true;
  // Springs moving now are held where they are, and noted so they can be put anywhere
  // along their way; how long that way is comes from the same physics as their step.
  const restAfter = (s) => {
    let x = s.value, v = s.velocity;
    for (let t = 16; t <= 4000; t += 16) {
      for (let i = 0; i < 4; i++) {
        const acc = -s.k * (x - s.target) - s.c * v;
        v += acc * 0.004;
        x += v * 0.004;
      }
      if (Math.abs(v) < s.eps * 10 && Math.abs(x - s.target) < s.eps) return t;
    }
    return 4000;
  };
  for (const s of S.springs) {
    if (!s._raf) continue;
    if (!S.held.has(s._raf)) {
      S.caf(s._raf);
      const id = S.fake--;
      S.held.set(id, s._step);
      s._raf = id;
    }
    S.snaps.set(s, { value: s.value, velocity: s.velocity, target: s.target, ms: restAfter(s) });
  }
  // The clock every frame is read from: the longest of what the input set going.
  const spans = live().map((a) => {
    const t = a.effect.getComputedTiming();
    return (t.delay || 0) + (t.activeDuration || 0);
  });
  for (const snap of S.snaps.values()) spans.push(snap.ms);
  S.clock = Math.max(1, ...spans);
  const name = (el) => {
    if (!el || !el.tagName) return '?';
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
    return el.tagName.toLowerCase() + cls.map((c) => '.' + c).join('');
  };
  const anims = live().map((a) => {
    const e = a.effect;
    const t = e.getComputedTiming();
    let props = [];
    if (a.transitionProperty) props = [a.transitionProperty];
    else if (a.animationName) props = ['@' + a.animationName];
    else if (e.getKeyframes) props = [...new Set(e.getKeyframes().flatMap((k) => Object.keys(k)))].filter((k) => !['offset', 'computedOffset', 'easing', 'composite'].includes(k));
    return { target: name(e.target) + (e.pseudoElement || ''), kind: a.constructor.name, props, ms: Math.round(t.endTime) };
  });
  return { ok: true, waited: Math.round(performance.now() - t0), anims, springs: S.snaps.size, clock: Math.round(S.clock) };
}

// Every stopped spring, put where it would be at `at` of the shared clock, or 1 ms short
// of coming to rest if that comes first.
function seekSprings(at) {
  const S = window.__anim;
  if (!S) return 0;
  for (const [s, snap] of S.snaps) {
    const ms = Math.min(at === 'last' ? S.clock - 1 : S.clock * at, Math.max(0, snap.ms - 1));
    S.held.delete(s._raf);
    s.value = snap.value;
    s.velocity = snap.velocity;
    s.target = snap.target;
    s._t = 0;
    s._raf = 0;
    s.onUpdate(s.value, s.velocity);
    let rest = false;
    for (let t = 0; t < ms;) {
      t += Math.min(16, ms - t);
      S.held.delete(s._raf);
      s._raf = -0.5;
      s._step(t); // its own step, with a made-up frame time; asks for a frame that is held
      if (!s._raf) { rest = true; break; }
    }
    if (!rest && !S.held.has(s._raf)) {
      const id = S.fake--;
      S.held.set(id, s._step);
      s._raf = id;
    }
  }
  return S.snaps.size;
}

// Springs carry on from where they were put, without a jump; nothing is held any more,
// and the timers run again with what they had left.
function releaseSprings() {
  const S = window.__anim;
  if (!S) return;
  S.startClock();
  const now = document.timeline.currentTime;
  for (const s of S.springs) {
    if (!S.held.has(s._raf)) continue;
    S.held.delete(s._raf);
    s._t = now;
    s._raf = S.raf(s._step);
  }
  for (const cb of S.held.values()) S.raf(cb);
  S.held.clear();
  S.snaps.clear();
  S.hold = false;
}

// Resolves once nothing has moved for three frames (spinners and other endless
// animations aside): no finite animation running, no spring away from rest.
async function idle(timeout) {
  const S = window.__anim;
  const t0 = performance.now();
  const busy = () => document.getAnimations().some((a) => {
    if (a.playState !== 'running') return false;
    const t = a.effect && a.effect.getComputedTiming();
    return !!t && isFinite(t.endTime);
  }) || (!!S && [...S.springs].some((s) => s._raf));
  let calm = 0;
  while (performance.now() - t0 < timeout) {
    await new Promise((r) => requestAnimationFrame(r));
    if (busy()) calm = 0;
    else if (++calm >= 3) return true;
  }
  return false;
}

// The rectangles (viewport, css px) of what is moving now: the targets of the stopped
// animations (within `scope` when given; without one, nothing that covers most of the
// screen, a page sliding or a dim), and the elements matching `area`.
function rectsNow(scope, area) {
  const vw = innerWidth, vh = innerHeight, out = [];
  const add = (r, big) => {
    const x0 = Math.max(0, r.left), y0 = Math.max(0, r.top), x1 = Math.min(vw, r.right), y1 = Math.min(vh, r.bottom);
    if (x1 - x0 < 1 || y1 - y0 < 1) return;
    if (!big && (x1 - x0) * (y1 - y0) > 0.85 * vw * vh) return;
    out.push([x0, y0, x1, y1]);
  };
  if (!area || scope) {
    for (const a of document.getAnimations()) {
      if (a.playState !== 'paused') continue;
      const el = a.effect && a.effect.target;
      if (!el || !el.isConnected || !el.getBoundingClientRect) continue;
      if (scope && !el.closest(scope)) continue;
      add(el.getBoundingClientRect(), !!scope);
    }
  }
  for (const sel of area || []) for (const el of document.querySelectorAll(sel)) add(el.getBoundingClientRect(), true);
  return out;
}

// The centre of a visible element in the page on top (or in an overlay) matching `sel`
// whose text is `text`, scrolled to first when asked; null when there is none.
function point(sel, text, scroll) {
  const top = window.NT && NT.nav && NT.nav.top && NT.nav.top();
  const roots = [top ? top.page.el : document, NT.dom && NT.dom.overlays].filter(Boolean);
  for (const root of roots) {
    for (const el of root.querySelectorAll(sel)) {
      if (text != null && el.textContent.replace(/\s+/g, ' ').trim() !== text) continue;
      if (!el.checkVisibility({ visibilityProperty: true })) continue;
      if (scroll) el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue;
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      // What a press there lands on: it, a part of it, or a part of the control it is in
      // (a segmented control's thumb lies over the chosen segment).
      const hit = document.elementFromPoint(x, y);
      if (!hit || (hit !== el && !el.contains(hit) && !hit.contains(el) && !(el.parentElement && el.parentElement.contains(hit)))) continue;
      return { x, y, w: r.width, h: r.height };
    }
  }
  return null;
}

// A corner of the screen with nothing under it that reacts to a pointer, to leave the
// pointer at, so no hover glow differs between frames.
function aside() {
  const w = innerWidth, h = innerHeight;
  for (const [x, y] of [[1, h - 1], [1, 1], [w - 1, h - 1], [w - 1, 1], [1, h / 2]]) {
    const el = document.elementFromPoint(x, y);
    if (!el || !el.closest('button, a, input, textarea, [role], [tabindex]:not([tabindex="-1"]), .glass, .interactive, .pressable, .card')) return { x, y };
  }
  return { x: 1, y: 1 };
}

// Shows a read-only document in the editor, as "Go to Definition" into a definition
// file does: through the opener the app registers with Monaco (js/monaco.js).
async function openDefinition() {
  const ed = window.monaco && monaco.editor.getEditors()[0];
  if (!ed || !ed.getModel()) return 'no editor';
  const at = ed.getModel().uri;
  const uri = monaco.Uri.from({ scheme: at.scheme, authority: at.authority, path: '/defs/globals.d.luau' });
  if (!monaco.editor.getModel(uri)) monaco.editor.createModel('declare function print(...: any): ()\n', 'luau', uri);
  const svc = ed._codeEditorService;
  if (!svc || !svc.openCodeEditor) return 'no code editor service to open it with';
  await svc.openCodeEditor({ resource: uri }, ed);
  return '';
}

const twoFrames = 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))';
// Every animation on the one clock caught with them (states.js freeze), springs as well.
const seekExpr = (at) => `(async () => { (${States.freeze})(${JSON.stringify(at)}, window.__anim.clock); (${seekSprings})(${JSON.stringify(at)}); await ${twoFrames}; })()`;
const measureExpr = (scope, area) => `(() => {
  const freeze = ${States.freeze}, seek = ${seekSprings}, rects = ${rectsNow};
  const out = [];
  for (const at of ${JSON.stringify(FRACTIONS)}) { freeze(at, window.__anim.clock); seek(at); out.push(...rects(${JSON.stringify(scope || null)}, ${JSON.stringify(area || null)})); }
  return out;
})()`;
const thawExpr = `(() => { (${releaseSprings})(); (${States.thaw})(); })()`;

/* ---------- Ways in ---------- */

// A real press, held so its press state shows, with the frame before it lets go.
async function tap(page, at, h) {
  const up = await Input.press(page, at.x, at.y);
  await wait(HOLD);
  if (h) await h.before();
  await up();
}
const find = async (page, labels) => {
  const at = await Input.find(page, labels);
  if (!at) throw new Error(`no control named ${[].concat(labels).join(' / ')}`);
  return at;
};
const spot = async (page, sel, text, scroll) => {
  const at = await page.eval(point, sel, text == null ? null : text, !!scroll);
  if (!at) throw new Error(`nothing to press: ${sel}${text ? ' "' + text + '"' : ''}`);
  if (scroll) await page.eval(idle, 2000);
  return scroll ? (await page.eval(point, sel, text == null ? null : text, false)) || at : at;
};
const settle = (page, ms = 4000) => page.eval(idle, ms);
const moveAside = async (page) => {
  const at = await page.eval(aside);
  await Input.hover(page, at.x, at.y);
};
const key = async (page, k, h) => {
  await h.before();
  await Input.key(page, k);
};
const call = async (page, fn, h) => {
  await h.before();
  return page.eval(fn);
};
// The script page, pushed from the Scripts list by pressing a card.
const card = (page) => spot(page, '.script-card h3', null);
async function openScript(page, w) {
  await tap(page, await card(page));
  await w.quiet(400, 10000);
  await settle(page);
}
const scrollTop = (y) => new Function(`NT.nav.top().page.scroll.scrollTo({ top: ${y}, behavior: 'instant' });`);
const gone = (sel) => new Function(`return document.querySelector(${JSON.stringify(sel)}) ? 'still there: ${sel}' : '';`);
// The editor's Details: a button of its own, or in More when Test has taken its place.
async function openDetails(page, h) {
  let at = await Input.find(page, ['Details']);
  if (!at) {
    await tap(page, await find(page, ['More']));
    await settle(page);
    at = await find(page, ['Details']);
  }
  await tap(page, at, h);
}
const editorReady = (page) => page.until(() => window.monaco && monaco.editor.getEditors().length && document.querySelector('.code-return'), { timeout: 30000 });

/* ---------- Scenarios ----------
  { name, path, out?        where, signed out or not
    sizes?, why?            only at these sizes (why not at the others)
    how                     what starts it, in words (results.json)
    setup?(page, w)         brings the app to the state
    trigger(page, h, w)     starts it; calls h.before() just before the decisive input;
                            may return { release } for a press that is still held
    catch?                  the animation that says it has started is on or in this
    wait?                   ms to wait for it (default 1500)
    scope?, area?           where to shoot: animated targets within scope; elements of area
    expect?(page)           in the page, once settled: '' when the end state is right }
*/
const SCENARIOS = [
  {
    name: 'menu-open',
    path: '/scripts/ada-trainer',
    how: 'press More in the top bar',
    trigger: async (page, h) => tap(page, await find(page, ['More']), h),
    catch: '.pop',
    expect: () => (document.querySelector('.pop') ? '' : 'no menu'),
  },
  {
    name: 'menu-close',
    path: '/scripts/ada-trainer',
    how: 'Escape on the More menu',
    setup: async (page) => tap(page, await find(page, ['More'])),
    trigger: (page, h) => key(page, 'Escape', h),
    catch: '.pop',
    expect: () => {
      if (document.querySelector('.pop')) return 'the menu is still there';
      const src = document.querySelector('.pop-source');
      if (src) return 'its control is still marked as the menu';
      const g = [...document.querySelectorAll('.navbar .nav-group')].find((n) => n.checkVisibility());
      return g && getComputedStyle(g).visibility === 'visible' ? '' : 'the control is not back';
    },
  },
  {
    name: 'confirm-open',
    path: '/settings/editor',
    how: 'press Reset (Editor settings)',
    setup: async (page) => {
      await page.eval(() => { const EP = NT.editorPrefs; if (!EP.changed()) EP.set({ wrap: !EP.data.wrap }); });
      await spot(page, 'button.row .row-title', 'Reset', true);
    },
    trigger: async (page, h) => tap(page, await spot(page, 'button.row .row-title', 'Reset'), h),
    catch: '.pop',
    expect: () => (document.querySelector('.pop[role="alertdialog"]') ? '' : 'no dialog'),
  },
  {
    name: 'confirm-close',
    path: '/settings/editor',
    how: 'Escape on the Reset dialog',
    setup: async (page) => {
      await page.eval(() => { const EP = NT.editorPrefs; if (!EP.changed()) EP.set({ wrap: !EP.data.wrap }); });
      await spot(page, 'button.row .row-title', 'Reset', true);
      await tap(page, await spot(page, 'button.row .row-title', 'Reset'));
    },
    trigger: (page, h) => key(page, 'Escape', h),
    catch: '.pop',
    expect: () => {
      if (document.querySelector('.pop')) return 'the dialog is still there';
      const row = [...document.querySelectorAll('button.row')].find((b) => b.textContent.trim() === 'Reset' && b.checkVisibility());
      return row && getComputedStyle(row).visibility === 'visible' ? '' : 'Reset is not back';
    },
  },
  {
    name: 'toast-in',
    path: '/scripts',
    how: "NT.ui.toast('Saved')",
    trigger: (page, h) => call(page, () => { NT.ui.toast('Saved', { duration: 60000 }); }, h),
    catch: '.toast',
    expect: () => (document.querySelector('.toast') ? '' : 'no toast'),
  },
  {
    name: 'toast-out',
    path: '/scripts',
    how: "NT.ui.toast('Saved', { duration: 2200 }) timing out",
    setup: async (page) => { await page.eval(() => { NT.ui.toast('Saved', { duration: 2200 }); }); },
    trigger: async (page, h) => { await h.before(); },
    catch: '.toast',
    wait: 4000,
    expect: gone('.toast'),
  },
  {
    name: 'push',
    path: '/scripts',
    how: 'press a card in Scripts',
    trigger: async (page, h) => tap(page, await card(page), h),
    area: ['.stage > .page > .navbar'],
  },
  {
    name: 'pop',
    path: '/scripts',
    how: 'press Back on a script pushed from Scripts',
    setup: (page, w) => openScript(page, w),
    trigger: async (page, h) => tap(page, await find(page, ['Back']), h),
    area: ['.stage > .page > .navbar'],
  },
  {
    name: 'title-in',
    path: '/scripts',
    sizes: ['phone'],
    why: 'the wide layout has no title in the top bar',
    how: 'scroll Scripts to 60 px (past the large title)',
    startNote: 'start includes the scroll',
    trigger: (page, h) => call(page, scrollTop(60), h),
    catch: '.navbar-title-pill',
    scope: '.navbar-title',
  },
  {
    name: 'title-out',
    path: '/scripts',
    sizes: ['phone'],
    why: 'the wide layout has no title in the top bar',
    how: 'scroll Scripts from 60 px back to the top',
    startNote: 'start includes the scroll',
    setup: (page) => page.eval(scrollTop(60)),
    trigger: (page, h) => call(page, scrollTop(0), h),
    catch: '.navbar-title-pill',
    scope: '.navbar-title',
  },
  {
    name: 'accessory-in',
    path: '/scripts',
    how: 'press a card in Scripts (Start Friendly Battle comes in)',
    trigger: async (page, h) => tap(page, await card(page), h),
    catch: '.accessory',
    scope: '.accessory',
  },
  {
    name: 'accessory-out',
    path: '/scripts',
    how: 'Back from a script page',
    setup: (page, w) => openScript(page, w),
    trigger: async (page, h) => tap(page, await find(page, ['Back']), h),
    catch: '.accessory',
    scope: '.accessory',
    expect: () => (document.querySelector('.accessory').childElementCount ? 'the accessory is still there' : ''),
  },
  {
    name: 'sheet-open',
    path: '/',
    out: true,
    how: 'press Sign In in the top bar, signed out',
    trigger: async (page, h) => tap(page, await spot(page, '.navbar .nav-pill', 'Sign In'), h),
    catch: '.sheet',
    scope: '.sheet',
    expect: () => (document.querySelector('.sheet') ? '' : 'no sheet'),
  },
  {
    name: 'sheet-close',
    path: '/',
    out: true,
    how: 'Escape on the Sign In sheet',
    setup: async (page) => tap(page, await spot(page, '.navbar .nav-pill', 'Sign In')),
    trigger: (page, h) => key(page, 'Escape', h),
    catch: '.sheet',
    scope: '.sheet',
    expect: gone('.sheet-layer'),
  },
  {
    name: 'details-open',
    path: '/scripts/ada-trainer/edit',
    how: 'press Details in the editor',
    setup: editorReady,
    trigger: (page, h) => openDetails(page, h),
    catch: '.sheet',
    scope: '.sheet',
    expect: () => (document.querySelector('.sheet') ? '' : 'no sheet'),
  },
  {
    name: 'details-close',
    path: '/scripts/ada-trainer/edit',
    how: 'Escape on the editor’s Details sheet',
    setup: async (page) => { await editorReady(page); await openDetails(page); },
    trigger: (page, h) => key(page, 'Escape', h),
    catch: '.sheet',
    scope: '.sheet',
    expect: gone('.sheet-layer'),
  },
  {
    name: 'code-return',
    path: '/scripts/ada-trainer/edit',
    how: 'a definition file opened in the editor (through the app’s Monaco opener, not the language server)',
    setup: editorReady,
    trigger: async (page, h) => {
      await h.before();
      const why = await page.eval(openDefinition);
      if (why) throw new Error(why);
    },
    catch: '.code-return',
    scope: '.code-return',
    expect: () => (document.querySelector('.code-return:not([hidden])') ? '' : 'no way back to the file'),
  },
  {
    name: 'switch',
    path: '/settings/editor',
    how: 'press and hold the Word Wrap switch',
    toggles: true, // let go where it was pressed, it turns over: released is not before
    setup: (page) => spot(page, '[role="switch"][aria-label="Word Wrap"]', null, true),
    trigger: async (page, h) => {
      const at = await spot(page, '[role="switch"][aria-label="Word Wrap"]', null);
      await h.before();
      return { release: await Input.press(page, at.x, at.y) };
    },
    scope: '.switch',
  },
  {
    name: 'slider',
    path: '/settings',
    how: 'press and hold the Liquid Glass slider on its thumb',
    setup: (page) => spot(page, '.slider-thumb', null, true),
    trigger: async (page, h) => {
      const at = await spot(page, '.slider-thumb', null);
      await h.before();
      return { release: await Input.press(page, at.x, at.y) };
    },
    scope: '.slider',
  },
  {
    name: 'segmented',
    path: '/scripts',
    how: 'press and hold the chosen segment (Mine) of the Scripts filter',
    trigger: async (page, h) => {
      const at = await spot(page, '.seg .seg-item[aria-selected="true"]', null);
      await h.before();
      return { release: await Input.press(page, at.x, at.y) };
    },
    scope: '.seg',
  },
];

/* ---------- Running one ---------- */

async function capture(page, clip) {
  const params = { format: 'png', captureBeyondViewport: false };
  if (clip) params.clip = Object.assign({ scale: 1 }, clip);
  const r = await page.send('Page.captureScreenshot', params);
  return Buffer.from(r.data, 'base64');
}

// The union of the rectangles, padded and kept on screen, on even css px so that at
// 1.5× every edge falls on a whole device pixel.
function clipOf(rects, vp) {
  if (!rects.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [a, b, c, d] of rects) {
    x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d);
  }
  const even = (v, up) => (up ? Math.ceil(v / 2) * 2 : Math.floor(v / 2) * 2);
  x0 = Math.max(0, even(x0 - PAD)); y0 = Math.max(0, even(y0 - PAD));
  x1 = Math.min(vp.width, even(x1 + PAD, true)); y1 = Math.min(vp.height, even(y1 + PAD, true));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

const numbers = (d, clip, scale) => ({
  changed: d.changed,
  max: d.max,
  box: d.box && {
    x: +(clip.x + d.box.x / scale).toFixed(1), y: +(clip.y + d.box.y / scale).toFixed(1),
    width: +(d.box.width / scale).toFixed(1), height: +(d.box.height / scale).toFixed(1),
  },
});

async function one(page, w, sc, { theme, size, vp, mock, here, dir }) {
  const row = { scenario: sc.name, theme, size, how: sc.how };
  await fetch(mock.url + '/_mock/clear', { method: 'POST' });
  if (sc.out) await App.signOut(page);
  else await App.signIn(page, mock, 'ada');
  const res = await App.open(page, here.url + sc.path, w);
  if (!res.ok) throw new Error(res.why);
  row.springHooks = await page.eval(install);
  if (sc.setup) await sc.setup(page, w);
  await moveAside(page);
  await settle(page);

  let before = null;
  const h = { before: async () => { before = await capture(page); } };
  const out = (await sc.trigger(page, h, w)) || {};
  if (!before) throw new Error('the trigger took no frame before it');
  const caught = await page.eval(catchAnims, sc.catch || null, sc.wait || 1500);
  if (!caught.ok) {
    if (out.release) await out.release();
    throw new Error(`no animation${sc.catch ? ' on ' + sc.catch : ''} started within ${caught.waited} ms (${caught.running} other running)`);
  }
  row.waited = caught.waited;
  row.animations = caught.anims;
  row.springs = caught.springs;
  row.ms = caught.clock;
  // The pointer that pressed leaves (a held press stays until it is let go): what it
  // hovers over neither glows in the last frame nor after it. Whatever eases out of
  // hover starts now, on the same clock as the rest.
  if (!out.release) await moveAside(page);

  const clip = clipOf(await page.eval(measureExpr(sc.scope, sc.area)), vp) || { x: 0, y: 0, width: vp.width, height: vp.height };
  row.clip = clip;
  const shots = {};
  for (const at of FRACTIONS) {
    await page.eval(seekExpr(at));
    shots[String(at)] = await capture(page, clip);
    if (at === 0.5) {
      await page.eval(twoFrames);
      shots.drift = await capture(page, clip);
    }
  }
  await page.eval(thawExpr);
  row.ended = await settle(page, 6000);
  shots.after = await capture(page, clip);
  await wait(700);
  shots.settled = await capture(page, clip);
  if (out.release) {
    await out.release();
    await moveAside(page);
    await settle(page);
    shots.released = await capture(page, clip);
  }
  row.check = sc.expect ? await page.eval(sc.expect).catch((e) => e.message) : '';

  // Numbers and pictures.
  const img = {};
  for (const k of Object.keys(shots)) img[k] = PNG.decode(shots[k]);
  const full = PNG.decode(before);
  img.before = PNG.crop(full, clip.x * vp.scale, clip.y * vp.scale, clip.width * vp.scale, clip.height * vp.scale);
  const end = PNG.diff(img.last, img.after);
  const start = PNG.diff(img.before, img['0']);
  row.end = numbers(end, clip, vp.scale);
  row.start = numbers(start, clip, vp.scale);
  const drift = PNG.diff(img['0.5'], img.drift);
  row.drift = numbers(drift, clip, vp.scale);
  row.late = numbers(PNG.diff(img.after, img.settled), clip, vp.scale);
  if (img.released && !sc.toggles) row.back = numbers(PNG.diff(img.before, img.released), clip, vp.scale);
  if (sc.startNote) row.startNote = sc.startNote;

  fs.mkdirSync(dir, { recursive: true });
  const file = (k) => path.join(dir, `${theme}-${size}-${k}.png`);
  fs.writeFileSync(file('before'), PNG.encode(img.before));
  for (const k of Object.keys(shots)) if (k !== 'drift') fs.writeFileSync(file(k), shots[k]);
  fs.writeFileSync(file('diff'), PNG.encode(end.image));
  fs.writeFileSync(file('diff-start'), PNG.encode(start.image));
  if (drift.changed) fs.writeFileSync(file('diff-drift'), PNG.encode(drift.image));
  row.status = 'ok';
  return row;
}

/* ---------- All of them ---------- */

function table(rows) {
  const px = (n) => (n && n.changed != null ? String(n.changed) : '-');
  const box = (n) => (n && n.box ? `${Math.round(n.box.x)},${Math.round(n.box.y)} ${Math.round(n.box.width)}x${Math.round(n.box.height)}` : '-');
  const lines = ['scenario       theme size  anims spr   ms   end px  max  end box (css px)      start px  drift  late  note'];
  for (const r of rows) {
    const head = [r.scenario.padEnd(14), r.theme.padEnd(5), r.size.padEnd(5)].join(' ');
    if (r.status !== 'ok') {
      lines.push(`${head}  ${r.status}: ${r.why}`);
      continue;
    }
    const note = [r.check, r.ended ? '' : 'never came to rest', r.back && r.back.changed ? `released ≠ before (${r.back.changed} px)` : '', r.startNote].filter(Boolean).join('; ');
    lines.push([head, String(r.animations.length).padStart(5), String(r.springs).padStart(3), String(r.ms).padStart(5),
      px(r.end).padStart(8), String(r.end.max).padStart(4), box(r.end).padEnd(21), px(r.start).padStart(9),
      px(r.drift).padStart(6), px(r.late).padStart(5), ' ' + note].join(' '));
  }
  return lines.join('\n');
}

async function run(ctx) {
  const { opt, browser, mock, here, say, SIZES, problems } = ctx;
  const started = Date.now();
  const names = opt.scenarios || SCENARIOS.map((s) => s.name);
  const unknown = names.filter((n) => !SCENARIOS.some((s) => s.name === n));
  if (unknown.length) throw new Error(`no such scenario: ${unknown.join(', ')} (there are ${SCENARIOS.map((s) => s.name).join(', ')})`);
  const list = SCENARIOS.filter((s) => names.includes(s.name));
  // The scenarios are Liquid Glass's: its selectors, its springs, its overlays.
  const others = opt.styles.filter((s) => s !== 'glass');
  if (others.length) say(`  anim: Liquid Glass only; not ${others.join(', ')}`);
  const rows = [];
  if (opt.styles.includes('glass')) {
    for (const size of opt.sizes) {
      const vp = SIZES[size];
      let page = null, w = null;
      const fresh = async () => {
        if (page) await page.close().catch(() => {});
        page = await browser.page(Object.assign({ isolated: true }, vp));
        // An editor left with a change asks before it unloads.
        page.on('Page.javascriptDialogOpening', () => page.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}));
        w = App.watch(page, { expected: () => true });
      };
      await fresh();
      for (const theme of opt.themes) {
        await App.prefs(page, { style: 'glass', theme, extra: { frost: 0.3, solid: false } });
        for (const sc of list) {
          const where = `${sc.name} ${theme} ${size}`;
          if (sc.sizes && !sc.sizes.includes(size)) {
            rows.push({ scenario: sc.name, theme, size, status: 'skipped', why: sc.why || `only at ${sc.sizes.join(', ')}` });
            continue;
          }
          w.label('anim ' + where);
          const seen = w.problems.length;
          const t0 = Date.now();
          let row;
          try {
            row = await one(page, w, sc, { theme, size, vp, mock, here, dir: path.join(opt.out, 'anim', sc.name) });
          } catch (e) {
            row = { scenario: sc.name, theme, size, status: 'failed', why: String((e && e.message) || e).split('\n')[0] };
            problems.push({ kind: 'anim', where: 'anim ' + where, text: row.why });
            // A tab that no longer answers is replaced; the next scenario starts clean.
            const alive = await Promise.race([page.eval('1').then(() => true, () => false), wait(5000).then(() => false)]);
            if (!alive) {
              await fresh();
              await App.prefs(page, { style: 'glass', theme, extra: { frost: 0.3, solid: false } });
            }
          }
          row.seconds = Math.round((Date.now() - t0) / 100) / 10;
          const thrown = w.problems.slice(seen).filter((p) => p.kind === 'exception' || p.kind === 'console');
          if (thrown.length) {
            row.errors = thrown.map((p) => p.text);
            for (const p of thrown) problems.push(p);
          }
          rows.push(row);
          say(`  anim: ${where}: ${row.status === 'ok' ? `end ${row.end.changed} px, start ${row.start.changed} px` : row.status + ' (' + row.why + ')'}`);
        }
      }
      await page.close();
    }
  }
  fs.mkdirSync(path.join(opt.out, 'anim'), { recursive: true });
  fs.writeFileSync(path.join(opt.out, 'anim', 'results.json'), JSON.stringify({ fractions: FRACTIONS.map(String), threshold: 8, rows }, null, 1));
  const text = table(rows);
  fs.writeFileSync(path.join(opt.out, 'anim', 'results.txt'), text + '\n');
  const ok = rows.filter((r) => r.status === 'ok').length;
  return {
    rows,
    summary: `anim: ${ok} of ${rows.length} run(s) measured in ${Math.round((Date.now() - started) / 1000)} s, in ${path.join(opt.out, 'anim')}\n` +
      '(px at device scale; end = last → after, start = before → 0, drift = 0.5 shot twice, late = after → 700 ms on)\n' + text,
  };
}

module.exports = { run, SCENARIOS, FRACTIONS };
