/*
  What a script carries besides its code.

  The upstream service keeps scripts and nothing else, and this server keeps nothing
  at all. So everything the app keeps (a thumbnail, a profile photo, the source files
  of a project) is written into the text of a script, as block comments after the
  code. Anything of size goes into a script of its own with no code at all (a holder,
  api.js); a script with code carries only a mark:

    <code>
    --[=[nt:project rev=2026-11-11T10:23:40.130Z sum=2166136261:4096
    ]=]

    --[=[nt:thumb for=01a1c9e1 v=1k2j3h color=aba5a2 type=webp
    UklGRtIvAABXRUJQVlA4…          base64, 100 to a line
    ]=]

  To Luau and to the game these are comments. A block has a kind, a head of
  key=value pairs and a body of base64 (which may be empty). Only blocks at the very
  end of the text count, each starting its own line, so nothing typed in the code is
  ever taken for one. The line break before the first block belongs to the blocks:
  the code comes back exactly as it went in.

    NT.pack.LIMIT                  characters a script may have (code and blocks together)
    NT.pack.split(content)         → { code, blocks: { kind: { head, body } } }
    NT.pack.join(code, blocks)     → content (a kind whose block is null is left out)
    NT.pack.size(blocks)           characters join adds to the code
    NT.pack.block(head, bytes)     → { head, body } holding those bytes
    NT.pack.bytes(block)           → Uint8Array, or null when the body does not decode
    NT.pack.holds(chars)           bytes whose block fits in that many characters
    NT.pack.squeeze(text)          → Promise of { bytes, enc }: deflated where the browser can
    NT.pack.expand(bytes, enc)     → Promise of the text
*/
(function () {
  'use strict';
  const NT = window.NT;

  const LIMIT = 1000000;
  const OPEN = '--[=[nt:';
  const WIDTH = 100;
  // One block running to the end of the text. Sticky: tried only where a block opens.
  const BLOCK = /--\[=\[nt:([a-z]{1,16})((?: [a-z]{1,16}=[\w.:+\/-]{0,128}){0,16})\r?\n([A-Za-z0-9+\/=\r\n]*)\]=\][ \t\r\n]*$/y;

  function split(content) {
    content = String(content == null ? '' : content);
    const found = [];
    let end = content.length;
    while (end > 0) {
      const at = content.lastIndexOf(OPEN, end - 1);
      if (at < 0 || (at > 0 && content[at - 1] !== '\n')) break;
      BLOCK.lastIndex = at;
      const m = BLOCK.exec(end === content.length ? content : content.slice(0, end));
      if (!m) break;
      const head = {};
      for (const pair of m[2].split(' ')) {
        const cut = pair.indexOf('=');
        if (cut > 0) head[pair.slice(0, cut)] = pair.slice(cut + 1);
      }
      found.unshift([m[1], { head, body: m[3].replace(/\s+/g, '') }]);
      end = Math.max(0, at - 1);
    }
    return { code: content.slice(0, end), blocks: Object.fromEntries(found) };
  }

  function text(kind, block) {
    const head = Object.keys(block.head || {}).map((k) => ` ${k}=${block.head[k]}`).join('');
    const body = block.body ? block.body.replace(new RegExp(`.{${WIDTH}}(?=.)`, 'g'), '$&\n') + '\n' : '';
    return `${OPEN}${kind}${head}\n${body}]=]`;
  }

  function join(code, blocks) {
    let out = String(code == null ? '' : code);
    let any = false;
    for (const kind of Object.keys(blocks || {})) {
      if (!blocks[kind]) continue;
      // Nothing but blocks (a holder): no empty first line.
      out += (out ? '\n' : '') + text(kind, blocks[kind]);
      any = true;
    }
    return any ? out + '\n' : out;
  }

  function block(head, bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { head, body: btoa(s) };
  }

  function bytes(b) {
    try {
      const s = atob(b.body);
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
      return out;
    } catch (e) {
      return null;
    }
  }

  // Base64 is four characters to three bytes, with a line break every WIDTH; the
  // rest allows for the comment around it and a generous head.
  const holds = (chars) => Math.max(0, Math.floor(((chars - 320) * WIDTH / (WIDTH + 1)) / 4) * 3);

  async function through(data, stream) {
    return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer());
  }

  async function squeeze(str) {
    const raw = new TextEncoder().encode(str);
    if (typeof CompressionStream === 'function') {
      try { return { bytes: await through(raw, new CompressionStream('deflate-raw')), enc: 'z' }; } catch (e) { /* kept as it is */ }
    }
    return { bytes: raw, enc: 'b' };
  }

  async function expand(data, enc) {
    const raw = enc === 'z' ? await through(data, new DecompressionStream('deflate-raw')) : data;
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  }

  NT.pack = { LIMIT, split, join, size: (blocks) => join('x', blocks).length - 1, block, bytes, holds, squeeze, expand };
})();
