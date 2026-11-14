/*
  js/macro.js, checked: node check/macro.test.js

  Every input also goes through the invariants: as many lines out as in, lines with no
  directive and no use exactly as they were, directive and skipped lines empty, no
  expansion holding a line break, and every position outside a use going to the same
  character in the output and back (toSource(toOutput(p)) === p, exact). Some outputs
  are handed to darklua (.tools/darklua.exe), when it is there, to see they parse as Luau.
*/
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const M = require('../js/macro.js');

let passed = 0;
let failed = 0;
const luau = []; // outputs that must parse: [name, text]

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n  ${String(e && e.stack).split('\n').slice(0, 4).join('\n  ')}`);
  }
}

const inUse = (r, L, c) => r.uses.some((u) => (L > u.line || (L === u.line && c >= u.column)) && (L < u.endLine || (L === u.endLine && c < u.endColumn)));

function invariants(src, r, positions = true) {
  const a = src.split('\n'), b = r.text.split('\n');
  assert.strictEqual(b.length, a.length, 'as many lines out as in');
  assert.strictEqual(r.plain, r.text === src, 'plain');
  const blank = new Set(), touched = new Set();
  for (const d of r.directives) for (let L = d.line; L <= d.endLine; L++) blank.add(L);
  for (const [x, y] of r.inactive) for (let L = x; L <= y; L++) blank.add(L);
  for (const u of r.uses) {
    assert(!/[\r\n]/.test(u.expansion), 'an expansion holds no line break');
    for (let L = u.line; L <= u.endLine; L++) touched.add(L);
  }
  for (let L = 1; L <= a.length; L++) {
    if (blank.has(L)) assert.strictEqual(b[L - 1].replace(/\r$/, ''), '', `line ${L} is empty`);
    else if (!touched.has(L)) assert.strictEqual(b[L - 1], a[L - 1], `line ${L} is as it was`);
  }
  if (!positions) return;
  for (let L = 1; L <= a.length; L++) {
    if (blank.has(L)) {
      assert.strictEqual(r.toOutput(L, 1), null, `line ${L} has no output`);
      continue;
    }
    const line = a[L - 1].replace(/\r$/, '');
    for (let c = 1; c <= line.length; c++) {
      if (inUse(r, L, c)) continue;
      const o = r.toOutput(L, c);
      assert(o, `${L}:${c} has an output`);
      assert.strictEqual(b[o.line - 1][o.column - 1], line[c - 1], `${L}:${c} is the same character out`);
      const s = r.toSource(o.line, o.column);
      assert.deepStrictEqual([s.line, s.column, s.exact], [L, c, true], `${L}:${c} comes back`);
    }
  }
}

function run(src, opts, positions) {
  const r = M.process(src, opts);
  invariants(src, r, positions);
  return r;
}

const lines = (...l) => l.join('\n');
const out = (src, opts) => run(src, opts).text;
const messages = (r) => r.diagnostics.map((d) => `${d.severity} ${d.line}: ${d.message}`);
const squash = (s) => s.replace(/\s+/g, '');

// The value of a Luau string literal, quoted or long.
function value(lit) {
  const long = /^\[(=*)\[([\s\S]*)\]\1\]$/.exec(lit);
  if (long) return long[2].replace(/^\r?\n/, '').replace(/\r\n/g, '\n');
  const SIMPLE = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
  return lit.slice(1, -1).replace(/\\(?:(\d{1,3})|x([0-9a-fA-F]{2})|z\s*|(\r\n?|\n)|([\s\S]))/g, (m, d, x, nl, c) => {
    if (d) return String.fromCharCode(Number(d));
    if (x) return String.fromCharCode(parseInt(x, 16));
    if (nl) return '\n';
    if (c) return SIMPLE[c] !== undefined ? SIMPLE[c] : c;
    return '';
  });
}

/* ---------- Definitions and plain expansion ---------- */

test('object-like', () => {
  const src = lines('#define N 10', '#define EMPTY', 'local a = N + N', 'local b = {EMPTY}', 'print(N)');
  const r = run(src, { path: 'a.luau' });
  assert.strictEqual(r.text, lines('', '', 'local a = 10 + 10', 'local b = {}', 'print(10)'));
  assert.strictEqual(r.plain, false);
  assert.deepStrictEqual(r.defines, [{ name: 'N', line: 1, column: 9, endColumn: 10 }, { name: 'EMPTY', line: 2, column: 9, endColumn: 14 }]);
  assert.deepStrictEqual(r.directives, [{ line: 1, endLine: 1, kind: 'define' }, { line: 2, endLine: 2, kind: 'define' }]);
  const n = r.macros.get('N');
  assert.deepStrictEqual({ ...n }, { name: 'N', params: null, variadic: false, body: '10', file: 'a.luau', line: 1, column: 9 });
  assert.strictEqual(r.uses.length, 4);
  assert.deepStrictEqual({ ...r.uses[0], macro: null }, { name: 'N', line: 3, column: 11, endLine: 3, endColumn: 12, expansion: '10', macro: null });
  assert.strictEqual(r.uses[0].macro, n);
  luau.push(['object-like', r.text]);
});

test('redefinition', () => {
  const r = run(lines('#define A 1 + 2', '#define A 1   +   2', '#define A 1+2', 'A'));
  assert.deepStrictEqual(messages(r), ['warning 3: A redefined']);
  assert.strictEqual(r.text.split('\n')[3], '1+2');
});

test('function-like, and a name without (', () => {
  const src = lines(
    '#define SQ(x) ((x) * (x))',
    '#define O (x)',
    'local a = SQ(3) + SQ(a + b)',
    'local f = SQ',
    'local g = O',
    'local h = SQ ( 2 )',
  );
  assert.strictEqual(out(src), lines('', '', 'local a = ((3) * (3)) + ((a + b) * (a + b))', 'local f = SQ', 'local g = (x)', 'local h = ((2) * (2))'));
});

test('the C standard example (6.10.5.5)', () => {
  const src = lines(
    '#define x 3', '#define f(a) f(x * (a))', '#undef x', '#define x 2', '#define g f', '#define z z[0]',
    '#define h g(~', '#define m(a) a(w)', '#define w 0,1', '#define t(a) a', '#define p() int',
    '#define q(x) x', '#define r(x,y) x ## y', '#define str(x) # x',
    'f(y+1) + f(f(z)) % t(t(g)(0) + t)(1);',
    'g(x+(3,4)-w) | h 5) & m',
    '(f)^m(m);',
    'p() i[q()] = { q(1), r(2,3), r(4,), r(,5), r(,) };',
    'char c[2][6] = { str(hello), str() };',
  );
  const r = run(src);
  const o = r.text.split('\n').slice(14);
  assert.deepStrictEqual(o.map(squash), [
    'f(2*(y+1))+f(2*(f(2*(z[0]))))%f(2*(0))+t(1);',
    'f(2*(2+(3,4)-0,1))|f(2*(~5))&f(2*(0,1))',
    '^m(0,1);',
    'inti[]={1,23,4,5,};',
    'charc[2][6]={"hello",""};',
  ]);
  assert.strictEqual(o[2], '   ^m(0,1);', 'the rest of a covered line keeps its column');
  assert.deepStrictEqual(r.diagnostics, []);
});

test('recursion stops: blue paint', () => {
  const src = lines('#define foo foo', '#define a b', '#define b a', '#define f(x) x f', '#define g(x) g(x + 1)', 'foo a b f(1)(2) g(g(0))');
  assert.strictEqual(out(src).split('\n')[5], 'foo a b 1 f(2) g(g(0 + 1) + 1)');
});

test('a function-like name at the end of an expansion takes ( from the code', () => {
  const src = lines('#define ID(x) x', '#define CALL ID', 'local v = CALL', '(5)');
  const r = run(src);
  assert.deepStrictEqual(r.text.split('\n').slice(2), ['local v = 5', '']);
  assert.deepStrictEqual([r.uses[0].line, r.uses[0].endLine, r.uses[0].endColumn], [3, 4, 4]);
});

test('Luau keywords as macro names', () => {
  const src = lines('#define unless(c) if not (c) then', 'unless(x > 1) print(x) end');
  const r = run(src);
  assert.strictEqual(r.text.split('\n')[1], 'if not (x > 1) then print(x) end');
  luau.push(['keywords', 'local x = 2\n' + r.text]);
});

/* ---------- # and ## ---------- */

test('stringify', () => {
  const src = lines(
    '#define S(x) #x',
    '#define T(x) # x',
    'S(a + b)',
    'S(  a   +   b  )',
    'S("hi\\n")',
    "S('it''s')",
    'S(a --[[c]] b -- d',
    ')',
    'S()',
    'T(x)',
  );
  const o = out(src).split('\n');
  assert.deepStrictEqual(o.slice(2), ['"a + b"', '"a + b"', '"\\"hi\\\\n\\""', '"\'it\'\'s\'"', '"a b"', '', '""', '"x"']);
  assert.strictEqual(value(o[4]), '"hi\\n"');
});

test('# before a non-parameter is the length operator', () => {
  const src = lines('#define LEN(t) #(t)', '#define N(t) #list + #t', 'print(LEN(xs), N(ys))');
  assert.strictEqual(out(src).split('\n')[2], 'print(#(xs), #list + "ys")');
  const o = lines('#define COUNT #items', 'print(COUNT)');
  assert.strictEqual(out(o).split('\n')[1], 'print(#items)');
});

test('stringify keeps a multi-line argument on one line', () => {
  const src = lines('#define S(x) #x', 'local s = S([[a', 'b]])');
  const o = out(src).split('\n');
  assert.deepStrictEqual(o.slice(1), ['local s = "[[a\\nb]]"', '']);
  assert.strictEqual(value(o[1].slice(10)), '[[a\nb]]');
});

test('paste', () => {
  const src = lines(
    '#define CAT(a, b) a ## b',
    '#define XY x ## y',
    '#define C3(a, b, c) a##b##c',
    'local v = { CAT(foo, bar), CAT(1, 2), CAT(, y), CAT(x, ), CAT(,), XY, C3(a, b, c), CAT(., .), CAT(=, =) }',
  );
  const r = run(src);
  assert.strictEqual(r.text.split('\n')[3], 'local v = { foobar, 12, y, x, , xy, abc, .., == }');
  assert.deepStrictEqual(r.diagnostics, []);
});

test('a paste that is not one token', () => {
  const r = run(lines('#define CAT(a, b) a ## b', 'CAT(-, -) CAT(x, +) CAT("a", b)'));
  assert.deepStrictEqual(messages(r), [
    'error 2: pasting - and - does not give a valid token',
    'error 2: pasting x and + does not give a valid token',
    'error 2: pasting "a" and b does not give a valid token',
  ]);
  assert.strictEqual(r.text.split('\n')[1], '- - x + "a" b');
});

test('arguments next to # and ## are not expanded first', () => {
  const src = lines('#define N 1', '#define S(x) #x', '#define XS(x) S(x)', '#define CAT(a, b) a ## b', '#define XCAT(a, b) CAT(a, b)', 'S(N) XS(N) CAT(N, 2) XCAT(N, 2)');
  assert.strictEqual(out(src).split('\n')[5], '"N" "1" N2 12');
});

/* ---------- Variadics ---------- */

test('__VA_ARGS__', () => {
  const src = lines(
    '#define LOG(fmt, ...) print(string.format(fmt, __VA_ARGS__))',
    '#define ALL(...) { __VA_ARGS__ }',
    'LOG("%d %d", 1, 2)',
    'local t = ALL(1, (2, 3), {4, 5})',
    'local e = ALL()',
  );
  const r = run(src);
  assert.deepStrictEqual(r.text.split('\n').slice(2), ['print(string.format("%d %d", 1, 2))', 'local t = { 1, (2, 3), {4, 5} }', 'local e = { }']);
});

test('__VA_OPT__ (C23 examples)', () => {
  const src = lines(
    '#define F(...) f(0 __VA_OPT__(,) __VA_ARGS__)',
    '#define G(X, ...) f(0, X __VA_OPT__(,) __VA_ARGS__)',
    '#define SDEF(sname, ...) S sname __VA_OPT__(= { __VA_ARGS__ })',
    '#define EMP',
    '#define Q(...) #__VA_OPT__(x __VA_ARGS__)',
    'F(a, b, c) F() F(EMP)',
    'G(a, b, c) G(a, ) G(a)',
    'SDEF(foo); SDEF(bar, 1, 2);',
    'Q(1) Q()',
  );
  const o = out(src).split('\n').slice(5).map(squash);
  assert.deepStrictEqual(o, ['f(0,a,b,c)f(0)f(0)', 'f(0,a,b,c)f(0,a)f(0,a)', 'Sfoo;Sbar={1,2};', '"x1"""']);
});

test('argument counts', () => {
  const src = lines('#define TWO(a, b) a b', '#define NONE() 0', '#define VA(a, ...) a', 'TWO(1) TWO(1, 2, 3) NONE(1) VA()');
  const r = run(src);
  assert.deepStrictEqual(messages(r), [
    'error 4: TWO expects 2 arguments, got 1',
    'error 4: TWO expects 2 arguments, got 3',
    'error 4: NONE expects 0 arguments, got 1',
  ]);
  assert.strictEqual(r.text.split('\n')[3], 'TWO(1) TWO(1, 2, 3) NONE(1) ');
});

/* ---------- Lines ---------- */

test('a call over several lines, with comments and long strings', () => {
  const src = lines(
    '#define PAIR(a, b) { a, b }',
    'local p = PAIR( -- first',
    '  [[line one',
    'line two]], --[[ a',
    '  block ]] "x\\',
    'y"',
    ') ; print(p)',
    'local q = 1',
  );
  const r = run(src);
  const o = r.text.split('\n');
  assert.strictEqual(o[1], 'local p = { "line one\\nline two", "x\\ny" }');
  assert.deepStrictEqual(o.slice(2, 6), ['', '', '', '']);
  assert.strictEqual(o[6], '  ; print(p)');
  assert.strictEqual(o[7], 'local q = 1');
  const lits = o[1].match(/"(?:[^"\\]|\\.)*"/g);
  assert.deepStrictEqual(lits.map(value), ['line one\nline two', 'x\ny']);
  assert.deepStrictEqual([r.uses[0].line, r.uses[0].column, r.uses[0].endLine, r.uses[0].endColumn], [2, 11, 7, 2]);
  luau.push(['multi-line call', r.text]);
});

test('string values survive: long brackets, \\z, escapes', () => {
  const src = lines(
    '#define ID(x) x',
    'local a = ID([==[',
    'first ]] still',
    ']==])',
    'local b = ID("a\\z',
    '      b")',
    'local c = ID([[tab\there "q" \\back]])',
    'local d = ID([[x',
    'y]] .. [[',
    ']])',
  );
  const r = run(src);
  const o = r.text.split('\n');
  assert.strictEqual(value(o[1].slice(10)), 'first ]] still\n');
  assert.strictEqual(value(o[4].slice(10)), 'ab');
  assert.strictEqual(o[6], 'local c = [[tab\there "q" \\back]]', 'a long string on one line stays as written');
  assert.strictEqual(o[7], 'local d = "x\\ny" .. ""');
  luau.push(['string values', r.text]);
});

test('CRLF', () => {
  const src = '#define N 1\r\nlocal a = N\r\n#if 0\r\nskipped\r\n#endif\r\nlocal b = 2\r\n';
  const r = run(src);
  assert.strictEqual(r.text, '\r\nlocal a = 1\r\n\r\n\r\n\r\nlocal b = 2\r\n');
});

test('continued directives', () => {
  const src = lines('#define SUM(a, b) \\', '  ((a) + \\', '   (b))', 'x = SUM(1, 2)', '#define S [[one', 'two]]', 's = S');
  const r = run(src);
  assert.deepStrictEqual(r.directives, [{ line: 1, endLine: 3, kind: 'define' }, { line: 5, endLine: 6, kind: 'define' }]);
  assert.strictEqual(r.macros.get('SUM').body, '((a) + (b))');
  assert.strictEqual(r.macros.get('S').body, '"one\\ntwo"');
  assert.deepStrictEqual(r.text.split('\n'), ['', '', '', 'x = ((1) + (2))', '', '', 's = "one\\ntwo"']);
  // A comment that spans lines keeps the directive going, as in C; so does a line comment ending in \.
  const c = run(lines('#define A 1 --[[ one', 'two ]] + 2', '#define B 3 -- note \\', 'still the note', 'A B'));
  assert.deepStrictEqual(c.directives.map((d) => [d.line, d.endLine]), [[1, 2], [3, 4]]);
  assert.strictEqual(c.text.split('\n')[4], '1 + 2 3');
});

test('what is around a use does not run into it', () => {
  const src = lines('#define NEG -1', '#define E', '#define DOT .', '#define ONE 1', 'a = 1-NEG', 'b = a-E-b', 'c = t DOT x', 'd = ONE..2', 'e = -NEG');
  assert.deepStrictEqual(out(src).split('\n').slice(4), ['a = 1- -1', 'b = a- -b', 'c = t . x', 'd = 1 ..2', 'e = - -1']);
});

/* ---------- Not directives ---------- */

test('directives inside strings and comments are not directives', () => {
  const src = lines(
    '#define X 1',
    'local s = [[',
    '#define X 2',
    '#undef X',
    ']]',
    '--[==[',
    '#if 0',
    ']==]',
    'local t = "#define X 3" -- #define X 4',
    'local u = `{X} \\',
    '#define`',
    'print(X)',
  );
  const r = run(src);
  assert.strictEqual(r.directives.length, 1);
  assert.strictEqual(r.macros.get('X').body, '1');
  assert.deepStrictEqual(r.text.split('\n').slice(1), src.split('\n').slice(1).map((l) => l.replace(/\{X\}/, '{1}').replace(/print\(X\)/, 'print(1)')));
});

