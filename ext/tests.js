/*
  Test runs: a script played in a friendly battle by a game client with no screen,
  somewhere else, and what came of it.

  This server does none of that. It hands the request to a runner service, on another
  machine, and passes the answer along as it arrives. Nothing of a run is kept here:
  only, in memory and for a while, whose each one is.

    NT_RUNNER_URL     where the runner is, e.g. https://203.0.113.7:8787
    NT_RUNNER_TOKEN   what it expects as "Authorization: Bearer …"
    NT_RUNNER_CA      the runner's own certificate: a file, or the PEM text itself.
                      The runner signs its certificate itself, so this is how it is
                      known to be the runner. Without it the system's authorities are
                      used, for a runner behind a public name.

  Without the first two the extension answers that it has no runner, and the app
  leaves testing out.

    GET    /x/tests/status              { ready, free, queued, clients }
    POST   /x/tests/runs                { script_id, token, bp, map?, seconds? } → { id }
                                        token: a share token for the script, as for a
                                        friendly battle. bp: the battle parameters of a
                                        room link (32 numbers).
    GET    /x/tests/runs/<id>/events    the run as it happens (server-sent events)
    DELETE /x/tests/runs/<id>           stop it

  Starting, reading and stopping a run need a session, and a run is its starter's.
  What the events are is the runner's to say (its run.js); the app reads them in
  js/tests.js.
*/
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const core = require('./core');

const RUNNER = (() => {
  try { return process.env.NT_RUNNER_URL ? new URL(process.env.NT_RUNNER_URL) : null; } catch (e) { return null; }
})();
const TOKEN = process.env.NT_RUNNER_TOKEN || '';
const CA = (() => {
  const value = process.env.NT_RUNNER_CA;
  if (!value) return null;
  if (value.includes('-----BEGIN')) return value.replace(/\\n/g, '\n');
  try { return fs.readFileSync(value, 'utf8'); } catch (e) {
    console.error('Tests: cannot read NT_RUNNER_CA:', e.message);
    return null;
  }
})();
const READY = !!(RUNNER && TOKEN && /^https?:$/.test(RUNNER.protocol));

const SECONDS = { least: 5, most: 120, usual: 20 };
const OWNED_FOR = 30 * 60 * 1000;
const owners = new Map(); // run id → { user, at }

// One request to the runner. → the response, still streaming. Rejects when the
// runner cannot be reached.
function runner(method, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const lib = RUNNER.protocol === 'http:' ? http : https;
    const payload = opts.body === undefined ? null : Buffer.from(JSON.stringify(opts.body));
    const headers = Object.assign({ authorization: 'Bearer ' + TOKEN }, opts.headers);
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = payload.length;
    }
    const req = lib.request({
      host: RUNNER.hostname,
      port: RUNNER.port || (RUNNER.protocol === 'http:' ? 80 : 443),
      method,
      path,
      headers,
      ca: CA || undefined,
    }, resolve);
    // For the answer to begin; a stream of events then goes on as long as its run.
    const timer = setTimeout(() => req.destroy(new Error('runner timeout')), 15000);
    req.on('response', () => clearTimeout(timer));
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.end(payload || undefined);
  });
}

async function json(res) {
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return null; }
}

const unavailable = () => new core.HttpError(502, 'runner-unavailable');

async function user(req) {
  const who = await core.session(req);
  if (!who) throw new core.HttpError(401, 'unauthorized');
  return who;
}

// The run, if it is this person's.
function owned(id, who) {
  const entry = owners.get(id);
  if (!entry || entry.user !== who.user_id) throw new core.HttpError(404, 'not-found');
  return entry;
}

const whole = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

