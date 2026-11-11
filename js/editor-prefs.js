/*
  How the editor behaves: what someone has set, kept in this browser (nt.editor).

    NT.editorPrefs.data          every setting, with what was left alone at its default
    NT.editorPrefs.set(patch)    change some; whoever listens to 'editor' on NT.bus hears it
    NT.editorPrefs.reset()       back to the defaults
    NT.editorPrefs.changed()     is anything not at its default?
    NT.editorPrefs.server()      the part the language server is told (ext/lsp.js, $/nt/settings)

  They are apart from the appearance settings (NT.prefs): changing one of those restyles
  the whole app, and nothing here needs that.
*/
(function () {
  'use strict';
  const NT = window.NT;
  const { store } = NT.util;
  const KEY = 'nt.editor';

  // Each setting with the values it can take; the first is the default.
  const CHOICES = {
    // Editing
    closeBlocks: [true, false],      // an opened block gets its "end"
    closeBrackets: [true, false],
    closeQuotes: [true, false],
    suggest: [true, false],          // suggestions come up while typing
    // Enter takes the suggestion: only when that changes the text (so "then", typed
    // out and offered again, gets its new line), always, or never.
    acceptEnter: ['smart', 'on', 'off'],
    spaces: [false, true],           // indent with spaces, not tabs
    tabSize: [4, 2, 3, 8],
    detectIndent: [true, false],     // a file that is already indented keeps its own way
    autosave: [true, false],
    // Display
    fontSize: [13, 11, 12, 14, 15, 16, 18, 20],
    wrap: [false, true],
    lineNumbers: ['on', 'relative', 'off'],
    minimap: [false, true],
    sticky: [false, true],           // the block being read stays at the top
    whitespace: [false, true],
    guides: [true, false],
    bracketColors: [false, true],
    smoothCaret: [true, false],
    // Language server
    mode: ['nonstrict', 'strict', 'nocheck'],
    signatures: [true, false],       // parameter hints while a call is typed
    parens: [true, false],           // a completed function gets its parentheses
    fillArgs: [true, false],         // … and its arguments, as placeholders
    hintNames: ['none', 'literals', 'all'],
    hintVars: [false, true],
    hintParams: [false, true],
    hintReturns: [false, true],
  };

  // The linter's rules, as it names them in a problem ("LocalUnused: …"). All are on
  // until turned off; data.lint holds the ones that are off.
  const LINTS = ['UnknownGlobal', 'DeprecatedGlobal', 'GlobalUsedAsLocal', 'LocalShadow', 'SameLineStatement', 'MultiLineStatement', 'LocalUnused', 'FunctionUnused', 'ImportUnused', 'BuiltinGlobalWrite', 'PlaceholderRead', 'UnreachableCode', 'UnknownType', 'ForRange', 'UnbalancedAssignment', 'ImplicitReturn', 'DuplicateLocal', 'FormatString', 'TableLiteral', 'UninitializedLocal', 'DuplicateFunction', 'DeprecatedApi', 'TableOperations', 'DuplicateCondition', 'MisleadingAndOr', 'CommentDirective', 'IntegerParsing', 'ComparisonPrecedence', 'RedundantNativeAttribute'];

  const defaults = () => {
    const d = { lint: {} };
    for (const k of Object.keys(CHOICES)) d[k] = CHOICES[k][0];
    return d;
  };

  // Only what is known and allowed is taken from storage: a value from an older
  // version, or one someone typed in, falls back to the default.
  function clean(saved) {
    const d = defaults();
    if (!saved || typeof saved !== 'object') return d;
    for (const k of Object.keys(CHOICES)) if (CHOICES[k].includes(saved[k])) d[k] = saved[k];
    if (saved.lint && typeof saved.lint === 'object') {
      for (const name of LINTS) if (saved.lint[name] === false) d.lint[name] = false;
    }
    return d;
  }

  NT.editorPrefs = {
    CHOICES,
    LINTS,
    data: clean(store.get(KEY, null)),
    set(patch) {
      this.data = clean(Object.assign({}, this.data, patch));
      store.set(KEY, this.data);
      NT.bus.emit('editor', this.data);
    },
    reset() {
      this.data = defaults();
      store.remove(KEY);
      NT.bus.emit('editor', this.data);
    },
    changed() {
      const d = this.data;
      return Object.keys(CHOICES).some((k) => d[k] !== CHOICES[k][0]) || Object.keys(d.lint).length > 0;
    },
    hints() {
      const d = this.data;
      return d.hintNames !== 'none' || d.hintVars || d.hintParams || d.hintReturns;
    },
    server() {
      const d = this.data;
      return {
        mode: d.mode,
        lint: Object.assign({}, d.lint),
        completion: { addParentheses: d.parens, fillCallArguments: d.fillArgs },
        inlayHints: { parameterNames: d.hintNames, variableTypes: d.hintVars, parameterTypes: d.hintParams, functionReturnTypes: d.hintReturns },
      };
    },
  };
})();