test('# at a line start that is not a directive', () => {
  const src = lines(
    'local n = 1 +',
    '#list',
    'local m = 2 +',
    '  # list',
    'local k = 3 +',
    '#iffy + #defined + #if_ + #endifx',
    'local j = #',
    '#',
    'list',
  );
  const r = run(src);
  assert.strictEqual(r.text, src);
  assert.strictEqual(r.directives.length, 0);
  assert.strictEqual(M.uses(src), false);
  luau.push(['length at line start', 'local list = {}\n' + src.replace('#iffy + #defined + #if_ + #endifx', '#list')]);
});

/* ---------- Conditions ---------- */

test('nested #if', () => {
  const src = lines(
    '#define A 1',
    '#if A',
    '  #if B',
    'b',
    '  #elif defined(A) && !defined B',
    'ab',
    '  #else',
    'nb',
    '  #endif',
    '#else',
    'na',
    '  #if 1',
    'deep',
    '  #endif',
    '#endif',
    'after',
  );
  const r = run(src);
  assert.deepStrictEqual(r.text.split('\n').map((l, i) => l && `${i + 1}:${l}`).filter(Boolean), ['6:ab', '16:after']);
  assert.deepStrictEqual(r.inactive, [[4, 4], [8, 8], [11, 14]]);
  assert.deepStrictEqual(r.directives.map((d) => d.kind), ['define', 'if', 'if', 'elif', 'else', 'endif', 'else', 'if', 'endif', 'endif']);
});

