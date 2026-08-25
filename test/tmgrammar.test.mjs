// TextMate grammar fixtures.
//
// This is the highlighting a `.b` file gets the instant it opens, before
// `beansc lsp` has even started, so it has to be right on its own. The tests
// tokenize with the same libraries VS Code uses (vscode-textmate over
// vscode-oniguruma) and assert the scope at a specific character.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const editorsRoot = join(here, '..');
const require = createRequire(import.meta.url);

const oniguruma = require('vscode-oniguruma');
const textmate = require('vscode-textmate');

const GRAMMARS = {
  'source.beans': join(editorsRoot, 'vscode', 'syntaxes', 'beans.tmLanguage.json'),
  'source.beans-manifest': join(
    editorsRoot,
    'vscode',
    'syntaxes',
    'beans-manifest.tmLanguage.json',
  ),
};

let registry;

before(async () => {
  const wasmPath = require.resolve('vscode-oniguruma/release/onig.wasm');
  await oniguruma.loadWASM(readFileSync(wasmPath).buffer);
  registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
      createOnigString: (s) => new oniguruma.OnigString(s),
    }),
    loadGrammar: async (scopeName) => {
      const path = GRAMMARS[scopeName];
      if (path === undefined) return null;
      return textmate.parseRawGrammar(readFileSync(path, 'utf8'), path);
    },
  });
});

/** Tokenizes `source` and returns one entry per token with its scopes. */
async function tokenize(source, scopeName = 'source.beans') {
  const grammar = await registry.loadGrammar(scopeName);
  assert.ok(grammar, `grammar ${scopeName} should load`);
  const out = [];
  let ruleStack = textmate.INITIAL;
  for (const [lineNumber, line] of source.split('\n').entries()) {
    const result = grammar.tokenizeLine(line, ruleStack);
    ruleStack = result.ruleStack;
    for (const token of result.tokens) {
      out.push({
        line: lineNumber,
        text: line.slice(token.startIndex, token.endIndex),
        scopes: token.scopes,
      });
    }
  }
  return out;
}

/** The scopes of the first token whose text is exactly `text`. */
async function scopesOf(source, text, scopeName = 'source.beans') {
  const tokens = await tokenize(source, scopeName);
  const hit = tokens.find((t) => t.text === text);
  assert.ok(hit, `no token with text ${JSON.stringify(text)} in:\n${JSON.stringify(tokens, null, 1)}`);
  return hit.scopes;
}

/** Asserts that some token containing `text` carries `scope`. */
async function assertScope(source, text, scope, scopeName = 'source.beans') {
  const tokens = await tokenize(source, scopeName);
  const matches = tokens.filter((t) => t.text.includes(text));
  assert.ok(matches.length > 0, `no token containing ${JSON.stringify(text)}`);
  const found = matches.some((t) => t.scopes.some((s) => s.startsWith(scope)));
  assert.ok(
    found,
    `expected ${JSON.stringify(text)} to carry ${scope}; got ${JSON.stringify(
      matches.map((m) => m.scopes),
    )}`,
  );
}

describe('comments', () => {
  test('a line comment is a comment', async () => {
    await assertScope('// note\n', 'note', 'comment.line.double-slash.beans');
  });

  test('/// is documentation, not a plain line comment', async () => {
    const scopes = await scopesOf('/// docs here\n', ' docs here');
    assert.ok(scopes.includes('comment.line.documentation.beans'));
  });

  test('//// is a divider, not documentation', async () => {
    const tokens = await tokenize('//// -----\n', 'source.beans');
    const doc = tokens.filter((t) => t.scopes.includes('comment.line.documentation.beans'));
    assert.equal(doc.length, 0, 'a four-slash divider must not be documentation');
    await assertScope('//// -----\n', '-----', 'comment.line.double-slash.beans');
  });

  test('a block comment is a comment', async () => {
    await assertScope('/* hidden */\n', 'hidden', 'comment.block.beans');
  });

  test('block comments nest — code after an inner close stays commented', async () => {
    // The compiler counts depth, so `fn decoy` here is inside the comment.
    const source = '/* /* */ fn decoy() {} */\nfn real() {}\n';
    await assertScope(source, 'decoy', 'comment.block.beans');
    // ...and the code after the real close is not.
    await assertScope(source, 'real', 'entity.name.function.beans');
  });

  test('a nested comment closes at the right delimiter', async () => {
    const tokens = await tokenize('/* a /* b */ c */\nlet x: int = 1\n');
    const letToken = tokens.find((t) => t.text === 'let');
    assert.ok(letToken, 'the line after the comment should be code');
    assert.ok(!letToken.scopes.some((s) => s.startsWith('comment')));
  });
});

