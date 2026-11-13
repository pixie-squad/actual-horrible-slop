/*
  Material 3 Expressive: a test run, drawn. What a run is, and every word said about
  it, is the core's (js/tests.js); this is how this style shows it. The editor puts the
  panel in a supporting pane beside the code on a wide window and in a bottom sheet on
  a narrow one (editor.js).

    NT.md.tests({ onRun, onClose })  → { el, show(run), dispose() }
      onRun(source)   the button in the heading, once the run is over
      onClose         the pane's own close button (a sheet closes itself; it is hidden there)

  From the top: the run's own words, the linear progress indicator, Output or State,
  and under that either what the script printed or the battle as a table: its kinds as
  filter chips, a search bar, how many, and Material's data table.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h, clamp, debounce } = NT.util;
  const M = NT.md;
  const still = () => NT.util.reducedMotion();

  /* ---------- The linear progress indicator ----------
     Drawn as ProgressIndicator.kt draws it (the numbers are LinearProgressIndicatorTokens
     and ProgressIndicatorTokens): a 4 track of secondary container and an indicator of
     primary, both round at their ends and 4 apart (the gap is measured between the
     caps), with a 4 stop of primary at the very end of a determinate one. Determinate,
     it follows its value on ProgressAnimationSpec (stiffness 50, no bounce).
     Indeterminate, two lines cross it, the head and the tail of each on the emphasized
     accelerate curve (MotionTokens, 0.3 0 0.8 0.15) in a 1750 ms cycle. */

  function bezier(x1, y1, x2, y2) {
    const at = (a, b, t) => 3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let lo = 0, hi = 1, t = x;
      for (let i = 0; i < 24; i++) {
        const d = at(x1, x2, t) - x;
        if (Math.abs(d) < 1e-5) break;
        if (d < 0) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return at(y1, y2, t);
    };
  }
  const accelerate = bezier(0.3, 0, 0.8, 0.15);
  const CYCLE = 1750;
  // A keyframe pair: 0 at the delay, 1 once the duration has passed, held till the cycle ends.
  const part = (t, delay, duration) => (t <= delay ? 0 : t >= delay + duration ? 1 : accelerate((t - delay) / duration));
  const STIFF = 50, DAMP = 2 * Math.sqrt(STIFF);

  function progress() {
    const canvas = h('canvas', { 'aria-hidden': 'true' });
    const el = h('div.m-progress', { role: 'progressbar', 'aria-label': 'Test', 'aria-valuemin': '0', 'aria-valuemax': '100' }, canvas);
    let mode = 'off', target = 0, x = 0, v = 0, start = 0, last = 0, frame = 0, ink = null;

    // The colours are the style's (style.css), read again when the theme changes.
    const colours = () => {
      const cs = getComputedStyle(el);
      ink = { on: cs.getPropertyValue('--m-progress-on').trim(), track: cs.getPropertyValue('--m-progress-track').trim() };
    };

    function paint(now) {
      frame = 0;
      const w = el.clientWidth, ht = el.clientHeight;
      // Not on screen: the next resize asks again. Going: it keeps what it last showed.
      if (!w || !ht || mode === 'off') return;
      const ratio = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(ht * ratio)) {
        canvas.width = Math.round(w * ratio);
        canvas.height = Math.round(ht * ratio);
      }
      if (!ink) colours();
      const g = canvas.getContext('2d');
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.clearRect(0, 0, w, ht);
      const r = ht / 2;
      // A stretch from one fraction of the width to another, its round caps inside the ends.
      const line = (a, b, colour) => {
        if (!(Math.abs(b - a) > 0)) return;
        g.strokeStyle = colour;
        g.lineWidth = ht;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(clamp(a * w, r, w - r), r);
        g.lineTo(clamp(b * w, r, w - r), r);
        g.stroke();
      };
      const gap = (4 + ht) / w; // the 4 between them, and the two half caps
      let again = false;

      if (mode === 'open') {
        if (still()) line(0, 1, ink.track);
        else {
          const t = (now - start) % CYCLE;
          const head1 = part(t, 0, 1000), tail1 = part(t, 250, 1000);
          const head2 = part(t, 650, 850), tail2 = part(t, 900, 850);
          if (head1 < 1 - gap) line(head1 > 0 ? head1 + gap : 0, 1, ink.track);
          if (head1 - tail1 > 0) line(tail1, head1, ink.on);
          if (tail1 > gap) line(head2 > 0 ? head2 + gap : 0, tail1 < 1 ? tail1 - gap : 1, ink.track);
          if (head2 - tail2 > 0) line(tail2, head2, ink.on);
          if (tail2 > gap) line(0, tail2 < 1 ? tail2 - gap : 1, ink.track);
          again = true;
        }
      } else {
        const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
        last = now;
        if (still()) x = target;
        else {
          v += (-STIFF * (x - target) - DAMP * v) * dt;
          x += v * dt;
          if (Math.abs(x - target) < 1e-3 && Math.abs(v) < 1e-3) { x = target; v = 0; } else again = true;
        }
        const p = clamp(x, 0, 1);
        const from = p + Math.min(p, gap);
        if (from <= 1) line(from, 1, ink.track);
        line(0, p, ink.on);
        g.fillStyle = ink.on;
        g.beginPath();
        g.arc(w - r, r, r, 0, Math.PI * 2);
        g.fill();
      }
      if (again) frame = requestAnimationFrame(paint);
    }
    const ask = () => {
      if (frame) return;
      last = performance.now();
      frame = requestAnimationFrame(paint);
    };
    const sizes = new ResizeObserver(ask);
    sizes.observe(el);
    const themed = new MutationObserver(() => { ink = null; ask(); });
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] });

    return {
      el,
      // 'open' (no telling how long), a number from 0 to 1, or 'off' (gone).
      set(next, jump) {
        if (next === 'open') {
          if (mode !== 'open') start = performance.now();
          mode = 'open';
        } else if (next === 'off') mode = 'off';
        else {
          // A value it comes to from elsewhere is where it starts.
          const was = mode;
          mode = 'value';
          target = clamp(next, 0, 1);
          if (jump || was !== 'value') { x = target; v = 0; }
        }
        el.classList.toggle('is-off', mode === 'off');
        if (mode === 'value') el.setAttribute('aria-valuenow', String(Math.round(target * 100)));
        else el.removeAttribute('aria-valuenow');
        ask();
      },
      dispose() {
        sizes.disconnect();
        themed.disconnect();
        cancelAnimationFrame(frame);
        frame = 0;
      },
    };
  }

  /* ---------- Filter chips ----------
     One kind of object at a time (FilterChipTokens): 32 high, the 8 corner, a 1 outline
     of outline variant and label-large in on surface variant; the chosen one is
     secondary container with an 18 check in front of its label. The arrow keys move the
     choice, as in any group of radio buttons. */

  function chips(options, value, onChange) {
    const el = h('div.m-chips', { role: 'radiogroup' });
    let cur = value;
    const items = options.map((o) => {
      const b = h('button.m-chip.m-press', { type: 'button', role: 'radio', onclick: () => { if (cur !== o.value) { set(o.value); onChange(o.value); } } }, h('span', o.label));
      el.append(b);
      return [o.value, b];
    });
    function set(v) {
      cur = v;
      for (const [val, b] of items) {
        const on = val === v, check = b.querySelector('.m-chip-check');
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
        if (on && !check) b.prepend(h('span.m-chip-check', { 'aria-hidden': 'true' }));
        else if (!on && check) check.remove();
      }
    }
    el.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      const i = items.findIndex(([v]) => v === cur) + step;
      if (!step || !items[i]) return;
      e.preventDefault();
      items[i][1].focus();
      items[i][1].click();
    });
    set(value);
    return { el, set };
  }

  /* ---------- The panel ---------- */

  M.tests = function ({ onRun, onClose }) {
    let run = null, off = null, drawn = 0, tone = '';
    let view = 'output', kind = 'all', query = '';

    const verdict = h('span.m-tests-verdict');
    const title = h('span', { 'aria-live': 'polite' });
    const detail = h('p.m-tests-detail');
    const act = M.button('Stop', () => {
      if (run && !run.done) run.stop();
      else onRun(act);
    }, { variant: 'tonal', cls: '.m-tests-act' });
    const actLabel = act.querySelector('span');
    const close = M.iconButton('close', 'Close', onClose, { cls: '.m-tests-close' });
    const bar = progress();

    // What is shown under it: a connected button group, as every choice of view here.
    const views = M.group([{ value: 'output', label: 'Output' }, { value: 'state', label: 'State' }], view, (v) => {
      view = v;
      lines.hidden = v !== 'output';
      state.hidden = v !== 'state';
      if (v === 'state') table();
      else lines.scrollTop = lines.scrollHeight;
    });
    views.el.classList.add('m-tests-views');
    views.el.setAttribute('aria-label', 'Show');

    const lines = h('ol.m-tests-lines', { role: 'log', 'aria-label': 'Output', tabindex: '0' });

    // The battle: which objects, a search, how many, and a row for each.
    const kinds = chips(NT.tests.kinds.map((k) => ({ value: k.id, label: k.label })), kind, (v) => { kind = v; table(); });
    kinds.el.classList.add('m-tests-kinds');
    kinds.el.setAttribute('aria-label', 'Kind');
    const search = h('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search', autocapitalize: 'off', spellcheck: false, enterKeyHint: 'search' });
    search.addEventListener('input', debounce(() => { query = search.value; table(); }, 120));
    const summary = h('p.m-tests-summary');
    const head = h('thead'), body = h('tbody');
    const none = h('p.m-tests-none', { hidden: true });
    const grid = h('div.m-tests-grid', { tabindex: '0', role: 'region', 'aria-label': 'Battle' }, h('table.m-table', head, body), none);
    const state = h('div.m-tests-state', { hidden: true },
      kinds.el, h('label.m-search.m-tests-search', M.icon('search'), search), summary, grid);

    const el = h('section.m-tests', { 'aria-label': 'Test' },
      h('header.m-tests-head', h('h3.m-tests-title', verdict, title), act, close, detail),
      bar.el, views.el, h('div.m-tests-body', lines, state));

    function heading(jump) {
      const w = run.words();
      title.textContent = w.title;
      detail.textContent = w.detail;
      actLabel.textContent = run.done ? 'Run Again' : 'Stop';
      if (w.tone !== tone) {
        tone = w.tone;
        el.dataset.tone = tone;
        const mark = tone === 'good' ? 'check_circle' : tone === 'bad' ? 'error' : null;
        verdict.replaceChildren(...(mark ? [M.icon(mark, { fill: true })] : []));
        if (mark && !jump) M.play(verdict, [{ transform: 'scale(0.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], M.motion.spatialFast);
      }
      bar.set(run.done ? 'off' : w.progress === null ? (tone === 'busy' ? 'open' : 'off') : w.progress, jump);
    }

    // New lines go on the end; the list follows them unless it has been scrolled back.
    function print() {
      const follow = lines.scrollHeight - lines.scrollTop - lines.clientHeight < 24;
      const empty = lines.querySelector('.m-tests-none');
      if (empty && run.lines.length) empty.remove();
      for (; drawn < run.lines.length; drawn++) {
        const line = run.lines[drawn];
        const log = line.kind === 'log';
        lines.append(h('li' + (log ? '.is-' + (line.level === 'error' ? 'error' : 'warning') : ''),
          log ? M.icon(line.level === 'error' ? 'error' : 'warning', { size: 16 }) : null,
          h('span', line.text)));
      }
      if (run.done && !run.lines.length && !lines.firstChild) lines.append(h('li.m-tests-none', 'Nothing printed'));
      if (follow) lines.scrollTop = lines.scrollHeight;
    }

    // Drawn only while it is looked at: a battle is a new table every second. Every
    // object in sight has its row, and what the filter leaves out is collapsed, so the
    // columns are as wide as all of them need and do not move as the filter changes.
    function table() {
      if (view !== 'state' || !run) return;
      const shown = NT.tests.state(run, { kind, query });
      const all = kind === 'all' && !query.trim() ? shown : NT.tests.state(run);
      const keep = all === shown ? null : new Set(shown.rows.map((r) => r.id));
      summary.textContent = shown.summary;
      if (!head.firstChild) head.append(h('tr', all.columns.map((c) => h('th' + (c.number ? '.is-number' : ''), { scope: 'col' }, c.label))));
      body.replaceChildren(...all.rows.map((r) => h('tr' + (r.own ? '.is-own' : '') + (keep && !keep.has(r.id) ? '.is-out' : ''),
        all.columns.map((c) => h('td' + (c.number ? '.is-number' : ''), r[c.id])))));
      none.textContent = shown.rows.length ? '' : shown.none;
      none.hidden = !!shown.rows.length;
    }

    function show(next) {
      if (next === run) return;
      if (off) off();
      run = next;
      drawn = 0;
      tone = '';
      lines.replaceChildren();
      off = run.on((r, what) => {
        if (what === 'line') return void print();
        if (what === 'shot') return void table();
        heading(false);
        if (what === 'state') {
          print();
          table();
        }
      });
      heading(true);
      print();
      table();
    }

    return {
      el,
      show,
      dispose() {
        if (off) off();
        bar.dispose();
      },
    };
  };
})();
