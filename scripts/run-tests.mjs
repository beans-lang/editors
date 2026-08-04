#!/usr/bin/env node
// The whole suite, in dependency order.
//
//   node scripts/run-tests.mjs [--beans <path>]
//
// Steps that need something this machine may not have — a beans checkout, a
// Rust toolchain — skip with a message rather than failing, so a fresh clone
// of just this repository still goes green.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { editorsRoot } from './lib/language-data.mjs';

const passthrough = process.argv.slice(2);

const steps = [
  {
    name: 'generated assets are up to date',
    command: 'node',
    args: ['scripts/generate.mjs', '--check'],
  },
  {
    name: 'typescript compiles',
    command: 'npm',
    args: ['--workspace', 'beans-vscode', 'run', '--silent', 'build'],
  },
  {
    name: 'typescript lints',
    command: 'npm',
    args: ['--workspace', 'beans-vscode', 'run', '--silent', 'lint'],
  },
  {
    name: 'manifests and package metadata',
    command: 'node',
    args: ['--test', 'test/manifests.test.mjs'],
  },
  {
    name: 'the packaged bundle loads',
    command: 'node',
    args: ['--test', 'test/bundle.test.mjs'],
  },
  {
    name: 'textmate grammar fixtures',
    command: 'node',
    args: ['--test', 'test/tmgrammar.test.mjs'],
  },
  {
    name: 'compiler path resolution (including paths with spaces)',
    command: 'node',
    args: ['--test', 'test/vscode-resolve.test.mjs'],
  },
  {
    name: 'tree-sitter corpus',
    command: join(editorsRoot, 'node_modules', '.bin', 'tree-sitter'),
    args: ['test'],
    cwd: join(editorsRoot, 'tree-sitter-beans'),
  },
  {
    name: 'tree-sitter parses the beans corpus',
    command: 'node',
    args: ['scripts/parse-corpus.mjs', ...passthrough],
  },
  {
    name: 'rust format, lint and check',
    command: 'node',
    args: ['scripts/check-rust.mjs'],
  },
  {
    name: 'real LSP smoke test against beansc lsp',
    command: 'node',
    args: ['--test', 'test/lsp-smoke.test.mjs'],
  },
  {
    name: 'language data matches the compiler',
    command: 'node',
    args: ['scripts/sync-beans.mjs', ...passthrough],
  },
];

const results = [];
let failed = 0;
let skipped = 0;

for (const step of steps) {
  process.stdout.write(`\n=== ${step.name} ===\n`);
  // Output is captured rather than inherited so a step that opted out can be
  // reported as skipped. Reporting a skip as a pass is worse than useless: it
  // makes a green board claim coverage it does not have, which is exactly how
  // CI came to look healthy while never running the compiler-backed checks.
  const result = spawnSync(step.command, step.args, {
    cwd: step.cwd ?? editorsRoot,
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);

  const ok = result.status === 0;
  // `node --test` reports through TAP, which turns a `console.log` from the
  // test file into a `# ` comment. Accept either form, or the marker is
  // invisible exactly when it matters.
  const didSkip = ok && /^\s*(?:# )?skip:/m.test(output);

  if (!ok) failed += 1;
  else if (didSkip) skipped += 1;

  results.push({ name: step.name, state: !ok ? 'FAIL' : didSkip ? 'skip' : 'pass' });
}

console.log('\n────────────────────────────────────────────────────────────');
for (const { name, state } of results) {
  console.log(`${state.padEnd(4)}  ${name}`);
}
console.log('────────────────────────────────────────────────────────────');

const passed = results.length - failed - skipped;
const summary = [`${passed}/${results.length} steps passed`];
if (skipped > 0) summary.push(`${skipped} skipped`);
if (failed > 0) summary.push(`${failed} failed`);
console.log(summary.join(', '));

if (skipped > 0) {
  console.log('\nSkipped steps need a beans checkout with the compiler built.');
  console.log('They are not run in CI: the bootstrap compiler is a private');
  console.log('submodule and no beansc binary has been published yet.');
}

process.exit(failed === 0 ? 0 : 1);