describe('strings', () => {
  test('a string is a string', async () => {
    await assertScope('let s: string = "hello"\n', 'hello', 'string.quoted.double.beans');
  });

  test('every escape the lexer accepts is an escape', async () => {
    for (const escape of ['\\n', '\\t', '\\r', '\\0', '\\\\', '\\"', '\\{', '\\}']) {
      const source = `let s: string = "${escape}"\n`;
      await assertScope(source, escape, 'constant.character.escape.beans');
    }
  });

  test('an unknown escape is flagged', async () => {
    await assertScope('let s: string = "\\q"\n', '\\q', 'invalid.illegal.unknown-escape.beans');
  });

  test('an interpolated expression is code, not string text', async () => {
    const scopes = await scopesOf('let s: string = "hi {name}"\n', 'name');
    assert.ok(
      scopes.some((s) => s.startsWith('meta.interpolation.beans')),
      `expected interpolation scope, got ${scopes}`,
    );
    assert.ok(
      scopes.some((s) => s.startsWith('variable')),
      'the interpolated name should be highlighted as code',
    );
  });

  test('a string inside an interpolation is a string', async () => {
    const source = 'let s: string = "[{fmt.pad_left("42", 8)}]"\n';
    await assertScope(source, '42', 'string.quoted.double.beans');
    await assertScope(source, 'pad_left', 'entity.name.function.member.beans');
  });

  test('an escaped brace does not open an interpolation', async () => {
    const tokens = await tokenize('let s: string = "\\{ not code \\}"\n');
    const inside = tokens.find((t) => t.text.includes('not code'));
    assert.ok(inside);
    assert.ok(
      !inside.scopes.some((s) => s.startsWith('meta.interpolation')),
      'text after an escaped brace must stay string content',
    );
  });

  test('format specs are highlighted', async () => {
    await assertScope('let s: string = "{pi:8.2}"\n', '8.2', 'constant.other.format-spec.beans');
  });
});

describe('numbers', () => {
  const cases = [
    ['1_000_000', 'constant.numeric.integer.beans'],
    ['0xFF', 'constant.numeric.hex.beans'],
    ['0b1010', 'constant.numeric.binary.beans'],
    ['3.14159', 'constant.numeric.float.beans'],
    ['2.5e-3', 'constant.numeric.float.beans'],
    ['1e9', 'constant.numeric.float.beans'],
  ];

  for (const [literal, scope] of cases) {
    test(`${literal} is ${scope.split('.').at(-2)}`, async () => {
      await assertScope(`let n: int = ${literal}\n`, literal, scope);
    });
  }

  test('0..10 is a range, not a float', async () => {
    const tokens = await tokenize('for i: int in 0..10 {}\n');
    const floats = tokens.filter((t) => t.scopes.includes('constant.numeric.float.beans'));
    assert.equal(floats.length, 0, '0..10 must not tokenize as a float');
    await assertScope('for i: int in 0..10 {}\n', '..', 'keyword.operator.range.beans');
  });
});

