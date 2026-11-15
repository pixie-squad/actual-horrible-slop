/*
  Projects: a script as a set of files.

  In the editor every script is a project: a flat map of path → text whose entry file
  is main.luau. A script of one file is a project nowhere else: that file's text is the
  script, saved as it is. With more files, what the script itself holds is the bundle
  darklua makes of them (ext/bundle.js), and the sources are kept beside it: in demo
  mode by the in-browser store, otherwise in holders: draft scripts of the author's
  own, named after the script, that the app never lists (api.js). The files are one
  text ({ files } as JSON, deflated, in base64) cut into as many parts as it takes
  to stay within a script's size. The server keeps none of it.

    <script>.meta.1   --[=[nt:sources for=<script id> rev=<when stored> of=<parts> minify=1 enc=z
    <script>.meta.2   --[=[nt:sources for=<script id> rev=<the same>
    the script        <the bundle>
                      --[=[nt:project rev=<the sources it was built from> sum=<of the bundle>

  Part 1 is written last: it says which store the parts belong to and how many there
  are, so a store that was cut short reads as unreadable, never as half a project.

  rev changes with every store and only then, strictly increasing: it is what a save
  is made against (`base`), so sources stored somewhere else in between are a
  conflict and not overwritten. The script's mark says which sources its code is the
  bundle of (`built`) and whether the code is still that bundle (`inSync`).

  This is the part without an interface: the path rules, which are the server's own
  (ext/core.js), the tree, how a require finds its file, and the calls.

    NT.project.multi()                  can a script have more than one file here?
    NT.project.fix(paths, text, folder) what was typed, as the path it means
    NT.project.problem(paths, p, old, { folder, dirs })
                                        why p cannot be a file or folder (old: the one being renamed), or ''
    NT.project.tree(paths, dirs)        [{ name, path, kids }] with folders first; kids is null on a file
                                        (dirs: folders to show that have no file in them)
    NT.project.resolve(paths, from, s)  the file require(s) in `from` means, or null
    NT.project.embed(paths, from, s, read)
                                        what #embed s in `from` reads: { path, text } or { error }
                                        (with path: the file it would be); read(path) → its text
    NT.project.load(id, content)        → { files, minify, base, built, inSync } or null
    NT.project.plain(files)             can these files be saved as the script, as typed? One
                                        file, no directive (macro.js), no library (libs.js)
    NT.project.build(files, o)          → what POST /x/bundle answers: the files with their
                                        macros expanded and the libraries they use, bundled.
                                        o: { minify, library, fresh, debug }. library: built as one
                                        (readable, its @ requires left in), and the answer
                                        carries lib, the nt:lib block with its entry's macros.
                                        debug: with DEBUG defined; { same: true } when that
                                        changes nothing
    NT.project.debug(files, o)          → what a Test run plays instead of the saved script:
                                        the files built as a save builds them (o: { minify,
                                        library }) with DEBUG defined. { code } (null when DEBUG
                                        changes nothing), or build's answer when it fails
    NT.project.DEBUG                    { DEBUG: 'true' }: macro.js's defines for it
    NT.project.store(id, files, minify, base, o)
                                        → { base, bundle } or { conflict: true, base }
    NT.project.fits(id, bundle)         is there room for this bundle in the script?
    NT.project.report(id, bundle, base) saves the bundle as the script's content
    NT.project.remove(id)
*/
(function () {
  'use strict';
  const NT = window.NT;
  const API = NT.api;

  const ENTRY = 'main.luau';
  // Defined in what a Test run plays, and in the editor (macro-view.js); never in the
  // saved script.
  const DEBUG = Object.freeze({ DEBUG: 'true' });
  const DEFAULTS = { maxFiles: 300, maxFileBytes: 1000000, maxBytes: 4194304, maxDepth: 8, extensions: ['.luau', '.lua', '.json', '.csv', '.txt'] };
  const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
  const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i; // not usable as file names on Windows

  const limits = () => DEFAULTS; // ext/core.js PROJECT
  const ext = (path) => (/\.[^./]*$/.exec(path) || [''])[0].toLowerCase();
  const folderOf = (path) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
  // Marks which text a demo bundle was, without keeping a second copy of it.
  const sum = (text) => NT.util.hash(text) + ':' + text.length;

  // The same answer ext/core.js badPath gives. A folder has no extension to check, and
  // has to leave a level for the file that makes it real.
  function badPath(p, folder) {
    const lim = limits();
    if (typeof p !== 'string' || !p || p.length > 200) return 'path';
    const parts = p.split('/');
    if (parts.length > lim.maxDepth - (folder ? 1 : 0)) return 'depth';
    for (const part of parts) {
      if (!SEGMENT.test(part) || part.endsWith('.') || part.includes('..') || RESERVED.test(part)) return 'name';
    }
    if (!folder && !lim.extensions.includes(ext(p))) return 'extension';
    return null;
  }

  async function call(method, path, body) {
    const init = { method, credentials: 'include', headers: {} };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(NT.ext.url(path), init);
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body, or not JSON */ }
    return { status: res.status, data: data || {} };
  }
  const Pack = NT.pack;

  // The base64 one part carries.
  const CHUNK = Math.floor(Pack.holds(Pack.LIMIT) / 3) * 4;

  // The holders named for a script that are its own: [{ n, id, block }], by part.
  async function parts(id, where) {
    const mine = [];
    for (const p of where ? where.parts : []) {
      let b = null;
      try { b = (await API.blocks(p.id)).blocks.sources; } catch (e) {
        if (!e || e.status !== 404) throw e;
      }
      if (b && b.head.for === id && !mine.some((m) => m.n === p.n)) mine.push({ n: p.n, id: p.id, block: b });
    }
    return mine;
  }

  // What those parts hold: { files, minify, rev }; null when there is no part 1.
  // Files that cannot be read back are an error, never "no project": the editor must
  // not start from nothing and save over them.
  async function read(mine) {
    const first = mine.find((p) => p.n === 1);
    if (!first) return null;
    const head = first.block.head;
    let body = first.block.body;
    for (let n = 2; n <= (Number(head.of) || 1); n++) {
      const next = mine.find((p) => p.n === n);
      if (!next || next.block.head.rev !== head.rev) throw new Error('unreadable');
      body += next.block.body;
    }
    const bytes = Pack.bytes({ body });
    const data = bytes && JSON.parse(await Pack.expand(bytes, head.enc));
    const files = data && data.files;
    if (!files || typeof files !== 'object' || Object.keys(files).some((p) => typeof files[p] !== 'string')) throw new Error('unreadable');
    return { files, minify: head.minify !== '0', rev: head.rev || null };
  }

  // Later than the last one even if the clock stepped back.
  function stamp(last) {
    const t = last ? Date.parse(last) : NaN;
    return new Date(Number.isFinite(t) ? Math.max(Date.now(), t + 1) : Date.now()).toISOString();
  }

  /* ---------- Building ---------- */

  const isLuau = (path) => /\.luau?$/i.test(path);
  const isData = (path) => /\.(csv|txt)$/i.test(path);
  const byLine = (a, b) => (a.line || 0) - (b.line || 0);

  // The path a require or #embed of spec in `from` names, before any extension is
  // tried: "./" and "../" from the file's folder (in an init file, its parent's), "@self/"
  // from its own. Null when it names nothing in the project.
  function target(from, spec) {
    let base = folderOf(from).split('/').filter(Boolean);
    let rest;
    if (spec.startsWith('@self/')) rest = spec.slice(6);
    else if (spec.startsWith('./') || spec.startsWith('../')) {
      rest = spec;
      if (/^init\.luau?$/.test(from.slice(from.lastIndexOf('/') + 1))) base = base.slice(0, -1);
    } else return null;
    for (const part of rest.split('/')) {
      if (part === '..') {
        if (!base.length) return null;
        base.pop();
      } else if (part && part !== '.') base.push(part);
    }
    return base.join('/');
  }

  // What #embed "spec" in `from` reads: { path, text }, or { error } (with the path it
  // would be, where there is one). The path is written as a require's is, but names the
  // file exactly.
  function embedTarget(paths, from, spec, text) {
    const wanted = target(from, spec);
    if (wanted === null) return { error: /^\.\.?\/|^@self\//.test(spec) ? `"${spec}" is outside the project` : `"${spec}" starts with ./ or ../, from this file’s folder` };
    return paths.includes(wanted) ? { path: wanted, text: text(wanted) } : { error: `cannot find "${spec}"`, path: wanted };
  }

  // Where a library is first named in the files, for a problem with it to be marked at.
  function namedAt(files, spec) {
    for (const [path, text] of Object.entries(files)) {
      if (!isLuau(path)) continue;
      const i = text.indexOf(spec);
      if (i < 0) continue;
      const before = text.slice(0, i);
      const line = before.split('\n').length;
      return { path, line, column: i - before.lastIndexOf('\n') };
    }
    return { path: ENTRY, line: null, column: null };
  }

  async function build(files, o = {}) {
    const found = NT.libs.available() ? await NT.libs.resolve(NT.libs.specs(files), { fresh: o.fresh }) : { libs: {}, problems: {} };
    const { libs, problems } = found;
    const paths = Object.keys(files);
    const theirs = new Map(); // spec → its macros
    // The files with their macros expanded, with these predefined: { out, diagnostics, run }.
    const expand = (defines) => {
      const done = new Map(); // path → what macro.js made of it
      const open = [];
      const run = (path) => {
        if (done.has(path)) return done.get(path);
        open.push(path);
        const r = NT.macro.process(files[path], {
          path,
          defines,
          embed: (spec, from) => embedTarget(paths, from || path, spec, (p) => files[p]),
          include(spec, from) {
            if (spec[0] === '@') {
              if (!libs[spec]) return { error: problems[spec] || `cannot find library "${spec}"` };
              if (!theirs.has(spec)) theirs.set(spec, NT.macro.process(libs[spec].macros, { path: spec }).macros);
              return { macros: theirs.get(spec) };
            }
            const target = NT.project.resolve(paths, from || path, spec);
            if (!target || !isLuau(target)) return { error: `cannot find "${spec}"` };
            if (open.includes(target)) return { error: 'include cycle: ' + open.slice(open.indexOf(target)).concat(target).join(' → ') };
            return { macros: run(target).macros };
          },
        });
        open.pop();
        done.set(path, r);
        return r;
      };
      const out = {}, diagnostics = [];
      for (const path of paths) {
        // Data that #embed has written into the code already: darklua has no use for it.
        if (isData(path)) continue;
        if (!isLuau(path)) { out[path] = files[path]; continue; }
        const r = run(path);
        out[path] = r.text;
        for (const d of r.diagnostics) if (d.severity === 'error') diagnostics.push({ path, line: d.line, column: d.column, message: d.message });
      }
      return { out, diagnostics, run };
    };
    const made = expand(o.debug ? DEBUG : undefined);
    // Where DEBUG changes nothing, the saved script is what a Test run plays.
    if (o.debug && !made.diagnostics.length) {
      const plain = expand().out;
      if (Object.keys(plain).every((p) => plain[p] === made.out[p])) return { same: true };
    }
    const { out, diagnostics, run } = made;
    // Libraries asked for by require alone have not been through an include.
    for (const [spec, words] of Object.entries(problems)) {
      if (!diagnostics.some((d) => d.message.includes(spec))) diagnostics.push(Object.assign(namedAt(files, spec), { message: `${spec}: ${words}` }));
    }
    // A library required for its code has to hand some back.
    const wanted = new Set(NT.libs.required(files));
    for (const spec of Object.keys(libs)) for (const next of NT.libs.required({ 'lib.luau': libs[spec].code })) wanted.add(next);
    for (const spec of wanted) {
      const lib = libs[spec];
      if (!lib || NT.libs.returns(lib.code)) continue;
      const how = lib.macros.trim() ? `; #include "${spec}" for its macros` : '';
      diagnostics.push(Object.assign(namedAt(files, spec), { message: `${spec} returns nothing to require${how}` }));
    }
    // A library itself: it is used for what it returns, or for its macros.
    if (o.library && isLuau(ENTRY) && files[ENTRY] != null && !NT.libs.returns(out[ENTRY]) && !run(ENTRY).macros.size) {
      const lines = files[ENTRY].split('\n').length;
      diagnostics.push({ path: ENTRY, line: lines, column: 1, message: 'a library returns its module (end with return …) or defines macros' });
    }
    if (diagnostics.length) return { error: 'bundle-failed', diagnostics: diagnostics.sort(byLine).slice(0, 50) };
    const code = {};
    if (!o.library) for (const spec of Object.keys(libs)) code[spec] = libs[spec].code;
    const r = await call('POST', '/bundle', { files: out, entry: ENTRY, minify: o.library ? false : o.minify !== false, libs: code, external: !!o.library });
    const answer = r.status === 200 ? r.data : Object.assign({ error: 'internal' }, r.data);
    // What went wrong inside a library is marked where the project names it.
    if (Array.isArray(answer.diagnostics)) {
      answer.diagnostics = answer.diagnostics.map((d) => (d.path && d.path[0] === '@' ? Object.assign({}, d, namedAt(files, d.path), { message: `${d.path}: ${d.message}` }) : d));
    }
    if (o.library && answer.code != null) answer.lib = NT.libs.block(NT.macro.serialize(run(ENTRY).macros));
    answer.libs = Object.keys(libs).map((spec) => ({ spec, id: libs[spec].id }));
    return answer;
  }

  NT.project = {
    ENTRY,
    badPath,
    embed: embedTarget,
    DEBUG,

    // More than one file needs the bundler.
    multi() {
      return !!NT.ext.info('bundle').available;
    },

    // What was typed, as a path: slashes either way, no extension means a Luau file,
    // and a folder that already exists keeps the spelling it has.
    // `folder`: a folder's path, which gets no extension.
    fix(paths, text, folder) {
      let p = String(text).trim().replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, folder ? '' : '/');
      if (!folder && p && !/\.[^./]+$/.test(p) && !p.endsWith('/')) p += '.luau';
      const parts = p.split('/');
      for (let i = 1; i < parts.length + (folder ? 1 : 0); i++) {
        const want = parts.slice(0, i).join('/').toLowerCase() + '/';
        const have = paths.find((x) => x.toLowerCase().startsWith(want));
        if (have) parts.splice(0, i, ...have.split('/').slice(0, i));
      }
      return parts.join('/');
    },

    // o.folder: p (and old) is a folder; o.dirs: folders that have no file in them yet.
    problem(paths, p, old, o = {}) {
      const lim = limits();
      if (!p) return 'Enter a name';
      const bad = badPath(p, o.folder);
      if (bad === 'path') return 'Too long';
      if (bad === 'depth') return `At most ${lim.maxDepth} levels`;
      if (bad === 'name') {
        const part = p.split('/').find((x) => !SEGMENT.test(x) || x.endsWith('.') || x.includes('..') || RESERVED.test(x));
        if (!part) return 'Empty name';
        if (RESERVED.test(part)) return `“${part.split('.')[0]}” is reserved`;
        if (part.length > 64) return 'Too long';
        return 'Letters, digits, _ . - only';
      }
      if (bad === 'extension') return 'Ends in .luau, .lua, .json, .csv or .txt';
      const key = p.toLowerCase();
      const was = old == null ? null : old.toLowerCase();
      // What is being renamed is not in its own way; a folder takes what is in it along.
      const apart = (x) => was == null || (o.folder ? x !== was && !x.startsWith(was + '/') : x !== was);
      if (o.folder && was != null && key.startsWith(was + '/')) return 'Can’t go inside itself';
      const files = paths.map((x) => x.toLowerCase()).filter(apart);
      const folders = new Set();
      for (const x of files.concat((o.dirs || []).map((d) => d.toLowerCase() + '/').filter((d) => apart(d.slice(0, -1))))) {
        for (let i = x.indexOf('/'); i > 0; i = x.indexOf('/', i + 1)) folders.add(x.slice(0, i));
      }
      if (files.includes(key)) return o.folder ? 'A file has that name' : 'Already exists';
      if (folders.has(key)) return o.folder ? 'Already exists' : 'A folder has that name';
      if (files.some((x) => key.startsWith(x + '/'))) return 'A file has that name';
      if (!o.folder && old == null && paths.length >= lim.maxFiles) return `At most ${lim.maxFiles} files`;
      return '';
    },

    // dirs: folders to show although no file is in them.
    tree(paths, dirs) {
      const root = { kids: [] };
      const folders = new Map([['', root]]);
      const folder = (path) => {
        if (!folders.has(path)) {
          const node = { name: path.slice(path.lastIndexOf('/') + 1), path, kids: [] };
          folders.set(path, node);
          folder(folderOf(path)).kids.push(node);
        }
        return folders.get(path);
      };
      for (const path of dirs || []) folder(path);
      for (const path of paths) folder(folderOf(path)).kids.push({ name: path.slice(path.lastIndexOf('/') + 1), path, kids: null });
      const order = (a, b) => (!!b.kids - !!a.kids) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      for (const node of folders.values()) node.kids.sort(order);
      return root.kids;
    },

    // Luau's own rules, as the bundler applies them: "./" and "../" start from the
    // requiring file's folder (from that folder's parent inside an init file), "@self/"
    // from the folder itself; then the path as written, .luau, .lua, /init.luau, /init.lua.
    resolve(paths, from, spec) {
      const t = target(from, spec);
      if (t === null) return null;
      const tries = /\.luau?$/.test(t) ? [t] : [t, t + '.luau', t + '.lua', t + '/init.luau', t + '/init.lua'];
      return tries.find((p) => paths.includes(p)) || null;
    },

    async load(id, content) {
      if (API.mode !== 'live') {
        const p = await API.demoProject(id);
        return p && { files: p.files, minify: p.minify !== false, base: null, built: !!p.built, inSync: p.sum == null ? null : p.sum === sum(content) };
      }
      // `content` was just read through API.scriptContent, which kept the script's mark.
      const where = await API.sourcesOf(id);
      const p = where && (await read(await parts(id, where)));
      if (!p) return null;
      const mark = API.extra(id, 'project');
      return {
        files: p.files,
        minify: p.minify,
        base: p.rev,
        built: !!mark && mark.head.rev === p.rev,
        inSync: mark ? mark.head.sum === sum(content) : null,
      };
    },

    plain(files) {
      const paths = Object.keys(files);
      if (paths.length !== 1) return false;
      if (!this.multi()) return true;
      return !NT.macro.uses(files[paths[0]]) && !NT.libs.specs(files).length;
    },
    build,
    async debug(files, o = {}) {
      // Saved as typed, so played as typed: only what DEBUG itself makes of it.
      if (this.plain(files)) {
        const r = NT.macro.process(files[ENTRY], { path: ENTRY, defines: DEBUG });
        return { code: r.plain ? null : r.text };
      }
      const b = await build(files, { minify: o.minify, library: o.library, debug: true });
      return b.same ? { code: null } : b;
    },
    // The sources are kept first and bundled second, so a bundle that fails loses nothing.
    // bundle: what POST /x/bundle answers ({ code, hash, fits, … }), or { error, … }.
    async store(id, files, minify, base, o = {}) {
      const bundled = () => build(files, { minify, library: o.library, fresh: o.fresh });
      if (API.mode !== 'live') {
        await API.setDemoProject(id, { files, minify, built: false });
        return { base: null, bundle: await bundled() };
      }
      const where = await API.sourcesOf(id);
      if (!where) throw new Error('not-found');
      const mine = await parts(id, where);
      const old = await read(mine).catch(() => null);
      const seen = old ? old.rev : null;
      if (base !== undefined && base !== seen) return { conflict: true, base: seen };
      const rev = stamp(seen);
      const { bytes, enc } = await Pack.squeeze(JSON.stringify({ files }));
      const body = Pack.block({}, bytes).body;
      const count = Math.max(1, Math.ceil(body.length / CHUNK));
      for (let n = count; n >= 1; n--) {
        const head = n === 1 ? { for: id, rev, of: String(count), minify: minify ? '1' : '0', enc } : { for: id, rev };
        const had = mine.find((p) => p.n === n);
        const content = Pack.join('', { sources: { head, body: body.slice((n - 1) * CHUNK, n * CHUNK) } });
        await API.hold(had ? had.id : null, { name: API.partName(where.base, n), content });
      }
      for (const p of mine) if (p.n > count) await API.drop(p.id).catch(() => {});
      return { base: rev, bundle: await bundled() };
    },

    // A bundle has to leave room for what else the script carries (its project mark).
    fits(id, bundle) {
      return !!bundle.fits && (API.mode !== 'live' || Math.max(bundle.bytes, bundle.chars) <= API.room(id));
    },

    async report(id, bundle, base) {
      if (API.mode !== 'live') {
        await API.saveContent(id, bundle.code);
        return API.setDemoProject(id, { built: true, sum: sum(bundle.code) });
      }
      // One write: the script is never the bundle without saying which sources it is of,
      // nor a library's code without its macros.
      await API.saveContent(id, bundle.code, { project: { head: { rev: base, sum: sum(bundle.code) }, body: '' }, lib: bundle.lib || null });
    },

    async remove(id) {
      if (API.mode !== 'live') return API.setDemoProject(id, null);
      for (const p of await parts(id, await API.sourcesOf(id))) await API.drop(p.id);
    },
  };
})();
