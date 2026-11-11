#!/usr/bin/env node
/*
  The outside programs and files some extensions need, pinned by version and hash.

    node ext/tools.js          fetch whatever is missing into ./.tools
    node ext/tools.js --force  fetch everything again

  - luau-lsp   language server            (ext/lsp.js)
  - darklua    bundler and minifier       (ext/bundle.js)
  - defs       Luau definitions of the game's scripting API, from
               github.com/nulls-mods-community/scripting-docs

  An extension asks for a path with tools.bin('darklua') or tools.defs(); it gets
  null when the tool is not installed and reports itself unavailable.
  LUAU_LSP_PATH and DARKLUA_PATH point at binaries installed some other way.
*/
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const TOOLS_DIR = path.resolve(process.env.NT_TOOLS || path.join(__dirname, '..', '.tools'));
const EXE = process.platform === 'win32' ? '.exe' : '';
const PLATFORM = `${process.platform}-${process.arch}`;

const TOOLS = {
  'luau-lsp': {
    env: 'LUAU_LSP_PATH',
    version: '1.70.1',
    base: 'https://github.com/JohnnyMorganz/luau-lsp/releases/download/1.70.1/',
    assets: {
      'win32-x64': ['luau-lsp-win64.zip', '64225b9738102a30de6ee09fb28e5a3827edc402ecf2a6364af570312468159f'],
      'linux-x64': ['luau-lsp-linux-x86_64.zip', '1a2ea1ae4f98f8946cefd970a4b54853e11ab4775e6932faa7f60cf920346567'],
      'linux-arm64': ['luau-lsp-linux-arm64.zip', '6062345b95124ca937b8c324b74bc3fddb1d6919ba133c58f8b17945ce1acbc2'],
      'darwin-x64': ['luau-lsp-macos.zip', '7d3936e8dec6dc77547abd061d2e950da392562a5f94858b880f23dba50d84cd'],
      'darwin-arm64': ['luau-lsp-macos.zip', '7d3936e8dec6dc77547abd061d2e950da392562a5f94858b880f23dba50d84cd'],
    },
  },
  darklua: {
    env: 'DARKLUA_PATH',
    version: '0.19.0',
    base: 'https://github.com/seaofvoices/darklua/releases/download/v0.19.0/',
    assets: {
      'win32-x64': ['darklua-windows-x86_64.zip', 'e099313a768a0628bce861123dff6959f0c7dc49b5c353d9523a144c1fa2124e'],
      'linux-x64': ['darklua-linux-x86_64.zip', '353b7a7772cec97994fd991fb3c143b39654ff154bd6dabfd7abf9fbe9ab7ea8'],
      'linux-arm64': ['darklua-linux-aarch64.zip', 'b308a5724b4781e89fbac42bd5906342d9ea0374961d64b8b5f0681bba2cdcac'],
      'darwin-x64': ['darklua-macos-x86_64.zip', 'bb364f898e83e8204d56b6d6d9e6edd8c391300dd4a82cd06e4d36d1f0a66b1a'],
      'darwin-arm64': ['darklua-macos-aarch64.zip', 'b97be3d771dd82c11134af96fb8ed48f4163740eacc1f32eeda735074f51e59b'],
    },
  },
};

// Loaded in this order: globals.d.luau refers to types declared in types.d.luau.
const DEFS = {
  commit: 'dd3625b2ae0f92bca3b63309ecbed74104699653',
  base: 'https://raw.githubusercontent.com/nulls-mods-community/scripting-docs/dd3625b2ae0f92bca3b63309ecbed74104699653/',
  files: [
    ['types.d.luau', '54a8fa42784b55d01c4da33dc2774be14c180101efba4332a564ec99f8b18020'],
    ['globals.d.luau', '5104b542fa59adefe8403ea0aa9df74e806e4d307ba17634796bc6440503a1df'],
  ],
};

/* ---------- Lookup ---------- */

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch (e) { return false; }
}

// Absolute path of an installed tool, or null.
function bin(name) {
  const tool = TOOLS[name];
  if (!tool) return null;
  const fromEnv = process.env[tool.env];
  if (fromEnv) return isFile(fromEnv) ? path.resolve(fromEnv) : null;
  const local = path.join(TOOLS_DIR, name + EXE);
  return isFile(local) ? local : null;
}

// Absolute paths of the definition files in load order, or null if any is missing.
function defs() {
  const paths = DEFS.files.map(([file]) => path.join(TOOLS_DIR, 'defs', file));
  return paths.every(isFile) ? paths : null;
}

const version = (name) => (TOOLS[name] ? TOOLS[name].version : null);

/* ---------- Fetch ---------- */

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function download(url, expected) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== expected) throw new Error(`${url} has hash ${got}, expected ${expected}`);
  return buf;
}

// Pull one file out of a zip archive by its base name (stored or deflated entries).
function unzipOne(zip, wanted) {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('not a zip archive');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('bad zip directory');
    const method = zip.readUInt16LE(at + 10);
    const packed = zip.readUInt32LE(at + 20);
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (name.split('/').pop() !== wanted) continue;
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('bad zip entry');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + packed);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return zlib.inflateRawSync(data);
    throw new Error(`zip entry ${name} uses unsupported compression ${method}`);
  }
  throw new Error(`${wanted} is not in the archive`);
}

async function fetchTool(name, force) {
  const tool = TOOLS[name];
  const target = path.join(TOOLS_DIR, name + EXE);
  const stamp = target + '.version';
  let have = null;
  try { have = fs.readFileSync(stamp, 'utf8').trim(); } catch (e) { /* not installed */ }
  if (!force && isFile(target) && have === tool.version) return `${name} ${tool.version} (already there)`;
  const asset = tool.assets[PLATFORM];
  if (!asset) throw new Error(`no ${name} build for ${PLATFORM}; install it yourself and set ${tool.env}`);
  const zip = await download(tool.base + asset[0], asset[1]);
  const data = unzipOne(zip, name + EXE);
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  fs.writeFileSync(target, data, { mode: 0o755 });
  fs.writeFileSync(stamp, tool.version + '\n');
  return `${name} ${tool.version}`;
}

async function fetchDefs(force) {
  const dir = path.join(TOOLS_DIR, 'defs');
  const stamp = path.join(dir, 'commit');
  let have = null;
  try { have = fs.readFileSync(stamp, 'utf8').trim(); } catch (e) { /* not installed */ }
  if (!force && defs() && have === DEFS.commit) return `defs ${DEFS.commit.slice(0, 7)} (already there)`;
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, hash] of DEFS.files) {
    fs.writeFileSync(path.join(dir, file), await download(DEFS.base + file, hash));
  }
  fs.writeFileSync(stamp, DEFS.commit + '\n');
  return `defs ${DEFS.commit.slice(0, 7)}`;
}

async function fetchAll(force) {
  let failed = false;
  const jobs = [...Object.keys(TOOLS).map((name) => [name, () => fetchTool(name, force)]), ['defs', () => fetchDefs(force)]];
  for (const [name, job] of jobs) {
    try { console.log('  ' + (await job())); } catch (e) {
      failed = true;
      console.error(`  ${name}: ${e.message}`);
    }
  }
  return !failed;
}

module.exports = { TOOLS_DIR, bin, defs, version, fetchAll };

if (require.main === module) {
  console.log(`Tools → ${TOOLS_DIR}`);
  fetchAll(process.argv.includes('--force')).then((ok) => process.exit(ok ? 0 : 1));
}
