#!/usr/bin/env node
/*
  Local server for NT Scripting (no dependencies).

    node server.js            → http://localhost:5173

  - Serves the static app, falling back to index.html for app routes.
  - Proxies /api/* to https://scripting.nulls.gg/api/* so the browser can use
    the real service with its session cookie, without cross-origin limits.
*/
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
const UPSTREAM = 'scripting.nulls.gg';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Only these are ever served from disk.
const PUBLIC = /^\/(index\.html|css\/[\w.-]+\.css|js\/[\w.-]+\.js)$/;

function sendFile(res, file, status = 200) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    // App routes such as /scripts/abc load the same page, so asset URLs must resolve
    // from the root. (Opened from disk there is no base, and relative URLs just work.)
    if (path.basename(file) === 'index.html') {
      data = Buffer.from(data.toString('utf8').replace('<!--base-->', '<base href="/">'));
    }
    res.writeHead(status, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

// Cookies are issued for the upstream host over HTTPS; make them usable on localhost.
function localCookie(cookie) {
  return cookie
    .replace(/;\s*Domain=[^;]*/gi, '')
    .replace(/;\s*Secure/gi, '')
    .replace(/;\s*SameSite=None/gi, '; SameSite=Lax');
}

function proxy(req, res, url) {
  const headers = {
    accept: req.headers.accept || '*/*',
    'accept-language': req.headers['accept-language'] || 'en',
    'user-agent': req.headers['user-agent'] || 'nt-scripting-local',
    origin: `https://${UPSTREAM}`,
    referer: `https://${UPSTREAM}/`,
  };
  for (const name of ['cookie', 'content-type', 'content-length']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }

  const upstream = https.request(
    { host: UPSTREAM, port: 443, method: req.method, path: url.pathname + url.search, headers },
    (up) => {
      const out = { 'x-nt-proxy': '1', 'cache-control': 'no-store' };
      if (up.headers['content-type']) out['content-type'] = up.headers['content-type'];
      if (up.headers['set-cookie']) out['set-cookie'] = up.headers['set-cookie'].map(localCookie);
      res.writeHead(up.statusCode || 502, out);
      up.pipe(res);
    }
  );
  upstream.setTimeout(20000, () => upstream.destroy(new Error('upstream timeout')));
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'x-proxy': '1', 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream unavailable' }));
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (e) {
    res.writeHead(400);
    res.end();
    return;
  }

  if (url.pathname.startsWith('/api/')) return proxy(req, res, url);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }

  if (PUBLIC.test(url.pathname)) return sendFile(res, path.join(ROOT, url.pathname));

  // Unknown files are a 404; everything else is an app route.
  if (path.extname(url.pathname)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  sendFile(res, path.join(ROOT, 'index.html'));
});

// As PID 1 in a container Node ignores these unless handled, which makes `docker stop` hang.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));

server.listen(PORT, HOST, () => {
  console.log(`NT Scripting → http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Proxying /api → https://${UPSTREAM}/api`);
});
