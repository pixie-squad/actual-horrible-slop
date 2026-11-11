/*
  Code editing with Monaco, dressed for iOS.

  Monaco is loaded on demand from a CDN the first time a script is opened.
  If it cannot be reached (offline), the built-in lightweight editor from
  luau.js is used instead, so viewing and editing always work.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h } = NT.util;

  const BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min';
  const FONT = '"SF Mono", ui-monospace, "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
  let loading = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('failed to load ' + src));
      document.head.append(s);
    });
  }

  function load() {
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('editor load timed out')), 12000);
      // Workers must be same-origin, so start them from a blob that pulls in the CDN build.
      window.MonacoEnvironment = {
        getWorkerUrl() {
          const src = `self.MonacoEnvironment={baseUrl:'${BASE}/'};importScripts('${BASE}/vs/base/worker/workerMain.js');`;
          return URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        },
      };
      loadScript(BASE + '/vs/loader.js').then(() => {
        window.require.config({ paths: { vs: BASE + '/vs' } });
        window.require(['vs/editor/editor.main'], () => {
          clearTimeout(timer);
          try {
            setup(window.monaco);
            resolve(window.monaco);
          } catch (e) { reject(e); }
        }, (err) => { clearTimeout(timer); reject(err); });
      }).catch((e) => { clearTimeout(timer); reject(e); });
    });
    loading.catch(() => { loading = null; });
    return loading;
  }

  /* ---------- Luau ---------- */

  const KEYWORDS = ['and', 'break', 'continue', 'do', 'else', 'elseif', 'end', 'export', 'for', 'function', 'if', 'in', 'local', 'not', 'or', 'repeat', 'return', 'then', 'type', 'until', 'while'];
  const CONSTANTS = ['true', 'false', 'nil', 'self'];
  const TYPES = ['any', 'boolean', 'buffer', 'never', 'number', 'string', 'thread', 'unknown', 'vector'];
  const BUILTINS = ['assert', 'error', 'getmetatable', 'ipairs', 'next', 'pairs', 'pcall', 'print', 'rawequal', 'rawget', 'rawset', 'require', 'select', 'setmetatable', 'tonumber', 'tostring', 'typeof', 'unpack', 'xpcall', 'math', 'table', 'os', 'coroutine', 'bit32', 'utf8', 'task'];

  const SNIPPETS = [
    ['function', 'function ${1:name}(${2})\n\t$0\nend', 'Function'],
    ['local function', 'local function ${1:name}(${2})\n\t$0\nend', 'Local function'],
    ['if', 'if ${1:condition} then\n\t$0\nend', 'If block'],
    ['for', 'for ${1:i} = ${2:1}, ${3:10} do\n\t$0\nend', 'Numeric for loop'],
    ['for in', 'for ${1:key}, ${2:value} in ${3:items} do\n\t$0\nend', 'Generic for loop'],
    ['while', 'while ${1:condition} do\n\t$0\nend', 'While loop'],
    ['repeat', 'repeat\n\t$0\nuntil ${1:condition}', 'Repeat loop'],
  ];

  function setup(monaco) {
    monaco.languages.register({ id: 'luau', extensions: ['.luau', '.lua'], aliases: ['Luau'] });

    monaco.languages.setLanguageConfiguration('luau', {
      comments: { lineComment: '--', blockComment: ['--[[', ']]'] },
      brackets: [['{', '}'], ['[', ']'], ['(', ')']],
      autoClosingPairs: [
        { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
        { open: '"', close: '"', notIn: ['string'] }, { open: "'", close: "'", notIn: ['string'] }, { open: '`', close: '`', notIn: ['string'] },
      ],
      surroundingPairs: [
        { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
        { open: '"', close: '"' }, { open: "'", close: "'" }, { open: '`', close: '`' },
      ],
      onEnterRules: [
        { beforeText: /^((?!--).)*\b(then|do|else|repeat)\b((?!\b(end|until)\b).)*$/, action: { indentAction: monaco.languages.IndentAction.Indent } },
        { beforeText: /^((?!--).)*\bfunction\b[^)]*\)((?!\bend\b).)*$/, action: { indentAction: monaco.languages.IndentAction.Indent } },
      ],
      indentationRules: {
        increaseIndentPattern: /^((?!--).)*(\b(then|do|else|repeat)\b((?!\b(end|until)\b).)*|\bfunction\b[^)]*\)((?!\bend\b).)*|[{(])\s*$/,
        decreaseIndentPattern: /^\s*(end|else|elseif|until|[})])/,
      },
    });

    monaco.languages.setMonarchTokensProvider('luau', {
      defaultToken: '',
      tokenPostfix: '.luau',
      keywords: KEYWORDS,
      constants: CONSTANTS,
      typeKeywords: TYPES,
      builtins: BUILTINS,
      symbols: /[=><~?:&|+\-*/^%#.]+/,
      escapes: /\\(?:[abfnrtvz\\"'`]|\d{1,3}|x[0-9A-Fa-f]{2}|u\{[0-9A-Fa-f]+\})/,
      brackets: [
        { open: '{', close: '}', token: 'delimiter.curly' },
        { open: '[', close: ']', token: 'delimiter.square' },
        { open: '(', close: ')', token: 'delimiter.parenthesis' },
      ],
      tokenizer: {
        root: [
          [/--\[(=*)\[/, { token: 'comment', next: '@blockComment.$1' }],
          [/--.*$/, 'comment'],
          [/\[(=*)\[/, { token: 'string', next: '@longString.$1' }],
          [/([.:])([A-Za-z_]\w*)(?=\s*[({"'`])/, ['delimiter', 'function']],
          [/(\.)([A-Za-z_]\w*)/, ['delimiter', 'property']],
          [/[A-Za-z_]\w*(?=\s*[({"'`])/, { cases: { '@keywords': 'keyword', '@builtins': 'support', '@default': 'function' } }],
          [/[A-Za-z_]\w*/, { cases: { '@keywords': 'keyword', '@constants': 'constant', '@typeKeywords': 'type', '@builtins': 'support', '@default': 'identifier' } }],
          [/0[xX][0-9A-Fa-f_]+/, 'number'],
          [/0[bB][01_]+/, 'number'],
          [/\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?/, 'number'],
          [/"/, 'string', '@doubleString'],
          [/'/, 'string', '@singleString'],
          [/`/, 'string', '@interpolated'],
          [/[{}()[\]]/, '@brackets'],
          [/@symbols/, 'operator'],
          [/[;,]/, 'delimiter'],
          [/\s+/, 'white'],
        ],
        blockComment: [
          [/[^\]]+/, 'comment'],
          [/\](=*)\]/, { cases: { '$1==$S2': { token: 'comment', next: '@pop' }, '@default': 'comment' } }],
          [/\]/, 'comment'],
        ],
        longString: [
          [/[^\]]+/, 'string'],
          [/\](=*)\]/, { cases: { '$1==$S2': { token: 'string', next: '@pop' }, '@default': 'string' } }],
          [/\]/, 'string'],
        ],
        doubleString: [
          [/[^\\"]+/, 'string'],
          [/@escapes/, 'string.escape'],
          [/\\./, 'string.escape'],
          [/"/, 'string', '@pop'],
        ],
        singleString: [
          [/[^\\']+/, 'string'],
          [/@escapes/, 'string.escape'],
          [/\\./, 'string.escape'],
          [/'/, 'string', '@pop'],
        ],
        interpolated: [
          [/[^\\`{]+/, 'string'],
          [/@escapes/, 'string.escape'],
          [/\\./, 'string.escape'],
          [/\{/, { token: 'delimiter.curly', next: '@interpolation' }],
          [/`/, 'string', '@pop'],
        ],
        interpolation: [
          [/\}/, { token: 'delimiter.curly', next: '@pop' }],
          { include: 'root' },
        ],
      },
    });

    monaco.languages.registerCompletionItemProvider('luau', {
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position);
        const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
        const K = monaco.languages.CompletionItemKind;
        const suggestions = [];
        // With a language server answering for this file the words come from it (lsp.js),
        // so listing them here as well would show each twice. The snippets are only here.
        const served = !!NT.lsp && NT.lsp.serves(model);
        if (!served) {
          for (const k of KEYWORDS.concat(CONSTANTS)) suggestions.push({ label: k, kind: K.Keyword, insertText: k, range });
          for (const t of TYPES) suggestions.push({ label: t, kind: K.TypeParameter, insertText: t, range });
          for (const b of BUILTINS) suggestions.push({ label: b, kind: K.Function, insertText: b, range });
        }
        // After a "." or ":" the server lists members; a block snippet has no place there.
        if (served && /[.:]$/.test(model.getValueInRange({ startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: Math.max(1, word.startColumn - 1), endColumn: word.startColumn }))) return { suggestions };
        for (const [label, body, detail] of SNIPPETS) {
          suggestions.push({ label, kind: K.Snippet, detail, insertText: body, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range });
        }
        return { suggestions };
      },
    });

    // A colour token as Monaco wants it (#rrggbb), or `fallback` where it is not one.
    const token = (name, fallback) => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
    };

    // Colours follow the app's own code palette (see tokens.css).
    const theme = (dark) => {
      const c = dark
        ? { bg: '#1c1c1e', fg: '#ffffff', k: 'ff7ab2', s: 'ff8170', n: 'd9c97c', c: '7f8c98', f: '78c2b3', b: 'b281eb', p: '6bdfff', line: '#ffffff0d', sel: '#3f638b', num: '#636366', numOn: '#aeaeb2', guide: '#ffffff14', widget: '#2c2c2e' }
        : { bg: '#ffffff', fg: '#000000', k: 'ad3da4', s: 'c41a16', n: '1c00cf', c: '6c7986', f: '326d74', b: '6c36a9', p: '2b5c8a', line: '#0000000a', sel: '#b3d7ff', num: '#aeaeb2', numOn: '#636366', guide: '#00000010', widget: '#f2f2f7' };
      return {
        base: dark ? 'vs-dark' : 'vs',
        inherit: true,
        rules: [
          { token: 'keyword', foreground: c.k, fontStyle: 'bold' },
          { token: 'string', foreground: c.s },
          { token: 'string.escape', foreground: c.n },
          { token: 'number', foreground: c.n },
          { token: 'constant', foreground: c.n },
          { token: 'comment', foreground: c.c, fontStyle: 'italic' },
          { token: 'function', foreground: c.f },
          { token: 'support', foreground: c.b },
          { token: 'type', foreground: c.p },
          { token: 'property', foreground: c.p },
          { token: 'operator', foreground: c.fg.slice(1) },
        ],
        colors: {
          'editor.background': c.bg,
          'editor.foreground': c.fg,
          'editor.lineHighlightBackground': c.line,
          'editor.lineHighlightBorder': '#00000000',
          'editor.selectionBackground': c.sel,
          'editor.inactiveSelectionBackground': c.sel + '80',
          'editorLineNumber.foreground': c.num,
          'editorLineNumber.activeForeground': c.numOn,
          'editorIndentGuide.background1': c.guide,
          'editorIndentGuide.activeBackground1': c.num,
          'editorWidget.background': c.widget,
          'editorWidget.border': '#00000000',
          'editorSuggestWidget.background': '#00000000',
          'editorSuggestWidget.border': '#00000000',
          'editorSuggestWidget.selectedBackground': '#00000000',
          'editorHoverWidget.background': c.widget,
          'editorHoverWidget.border': '#00000000',
          'editorBracketMatch.background': c.sel + '66',
          'editorBracketMatch.border': '#00000000',
          'scrollbar.shadow': '#00000000',
          'focusBorder': '#00000000',
          'editorGutter.background': c.bg,
          // Problems are underlined in the app's own red, orange and blue.
          'editorError.foreground': token('--red', '#ff383c'),
          'editorWarning.foreground': token('--orange', '#ff8d28'),
          'editorInfo.foreground': token('--blue', '#0088ff'),
          'editorHint.foreground': '#' + c.c,
          'editorUnnecessaryCode.opacity': '#00000099',
          'editor.rangeHighlightBackground': c.sel + '40',
          'editor.wordHighlightBackground': c.sel + '55',
          'editor.wordHighlightStrongBackground': c.sel + '88',
          // The list of references that opens inside the editor.
          'peekView.border': c.guide,
          'peekViewEditor.background': c.bg,
          'peekViewEditorGutter.background': c.bg,
          'peekViewResult.background': c.widget,
          'peekViewTitle.background': c.widget,
          'peekViewTitleLabel.foreground': c.fg,
          'peekViewTitleDescription.foreground': c.numOn,
          'peekViewResult.selectionBackground': c.sel + '80',
          'peekViewEditor.matchHighlightBackground': c.sel + 'aa',
          'peekViewResult.matchHighlightBackground': c.sel + 'aa',
        },
      };
    };

    // The theme is defined again whenever it is put on: some of its colours are read
    // from the tokens, and those follow the theme.
    let worn = '';
    const applyTheme = () => {
      const name = document.documentElement.dataset.theme === 'dark' ? 'nt-dark' : 'nt-light';
      if (name === worn) return;
      worn = name;
      monaco.editor.defineTheme(name, theme(name === 'nt-dark'));
      monaco.editor.setTheme(name);
    };
    NT.bus.on('prefs', applyTheme);
    applyTheme();

    // "Go to definition" may point into another file. Each editor shows one file at a
    // time, so the editor it was asked in is told to show that file instead.
    monaco.editor.registerEditorOpener({
      openCodeEditor(source, resource, at) {
        const space = spaces.get(resource.authority);
        return !!space && space.reveal(resource, at);
      },
    });
  }

  // Every mounted editor keeps its own set of files, told apart by this name in their addresses.
  const spaces = new Map();
  let spaceSeq = 0;

  // Monaco builds its popups itself, the first time each is needed. As they arrive
  // they are given the app's glass: the same material and lens as its own menus.
  const POP_LENS = { bezel: 18, magnify: 0.008, dispersion: 0 };
  // The suggestion list, its detail pane, hovers, parameter hints and the rename field.
  const POPUPS = '.suggest-widget, .suggest-details, .monaco-hover, .parameter-hints-widget, .rename-box';
  function dressPopups(root) {
    const glaze = (pane) => {
      pane.classList.add('glass', 'thick');
      NT.glass.refract(pane, POP_LENS);
    };
    // Some arrive as the widget itself, some inside the box Monaco positions.
    const dress = (node) => {
      if (node.nodeType !== 1) return;
      if (node.matches(POPUPS)) glaze(node);
      else node.querySelectorAll(POPUPS).forEach(glaze);
    };
    const watcher = new MutationObserver((list) => {
      for (const change of list) change.addedNodes.forEach(dress);
    });
    for (const layer of root.querySelectorAll('.overflowingContentWidgets, .overflowingOverlayWidgets')) {
      for (const node of layer.children) dress(node);
      watcher.observe(layer, { childList: true });
    }
    return watcher;
  }

  /* ---------- Mounting ----------
     An editor holds a set of files (a project, see project.js) and shows one of them at
     a time. A script that is a single text is a set of one file, main.luau.

     What mount() gives back, whichever editor it had to use:

       kind                 'monaco' | 'basic' | 'none' (the page left before it loaded)
       value                the text on screen
       path                 the file on screen; null while a read-only document is
       paths() has(p)       the files
       text(p)              a file's text, with \n line endings
       stamp(p)             changes with the text and is the same again after an undo
       open(p, at)          show a file; at: { lineNumber, column } or a range
       add(p, text) remove(p) rename(from, to) reset(files)
       report(byPath)       errors found outside the editor: { path: [{ line, column, message }] }
       failing()            the files with an error in them, as a Set
       back()               leave a read-only document for the file shown before it
       on(event, fn)        'change' (path, edit), 'show' (path, document), 'add', 'remove',
                            'rename' (from, to), 'reset', 'problems'; returns its undo
       focus() dispose()

     With Monaco there is also `monaco`, `editor`, model(p), pathOf(model) and
     doc(name, text) for the language server (lsp.js). */

  const ENTRY = 'main.luau';

  function emitter() {
    const subs = {};
    return {
      on(ev, fn) {
        (subs[ev] = subs[ev] || new Set()).add(fn);
        return () => subs[ev].delete(fn);
      },
      emit(ev, ...args) { if (subs[ev]) for (const fn of [...subs[ev]]) fn(...args); },
    };
  }

  function mountMonaco(monaco, host, opts) {
    const id = 'w' + ++spaceSeq;
    const address = (kind, name) => monaco.Uri.from({ scheme: 'nt', authority: id, path: `/${kind}/${name}` });
    const bus = emitter();
    const models = new Map();    // project path → model: one each, so every file keeps its own undo history
    const docs = new Map();      // name → model of a read-only document (a definition file)
    const paths = new WeakMap(); // model → project path
    const views = new WeakMap(); // model → cursor and scroll position while another file is shown
    const texts = new WeakMap(); // model → { version, text }
    const hooks = new Map();     // model → its change listener
    const serial = new WeakMap(); // model → a number no other model has had
    let made = 0;
    let quiet = false;           // true while reset() rewrites the files
    let shown = null;            // the project file on screen
    let last = ENTRY;            // where back() returns to

    function make(path, text) {
      const model = monaco.editor.createModel(text, /\.json$/i.test(path) ? 'json' : 'luau', address('project', path));
      // Scripts are stored with plain \n line endings whatever the platform.
      model.setEOL(monaco.editor.EndOfLineSequence.LF);
      models.set(path, model);
      paths.set(model, path);
      serial.set(model, ++made);
      hooks.set(model, model.onDidChangeContent((e) => {
        if (quiet) return;
        bus.emit('change', path, e);
        if (opts.onChange) opts.onChange(path);
      }));
      return model;
    }

    function drop(path) {
      const model = models.get(path);
      models.delete(path);
      hooks.get(model).dispose();
      hooks.delete(model);
      // Markers are kept by address, not by model: they would outlive it.
      const owners = new Set(monaco.editor.getModelMarkers({ resource: model.uri }).map((m) => m.owner));
      for (const owner of owners) monaco.editor.setModelMarkers(model, owner, []);
      model.dispose();
    }

    const read = (model) => {
      const hit = texts.get(model), version = model.getVersionId();
      if (hit && hit.version === version) return hit.text;
      const text = model.getValue(monaco.editor.EndOfLinePreference.LF);
      texts.set(model, { version, text });
      return text;
    };

    const files = opts.files || { [ENTRY]: opts.value || '' };
    for (const path of Object.keys(files)) make(path, files[path]);
    shown = opts.open && models.has(opts.open) ? opts.open : ENTRY;
    last = shown;

    // Row height of the suggestion list comes from the stylesheet (taller for touch).
    const suggestRow = parseFloat(getComputedStyle(host).getPropertyValue('--sg-row')) || 34;
    const editor = monaco.editor.create(host, {
      model: models.get(shown),
      theme: document.documentElement.dataset.theme === 'dark' ? 'nt-dark' : 'nt-light',
      readOnly: !!opts.readOnly,
      domReadOnly: !!opts.readOnly,
      automaticLayout: true,
      fontFamily: FONT,
      fontSize: 13,
      lineHeight: 20,
      fontLigatures: false,
      letterSpacing: 0,
      tabSize: 4,
      insertSpaces: false,
      detectIndentation: true,
      padding: { top: 14, bottom: 14 },
      minimap: { enabled: false },
      stickyScroll: { enabled: false },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      cursorWidth: 2,
      roundedSelection: true,
      renderLineHighlight: opts.readOnly ? 'none' : 'line',
      lineNumbersMinChars: 3,
      lineDecorationsWidth: 12,
      glyphMargin: false,
      folding: true,
      showFoldingControls: 'mouseover',
      overviewRulerLanes: 0,
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      guides: { indentation: true, bracketPairs: false },
      bracketPairColorization: { enabled: false },
      matchBrackets: 'always',
      wordWrap: 'off',
      contextmenu: true,
      useShadowDOM: false,
      fixedOverflowWidgets: true,
      unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
      quickSuggestions: !opts.readOnly,
      suggestLineHeight: suggestRow,
      suggestFontSize: 14,
      hover: { delay: 350, above: false },
      inlayHints: { enabled: 'off' },
      accessibilitySupport: 'auto',
      ariaLabel: opts.readOnly ? 'Script source' : 'Script editor',
    });
    let popups = dressPopups(editor.getDomNode());
    // An action belongs to this editor alone; a command would answer in every editor.
    if (opts.onSave) {
      editor.addAction({ id: 'nt.save', label: 'Save', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS], run: () => opts.onSave() });
    }

    function show(model, at) {
      const from = editor.getModel();
      if (from !== model) {
        if (from) views.set(from, editor.saveViewState());
        editor.setModel(model);
        // Monaco rebuilds its view for another model, and the layers its popups live in with it.
        popups.disconnect();
        popups = dressPopups(editor.getDomNode());
        if (views.has(model)) editor.restoreViewState(views.get(model));
        const path = paths.get(model) || null;
        const locked = !!opts.readOnly || !path;
        editor.updateOptions({ readOnly: locked, domReadOnly: locked, renderLineHighlight: locked ? 'none' : 'line' });
        shown = path;
        if (path) last = path;
        bus.emit('show', path, path ? null : model.uri.path.split('/').pop());
      }
      if (at) {
        const range = at.endLineNumber ? at : { startLineNumber: at.lineNumber, startColumn: at.column, endLineNumber: at.lineNumber, endColumn: at.column };
        editor.setSelection(range);
        editor.revealRangeInCenterIfOutsideViewport(range, monaco.editor.ScrollType.Immediate);
      }
    }

    spaces.set(id, {
      reveal(resource, at) {
        const model = monaco.editor.getModel(resource);
        if (!model) return false;
        show(model, at);
        editor.focus();
        return true;
      },
    });
    const watch = monaco.editor.onDidChangeMarkers((uris) => {
      if (uris.some((uri) => uri.authority === id)) bus.emit('problems');
    });

    return {
      kind: 'monaco',
      monaco,
      editor,
      on: bus.on,
      get value() { return read(editor.getModel()); },
      get path() { return shown; },
      paths: () => [...models.keys()],
      has: (path) => models.has(path),
      text: (path) => read(models.get(path)),
      stamp: (path) => serial.get(models.get(path)) + ':' + models.get(path).getAlternativeVersionId(),
      model: (path) => models.get(path),
      pathOf: (model) => paths.get(model) || null,
      open(path, at) { show(models.get(path), at); },
      add(path, text) {
        make(path, text);
        bus.emit('add', path);
      },
      remove(path) {
        if (last === path) last = ENTRY;
        if (shown === path) show(models.get(ENTRY));
        drop(path);
        bus.emit('remove', path);
      },
      // A model cannot change its address, so the file moves into a new one. Its place
      // in the text comes along; its undo history does not.
      rename(from, to) {
        const old = models.get(from);
        const model = make(to, read(old));
        const view = editor.getModel() === old ? editor.saveViewState() : views.get(old);
        if (view) views.set(model, view);
        if (last === from) last = to;
        if (shown === from) show(model);
        drop(from);
        bus.emit('rename', from, to);
      },
      reset(next) {
        quiet = true;
        for (const path of Object.keys(next)) {
          if (models.has(path)) models.get(path).setValue(next[path]);
          else make(path, next[path]);
        }
        if (!(shown in next)) show(models.get(ENTRY));
        for (const path of [...models.keys()]) if (!(path in next)) drop(path);
        if (!models.has(last)) last = ENTRY;
        quiet = false;
        bus.emit('reset');
      },
      doc(name, text) {
        if (!docs.has(name)) docs.set(name, monaco.editor.createModel(text, 'luau', address('defs', name)));
        return docs.get(name);
      },
      back() {
        show(models.get(models.has(last) ? last : ENTRY));
        editor.focus();
      },
      report(byPath) {
        for (const [path, model] of models) {
          const lines = model.getLineCount();
          monaco.editor.setModelMarkers(model, 'bundle', (byPath[path] || []).map((d) => {
            const line = Math.min(lines, Math.max(1, d.line || 1));
            const column = d.line && d.column ? Math.min(d.column, model.getLineMaxColumn(line)) : model.getLineFirstNonWhitespaceColumn(line) || 1;
            return { severity: monaco.MarkerSeverity.Error, source: 'Bundle', message: d.message, startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: model.getLineMaxColumn(line) };
          }));
        }
      },
      failing() {
        const out = new Set();
        for (const [path, model] of models) {
          if (monaco.editor.getModelMarkers({ resource: model.uri }).some((m) => m.severity === monaco.MarkerSeverity.Error)) out.add(path);
        }
        return out;
      },
      focus() { editor.focus(); },
      dispose() {
        spaces.delete(id);
        watch.dispose();
        popups.disconnect();
        editor.dispose();
        for (const path of [...models.keys()]) drop(path);
        for (const model of docs.values()) model.dispose();
      },
    };
  }

  // The built-in editor shows the same set of files through one text field, one at a time.
  function mountFallback(host, opts) {
    const files = new Map(Object.entries(opts.files || { [ENTRY]: opts.value || '' }));
    if (opts.readOnly) {
      host.append(NT.luau.viewer(files.get(ENTRY)));
      return { kind: 'basic', get value() { return files.get(ENTRY); }, focus() {}, dispose() {} };
    }
    const bus = emitter();
    let shown = opts.open && files.has(opts.open) ? opts.open : ENTRY;
    let reported = {};
    const ed = NT.luau.editor({
      value: files.get(shown),
      onChange: (text) => {
        files.set(shown, text);
        bus.emit('change', shown);
        if (opts.onChange) opts.onChange(shown);
      },
      onSave: () => { if (opts.onSave) opts.onSave(); },
    });
    host.append(ed.el);
    const show = (path) => {
      shown = path;
      ed.value = files.get(path);
      ed.el.firstElementChild.scrollTo(0, 0);
      bus.emit('show', path, null);
    };
    return {
      kind: 'basic',
      on: bus.on,
      get value() { return ed.value; },
      get path() { return shown; },
      paths: () => [...files.keys()],
      has: (path) => files.has(path),
      text: (path) => files.get(path),
      stamp: (path) => files.get(path),
      open(path) { if (path !== shown) show(path); },
      add(path, text) {
        files.set(path, text);
        bus.emit('add', path);
      },
      remove(path) {
        if (shown === path) show(ENTRY);
        files.delete(path);
        bus.emit('remove', path);
      },
      rename(from, to) {
        files.set(to, files.get(from));
        files.delete(from);
        if (shown === from) {
          shown = to;
          bus.emit('show', to, null);
        }
        bus.emit('rename', from, to);
      },
      reset(next) {
        files.clear();
        for (const path of Object.keys(next)) files.set(path, next[path]);
        show(files.has(shown) ? shown : ENTRY);
        bus.emit('reset');
      },
      back() {},
      report(byPath) {
        reported = byPath;
        bus.emit('problems');
      },
      failing: () => new Set(Object.keys(reported).filter((path) => files.has(path) && reported[path].length)),
      focus() { ed.input.focus(); },
      dispose() {},
    };
  }

  NT.code = {
    preload() { load().catch(() => {}); },
    // Mount an editor into `host`.
    //   opts: { files: { path: text }, open: path, readOnly, onChange(path), onSave() }
    //   or, for one text: { value, readOnly }
    async mount(host, opts = {}) {
      const spinner = h('div.boot', h('div.spinner'));
      host.append(spinner);
      let api;
      try {
        const monaco = await load();
        spinner.remove();
        if (!host.isConnected) return { kind: 'none', value: opts.value || '', focus() {}, dispose() {} };
        api = mountMonaco(monaco, host, opts);
      } catch (e) {
        spinner.remove();
        host.classList.add('is-basic');
        api = mountFallback(host, opts);
      }
      return api;
    },
  };
})();
