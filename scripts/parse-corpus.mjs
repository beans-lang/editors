#!/usr/bin/env node
// Parses every `.b` file in a beans checkout with tree-sitter-beans and fails
// on any parse error.
//
// This is the grammar's real test. Hand-written corpus cases prove the shapes
// we thought of; this proves the shapes the language actually uses — 99 files
// and ~60k lines of examples, stdlib and the self-hosted compiler.
//
//   node scripts/parse-corpus.mjs [--beans <path>] [--quiet]
//
// Skips (exit 0) when no beans checkout is next to editors/, so the suite
// still runs in a clone that only has this repository.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { editorsRoot } from './lib/language-data.mjs';

const args = process.argv.slice(2);
const quiet = args.includes('--quiet');

function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}

const beansRoot = resolve(
  argValue('--beans') ?? process.env.BEANS_ROOT ?? join(editorsRoot, '..', 'beans'),
);

if (!existsSync(join(beansRoot, 'compiler'))) {
  console.log(`skip: no beans checkout at ${beansRoot}`);
  process.exit(0);
}

const grammarDir = join(editorsRoot, 'tree-sitter-beans');
const treeSitter = join(editorsRoot, 'node_modules', '.bin', 'tree-sitter');

if (!existsSync(treeSitter)) {
  console.error('tree-sitter CLI missing — run `npm install` in editors/');
  process.exit(1);
}

// Where real Beans lives: hand-written examples, the standard library, and the
// self-hosted compiler.
const sources = ['examples', 'stdlib', 'compiler/beans', 'test'];

// beans/test/cases holds source the compiler rejects. Most of those failures
// are *semantic* (type errors, move errors, non-exhaustive matches) and the
// source parses fine — a syntax grammar must accept them.
//
// These eight are the ones the compiler rejects in its *parser*, so the
// grammar has to reject them too. A clean parse here would mean the grammar
// accepts syntax Beans does not have. Each line is the message
// `beansc check` prints.
const SYNTAX_INVALID = new Map([
  ['c_layout_attribute_bad.b', '@c_layout was removed — use \'extern "C" struct\''],
  ['c_layout_struct_bad.b', 'a struct cannot `extends`'],
  ['c_layout_union_bad.b', 'a union cannot be generic'],
  ['recover.b', "expected name after '.' (error-recovery fixture)"],
  ['syntax_multiple_bases_bad.b', "expected '{' — a class has one base"],
  ['syntax_old_forms_bad.b', "@move_only was removed — use 'unique class'"],
  ['syntax_old_take_bad.b', "'take' was removed — use 'move'"],
  ['syntax_self_bad.b', 'self is implicit in instance methods'],
]);

const expectedInvalid = (path) => {
  const m = /\/test\/cases\/([^/]+)$/.exec(path);
  return m !== null && SYNTAX_INVALID.has(m[1]);
};

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (entry.endsWith('.b')) out.push(abs);
  }
  return out;
}

const all = sources.flatMap((s) => walk(join(beansRoot, s))).sort();
const valid = all.filter((f) => !expectedInvalid(f));
const invalid = all.filter(expectedInvalid);

if (all.length === 0) {
  console.log(`skip: no .b files under ${beansRoot}`);
  process.exit(0);
}

/** Runs `tree-sitter parse` and returns the set of files that had a parse error. */
function parseErrors(files) {
  if (files.length === 0) return new Set();
  let output;
  try {
    output = execFileSync(treeSitter, ['parse', '--quiet', '--stat', ...files], {
      cwd: grammarDir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
  const bad = new Set();
  for (const line of output.split('\n')) {
    if (!/\((ERROR|MISSING)/.test(line)) continue;
    const file = files.find((f) => line.startsWith(f));
    if (file) bad.add(file);
  }
  return bad;
}

const show = (f) => relative(beansRoot, f);

const brokeValid = [...parseErrors(valid)];
// The other direction: anything here that parses clean means the grammar
// accepts source the compiler rejects.
const parsedInvalid = invalid.filter((f) => !parseErrors([f]).has(f));

if (!quiet) {
  console.log(`corpus: ${valid.length} valid + ${invalid.length} expected-invalid file(s)`);
}

let failed = false;

if (brokeValid.length > 0) {
  failed = true;
  console.error(`\n${brokeValid.length} valid file(s) failed to parse:`);
  for (const f of brokeValid.slice(0, 40)) console.error(`  ${show(f)}`);
  if (brokeValid.length > 40) console.error(`  ... ${brokeValid.length - 40} more`);
}

if (parsedInvalid.length > 0) {
  failed = true;
  console.error(`\n${parsedInvalid.length} file(s) the compiler rejects parsed clean:`);
  for (const f of parsedInvalid) console.error(`  ${show(f)}`);
}

if (failed) process.exit(1);

console.log(
  `parse-corpus: ${valid.length} file(s) parsed clean, ` +
    `${invalid.length} invalid file(s) correctly rejected (${beansRoot})`,
);
