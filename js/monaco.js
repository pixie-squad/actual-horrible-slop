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
        for (const k of KEYWORDS.concat(CONSTANTS)) suggestions.push({ label: k, kind: K.Keyword, insertText: k, range });
        for (const t of TYPES) suggestions.push({ label: t, kind: K.TypeParameter, insertText: t, range });
        for (const b of BUILTINS) suggestions.push({ label: b, kind: K.Function, insertText: b, range });
        for (const [label, body, detail] of SNIPPETS) {
          suggestions.push({ label, kind: K.Snippet, detail, insertText: body, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range });
        }
        return { suggestions };
      },
    });

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
        },
      };
    };
    monaco.editor.defineTheme('nt-light', theme(false));
    monaco.editor.defineTheme('nt-dark', theme(true));

    const applyTheme = () => monaco.editor.setTheme(document.documentElement.dataset.theme === 'dark' ? 'nt-dark' : 'nt-light');
    NT.bus.on('prefs', applyTheme);
    applyTheme();
  }

  // Monaco builds its popups itself, the first time each is needed. As they arrive
  // they are given the app's glass: the same material and lens as its own menus.
  const POP_LENS = { bezel: 18, magnify: 0.008, dispersion: 0 };
  function dressPopups(root) {
    const dress = (node) => {
      if (node.nodeType !== 1) return;
      if (node.classList.contains('suggest-widget')) {
        node.classList.add('glass', 'thick');
        NT.glass.refract(node, POP_LENS);
      } else if (node.classList.contains('suggest-details-container')) {
        const pane = node.querySelector('.suggest-details');
        if (pane) {
          pane.classList.add('glass', 'thick');
          NT.glass.refract(pane, POP_LENS);
        }
      }
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

  function mountMonaco(monaco, host, opts) {
    // Row height of the suggestion list comes from the stylesheet (taller for touch).
    const suggestRow = parseFloat(getComputedStyle(host).getPropertyValue('--sg-row')) || 34;
    const editor = monaco.editor.create(host, {
      value: opts.value || '',
      language: 'luau',
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
      accessibilitySupport: 'auto',
      ariaLabel: opts.readOnly ? 'Script source' : 'Script editor',
    });
    const popups = dressPopups(editor.getDomNode());
    // Scripts are stored with plain \n line endings whatever the platform.
    const model = editor.getModel();
    model.setEOL(monaco.editor.EndOfLineSequence.LF);
    const read = () => model.getValue(monaco.editor.EndOfLinePreference.LF);
    if (opts.onChange) editor.onDidChangeModelContent(() => opts.onChange(read()));
    if (opts.onSave) editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => opts.onSave(read()));
    return {
      kind: 'monaco',
      get value() { return read(); },
      focus() { editor.focus(); },
      dispose() { popups.disconnect(); editor.dispose(); model.dispose(); },
    };
  }

  function mountFallback(host, opts) {
    if (opts.readOnly) {
      host.append(NT.luau.viewer(opts.value || ''));
      return { kind: 'basic', get value() { return opts.value || ''; }, focus() {}, dispose() {} };
    }
    const ed = NT.luau.editor({ value: opts.value || '', onChange: opts.onChange, onSave: opts.onSave });
    host.append(ed.el);
    return { kind: 'basic', get value() { return ed.value; }, focus() { ed.input.focus(); }, dispose() {} };
  }

  NT.code = {
    preload() { load().catch(() => {}); },
    // Mount an editor into `host`. opts: { value, readOnly, onChange, onSave }
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
