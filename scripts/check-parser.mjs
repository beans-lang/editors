#!/usr/bin/env node
// The committed Tree-sitter parser matches grammar.js.
//
// `tree-sitter-beans/src/` is generated but committed — Zed clones this
// repository and compiles the parser from source, so a stale copy is what a
// user actually runs. grammar.js reads `grammar-data.json`, which comes from
// `shared/language.json`, so adding one contextual keyword there changes the
// parser without anyone touching grammar.js.
//
// CI has always checked this. `npm test` did not, which is how a release went
// out with a parser one keyword behind its own grammar: everything local was
// green and the mismatch appeared only after the tag was pushed. Regenerating
// and diffing is a few seconds; finding out from a failed release is not.

import { spawnSync } from 'node:child_process';

import { editorsRoot } from './lib/language-data.mjs';

const run = (command, args) =>
  spawnSync(command, args, { cwd: editorsRoot, encoding: 'utf8' });

const generated = run('npm', ['--workspace', 'tree-sitter-beans', 'run', '--silent', 'build']);
if (generated.status !== 0) {
  console.error('tree-sitter generate failed:');
  console.error(generated.stderr || generated.stdout);
  process.exit(1);
}

// Against HEAD, not the index: staging the regenerated parser without
// committing it would otherwise read as clean.
const diff = run('git', ['diff', 'HEAD', '--stat', '--', 'tree-sitter-beans/src']);
if (diff.status !== 0) {
  console.error('could not diff the generated parser:');
  console.error(diff.stderr);
  process.exit(1);
}

if (diff.stdout.trim() !== '') {
  console.error('The committed parser does not match grammar.js:\n');
  console.error(diff.stdout);
  console.error('Run `npm --workspace tree-sitter-beans run build` and commit');
  console.error('tree-sitter-beans/src/.');
  process.exit(1);
}

console.log('parser: tree-sitter-beans/src matches grammar.js');
