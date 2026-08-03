#!/usr/bin/env node
// Pins the Tree-sitter grammar revision in editors/zed/extension.toml.
//
// Zed fetches a grammar by cloning a git repository at an exact revision, so
// the extension cannot reference a working copy. `extension.toml` therefore
// ships with `rev = "UNPINNED"` — an obviously-unset value rather than a
// plausible-looking SHA that would fail at install time with a confusing
// checkout error.
//
//   node scripts/pin-grammar.mjs --local
//       Point the grammar at this checkout via a `file://` URL at the current
//       HEAD. Zed supports this for local development. HEAD must already
//       contain tree-sitter-beans/src/parser.c.
//
//   node scripts/pin-grammar.mjs --rev <sha>
//       Pin a pushed commit. This is what a release uses.
//
//   node scripts/pin-grammar.mjs --unpin
//       Put it back to UNPINNED.
//
//   node scripts/pin-grammar.mjs --status
//       Report the current pin and whether it looks usable.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { editorsRoot } from './lib/language-data.mjs';

const manifestPath = join(editorsRoot, 'zed', 'extension.toml');
const GRAMMAR_SOURCE = join('tree-sitter-beans', 'src', 'parser.c');
const UNPINNED = 'UNPINNED';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : null;
};

function git(...gitArgs) {
  return execFileSync('git', gitArgs, { cwd: editorsRoot, encoding: 'utf8' }).trim();
}

function readManifest() {
  return readFileSync(manifestPath, 'utf8');
}

/** Reads the current `[grammars.beans]` repository and rev. */
function currentPin(text) {
  const section = /\[grammars\.beans\]([\s\S]*?)(?:\n\[|$)/.exec(text);
  if (section === null) throw new Error('no [grammars.beans] section in zed/extension.toml');
  const repository = /repository\s*=\s*"([^"]*)"/.exec(section[1])?.[1] ?? '';
  const rev = /rev\s*=\s*"([^"]*)"/.exec(section[1])?.[1] ?? '';
  return { repository, rev };
}

function writePin(repository, rev) {
  const text = readManifest();
  const section = /(\[grammars\.beans\][\s\S]*?)(?=\n\[|$)/.exec(text);
  if (section === null) throw new Error('no [grammars.beans] section in zed/extension.toml');
  const updated = section[1]
    .replace(/repository\s*=\s*"[^"]*"/, `repository = "${repository}"`)
    .replace(/rev\s*=\s*"[^"]*"/, `rev = "${rev}"`);
  writeFileSync(manifestPath, text.replace(section[1], updated));
  console.log(`zed/extension.toml: repository = ${repository}`);
  console.log(`zed/extension.toml: rev        = ${rev}`);
}

/** True when the given commit contains the generated parser. */
function commitHasParser(rev) {
  try {
    git('cat-file', '-e', `${rev}:${GRAMMAR_SOURCE}`);
    return true;
  } catch {
    return false;
  }
}

if (flag('--status')) {
  const { repository, rev } = currentPin(readManifest());
  console.log(`repository = ${repository}`);
  console.log(`rev        = ${rev}`);
  if (rev === UNPINNED) {
    console.log('\nstatus: not pinned — Zed cannot install this extension yet.');
    console.log('Run `node scripts/pin-grammar.mjs --local` or `--rev <sha>`.');
    process.exit(0);
  }
  if (!commitHasParser(rev)) {
    console.log(`\nstatus: ${rev} does not contain ${GRAMMAR_SOURCE} in this checkout.`);
    process.exit(1);
  }
  console.log(`\nstatus: pinned, and ${rev} carries ${GRAMMAR_SOURCE}.`);
  process.exit(0);
}

if (flag('--unpin')) {
  writePin('https://github.com/beans-lang/editors', UNPINNED);
  process.exit(0);
}

if (flag('--local')) {
  const head = git('rev-parse', 'HEAD');
  if (!commitHasParser(head)) {
    console.error(
      `HEAD (${head}) does not contain ${GRAMMAR_SOURCE}.\n` +
        'Commit the generated grammar first:\n' +
        '  npm run grammar\n' +
        '  git add tree-sitter-beans && git commit -m "Add the Beans tree-sitter grammar"',
    );
    process.exit(1);
  }
  writePin(`file://${editorsRoot}`, head);
  console.log('\nLocal pin written. Reinstall the dev extension in Zed to pick it up.');
  process.exit(0);
}

const rev = value('--rev');
if (rev !== null) {
  if (!/^[0-9a-f]{7,40}$/i.test(rev)) {
    console.error(`--rev expects a git SHA, got ${JSON.stringify(rev)}`);
    process.exit(1);
  }
  if (!commitHasParser(rev)) {
    console.error(
      `${rev} does not contain ${GRAMMAR_SOURCE} in this checkout.\n` +
        'Pin a commit that carries the generated parser, and make sure it is pushed.',
    );
    process.exit(1);
  }
  writePin('https://github.com/beans-lang/editors', rev);
  process.exit(0);
}

console.error(
  'usage: pin-grammar.mjs [--status | --local | --rev <sha> | --unpin]\n' +
    '\nZed needs an exact grammar revision. See editors/zed/README.md.',
);
process.exit(1);
