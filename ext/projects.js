/*
  Projects: the source files a script is bundled from (see ext/bundle.js).

  The upstream service keeps one script per id; this server keeps its project, one
  JSON file per script under projects/. Only the script's author may read or change it.

    GET    /x/projects/<id>
      → { files, entry, minify, updated_at, bundle_hash, built, in_sync }   404 not-found
    PUT    /x/projects/<id>   { files, entry?, minify?: true, base?, bundle?: false }
      → { updated_at, bundle? }                                            409 conflict
    PATCH  /x/projects/<id>   { bundle_hash, updated_at } → { bundle_hash, built, updated_at }
    DELETE /x/projects/<id>   → { deleted }

  updated_at changes with every PUT and only then, strictly increasing per project.
  base is the updated_at the client last saw (null: it saw no project). When given and
  not what is stored, nothing is written: 409 { error: "conflict", updated_at }.
  With bundle: true the sources are stored first and then bundled; bundle is the 200
  answer of /x/bundle, or { error, … } (bundle-failed, busy, slow-down, unavailable).
  The client saves the code upstream itself (PUT /api/scripts/<id>/content) and then
  reports it with PATCH.
  bundle_hash is the last bundle reported saved upstream. built: it was bundled from
  the files, entry and minify as stored now. in_sync: the script's upstream content
  is still that bundle (null when unknown or nothing was reported).
  A script deleted upstream through this server loses its project.
*/
'use strict';

const core = require('./core');
const bundler = require('./bundle');

const { HttpError } = core;

const BODY_LIMIT = 2 * core.PROJECT.maxBytes + 65536; // JSON escapes can double the text
const HASH = /^[0-9a-f]{64}$/;

const file = (id) => core.store.path('projects', id + '.json');
const bad = (field) => new HttpError(400, 'bad-request', { field });

// One change at a time per script: read, compare and write never interleave.
const locks = new Map();
function serial(id, job) {
  const run = (locks.get(id) || Promise.resolve()).then(job);
  const tail = run.catch(() => {});
  locks.set(id, tail);
  tail.then(() => { if (locks.get(id) === tail) locks.delete(id); });
  return run;
}

// What a bundle depends on, so `built` can tell whether the stored sources changed.
function sources(files, entry, minify) {
  const names = Object.keys(files).sort();
  return core.sha256(JSON.stringify([entry, minify, names.map((n) => [n, files[n]])]));
}

// Later than the last one even if the clock stepped back.
function stamp(old) {
  const last = old ? Date.parse(old.updated_at) : NaN;
  return new Date(Number.isFinite(last) ? Math.max(Date.now(), last + 1) : Date.now()).toISOString();
}

async function upstreamHash(req, id) {
  try {
    const r = await core.upstream('GET', `/api/scripts/${encodeURIComponent(id)}/content`, { cookie: req.headers.cookie });
    return r.status === 200 && r.json && typeof r.json.content === 'string' ? core.sha256(r.json.content) : null;
  } catch (e) {
    return null;
  }
}

async function get(req, res, id) {
  core.requireSameOrigin(req);
  await core.requireOwner(req, id);
  const p = await core.store.readJson(file(id));
  if (!p) throw new HttpError(404, 'not-found');
  const current = p.bundle_hash ? await upstreamHash(req, id) : null;
  core.send(res, 200, {
    files: p.files,
    entry: p.entry,
    minify: p.minify,
    updated_at: p.updated_at,
    bundle_hash: p.bundle_hash || null,
    built: !!p.bundle_hash && p.bundle_sources === p.sources,
    in_sync: current === null ? null : current === p.bundle_hash,
  });
}

// The bundle of what was just stored, or why there is none. Never throws: the sources are saved.
async function bundled(req, files, entry, minify) {
  try {
    bundler.rate(req);
    return await bundler.bundle(files, entry, minify);
  } catch (e) {
    if (e instanceof HttpError) return Object.assign({ error: e.code }, e.extra);
    console.error('Project bundle failed:', e);
    return { error: 'internal' };
  }
}

async function put(req, res, id) {
  await core.requireOwner(req, id);
  const body = await core.readJson(req, BODY_LIMIT);
  const files = core.checkFiles(body.files);
  const entry = core.checkEntry(files, body.entry);
  if (body.minify !== undefined && typeof body.minify !== 'boolean') throw bad('minify');
  if (body.base !== undefined && body.base !== null && typeof body.base !== 'string') throw bad('base');
  if (body.bundle !== undefined && typeof body.bundle !== 'boolean') throw bad('bundle');
  const minify = body.minify !== false;
  const hash = sources(files, entry, minify);
  const updated_at = await serial(id, async () => {
    const old = await core.store.readJson(file(id));
    const seen = old ? old.updated_at : null;
    if (body.base !== undefined && body.base !== seen) throw new HttpError(409, 'conflict', { updated_at: seen });
    const next = stamp(old);
    await core.store.writeJson(file(id), {
      files, entry, minify, updated_at: next, sources: hash,
      bundle_hash: old ? old.bundle_hash : null,
      bundle_sources: old ? old.bundle_sources : null,
    });
    return next;
  });
  const out = { updated_at };
  if (body.bundle) out.bundle = await bundled(req, files, entry, minify);
  core.send(res, 200, out);
}

async function patch(req, res, id) {
  await core.requireOwner(req, id);
  const body = await core.readJson(req, 4096);
  if (typeof body.bundle_hash !== 'string' || !HASH.test(body.bundle_hash)) throw bad('bundle_hash');
  if (typeof body.updated_at !== 'string' || body.updated_at.length > 64) throw bad('updated_at');
  const out = await serial(id, async () => {
    const p = await core.store.readJson(file(id));
    if (!p) throw new HttpError(404, 'not-found');
    // A bundle of sources that are no longer stored is upstream, but not built from these.
    p.bundle_hash = body.bundle_hash;
    p.bundle_sources = body.updated_at === p.updated_at ? p.sources : null;
    await core.store.writeJson(file(id), p);
    return { bundle_hash: p.bundle_hash, built: p.bundle_sources === p.sources, updated_at: p.updated_at };
  });
  core.send(res, 200, out);
}

async function remove(req, res, id) {
  await core.requireOwner(req, id);
  core.send(res, 200, { deleted: await serial(id, () => core.store.remove(file(id))) });
}

const METHODS = { GET: get, PUT: put, PATCH: patch, DELETE: remove };

module.exports = {
  name: 'projects',
  async handle(req, res, url, parts) {
    if (parts.length !== 1) return false;
    const id = parts[0];
    if (!core.isId(id)) throw new HttpError(404, 'not-found');
    const method = METHODS[req.method];
    if (!method) throw new HttpError(405, 'method-not-allowed');
    core.requireRate('projects', req, 300, 60000);
    await method(req, res, id);
  },
  onApi(event) {
    if (event.method !== 'DELETE' || event.status < 200 || event.status >= 300) return;
    const m = /^\/api\/scripts\/([^/]+)\/?$/.exec(event.path);
    if (!m) return;
    let id;
    try { id = decodeURIComponent(m[1]); } catch (e) { return; }
    if (core.isId(id)) return serial(id, () => core.store.remove(file(id)));
  },
  info() {
    return Object.assign({}, core.PROJECT, { extensions: core.PROJECT.extensions.slice() });
  },
};