test('#ifdef and #ifndef', () => {
  const src = lines('#define X', '#ifdef X', 'x', '#endif', '#ifndef X', 'nx', '#endif', '#ifdef Y', 'y', '#elif 1', 'elif', '#endif', '#ifdef __LINE__', 'line', '#endif');
  assert.deepStrictEqual(out(src).split('\n').filter(Boolean), ['x', 'elif', 'line']);
  const r = run(lines('#if 0', '#define Z 1', '#error not here', '#endif', 'Z'));
  assert.strictEqual(r.macros.has('Z'), false);
  assert.deepStrictEqual(r.diagnostics, []);
  assert.strictEqual(r.text.split('\n')[4], 'Z');
});

test('#if expressions', () => {
  const T = [
    '1', '0x10 == 16', '1_000 == 1000', '0b101 == 5', '1.5 * 2 == 3', '1e3 == 1000', '.5 == 0.5', 'true', 'not false',
    '!0', '1 or 0', '1 && 2', '2 + 3 * 4 == 14', '(2 + 3) * 4 == 20', '7 % 3 == 1', '-7 % 3 == 2', '7 / 2 == 3.5',
    '7 // 2 == 3', '1 < 2', '2 <= 2', '3 > 2', '1 ~= 2', '1 != 2', '"a" == "a"', '"a" ~= "b"', '\'x\' == "x"',
    '[[s]] == "s"', '"\\65" == "A"', '1 ? 2 : 0', 'NOPE == 0', 'defined(A)', 'defined A', '!defined(NOPE)', 'VERSION >= 3',
    'MODE == "debug"','1 || 1 % 0', '0 ? 1 / 0 : 1', '__LINE__ > 0', 'not (1 and 0)', 'NUM(4) == 16',
    '- -1 == 1', 'true == 1', '"1" ~= 1',
  ];
  const F = ['0', 'false', '1 and 0', '0 || 0', '2 >= 3', '1 != 1', '0 ? 1 : 0', 'defined NOPE', 'not 1', '"a" == "b"', 'UNDEFINED', '0 && 1 / 0'];
  const head = ['#define A', '#define VERSION 3', '#define MODE "debug"', '#define NUM(x) ((x) * (x))'];
  const src = [...head];
  for (const e of T) src.push(`#if ${e}`, 'yes', '#else', 'no', '#endif');
  for (const e of F) src.push(`#if ${e}`, 'yes', '#else', 'no', '#endif');
  const r = run(src.join('\n'));
  assert.deepStrictEqual(r.diagnostics, []);
  const got = r.text.split('\n').filter(Boolean);
  const want = [...T.map(() => 'yes'), ...F.map(() => 'no')];
  got.forEach((g, i) => assert.strictEqual(g, want[i], `#if ${[...T, ...F][i]}`));
  assert.strictEqual(got.length, want.length);
});

