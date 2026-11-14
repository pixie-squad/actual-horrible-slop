/*
  Libraries: published scripts that other scripts use by their author's username and
  their name.

    require("@pixie/vec")     its code, built into the script that requires it
    #include "@pixie/vec"     its macros (macro.js)

  A script is a library when it is published and its text carries an nt:lib block
  (pack.js), which its owner turns on in Details. A library is used as its text is now,
  as anyone reads a published script's source: the code, built readable with its types
  and its own @ requires left in, and in the block the macros its entry file ends with,
  as #define lines. Every build reads it again, so a save of the library reaches the
  scripts that use it with their next save. (Not its releases: the service makes those
  only when a draft is first published.)

    NT.libs.available()                 there is a service to find libraries on (live only)
    NT.libs.specs(files)                → [spec] each "@user/name" the project's Luau files
                                          require or #include, in order of appearance
    NT.libs.resolve(specs, { fresh })   → Promise of { libs: { spec: lib }, problems: { spec:
                                          words } }, with the libraries those need in turn.
                                          A lib: { spec, code, macros (text), id, at }.
                                          What was found is kept a minute, unless fresh
    NT.libs.block(macros)               → the nt:lib block that makes a script a library
    NT.libs.macros(block)               → the #define lines a library's block holds
    NT.libs.is(script)                  → Promise of true when it is a library (kept in this
                                          browser a while, by script and its updated_at)
    NT.libs.forget(id)                  what was known of that script: it changed here
    NT.libs.required(files)             → [spec] the libraries a project's code requires (its
                                          code is needed, not only its macros)
    NT.libs.returns(code)               does the code end by returning something (a module)?
    NT.libs.list(scripts, onFound)      → Promise of the published libraries among scripts;
                                          onFound(script) as each is found
    NT.libs.spec(script)                → Promise of "@username/name"
    NT.libs.problem(name)               → why a script of that name cannot be a library, or ''
*/
(function () {
  'use strict';
  const NT = window.NT;
  const API = NT.api;
  const Pack = NT.pack;

  const SPEC = /^@([A-Za-z0-9_.-]{1,64})\/([A-Za-z0-9 _.-]{1,64})$/;
  const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;
  const KEEP = 60000;
  const SEEN_KEY = 'nt.libs.v2';
  const SEEN_FOR = 30 * 60000; // a verdict is asked again after this
  const SEEN_MAX = 2000;
  const isLuau = (path) => /\.luau?$/i.test(path);

  function problem(name) {
    const n = String(name || '');
    if (!/^[A-Za-z0-9_.-][A-Za-z0-9 _.-]*$/.test(n)) return 'Letters, digits, spaces, _ . - only';
    if (/[ .]$/.test(n)) return 'Can’t end in a space or a dot';
    if (n === '.' || n === '..' || RESERVED.test(n)) return `“${n}” is reserved`;
    return '';
  }
  // The server's own rule (ext/core.js libSpec): a user named self would be @self/, which
  // means something else, and a name ending in a dot is the same file as without it.
  const okSpec = (spec) => {
    const m = SPEC.exec(spec);
    return !!m && !m[1].endsWith('.') && !/^self$/i.test(m[1]) && !RESERVED.test(m[1].trim()) && !problem(m[2]) && !RESERVED.test(m[2].trim());
  };

  /* ---------- What a project asks for ---------- */

  // The string at i: [body, end], for '…', "…" and [=[…]=]; null otherwise.
  function literal(src, i) {
    const c = src[i];
    if (c === '"' || c === "'") {
      for (let j = i + 1; j < src.length; j++) {
        if (src[j] === '\\') j++;
        else if (src[j] === c) return [src.slice(i + 1, j), j + 1];
        else if (src[j] === '\n') return null;
      }
      return null;
    }
    if (c === '[') {
      let j = i + 1;
      while (src[j] === '=') j++;
      if (src[j] !== '[') return null;
      const close = ']' + '='.repeat(j - i - 1) + ']';
      const end = src.indexOf(close, j + 1);
      return end < 0 ? null : [src.slice(j + 1, end), end + close.length];
    }
    return null;
  }

  // Every require("@…") in Luau code; strings and comments are skipped.
  function required(src, out) {
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '-' && src[i + 1] === '-') {
        const long = src[i + 2] === '[' ? literal(src, i + 2) : null;
        if (long) i = long[1];
        else {
          const nl = src.indexOf('\n', i);
          i = nl < 0 ? src.length : nl;
        }
      } else if (c === '"' || c === "'" || (c === '[' && /^\[=*\[/.test(src.slice(i, i + 66)))) {
        const lit = literal(src, i);
        i = lit ? lit[1] : i + 1;
      } else if (c === '`') {
        // An interpolated string: no require is written inside one.
        const end = src.indexOf('`', i + 1);
        i = end < 0 ? src.length : end + 1;
      } else if (c === 'r' && src.startsWith('require', i) && !/[\w.:]/.test(src[i - 1] || '') && !/\w/.test(src[i + 7] || '')) {
        let j = i + 7;
        while (/\s/.test(src[j] || '')) j++;
        if (src[j] === '(') {
          j++;
          while (/\s/.test(src[j] || '')) j++;
        }
        const lit = literal(src, j);
        if (lit && lit[0][0] === '@' && !lit[0].startsWith('@self/')) out.push(lit[0]);
        i = j;
      } else i++;
    }
  }

  function requiredBy(files) {
    const out = [];
    for (const [path, text] of Object.entries(files)) if (isLuau(path) && typeof text === 'string' && text.includes('require')) required(text, out);
    return [...new Set(out)];
  }

  // Its last statement at the top level is a return with a value. Strings and comments
  // are skipped; an if that stands for a value (x = if a then b else c) has no end.
  const OPS = ['...', '..=', '//=', '..', '//', '==', '~=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '^=', '::', '->'];
  const VALUE_AFTER = new Set(['=', '(', ',', '{', '[', 'return', 'and', 'or', 'not', '..', '+', '-', '*', '/', '//', '%', '^', '#', '==', '~=', '<', '>', '<=', '>=', 'in', '::', '+=', '-=', '*=', '/=', '%=', '^=', '..=', '//=']);
  function returns(src) {
    let depth = 0, prev = '', after = false, value = false, i = 0;
    const take = (t) => {
      if (after && depth === 0 && t !== ';') value = true;
      if (t === 'function' || t === 'do' || t === 'repeat' || (t === 'if' && !VALUE_AFTER.has(prev))) depth++;
      else if (t === 'end' || t === 'until') depth = Math.max(0, depth - 1);
      else if (t === 'return' && depth === 0) { after = true; value = false; }
      prev = t;
    };
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '-' && src[i + 1] === '-') {
        const long = src[i + 2] === '[' ? literal(src, i + 2) : null;
        if (long) i = long[1];
        else { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl; }
        continue;
      }
      if (c === '"' || c === "'" || (c === '[' && /^\[=*\[/.test(src.slice(i, i + 66)))) {
        const lit = literal(src, i);
        i = lit ? lit[1] : i + 1;
        take('"');
        continue;
      }
      if (c === '`') {
        const end = src.indexOf('`', i + 1);
        i = end < 0 ? src.length : end + 1;
        take('"');
        continue;
      }
      const word = /^[A-Za-z_]\w*|^\d[\w.]*/.exec(src.slice(i, i + 256));
      if (word) { take(word[0]); i += word[0].length; continue; }
      const op = OPS.find((o) => src.startsWith(o, i)) || c;
      take(op);
      i += op.length;
    }
    return value;
  }

  function specs(files) {
    const out = [];
    for (const [path, text] of Object.entries(files)) {
      if (!isLuau(path) || typeof text !== 'string') continue;
      if (text.includes('require')) required(text, out);
      if (text.includes('#') && NT.macro) for (const inc of NT.macro.includes(text)) if (inc.spec[0] === '@') out.push(inc.spec);
    }
    return [...new Set(out)];
  }

  /* ---------- Finding them ---------- */

  const decode = (block) => {
    const bytes = block && Pack.bytes(block);
    return bytes ? new TextDecoder().decode(bytes) : '';
  };
  const recent = (a, b) => new Date(b.updated_at) - new Date(a.updated_at);

  // A script's text as it is now: its code and its block. → { code, block } or null.
  async function current(id) {
    const r = await API.peek(id);
    return r && typeof r.content === 'string' ? { code: r.content, block: r.blocks && r.blocks.lib } : null;
  }

  const found = new Map(); // spec → { at, promise }
  function one(spec, fresh) {
    const had = found.get(spec);
    if (had && !fresh && Date.now() - had.at < KEEP) return had.promise;
    const promise = (async () => {
      if (!okSpec(spec)) throw new Error(`“${spec}” is not a library name`);
      const [, user, name] = SPEC.exec(spec);
      let list;
      try { list = await API.userScripts('@' + user); } catch (e) {
        if (e && e.status === 404) throw new Error(`no user @${user}`);
        throw e;
      }
      const same = (list || []).filter((s) => s.name === name && s.published_at).sort(recent);
      if (!same.length) throw new Error(`@${user} has no published script “${name}”`);
      for (const s of same) {
        const r = await current(s.script_id);
        if (r && r.block) return { spec, code: r.code, macros: decode(r.block), id: s.script_id, at: NT.util.hash(r.code + '\0' + r.block.body) };
      }
      throw new Error(`@${user}/${name} is not a library`);
    })();
    found.set(spec, { at: Date.now(), promise });
    // A failure is asked again next time.
    promise.catch(() => found.delete(spec));
    return promise;
  }

  async function resolve(wanted, o = {}) {
    const libs = {}, problems = {};
    const queue = [...new Set(wanted)];
    const asked = new Set(queue);
    while (queue.length) {
      const batch = queue.splice(0, 4);
      await Promise.all(batch.map(async (spec) => {
        try {
          const lib = await one(spec, o.fresh);
          libs[spec] = lib;
          for (const next of specs({ 'lib.luau': lib.code })) {
            if (!asked.has(next)) {
              asked.add(next);
              queue.push(next);
            }
          }
        } catch (e) {
          problems[spec] = NT.api.unreachable && NT.api.unreachable(e) ? 'the service didn’t answer' : String((e && e.message) || 'not found');
        }
      }));
    }
    return { libs, problems };
  }

  /* ---------- Which scripts are libraries ---------- */

  const seen = () => NT.util.store.get(SEEN_KEY, {}) || {};
  function remember(id, at, lib) {
    const all = seen();
    all[id] = { at, lib, t: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > SEEN_MAX) for (const k of keys.slice(0, keys.length - SEEN_MAX)) delete all[k];
    NT.util.store.set(SEEN_KEY, all);
  }

  async function is(script) {
    if (!script || !script.published_at) return false;
    const known = seen()[script.script_id];
    if (known && known.at === script.updated_at && Date.now() - known.t < SEEN_FOR) return known.lib;
    const r = await current(script.script_id);
    const lib = !!(r && r.block);
    remember(script.script_id, script.updated_at, lib);
    return lib;
  }

  async function list(scripts, onFound) {
    const out = [];
    const todo = (scripts || []).filter((s) => s.published_at);
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const s = todo[next++];
        try {
          if (await is(s)) {
            out.push(s);
            if (onFound) onFound(s);
          }
        } catch (e) { /* that one is left out */ }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return out;
  }

  const names = new Map(); // author id → Promise of username
  function spec(script) {
    if (!names.has(script.author_uuid)) {
      const p = API.user(script.author_uuid).then((u) => u.username);
      p.catch(() => names.delete(script.author_uuid));
      names.set(script.author_uuid, p);
    }
    return names.get(script.author_uuid).then((user) => `@${user}/${script.name}`);
  }

  NT.libs = {
    SPEC,
    available: () => API.mode === 'live',
    specs,
    resolve,
    required: requiredBy,
    returns,
    forget(id) {
      const all = seen();
      delete all[id];
      NT.util.store.set(SEEN_KEY, all);
      found.clear();
    },
    block: (macros) => Pack.block({ v: '1' }, new TextEncoder().encode(macros || '')),
    macros: decode,
    is,
    list,
    spec,
    problem,
    okSpec,
  };
})();
