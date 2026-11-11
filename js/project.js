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
    NT.project.fix(paths, text)         what was typed, as the path it means
    NT.project.problem(paths, p, old)   why p cannot be a file (old: the one being renamed), or ''
    NT.project.tree(paths)              [{ name, path, kids }] with folders first; kids is null on a file
    NT.project.resolve(paths, from, s)  the file require(s) in `from` means, or null
    NT.project.load(id, content)        → { files, minify, base, built, inSync } or null
    NT.project.store(id, files, minify, base)
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
  const DEFAULTS = { maxFiles: 300, maxFileBytes: 1000000, maxBytes: 4194304, maxDepth: 8, extensions: ['.luau', '.lua', '.json'] };
  const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
  const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i; // not usable as file names on Windows

  const limits = () => DEFAULTS; // ext/core.js PROJECT
  const ext = (path) => (/\.[^./]*$/.exec(path) || [''])[0].toLowerCase();
  const folderOf = (path) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
  // Marks which text a demo bundle was, without keeping a second copy of it.
  const sum = (text) => NT.util.hash(text) + ':' + text.length;

  // The same answer ext/core.js badPath gives.
  function badPath(p) {
    const lim = limits();
    if (typeof p !== 'string' || !p || p.length > 200) return 'path';
    const parts = p.split('/');
    if (parts.length > lim.maxDepth) return 'depth';
    for (const part of parts) {
      if (!SEGMENT.test(part) || part.endsWith('.') || part.includes('..') || RESERVED.test(part)) return 'name';
    }
    if (!lim.extensions.includes(ext(p))) return 'extension';
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

  NT.project = {
    ENTRY,
    badPath,

    // More than one file needs the bundler.
    multi() {
      return !!NT.ext.info('bundle').available;
    },

    // What was typed, as a path: slashes either way, no extension means a Luau file,
    // and a folder that already exists keeps the spelling it has.
    fix(paths, text) {
      let p = String(text).trim().replace(/\\/g, '/').replace(/^\.?\/+/, '');
      if (p && !/\.[^./]+$/.test(p) && !p.endsWith('/')) p += '.luau';
      const parts = p.split('/');
      for (let i = 1; i < parts.length; i++) {
        const want = parts.slice(0, i).join('/').toLowerCase() + '/';
        const have = paths.find((x) => x.toLowerCase().startsWith(want));
        if (have) parts.splice(0, i, ...have.split('/').slice(0, i));
      }
      return parts.join('/');
    },

    problem(paths, p, old) {
      const lim = limits();
      if (!p) return 'Enter a name';
      const bad = badPath(p);
      if (bad === 'path') return 'Too long';
      if (bad === 'depth') return `At most ${lim.maxDepth} levels`;
      if (bad === 'name') {
        const part = p.split('/').find((x) => !SEGMENT.test(x) || x.endsWith('.') || x.includes('..') || RESERVED.test(x));
        if (!part) return 'Empty name';
        if (RESERVED.test(part)) return `“${part.split('.')[0]}” is reserved`;
        if (part.length > 64) return 'Too long';
        return 'Letters, digits, _ . - only';
      }
      if (bad === 'extension') return 'Ends in .luau, .lua or .json';
      const key = p.toLowerCase();
      const others = paths.filter((x) => x !== old).map((x) => x.toLowerCase());
      if (others.includes(key)) return 'Already exists';
      if (others.some((x) => x.startsWith(key + '/'))) return 'A folder has that name';
      if (others.some((x) => key.startsWith(x + '/'))) return 'A file has that name';
      if (!old && paths.length >= lim.maxFiles) return `At most ${lim.maxFiles} files`;
      return '';
    },

    tree(paths) {
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
      for (const path of paths) folder(folderOf(path)).kids.push({ name: path.slice(path.lastIndexOf('/') + 1), path, kids: null });
      const order = (a, b) => (!!b.kids - !!a.kids) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      for (const node of folders.values()) node.kids.sort(order);
      return root.kids;
    },

    // Luau's own rules, as the bundler applies them: "./" and "../" start from the
    // requiring file's folder (from that folder's parent inside an init file), "@self/"
    // from the folder itself; then the path as written, .luau, .lua, /init.luau, /init.lua.
    resolve(paths, from, spec) {
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
      const target = base.join('/');
      const tries = /\.luau?$/.test(target) ? [target] : [target, target + '.luau', target + '.lua', target + '/init.luau', target + '/init.lua'];
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

    // The sources are kept first and bundled second, so a bundle that fails loses nothing.
    // bundle: what POST /x/bundle answers ({ code, hash, fits, … }), or { error, … }.
    async store(id, files, minify, base) {
      const bundled = async () => {
        const r = await call('POST', '/bundle', { files, entry: ENTRY, minify });
        return r.status === 200 ? r.data : Object.assign({ error: 'internal' }, r.data);
      };
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
      // One write: the script is never the bundle without saying which sources it is of.
      await API.saveContent(id, bundle.code, { project: { head: { rev: base, sum: sum(bundle.code) }, body: '' } });
    },

    async remove(id) {
      if (API.mode !== 'live') return API.setDemoProject(id, null);
      for (const p of await parts(id, await API.sourcesOf(id))) await API.drop(p.id);
    },
  };
})();
