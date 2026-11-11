/*
  The server side of a WebSocket (RFC 6455), with no dependencies and no extensions.

    const conn = ws.accept(req, socket, head, { maxMessage })
      → a Connection, or null when the request was not a valid WebSocket handshake
        (it has then been answered with 400 or 426 and the socket closed).

    conn.on('message', (text) => {})     one complete text message
    conn.on('close', (code, reason) => {})
                                         exactly once, when the connection is over for
                                         any reason; 1006 when it ended without a close
                                         frame (socket error, peer vanished)
    conn.send(text)        → false once closing (nothing is sent then)
    conn.close(code, reason)  starts the close handshake; the socket is destroyed when
                              the peer answers, or after a few seconds if it does not
    conn.terminate()          drops the connection at once
    conn.bufferedAmount       bytes written but not yet sent

  Client frames must be masked. A message (all of its fragments) may be at most
  `maxMessage` bytes (default 2 MB): a longer one closes the connection with 1009,
  before its payload is buffered. Binary messages close it with 1003, text that is
  not UTF-8 with 1007, anything else outside the protocol with 1002. Pings are
  answered; pongs are ignored. Frames may arrive split across or packed into TCP
  chunks in any way.
*/
'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const DEFAULT_MAX = 2 * 1024 * 1024;
const CLOSE_WAIT = 5000; // how long to wait for the peer's close frame

const OP = { cont: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa };

const utf8 = new TextDecoder('utf-8', { fatal: true });

