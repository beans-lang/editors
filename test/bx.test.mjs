// `.bx` markup: where the cursor is, and what the grammar paints.
//
// Two halves, and the first is the one that can be quietly wrong. A completion
// list is only right if the editor knows whether the cursor sits in a tag, in
// an attribute value, or in ordinary Beans — and `<div>` appears in strings, in
// comments and inside `{...}` holes in real `.bx` files, where it is none of
// those things. The scanner runs against the compiled `vscode/out/bx-model.js`,
// which imports nothing from `vscode` exactly so this can be a plain
// `node --test` run.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const editorsRoot = join(here, '..');
const compiled = join(editorsRoot, 'vscode', 'out', 'bx-model.js');

if (!existsSync(compiled)) {
  throw new Error(
    `${compiled} is missing — run \`npm --workspace beans-vscode run build\` first.`,
  );
}

const require = createRequire(import.meta.url);
const { BX, bxContextAt, rampFamilyOf, takesAColor } = require(compiled);

/**
 * The context where `|` sits, which is written into the source and removed.
 * A cursor is a position, and writing one as a marker is the only way to keep
 * the test readable when the position is halfway through a multi-line tag.
 */
function at(source) {
  const offset = source.indexOf('|');
  assert.ok(offset >= 0, 'the fixture needs a | for the cursor');
  return bxContextAt(source.replace('|', ''), offset);
}

describe('the bx vocabulary', () => {
  test('it came from crema and is not empty', () => {
    assert.ok(BX.tags.some((t) => t.name === 'div'));
    assert.ok(BX.flags.includes('flex'));
    assert.ok(BX.flags.includes('items-center'), 'names are in markup spelling');
    assert.ok(BX.ramps.some((r) => r.family === 'gap'));
    assert.ok(BX.colors.some((c) => c.name === 'red'));
    assert.ok(BX.events.some((e) => e.event === 'click'));
  });

  test('every ramp family names a step table that exists', () => {
    for (const ramp of BX.ramps) {
      const steps = BX.stepTables[ramp.table];
      assert.ok(steps !== undefined && steps.length > 0,
        `${ramp.family} names table ${ramp.table}, which has no steps`);
    }
  });

  test('the longest matching family wins', () => {
    // `max-w-4` is `max-w` and `4`, not `m` and nonsense — and `m-neg-4` is
    // `m` and `neg-4`, which is why shortest-first would be wrong.
    assert.equal(rampFamilyOf('max-w-4')?.family, 'max-w');
    assert.equal(rampFamilyOf('m-neg-4')?.family, 'm');
    assert.equal(rampFamilyOf('flex'), undefined);
  });

  test('a colour attribute is one whose value names a colour', () => {
    assert.ok(takesAColor('bg'));
    assert.ok(takesAColor('border-color'));
    assert.ok(!takesAColor('font-family'));
  });
});

describe('where the cursor is', () => {
  test('right after a `<` is a tag name', () => {
    const context = at('fn view() {\n    return <d|\n}\n');
    assert.equal(context.kind, 'tag');
    assert.equal(context.prefix, 'd');
  });

  test('inside an open tag is an attribute', () => {
    const context = at('    return <div flex |>\n');
    assert.equal(context.kind, 'attr');
    assert.equal(context.tag, 'div');
  });

  test('a partly typed attribute comes back as the prefix', () => {
    const context = at('    return <div gap-|>\n');
    assert.equal(context.kind, 'attr');
    assert.equal(context.prefix, 'gap-');
  });

  test('inside a quoted value names the attribute it belongs to', () => {
    const context = at('    return <div bg="re|">\n');
    assert.equal(context.kind, 'value');
    assert.equal(context.attr, 'bg');
    assert.equal(context.prefix, 're');
  });

  test('after the tag closes, it is Beans again', () => {
    const context = at('    return <div flex>|\n');
    assert.equal(context.kind, 'none');
  });

  test('a self-closing tag closes', () => {
    const context = at('    let a: int = 1\n    <div w-4 />\n    let b|: int = 2\n');
    assert.equal(context.kind, 'none');
  });

  test('a tag broken over lines is still one tag', () => {
    const context = at('    return <div\n        flex\n        gap-2\n        |\n    >\n');
    assert.equal(context.kind, 'attr');
    assert.equal(context.tag, 'div');
  });

  test('a `<div>` in a string is not a tag', () => {
    const context = at('    let s: string = "a <div> in a string"\n    let n|: int = 1\n');
    assert.equal(context.kind, 'none');
  });

  test('the cursor inside that string is not an attribute either', () => {
    const context = at('    let s: string = "a <div fl|ex"\n');
    assert.equal(context.kind, 'none');
  });

  test('a commented-out tag is not a tag', () => {
    const context = at('    // <div flex>\n    let n|: int = 1\n');
    assert.equal(context.kind, 'none');
  });

  test('a block comment holding a tag is not a tag', () => {
    const context = at('    /* <div flex> */\n    let n|: int = 1\n');
    assert.equal(context.kind, 'none');
  });

  test('`List<string>` is not a tag: a name ends before the `<`', () => {
    const context = at('    let xs: List<string> = []\n    let n|: int = 1\n');
    assert.equal(context.kind, 'none');
  });

  test('`f() < n` and `xs[i] < n` are comparisons', () => {
    assert.equal(at('    if count() <n {\n        let x|: int = 1\n').kind, 'none');
    assert.equal(at('    if xs[i] <n {\n        let x|: int = 1\n').kind, 'none');
  });

  test('a handler body with its own braces does not end the tag early', () => {
    const source =
      '    return <div on:click={fn(e: element.ClickEvent) { count = count + 1 }} |>\n';
    const context = at(source);
    assert.equal(context.kind, 'attr');
    assert.equal(context.tag, 'div');
  });

  test('inside a `{...}` hole it is Beans, not markup', () => {
    const context = at('    return <div on:click={fn(e: int) { cou|nt }}>\n');
    assert.equal(context.kind, 'none');
  });

  test('a nested tag is the enclosing one while it is open', () => {
    const context = at('    return <div flex><div w-4 |/></div>\n');
    assert.equal(context.kind, 'attr');
    assert.equal(context.tag, 'div');
  });

  test('after the closing tag it is Beans again', () => {
    const context = at('    return <div flex>{inner}</div>\n    let n|: int = 1\n');
    assert.equal(context.kind, 'none');
  });

  test('the real fixture from crema reads as expected end to end', () => {
    const fixture = join(
      editorsRoot, '..', 'community-libs', 'crema', 'tests', '_bx_compile_view.bx',
    );
    if (!existsSync(fixture)) return; // crema is a separate checkout
    const source = readFileSync(fixture, 'utf8');
    // Every offset in the file resolves to something, and the last byte is
    // ordinary code — a scanner that fell into a tag and never came out would
    // fail here rather than at some offset nobody thought to test.
    assert.equal(bxContextAt(source, source.length).kind, 'none');
    const inTag = source.indexOf('gap-2');
    assert.equal(bxContextAt(source, inTag + 5).kind, 'attr');
    const inString = source.indexOf('a <div> in a string');
    assert.equal(bxContextAt(source, inString + 5).kind, 'none');
  });
});

