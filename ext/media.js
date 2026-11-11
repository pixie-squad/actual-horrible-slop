/*
  Thumbnails for scripts and avatars for users (mounted at /x/media).

  The upstream API has no images at all, so the author of a script, or the user
  themselves, uploads one here and this server keeps it.

    PUT    /x/media/thumbs/<scriptId>[?color=rrggbb]   raw image bytes; the script's author only
    DELETE /x/media/thumbs/<scriptId>                  the script's author only
    GET    /x/media/thumbs/<scriptId>[?v=<v>]          public; 404 when there is none
    PUT, DELETE, GET /x/media/avatars/<userId>         the same for a user, changed only by
                                                       that user ("me" works for PUT and DELETE)
    POST   /x/media/lookup  { thumbs: [id…], avatars: [id…] }  (each optional, ≤ 500 ids)
       → { thumbs: { <id>: { v, color } }, avatars: { … } }  only the ids that have an image

  PUT answers { v, color, width, height, type }. `v` is a short hash of the bytes: a GET
  with the current ?v= may be cached for good, anything else revalidates by ETag.
  `color` is the image's average colour as the client measured it, or null; it is a
  placeholder while the image loads and decides the contrast of anything drawn on it.

  Only still PNG, JPEG and WebP are kept, decided from the bytes, and the size is read
  from the image's own header. There is deliberately no listing: the ids of
  unpublished drafts must not be discoverable. Deleting a script through the proxy
  deletes its thumbnail.

  On disk, under NT_DATA/media:
    index.json                             what exists. It is written after the image
                                           and before the old one is removed, so it
                                           is the commit point of every change.
    thumbs/<id>.<v>.<color|none>.<ext>     one image per id (avatars/ likewise)
  On start the folders are reconciled with the index: a file it does not name was
  left by an interrupted upload or removal, and is deleted. Without a readable index
  it is rebuilt from the files, which carry everything it needs in their names.
*/
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./core');

const { HttpError, store } = core;

const KINDS = {
  thumbs: { maxBytes: 512 * 1024, maxSide: 1600, minSide: 64 },
  avatars: { maxBytes: 256 * 1024, maxSide: 512, minSide: 32 },
};
const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const LOOKUP_MAX = 500;
const THUMBS_PER_USER = 500;
const MAX_TOTAL = 2 * 1024 * 1024 * 1024; // every image together, so the disk cannot be filled
const WRITES = [60, 10 * 60 * 1000]; // uploads and removals per client per ten minutes
const IMMUTABLE = 'public, max-age=31536000, immutable';
const NAME = /^([A-Za-z0-9_-]{1,64})\.([0-9a-f]{12})\.([0-9a-f]{6}|none)\.(png|jpg|webp)$/;

/* ---------- Reading image headers ---------- */

const unreadable = () => new HttpError(422, 'bad-image', { reason: 'unreadable' });
const animated = () => new HttpError(422, 'bad-image', { reason: 'animated' });

function sized(ext, width, height) {
  if (!(width > 0 && height > 0)) throw unreadable();
  return { ext, width, height };
}

// → { ext, width, height }. 415 for anything that is not PNG, JPEG or WebP; 422 for
// one of those whose header cannot be read, or that moves.
function sniff(buf) {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return png(buf);
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return jpeg(buf);
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return webp(buf);
  throw new HttpError(415, 'unsupported-type', { accepted: Object.values(TYPES) });
}

// Bit depths each PNG colour type allows.
const PNG_DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

function png(buf) {
  // Chunks are length, type, data, CRC. IHDR is first; an APNG announces itself with
  // acTL before the first image data, so walking up to IDAT is enough.
  let at = 8, size = null;
  while (at + 12 <= buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const data = at + 8;
    if (data + len + 4 > buf.length) break;
    if (!size) {
      if (type !== 'IHDR' || len !== 13) break;
      const depths = PNG_DEPTHS[buf[data + 9]];
      if (!depths || !depths.includes(buf[data + 8]) || buf[data + 10] !== 0 || buf[data + 11] !== 0 || buf[data + 12] > 1) break;
      size = [buf.readUInt32BE(data), buf.readUInt32BE(data + 4)];
    } else if (type === 'acTL') {
      throw animated();
    } else if (type === 'IDAT') {
      return sized('png', size[0], size[1]);
    }
    at = data + len + 4;
  }
  throw unreadable();
}

// Frame headers (SOFn) a browser decodes: baseline, extended and progressive.
const JPEG_FRAMES = [0xc0, 0xc1, 0xc2];

