/*
  The app's server, started for a check: this tree, or another git ref of it.

    const app = await serve.start({ root, port, upstream, env })   → { url, port, root, stop() }
    const root = serve.checkout(ref, dir)     the files of `ref` (git archive), in dir

  The server is a child process (node server.js) with its own port and the mock as
  its upstream. The tools the extensions use (.tools, not in git) are taken from
  NT_TOOLS, else from this tree, else from the main checkout beside a worktree.
*/
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const HERE = path.resolve(__dirname, '..');

function tools() {
  if (process.env.NT_TOOLS) return process.env.NT_TOOLS;
  const own = path.join(HERE, '.tools');
  if (fs.existsSync(own)) return own;
  // A worktree lives in <main>/.claude/worktrees/<name>.
  const main = path.resolve(HERE, '..', '..', '..', '.tools');
  return fs.existsSync(main) ? main : own;
}

// git archive's tar, unpacked here: which tar a machine has (and how it reads "C:") varies.
function untar(buf, dir) {
  let at = 0, longName = null;
  const text = (from, n) => buf.toString('utf8', from, from + n).replace(/\0.*$/s, '');
  while (at + 512 <= buf.length) {
    const head = buf.subarray(at, at + 512);
    if (head.every((b) => b === 0)) break;
    const size = parseInt(text(at + 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(head[156] || 48);
    const prefix = text(at + 345, 155);
    let name = longName || (prefix ? prefix + '/' : '') + text(at, 100);
    const body = buf.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x' || type === 'g') {
      const m = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      if (type === 'x' && m) longName = m[1];
      continue;
    }
    longName = null;
    const out = path.join(dir, name);
    if (!out.startsWith(dir)) continue;
    if (type === '5') fs.mkdirSync(out, { recursive: true });
    else if (type === '0' || type === '7') {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, body);
    }
  }
}

function checkout(ref, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  untar(execFileSync('git', ['archive', '--format=tar', ref], { cwd: HERE, maxBuffer: 512 * 1024 * 1024 }), path.resolve(dir));
  return dir;
}

function start({ root = HERE, port, upstream, env = {}, quiet = true }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', NT_UPSTREAM: upstream, NT_TOOLS: tools() }, env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`server on ${port} did not start:\n${out}`)); }, 20000);
    const take = (chunk) => {
      out += chunk;
      if (!quiet) process.stdout.write(chunk);
      if (/NT Scripting → /.test(out) && timer) {
        clearTimeout(timer);
        resolve({
          url: `http://localhost:${port}`,
          port,
          root,
          log: () => out,
          stop: () => new Promise((r) => { child.once('exit', () => r()); child.kill(); setTimeout(r, 2000); }),
        });
      }
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', take);
    child.stderr.on('data', (c) => { out += c; });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server on ${port} exited (${code}):\n${out}`)); });
  });
}

module.exports = { start, checkout, tools, HERE };