// ---------------------------------------------------------------------------
// The grammar
// ---------------------------------------------------------------------------

const oniguruma = require('vscode-oniguruma');
const textmate = require('vscode-textmate');

const GRAMMARS = {
  'source.beans': join(editorsRoot, 'vscode', 'syntaxes', 'beans.tmLanguage.json'),
  'source.beans.bx': join(editorsRoot, 'vscode', 'syntaxes', 'beans-bx.tmLanguage.json'),
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

async function tokenize(source) {
  const grammar = await registry.loadGrammar('source.beans.bx');
  assert.ok(grammar, 'the bx grammar should load, and so should the one it includes');
  const out = [];
  let ruleStack = textmate.INITIAL;
  for (const line of source.split('\n')) {
    const result = grammar.tokenizeLine(line, ruleStack);
    ruleStack = result.ruleStack;
    for (const token of result.tokens) {
      out.push({ text: line.slice(token.startIndex, token.endIndex), scopes: token.scopes });
    }
  }
  return out;
}

async function assertScope(source, text, scope) {
  const tokens = await tokenize(source);
  const matches = tokens.filter((t) => t.text.includes(text));
  assert.ok(matches.length > 0, `no token containing ${JSON.stringify(text)}`);
  assert.ok(
    matches.some((t) => t.scopes.some((s) => s.startsWith(scope))),
    `expected ${JSON.stringify(text)} to carry ${scope}; got ${JSON.stringify(
      matches.map((m) => m.scopes),
    )}`,
  );
}

describe('the .bx grammar', () => {
  test('a tag names itself', async () => {
    const source = '    return <div flex gap-2 />\n';
    await assertScope(source, 'div', 'entity.name.tag.bx');
    await assertScope(source, 'flex', 'entity.other.attribute-name.bx');
    await assertScope(source, 'gap-2', 'entity.other.attribute-name.bx');
  });

  test('a quoted value is a string and its name an attribute', async () => {
    const source = '    return <div bg="red" />\n';
    await assertScope(source, 'bg', 'entity.other.attribute-name.bx');
    await assertScope(source, 'red', 'string.quoted.double.bx');
  });

  test('a handler is an event, and its body is Beans', async () => {
    const source = '    return <div on:click={fn(e: int) { n = n + 1 }}>x</div>\n';
    await assertScope(source, 'click', 'entity.other.attribute-name.event.bx');
    await assertScope(source, 'fn', 'storage.type.beans');
    await assertScope(source, 'div', 'entity.name.tag.bx');
  });

  test('everything that is not a tag is still Beans', async () => {
    await assertScope('    let xs: List<string> = []\n', 'List', 'support.class.beans');
    await assertScope('    let s: string = "a <div>"\n', 'a <div>', 'string.quoted.double.beans');
    await assertScope('    // <div flex>\n', '<div flex>', 'comment.line.double-slash.beans');
    await assertScope('    import crema.element\n', 'import', 'keyword.control.import.beans');
  });

  test('a comparison keeps its `<`', async () => {
    const tokens = await tokenize('    if counts.len() < 10 {\n');
    const tags = tokens.filter((t) => t.scopes.some((s) => s.startsWith('entity.name.tag')));
    assert.equal(tags.length, 0, `a comparison must not open a tag: ${JSON.stringify(tags)}`);
  });
});