function jpeg(buf) {
  // Marker segments up to the frame header, which holds the size. Each segment is
  // FF, a marker byte, and a length that counts itself; RSTn and TEM have no length.
  let at = 2;
  while (at + 4 <= buf.length) {
    if (buf[at] !== 0xff) break;
    const marker = buf[at + 1];
    if (marker === 0xff) { at++; continue; } // fill byte
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) break; // no frame before the scan
    const len = buf.readUInt16BE(at + 2);
    if (len < 2 || at + 2 + len > buf.length) break;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      // A frame header: precision, height, width, components. A height of 0 is given later (DNL).
      if (!JPEG_FRAMES.includes(marker) || len < 8) break;
      return sized('jpg', buf.readUInt16BE(at + 7), buf.readUInt16BE(at + 5));
    }
    at += 2 + len;
  }
  throw unreadable();
}

function webp(buf) {
  // A RIFF container. A still image is one VP8 (lossy) or VP8L (lossless) chunk,
  // optionally after a VP8X header that gives the canvas size and says whether it animates.
  const end = 8 + buf.readUInt32LE(4);
  if (end > buf.length) throw unreadable();
  let at = 12, canvas = null;
  while (at + 8 <= end) {
    const type = buf.toString('latin1', at, at + 4);
    const len = buf.readUInt32LE(at + 4);
    const data = at + 8;
    if (data + len > end) break;
    if (type === 'ANIM' || type === 'ANMF') throw animated();
    if (type === 'VP8X') {
      if (at !== 12 || len < 10) break;
      if (buf[data] & 0x02) throw animated();
      canvas = [buf.readUIntLE(data + 4, 3) + 1, buf.readUIntLE(data + 7, 3) + 1];
    } else if (type === 'VP8 ' || type === 'VP8L') {
      const size = type === 'VP8 ' ? vp8(buf, data, len) : vp8l(buf, data, len);
      if (!size || (canvas && (canvas[0] !== size[0] || canvas[1] !== size[1]))) break;
      return sized('webp', size[0], size[1]);
    }
    at = data + len + (len & 1);
  }
  throw unreadable();
}

function vp8(buf, at, len) {
  // A 3-byte frame tag (bit 0 clear on a key frame), the start code 9d 01 2a, then
  // width and height in 14 bits each (the top two bits are a scale).
  if (len < 10 || buf[at] & 1 || buf[at + 3] !== 0x9d || buf[at + 4] !== 0x01 || buf[at + 5] !== 0x2a) return null;
  return [buf.readUInt16LE(at + 6) & 0x3fff, buf.readUInt16LE(at + 8) & 0x3fff];
}

function vp8l(buf, at, len) {
  // The signature 0x2f, then width-1 and height-1 in 14 bits each, alpha, and a 3-bit version of 0.
  if (len < 5 || buf[at] !== 0x2f) return null;
  const bits = buf.readUInt32LE(at + 1);
  if (bits >>> 29 !== 0) return null;
  return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
}

function fits(kind, img) {
  const lim = KINDS[kind];
  const long = Math.max(img.width, img.height), short = Math.min(img.width, img.height);
  if (long > lim.maxSide || short < lim.minSide) {
    throw new HttpError(422, 'bad-image', { reason: 'dimensions', width: img.width, height: img.height, minSide: lim.minSide, maxSide: lim.maxSide });
  }
}

/* ---------- What exists ---------- */

// kind → Map(id → { file, v, color, type, width, height, size, owner })
const index = { thumbs: new Map(), avatars: new Map() };
let total = 0; // bytes of every image in the index
const INDEX_FILE = store.path('media', 'index.json');
const fileOf = (kind, name) => store.path('media', kind, name);

function parseName(name) {
  const m = NAME.exec(name);
  return m && { id: m[1], v: m[2], color: m[3] === 'none' ? null : m[3], type: TYPES[m[4]] };
}

const positive = (n) => Number.isSafeInteger(n) && n > 0;

// An index entry as saved, checked against its own file name; null if it does not hold up.
function revive(id, saved) {
  if (!saved || typeof saved !== 'object' || typeof saved.file !== 'string') return null;
  const name = parseName(saved.file);
  if (!name || name.id !== id || !positive(saved.width) || !positive(saved.height) || !positive(saved.size)) return null;
  const owner = core.isId(saved.owner) ? saved.owner : null;
  return { file: saved.file, v: name.v, color: name.color, type: name.type, width: saved.width, height: saved.height, size: saved.size, owner };
}

// Without an index, an image file is taken at its word once its bytes match its name.
async function adopt(kind, name) {
  const parsed = parseName(name);
  if (!parsed) return null;
  try {
    const file = fileOf(kind, name);
    const [buf, stat] = await Promise.all([fs.promises.readFile(file), fs.promises.stat(file)]);
    if (core.sha256(buf).slice(0, 12) !== parsed.v) return null;
    const img = sniff(buf);
    if (TYPES[img.ext] !== parsed.type) return null;
    return { id: parsed.id, at: stat.mtimeMs, entry: { file: name, v: parsed.v, color: parsed.color, type: parsed.type, width: img.width, height: img.height, size: buf.length, owner: null } };
  } catch (e) {
    return null;
  }
}