function refuse(socket, status, text, extra) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\n${extra || ''}Connection: close\r\nContent-Length: 0\r\n\r\n`);
}

function accept(req, socket, head, opts = {}) {
  const h = req.headers;
  const key = typeof h['sec-websocket-key'] === 'string' ? h['sec-websocket-key'].trim() : '';
  const upgrade = String(h.upgrade || '').toLowerCase() === 'websocket';
  const connection = String(h.connection || '').toLowerCase().split(',').some((s) => s.trim() === 'upgrade');
  if (req.method !== 'GET' || !upgrade || !connection || !/^[A-Za-z0-9+/]{22}==$/.test(key)) {
    refuse(socket, 400, 'Bad Request');
    return null;
  }
  if (String(h['sec-websocket-version']).trim() !== '13') {
    refuse(socket, 426, 'Upgrade Required', 'Sec-WebSocket-Version: 13\r\n');
    return null;
  }
  const acceptKey = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
  );
  return new Connection(socket, head, opts.maxMessage || DEFAULT_MAX);
}

class Connection extends EventEmitter {
  constructor(socket, head, maxMessage) {
    super();
    this.socket = socket;
    this.maxMessage = maxMessage;
    this.chunks = [];       // received bytes not parsed yet
    this.buffered = 0;
    this.frame = null;      // header of the frame whose payload is awaited
    this.parts = null;      // payloads of the text message being assembled
    this.partsSize = 0;
    this.sentClose = false;
    this.failed = false;    // a protocol violation: nothing more is read
    this.done = false;
    this.closeCode = 1006;
    this.closeReason = '';
    this.closeTimer = null;

    socket.setNoDelay(true);
    socket.setTimeout(0);
    socket.on('data', (chunk) => this.receive(chunk));
    socket.on('error', () => this.finish());
    socket.on('end', () => this.finish());
    socket.on('close', () => this.finish());
    // The caller may have paused the socket while it decided; nothing is read until
    // the caller has attached its listeners, which is after this constructor returns.
    process.nextTick(() => {
      if (head && head.length) this.receive(head);
      socket.resume();
    });
  }

  get bufferedAmount() {
    return this.socket.writableLength || 0;
  }

  send(text) {
    if (this.sentClose || this.done) return false;
    this.write(OP.text, Buffer.from(String(text), 'utf8'));
    return true;
  }

  close(code = 1000, reason = '') {
    if (this.done) return;
    if (!this.sentClose) {
      this.sentClose = true;
      this.closeCode = code;
      this.closeReason = reason;
      let payload = Buffer.alloc(0);
      if (code) {
        // A close reason may be at most 123 bytes; cut on a character boundary.
        let text = Buffer.from(String(reason), 'utf8');
        if (text.length > 123) text = Buffer.from(text.subarray(0, 123).toString('utf8').replace(/\uFFFD+$/, ''), 'utf8');
        payload = Buffer.alloc(2 + text.length);
        payload.writeUInt16BE(code, 0);
        text.copy(payload, 2);
      }
      this.write(OP.close, payload);
    }
    if (!this.closeTimer) {
      this.closeTimer = setTimeout(() => this.terminate(), CLOSE_WAIT);
      this.closeTimer.unref();
    }
  }

  terminate() {
    this.socket.destroy();
    this.finish();
  }

  write(opcode, payload) {
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    if (this.socket.destroyed || !this.socket.writable) return;
    this.socket.cork();
    this.socket.write(header);
    if (len) this.socket.write(payload);
    this.socket.uncork();
  }

  // A protocol violation: say why, stop reading and end the connection.
  fail(code, reason) {
    this.chunks = [];
    this.buffered = 0;
    this.failed = true;
    this.close(code, reason);
    this.socket.end();
  }

  finish() {
    if (this.done) return;
    this.done = true;
    clearTimeout(this.closeTimer);
    this.chunks = [];
    this.parts = null;
    if (!this.socket.destroyed) this.socket.destroy();
    this.emit('close', this.closeCode, this.closeReason);
    this.removeAllListeners('message');
  }

  // Removes and returns the first n buffered bytes (n <= this.buffered).
  take(n) {
    if (n === 0) return Buffer.alloc(0);
    const first = this.chunks[0];
    if (first.length === n) {
      this.chunks.shift();
      this.buffered -= n;
      return first;
    }
    if (first.length > n) {
      this.chunks[0] = first.subarray(n);
      this.buffered -= n;
      return first.subarray(0, n);
    }
    const out = Buffer.allocUnsafe(n);
    let at = 0;
    while (at < n) {
      const c = this.chunks[0];
      const need = n - at;
      if (c.length <= need) {
        c.copy(out, at);
        at += c.length;
        this.chunks.shift();
      } else {
        c.copy(out, at, 0, need);
        this.chunks[0] = c.subarray(need);
        at = n;
      }
    }
    this.buffered -= n;
    return out;
  }

  // The first n buffered bytes without removing them (n <= 14, the longest header).
  peek(n) {
    if (this.chunks[0].length >= n) return this.chunks[0];
    return Buffer.concat(this.chunks, Math.min(this.buffered, 14));
  }

  receive(chunk) {
    if (this.done || this.failed) return;
    this.chunks.push(chunk);
    this.buffered += chunk.length;
    while (!this.done && !this.failed) {
      if (!this.frame) {
        if (this.buffered < 2) return;
        const b = this.peek(2);
        const len7 = b[1] & 0x7f;
        const headerLen = 2 + (len7 === 126 ? 2 : len7 === 127 ? 8 : 0) + 4;
        if (this.buffered < headerLen) return;
        const head = this.peek(headerLen);
        const frame = this.header(head, len7);
        if (!frame) return;
        this.take(headerLen);
        this.frame = frame;
      }
      if (this.buffered < this.frame.length) return;
      const frame = this.frame;
      this.frame = null;
      const payload = this.take(frame.length);
      // Unmask in a copy: the chunk may be shared with the socket's own buffers.
      const data = Buffer.from(payload);
      for (let i = 0; i < data.length; i++) data[i] ^= frame.mask[i & 3];
      this.handle(frame, data);
    }
  }

  // Validates a frame header; null (after failing the connection) when it is not acceptable.
  header(b, len7) {
    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0f;
    if (b[0] & 0x70) return void this.fail(1002, 'reserved bits set');
    if (!(b[1] & 0x80)) return void this.fail(1002, 'client frames must be masked');
    let length = len7;
    let at = 2;
    if (len7 === 126) {
      length = b.readUInt16BE(2);
      at = 4;
    } else if (len7 === 127) {
      const big = b.readBigUInt64BE(2);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) return void this.fail(1009, 'message too big');
      length = Number(big);
      at = 10;
    }
    const control = opcode >= 0x8;
    if (control) {
      if (opcode !== OP.close && opcode !== OP.ping && opcode !== OP.pong) return void this.fail(1002, 'unknown opcode');
      if (!fin || length > 125) return void this.fail(1002, 'bad control frame');
    } else {
      if (opcode !== OP.cont && opcode !== OP.text && opcode !== OP.binary) return void this.fail(1002, 'unknown opcode');
      if (opcode === OP.cont && !this.parts) return void this.fail(1002, 'continuation without a message');
      if (opcode !== OP.cont && this.parts) return void this.fail(1002, 'message interrupted');
      if (opcode === OP.binary) return void this.fail(1003, 'text messages only');
      if (length > this.maxMessage || this.partsSize + length > this.maxMessage) return void this.fail(1009, 'message too big');
    }
    return { fin, opcode, length, mask: Buffer.from(b.subarray(at, at + 4)) };
  }

  handle(frame, data) {
    switch (frame.opcode) {
      case OP.text:
      case OP.cont: {
        if (!this.parts) {
          this.parts = [];
          this.partsSize = 0;
        }
        this.parts.push(data);
        this.partsSize += data.length;
        if (!frame.fin) return;
        const whole = this.parts.length === 1 ? this.parts[0] : Buffer.concat(this.parts, this.partsSize);
        this.parts = null;
        this.partsSize = 0;
        let text;
        try { text = utf8.decode(whole); } catch (e) { return void this.fail(1007, 'invalid UTF-8'); }
        if (this.sentClose) return;
        // A throwing listener must not take the server down with it.
        try { this.emit('message', text); } catch (e) {
          console.error('WebSocket message handler:', e);
          this.close(1011, 'internal error');
        }
        return;
      }
      case OP.ping:
        if (!this.sentClose) this.write(OP.pong, data);
        return;
      case OP.pong:
        return;
      case OP.close: {
        let code = 1005;
        let reason = '';
        if (data.length === 1) return void this.fail(1002, 'bad close frame');
        if (data.length >= 2) {
          code = data.readUInt16BE(0);
          const valid = (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1011) || (code >= 3000 && code <= 4999);
          if (!valid) return void this.fail(1002, 'bad close code');
          try { reason = utf8.decode(data.subarray(2)); } catch (e) { return void this.fail(1007, 'invalid UTF-8'); }
        }
        if (this.sentClose) {
          // Our close was answered: the handshake is complete.
          this.terminate();
          return;
        }
        this.closeCode = code;
        this.closeReason = reason;
        this.sentClose = true;
        this.write(OP.close, code === 1005 ? Buffer.alloc(0) : data.subarray(0, 2));
        // The server closes the TCP connection first (RFC 6455, 7.1.1); end() lets the
        // answer go out before the FIN, and the timer covers a peer that never closes.
        this.socket.end();
        if (!this.closeTimer) {
          this.closeTimer = setTimeout(() => this.terminate(), CLOSE_WAIT);
          this.closeTimer.unref();
        }
      }
    }
  }
}

module.exports = { accept, Connection };
