/*
  Projects: a script as a set of files.

  In the editor every script is a project: a flat map of path → text whose entry file
  is main.luau. A script of one file is a project nowhere else: that file's text is the
  script, saved as it is. With more files, the sources are kept by the local server
  (ext/projects.js; in demo mode by the in-browser store) and what the script itself
  holds is the bundle darklua makes of them (ext/bundle.js).

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
    NT.project.report(id, bundle, base) the bundle is now the script's content
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

  const limits = () => Object.assign({}, DEFAULTS, NT.ext.info('projects'));
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
  const failed = (r) => new API.StatusError(r.status, r.data.error);
  const at = (id) => '/projects/' + encodeURIComponent(id);

  NT.project = {
    ENTRY,
    badPath,

    // More than one file needs the bundler, and somewhere to keep the sources.
    multi() {
      return !!NT.ext.info('bundle').available && (API.mode !== 'live' || NT.ext.has('projects'));
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
      const r = await call('GET', at(id));
      if (r.status === 404) return null;
      if (r.status !== 200) throw failed(r);
      return { files: r.data.files, minify: r.data.minify !== false, base: r.data.updated_at, built: !!r.data.built, inSync: r.data.in_sync };
    },

    // The sources are kept first and bundled second, so a bundle that fails loses nothing.
    // bundle: what POST /x/bundle answers ({ code, hash, fits, … }), or { error, … }.
    async store(id, files, minify, base) {
      if (API.mode !== 'live') {
        await API.setDemoProject(id, { files, minify, built: false });
        const r = await call('POST', '/bundle', { files, entry: ENTRY, minify });
        return { base: null, bundle: r.status === 200 ? r.data : Object.assign({ error: 'internal' }, r.data) };
      }
      const r = await call('PUT', at(id), { files, entry: ENTRY, minify, base, bundle: true });
      if (r.status === 409) return { conflict: true, base: r.data.updated_at || null };
      if (r.status !== 200) throw failed(r);
      return { base: r.data.updated_at, bundle: r.data.bundle || { error: 'internal' } };
    },

    async report(id, bundle, base) {
      if (API.mode !== 'live') return API.setDemoProject(id, { built: true, sum: sum(bundle.code) });
      const r = await call('PATCH', at(id), { bundle_hash: bundle.hash, updated_at: base });
      if (r.status !== 200) throw failed(r);
    },

    async remove(id) {
      if (API.mode !== 'live') return API.setDemoProject(id, null);
      const r = await call('DELETE', at(id));
      if (r.status !== 200) throw failed(r);
    },
  };
})();
