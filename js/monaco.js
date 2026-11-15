/*
  Code editing with Monaco.

  Monaco is loaded on demand from a CDN the first time a script is opened.
  If it cannot be reached (offline), the built-in lightweight editor from
  luau.js is used instead, so viewing and editing always work.

  How it looks is the style's: its colours are read from the style's tokens
  (--code-bg, --code-fg, --code-line, --code-sel, --code-num, --code-num-on,
  --code-guide, --code-widget, --tk-k/s/n/c/f/b/p, as #rrggbb or #rrggbbaa), its
  widgets are drawn by the style's CSS, and NT.look, where the style sets one, has

    codeFont             the font stack
    codeOptions          editor options over the ones here
    codeTheme(t, dark)   the theme about to be defined, to change or replace
    pane(el)             a popup Monaco has just built (suggestions, hover, hints, rename)
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { h } = NT.util;

  const BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min';
  const look = () => NT.look || {};
  const font = () => look().codeFont || '"SF Mono", ui-monospace, "JetBrains Mono", "Cascadia Mono", Consolas, monospace';
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

  // Monaco measures the font once and places the caret by that width. Measured on a
  // fallback while the web font is still downloading, the caret drifts off the text.
  const fontsIn = () => Promise.race([
    Promise.all(['', 'bold ', 'italic '].map((style) => document.fonts.load(`${style}13px ${font()}`))).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);

  function load() {
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('editor load timed out')), 12000);
      const fonts = fontsIn();
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
          } catch (e) { return reject(e); }
          fonts.then(() => resolve(window.monaco));
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
          // A directive of macro.js, at the start of its line.
          [/^\s*#\s*(?:define|undef|ifdef|ifndef|if|elif|else|endif|include|error|warning)\b/, 'keyword'],
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

    // A colour token as Monaco wants it (#rrggbb, or with alpha where `alpha` allows
    // it), or `fallback` where it is not one.
    const token = (name, fallback, alpha) => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return (alpha ? /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i : /^#[0-9a-f]{6}$/i).test(v) ? v : fallback;
    };

    // Colours follow the style's own code palette (its tokens); what a style leaves
    // out is as it was first drawn.
    const theme = (dark) => {
      const d = dark
        ? { bg: '#1c1c1e', fg: '#ffffff', k: 'ff7ab2', s: 'ff8170', n: 'd9c97c', c: '7f8c98', f: '78c2b3', b: 'b281eb', p: '6bdfff', line: '#ffffff0d', sel: '#3f638b', num: '#636366', numOn: '#aeaeb2', guide: '#ffffff14', widget: '#2c2c2e' }
        : { bg: '#ffffff', fg: '#000000', k: 'ad3da4', s: 'c41a16', n: '1c00cf', c: '6c7986', f: '326d74', b: '6c36a9', p: '2b5c8a', line: '#0000000a', sel: '#b3d7ff', num: '#aeaeb2', numOn: '#636366', guide: '#00000010', widget: '#f2f2f7' };
      const c = {
        bg: token('--code-bg', d.bg), fg: token('--code-fg', d.fg),
        line: token('--code-line', d.line, true), sel: token('--code-sel', d.sel),
        num: token('--code-num', d.num), numOn: token('--code-num-on', d.numOn),
        guide: token('--code-guide', d.guide, true), widget: token('--code-widget', d.widget),
      };
      for (const k of ['k', 's', 'n', 'c', 'f', 'b', 'p']) c[k] = token('--tk-' + k, '#' + d[k]).slice(1);
      const t = {
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
          // What the language server writes between the words (types, parameter names).
          'editorInlayHint.foreground': '#' + c.c,
          'editorInlayHint.background': c.line,
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
          // The quick input (the command palette, Go to File, Find in Files).
          'quickInput.background': c.widget,
          'quickInput.foreground': c.fg,
          'quickInputList.focusBackground': c.sel,
          'quickInputList.focusForeground': c.fg,
          'quickInputTitle.background': c.widget,
          'pickerGroup.foreground': c.numOn,
          'pickerGroup.border': c.guide,
          'list.highlightForeground': token('--blue', '#0088ff'),
          'list.focusHighlightForeground': c.fg,
          'input.background': c.bg,
          'input.foreground': c.fg,
          'input.border': c.guide,
          'inputValidation.errorBackground': c.widget,
          'inputValidation.errorBorder': token('--red', '#ff383c'),
          // Comparing (NT.code.diff): what was added in the style's green, removed in its red.
          'diffEditor.insertedTextBackground': token('--green', '#34c759') + '40',
          'diffEditor.removedTextBackground': token('--red', '#ff383c') + '40',
          'diffEditor.insertedLineBackground': token('--green', '#34c759') + '1f',
          'diffEditor.removedLineBackground': token('--red', '#ff383c') + '1f',
          'diffEditorGutter.insertedLineBackground': token('--green', '#34c759') + '2e',
          'diffEditorGutter.removedLineBackground': token('--red', '#ff383c') + '2e',
          'diffEditor.diagonalFill': c.guide,
          'diffEditor.border': c.guide,
          'diffEditor.unchangedRegionBackground': c.widget,
          'diffEditor.unchangedRegionForeground': c.numOn,
          'diffEditor.unchangedCodeBackground': '#00000000',
        },
      };
      return (look().codeTheme && look().codeTheme(t, dark)) || t;
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

    // The code font arrived after the editor was made after all (a slow network).
    document.fonts.addEventListener('loadingdone', (e) => {
      if (e.fontfaces.some((face) => font().includes(face.family.replace(/["']/g, '')))) monaco.editor.remeasureFonts();
    });

    // StyLua formats Luau (format.js): Format Document, Format Selection, Shift+Alt+F.
    if (NT.format.available()) {
      const LF = monaco.editor.EndOfLinePreference.LF;
      const formatter = async (model, range, options, token) => {
        const text = model.getValue(LF);
        const o = { tabs: !options.insertSpaces, width: options.tabSize };
        if (range) o.range = { start: model.getOffsetAt(range.getStartPosition()), end: model.getOffsetAt(range.getEndPosition()) };
        const r = await NT.format.text(text, o);
        outcomes.set(model, r);
        // Typed over while it was away: what came back is of a text that is gone.
        if (token.isCancellationRequested || r.error || !r.changed || model.getValue(LF) !== text) return [];
        // Monaco narrows this down to what changed, so the caret and the undo stay where they belong.
        return [{ range: model.getFullModelRange(), text: r.text }];
      };
      monaco.languages.registerDocumentFormattingEditProvider('luau', {
        displayName: 'StyLua',
        provideDocumentFormattingEdits: (model, options, token) => formatter(model, null, options, token),
      });
      monaco.languages.registerDocumentRangeFormattingEditProvider('luau', {
        displayName: 'StyLua',
        provideDocumentRangeFormattingEdits: (model, range, options, token) => formatter(model, range, options, token),
      });
    }

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
  // model → what its last formatting came to (format.js), read by mount's format().
  const outcomes = new WeakMap();

  // Monaco's own quick input, the box its command palette is: Go to File and Find in
  // Files open in it. Reached by its module names in the CDN build; null where they move.
  let quickInput = null;
  const quick = () => quickInput || (quickInput = new Promise((resolve) => {
    window.require(['vs/platform/quickinput/common/quickInput', 'vs/editor/standalone/browser/standaloneServices'], (qi, ss) => {
      try { resolve(ss.StandaloneServices.get(qi.IQuickInputService) || null); } catch (e) { resolve(null); }
    }, () => resolve(null));
  }));

  // What was typed into Find in Files, as a pattern: /…/flags is one as written, and
  // anything else is looked for as it is, without regard to case unless it has a capital.
  function pattern(q) {
    const re = /^\/(.+)\/([imsu]*)$/.exec(q);
    try {
      if (re) return new RegExp(re[1], [...new Set(re[2] + 'g')].join(''));
      return new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), /[A-Z]/.test(q) ? 'g' : 'gi');
    } catch (e) { return null; }
  }
  const SEARCH_MAX = 500;

  // The one stretch where `a` and `b` differ: { start, end } in a, and what goes there.
  function narrowest(a, b) {
    const most = Math.min(a.length, b.length);
    let s = 0;
    while (s < most && a.charCodeAt(s) === b.charCodeAt(s)) s++;
    let e = 0;
    while (e < most - s && a.charCodeAt(a.length - 1 - e) === b.charCodeAt(b.length - 1 - e)) e++;
    return { start: s, end: a.length - e, text: b.slice(s, b.length - e) };
  }

  /* ---------- Settings ----------
     What someone has set (editor-prefs.js), as Monaco's own options. A mounted editor
     takes them when it is made and again whenever one changes. */

  function tuned(readOnly) {
    const p = NT.editorPrefs.data;
    return {
      fontSize: p.fontSize,
      lineHeight: Math.round((p.fontSize * 20) / 13),
      tabSize: p.tabSize,
      insertSpaces: p.spaces,
      detectIndentation: p.detectIndent,
      wordWrap: p.wrap ? 'on' : 'off',
      lineNumbers: p.lineNumbers,
      minimap: { enabled: p.minimap },
      stickyScroll: { enabled: p.sticky },
      renderWhitespace: p.whitespace ? 'all' : 'selection',
      guides: { indentation: p.guides, bracketPairs: false },
      bracketPairColorization: { enabled: p.bracketColors },
      cursorSmoothCaretAnimation: p.smoothCaret ? 'on' : 'off',
      autoClosingBrackets: p.closeBrackets ? 'languageDefined' : 'never',
      autoClosingQuotes: p.closeQuotes ? 'languageDefined' : 'never',
      quickSuggestions: !readOnly && p.suggest,
      suggestOnTriggerCharacters: p.suggest,
      acceptSuggestionOnEnter: p.acceptEnter,
      parameterHints: { enabled: p.signatures },
      inlayHints: { enabled: NT.editorPrefs.hints() ? 'on' : 'off' },
    };
  }

  // How a file is indented is the file's own: read from its text, or as set.
  function indent(model) {
    const p = NT.editorPrefs.data;
    if (p.detectIndent) model.detectIndentation(p.spaces, p.tabSize);
    else model.updateOptions({ insertSpaces: p.spaces, tabSize: p.tabSize, indentSize: p.tabSize });
    model.updateOptions({ bracketColorizationOptions: { enabled: p.bracketColors, independentColorPoolPerBracketType: false } });
  }

  // Enter right after "then", "do" or a function's head also puts the "end" under the
  // new line, when the block has none (NT.luau.wantsEnd). → false when this is not that.
  function closeBlock(monaco, editor) {
    const model = editor.getModel();
    const sel = editor.getSelection();
    if (!NT.editorPrefs.data.closeBlocks || !model || !sel || !sel.isEmpty() || model.getLanguageId() !== 'luau') return false;
    const at = sel.getPosition();
    const line = model.getLineContent(at.lineNumber);
    const rest = line.slice(at.column - 1);
    // Only with nothing after the cursor but what closes the call the block is in:
    // foo(function()|) becomes foo(function() … end).
    if (!/^[ \t]*[)\]},;]*[ \t]*$/.test(rest)) return false;
    // Both read with \n line endings, whatever the model keeps, so the place is the same in each.
    const LF = monaco.editor.EndOfLinePreference.LF;
    const before = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: at.lineNumber, endColumn: at.column }, LF);
    if (!NT.luau.wantsEnd(model.getValue(LF), before.length)) return false;
    const base = line.match(/^[ \t]*/)[0];
    const o = model.getOptions();
    const body = base + (o.insertSpaces ? ' '.repeat(o.indentSize) : '\t');
    const gap = rest.match(/^[ \t]*/)[0].length;
    const caret = new monaco.Selection(at.lineNumber + 1, body.length + 1, at.lineNumber + 1, body.length + 1);
    // One step to undo, apart from the typing before it.
    editor.pushUndoStop();
    editor.executeEdits('nt.end', [{
      range: new monaco.Range(at.lineNumber, at.column, at.lineNumber, at.column + gap),
      text: '\n' + body + '\n' + base + 'end',
      forceMoveMarkers: true,
    }], [caret]);
    editor.pushUndoStop();
    editor.revealPosition(caret.getPosition());
    return true;
  }

  // Monaco builds its popups itself, the first time each is needed. As they arrive
  // they are handed to the style, to be given the material of its own menus.
  // The suggestion list, its detail pane, hovers, parameter hints and the rename field.
  const POPUPS = '.suggest-widget, .suggest-details, .monaco-hover, .parameter-hints-widget, .rename-box';
  function dressPopups(root) {
    const glaze = (pane) => { if (look().pane) look().pane(pane); };
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
                            'rename' (from, to), 'reset', 'problems', 'format' (Shift+Alt+F
                            was pressed); returns its undo

     With Monaco and a formatter (format.js) there is also format(p) → Promise of
     { changed } or { error, line, column }. An editor that is not read-only also has
     goToFile() (Ctrl+P) and findInFiles() (Ctrl+Shift+F), which open in Monaco's quick
     input; their keys work anywhere on the page while it is on screen.
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
      // → how many heard it
      emit(ev, ...args) {
        const fns = subs[ev] ? [...subs[ev]] : [];
        for (const fn of fns) fn(...args);
        return fns.length;
      },
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
      const model = monaco.editor.createModel(text, /\.json$/i.test(path) ? 'json' : /\.luau?$/i.test(path) ? 'luau' : 'plaintext', address('project', path));
      // Scripts are stored with plain \n line endings whatever the platform.
      model.setEOL(monaco.editor.EndOfLineSequence.LF);
      indent(model);
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
    const editor = monaco.editor.create(host, Object.assign({
      model: models.get(shown),
      theme: document.documentElement.dataset.theme === 'dark' ? 'nt-dark' : 'nt-light',
      readOnly: !!opts.readOnly,
      domReadOnly: !!opts.readOnly,
      automaticLayout: true,
      fontFamily: font(),
      fontLigatures: false,
      letterSpacing: 0,
      padding: { top: 14, bottom: 14 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
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
      matchBrackets: 'always',
      contextmenu: true,
      useShadowDOM: false,
      fixedOverflowWidgets: true,
      unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
      suggestLineHeight: suggestRow,
      suggestFontSize: 14,
      hover: { delay: 350, above: false },
      accessibilitySupport: 'auto',
      ariaLabel: opts.readOnly ? 'Script source' : 'Script editor',
    }, look().codeOptions, tuned(!!opts.readOnly)));
    let popups = dressPopups(editor.getDomNode());
    const retune = () => {
      editor.updateOptions(tuned(!!opts.readOnly));
      for (const model of models.values()) indent(model);
    };
    NT.bus.on('editor', retune);
    // An action belongs to this editor alone; a command would answer in every editor.
    if (opts.onSave) {
      editor.addAction({ id: 'nt.save', label: 'Save', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS], run: () => opts.onSave() });
    }

    if (!opts.readOnly) {
      // Shift+Alt+F is said on the bus, so whoever holds the session can say when it fails;
      // with no one listening it is Monaco's Format Document.
      editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
        if (!bus.emit('format')) editor.getAction('editor.action.formatDocument').run();
      }, '!editorReadonly');
      editor.addAction({
        id: 'nt.enter',
        label: 'New Line',
        keybindings: [monaco.KeyCode.Enter],
        // Whenever the suggestion list does not take Enter for itself (Monaco's rule for
        // that is: it is open, Enter accepts, and accepting would change the text).
        keybindingContext: ['!suggestWidgetVisible', '!acceptSuggestionOnEnter', '!suggestionMakesTextEdit']
          .map((free) => `editorTextFocus && !editorReadonly && !editorHasMultipleSelections && ${free}`).join(' || '),
        run: () => {
          // Whichever editor the key was pressed in, should two be alive at once.
          const typing = editor.hasTextFocus() ? editor : monaco.editor.getEditors().find((e) => e.hasTextFocus()) || editor;
          // Whatever it is not, it is Enter as Monaco types it, with its own indenting.
          if (!closeBlock(monaco, typing)) typing.trigger('keyboard', 'type', { text: '\n' });
        },
      });
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
        if (path) {
          last = path;
          if (recent.includes(path)) recent.splice(recent.indexOf(path), 1);
          recent.unshift(path);
        }
        bus.emit('show', path, path ? null : model.uri.path.split('/').pop());
      }
      if (at) {
        const range = at.endLineNumber ? at : { startLineNumber: at.lineNumber, startColumn: at.column, endLineNumber: at.lineNumber, endColumn: at.column };
        editor.setSelection(range);
        editor.revealRangeInCenterIfOutsideViewport(range, monaco.editor.ScrollType.Immediate);
      }
    }

    /* ----- Go to File, Find in Files ----- */

    const nameOf = (p) => p.slice(p.lastIndexOf('/') + 1);
    const recent = []; // project paths, the one shown last first

    async function goToFile() {
      const svc = await quick();
      if (!svc || !host.isConnected) return;
      editor.focus();
      const qp = svc.createQuickPick();
      // The files seen last come first, the one on screen last of all, as in a desktop editor.
      const order = [...recent.filter((p) => models.has(p) && p !== shown), ...[...models.keys()].sort()];
      qp.items = [...new Set([...order.filter((p) => p !== shown), shown].filter(Boolean))].map((path) => ({
        label: nameOf(path),
        description: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
        path,
      }));
      qp.placeholder = 'Go to file';
      qp.matchOnDescription = true;
      // name:12 goes to line 12 of it.
      qp.filterValue = (v) => v.replace(/:\d*(?::\d*)?$/, '');
      qp.onDidAccept(() => {
        const it = qp.selectedItems[0] || qp.activeItems[0];
        const m = /:(\d+)(?::(\d+))?$/.exec(qp.value);
        qp.hide();
        if (!it || !models.has(it.path)) return;
        show(models.get(it.path), m ? { lineNumber: Number(m[1]), column: Number(m[2] || 1) } : null);
        editor.focus();
      });
      qp.onDidHide(() => qp.dispose());
      qp.show();
    }

    async function findInFiles() {
      const svc = await quick();
      if (!svc || !host.isConnected) return;
      // What is selected on one line is what is looked for.
      const sel = editor.getSelection();
      const model = editor.getModel();
      const picked = sel && !sel.isEmpty() && sel.startLineNumber === sel.endLineNumber && model ? model.getValueInRange(sel) : '';
      editor.focus();
      const qp = svc.createQuickPick();
      qp.placeholder = 'Search in files';
      qp.matchOnLabel = false;
      qp.sortByLabel = false;
      const run = () => {
        const q = qp.value;
        qp.validationMessage = undefined;
        if (!q) return void (qp.items = []);
        const re = pattern(q);
        if (!re) {
          qp.validationMessage = 'Not a regular expression';
          return void (qp.items = []);
        }
        const out = [];
        let count = 0;
        for (const path of [...models.keys()].sort()) {
          const lines = models.get(path).getLinesContent();
          const hits = [];
          for (let i = 0; i < lines.length && count < SEARCH_MAX; i++) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(lines[i])) && count < SEARCH_MAX) {
              hits.push({ line: i + 1, at: m.index, len: m[0].length, text: lines[i] });
              count++;
              if (!m[0].length) re.lastIndex++;
            }
          }
          if (!hits.length) continue;
          out.push({ type: 'separator', label: path });
          for (const hit of hits) {
            // The line from its first word, and from a little before the match where it is far in.
            const lead = hit.text.length - hit.text.trimStart().length;
            const from = Math.max(lead, hit.at - 40);
            const cut = from > lead ? '…' : '';
            const label = cut + hit.text.slice(from, from + 200);
            const start = cut.length + hit.at - from;
            out.push({
              label,
              description: String(hit.line),
              highlights: { label: [{ start, end: start + Math.max(1, hit.len) }] },
              path,
              range: { startLineNumber: hit.line, startColumn: hit.at + 1, endLineNumber: hit.line, endColumn: hit.at + 1 + hit.len },
            });
          }
        }
        qp.items = out;
      };
      let timer = null;
      qp.onDidChangeValue(() => {
        clearTimeout(timer);
        timer = setTimeout(run, 80);
      });
      qp.onDidAccept(() => {
        const it = qp.activeItems[0];
        qp.hide();
        if (!it || !it.range || !models.has(it.path)) return;
        show(models.get(it.path), it.range);
        editor.focus();
      });
      qp.onDidHide(() => {
        clearTimeout(timer);
        qp.dispose();
      });
      qp.value = picked;
      run();
      qp.show();
    }

    if (!opts.readOnly) {
      editor.addAction({ id: 'nt.goToFile', label: 'Go to File…', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP], run: goToFile });
      editor.addAction({ id: 'nt.findInFiles', label: 'Find in Files…', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF], run: findInFiles });
    }
    // The same keys wherever the keyboard is on the editor's page (the file tree, its
    // buttons), so Ctrl+P is never the browser's Print there. Not from a dialog over it.
    const pageKeys = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || !host.isConnected || !host.offsetParent || host.closest('[inert]')) return;
      const k = e.key.toLowerCase();
      const run = k === 'p' && !e.shiftKey ? goToFile : k === 'f' && e.shiftKey ? findInFiles : null;
      if (!run || editor.hasTextFocus() || document.activeElement.closest('[role=dialog], [role=alertdialog], .quick-input-widget')) return;
      e.preventDefault();
      run();
    };
    if (!opts.readOnly) window.addEventListener('keydown', pageKeys, true);

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
      // The whole of a file, as one edit Undo takes back.
      replace(path, text) {
        const model = models.get(path);
        if (!model || read(model) === text) return;
        model.pushStackElement();
        model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
        model.pushStackElement();
      },
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
      // → { changed } or { error, line, column }; { none: true } where there is no formatter.
      // The file on screen goes through Monaco's Format Document; another is changed
      // only where it differs, as one step to undo.
      async format(path) {
        const model = models.get(path);
        if (!model || !NT.format.available()) return { none: true };
        outcomes.delete(model);
        if (editor.getModel() === model) {
          // JSON has Monaco's own formatter, which says nothing of how it went.
          await editor.getAction('editor.action.formatDocument').run();
          return model.getLanguageId() === 'luau' ? outcomes.get(model) || { none: true } : { changed: false };
        }
        if (model.getLanguageId() !== 'luau') return { none: true };
        const text = read(model);
        const o = model.getOptions();
        const r = await NT.format.text(text, { tabs: !o.insertSpaces, width: o.tabSize });
        if (r.error || !r.changed || !models.has(path) || read(model) !== text) return r;
        const d = narrowest(text, r.text);
        const at = (n) => model.getPositionAt(n);
        const from = at(d.start), to = at(d.end);
        model.pushStackElement();
        model.pushEditOperations([], [{ range: new monaco.Range(from.lineNumber, from.column, to.lineNumber, to.column), text: d.text }], () => null);
        model.pushStackElement();
        return r;
      },
      goToFile,
      findInFiles,
      focus() { editor.focus(); },
      dispose() {
        spaces.delete(id);
        window.removeEventListener('keydown', pageKeys, true);
        NT.bus.off('editor', retune);
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
      replace(path, text) {
        if (!files.has(path) || files.get(path) === text) return;
        files.set(path, text);
        if (shown === path) ed.value = text;
        bus.emit('change', path);
        if (opts.onChange) opts.onChange(path);
      },
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

  /* ---------- Comparing ----------
     Two texts side by side where there is room, one above the other where there is not,
     with what did not change folded away. Read only. (compare.js says which two.) */

  function mountDiff(monaco, host, opts) {
    const LF = monaco.editor.EndOfLineSequence.LF;
    const a = monaco.editor.createModel(opts.before, 'luau');
    const b = monaco.editor.createModel(opts.after, 'luau');
    a.setEOL(LF);
    b.setEOL(LF);
    const diff = monaco.editor.createDiffEditor(host, Object.assign({
      theme: document.documentElement.dataset.theme === 'dark' ? 'nt-dark' : 'nt-light',
      readOnly: true,
      domReadOnly: true,
      originalEditable: false,
      automaticLayout: true,
      fontFamily: font(),
      fontLigatures: false,
      padding: { top: 14, bottom: 14 },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none',
      lineNumbersMinChars: 3,
      lineDecorationsWidth: 12,
      glyphMargin: false,
      folding: false,
      overviewRulerLanes: 0,
      overviewRulerBorder: false,
      renderOverviewRuler: false,
      enableSplitViewResizing: false,
      useInlineViewWhenSpaceIsLimited: true,
      renderSideBySideInlineBreakpoint: 760,
      ignoreTrimWhitespace: false,
      hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 4, revealLineCount: 20 },
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
      contextmenu: false,
      ariaLabel: 'Changes',
    }, look().codeOptions, tuned(true), { minimap: { enabled: false } }));
    diff.setModel({ original: a, modified: b });
    const retune = () => diff.updateOptions(tuned(true));
    NT.bus.on('editor', retune);
    // Lines added and removed, once the difference has been worked out (and again if it changes).
    const counted = diff.onDidUpdateDiff(() => {
      if (!opts.onStats) return;
      let added = 0, removed = 0;
      const changes = diff.getLineChanges() || [];
      for (const c of changes) {
        if (c.modifiedEndLineNumber > 0) added += c.modifiedEndLineNumber - c.modifiedStartLineNumber + 1;
        if (c.originalEndLineNumber > 0) removed += c.originalEndLineNumber - c.originalStartLineNumber + 1;
      }
      opts.onStats({ added, removed, changes: changes.length });
    });
    return {
      kind: 'monaco',
      next() { diff.goToDiff('next'); },
      previous() { diff.goToDiff('previous'); },
      focus() { diff.getModifiedEditor().focus(); },
      dispose() {
        NT.bus.off('editor', retune);
        counted.dispose();
        diff.dispose();
        a.dispose();
        b.dispose();
      },
    };
  }

  NT.code = {
    preload() { load().catch(() => {}); },
    // Two texts compared, in `host`: { before, after, onStats({ added, removed, changes }) }.
    // Without Monaco only `after` is shown. → { kind, next(), previous(), focus(), dispose() }
    async diff(host, opts) {
      const spinner = h('div.boot', h('div.spinner'));
      host.append(spinner);
      try {
        const monaco = await load();
        spinner.remove();
        if (!host.isConnected) return { kind: 'none', next() {}, previous() {}, focus() {}, dispose() {} };
        return mountDiff(monaco, host, opts);
      } catch (e) {
        spinner.remove();
        host.classList.add('is-basic');
        host.append(NT.luau.viewer(opts.after));
        return { kind: 'basic', next() {}, previous() {}, focus() {}, dispose() {} };
      }
    },
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
        // What macros make of each file (macro-view.js), which the language server is shown.
        if (!opts.readOnly && NT.macroView) {
          const view = NT.macroView.attach(api);
          const dispose = api.dispose;
          api.macros = view;
          api.dispose = () => { view.dispose(); dispose(); };
        }
      } catch (e) {
        spinner.remove();
        host.classList.add('is-basic');
        api = mountFallback(host, opts);
      }
      return api;
    },
  };
})();
