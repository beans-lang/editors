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

for (const step of steps) {
  process.stdout.write(`\n=== ${step.name} ===\n`);
  const result = spawnSync(step.command, step.args, {
    cwd: step.cwd ?? editorsRoot,
    stdio: 'inherit',
    encoding: 'utf8',
  });
  const ok = result.status === 0;
  if (!ok) failed += 1;
  results.push({ name: step.name, ok });
}

console.log('\n────────────────────────────────────────────────────────────');
for (const { name, ok } of results) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}`);
}
console.log('────────────────────────────────────────────────────────────');
console.log(`${results.length - failed}/${results.length} steps passed`);

process.exit(failed === 0 ? 0 : 1);