async function listFiles(dir) {
  try {
    return (await fs.promises.readdir(dir, { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function load() {
  const saved = await store.readJson(INDEX_FILE, null);
  const trusted = !!saved && saved.version === 1;
  let changed = !trusted;
  for (const kind of Object.keys(KINDS)) {
    const dir = store.path('media', kind);
    const names = await listFiles(dir);
    const map = index[kind];
    if (trusted) {
      const present = new Set(names);
      for (const [id, value] of Object.entries((saved[kind] && typeof saved[kind] === 'object') ? saved[kind] : {})) {
        const entry = core.isId(id) && revive(id, value);
        if (entry && present.has(entry.file)) map.set(id, entry);
        else changed = true;
      }
    } else {
      // Rebuilding: of several files for one id, the newest is the one that was being put in place.
      const newest = new Map();
      for (const name of names) {
        const found = await adopt(kind, name);
        if (found && !(newest.has(found.id) && newest.get(found.id).at >= found.at)) newest.set(found.id, found);
      }
      for (const [id, found] of newest) map.set(id, found.entry);
    }
    const keep = new Set([...map.values()].map((e) => e.file));
    for (const name of names) if (!keep.has(name)) await store.remove(path.join(dir, name)).catch(() => {});
  }
  // A temporary index left by a write that never finished.
  for (const name of await listFiles(path.dirname(INDEX_FILE))) {
    if (name.startsWith('index.json.') && name.endsWith('.tmp')) await store.remove(path.join(path.dirname(INDEX_FILE), name)).catch(() => {});
  }
  for (const map of Object.values(index)) for (const e of map.values()) total += e.size;
  if (changed) await save();
}

// Writes the index. Resolves once everything changed before the call is on disk;
// calls that arrive while a write is under way share the next one.
let writing = null, queued = null;
function save() {
  if (queued) return queued;
  if (!writing) return (writing = flush());
  queued = writing.catch(() => {}).then(() => {
    queued = null;
    return (writing = flush());
  });
  return queued;
}
async function flush() {
  try {
    const snapshot = { version: 1 };
    for (const [kind, map] of Object.entries(index)) snapshot[kind] = Object.fromEntries(map);
    await store.writeJson(INDEX_FILE, snapshot);
  } finally {
    writing = null;
  }
}

const ready = load();
ready.catch((e) => console.error('media: the image index could not be loaded:', e.message));

/* ---------- Requests ---------- */

function colorOf(url) {
  const all = url.searchParams.getAll('color');
  if (!all.length) return null;
  if (all.length > 1 || !/^[0-9a-fA-F]{6}$/.test(all[0])) throw new HttpError(400, 'bad-color');
  return all[0].toLowerCase();
}

// The id a change is for, once the caller is known to be allowed to make it.
async function authorize(req, kind, id) {
  if (kind === 'thumbs') {
    // Stored under the script's own id, whatever spelling of it the upstream accepted.
    const { user, script } = await core.requireOwner(req, id);
    if (!core.isId(script.script_id)) throw new HttpError(400, 'bad-id');
    return { id: script.script_id, owner: user.user_id };
  }
  const user = await core.requireUser(req);
  if (id !== 'me' && id !== user.user_id) throw new HttpError(403, 'forbidden');
  if (!core.isId(user.user_id)) throw new HttpError(400, 'bad-id');
  return { id: user.user_id, owner: user.user_id };
}

function owned(owner, except) {
  let n = 0;
  for (const [id, e] of index.thumbs) if (e.owner === owner && id !== except) n++;
  return n;
}

async function upload(req, res, url, kind, requested) {
  const color = colorOf(url);
  core.requireRate('media-write', req, ...WRITES);
  const { id, owner } = await authorize(req, kind, requested);
  if (kind === 'thumbs' && owned(owner, id) >= THUMBS_PER_USER) throw new HttpError(409, 'too-many', { limit: THUMBS_PER_USER });
  const buf = await core.readBody(req, KINDS[kind].maxBytes);
  const img = sniff(buf);
  fits(kind, img);

  const map = index[kind];
  const prev = map.get(id);
  if (total - (prev ? prev.size : 0) + buf.length > MAX_TOTAL) throw new HttpError(507, 'storage-full');
  const v = core.sha256(buf).slice(0, 12);
  const name = `${id}.${v}.${color || 'none'}.${img.ext}`;
  const entry = { file: name, v, color, type: TYPES[img.ext], width: img.width, height: img.height, size: buf.length, owner };
  // The same bytes and colour make the same name, and that file is already in place.
  if (!prev || prev.file !== name) await store.write(fileOf(kind, name), buf);
  // Another upload for this id may have finished while this one was being written.
  const before = map.get(id);
  map.set(id, entry);
  total += entry.size - (before ? before.size : 0);
  await save();
  if (before && before.file !== name && (!map.get(id) || map.get(id).file !== before.file)) {
    await store.remove(fileOf(kind, before.file)).catch(() => {});
  }
  core.send(res, 200, { v, color, width: img.width, height: img.height, type: entry.type });
}

// Takes an image out of the index, then off the disk. → whether there was one.
async function drop(kind, id) {
  const map = index[kind];
  const entry = map.get(id);
  if (!entry) return false;
  map.delete(id);
  total -= entry.size;
  await save();
  const now = map.get(id);
  if (!now || now.file !== entry.file) await store.remove(fileOf(kind, entry.file)).catch(() => {});
  return true;
}

async function remove(req, res, kind, requested) {
  core.requireRate('media-write', req, ...WRITES);
  const { id } = await authorize(req, kind, requested);
  await drop(kind, id);
  core.send(res, 204);
}

// If-None-Match names this version (or anything).
function fresh(req, v) {
  const tags = req.headers['if-none-match'];
  if (!tags) return false;
  return tags.split(',').some((t) => {
    const tag = t.trim();
    return tag === '*' || tag.replace(/^W\//, '') === `"${v}"`;
  });
}

async function serve(req, res, url, kind, id) {
  // An upload can replace the file between looking it up and reading it; then read the new one.
  for (let attempt = 0; attempt < 3; attempt++) {
    const entry = index[kind].get(id);
    if (!entry) break;
    const headers = {
      etag: `"${entry.v}"`,
      'cache-control': url.searchParams.get('v') === entry.v ? IMMUTABLE : 'no-cache',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cross-origin-resource-policy': 'same-origin',
      'content-disposition': 'inline',
    };
    if (fresh(req, entry.v)) {
      res.writeHead(304, headers);
      return res.end();
    }
    headers['content-type'] = entry.type;
    if (req.method === 'HEAD') {
      res.writeHead(200, Object.assign(headers, { 'content-length': entry.size }));
      return res.end();
    }
    const buf = await store.read(fileOf(kind, entry.file));
    if (!buf) continue;
    res.writeHead(200, Object.assign(headers, { 'content-length': buf.length }));
    return res.end(buf);
  }
  throw new HttpError(404, 'not-found');
}

async function lookup(req, res) {
  const body = await core.readJson(req, 128 * 1024);
  if (Array.isArray(body)) throw new HttpError(400, 'bad-request');
  const out = {};
  for (const kind of Object.keys(KINDS)) {
    const ids = body[kind] === undefined || body[kind] === null ? [] : body[kind];
    if (!Array.isArray(ids)) throw new HttpError(400, 'bad-request', { field: kind });
    if (ids.length > LOOKUP_MAX) throw new HttpError(413, 'too-large', { field: kind, limit: LOOKUP_MAX });
    if (!ids.every(core.isId)) throw new HttpError(400, 'bad-id', { field: kind });
    const map = index[kind];
    out[kind] = Object.fromEntries(ids.filter((id) => map.has(id)).map((id) => [id, { v: map.get(id).v, color: map.get(id).color }]));
  }
  core.send(res, 200, out);
}

module.exports = {
  name: 'media',

  async handle(req, res, url, parts) {
    await ready;
    if (parts.length === 1 && parts[0] === 'lookup') {
      if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed');
      return lookup(req, res);
    }
    if (parts.length !== 2 || !Object.prototype.hasOwnProperty.call(KINDS, parts[0])) return false;
    const [kind, id] = parts;
    if (!core.isId(id)) throw new HttpError(400, 'bad-id');
    switch (req.method) {
      case 'GET':
      case 'HEAD': return serve(req, res, url, kind, id);
      case 'PUT': return upload(req, res, url, kind, id);
      case 'DELETE': return remove(req, res, kind, id);
      default: throw new HttpError(405, 'method-not-allowed');
    }
  },

  // A script deleted upstream takes its thumbnail with it.
  onApi(event) {
    if (event.method !== 'DELETE' || event.status < 200 || event.status >= 300) return;
    const m = /^\/api\/scripts\/([^/]+)\/?$/.exec(event.path);
    if (!m) return;
    let id;
    try { id = decodeURIComponent(m[1]); } catch (e) { return; }
    if (core.isId(id)) return ready.then(() => drop('thumbs', id));
  },

  info() {
    return { types: Object.values(TYPES), thumbs: KINDS.thumbs, avatars: KINDS.avatars, lookupMax: LOOKUP_MAX };
  },
};
