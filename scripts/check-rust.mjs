#!/usr/bin/env node
// Formats, lints and type-checks the Zed extension crate.
//
//   node scripts/check-rust.mjs [--fix]
//
// The host-target `cargo check` is what proves the code compiles against
// `zed_extension_api`. The real artefact is a Wasm component, and Zed builds
// that itself when you install the extension — that step needs rustup and the
// `wasm32-wasip2` target, so it is attempted only when the target is actually
// installed and skipped with a clear message otherwise.
//
// Exits 0 with a skip message when cargo is not installed.

import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { editorsRoot } from './lib/language-data.mjs';

const crateDir = join(editorsRoot, 'zed');
const fix = process.argv.includes('--fix');

function have(command) {
  return spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;
}

if (!have('cargo')) {
  console.log('skip: cargo not installed — the Zed extension crate was not checked.');
  console.log('Install Rust (https://rustup.rs) to run this.');
  process.exit(0);
}

function run(label, args) {
  process.stdout.write(`${label}... `);
  const result = spawnSync('cargo', args, { cwd: crateDir, encoding: 'utf8' });
  if (result.status === 0) {
    console.log('ok');
    return true;
  }
  console.log('FAILED');
  process.stderr.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  return false;
}

let ok = true;
ok = run('cargo fmt', fix ? ['fmt'] : ['fmt', '--check']) && ok;
ok = run('cargo check', ['check', '--quiet']) && ok;

if (have('cargo-clippy') || spawnSync('cargo', ['clippy', '--version'], { stdio: 'ignore' }).status === 0) {
  ok = run('cargo clippy', ['clippy', '--quiet', '--all-targets', '--', '-D', 'warnings']) && ok;
} else {
  console.log('cargo clippy... skipped (not installed)');
}

// The Wasm build. Zed compiles the extension for `wasm32-wasip2`, which needs
// a rustup-managed toolchain; a Homebrew or distro rustc has host std only.
const targets = (() => {
  try {
    return execFileSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8' });
  } catch {
    return '';
  }
})();

if (targets.includes('wasm32-wasip2')) {
  ok = run('cargo build --target wasm32-wasip2', [
    'build',
    '--quiet',
    '--release',
    '--target',
    'wasm32-wasip2',
  ]) && ok;
} else {
  console.log('cargo build --target wasm32-wasip2... skipped (target not installed)');
  console.log('  Zed builds this itself on "Install Dev Extension". To build it here:');
  console.log('    rustup target add wasm32-wasip2');
}

process.exit(ok ? 0 : 1);
