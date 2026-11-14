/*
  Macros for Luau: a C preprocessor on Luau tokens, run on a file before the bundler
  (darklua) and the language server (luau-lsp) see it. Everything expands here, at
  build time; the game never sees a directive. The same file runs in the browser
  (NT.macro) and in Node (require).

    #define NAME body      #define NAME(a, b) body      #define NAME(fmt, ...) body
    #undef NAME            #include "spec"              #error msg      #warning msg
    #if expr   #ifdef NAME   #ifndef NAME   #elif expr   #else   #endif

  A directive is a line whose first character past blanks is # and a directive's name,
  where code could start a token (never inside a long string or a comment). Any other
  # is Luau's length operator. A line ending in \ goes on to the next. Expansion is C's
  (C23): arguments are expanded first except next to # and ##, #param makes a string,
  ## pastes two tokens into one, and a macro never expands inside its own expansion.
  In a function-like body # makes a string only before a parameter: #t of anything
  else, and #(t), stay lengths. __VA_ARGS__ and __VA_OPT__(…) for variadic macros;
  __FILE__ is opts.path, __LINE__ the line of the outermost use. #if takes defined X,
  numbers in Luau syntax, true and false, strings (for == and ~= only), ! && || == !=
  < <= > >= + - * / // % ?: ( ) and Luau's not and or ~=; any other name is 0.
  #include brings in the macros of another file or library, never its code.

  Line N of the output comes from line N of the input, and there are as many lines.
  Directives and the lines #if skips become empty. A use that spans lines puts its
  whole expansion on its first line and leaves the others empty; text after it keeps
  its column. An expansion never holds a line break: comments in it become a space,
  and long strings and strings with escaped line breaks come back as "…" with \n.
  Lines with no directive and no use come out exactly as they went in.

    NT.macro.uses(text)           false: process would hand the text back unchanged
                                  (unless opts.defines names something in it)
    NT.macro.includes(text)       → [{ spec, line, column }]: every #include, skipped
                                  or not, so a caller can fetch them first
    NT.macro.process(text, opts)  opts: { path, defines: { NAME: 'body' },
                                  include(spec, fromPath) → { macros } | { error } }
                                  → {
      text, plain                 the output; plain when it is the input
      macros                      Map name → { name, params, variadic, body, file, line,
                                  column }: what is defined at the end, includes too
      defines                     [{ name, line, column, endColumn }]: this file's #defines
      uses                        [{ name, line, column, endLine, endColumn, expansion,
                                  macro }]: every outermost use
      inactive                    [[from, to]]: lines #if skipped, without the directives
                                  that start and end the skipping (those inside count)
      directives                  [{ line, endLine, kind }]: every one, skipped or not
      diagnostics                 [{ line, column, endLine, endColumn, message, severity }]
      visible(line)               names defined where that line starts, then __FILE__
                                  and __LINE__
      toSource(line, column)      output → input: { line, column, exact }. Copied tokens
                                  are exact; a macro body's text is the use's start
      toOutput(line, column)      input → output: { line, column }, or null on a
                                  directive or a skipped line
    }
    NT.macro.serialize(macros)    #define lines that process reads back as those macros

  Lines and columns count from 1, columns in UTF-16 units, end columns just past the
  end. Errors in the input are diagnostics, never a throw. include is called at once
  (no promise) and must stop include cycles itself; params lists the named
  parameters, variadic says whether ... follows them.

  Where this is not C: #if counts as Luau does (/ divides, // floors, % is Luau's);
  a directive inside a call's arguments is an error, and the call is left as written; \ at a line's
  end splices as a blank (inside a string it is Luau's escaped line break); a use
  gets a space at either edge when it would run into the code beside it (1-NEG is
  1- -1, not a comment); a use stops after 2^20 tokens.
*/
(function () {
  'use strict';

  // Token kinds. IS is a whole `…`; IO `…{, IM }…{ and IC }…` are the pieces of one
  // around its holes. PM is a placemarker, DIR a directive.
  const ID = 1, NUM = 2, STR = 3, LONG = 4, IS = 5, IO = 6, IM = 7, IC = 8, OP = 9, PM = 10, DIR = 11;

  const DIRECTIVE = /#[ \t]*(define|undef|ifdef|ifndef|if|elif|else|endif|include|error|warning)(?![A-Za-z0-9_])/y;
  const USES = /^[ \t\v\f]*#[ \t]*(?:define|undef|ifn?def|if|elif|else|endif|include|error|warning)(?![A-Za-z0-9_])|__(?:FILE|LINE)__/m;
  // As Luau reads a number: digits and dots, an exponent's sign, then any word characters.
  const NUMBER = /(?:\d|\.\d)[\d._]*(?:[eE][+-]?)?[A-Za-z0-9_]*/y;
  const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const BREAK = /[\r\n]/;
  // != && || are not Luau; they are read whole for #if.
  const OPS2 = new Set(['..', '==', '~=', '<=', '>=', '::', '->', '+=', '-=', '*=', '/=', '%=', '^=', '//', '!=', '&&', '||', '##']);
  // Two characters that, written together, would read as one token (or a comment).
  const PAIRS = new Set(['==', '~=', '<=', '>=', '!=', '::', '->', '+=', '-=', '*=', '/=', '//', '%=', '^=', '.=', '--', '[[', '[=', '&&', '||', '##']);
  const RESERVED = new Set(['defined', '__FILE__', '__LINE__', '__VA_ARGS__', '__VA_OPT__']);
  const LIMIT = 1 << 20; // tokens one use may produce
  const TOO_BIG = new Error('expansion too large');
  const MAX_DIAGNOSTICS = 200;

  const isSpace = (c) => c === 32 || (c >= 9 && c <= 13);
  const isWord = (c) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95;
  const isDigit = (c) => c >= 48 && c <= 57;

  const builtin = (name) => Object.freeze({ name, params: null, variadic: false, body: '', file: null, line: 0, column: 0, builtin: true });
  const BUILTINS = { __FILE__: builtin('__FILE__'), __LINE__: builtin('__LINE__') };

  /* ---------- Lexing ---------- */

  // `[` `=`* `[` at i: its level, or -1.
  function level(src, i) {
    let j = i + 1;
    while (src.charCodeAt(j) === 61) j++;
    return src.charCodeAt(j) === 91 ? j - i - 1 : -1;
  }

  const CLOSERS = [];
  // The end of the long bracket at i; ~end when it never closes.
  function long(src, i, lv) {
    const close = CLOSERS[lv] || (CLOSERS[lv] = ']' + '='.repeat(lv) + ']');
    const at = src.indexOf(close, i + lv + 2);
    return at < 0 ? ~src.length : at + lv + 2;
  }

  // A quoted string, or a piece of an interpolated one, from just past its opening:
  // its end (past `quote`, or past `open`, which opens a hole), or ~end when a line
  // break or the text comes first. \z takes the blanks after it, \ a line break.
  function quoted(src, j, quote, open) {
    const n = src.length;
    for (; j < n; j++) {
      const c = src.charCodeAt(j);
      if (c === quote || c === open) return j + 1;
      if (c === 10 || c === 13) return ~j;
      if (c === 92) {
        j++;
        const d = src.charCodeAt(j);
        if (d === 122) while (j + 1 < n && isSpace(src.charCodeAt(j + 1))) j++;
        else if (d === 13 && src.charCodeAt(j + 1) === 10) j++;
      }
    }
    return ~n;
  }

  // The end of the comment at i (`--`).
  function comment(src, i) {
    if (src.charCodeAt(i + 2) === 91) {
      const lv = level(src, i + 2);
      if (lv >= 0) {
        const e = long(src, i + 2, lv);
        return e < 0 ? ~e : e;
      }
    }
    const nl = src.indexOf('\n', i);
    return nl < 0 ? src.length : nl;
  }

  // In a directive a line comment goes on past a line that ends in \, as in C.
  function lineComment(src, j) {
    for (;;) {
      const nl = src.indexOf('\n', j);
      if (nl < 0) return src.length;
      let b = nl - 1;
      while (b > j && (src.charCodeAt(b) === 13 || src.charCodeAt(b) === 32 || src.charCodeAt(b) === 9)) b--;
      if (src.charCodeAt(b) !== 92) return nl;
      j = nl + 1;
    }
  }

  // \ at j, then blanks and a line break: where the next line starts, or -1.
  function splice(src, j) {
    let k = j + 1;
    while (src.charCodeAt(k) === 32 || src.charCodeAt(k) === 9) k++;
    if (src.charCodeAt(k) === 13) k++;
    return src.charCodeAt(k) === 10 ? k + 1 : -1;
  }

  // The token at i. `holes` is the brace depth in each open hole of an interpolated
  // string, kept up to date. bad: a string or comment the text ends inside.
  function token(src, i, ws, holes) {
    const c = src.charCodeAt(i);
    let k = OP, e;
    if ((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95) {
      e = i + 1;
      while (isWord(src.charCodeAt(e))) e++;
      k = ID;
    } else if (isDigit(c) || (c === 46 && isDigit(src.charCodeAt(i + 1)))) {
      NUMBER.lastIndex = i;
      NUMBER.test(src);
      e = NUMBER.lastIndex;
      k = NUM;
    } else if (c === 34 || c === 39) {
      e = quoted(src, i + 1, c, -1);
      k = STR;
    } else if (c === 91 && level(src, i) >= 0) {
      e = long(src, i, level(src, i));
      k = LONG;
    } else if (c === 96 || (c === 125 && holes.length && holes[holes.length - 1] === 0)) {
      if (c === 125) holes.pop();
      e = quoted(src, i + 1, 96, 123);
      const open = e > 0 && src.charCodeAt(e - 1) === 123;
      if (open) holes.push(0);
      k = c === 96 ? (open ? IO : IS) : (open ? IM : IC);
    } else {
      const three = src.substr(i, 3);
      e = i + (three === '...' || three === '..=' || three === '//=' ? 3 : OPS2.has(src.substr(i, 2)) ? 2 : 1);
      if (holes.length) {
        if (c === 123) holes[holes.length - 1]++;
        else if (c === 125) holes[holes.length - 1]--;
      }
    }
    const bad = e < 0;
    if (bad) e = ~e;
    return { k, v: src.slice(i, e), s: i, e, ws, hs: null, bad };
  }

  // Tokens one at a time, and directives whole. dirs: whether to look for directives.
  class Lexer {
    constructor(src, dirs) {
      this.src = src;
      this.dirs = dirs;
      this.pos = 0;
      this.bol = true;   // only blanks since the line began
      this.holes = [];
      this.ahead = null;
    }

    next() {
      const t = this.ahead || this.scan();
      this.ahead = null;
      return t;
    }

    peek() {
      return this.ahead || (this.ahead = this.scan());
    }

    save() {
      return { pos: this.pos, bol: this.bol, holes: this.holes.slice(), ahead: this.ahead };
    }

    restore(s) {
      this.pos = s.pos;
      this.bol = s.bol;
      this.holes = s.holes;
      this.ahead = s.ahead;
    }

    scan() {
      const src = this.src, n = src.length;
      let i = this.pos, ws = false, bol = this.bol;
      for (;;) {
        if (i >= n) {
          this.pos = n;
          this.bol = bol;
          return null;
        }
        const c = src.charCodeAt(i);
        if (c === 10) {
          i++;
          ws = bol = true;
        } else if (isSpace(c)) {
          i++;
          ws = true;
        } else if (c === 45 && src.charCodeAt(i + 1) === 45) {
          i = comment(src, i);
          ws = true;
          bol = false;
        } else break;
      }
      if (bol && this.dirs && src.charCodeAt(i) === 35) {
        DIRECTIVE.lastIndex = i;
        const m = DIRECTIVE.exec(src);
        if (m) return this.directive(i, m[1], i + m[0].length);
      }
      const t = token(src, i, ws, this.holes);
      this.pos = t.e;
      this.bol = false;
      return t;
    }

    // A directive from its # at s, its name ending at j. It runs to the end of the line,
    // and on past a line ending in \ and past strings and comments that span lines.
    directive(s, name, j) {
      const src = this.src, n = src.length;
      const kw = j, toks = [], holes = [], flaws = [];
      let ws = true;
      while (j < n) {
        const c = src.charCodeAt(j);
        if (c === 10) break;
        if (isSpace(c)) {
          j++;
          ws = true;
          continue;
        }
        if (c === 92) {
          const after = splice(src, j);
          if (after >= 0) {
            j = after;
            ws = true;
            continue;
          }
        }
        if (c === 45 && src.charCodeAt(j + 1) === 45) {
          const lv = src.charCodeAt(j + 2) === 91 ? level(src, j + 2) : -1;
          let e = lv >= 0 ? long(src, j + 2, lv) : lineComment(src, j);
          if (e < 0) {
            flaws.push([j, 'unfinished comment']);
            e = ~e;
          }
          j = e;
          ws = true;
          continue;
        }
        const t = token(src, j, ws, holes);
        if (t.bad) flaws.push([j, t.k === LONG ? 'unfinished long string' : 'unfinished string']);
        toks.push(t);
        j = t.e;
        ws = false;
      }
      this.pos = j;
      this.bol = false;
      return { k: DIR, name, s, e: j, kw, toks, flaws };
    }
  }

  function lexAll(text) {
    const lx = new Lexer(text, false), out = [];
    for (let t; (t = lx.next());) out.push(t);
    return out;
  }

  // The one token `text` is, or null.
  function lexOne(text) {
    const t = new Lexer(text, false).next();
    if (!t || t.s !== 0 || t.e !== text.length || t.bad || t.k === IO || t.k === IM || t.k === IC) return null;
    return t;
  }

  function starts(text) {
    const ls = [0, 0];
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) ls.push(i + 1);
    return ls;
  }

  // The line (from 1) that offset `off` is on.
  function lineIn(ls, off) {
    let lo = 1, hi = ls.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ls[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /* ---------- Strings ---------- */

  const ESCAPES = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r' };
  const SIMPLE = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };

  // A Luau string literal holding `value`, on one line.
  function quote(value) {
    return '"' + value.replace(/[\\"\x00-\x08\x0a-\x1f\x7f]/g, (c) => ESCAPES[c] || '\\' + String(c.charCodeAt(0)).padStart(3, '0')) + '"';
  }

  // What a long string holds: Luau drops the first line break and reads \r\n as \n.
  function longValue(v, bad) {
    const lv = level(v, 0);
    let body = v.slice(lv + 2, bad ? v.length : v.length - lv - 2);
    if (body.startsWith('\r\n')) body = body.slice(2);
    else if (body[0] === '\n') body = body.slice(1);
    return body.replace(/\r\n/g, '\n');
  }

  // A quoted string's escaped line breaks as \n, and \z with its blanks gone.
  function unbreak(v) {
    let out = '', last = 0;
    for (let i = 0; i < v.length; i++) {
      if (v.charCodeAt(i) !== 92) continue;
      const c = v.charCodeAt(i + 1);
      if (c === 10 || c === 13) {
        out += v.slice(last, i) + '\\n';
        i += c === 13 && v.charCodeAt(i + 2) === 10 ? 2 : 1;
        last = i + 1;
      } else if (c === 122) {
        out += v.slice(last, i);
        let j = i + 2;
        while (j < v.length && isSpace(v.charCodeAt(j))) j++;
        last = j;
        i = j - 1;
      } else i++;
    }
    return out + v.slice(last);
  }

  // A token as an expansion writes it: on one line, with the same value.
  function spell(t) {
    const v = t.v;
    if (t.k < STR || t.k > IC || !BREAK.test(v)) return v;
    return t.k === LONG ? quote(longValue(v, t.bad)) : unbreak(v);
  }

  // What a string token holds.
  function strValue(t) {
    if (t.k === LONG) return longValue(t.v, t.bad);
    const body = t.v.slice(1, t.bad ? t.v.length : -1);
    return body.replace(/\\(?:(\d{1,3})|x([0-9a-fA-F]{2})|u\{([0-9a-fA-F]{1,6})\}|z\s*|(\r\n?|\n)|([\s\S]))/g, (m, d, x, u, nl, c) => {
      if (d) return String.fromCharCode(Number(d) & 255);
      if (x) return String.fromCharCode(parseInt(x, 16));
      if (u) return parseInt(u, 16) <= 0x10ffff ? String.fromCodePoint(parseInt(u, 16)) : '';
      if (nl) return '\n';
      if (c) return SIMPLE[c] !== undefined ? SIMPLE[c] : c;
      return '';
    });
  }

  // A number in Luau syntax, or null.
  function number(text) {
    const s = text.replace(/_/g, '');
    if (/^0[xX][0-9a-fA-F]+$/.test(s)) return parseInt(s.slice(2), 16);
    if (/^0[bB][01]+$/.test(s)) return parseInt(s.slice(2), 2);
    if (/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return Number(s);
    return null;
  }

  // Whether two tokens, the first ending in l and the second starting with r, would
  // read as something else written together. num: the first is a number.
  function glue(l, r, num) {
    if (isWord(l) && isWord(r)) return true;
    if (num && (r === 46 || ((l === 101 || l === 69) && (r === 43 || r === 45)))) return true;
    if (l === 46 && (r === 46 || isDigit(r))) return true;
    return PAIRS.has(String.fromCharCode(l, r));
  }

  /* ---------- Definitions ---------- */

  const copy = (t, ws, hs) => ({ k: t.k, v: t.v, s: t.s, e: t.e, ws, hs, bad: t.bad });
  const make = (k, v, ws, hs) => ({ k, v, s: -1, e: -1, ws, hs, bad: false });
  const isOp = (t, v) => !!t && t.k === OP && t.v === v;

  // Body tokens as kept: on one line, a long string as "…", ## marked as the operator.
  function prepare(toks) {
    return toks.map((t, i) => {
      const v = spell(t);
      return { k: t.k === LONG && v !== t.v ? STR : t.k, v, s: -1, e: -1, ws: i > 0 && t.ws, hs: null, bad: t.bad, op: t.k === OP && t.v === '##' };
    });
  }

  const bodyText = (toks) => toks.map((t, i) => (i && t.ws ? ' ' : '') + t.v).join('');

  // A definition's body as tokens and its parameters' places, made once per definition.
  const compiled = new WeakMap();
  function compile(def, body) {
    let c = compiled.get(def);
    if (c) return c;
    c = { body: body || prepare(lexAll(String(def.body == null ? '' : def.body))), idx: new Map() };
    const params = Array.isArray(def.params) ? def.params : [];
    params.forEach((p, i) => c.idx.set(p, i));
    if (def.variadic) c.idx.set('__VA_ARGS__', params.length);
    compiled.set(def, c);
    return c;
  }

  const same = (a, b) => a.body === b.body && !!a.variadic === !!b.variadic && String(a.params) === String(b.params);

  // The index of the ) that closes the ( at i in a body, or -1.
  function closing(body, i) {
    if (!isOp(body[i], '(')) return -1;
    for (let d = 0; i < body.length; i++) {
      const t = body[i];
      if (t.k !== OP) continue;
      if (t.v === '(') d++;
      else if (t.v === ')' && --d === 0) return i;
    }
    return -1;
  }

  function stringify(toks) {
    let s = '';
    for (let i = 0; i < toks.length; i++) s += (i && toks[i].ws ? ' ' : '') + toks[i].v;
    return quote(s);
  }

  // Hide sets: the macros a token came out of, which it never expands again.
  function plus(hs, name) {
    const out = new Set(hs || undefined);
    out.add(name);
    return out;
  }

  function both(a, b) {
    if (!a || !b) return null;
    const out = new Set();
    for (const x of a) if (b.has(x)) out.add(x);
    return out.size ? out : null;
  }

  function union(a, b) {
    if (a === b || !b) return a;
    if (!a) return b;
    let all = true;
    for (const x of b) if (!a.has(x)) { all = false; break; }
    if (all) return a;
    const out = new Set(a);
    for (const x of b) out.add(x);
    return out;
  }

  // Where expansion reads from: tokens put back (last first), then the file, if any.
  // It stops at a directive. mark() and reset() take back what a failed call read.
  class Reader {
    constructor(stack, run, lex) {
      this.stack = stack;
      this.run = run;
      this.lex = lex;
      this.log = null;
    }

    take() {
      if (this.stack.length) {
        const t = this.stack.pop();
        if (this.log) this.log.push(t);
        return t;
      }
      if (!this.lex) return null;
      const t = this.lex.peek();
      if (!t || t.k === DIR) return null;
      this.lex.next();
      this.run.last = t.e;
      return t;
    }

    peek() {
      if (this.stack.length) return this.stack[this.stack.length - 1];
      const t = this.lex && this.lex.peek();
      return t && t.k !== DIR ? t : null;
    }

    mark() {
      this.log = [];
      return { lex: this.lex && this.lex.save(), last: this.run.last };
    }

    keep() {
      this.log = null;
    }

    reset(m) {
      const log = this.log;
      this.log = null;
      for (let i = log.length - 1; i >= 0; i--) this.stack.push(log[i]);
      if (m.lex) this.lex.restore(m.lex);
      this.run.last = m.last;
    }
  }

  /* ---------- #if ---------- */

  class CalcError extends Error {
    constructor(message, t) {
      super(message);
      this.t = t;
    }
  }

  const PREC = Object.assign(Object.create(null), {
    or: 1, '||': 1, and: 2, '&&': 2, '==': 3, '!=': 3, '~=': 3,
    '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '//': 6, '%': 6,
  });
  const opOf = (t) => (t && (t.k === OP || (t.k === ID && (t.v === 'and' || t.v === 'or'))) ? t.v : null);

  function truth(v, t) {
    if (typeof v === 'string') throw new CalcError('a string is not a condition', t);
    return v !== 0;
  }

  function apply(op, l, r, t, live) {
    if (op === '==') return l === r ? 1 : 0;
    if (op === '!=' || op === '~=') return l !== r ? 1 : 0;
    if (typeof l === 'string' || typeof r === 'string') throw new CalcError('strings can only be compared with == or ~=', t);
    switch (op) {
      case '<': return l < r ? 1 : 0;
      case '<=': return l <= r ? 1 : 0;
      case '>': return l > r ? 1 : 0;
      case '>=': return l >= r ? 1 : 0;
      case '+': return l + r;
      case '-': return l - r;
      case '*': return l * r;
    }
    if (r === 0) {
      if (live) throw new CalcError('division by zero in #if', t);
      return 0;
    }
    if (op === '/') return l / r;
    if (op === '//') return Math.floor(l / r);
    return l - Math.floor(l / r) * r;
  }

  // An #if expression, from its expanded tokens. Values are numbers (true is 1) or
  // strings; what is not evaluated (live false) cannot divide by zero.
  class Calc {
    constructor(toks, run) {
      this.toks = toks;
      this.i = 0;
      this.run = run;
    }

    value() {
      if (!this.toks.length) throw new CalcError('#if needs an expression', null);
      const v = this.cond(true);
      const t = this.toks[this.i];
      if (t) throw new CalcError(`unexpected ${t.v} in #if`, t);
      return truth(v, null);
    }

    cond(live) {
      const c = this.binary(1, live);
      const q = this.toks[this.i];
      if (!isOp(q, '?')) return c;
      this.i++;
      const yes = truth(c, q);
      const a = this.cond(live && yes);
      const colon = this.toks[this.i];
      if (!isOp(colon, ':')) throw new CalcError('missing : in #if', colon || q);
      this.i++;
      const b = this.cond(live && !yes);
      return yes ? a : b;
    }

    binary(min, live) {
      let l = this.unary(live);
      for (;;) {
        const t = this.toks[this.i];
        const op = opOf(t);
        const p = op ? PREC[op] : 0;
        if (!p || p < min) return l;
        this.i++;
        if (p <= 2) {
          const lt = truth(l, t);
          const rt = truth(this.binary(p + 1, live && (p === 1 ? !lt : lt)), t);
          l = (p === 1 ? lt || rt : lt && rt) ? 1 : 0;
        } else {
          l = apply(op, l, this.binary(p + 1, live), t, live);
        }
      }
    }

    unary(live) {
      const t = this.toks[this.i];
      if (!t) throw new CalcError('missing value in #if', this.toks[this.i - 1] || null);
      if (isOp(t, '!') || (t.k === ID && t.v === 'not')) {
        this.i++;
        return truth(this.unary(live), t) ? 0 : 1;
      }
      if (isOp(t, '-') || isOp(t, '+')) {
        this.i++;
        const v = this.unary(live);
        if (typeof v === 'string') throw new CalcError(`cannot use ${t.v} on a string`, t);
        return t.v === '-' ? -v : v;
      }
      return this.primary(live);
    }

    primary(live) {
      const t = this.toks[this.i++];
      if (t.k === NUM) {
        const n = number(t.v);
        if (n === null) throw new CalcError(`bad number ${t.v}`, t);
        return n;
      }
      if (t.k === STR || t.k === LONG || t.k === IS) return strValue(t);
      if (t.k === ID) {
        if (t.v === 'true') return 1;
        if (t.v === 'false') return 0;
        if (t.v === 'defined') {
          const r = this.run.definedOp(this.toks, this.i - 1);
          if (!r) throw new CalcError('defined needs a name', t);
          this.i = r.next;
          return r.value ? 1 : 0;
        }
        return 0;
      }
      if (isOp(t, '(')) {
        const v = this.cond(live);
        const c = this.toks[this.i];
        if (!isOp(c, ')')) throw new CalcError('missing ) in #if', c || t);
        this.i++;
        return v;
      }
      throw new CalcError(`unexpected ${t.v} in #if`, t);
    }
  }

  /* ---------- A run over one file ---------- */

  class Run {
    constructor(text, opts) {
      this.src = text;
      this.path = opts.path == null ? '' : String(opts.path);
      this.fetch = typeof opts.include === 'function' ? opts.include : null;
      this.macros = new Map();
      this.diagnostics = [];
      this.seen = new Set();
      this.defines = [];
      this.uses = [];
      this.spans = [];       // per use: { a, b, text, pieces, lead, oline, ocol }
      this.inactive = [];
      this.directives = [];
      this.events = [];      // { line, name, def | null }: the table changing, for visible
      this.reps = [];        // { a, b, text, span }: source ranges the output replaces
      this.frames = [];      // open #if groups
      this.active = true;
      this.deadFrom = 1;     // first line not yet blanked of the region being skipped
      this.deadStart = 1;    // first line of the region being skipped
      this.here = null;      // [s, e]: what errors from inside an expansion point at
      this.useLine = 1;
      this.last = 0;         // end of the last source token a use has read
      this.work = 0;
      this.starts = null;
      this.segs = null;
      this.blank = null;
    }

    lineOf(off) {
      return lineIn(this.starts, off);
    }

    pos(off) {
      const line = this.lineOf(off);
      return { line, column: off - this.starts[line] + 1 };
    }

    // Where line L's text ends, before its line break.
    end(L) {
      const ls = this.starts;
      if (L >= ls.length - 1) return this.src.length;
      let e = ls[L + 1] - 1;
      if (e > ls[L] && this.src.charCodeAt(e - 1) === 13) e--;
      return e;
    }

    diag(s, e, message, severity) {
      if (s < 0) [s, e] = this.here || [0, 0];
      const key = s + ':' + message;
      if (this.seen.has(key) || this.diagnostics.length >= MAX_DIAGNOSTICS) return;
      this.seen.add(key);
      const a = this.pos(s), b = this.pos(Math.max(s, e));
      this.diagnostics.push({ line: a.line, column: a.column, endLine: b.line, endColumn: b.column, message, severity: severity || 'error' });
    }

    err(t, message) {
      this.diag(t.s, t.e, message, 'error');
    }

    warn(t, message) {
      this.diag(t.s, t.e, message, 'warning');
    }

    has(name) {
      return this.macros.has(name) || name === '__FILE__' || name === '__LINE__';
    }

    put(def, at, line) {
      const old = this.macros.get(def.name);
      if (old && !same(old, def)) this.warn(at, `${def.name} redefined`);
      this.macros.set(def.name, def);
      this.events.push({ line, name: def.name, def });
    }

    predefine(defines) {
      if (!defines || typeof defines !== 'object') return;
      for (const name of Object.keys(defines)) {
        if (!NAME.test(name) || RESERVED.has(name)) {
          this.diagnostics.push({ line: 1, column: 1, endLine: 1, endColumn: 1, message: `bad predefined macro ${name}`, severity: 'error' });
          continue;
        }
        const body = prepare(lexAll(String(defines[name] == null ? '' : defines[name])));
        const def = { name, params: null, variadic: false, body: bodyText(body), file: null, line: 0, column: 0 };
        compile(def, body);
        this.macros.set(name, def);
        this.events.push({ line: 0, name, def });
      }
    }

    /* The file, token by token: directives as they come, uses where code is live. */
    go() {
      this.starts = starts(this.src);
      const lex = new Lexer(this.src, true);
      const rd = new Reader([], this, lex);
      for (;;) {
        const t = lex.next();
        if (!t) break;
        if (t.k === DIR) {
          this.directive(t);
          continue;
        }
        if (!this.active || t.k !== ID || !this.has(t.v)) continue;
        this.useLine = this.lineOf(t.s);
        this.last = t.e;
        this.here = [t.s, t.e];
        this.work = 0;
        const out = [];
        try {
          if (!this.step(t, rd)) continue;
          while (rd.stack.length) {
            const x = rd.stack.pop();
            if (!this.step(x, rd)) out.push(x);
          }
        } catch (e) {
          if (e !== TOO_BIG && !(e instanceof RangeError)) throw e;
          this.err(t, e === TOO_BIG ? 'expansion too large' : 'expansion too deep');
          rd.stack.length = 0;
          rd.log = null;
        }
        this.use(t, out);
      }
      this.finish();
    }

    // Expands t if it is a macro to expand here: what it becomes goes back on rd, to be
    // read again. False leaves t as it is.
    step(t, rd) {
      if (t.k !== ID || (t.hs && t.hs.has(t.v))) return false;
      const def = this.macros.get(t.v);
      if (!def) {
        if (t.v === '__LINE__') rd.stack.push(make(NUM, String(this.useLine), t.ws, t.hs));
        else if (t.v === '__FILE__') rd.stack.push(make(STR, quote(this.path), t.ws, t.hs));
        else return false;
        return true;
      }
      const c = compile(def);
      if (!Array.isArray(def.params)) {
        this.push(rd, this.subst(def, c, null, t, plus(t.hs, t.v)));
        return true;
      }
      if (!isOp(rd.peek(), '(')) return false;
      const m = rd.mark();
      const call = this.collect(rd, def, t);
      if (!call) {
        rd.reset(m);
        return false;
      }
      rd.keep();
      this.push(rd, this.subst(def, c, call.args, t, plus(both(t.hs, call.close.hs), t.v)));
      return true;
    }

    push(rd, toks) {
      if ((this.work += toks.length + 1) > LIMIT) throw TOO_BIG;
      for (let i = toks.length - 1; i >= 0; i--) rd.stack.push(toks[i]);
    }

    // A call's arguments, from its ( on: { args, close }, or null when there is none.
    // Commas split at the top level only, past () {} [] and interpolated strings.
    collect(rd, def, name) {
      rd.take();
      const args = [[]], commas = [];
      let p = 0, b = 0;
      for (;;) {
        // Calls nested in arguments are read again at each level: counted, so deep
        // nesting stops here and not in memory.
        if (++this.work > LIMIT) throw TOO_BIG;
        const t = rd.take();
        if (!t) {
          const dir = rd.lex && !rd.stack.length && rd.lex.peek();
          this.err(name, dir ? `directive inside the arguments of ${name.v}` : `unterminated call to ${name.v}`);
          return null;
        }
        if (t.k === OP) {
          const v = t.v;
          if (v === '(') p++;
          else if (v === ')') {
            if (p === 0) return this.count(def, name, args, commas, t);
            p--;
          } else if (v === ',' && p === 0 && b === 0) {
            commas.push(t);
            args.push([]);
            continue;
          } else if (v === '{' || v === '[') b++;
          else if ((v === '}' || v === ']') && b > 0) b--;
        } else if (t.k === IO) b++;
        else if (t.k === IC && b > 0) b--;
        args[args.length - 1].push(t);
      }
    }

    count(def, name, args, commas, close) {
      const np = def.params.length;
      if (np === 0 && args.length === 1 && !args[0].length) args = [];
      const s = (n) => `${n} argument${n === 1 ? '' : 's'}`;
      if (def.variadic) {
        if (args.length < np) {
          this.err(name, `${name.v} expects at least ${s(np)}, got ${args.length}`);
          return null;
        }
        const va = [];
        for (let i = np; i < args.length; i++) {
          if (i > np) va.push(commas[i - 1]);
          for (const t of args[i]) va.push(t);
        }
        args = args.slice(0, np);
        args.push(va);
      } else if (args.length !== np) {
        this.err(name, `${name.v} expects ${s(np)}, got ${args.length}`);
        return null;
      }
      return { args, close };
    }

    // The body with the arguments put in, pasted, and hide set hs added.
    subst(def, c, args, name, hs) {
      const r = [];
      this.fill({ def, c, args, done: args ? new Array(args.length) : null }, 0, c.body.length, r);
      const out = [];
      for (const t of this.paste(r)) if (t.k !== PM) out.push(copy(t, t.ws, union(hs, t.hs)));
      if (out.length) out[0].ws = name.ws;
      return out;
    }

    fill(ctx, from, to, r) {
      const { body, idx } = ctx.c;
      const fn = !!ctx.args, va = !!ctx.def.variadic;
      for (let i = from; i < to; i++) {
        const t = body[i];
        if (fn && t.k === OP && t.v === '#' && i + 1 < to && body[i + 1].k === ID) {
          const n = body[i + 1];
          const pi = idx.get(n.v);
          if (pi !== undefined) {
            r.push(make(STR, stringify(ctx.args[pi]), t.ws, null));
            i++;
            continue;
          }
          const close = va && n.v === '__VA_OPT__' ? closing(body, i + 2) : -1;
          if (close > 0 && close < to) {
            r.push(make(STR, stringify(this.opt(ctx, i + 3, close)), t.ws, null));
            i = close;
            continue;
          }
        }
        if (fn && t.k === ID) {
          const pi = idx.get(t.v);
          if (pi !== undefined) {
            const glued = (i > from && body[i - 1].op) || (i + 1 < to && body[i + 1].op);
            this.place(r, glued ? ctx.args[pi] : this.arg(ctx, pi), t.ws);
            continue;
          }
          const close = va && t.v === '__VA_OPT__' ? closing(body, i + 1) : -1;
          if (close > 0 && close < to) {
            this.place(r, this.opt(ctx, i + 2, close), t.ws);
            i = close;
            continue;
          }
        }
        r.push(t);
      }
    }

    // An argument's tokens into r, the first spaced as the parameter was; none leaves
    // a placemarker.
    place(r, toks, ws) {
      if (!toks.length) {
        r.push(make(PM, '', ws, null));
        return;
      }
      r.push(copy(toks[0], ws, toks[0].hs));
      for (let i = 1; i < toks.length; i++) r.push(toks[i]);
    }

    arg(ctx, i) {
      return ctx.done[i] || (ctx.done[i] = this.expandList(ctx.args[i]));
    }

    // What __VA_OPT__(…) becomes: nothing unless the variable arguments expand to something.
    opt(ctx, from, to) {
      if (!this.arg(ctx, ctx.args.length - 1).length) return [];
      const r = [];
      this.fill(ctx, from, to, r);
      return this.paste(r).filter((t) => t.k !== PM);
    }

    paste(r) {
      const out = [];
      for (let i = 0; i < r.length; i++) {
        const t = r[i];
        if (!t.op || !out.length || i + 1 >= r.length) {
          out.push(t);
          continue;
        }
        const l = out.pop(), rt = r[++i];
        if (l.k === PM) out.push(rt);
        else if (rt.k === PM) out.push(l);
        else {
          const v = l.v + rt.v;
          const one = lexOne(v);
          if (one) out.push(make(one.k, v, l.ws, null));
          else {
            this.diag(-1, -1, `pasting ${l.v} and ${rt.v} does not give a valid token`);
            out.push(l, rt);
          }
        }
      }
      return out;
    }

    // A list of tokens fully expanded, as if it were all there was.
    expandList(list) {
      let any = false;
      for (const t of list) if (t.k === ID && this.has(t.v)) { any = true; break; }
      if (!any) return list;
      const rd = new Reader(list.slice().reverse(), this, null);
      const out = [];
      while (rd.stack.length) {
        const t = rd.stack.pop();
        if (!this.step(t, rd)) out.push(t);
      }
      return out;
    }

    numBefore(a) {
      const src = this.src;
      let j = a - 1;
      while (j >= 0 && (isWord(src.charCodeAt(j)) || src.charCodeAt(j) === 46)) j--;
      const c = src.charCodeAt(j + 1);
      return isDigit(c) || (c === 46 && isDigit(src.charCodeAt(j + 2)));
    }

    // An outermost use, from t to the last source token read, and what it became.
    use(t, out) {
      const src = this.src, a = t.s, b = this.last;
      const pieces = [];
      let text = '', pv = '', pk = 0;
      for (const x of out) {
        const v = spell(x);
        if (!v) continue;
        if (pv && (x.ws || glue(pv.charCodeAt(pv.length - 1), v.charCodeAt(0), pk === NUM))) text += ' ';
        if (x.s >= 0) pieces.push({ o: text.length, len: v.length, s: x.s, e: x.e, flat: v !== x.v });
        text += v;
        pv = v;
        pk = x.k;
      }
      const expansion = text;
      // Kept from running into the code around it.
      const before = a > 0 ? src.charCodeAt(a - 1) : 32;
      const after = b < src.length ? src.charCodeAt(b) : 32;
      let lead = 0;
      if (text) {
        if (!isSpace(before) && glue(before, text.charCodeAt(0), this.numBefore(a))) lead = 1;
        if (!isSpace(after) && glue(pv.charCodeAt(pv.length - 1), after, pk === NUM)) text += ' ';
      } else if (!isSpace(before) && !isSpace(after) && glue(before, after, this.numBefore(a))) text = ' ';
      if (lead) {
        text = ' ' + text;
        for (const p of pieces) p.o++;
      }
      const p = this.pos(a), q = this.pos(b);
      const span = { a, b, text, pieces, lead, oline: p.line, ocol: p.column - 1 };
      this.spans.push(span);
      this.reps.push({ a, b, text, span });
      this.uses.push({ name: t.v, line: p.line, column: p.column, endLine: q.line, endColumn: q.column, expansion, macro: this.macros.get(t.v) || BUILTINS[t.v] });
    }

    /* Directives. Each blanks its lines, and while #if skips, the lines before it too. */
    directive(d) {
      const L1 = this.lineOf(d.s), L2 = this.lineOf(d.e);
      const was = this.active;
      this.directives.push({ line: L1, endLine: L2, kind: d.name });
      this.reps.push({ a: this.starts[was ? L1 : this.deadFrom], b: this.end(L2), text: '', span: null });
      this.here = [d.s, d.e];
      if (was) for (const [s, message] of d.flaws) this.diag(s, s + 1, message);
      const f = this.frames[this.frames.length - 1];
      switch (d.name) {
        case 'if':
        case 'ifdef':
        case 'ifndef': {
          let c = false;
          if (was && d.name === 'if') c = this.test(d);
          else if (was) {
            const v = this.defined(d);
            c = v !== null && v === (d.name === 'ifdef');
          }
          this.frames.push({ d, parent: was, taking: c, done: !was || c, other: false });
          break;
        }
        case 'elif':
          if (!f) this.err(d, '#elif without #if');
          else if (f.other) {
            this.err(d, '#elif after #else');
            f.taking = false;
          } else if (!f.parent || f.done) f.taking = false;
          else f.taking = f.done = this.test(d);
          break;
        case 'else':
          if (!f) {
            this.err(d, '#else without #if');
            break;
          }
          if (f.other) this.err(d, '#else after #else');
          else if (f.parent && d.toks.length) this.warn(d.toks[0], 'extra tokens after #else');
          f.other = true;
          f.taking = f.parent && !f.done;
          f.done = true;
          break;
        case 'endif':
          if (!f) {
            this.err(d, '#endif without #if');
            break;
          }
          if (f.parent && d.toks.length) this.warn(d.toks[0], 'extra tokens after #endif');
          this.frames.pop();
          break;
        default:
          if (was) this[d.name](d);
      }
      const now = this.frames.length ? this.frames[this.frames.length - 1].taking : true;
      if (was && !now) this.deadStart = L2 + 1;
      if (!was && now && this.deadStart <= L1 - 1) this.inactive.push([this.deadStart, L1 - 1]);
      if (!now) this.deadFrom = L2 + 1;
      this.active = now;
    }

    finish() {
      for (const f of this.frames) this.err(f.d, `unterminated #${f.d.name}`);
      const last = this.starts.length - 1;
      if (this.active) return;
      if (this.deadFrom <= last) this.reps.push({ a: this.starts[this.deadFrom], b: this.src.length, text: '', span: null });
      if (this.deadStart <= last) this.inactive.push([this.deadStart, last]);
    }

    // #ifdef and #ifndef: whether the name is defined, or null.
    defined(d) {
      const n = d.toks[0];
      if (!n || n.k !== ID) {
        this.err(n || d, `#${d.name} needs a name`);
        return null;
      }
      if (d.toks.length > 1) this.warn(d.toks[1], `extra tokens after #${d.name}`);
      return this.has(n.v);
    }

    // defined X or defined(X) at toks[i]: { value, next }, or null.
    definedOp(toks, i) {
      let j = i + 1;
      const paren = isOp(toks[j], '(');
      if (paren) j++;
      const n = toks[j];
      if (!n || n.k !== ID) return null;
      j++;
      if (paren) {
        if (!isOp(toks[j], ')')) return null;
        j++;
      }
      return { value: this.has(n.v), next: j };
    }

    // #if and #elif: defined first, then macros expanded, then the value.
    test(d) {
      const toks = d.toks;
      if (!toks.length) {
        this.err(d, `#${d.name} needs an expression`);
        return false;
      }
      const pre = [];
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.k !== ID || t.v !== 'defined') {
          pre.push(t);
          continue;
        }
        const r = this.definedOp(toks, i);
        if (!r) {
          this.err(t, 'defined needs a name');
          return false;
        }
        pre.push(make(NUM, r.value ? '1' : '0', t.ws, null));
        i = r.next - 1;
      }
      this.useLine = this.lineOf(d.s);
      this.work = 0;
      try {
        return new Calc(this.expandList(pre), this).value();
      } catch (e) {
        if (e === TOO_BIG) this.err(d, 'expansion too large');
        else if (e instanceof RangeError) this.err(d, 'expression too deep');
        else if (e instanceof CalcError) {
          if (e.t && e.t.s >= 0) this.err(e.t, e.message);
          else this.err(d, e.message);
        } else throw e;
        return false;
      }
    }

    define(d) {
      const toks = d.toks, n = toks[0];
      if (!n) return this.err(d, '#define needs a name');
      if (n.k !== ID) return this.err(n, 'macro names must be names');
      if (RESERVED.has(n.v)) return this.err(n, `cannot define ${n.v}`);
      let i = 1, params = null, variadic = false;
      // Function-like only with no space before the (.
      if (isOp(toks[1], '(') && !toks[1].ws) {
        params = [];
        i = 2;
        if (isOp(toks[2], ')')) i = 3;
        else {
          for (;;) {
            const t = toks[i];
            if (!t) return this.err(d, `missing ) in the parameters of ${n.v}`);
            if (isOp(t, '...')) variadic = true;
            else if (t.k === ID) {
              if (RESERVED.has(t.v)) return this.err(t, `${t.v} cannot be a parameter`);
              if (params.includes(t.v)) return this.err(t, `duplicate parameter ${t.v}`);
              params.push(t.v);
            } else return this.err(t, `bad parameter ${t.v}`);
            const sep = toks[i + 1];
            i += 2;
            if (isOp(sep, ')')) break;
            if (!sep) return this.err(d, `missing ) in the parameters of ${n.v}`);
            if (variadic) return this.err(sep, '... must be the last parameter');
            if (!isOp(sep, ',')) return this.err(sep, `expected , or ) in the parameters of ${n.v}`);
          }
        }
      }
      const body = toks.slice(i);
      if (body.length && (isOp(body[0], '##') || isOp(body[body.length - 1], '##'))) {
        return this.err(d, '## cannot be at either end of a macro');
      }
      for (let j = 0; j < body.length; j++) {
        const t = body[j];
        if (t.k !== ID) continue;
        if (t.v === '__VA_ARGS__' && !variadic) return this.err(t, '__VA_ARGS__ is only for variadic macros');
        if (t.v !== '__VA_OPT__') continue;
        if (!variadic) return this.err(t, '__VA_OPT__ is only for variadic macros');
        const close = closing(body, j + 1);
        if (close < 0) return this.err(t, '__VA_OPT__ needs (…)');
        for (let k = j + 2; k < close; k++) {
          if (body[k].k === ID && body[k].v === '__VA_OPT__') return this.err(body[k], '__VA_OPT__ cannot nest');
        }
      }
      const kept = prepare(body);
      const at = this.pos(n.s);
      const def = { name: n.v, params, variadic, body: bodyText(kept), file: this.path || null, line: at.line, column: at.column };
      compile(def, kept);
      this.put(def, n, this.lineOf(d.e));
      this.defines.push({ name: n.v, line: at.line, column: at.column, endColumn: at.column + n.v.length });
    }

    undef(d) {
      const n = d.toks[0];
      if (!n) return this.err(d, '#undef needs a name');
      if (n.k !== ID) return this.err(n, 'macro names must be names');
      if (RESERVED.has(n.v)) return this.err(n, `cannot undefine ${n.v}`);
      if (d.toks.length > 1) this.warn(d.toks[1], 'extra tokens after #undef');
      if (this.macros.delete(n.v)) this.events.push({ line: this.lineOf(d.e), name: n.v, def: null });
    }

    include(d) {
      const t = d.toks[0];
      if (!t || t.k !== STR || t.bad) return this.err(t || d, '#include needs a "path"');
      if (d.toks.length > 1) this.warn(d.toks[1], 'extra tokens after #include');
      const spec = strValue(t);
      let r;
      if (!this.fetch) r = null;
      else {
        try {
          r = this.fetch(spec, this.path || null);
        } catch (e) {
          r = { error: String((e && e.message) || e) };
        }
      }
      if (!r || r.error || !(r.macros instanceof Map)) return this.err(t, r && r.error ? String(r.error) : `cannot include "${spec}"`);
      const line = this.lineOf(d.e);
      for (const def of r.macros.values()) {
        if (!def || typeof def.name !== 'string' || !NAME.test(def.name) || RESERVED.has(def.name)) continue;
        if (typeof def.body !== 'string' || !(def.params === null || Array.isArray(def.params))) continue;
        this.put(def, t, line);
      }
    }

    error(d) {
      this.diag(d.s, d.e, this.message(d) || '#error', 'error');
    }

    warning(d) {
      this.diag(d.s, d.e, this.message(d) || '#warning', 'warning');
    }

    message(d) {
      return this.src.slice(d.kw, d.e).replace(/\\[ \t]*\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    }

    /* The output: the source with each replaced range written over, every line break
       kept. segs: for each line the output changes, what each stretch of it came
       from: { o0, o1, d } copied source (source column = output column + d), or
       { o0, o1, span, pad } a use's expansion (pad: room left on the lines it covered). */
    build() {
      const src = this.src, ls = this.starts, segs = new Map(), parts = [];
      let pos = 0, line = 1, col = 0;
      const touch = () => {
        let s = segs.get(line);
        if (!s) segs.set(line, (s = col > 0 ? [{ o0: 0, o1: col, d: 0 }] : []));
        return s;
      };
      const copyTo = (b) => {
        if (b <= pos) return;
        parts.push(src.slice(pos, b));
        const lb = this.lineOf(b), s = segs.get(line);
        if (lb === line) {
          if (s) s.push({ o0: col, o1: col + b - pos, d: pos - ls[line] - col });
          col += b - pos;
        } else {
          const e = this.end(line);
          if (s && e > pos) s.push({ o0: col, o1: col + e - pos, d: pos - ls[line] - col });
          line = lb;
          col = b - ls[lb];
        }
        pos = b;
      };
      for (const r of this.reps) {
        copyTo(r.a);
        const sp = r.span;
        if (sp) {
          touch().push({ o0: col, o1: col + r.text.length, span: sp, pad: false });
          sp.oline = line;
          sp.ocol = col;
          parts.push(r.text);
          col += r.text.length;
        }
        const lb = this.lineOf(r.b);
        if (lb > line) {
          for (let L = line; L < lb; L++) parts.push(src.slice(this.end(L), ls[L + 1]));
          if (sp) {
            for (let L = line + 1; L < lb; L++) segs.set(L, [{ o0: 0, o1: 0, span: sp, pad: true }]);
            const room = r.b - ls[lb];
            const rest = /\S/.test(src.slice(r.b, this.end(lb)));
            if (rest && room > 0) parts.push(' '.repeat(room));
            segs.set(lb, [{ o0: 0, o1: rest ? room : 0, span: sp, pad: true }]);
            col = rest ? room : 0;
          } else col = 0;
          line = lb;
        }
        pos = r.b;
      }
      copyTo(src.length);
      this.segs = segs;
      return parts.join('');
    }

    result() {
      const text = this.build();
      const lines = this.starts.length - 1;
      this.blank = new Uint8Array(lines + 2);
      for (const d of this.directives) this.blank.fill(1, d.line, d.endLine + 1);
      for (const [a, b] of this.inactive) this.blank.fill(1, a, b + 1);
      this.diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);
      return {
        text,
        plain: text === this.src,
        macros: this.macros,
        defines: this.defines,
        uses: this.uses,
        inactive: this.inactive,
        directives: this.directives,
        diagnostics: this.diagnostics,
        visible: (line) => visible(this.events, line),
        toSource: (line, column) => this.toSource(line, column),
        toOutput: (line, column) => this.toOutput(line, column),
      };
    }

    toSource(line, column) {
      if (!(line >= 1 && line < this.starts.length)) return { line, column, exact: false };
      if (this.blank[line]) return { line, column: 1, exact: false };
      const sg = this.segs.get(line);
      if (!sg || !sg.length) return { line, column, exact: !sg };
      const c = column - 1;
      let s = sg[0];
      for (const x of sg) {
        if (c < x.o0) break;
        s = x;
        if (c < x.o1) break;
      }
      if (!s.span) return { line, column: c + s.d + 1, exact: true };
      const sp = s.span, off = c - s.o0;
      if (!s.pad) {
        for (const p of sp.pieces) {
          if (off >= p.o && off < p.o + p.len) {
            // A string written again on one line: only its start is exact.
            const q = this.pos(p.flat ? p.s : p.s + off - p.o);
            return { line: q.line, column: q.column, exact: !p.flat || off === p.o };
          }
        }
      }
      const q = this.pos(sp.a);
      return { line: q.line, column: q.column, exact: false };
    }

    toOutput(line, column) {
      if (!(line >= 1 && line < this.starts.length) || this.blank[line]) return null;
      const off = Math.min(this.starts[line] + Math.max(0, column - 1), this.end(line));
      const sp = this.spanAt(off);
      if (sp) {
        for (const p of sp.pieces) {
          if (off >= p.s && off < p.e) return { line: sp.oline, column: sp.ocol + p.o + (p.flat ? 0 : off - p.s) + 1 };
        }
        return { line: sp.oline, column: sp.ocol + sp.lead + 1 };
      }
      const sg = this.segs.get(line);
      if (!sg) return { line, column };
      const c = off - this.starts[line];
      let near = null;
      for (const x of sg) {
        if (x.span) continue;
        if (c >= x.o0 + x.d && c < x.o1 + x.d) return { line, column: c - x.d + 1 };
        if (c === x.o1 + x.d) near = x;
      }
      if (near) return { line, column: c - near.d + 1 };
      const tail = sg[sg.length - 1];
      return { line, column: (tail ? tail.o1 : 0) + 1 };
    }

    // The use whose source range holds `off`, or null.
    spanAt(off) {
      const sp = this.spans;
      let lo = 0, hi = sp.length - 1, at = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (sp[mid].a <= off) {
          at = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return at >= 0 && off < sp[at].b ? sp[at] : null;
    }
  }

  function visible(events, line) {
    const live = new Set();
    for (const ev of events) {
      if (ev.line >= line) break;
      if (ev.def) live.add(ev.name);
      else live.delete(ev.name);
    }
    return [...live, '__FILE__', '__LINE__'];
  }

  /* ---------- API ---------- */

  const uses = (text) => USES.test(String(text == null ? '' : text));

  function unchanged(text, run) {
    return {
      text,
      plain: true,
      macros: run.macros,
      defines: [],
      uses: [],
      inactive: [],
      directives: [],
      diagnostics: run.diagnostics,
      visible: (line) => visible(run.events, line),
      toSource: (line, column) => ({ line, column, exact: true }),
      toOutput: (line, column) => ({ line, column }),
    };
  }

  function preprocess(text, opts) {
    text = String(text == null ? '' : text);
    opts = opts || {};
    const run = new Run(text, opts);
    try {
      run.predefine(opts.defines);
      let needed = USES.test(text);
      for (const name of run.macros.keys()) if (!needed && text.includes(name)) needed = true;
      if (!needed) return unchanged(text, run);
      run.go();
      return run.result();
    } catch (e) {
      // A fault in here, not in the text: the text goes on as it is.
      const out = unchanged(text, new Run(text, opts));
      out.diagnostics = [{ line: 1, column: 1, endLine: 1, endColumn: 1, message: `macros failed: ${(e && e.message) || e}`, severity: 'error' }];
      return out;
    }
  }

  function includes(text) {
    text = String(text == null ? '' : text);
    if (!/^[ \t\v\f]*#[ \t]*include/m.test(text)) return [];
    const lex = new Lexer(text, true), ls = starts(text), out = [];
    for (let t; (t = lex.next());) {
      if (t.k !== DIR || t.name !== 'include') continue;
      const s = t.toks[0];
      if (!s || s.k !== STR || s.bad) continue;
      const line = lineIn(ls, s.s);
      out.push({ spec: strValue(s), line, column: s.s - ls[line] + 1 });
    }
    return out;
  }

  function serialize(macros) {
    const lines = [];
    const all = macros instanceof Map ? macros.values() : Object.values(macros || {});
    for (const m of all) {
      if (!m || m.builtin || !NAME.test(m.name) || RESERVED.has(m.name)) continue;
      const params = Array.isArray(m.params) ? m.params.concat(m.variadic ? ['...'] : []) : null;
      let body = String(m.body == null ? '' : m.body).replace(/\s*[\r\n]+\s*/g, ' ').trim();
      if (body.endsWith('\\')) body += ' --'; // not a line that goes on
      lines.push(`#define ${m.name}${params ? `(${params.join(', ')})` : ''}${body ? ' ' + body : ''}`);
    }
    return lines.length ? lines.join('\n') + '\n' : '';
  }

  const api = { uses, includes, process: preprocess, serialize };
  if (typeof window !== 'undefined') (window.NT = window.NT || {}).macro = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