test('bad #if expressions', () => {
  const E = {
    '1 +': 'missing value in #if', '(1': 'missing ) in #if', '1 2': 'unexpected 2 in #if', '"a" < "b"': 'strings can only be compared with == or ~=',
    '1 / 0': 'division by zero in #if', '"a"': 'a string is not a condition', 'defined': 'defined needs a name', '': '#if needs an expression',
    '1 ? 2': 'missing : in #if', '0x': 'bad number 0x', 'EMPTY': '#if needs an expression', ')': 'unexpected ) in #if', '-"a"': 'cannot use - on a string',
  };
  const src = ['#define EMPTY'];
  for (const e of Object.keys(E)) src.push(`#if ${e}`, 'yes', '#else', 'no', '#endif');
  const r = run(src.join('\n'));
  assert.deepStrictEqual(r.diagnostics.map((d) => d.message), Object.values(E));
  assert.deepStrictEqual(r.text.split('\n').filter(Boolean), Object.keys(E).map(() => 'no'), 'a bad #if is false');
});

test('stray and unterminated conditions', () => {
  const src = lines('#endif', '#else', '#elif 1', 'code', '#if 1', '#else', '#else', '#elif 1', '#endif extra', '#ifdef', '#endif', '#if 0', 'never');
  const r = run(src);
  assert.deepStrictEqual(messages(r), [
    'error 1: #endif without #if', 'error 2: #else without #if', 'error 3: #elif without #if', 'error 7: #else after #else',
    'error 8: #elif after #else', 'warning 9: extra tokens after #endif', 'error 10: #ifdef needs a name', 'error 12: unterminated #if',
  ]);
  assert.strictEqual(r.text.split('\n')[3], 'code');
  assert.deepStrictEqual(r.inactive, [[7, 8], [13, 13]]);
  assert.strictEqual(r.text.split('\n')[12], '');
});

