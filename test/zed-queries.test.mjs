// Zed's queries have to match the grammar Zed will actually build.
//
// `zed/extension.toml` pins an exact grammar revision, and Zed compiles the
// parser from *that* commit while reading the `.scm` queries from the working
// tree. Tree-sitter rejects a whole query file on one unknown node type, so a
// query naming a node the pinned parser does not have costs you every colour
// in the file — not one rule, all of them. That is what a stale pin looks
// like from the outside: plain text, no error the user ever sees.
//
// It has happened. `aa87ed3` taught the grammar `package`, `async` and
// `await`, added queries for them, and left the pin on the commit before, so
// Zed silently painted nothing until the pin was moved to `74a3c19`.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const editorsRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const queryDir = join(editorsRoot, 'zed', 'languages', 'beans');

/** The revision `zed/extension.toml` tells Zed to build the grammar from. */
function pinnedRevision() {
  const toml = readFileSync(join(editorsRoot, 'zed', 'extension.toml'), 'utf8');
  const grammar = toml.slice(toml.indexOf('[grammars.beans]'));
  const rev = /^\s*rev\s*=\s*"([0-9a-f]{40})"/m.exec(grammar);
  assert.ok(rev, 'zed/extension.toml must pin a full 40-character revision');
  return rev[1];
}

/** Every node type the pinned parser can actually produce. */
function nodeTypesAt(revision) {
  const raw = execFileSync(
    'git',
    ['show', `${revision}:tree-sitter-beans/src/node-types.json`],
    { cwd: editorsRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return new Set(JSON.parse(raw).map((node) => node.type));
}

/**
 * Named nodes a query refers to. Anonymous tokens are written as strings and
 * supernodes as `_`, so only bare identifiers after `(` are node types; field
 * names end in `:` and captures start with `@`, and neither matches here.
 */
function referencedNodes(source) {
  const found = new Map();
  source.split('\n').forEach((line, index) => {
    // strip comments so a commented-out rule cannot fail the build
    const code = line.replace(/;.*$/, '');
    for (const match of code.matchAll(/\(\s*([a-z_][a-z0-9_]*)\b/g)) {
      // `(_)` is the wildcard, not a node type, and matches anything.
      if (match[1] === '_') continue;
      if (!found.has(match[1])) found.set(match[1], index + 1);
    }
  });
  return found;
}

test('every node the Zed queries name exists in the pinned grammar', () => {
  const revision = pinnedRevision();
  const known = nodeTypesAt(revision);
  assert.ok(known.size > 0, 'the pinned revision has no node-types.json');

  const problems = [];
  for (const file of readdirSync(queryDir).filter((n) => n.endsWith('.scm'))) {
    const source = readFileSync(join(queryDir, file), 'utf8');
    for (const [node, line] of referencedNodes(source)) {
      if (!known.has(node)) {
        problems.push(`  zed/languages/beans/${file}:${line} names (${node})`);
      }
    }
  }

  assert.equal(
    problems.length,
    0,
    `these queries name nodes the pinned grammar cannot produce, which makes\n` +
      `Tree-sitter reject the whole query and leaves Zed with no highlighting\n` +
      `at all:\n\n${problems.join('\n')}\n\n` +
      `The pin is ${revision}. If the grammar has moved, push it and re-pin:\n` +
      `  node scripts/pin-grammar.mjs --rev <sha>\n`,
  );
});

test('the pinned revision carries a generated parser', () => {
  const revision = pinnedRevision();
  const listed = execFileSync(
    'git',
    ['ls-tree', '--name-only', revision, 'tree-sitter-beans/src/'],
    { cwd: editorsRoot, encoding: 'utf8' },
  );
  assert.match(
    listed,
    /tree-sitter-beans\/src\/parser\.c/,
    `the pinned revision ${revision} has no generated parser.c, so Zed cannot ` +
      `build the grammar at all`,
  );
});

test('the working tree grammar is the pinned one', () => {
  // A pin that is merely *valid* is not enough: it also has to be the grammar
  // these queries were written against, or the first test above only passes
  // because the drift happens to be additive.
  const revision = pinnedRevision();
  const drift = execFileSync(
    'git',
    ['diff', '--name-only', revision, '--', 'tree-sitter-beans/src/'],
    { cwd: editorsRoot, encoding: 'utf8' },
  ).trim();
  assert.equal(
    drift,
    '',
    `the generated grammar has moved since the pinned revision ${revision}:\n` +
      `${drift}\n\nPush the grammar and re-pin, or Zed builds a parser that ` +
      `is not the one this repository tests.`,
  );
});
