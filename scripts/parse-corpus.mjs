#!/usr/bin/env node
// Parses every `.b` file in a beans checkout with tree-sitter-beans and fails
// on any parse error.
//
// This is the grammar's real test. Hand-written corpus cases prove the shapes
// we thought of; this proves the shapes the language actually uses — 99 files
// and ~60k lines of examples, stdlib and the self-hosted compiler in src/.
//
//   node scripts/parse-corpus.mjs [--beans <path>] [--quiet]
//
// Skips (exit 0) when no beans checkout is next to editors/, so the suite
// still runs in a clone that only has this repository.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

if (!existsSync(join(beansRoot, 'src'))) {
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
const sources = ['examples', 'stdlib', 'src', 'test'];

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

// The grammar does not parse the whole corpus yet — the Tree-sitter half is
// behind the language by several features, which is what `test/corpus-known-
// failures.txt` records. This check is therefore a ratchet rather than a pass:
// a file already on the list is a known gap, and a file that is *not* on it is
// a regression the change under test just caused.
//
// It used to read `beans/compiler/`, which the self-hosted compiler replaced
// with `beans/src/`, so it skipped instead of measuring anything at all. The
// baseline is the honest reading of what it measures now; shrink it by fixing
// grammar.js, and run with --update to record the smaller number.
const baselinePath = join(editorsRoot, 'test', 'corpus-known-failures.txt');
const update = process.argv.includes('--update');
const known = existsSync(baselinePath)
  ? new Set(
      readFileSync(baselinePath, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '' && !l.startsWith('#')),
    )
  : new Set();

const brokeNames = brokeValid.map(show).sort();
if (update) {
  writeFileSync(
    baselinePath,
    '# Files the Tree-sitter grammar cannot parse yet. A ratchet, not a\n' +
      '# target: nothing may be added without a reason, and the list should\n' +
      '# only ever get shorter. Regenerate with:\n' +
      '#\n' +
      '#     node scripts/parse-corpus.mjs --update\n' +
      brokeNames.map((n) => `${n}\n`).join(''),
  );
  console.log(`parse-corpus: recorded ${brokeNames.length} known failure(s)`);
}

const regressions = brokeNames.filter((n) => !known.has(n));
const repaired = [...known].filter((n) => !brokeNames.includes(n));

if (!quiet && brokeNames.length > 0) {
  console.log(
    `corpus: ${brokeNames.length} known parse failure(s) — the Tree-sitter ` +
      'grammar is behind the language; see test/corpus-known-failures.txt',
  );
}

if (regressions.length > 0) {
  failed = true;
  console.error(`\n${regressions.length} file(s) newly failed to parse:`);
  for (const f of regressions.slice(0, 40)) console.error(`  ${f}`);
  if (regressions.length > 40) console.error(`  ... ${regressions.length - 40} more`);
  console.error('\nFix the grammar, or record them with --update and say why.');
}

if (repaired.length > 0 && !update) {
  failed = true;
  console.error(
    `\n${repaired.length} file(s) on the known-failure list now parse cleanly.`,
  );
  console.error('Run `node scripts/parse-corpus.mjs --update` to shrink the list.');
}

if (parsedInvalid.length > 0) {
  failed = true;
  console.error(`\n${parsedInvalid.length} file(s) the compiler rejects parsed clean:`);
  for (const f of parsedInvalid) console.error(`  ${show(f)}`);
}

if (failed) process.exit(1);

console.log(
  `parse-corpus: ${valid.length - brokeNames.length}/${valid.length} file(s) ` +
    `parsed clean, ${brokeNames.length} known failure(s), ` +
    `${invalid.length} invalid file(s) correctly rejected (${beansRoot})`,
);