test('#error and #warning', () => {
  const src = lines('#warning check  this', '#if 0', '#error never', '#endif', '#error stop \\', 'here', '#error');
  const r = run(src);
  assert.deepStrictEqual(messages(r), ['warning 1: check this', 'error 5: stop here', 'error 7: #error']);
  assert.deepStrictEqual([r.diagnostics[1].endLine, r.diagnostics[1].endColumn], [6, 5]);
});

/* ---------- Builtins ---------- */

test('__FILE__ and __LINE__', () => {
  const src = lines('#define HERE __LINE__', '#define AT(x) { x, __LINE__ }', 'print(__FILE__, __LINE__)', 'print(HERE)', 'local t = AT(', '  __LINE__', ')');
  const r = run(src, { path: 'dir\\a "b".luau' });
  assert.deepStrictEqual(r.text.split('\n').slice(2), ['print("dir\\\\a \\"b\\".luau", 3)', 'print(4)', 'local t = { 5, 5 }', '', '']);
  assert.strictEqual(value(r.text.split('\n')[2].slice(6, -4)), 'dir\\a "b".luau');
  assert.strictEqual(r.uses[0].macro.builtin, true);
});

test('reserved names', () => {
  const r = run(lines('#define defined 1', '#define __LINE__ 2', '#undef __FILE__', '#define F(__VA_ARGS__) 1', '#define G(x) __VA_ARGS__', '#define H(a, a) a', '#define I(... , a) a', '#define J(a b) a', '#define ## x', '#define K x ##', '#define L(...) __VA_OPT__ x', '#define 1'));
  assert.deepStrictEqual(r.diagnostics.map((d) => d.message), [
    'cannot define defined', 'cannot define __LINE__', 'cannot undefine __FILE__', '__VA_ARGS__ cannot be a parameter',
    '__VA_ARGS__ is only for variadic macros', 'duplicate parameter a', '... must be the last parameter', 'expected , or ) in the parameters of J',
    'macro names must be names', '## cannot be at either end of a macro', '__VA_OPT__ needs (…)', 'macro names must be names',
  ]);
  assert.strictEqual(r.macros.size, 0);
});

/* ---------- Include ---------- */