describe('keywords and types', () => {
  test('declaration keywords are storage', async () => {
    await assertScope('class Point {}\n', 'class', 'storage.type.beans');
  });

  test('control keywords are control', async () => {
    await assertScope('if x { }\n', 'if', 'keyword.control.beans');
  });

  test('primitives are builtin types', async () => {
    await assertScope('let n: int = 1\n', 'int', 'support.type.primitive.beans');
  });

  test('builtin classes are builtin', async () => {
    await assertScope('var xs: List<int> = []\n', 'List', 'support.class.beans');
  });

  test('a declared type name is an entity', async () => {
    await assertScope('class Point {}\n', 'Point', 'entity.name.type.beans');
  });

  test('a function declaration names the function', async () => {
    await assertScope('fn add(a: int) -> int {}\n', 'add', 'entity.name.function.beans');
  });

  test('self is a language variable', async () => {
    await assertScope('fn f() { return self.x }\n', 'self', 'variable.language.self.beans');
  });

  test('an import path is a namespace', async () => {
    await assertScope('import std.io\n', 'std.io', 'entity.name.namespace.beans');
  });

  test('an aliased import names both', async () => {
    const source = 'import gitlab.com/tools/csv as csvlib\n';
    await assertScope(source, 'gitlab.com/tools/csv', 'entity.name.namespace.beans');
    await assertScope(source, 'csvlib', 'entity.name.namespace.alias.beans');
  });
});

describe('contextual keywords', () => {
  test('unique before class is a modifier', async () => {
    await assertScope('pub unique class Dylib {}\n', 'unique', 'storage.modifier.beans');
  });

  test('packed before struct is a modifier', async () => {
    await assertScope('extern "C" packed struct H {}\n', 'packed', 'storage.modifier.beans');
  });

  test('a field named align is not a modifier', async () => {
    // The compiler's own layout.b has one, so this must not be highlighted
    // as a keyword.
    const scopes = await scopesOf('class ValueLayout {\n    align: int\n}\n', 'align');
    assert.ok(
      !scopes.includes('storage.modifier.beans'),
      `a field called align must stay a name, got ${scopes}`,
    );
  });

  test('align(N) is a modifier', async () => {
    await assertScope('extern "C" align(64) struct C {}\n', 'align', 'storage.modifier.beans');
  });

  test('size_of is a builtin function', async () => {
    await assertScope('let n: int = size_of(Frame)\n', 'size_of', 'support.function.builtin.beans');
  });

  test('some and none are ordinary names', async () => {
    const scopes = await scopesOf('let some: int = 1\n', 'some');
    assert.ok(
      !scopes.some((s) => s.startsWith('keyword')),
      `some must not be a keyword, got ${scopes}`,
    );
  });

  test('brew before a call is a keyword', async () => {
    await assertScope('    brew warm(ctx)\n', 'brew', 'keyword.control.beans');
  });

  test('brew keeps the keyword scope in a let initializer', async () => {
    await assertScope(
      '    let h: Brew<int> = brew work(21)\n',
      'brew',
      'keyword.control.beans',
    );
  });

  test('the TaskGroup method group.brew(...) is not a keyword', async () => {
    const scopes = await scopesOf('    group.brew(double(2))\n', 'brew');
    assert.ok(
      !scopes.some((s) => s.startsWith('keyword')),
      `a method called brew must stay a name, got ${scopes}`,
    );
  });

  test('a local named brew is not a keyword', async () => {
    // `var brew: int = 5` then `brew = brew + 1` is code the compiler
    // accepts, so neither use may paint as a keyword.
    const declared = await scopesOf('    var brew: int = 5\n', 'brew');
    assert.ok(
      !declared.some((s) => s.startsWith('keyword')),
      `a local called brew must stay a name, got ${declared}`,
    );
    const assigned = await scopesOf('    brew = brew + 1\n', 'brew');
    assert.ok(
      !assigned.some((s) => s.startsWith('keyword')),
      `assigning to brew must stay a name, got ${assigned}`,
    );
  });

  test('Brew, TaskGroup and Gate are builtin types', async () => {
    await assertScope('let h: Brew<int> = brew work(1)\n', 'Brew', 'support.class.beans');
    await assertScope(
      'let g: TaskGroup<int> = new TaskGroup<int>()\n',
      'TaskGroup',
      'support.class.beans',
    );
    await assertScope('let gate: Gate = new Gate()\n', 'Gate', 'support.class.beans');
  });
});

