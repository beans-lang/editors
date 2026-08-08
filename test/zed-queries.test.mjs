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
//
// The check comes in two halves, on purpose. The first reads only files in
// the working tree, so it runs anywhere — including the shallow clone CI
// checks out by default. The second compares the working tree against the
// pinned commit, which needs that commit in the object store; it fetches it
// if git does not already have it, and says exactly what to do if it cannot.

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const editorsRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const queryDir = join(editorsRoot, 'zed', 'languages', 'beans');
const nodeTypesPath = join(
  editorsRoot, 'tree-sitter-beans', 'src', 'node-types.json',
);

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: editorsRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

/** The revision `zed/extension.toml` tells Zed to build the grammar from. */
function pinnedRevision() {
  const toml = readFileSync(join(editorsRoot, 'zed', 'extension.toml'), 'utf8');
  const grammar = toml.slice(toml.indexOf('[grammars.beans]'));
  const rev = /^\s*rev\s*=\s*"([0-9a-f]{40})"/m.exec(grammar);
  assert.ok(rev, 'zed/extension.toml must pin a full 40-character revision');
  return rev[1];
}

/**
 * Named nodes a query refers to. Anonymous tokens are written as strings and
 * the wildcard is `_`, so only bare identifiers after `(` are node types;
 * field names end in `:` and captures start with `@`, and neither matches.
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

function queryFiles() {
  return readdirSync(queryDir).filter((name) => name.endsWith('.scm'));
}

// --- half one: works anywhere, no git history needed ------------------------

test('every node the Zed queries name exists in the grammar', () => {
  const known = new Set(
    JSON.parse(readFileSync(nodeTypesPath, 'utf8')).map((node) => node.type),
  );
  assert.ok(known.size > 0, 'tree-sitter-beans/src/node-types.json is empty');

  const problems = [];
  for (const file of queryFiles()) {
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
    'these queries name nodes the grammar cannot produce, which makes\n' +
      'Tree-sitter reject the whole query and leaves Zed with no highlighting\n' +
      `at all:\n\n${problems.join('\n')}\n\n` +
      'Regenerate the parser (npm run grammar) or fix the query.\n',
  );
});

// --- half two: the pin has to name that same grammar ------------------------

/** True once `revision` is an object git can read here. */
function haveRevision(revision) {
  try {
    git(['cat-file', '-e', `${revision}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * CI checks out with `fetch-depth: 1` unless told otherwise, so the pinned
 * commit may simply not be in the object store. Ask the remote for that one
 * commit before giving up.
 */
function ensureRevision(revision) {
  if (haveRevision(revision)) return true;
  try {
    git(['fetch', '--quiet', '--depth=1', 'origin', revision]);
  } catch {
    return false;
  }
  return haveRevision(revision);
}

test('the pin names the grammar in this working tree', () => {
  const revision = pinnedRevision();
  assert.ok(
    ensureRevision(revision),
    `zed/extension.toml pins ${revision}, which is not in this checkout and\n` +
      'the remote would not serve it. Either the commit was never pushed —\n' +
      'in which case Zed cannot build the grammar for anyone — or this is a\n' +
      'shallow clone with no network. CI sets fetch-depth: 0 for this.\n',
  );

  const listed = git(
    ['ls-tree', '--name-only', revision, 'tree-sitter-beans/src/'],
  );
  assert.match(
    listed,
    /tree-sitter-beans\/src\/parser\.c/,
    `the pinned revision ${revision} has no generated parser.c, so Zed cannot ` +
      'build the grammar at all',
  );

  // A pin that merely *resolves* is not enough: it has to be the grammar these
  // queries were written against, or the first test above only passes because
  // the drift happens to be additive.
  const drift = git(
    ['diff', '--name-only', revision, '--', 'tree-sitter-beans/src/'],
  ).trim();
  assert.equal(
    drift,
    '',
    `the generated grammar has moved since the pinned revision ${revision}:\n` +
      `${drift}\n\nPush the grammar and re-pin, or Zed builds a parser that ` +
      'is not the one this repository tests:\n' +
      '  node scripts/pin-grammar.mjs --rev <sha>\n',
  );
});