test('#include through the callback', () => {
  const lib = M.process(lines('#define MAX(a, b) ((a) > (b) and (a) or (b))', '#define VERSION 2', 'return {}'), { path: 'lib/util.luau' });
  const asked = [];
  const include = (spec, from) => {
    asked.push([spec, from]);
    if (spec === 'util') return { macros: lib.macros };
    return { error: `no library ${spec}` };
  };
  const src = lines('#include "util"', '#include "nope"', '#if 0', '#include "dead"', '#endif', 'local m = MAX(1, VERSION)', "#include 'util' extra", '#define VERSION 3');
  const r = run(src, { path: 'main.luau', include });
  assert.deepStrictEqual(asked, [['util', 'main.luau'], ['nope', 'main.luau'], ['util', 'main.luau']]);
  assert.strictEqual(r.text.split('\n')[5], 'local m = ((1) > (2) and (1) or (2))');
  assert.deepStrictEqual(messages(r), ['error 2: no library nope', 'warning 7: extra tokens after #include', 'warning 8: VERSION redefined']);
  assert.strictEqual(r.macros.get('MAX').file, 'lib/util.luau');
  assert.strictEqual(r.macros.get('VERSION').body, '3');
  assert.deepStrictEqual(M.includes(src), [{ spec: 'util', line: 1, column: 10 }, { spec: 'nope', line: 2, column: 10 }, { spec: 'dead', line: 4, column: 10 }, { spec: 'util', line: 7, column: 10 }]);
  assert.deepStrictEqual(r.visible(1).slice(0, -2), []);
  assert.deepStrictEqual(r.visible(2).slice(0, -2), ['MAX', 'VERSION']);
});

test('#include with no callback, or one that throws', () => {
  const r = run(lines('#include "a"', '#include', '#include x'));
  assert.deepStrictEqual(r.diagnostics.map((d) => d.message), ['cannot include "a"', '#include needs a "path"', '#include needs a "path"']);
  const t = run('#include "b"', { include: () => { throw new Error('boom'); } });
  assert.deepStrictEqual(t.diagnostics.map((d) => d.message), ['boom']);
});

/* ---------- Recovery ---------- */

test('an unterminated call leaves the rest working', () => {
  const src = lines('#define F(x) x', '#define O 1', 'local a = F(1, O', 'local b = O');
  const r = run(src);
  assert.deepStrictEqual(messages(r), ['error 3: unterminated call to F']);
  assert.deepStrictEqual(r.text.split('\n').slice(2), ['local a = F(1, 1', 'local b = 1']);
});

test('a directive inside a call', () => {
  const src = lines('#define F(x) x', 'local x = F(1,', '#define Z 5', 'Z)');
  const r = run(src);
  assert.deepStrictEqual(messages(r), ['error 2: directive inside the arguments of F']);
  assert.deepStrictEqual(r.text.split('\n'), ['', 'local x = F(1,', '', '5)']);
});

test('lines after errors go on', () => {
  const src = lines('#define', '#define F(x', '#define G(x) x', '#if (', '#endif', 'G(2)', '#bogus is length', 'local s = "unfinished', 'G(3)');
  const r = run(src);
  assert.deepStrictEqual(r.diagnostics.map((d) => d.message), ['#define needs a name', 'missing ) in the parameters of F', 'missing value in #if']);
  assert.deepStrictEqual(r.text.split('\n').slice(5), ['2', '#bogus is length', 'local s = "unfinished', '3']);
});

test('an expansion that never ends is cut off', () => {
  const src = ['#define A0 x x'];
  for (let i = 1; i < 30; i++) src.push(`#define A${i} A${i - 1} A${i - 1}`);
  src.push('A29', 'A1');
  const r = run(src.join('\n'));
  assert.deepStrictEqual(r.diagnostics.map((d) => d.message), ['expansion too large']);
  assert.strictEqual(r.text.split('\n').pop(), 'x x x x');
});

test('nesting too deep is a diagnostic', () => {
  const n = 100000;
  const r = run(lines('#define F(x) x', `#if ${'('.repeat(n)}1${')'.repeat(n)}`, '#endif', `F(${'F('.repeat(n)}1${')'.repeat(n + 1)}`, 'F(2)'), {}, false);
  assert.deepStrictEqual(r.diagnostics.map((d) => d.message), ['expression too deep', 'expansion too large']);
  assert.strictEqual(r.text.split('\n')[4], '2');
});

/* ---------- Positions ---------- */

test('arguments map exactly, bodies to the use', () => {
  const src = lines('#define ADD(a, b) (a + b)', 'local v = ADD(alpha, beta) + gamma');
  const r = run(src);
  const o = r.text.split('\n')[1];
  assert.strictEqual(o, 'local v = (alpha + beta) + gamma');
  const alpha = r.toOutput(2, 15);
  assert.deepStrictEqual(alpha, { line: 2, column: o.indexOf('alpha') + 1 });
  assert.deepStrictEqual(r.toSource(2, o.indexOf('beta') + 3), { line: 2, column: 24, exact: true });
  assert.deepStrictEqual(r.toSource(2, o.indexOf('+') + 1), { line: 2, column: 11, exact: false });
  assert.deepStrictEqual(r.toOutput(2, 11), { line: 2, column: 11 }, 'the name: the start of the expansion');
  assert.deepStrictEqual(r.toOutput(2, 20), { line: 2, column: 11 }, 'a comma: the start of the expansion');
  assert.strictEqual(r.toOutput(1, 3), null);
  assert.deepStrictEqual(r.toSource(1, 1), { line: 1, column: 1, exact: false });
  // An argument used twice maps to its first copy.
  const t = run(lines('#define TWICE(x) x + x', 'y = TWICE(z)'));
  assert.deepStrictEqual(t.toOutput(2, 11), { line: 2, column: 5 });
  assert.deepStrictEqual(t.toSource(2, 9), { line: 2, column: 11, exact: true });
});