describe('the package clause', () => {
  test('package names the package', async () => {
    const source = 'package money\n\nimport std.io\n';
    await assertScope(source, 'package', 'keyword.control.package.beans');
    await assertScope(source, 'money', 'entity.name.namespace.beans');
  });

  test('a trailing comment does not stop the clause matching', async () => {
    await assertScope('package main // the root\n', 'package', 'keyword.control.package.beans');
  });

  test('a field named package is not a keyword', async () => {
    // The compiler's own module.b uses `package` as an ordinary name, so this
    // is the case that breaks first if the rule over-matches.
    const scopes = await scopesOf('class Release {\n    package: string\n}\n', 'package');
    assert.ok(
      !scopes.some((s) => s.startsWith('keyword')),
      `a field called package must stay a name, got ${scopes}`,
    );
  });

  test('a local named package is not a keyword', async () => {
    const scopes = await scopesOf('fn f() {\n    let package: string = ""\n}\n', 'package');
    assert.ok(
      !scopes.some((s) => s.startsWith('keyword')),
      `a local called package must stay a name, got ${scopes}`,
    );
  });
});

describe('async and await are ordinary names', () => {
  // The words left the language — no position makes either one a keyword.
  test('async before fn is a plain name', async () => {
    const scopes = await scopesOf('async fn watch() -> int {}\n', 'async');
    assert.ok(
      !scopes.some((s) => s.startsWith('storage.modifier') || s.startsWith('keyword')),
      `async must stay a name even before fn, got ${scopes}`,
    );
  });

  test('await before an operand is a plain name', async () => {
    const scopes = await scopesOf('fn f() {\n    let woke: bool = await\n}\n', 'await');
    assert.ok(
      !scopes.some((s) => s.startsWith('keyword')),
      `await must stay a name, got ${scopes}`,
    );
  });

  test('a field named async is not a keyword', async () => {
    const scopes = await scopesOf('class Job {\n    async: int\n}\n', 'async');
    assert.ok(
      !scopes.some((s) => s.startsWith('storage.modifier')),
      `a field called async must stay a name, got ${scopes}`,
    );
  });

  test('a local named await is not a keyword', async () => {
    const scopes = await scopesOf('fn f() {\n    var await: bool = false\n}\n', 'await');
    assert.ok(
      !scopes.some((s) => s.startsWith('keyword.operator.await')),
      `a local called await must stay a name, got ${scopes}`,
    );
  });
});

describe('the beans.pot manifest grammar', () => {
  const scope = 'source.beans-manifest';

  test('module names the package', async () => {
    await assertScope('module shop\n', 'module', 'keyword.control.beans-manifest', scope);
    await assertScope('module shop\n', 'shop', 'entity.name.namespace.beans-manifest', scope);
  });

  test('kind values are language constants', async () => {
    await assertScope('kind library\n', 'library', 'constant.language.beans-manifest', scope);
  });

  test('require names a module and a version', async () => {
    const source = 'require github.com/acme/http v1.2\n';
    await assertScope(source, 'github.com/acme/http', 'entity.name.namespace.beans-manifest', scope);
    await assertScope(source, 'v1.2', 'constant.other.version.beans-manifest', scope);
  });

  test('link lines are keywords', async () => {
    await assertScope('link all library "shop_native"\n', 'link', 'keyword.control.beans-manifest', scope);
  });

  test('comments are comments', async () => {
    await assertScope('module shop // note\n', 'note', 'comment.line.double-slash.beans-manifest', scope);
  });
});
