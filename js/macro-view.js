/*
  Macros in the editor (macro.js): what each file is once its macros are expanded,
  kept in step with its text, for the language server to be shown (lsp.js), and for
  the editor itself: what is wrong with a directive as a marker, the lines an #if
  leaves out dimmed (.nt-inactive, which each style draws), and on a macro's name a
  hover with what it is and what it becomes, Go to Definition to its #define, and
  completion of names, directives and what an #include can name. DEBUG is defined
  here, as it is in what a Test run plays (project.js), so its code is the live code.

    NT.macroView.attach(space)   a mounted editor (monaco.js does this) → view
    view.get(path)               → what macro.js made of the file now, or null when the
                                   file has nothing for it to do (it is then as typed)
    view.on('update', fn)        fn(paths): files whose expansion changed without an edit
                                   of their own (a file they #include or #embed, a library
                                   arrived)
    view.dispose()
*/
(function () {
  'use strict';
  const NT = window.NT;
  const OWNER = 'macro';
  const DIRECTIVES = ['define', 'undef', 'if', 'ifdef', 'ifndef', 'elif', 'else', 'endif', 'include', 'embed', 'error', 'warning'];
  const isLuau = (path) => /\.luau?$/i.test(path);
  const SHOWN = 1500; // characters of a macro's body or expansion a hover shows
  const cut = (s) => (s.length > SHOWN ? s.slice(0, SHOWN) + ' …' : s);
  const views = new Map(); // model address authority → view
  let registered = false;

  function attach(space) {
    const monaco = space.monaco;
    if (!registered) {
      registered = true;
      register(monaco);
    }
    const key = space.editor.getModel().uri.authority;
    const cache = new Map();    // path → { text, gen, r }
    const exported = new Map(); // path → its macros, as text, to tell when they change
    const needs = new Map();    // path → what it #includes (paths and specs)
    const theirs = new Map();   // spec → a library's macros, or { error }
    const listeners = new Set();
    const decorations = new Map(); // path → decoration ids
    let gen = 0, gone = false, timer = 0;

    // Files that #include one of these, however indirectly.
    function dependents(changed) {
      const out = new Set();
      let grew = true;
      while (grew) {
        grew = false;
        for (const [path, list] of needs) {
          if (out.has(path) || changed.has(path)) continue;
          if ([...list].some((x) => changed.has(x) || out.has(x))) {
            out.add(path);
            grew = true;
          }
        }
      }
      return [...out];
    }
    function updated(changed) {
      gen++;
      const paths = dependents(changed).filter((p) => space.has(p));
      if (paths.length) listeners.forEach((fn) => fn(paths));
      later();
    }

    function library(spec) {
      if (theirs.has(spec)) return theirs.get(spec);
      if (!NT.libs.available()) {
        theirs.set(spec, { error: 'libraries need a signed-in session' });
        return theirs.get(spec);
      }
      theirs.set(spec, { pending: true });
      NT.libs.resolve([spec]).then(({ libs, problems }) => {
        if (gone) return;
        theirs.set(spec, libs[spec] ? { macros: NT.macro.process(libs[spec].macros, { path: spec }).macros } : { error: problems[spec] || 'not found' });
        updated(new Set([spec]));
      });
      return theirs.get(spec);
    }

    const open = [];
    function get(path) {
      if (!isLuau(path) || !space.has(path)) return null;
      const text = space.text(path);
      const had = cache.get(path);
      if (had && had.text === text && had.gen === gen) return had.r;
      let r = null;
      const list = new Set();
      if (NT.macro.uses(text) || text.includes('DEBUG')) {
        open.push(path);
        r = NT.macro.process(text, {
          path,
          defines: NT.project.DEBUG,
          embed(spec, from) {
            const found = NT.project.embed(space.paths(), from || path, spec, (p) => space.text(p));
            if (found.path) list.add(found.path);
            return found;
          },
          include(spec, from) {
            list.add(spec);
            if (spec[0] === '@') {
              const lib = library(spec);
              return lib.error ? { error: `${spec}: ${lib.error}` } : { macros: lib.macros || new Map() };
            }
            const target = NT.project.resolve(space.paths(), from || path, spec);
            if (!target || !isLuau(target)) return { error: `cannot find "${spec}"` };
            list.delete(spec);
            list.add(target);
            if (open.includes(target)) return { error: 'include cycle: ' + open.slice(open.indexOf(target)).concat(target).join(' → ') };
            const t = get(target);
            return { macros: t ? t.macros : new Map() };
          },
        });
        open.pop();
      }
      needs.set(path, list);
      cache.set(path, { text, gen, r });
      const sig = r ? NT.macro.serialize(r.macros) : '';
      if ((exported.get(path) || '') !== sig) {
        const first = !exported.has(path);
        exported.set(path, sig);
        if (!first) Promise.resolve().then(() => { if (!gone) updated(new Set([path])); });
      }
      return r;
    }

    // Markers and dimmed lines, a moment after the typing stops.
    function later() {
      clearTimeout(timer);
      timer = setTimeout(paint, 150);
    }
    function paint() {
      if (gone) return;
      const S = monaco.MarkerSeverity;
      for (const path of space.paths()) {
        const model = space.model(path);
        if (!model) continue;
        const r = get(path);
        monaco.editor.setModelMarkers(model, OWNER, r ? r.diagnostics.map((d) => ({
          startLineNumber: d.line, startColumn: d.column || 1,
          endLineNumber: d.endLine || d.line, endColumn: d.endColumn || model.getLineMaxColumn(d.endLine || d.line),
          severity: d.severity === 'warning' ? S.Warning : S.Error,
          message: d.message,
          source: 'macro',
        })) : []);
        const dim = r ? r.inactive.filter(([a, b]) => a <= b && b <= model.getLineCount()).map(([a, b]) => ({
          range: new monaco.Range(a, 1, b, model.getLineMaxColumn(b)),
          options: { inlineClassName: 'nt-inactive', stickiness: 1 },
        })) : [];
        decorations.set(path, model.deltaDecorations(decorations.get(path) || [], dim));
      }
    }

    // A file that is not Luau changes what #embed makes of it.
    const data = (path) => {
      if (!isLuau(path)) updated(new Set([path]));
      later();
    };
    const offs = [
      space.on('change', data),
      space.on('add', (path) => {
        updated(new Set([path]));
        later();
      }),
      space.on('reset', () => { cache.clear(); later(); }),
      space.on('remove', (path) => {
        cache.delete(path);
        exported.delete(path);
        needs.delete(path);
        decorations.delete(path);
        updated(new Set([path]));
      }),
      space.on('rename', (from) => {
        cache.delete(from);
        exported.delete(from);
        needs.delete(from);
        decorations.delete(from);
        updated(new Set([from]));
      }),
    ];
    later();

    const view = {
      space,
      get,
      on(event, fn) {
        if (event === 'update') listeners.add(fn);
        return () => listeners.delete(fn);
      },
      dispose() {
        gone = true;
        clearTimeout(timer);
        offs.forEach((off) => off && off());
        views.delete(key);
        listeners.clear();
      },
    };
    views.set(key, view);
    return view;
  }

  /* ---------- Monaco ----------
     Registered once for the language; each call finds the view of the editor it came from. */

  function register(monaco) {
    const L = monaco.languages;
    const K = L.CompletionItemKind;
    const of = (model) => {
      const view = views.get(model.uri.authority);
      const path = view && view.space.pathOf(model);
      return path ? { view, path, r: view.get(path) } : null;
    };
    const covers = (x, line, col) => (x.line < line || (x.line === line && x.column <= col))
      && ((x.endLine || x.line) > line || ((x.endLine || x.line) === line && x.endColumn >= col));
    const head = (m) => {
      if (m.embed) return `#embed ${m.name} "${m.embed.path}"${m.embed.mode ? ' ' + m.embed.mode : ''}`;
      return cut(`#define ${m.name}${m.params ? `(${m.params.concat(m.variadic ? ['...'] : []).join(', ')})` : ''}${m.body ? ' ' + m.body : ''}`);
    };
    const fence = (code) => ({ value: '```luau\n' + code + '\n```' });

    // The macro whose name is at the position: a use, or its own #define.
    function at(o, position) {
      if (!o || !o.r) return null;
      const { lineNumber: line, column: col } = position;
      const use = o.r.uses.find((u) => u.line === line && u.column <= col && col <= u.column + u.name.length);
      if (use) return { macro: use.macro, use, range: new monaco.Range(use.line, use.column, use.line, use.column + use.name.length) };
      const def = o.r.defines.find((d) => d.line === line && d.column <= col && col <= d.endColumn);
      if (def) return { macro: o.r.macros.get(def.name) || { name: def.name, params: null, body: '' }, range: new monaco.Range(def.line, def.column, def.line, def.endColumn) };
      return null;
    }

    L.registerHoverProvider('luau', {
      provideHover(model, position) {
        const hit = at(of(model), position);
        if (!hit) return null;
        const contents = [fence(head(hit.macro))];
        if (hit.macro.name in NT.project.DEBUG && !hit.macro.file) contents.push({ value: 'Defined only in Test runs.' });
        else if (hit.use && hit.use.expansion != null) contents.push(fence(cut(hit.use.expansion)));
        else if (hit.macro.embed) contents.push(fence(cut(hit.macro.body)));
        return { range: hit.range, contents };
      },
    });

    L.registerDefinitionProvider('luau', {
      provideDefinition(model, position) {
        const o = of(model);
        const hit = at(o, position);
        if (!hit || !hit.use || !hit.macro.file || hit.macro.line == null) return null;
        const target = hit.macro.file === o.path ? model : o.view.space.has(hit.macro.file) && o.view.space.model(hit.macro.file);
        if (!target) return null;
        const col = hit.macro.column || 1;
        return [{ uri: target.uri, range: new monaco.Range(hit.macro.line, col, hit.macro.line, col + hit.macro.name.length) }];
      },
    });

    L.registerCompletionItemProvider('luau', {
      triggerCharacters: ['#', '"'],
      provideCompletionItems(model, position) {
        const o = of(model);
        if (!o) return null;
        const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        // After # at the start of a line: the directives.
        const d = /^(\s*#\s*)(\w*)$/.exec(line);
        if (d) {
          const start = position.column - d[2].length;
          return {
            suggestions: DIRECTIVES.map((name) => ({
              label: '#' + name, filterText: name, kind: K.Keyword, insertText: name,
              range: new monaco.Range(position.lineNumber, start, position.lineNumber, position.column),
            })),
          };
        }
        // Inside #include "…": the project's other Luau files; inside #embed NAME "…",
        // its files, data first.
        const inc = /^\s*#\s*include\s+"([^"]*)$/.exec(line);
        const emb = !inc && /^\s*#\s*embed\s+[A-Za-z_]\w*\s+"([^"]*)$/.exec(line);
        if (inc || emb) {
          const typed = (inc || emb)[1];
          const start = position.column - typed.length;
          const here = o.path.split('/').slice(0, -1);
          const wanted = (p) => p !== o.path && (inc ? isLuau(p) : true);
          return {
            suggestions: o.view.space.paths().filter(wanted).map((p) => {
              const parts = p.split('/');
              let i = 0;
              while (i < here.length && i < parts.length - 1 && here[i] === parts[i]) i++;
              const rel = (i < here.length ? '../'.repeat(here.length - i) : './') + parts.slice(i).join('/');
              return { label: rel, kind: K.File, insertText: rel, sortText: (emb && isLuau(p) ? '1' : '0') + rel, range: new monaco.Range(position.lineNumber, start, position.lineNumber, position.column) };
            }),
          };
        }
        if (!o.r) return null;
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        return {
          suggestions: o.r.visible(position.lineNumber).map((name) => {
            const m = o.r.macros.get(name) || { name, params: null, body: '' };
            return {
              label: name,
              kind: m.params ? K.Function : K.Constant,
              detail: head(m),
              insertText: m.params ? `${name}($0)` : name,
              insertTextRules: m.params ? L.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
              range,
            };
          }),
        };
      },
    });
  }

  NT.macroView = {
    attach,
    of: (space) => views.get(space.editor.getModel().uri.authority) || null,
  };
})();