test('positions across a call over lines', () => {
  const src = lines('#define F(a, b) a .. b', 'local s = F(one,', '  two', ') .. three');
  const r = run(src);
  const o = r.text.split('\n');
  assert.deepStrictEqual(o, ['', 'local s = one .. two', '', '  .. three']);
  assert.deepStrictEqual(r.toOutput(3, 3), { line: 2, column: 18 });
  assert.deepStrictEqual(r.toSource(2, 19), { line: 3, column: 4, exact: true });
  assert.deepStrictEqual(r.toSource(3, 1), { line: 2, column: 11, exact: false });
  assert.deepStrictEqual(r.toOutput(4, 1), { line: 2, column: 11 });
  assert.deepStrictEqual(r.toOutput(4, 6), { line: 4, column: 6 });
});

test('visible', () => {
  const r = run(lines('#define A 1', '#define B 2', '#undef A', 'x'), { defines: { PRE: '' } });
  assert.deepStrictEqual(r.visible(1), ['PRE', '__FILE__', '__LINE__']);
  assert.deepStrictEqual(r.visible(2), ['PRE', 'A', '__FILE__', '__LINE__']);
  assert.deepStrictEqual(r.visible(4), ['PRE', 'B', '__FILE__', '__LINE__']);
});

/* ---------- API ---------- */

test('uses, plain and the fast path', () => {
  const src = 'local x = 1\nprint(#x)\n';
  assert.strictEqual(M.uses(src), false);
  const r = M.process(src);
  assert.strictEqual(r.text, src);
  assert.strictEqual(r.plain, true);
  assert.strictEqual(M.uses('print(__LINE__)'), true);
  assert.strictEqual(M.uses('  #  define X'), true);
  const d = run('print(DEBUG)', { defines: { DEBUG: true, 'bad name': 1 } });
  assert.strictEqual(d.text, 'print(true)');
  assert.deepStrictEqual(d.diagnostics.map((x) => x.message), ['bad predefined macro bad name']);
  assert.strictEqual(run('#if 0\n#endif\nx').plain, false);
  assert.strictEqual(run('#define X 1\n').text, '\n');
});

test('serialize reads back', () => {
  const r = run(lines(
    '#define A 1  +   2 --[[ c ]] + 3',
    '#define F(a, b, ...) a##b(__VA_ARGS__) __VA_OPT__(,) #a',
    '#define G() [[x',
    'y]]',
    '#define E',
    '#define V(...) __VA_ARGS__',
    '#define I `{x}{y}`',
  ));
  const text = M.serialize(r.macros);
  const back = run(text);
  const shape = (m) => [...m.values()].map(({ name, params, variadic, body }) => ({ name, params, variadic, body }));
  assert.deepStrictEqual(shape(back.macros), shape(r.macros));
  assert.strictEqual(text.split('\n').length, 6 + 1);
  assert.deepStrictEqual(back.diagnostics, []);
});

test('interpolated strings', () => {
  const src = lines('#define N 5', '#define ID(x) x', 'local s = `n = {N} and {ID(`{N}, {N}`)}`', 'local t = ID(`{f(1, 2)}`, 3)', 'local u = ID(`a, b`)');
  const r = run(src);
  assert.deepStrictEqual(messages(r), ['error 4: ID expects 1 argument, got 2']);
  assert.deepStrictEqual(r.text.split('\n').slice(2), ['local s = `n = {5} and {`{5}, {5}`}`', 'local t = ID(`{f(1, 2)}`, 3)', 'local u = `a, b`']);
});

test('a define can be read while another macro is used', () => {
  const src = lines('#define A B', '#define B 1', 'x = A', '#undef B', '#define B 2', 'y = A');
  assert.deepStrictEqual(out(src).split('\n').slice(2), ['x = 1', '', '', 'y = 2']);
});

/* ---------- Random ---------- */

function random(seed) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const L = [];
  const depth = [];
  const n = 5 + Math.floor(rnd() * 40);
  for (let i = 0; i < n; i++) {
    const k = rnd();
    if (k < 0.08) L.push(pick(['#define K 42', '#define EMPTY', '#define SQ(x) ((x) * (x))', '#define CAT(a, b) a ## b', '#define S(x) #x', '#define V(f, ...) f(__VA_ARGS__)', '#define K 42 \\', '#undef K']));
    else if (k < 0.12) { L.push(pick(['#if 1', '#if 0', '#ifdef K', '#ifndef SQ', '#if K == 42 and not defined(X)'])); depth.push(1); }
    else if (k < 0.14 && depth.length) L.push(pick(['#else', '#elif 1', '#elif 0']));
    else if (k < 0.18 && depth.length) { depth.pop(); L.push('#endif'); }
    else if (k < 0.24) L.push(pick(['local s = [[', '--[[ block', '"#define X 1"', '#len', '  # x', '#iffy']));
    else if (k < 0.28) L.push(pick([']]', ']] .. K', 'end -- ]]']));
    else if (k < 0.40) L.push(`local v${i} = SQ(${pick(['1', 'K', 'a + b', '[[x', 'y'])}${pick([')', ',', '', ' -- c'])}`);
    else if (k < 0.48) L.push(`print(V(${pick(['print', 'tostring'])}, ${pick(['K', '"a\\', 'EMPTY', 'S(z)', '`{K}`'])}))`);
    else if (k < 0.54) L.push(pick(['  2)', ')', '"tail")', 'CAT(x, y) CAT(1, 2)']));
    else L.push(pick(['local a = 1', 'print(K, EMPTY)', 'x = #t + 1', '    return t[1]', '', 'local u = `n={K}`', 'S(K) .. "#if"', 'f(__LINE__)']));
  }
  return L.join(pick(['\n', '\r\n']));
}

