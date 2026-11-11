/*
  The language server, from the editor's side.

  The local server runs luau-lsp for a signed-in session and talks to it over a
  WebSocket, one JSON-RPC message per frame (ext/lsp.js states the contract). This is
  that client and its wiring into Monaco: problems as markers, completion, hovers,
  parameter hints, go to definition, references, rename and the symbol list.

    NT.lsp.available()    is there a language server to talk to?
    NT.lsp.attach(space)  start a session for a mounted editor (monaco.js); → { dispose() }
    NT.lsp.serves(model)  is a session answering for this file right now?

  The server sees a copy of the project: every file is in its mirror ($/nt/…), and
  every Luau file is also an open document, so problems are reported for all of them
  and not only the one on screen. Each edit, new file, rename and delete is passed on
  as it happens.

  All of it is optional. With no server, a refused session or a dropped connection the
  editor works as it does without one; the client comes back by itself, waiting longer
  after each failure, and sends the whole project again when it does.
*/
(function () {
  'use strict';
  const NT = window.NT;

  const ROOT = 'file:///project/';
  const DEFS = 'file:///defs/';
  const OWNER = 'luau';
  const info = () => NT.ext.info('lsp');
  const sessions = new Map(); // the name in a model's address (see monaco.js) → session
  const defs = new Map();     // definition file name → Promise of its text
  let registered = false;

  const isLuau = (path) => !/\.json$/i.test(path);
  const bytes = (text) => new TextEncoder().encode(text).length;

  // Positions count UTF-16 units from zero there and from one here.
  const toPos = (p) => ({ line: p.lineNumber - 1, character: p.column - 1 });
  const fromRange = (r) => ({ start: { line: r.startLineNumber - 1, character: r.startColumn - 1 }, end: { line: r.endLineNumber - 1, character: r.endColumn - 1 } });
  const toRange = (r) => ({ startLineNumber: r.start.line + 1, startColumn: r.start.character + 1, endLineNumber: r.end.line + 1, endColumn: r.end.character + 1 });

  function definitionText(name) {
    if (!defs.has(name)) {
      const text = fetch(NT.ext.url('/lsp/defs/' + name), { credentials: 'include' }).then((res) => {
        if (!res.ok) throw new Error('definitions unavailable');
        return res.text();
      });
      text.catch(() => defs.delete(name));
      defs.set(name, text);
    }
    return defs.get(name);
  }

  function attach(space) {
    const monaco = space.monaco;
    if (!registered) {
      registered = true;
      register(monaco);
    }
    const cap = (info().limits || {}).messageBytes || 2097152;
    const key = space.editor.getModel().uri.authority;
    const pending = new Map(); // request id → what to do with the answer
    const open = new Set();    // Luau files the server has as documents
    const writes = new Map();  // JSON file → timer of its next mirror write
    let socket = null, ready = false, gone = false, parked = false, asleep = false;
    let seq = 0, attempt = 0, retry = 0, steady = 0, resynced = 0;

    // A message over the server's cap would end the session, so it is left unsent:
    // the server then simply does not know that one file.
    function send(msg) {
      if (!socket || socket.readyState !== 1) return false;
      const text = JSON.stringify(msg);
      if (text.length * 3 > cap && bytes(text) > cap) return false;
      socket.send(text);
      return true;
    }
    const notify = (method, params) => send({ jsonrpc: '2.0', method, params });

    // → the whole answer ({ result } or { error }), or null when none will come.
    function ask(method, params, token) {
      return new Promise((resolve) => {
        const id = ++seq;
        pending.set(id, resolve);
        if (!send({ jsonrpc: '2.0', id, method, params })) {
          pending.delete(id);
          return void resolve(null);
        }
        if (token) {
          token.onCancellationRequested(() => {
            if (!pending.delete(id)) return;
            notify('$/cancelRequest', { id });
            resolve(null);
          });
        }
      });
    }
    async function request(method, params, token) {
      if (!ready) return null;
      const answer = await ask(method, params, token);
      return answer && !answer.error && answer.result != null ? answer.result : null;
    }

    const uriOf = (model) => {
      const path = space.pathOf(model);
      return path ? ROOT + path : DEFS + model.uri.path.split('/').pop();
    };
    // The model a location points into. A definition file is fetched the first time.
    async function modelOf(uri) {
      if (typeof uri !== 'string') return null;
      if (uri.startsWith(ROOT)) return space.model(decodeURIComponent(uri.slice(ROOT.length))) || null;
      const name = uri.startsWith(DEFS) ? uri.slice(DEFS.length) : '';
      if (!(info().definitions || []).includes(name)) return null;
      try { return space.doc(name, await definitionText(name)); } catch (e) { return null; }
    }

    function openDocument(path) {
      const model = space.model(path);
      const sent = notify('textDocument/didOpen', { textDocument: { uri: ROOT + path, languageId: 'luau', version: model.getVersionId(), text: space.text(path) } });
      if (sent) open.add(path);
    }
    function closeDocument(path) {
      if (open.delete(path)) notify('textDocument/didClose', { textDocument: { uri: ROOT + path } });
    }
    const write = (path) => notify('$/nt/write', { path, text: space.text(path) });

    // The whole project, in as many messages as the size cap asks for.
    function mirror() {
      const first = {}, rest = [];
      let size = 0;
      for (const path of space.paths()) {
        const cost = bytes(JSON.stringify(space.text(path))) + path.length + 8;
        if (size + cost < cap - 4096) {
          first[path] = space.text(path);
          size += cost;
        } else rest.push(path);
      }
      notify('$/nt/files', { files: first });
      rest.forEach(write);
    }

    function clearMarkers() {
      for (const path of space.paths()) monaco.editor.setModelMarkers(space.model(path), OWNER, []);
    }

    // luau-lsp does not read JSON, so it calls a require of a JSON file unknown. The
    // bundler does take those: a require that finds a JSON file here is not a problem.
    function known(model, path, d) {
      if (!/Unknown require/.test(d.message || '')) return false;
      const spec = /["'`]([^"'`]+)["'`]|\[\[(.+?)\]\]/.exec(model.getValueInRange(toRange(d.range)));
      const target = spec && NT.project.resolve(space.paths(), path, spec[1] || spec[2]);
      return !!target && !isLuau(target);
    }

    function diagnostics(p) {
      if (!p || typeof p.uri !== 'string' || !p.uri.startsWith(ROOT)) return;
      const path = decodeURIComponent(p.uri.slice(ROOT.length));
      const model = space.model(path);
      if (!model) return;
      const S = monaco.MarkerSeverity;
      monaco.editor.setModelMarkers(model, OWNER, (p.diagnostics || []).filter((d) => d && d.range && !known(model, path, d)).map((d) => Object.assign(toRange(d.range), {
        severity: [S.Error, S.Error, S.Warning, S.Info, S.Hint][d.severity] || S.Error,
        message: String(d.message || ''),
        source: d.source,
        code: d.codeDescription && d.codeDescription.href ? { value: String(d.code), target: monaco.Uri.parse(d.codeDescription.href) } : d.code != null ? String(d.code) : undefined,
        tags: d.tags,
      })));
    }

    function receive(text) {
      let msg;
      try { msg = JSON.parse(text); } catch (e) { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.method === 'textDocument/publishDiagnostics') return void diagnostics(msg.params);
      if (msg.method === '$/nt/error') return void refused(msg.params || {});
      if (msg.method || !pending.has(msg.id)) return;
      const resolve = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg);
    }

    // The server would not take something it was sent, so its copy may differ from the
    // project. Starting over puts that right; if that is refused too, it is left alone.
    function refused(p) {
      if (p.message === 'notification-not-forwarded') return;
      if (Date.now() - resynced < 30000) parked = true;
      resynced = Date.now();
      if (socket) socket.close(1000);
    }

    async function start(ws) {
      const answer = await ask('initialize', { processId: null, rootUri: 'file:///project', capabilities: {} });
      if (socket !== ws || !answer || answer.error) return;
      notify('initialized', {});
      mirror();
      for (const path of space.paths()) if (isLuau(path)) openDocument(path);
      ready = true;
      // A session that lasts has recovered; one that keeps dropping waits longer each time.
      steady = setTimeout(() => { attempt = 0; }, 10000);
    }

    function connect() {
      clearTimeout(retry);
      if (gone || parked || socket) return;
      asleep = false;
      let ws;
      try {
        ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + (info().socket || '/x/lsp'));
      } catch (e) { return; }
      socket = ws;
      ws.onopen = () => start(ws);
      ws.onmessage = (e) => { if (typeof e.data === 'string') receive(e.data); };
      ws.onclose = (e) => {
        if (socket !== ws) return;
        socket = null;
        down(e.code);
      };
    }

    function down(code) {
      ready = false;
      clearTimeout(steady);
      open.clear();
      for (const timer of writes.values()) clearTimeout(timer);
      writes.clear();
      for (const resolve of pending.values()) resolve(null);
      pending.clear();
      if (gone) return;
      clearMarkers();
      // Not signed in there, or a file the server will not take: asking again changes nothing.
      if (code === 4401 || code === 1009) parked = true;
      if (parked) return;
      // Closed for being idle: the next edit brings it back.
      if (code === 4408) asleep = true;
      if (asleep) return;
      retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) * (0.75 + Math.random() * 0.5));
    }

    const wake = () => { if (asleep) connect(); };

    // A page the browser keeps for its Back button keeps its sockets open as well, and
    // the server allows only a few sessions each: the session ends when the page is
    // left and starts again if the page is brought back.
    const onHide = () => {
      asleep = true;
      clearTimeout(retry);
      if (socket) socket.close(1000);
    };
    const onShow = (e) => { if (e.persisted) wake(); };
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);

    const offs = [
      space.on('change', (path, e) => {
        if (!ready) return void wake();
        if (!isLuau(path)) {
          clearTimeout(writes.get(path));
          writes.set(path, setTimeout(() => { writes.delete(path); write(path); }, 400));
          return;
        }
        if (!open.has(path)) return;
        notify('textDocument/didChange', {
          textDocument: { uri: ROOT + path, version: e.versionId },
          contentChanges: e.isFlush ? [{ text: space.text(path) }] : e.changes.map((c) => ({ range: fromRange(c.range), text: c.text })),
        });
      }),
      space.on('add', (path) => {
        if (!ready) return void wake();
        write(path);
        if (isLuau(path)) openDocument(path);
      }),
      space.on('remove', (path) => {
        if (!ready) return void wake();
        clearTimeout(writes.get(path));
        writes.delete(path);
        closeDocument(path);
        notify('$/nt/delete', { path });
      }),
      // The mirror's copy of an edited file is as old as the session: it moves, and is
      // then brought up to date.
      space.on('rename', (from, to) => {
        if (!ready) return void wake();
        clearTimeout(writes.get(from));
        writes.delete(from);
        closeDocument(from);
        notify('$/nt/rename', { from, to });
        write(to);
        if (isLuau(to)) openDocument(to);
      }),
      space.on('reset', () => {
        if (socket) socket.close(1000);
        else wake();
      }),
    ];

    sessions.set(key, {
      get ready() { return ready; },
      space, request, uriOf, modelOf, wake,
    });
    connect();

    return {
      dispose() {
        gone = true;
        clearTimeout(retry);
        offs.forEach((off) => off());
        window.removeEventListener('pagehide', onHide);
        window.removeEventListener('pageshow', onShow);
        sessions.delete(key);
        if (socket) socket.close(1000);
        else down(1000);
      },
    };
  }

  /* ---------- Monaco ----------
     Registered once for the language. Each call finds the session of the editor it
     came from; with none answering it returns nothing, and Monaco shows what it has. */

  function register(monaco) {
    const L = monaco.languages;
    const K = L.CompletionItemKind;
    // Kinds by the protocol's numbers (1 Text … 25 TypeParameter).
    const KINDS = [K.Text, K.Text, K.Method, K.Function, K.Constructor, K.Field, K.Variable, K.Class, K.Interface, K.Module, K.Property, K.Unit, K.Value, K.Enum, K.Keyword, K.Snippet, K.Color, K.File, K.Reference, K.Folder, K.EnumMember, K.Constant, K.Struct, K.Event, K.Operator, K.TypeParameter];

    const of = (model) => {
      const s = sessions.get(model.uri.authority);
      if (s && !s.ready) s.wake();
      return s && s.ready ? s : null;
    };
    const at = (s, model, position) => ({ textDocument: { uri: s.uriOf(model) }, position: toPos(position) });
    const prose = (d) => (!d ? undefined : typeof d === 'string' ? d : d.kind === 'markdown' ? { value: d.value } : d.language ? { value: '```' + d.language + '\n' + d.value + '\n```' } : String(d.value || ''));

    async function locations(s, result) {
      const list = Array.isArray(result) ? result : result ? [result] : [];
      const found = await Promise.all(list.map(async (loc) => {
        const model = await s.modelOf(loc.uri || loc.targetUri);
        const range = loc.range || loc.targetSelectionRange;
        return model && range ? { uri: model.uri, range: toRange(range) } : null;
      }));
      return found.filter(Boolean);
    }

    L.registerCompletionItemProvider('luau', {
      triggerCharacters: ['.', ':', '"', "'", '/'],
      async provideCompletionItems(model, position, context, token) {
        const s = of(model);
        if (!s) return null;
        const res = await s.request('textDocument/completion', Object.assign(at(s, model, position), { context: { triggerKind: context.triggerKind + 1, triggerCharacter: context.triggerCharacter } }), token);
        const items = Array.isArray(res) ? res : res && res.items;
        if (!items) return null;
        const word = model.getWordUntilPosition(position);
        const typed = { startLineNumber: position.lineNumber, startColumn: word.startColumn, endLineNumber: position.lineNumber, endColumn: word.endColumn };
        return {
          incomplete: !!res.isIncomplete,
          suggestions: items.map((it) => {
            const edit = it.textEdit;
            return {
              label: it.labelDetails ? { label: it.label, detail: it.labelDetails.detail, description: it.labelDetails.description } : it.label,
              kind: KINDS[it.kind] == null ? K.Text : KINDS[it.kind],
              detail: it.detail,
              documentation: prose(it.documentation),
              sortText: it.sortText,
              filterText: it.filterText,
              preselect: it.preselect,
              insertText: edit ? edit.newText : it.insertText || it.label,
              insertTextRules: it.insertTextFormat === 2 ? L.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
              range: !edit ? typed : edit.range ? toRange(edit.range) : { insert: toRange(edit.insert), replace: toRange(edit.replace) },
              commitCharacters: it.commitCharacters,
              additionalTextEdits: it.additionalTextEdits && it.additionalTextEdits.map((e) => ({ range: toRange(e.range), text: e.newText })),
              command: it.command && { id: it.command.command, title: it.command.title || '', arguments: it.command.arguments },
              tags: it.deprecated || (it.tags || []).includes(1) ? [L.CompletionItemTag.Deprecated] : undefined,
            };
          }),
        };
      },
    });

    L.registerHoverProvider('luau', {
      async provideHover(model, position, token) {
        const s = of(model);
        const res = s && await s.request('textDocument/hover', at(s, model, position), token);
        if (!res || !res.contents) return null;
        const contents = (Array.isArray(res.contents) ? res.contents : [res.contents]).map(prose).map((v) => (typeof v === 'string' ? { value: v } : v)).filter((v) => v && v.value);
        return contents.length ? { contents, range: res.range && toRange(res.range) } : null;
      },
    });

    L.registerSignatureHelpProvider('luau', {
      signatureHelpTriggerCharacters: ['(', ','],
      signatureHelpRetriggerCharacters: [')'],
      async provideSignatureHelp(model, position, token, context) {
        const s = of(model);
        const res = s && await s.request('textDocument/signatureHelp', Object.assign(at(s, model, position), { context: { triggerKind: context.triggerKind, triggerCharacter: context.triggerCharacter, isRetrigger: !!context.isRetrigger } }), token);
        if (!res || !res.signatures || !res.signatures.length) return null;
        return {
          value: {
            signatures: res.signatures.map((sig) => ({
              label: sig.label,
              documentation: prose(sig.documentation),
              parameters: (sig.parameters || []).map((p) => ({ label: p.label, documentation: prose(p.documentation) })),
              activeParameter: sig.activeParameter,
            })),
            activeSignature: res.activeSignature || 0,
            activeParameter: res.activeParameter || 0,
          },
          dispose() {},
        };
      },
    });

    const locate = (method, extra) => async (model, position, a, b) => {
      const s = of(model);
      if (!s) return null;
      // References are asked with a context before the token; the others with the token alone.
      const token = extra ? b : a;
      return locations(s, await s.request(method, Object.assign(at(s, model, position), extra && { context: { includeDeclaration: !!(a && a.includeDeclaration) } }), token));
    };
    L.registerDefinitionProvider('luau', { provideDefinition: locate('textDocument/definition') });
    L.registerTypeDefinitionProvider('luau', { provideTypeDefinition: locate('textDocument/typeDefinition') });
    L.registerReferenceProvider('luau', { provideReferences: locate('textDocument/references', true) });

    L.registerDocumentHighlightProvider('luau', {
      async provideDocumentHighlights(model, position, token) {
        const s = of(model);
        const res = s && await s.request('textDocument/documentHighlight', at(s, model, position), token);
        return Array.isArray(res) ? res.map((hl) => ({ range: toRange(hl.range), kind: (hl.kind || 1) - 1 })) : null;
      },
    });

    // luau-lsp has no "can this be renamed?" call, so the name under the cursor is offered as it is.
    L.registerRenameProvider('luau', {
      async provideRenameEdits(model, position, newName, token) {
        const s = of(model);
        const res = s && await s.request('textDocument/rename', Object.assign(at(s, model, position), { newName }), token);
        if (!res) return { edits: [], rejectReason: 'Can’t rename this' };
        const groups = Object.entries(res.changes || {}).concat((res.documentChanges || []).filter((c) => c.textDocument && c.edits).map((c) => [c.textDocument.uri, c.edits]));
        const edits = [];
        for (const [uri, list] of groups) {
          const target = uri.startsWith(ROOT) ? s.space.model(decodeURIComponent(uri.slice(ROOT.length))) : null;
          // A name that also lives in the game's definitions is not this project's to change.
          if (!target) return { edits: [], rejectReason: 'Defined outside the project' };
          for (const e of list) edits.push({ resource: target.uri, versionId: undefined, textEdit: { range: toRange(e.range), text: e.newText } });
        }
        return { edits };
      },
    });

    const symbol = (sym) => {
      const range = toRange(sym.range || sym.location.range);
      return {
        name: sym.name,
        detail: sym.detail || '',
        kind: (sym.kind || 13) - 1,
        tags: [],
        range,
        selectionRange: sym.selectionRange ? toRange(sym.selectionRange) : range,
        children: (sym.children || []).map(symbol),
      };
    };
    L.registerDocumentSymbolProvider('luau', {
      displayName: 'Luau',
      async provideDocumentSymbols(model, token) {
        const s = of(model);
        const res = s && await s.request('textDocument/documentSymbol', { textDocument: { uri: s.uriOf(model) } }, token);
        return Array.isArray(res) ? res.map(symbol) : null;
      },
    });
  }

  NT.lsp = {
    // A session needs the upstream sign-in, which the demo account does not have.
    available: () => !!info().available && NT.api.mode === 'live' && typeof WebSocket === 'function',
    attach,
    serves(model) {
      const s = sessions.get(model.uri.authority);
      return !!s && s.ready;
    },
  };
})();
