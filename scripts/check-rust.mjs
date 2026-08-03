#!/usr/bin/env node
// Formats, lints, type-checks and Wasm-builds the Zed extension crate.
//
//   node scripts/check-rust.mjs [--fix]
//
// `cargo check` on the host is what proves the code compiles against
// `zed_extension_api`. The artefact Zed actually loads is a Wasm component, so
// the `wasm32-wasip2` build runs too whenever a toolchain carrying that target
// can be found.
//
// Finding one takes a little care: a Homebrew or distro Rust has host std only,
// and Homebrew's `rustup` is keg-only, so the `cargo` on PATH is often not the
// toolchain that has the target. Rather than telling the user their target is
// missing when they just installed it, this looks for any rustup-managed
// toolchain that has it.
//
// Exits 0 with a skip message when no cargo is available at all.

import { existsSync, readdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { editorsRoot } from './lib/language-data.mjs';

const crateDir = join(editorsRoot, 'zed');
const fix = process.argv.includes('--fix');
const WASM_TARGET = 'wasm32-wasip2';

/**
 * Does the rustc next to this cargo carry `target`'s standard library?
 *
 * `--print target-libdir` answers for any target, installed or not, so the
 * directory has to be checked for real.
 */
function hasTarget(cargo, target) {
  const rustc = cargo === 'cargo' ? 'rustc' : join(dirname(cargo), 'rustc');
  try {
    const dir = execFileSync(rustc, ['--print', 'target-libdir', '--target', target], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return existsSync(dir.trim());
  } catch {
    return false;
  }
}

/** Every cargo worth trying, PATH first. */
function candidateCargos() {
  const found = [];
  if (spawnSync('cargo', ['--version'], { stdio: 'ignore' }).status === 0) found.push('cargo');

  const toolchains = join(homedir(), '.rustup', 'toolchains');
  if (existsSync(toolchains)) {
    for (const name of readdirSync(toolchains)) {
      const cargo = join(toolchains, name, 'bin', 'cargo');
      if (existsSync(cargo)) found.push(cargo);
    }
  }
  return found;
}

const cargos = candidateCargos();

if (cargos.length === 0) {
  console.log('skip: no cargo found — the Zed extension crate was not checked.');
  console.log('Install Rust (https://rustup.rs) to run this.');
  process.exit(0);
}

const hostCargo = cargos[0];
const wasmCargo = cargos.find((cargo) => hasTarget(cargo, WASM_TARGET));

/**
 * Cargo finds `rustc` on PATH, not next to itself. Running a toolchain's cargo
 * by absolute path would otherwise pick up whichever rustc happens to be first
 * on PATH — which is how "target not installed" comes back from a toolchain
 * that has it.
 */
function environmentFor(cargo) {
  if (cargo === 'cargo') return process.env;
  const bin = dirname(cargo);
  return {
    ...process.env,
    RUSTC: join(bin, 'rustc'),
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
  };
}

function run(cargo, label, args) {
  process.stdout.write(`${label}... `);
  const result = spawnSync(cargo, args, {
    cwd: crateDir,
    encoding: 'utf8',
    env: environmentFor(cargo),
  });
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
ok = run(hostCargo, 'cargo fmt', fix ? ['fmt'] : ['fmt', '--check']) && ok;
ok = run(hostCargo, 'cargo check', ['check', '--quiet']) && ok;

if (spawnSync(hostCargo, ['clippy', '--version'], { stdio: 'ignore' }).status === 0) {
  ok = run(hostCargo, 'cargo clippy', ['clippy', '--quiet', '--all-targets', '--', '-D', 'warnings']) && ok;
} else {
  console.log('cargo clippy... skipped (not installed)');
}

if (wasmCargo !== undefined) {
  const via = wasmCargo === 'cargo' ? '' : ` (via ${wasmCargo})`;
  ok =
    run(wasmCargo, `cargo build --target ${WASM_TARGET}${via}`, [
      'build',
      '--quiet',
      '--release',
      '--target',
      WASM_TARGET,
    ]) && ok;
} else {
  console.log(`cargo build --target ${WASM_TARGET}... skipped (no toolchain has the target)`);
  console.log('  Zed builds this itself on "Install Dev Extension". To build it here:');
  console.log(`    rustup target add ${WASM_TARGET}`);
}

process.exit(ok ? 0 : 1);