test('random text keeps its lines', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const src = random(seed);
    try {
      run(src, { path: 'r.luau' });
    } catch (e) {
      throw new Error(`seed ${seed}: ${e.message}\n${JSON.stringify(src)}`);
    }
  }
});

test('token soup keeps its lines', () => {
  const atoms = ['#define F(x) x ## x', '#define G(a, ...) a __VA_OPT__(+) __VA_ARGS__', '#define O F', '#define S(x) #x', '#if 1', '#if 0', '#else',
    '#endif', '#elif O', '#undef F', 'F', 'G', 'O', 'S', '(', ')', ',', '[[', ']]', '[=[', ']=]', '--', '--[[', '"', "'", '\\', '\n', '\r\n',
    '`', '{', '}', ' ', 'x', '1', '.', '#', '##', '__LINE__', '\\z', 'é', '\t'];
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let it = 0; it < 3000; it++) {
    let src = '';
    for (let i = 0, n = 1 + Math.floor(rnd() * 30); i < n; i++) {
      const a = atoms[Math.floor(rnd() * atoms.length)];
      src += (a[0] === '#' && rnd() < 0.7 ? '\n' : '') + a;
    }
    try {
      const r = run(src, { path: 'p' });
      assert(!r.diagnostics.some((d) => d.message.startsWith('macros failed')), r.diagnostics.map((d) => d.message).join());
    } catch (e) {
      throw new Error(`${JSON.stringify(src)}: ${e.message}`);
    }
  }
});

test('in a browser it is NT.macro', () => {
  const vm = require('vm');
  const window = { NT: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'macro.js'), 'utf8'), { window });
  assert.strictEqual(typeof window.NT.macro.process, 'function');
  assert.strictEqual(window.NT.macro.process('#define A 1\nA').text, '\n1');
});

/* ---------- Speed ---------- */

test('speed', () => {
  const chunk = lines(
    'local function step(dt: number): number',
    '  local t = { 1, 2, 3, "a string", [[long]], `x{dt}` } -- comment',
    '  for i = 1, #t do t[i] = t[i] * 2 end',
    '  return dt * 2',
    'end',
  );
  const parts = ['#define SQ(x) ((x) * (x))', '#define K 42', '#define LOG(...) print(__VA_ARGS__)'];
  let size = 0, i = 0;
  while (size < 1000000) {
    const line = i % 30 === 0 ? `local q${i} = SQ(K) + LOG("a", ${i})` : chunk;
    parts.push(line);
    size += line.length + 1;
    i++;
  }
  const src = parts.join('\n');
  let best = Infinity, r;
  for (let k = 0; k < 3; k++) {
    const t0 = process.hrtime.bigint();
    r = M.process(src, { path: 'big.luau' });
    best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6);
  }
  invariants(src, r, false);
  const plain = src.replace(/^#.*$/gm, '').replace(/SQ\(K\)/g, '1').replace(/LOG/g, 'print');
  const t1 = process.hrtime.bigint();
  for (let k = 0; k < 10; k++) M.process(plain);
  const plainMs = Number(process.hrtime.bigint() - t1) / 1e7;
  console.log(`  speed: ${(src.length / 1e6).toFixed(2)} MB, ${r.uses.length} uses: ${best.toFixed(1)} ms; with no directives: ${plainMs.toFixed(2)} ms`);
  assert(r.uses.length > 300);
  assert(best < 100, `took ${best} ms`);
  assert(plainMs < 5, `plain took ${plainMs} ms`);
});

/* ---------- Luau parses the output ---------- */

function darklua() {
  const root = path.join(__dirname, '..');
  for (const dir of [path.join(root, '.tools'), path.join(root, '..', '..', '..', '.tools')]) {
    const exe = path.join(dir, process.platform === 'win32' ? 'darklua.exe' : 'darklua');
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

test('outputs parse as Luau', () => {
  const exe = darklua();
  if (!exe) {
    console.log('  (no darklua: outputs not parsed)');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-macro-'));
  try {
    luau.push(['variadic', out(lines('#define LOG(fmt, ...) print(string.format(fmt __VA_OPT__(,) __VA_ARGS__))', 'LOG("x")', 'LOG("%d", 1)', 'local n = select("#", 1, 2)'))]);
    luau.push(['conditions', out(lines('#define DEBUG 1', '#if DEBUG', 'print("debug", __LINE__)', '#else', 'this is not luau at all )(', '#endif', 'local t = {', '  #t,', '}'))]);
    for (const [name, text] of luau) {
      const file = path.join(dir, name.replace(/\W+/g, '-') + '.luau');
      fs.writeFileSync(file, text);
      try {
        execFileSync(exe, ['process', file, file + '.out'], { stdio: 'pipe' });
      } catch (e) {
        throw new Error(`${name} does not parse:\n${text}\n${String(e.stdout || '')}${String(e.stderr || '')}`);
      }
    }
    console.log(`  darklua parsed ${luau.length} outputs`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
