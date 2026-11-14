/*
  Formatting, from the editor's side: Luau as StyLua writes it (ext/format.js).

    NT.format.available()            is there a formatter to ask?
    NT.format.text(text, o)          → Promise of { text, changed } or { error, line, column }
                                       o: { tabs, width, range: { start, end } }; the line
                                       length and the quotes are the editor's settings

  Monaco is given it as the formatter of Luau files (monaco.js), so Format Document,
  Format Selection and Shift+Alt+F do what they do in a desktop editor. What a save
  someone asked for formats, with Format on Save, is the session's (session.js).
*/
(function () {
  'use strict';
  const NT = window.NT;

  NT.format = {
    available: () => NT.ext.has('format') && NT.ext.info('format').available === true,
    async text(text, o = {}) {
      const p = NT.editorPrefs.data;
      const body = { text, tabs: o.tabs !== false, width: o.width || 4, column: p.formatColumn, quotes: p.formatQuotes };
      if (o.range) body.range = o.range;
      let res;
      try {
        res = await fetch(NT.ext.url('/format'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (e) {
        return { error: 'unreachable', line: null, column: null };
      }
      const data = await res.json().catch(() => null);
      if (res.ok && data && typeof data.text === 'string') return { text: data.text, changed: !!data.changed };
      return { error: (data && data.error) || 'failed', message: data && data.message, line: (data && data.line) || null, column: (data && data.column) || null };
    },
  };
})();