async function start(req, res) {
  const who = await user(req);
  core.requireRate('tests', req, 12, 60000);
  const body = await core.readJson(req, 8192);
  if (typeof body.script_id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(body.script_id)) throw new core.HttpError(400, 'bad-script');
  if (typeof body.token !== 'string' || !body.token || body.token.length > 400 || /\s/.test(body.token)) throw new core.HttpError(400, 'bad-token');
  if (!Array.isArray(body.bp) || body.bp.length !== 32 || !body.bp.every((v) => whole(v, -100000, 100000))) throw new core.HttpError(400, 'bad-parameters');
  if (body.map !== undefined && body.map !== null && !whole(body.map, 0, 2147483647)) throw new core.HttpError(400, 'bad-map');
  if (body.seconds !== undefined && !whole(body.seconds, SECONDS.least, SECONDS.most)) throw new core.HttpError(400, 'bad-seconds');

  let answer, data;
  try {
    answer = await runner('POST', '/v1/runs', {
      body: {
        // Where the game fetches the script from: the service itself, not this server.
        script: `${core.UPSTREAM.origin}/api/scripts/${body.script_id}/content?token=${encodeURIComponent(body.token)}`,
        bp: body.bp,
        map: body.map === undefined ? null : body.map,
        seconds: body.seconds === undefined ? SECONDS.usual : body.seconds,
        // One run at a time each. The runner is told a hash, not who it is.
        owner: 'u:' + core.sha256(String(who.user_id)).slice(0, 24),
      },
    });
    data = await json(answer);
  } catch (e) {
    throw unavailable();
  }
  if (answer.statusCode === 409) throw new core.HttpError(409, 'busy');
  if (answer.statusCode === 503) throw new core.HttpError(503, 'full');
  if (answer.statusCode !== 202 || !data || typeof data.id !== 'string') throw unavailable();

  const now = Date.now();
  if (owners.size > 500) for (const [id, entry] of owners) if (now - entry.at > OWNED_FOR) owners.delete(id);
  owners.set(data.id, { user: who.user_id, at: now });
  core.send(res, 201, { id: data.id });
}

async function events(req, res, id) {
  owned(id, await user(req));
  const headers = { accept: 'text/event-stream' };
  if (req.headers['last-event-id']) headers['last-event-id'] = String(req.headers['last-event-id']).slice(0, 16);
  let answer;
  try { answer = await runner('GET', `/v1/runs/${encodeURIComponent(id)}/events`, { headers }); } catch (e) { throw unavailable(); }
  if (answer.statusCode !== 200) {
    answer.resume();
    // The runner forgets a run some minutes after it ends.
    throw answer.statusCode === 404 ? new core.HttpError(404, 'not-found') : unavailable();
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no',
    'x-content-type-options': 'nosniff',
  });
  answer.pipe(res);
  const drop = () => answer.destroy();
  req.on('close', drop);
  answer.on('error', () => res.end());
}

async function stop(req, res, id) {
  owned(id, await user(req));
  try { (await runner('DELETE', `/v1/runs/${encodeURIComponent(id)}`)).resume(); } catch (e) { throw unavailable(); }
  core.send(res, 204);
}

async function status(req, res) {
  let data = null;
  try {
    const answer = await runner('GET', '/v1/status');
    data = answer.statusCode === 200 ? await json(answer) : (answer.resume(), null);
  } catch (e) { /* said below */ }
  if (!data) throw unavailable();
  // How busy it is, and nothing about the clients themselves.
  core.send(res, 200, {
    ready: Number(data.ready) || 0,
    free: Number(data.free) || 0,
    queued: Number(data.queued) || 0,
    clients: Array.isArray(data.slots) ? data.slots.length : 0,
  });
}

module.exports = {
  name: 'tests',
  info() {
    return { ready: READY, seconds: SECONDS };
  },
  async handle(req, res, url, parts) {
    if (!READY) throw new core.HttpError(503, 'no-runner');
    if (parts.length === 1 && parts[0] === 'status' && req.method === 'GET') return status(req, res);
    if (parts.length === 1 && parts[0] === 'runs' && req.method === 'POST') return start(req, res);
    if (parts[0] === 'runs' && parts.length >= 2 && /^[A-Za-z0-9_-]{8,64}$/.test(parts[1])) {
      if (parts.length === 3 && parts[2] === 'events' && req.method === 'GET') return events(req, res, parts[1]);
      if (parts.length === 2 && req.method === 'DELETE') return stop(req, res, parts[1]);
    }
    return false;
  },
};
