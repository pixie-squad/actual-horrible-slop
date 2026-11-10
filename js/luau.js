/* Luau syntax highlighting, a read-only viewer and a lightweight editor. */
(function () {
  'use strict';
  const NT = window.NT;
  const { h } = NT.util;

  const KEYWORDS = new Set(('and break continue do else elseif end export for function if in local not or repeat return then type until while').split(' '));
  const CONSTANTS = new Set(['true', 'false', 'nil', 'self']);
  const BUILTINS = new Set(('assert error getmetatable ipairs next pairs pcall print rawequal rawget rawset require select setmetatable tonumber tostring typeof unpack xpcall math string table os coroutine bit32 utf8 task buffer vector').split(' '));

  const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y;
  const NUMBER = /0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?|\.\d[\d_]*(?:[eE][+-]?\d+)?/y;
  const LONG_OPEN = /\[(=*)\[/y;
  const SPACE = /[ \t]*/y;

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
  const esc = (s) => s.replace(/[&<>]/g, (c) => ESC[c]);
  const span = (cls, text) => `<span class="tk-${cls}">${esc(text)}</span>`;

  function highlight(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let prev = ''; // last significant character, to spot `.field` access

    while (i < n) {
      const c = src[i];

      // Comments
      if (c === '-' && src[i + 1] === '-') {
        LONG_OPEN.lastIndex = i + 2;
        const m = LONG_OPEN.exec(src);
        let end;
        if (m) {
          const close = src.indexOf(']' + m[1] + ']', i + 2 + m[0].length);
          end = close < 0 ? n : close + m[1].length + 2;
        } else {
          const nl = src.indexOf('\n', i);
          end = nl < 0 ? n : nl;
        }
        out += span('c', src.slice(i, end));
        i = end;
        continue;
      }

      // Long strings
      if (c === '[') {
        LONG_OPEN.lastIndex = i;
        const m = LONG_OPEN.exec(src);
        if (m) {
          const close = src.indexOf(']' + m[1] + ']', i + m[0].length);
          const end = close < 0 ? n : close + m[1].length + 2;
          out += span('s', src.slice(i, end));
          i = end;
          prev = ']';
          continue;
        }
      }

      // Quoted and interpolated strings
      if (c === '"' || c === "'" || c === '`') {
        let j = i + 1;
        while (j < n && src[j] !== c) {
          if (src[j] === '\\') j++;
          else if (src[j] === '\n' && c !== '`') break;
          j++;
        }
        const end = Math.min(n, j + 1);
        out += span('s', src.slice(i, end));
        i = end;
        prev = c;
        continue;
      }

      // Numbers
      if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
        NUMBER.lastIndex = i;
        const m = NUMBER.exec(src);
        if (m) {
          out += span('n', m[0]);
          i += m[0].length;
          prev = '0';
          continue;
        }
      }

      // Identifiers
      IDENT.lastIndex = i;
      const id = IDENT.exec(src);
      if (id) {
        const word = id[0];
        i += word.length;
        SPACE.lastIndex = i;
        SPACE.exec(src);
        const next = src[SPACE.lastIndex];
        const member = prev === '.' || prev === ':';
        if (!member && KEYWORDS.has(word)) out += span('k', word);
        else if (!member && CONSTANTS.has(word)) out += span('n', word);
        else if (next === '(' || next === '"' || next === "'" || next === '{') out += span(!member && BUILTINS.has(word) ? 'b' : 'f', word);
        else if (!member && BUILTINS.has(word)) out += span('b', word);
        else if (member) out += span('p', word);
        else out += esc(word);
        prev = 'a';
        continue;
      }

      out += ESC[c] || c;
      if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') prev = c;
      i++;
    }
    return out;
  }

  function lineNumbers(src) {
    let count = 1;
    for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) count++;
    let s = '';
    for (let i = 1; i <= count; i++) s += i + '\n';
    return s;
  }

  function viewer(source) {
    const src = source || '';
    const pre = h('pre.code-hl');
    pre.innerHTML = highlight(src) + '\n';
    const gutter = h('div.code-gutter', { 'aria-hidden': 'true' }, lineNumbers(src));
    return h('div.code-card', h('div.code-area', { tabIndex: 0 }, gutter, h('div.code-box', pre)));
  }

  const OPENERS = /(?:\b(?:then|do|else|repeat)|\bfunction\b[^)]*\)|[{(])\s*$/;

  function editor({ value = '', onChange, onSave }) {
    const pre = h('pre.code-hl', { 'aria-hidden': 'true' });
    const gutter = h('div.code-gutter', { 'aria-hidden': 'true' });
    const input = h('textarea.code-input', {
      spellcheck: false,
      autocapitalize: 'off',
      autocomplete: 'off',
      wrap: 'off',
      'aria-label': 'Script source',
      'autocorrect': 'off',
    });
    const el = h('div.code-card.code-editor', h('div.code-area', gutter, h('div.code-box', pre, input)));

    let lines = 0;
    function paint() {
      const src = input.value;
      pre.innerHTML = highlight(src) + '\n';
      let count = 1;
      for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) count++;
      if (count !== lines) {
        lines = count;
        gutter.textContent = lineNumbers(src);
      }
    }

    function insert(text) {
      // execCommand keeps the native undo stack intact; fall back if it is unavailable.
      if (!document.execCommand || !document.execCommand('insertText', false, text)) {
        input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    input.addEventListener('input', () => {
      paint();
      if (onChange) onChange(input.value);
    });

    // Tab indents, so the keyboard needs another way out of the field: Escape, then Tab.
    let leaving = false;
    input.addEventListener('blur', () => { leaving = false; });
    input.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (onSave) onSave(input.value);
        return;
      }
      if (e.key === 'Escape') return void (leaving = true);
      if (e.key === 'Tab' && leaving) return;
      if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) leaving = false;
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        insert('\t');
        return;
      }
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.isComposing) {
        const before = input.value.slice(0, input.selectionStart);
        const line = before.slice(before.lastIndexOf('\n') + 1);
        let indent = line.match(/^[ \t]*/)[0];
        if (OPENERS.test(line.replace(/--.*$/, ''))) indent += '\t';
        if (indent) {
          e.preventDefault();
          insert('\n' + indent);
        }
      }
    });

    input.value = value;
    paint();

    return {
      el,
      input,
      get value() { return input.value; },
      set value(v) { input.value = v; paint(); },
    };
  }

  NT.luau = { highlight, viewer, editor };
})();
