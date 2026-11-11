/*
  Backend extensions: what this server does beyond proxying the upstream API.

  Each extension is one file in this folder, mounted under /x/<name>:

    module.exports = {
      name: 'media',
      // Requests to /x/media and below. `parts` is the path after the name, split
      // on "/" and URI-decoded. Send a response, or throw core.HttpError.
      // Return false for a path that is not yours (it becomes a 404).
      async handle(req, res, url, parts) {},
      // Optional. WebSocket upgrades to /x/media and below.
      upgrade(req, socket, head, url, parts) {},
      // Optional. Told about every finished, non-GET call to the upstream API
      // that went through the proxy:
      //   { req, method, path, status, body, json, setCookie }
      // `body` is the request's JSON (null if it was not JSON or was over 64 KB),
      // `json` the response's (same rule), `setCookie` the cookies it issued.
      onApi(event) {},
      // Optional. What GET /x reports for this extension (default {}).
      info() { return {}; },
    };

  GET /x lists the extensions that loaded: { extensions: { media: {…}, … } }.
  The app reads it once and leaves out whatever is not there.
*/
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./core');

const NAMES = ['media', 'audit', 'projects', 'bundle', 'lsp'];
const wanted = (process.env.NT_EXT || '').trim();
const enabled = wanted === 'off' ? [] : wanted ? wanted.split(',').map((s) => s.trim()).filter((s) => NAMES.includes(s)) : NAMES;

const loaded = new Map();
for (const name of enabled) {
  const file = path.join(__dirname, name + '.js');
  if (!fs.existsSync(file)) continue;
  try {
    const mod = require(file);
    if (mod && typeof mod.handle === 'function') loaded.set(name, mod);
  } catch (e) {
    console.error(`Extension "${name}" failed to load:`, e && e.message);
  }
}

function fail(res, err) {
  if (err instanceof core.HttpError) {
    return core.send(res, err.status, Object.assign({ error: err.code }, err.extra));
  }
  console.error('Extension error:', err);
  core.send(res, 500, { error: 'internal' });
}

function split(url) {
  // "/x/media/scripts/abc" → ["media", "scripts", "abc"]
  const raw = url.pathname.split('/').slice(2).filter(Boolean);
  try { return raw.map(decodeURIComponent); } catch (e) { return null; }
}

async function handle(req, res, url) {
  try {
    const parts = split(url);
    if (!parts) throw new core.HttpError(400, 'bad-request');
    if (!parts.length) {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new core.HttpError(405, 'method-not-allowed');
      const extensions = {};
      for (const [name, mod] of loaded) {
        try { extensions[name] = (mod.info && (await mod.info())) || {}; } catch (e) { extensions[name] = {}; }
      }
      return core.send(res, 200, { extensions });
    }
    const mod = loaded.get(parts[0]);
    if (!mod) throw new core.HttpError(404, 'not-found');
    // Anything that changes state has to come from this app's own pages.
    if (req.method !== 'GET' && req.method !== 'HEAD') core.requireSameOrigin(req);
    const handled = await mod.handle(req, res, url, parts.slice(1));
    if (handled === false && !res.headersSent) throw new core.HttpError(404, 'not-found');
  } catch (err) {
    fail(res, err);
  }
}

function upgrade(req, socket, head, url) {
  const refuse = (status, text) => {
    socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  const parts = split(url);
  const mod = parts && parts.length ? loaded.get(parts[0]) : null;
  if (!mod || typeof mod.upgrade !== 'function') return refuse(404, 'Not Found');
  if (!req.headers.origin || !core.sameOrigin(req)) return refuse(403, 'Forbidden');
  try {
    mod.upgrade(req, socket, head, url, parts.slice(1));
  } catch (e) {
    console.error('Extension upgrade error:', e);
    socket.destroy();
  }
}

const observers = [...loaded.values()].filter((m) => typeof m.onApi === 'function');

function observe(event) {
  for (const mod of observers) {
    try {
      const out = mod.onApi(event);
      if (out && typeof out.catch === 'function') out.catch((e) => console.error(`Extension "${mod.name}" onApi:`, e && e.message));
    } catch (e) {
      console.error(`Extension "${mod.name}" onApi:`, e && e.message);
    }
  }
}

module.exports = {
  names: [...loaded.keys()],
  handle,
  upgrade,
  observe,
  observing: observers.length > 0,
};
