// `.bx` markup: the vocabulary's shape, where the cursor is, and what the
// grammar paints.
//
// Three halves, and the first two are the ones that can be quietly wrong.
//
// **The vocabulary's shape.** `buildBxData` used to destructure the keys it
// wanted and hand them to `JSON.stringify`, which drops every `undefined`
// without a word — so a `bx.json` of the wrong shape produced a `bx-data.ts`
// with most of its tables *gone* and passed both `npm run generate` and the
// drift gate on the way. The check that now refuses such a file is a control,
// and a control that cannot fire is decoration, so it is tested by feeding it
// files that are wrong in each of the ways that matter and by running the real
// generator against one.
//
// **Where the cursor is.** A completion list is only right if the editor knows
// whether the cursor sits in a tag, in an attribute value, in markup text or
// in Beans — and `<div>` appears inside `<script>` bodies, inside comments and
// inside `{...}` holes in real `.bx` files, where it is none of those. The
// scanner runs against the compiled `vscode/out/bx-model.js`, which imports
// nothing from `vscode` exactly so this can be a plain `node --test` run.
//
// **The grammar.** latte's `.bx` is a markup document, not Beans with tags in
// it, so the cases that used to assert `List<string>` keeps its `<` now assert
// the opposite. That inversion is the point of the suite, not an accident of
// it: the two dialects share an extension and nothing else.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
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
const {
  BX,
  bxContextAt,
  bindingOf,
  namesAComponent,
  endOfGroup,
  findHeaderBrace,
  endOfChain,
} = require(compiled);

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

// ---------------------------------------------------------------------------
// The vocabulary, and the check that refuses a wrong-shaped one
// ---------------------------------------------------------------------------

const { loadBxData, bxProblems, BX_SCHEMA } = await import(
  join(editorsRoot, 'scripts', 'lib', 'language-data.mjs')
);
const goodVocabulary = JSON.parse(
  readFileSync(join(editorsRoot, 'shared', 'bx.json'), 'utf8'),
);

/** `shared/bx.json` with one thing changed, written to a temp file. */
function poisoned(change) {
  const data = JSON.parse(JSON.stringify(goodVocabulary));
  change(data);
  const dir = mkdtempSync(join(tmpdir(), 'beans-bx-'));
  const path = join(dir, 'bx.json');
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}

describe('the bx vocabulary', () => {
  test('it came from latte and is not empty', () => {
    assert.ok(BX.blocks.some((b) => b.name === '$if'));
    assert.ok(BX.blocks.some((b) => b.name === '$for'));
    assert.ok(BX.interpolations.some((r) => r.name === '$$'));
    assert.ok(BX.namespaces.some((r) => r.name === 'on:'));
    assert.ok(BX.namespaces.some((r) => r.name === 'bind:'));
    assert.ok(BX.bindings.some((r) => r.name === 'bind:value'));
    assert.ok(BX.reservedAttributes.some((r) => r.name === 'key'));
    assert.ok(BX.voidElements.includes('br'));
    assert.ok(BX.rawTextElements.includes('script'));
    assert.ok(BX.booleanAttributes.includes('disabled'));
    assert.ok(BX.urlAttributes.includes('xlink:href'));
    assert.ok(BX.allowedSchemes.includes('https'));
  });

  test('nothing of crema survived', () => {
    // The nine tables the file used to hold were all crema's, and latte has an
    // equivalent for none of them. A key of either name here would mean the
    // move was half done.
    for (const gone of ['tags', 'flags', 'ramps', 'stepTables', 'counts', 'texts', 'values', 'colors']) {
      assert.ok(!(gone in BX), `${gone} is crema's and should be gone`);
    }
    // `events` shares its key name and nothing else: crema's carried a GPUI
    // payload and a signature, latte's carries the event class and the
    // Builder method.
    assert.ok(BX.events.every((e) => 'family' in e && 'method' in e));
    assert.equal(BX.events.find((e) => e.event === 'click')?.family, 'MouseEvent');
    assert.equal(BX.events.find((e) => e.event === 'click')?.method, 'on_click');
  });

  test('every event names a family and a Builder method', () => {
    for (const event of BX.events) {
      assert.match(event.family, /^[A-Z][A-Za-z]*Event$/, `${event.event} family`);
      assert.equal(event.method, `on_${event.event}`, `${event.event} method`);
    }
  });

  test('bind:value takes a conversion and bind:checked does not', () => {
    assert.deepEqual(bindingOf('bind:value'), { target: 'value', conversion: '' });
    assert.deepEqual(bindingOf('bind:value.int'), { target: 'value', conversion: 'int' });
    assert.deepEqual(bindingOf('bind:checked'), { target: 'checked', conversion: '' });
    assert.equal(bindingOf('class'), undefined);
    assert.deepEqual([...BX.conversions].sort(), ['bool', 'float', 'int']);
  });

  test('the last dotted segment decides whether a tag is a component', () => {
    assert.ok(namesAComponent('Hint'));
    assert.ok(namesAComponent('ui.Button'));
    assert.ok(!namesAComponent('div'));
    assert.ok(!namesAComponent('my-widget'));
    assert.ok(!namesAComponent('ui.button'));
  });
});

describe('a wrong-shaped bx.json is refused', () => {
  test('the committed one is accepted — the positive control', () => {
    assert.deepEqual(bxProblems(goodVocabulary), []);
    assert.ok(loadBxData(join(editorsRoot, 'shared', 'bx.json')).events.length > 0);
  });

  test('a missing table is named, not silently dropped', () => {
    // The exact failure `buildBxData` used to swallow: the key is gone, and
    // `JSON.stringify` wrote a `bx-data.ts` without it and said nothing.
    const problems = bxProblems({ ...goodVocabulary, events: undefined });
    assert.deepEqual(problems, ['events is missing']);
    assert.throws(
      () => loadBxData(poisoned((d) => delete d.events)),
      /events is missing/,
    );
  });

  test('every missing table is named, not just the first', () => {
    const stripped = { ...goodVocabulary };
    for (const key of Object.keys(BX_SCHEMA)) delete stripped[key];
    const problems = bxProblems(stripped);
    assert.equal(problems.length, Object.keys(BX_SCHEMA).length);
    for (const key of Object.keys(BX_SCHEMA)) {
      assert.ok(problems.includes(`${key} is missing`), `${key} unreported`);
    }
  });

  test('an empty table is refused: that is the shape a dropped one arrives in', () => {
    assert.deepEqual(bxProblems({ ...goodVocabulary, voidElements: [] }), [
      'voidElements is empty',
    ]);
  });

  test('a table of the wrong type is refused', () => {
    assert.deepEqual(bxProblems({ ...goodVocabulary, conversions: 'int,float' }), [
      'conversions is string, not an array',
    ]);
    assert.deepEqual(bxProblems({ ...goodVocabulary, voidElements: ['br', 7] }), [
      'voidElements[1] is not a non-empty string',
    ]);
  });

  test('a row missing a field is refused', () => {
    const problems = bxProblems({
      ...goodVocabulary,
      blocks: [{ name: '$if', detail: '$if <expr> { ... }' }],
    });
    assert.deepEqual(problems, ['blocks[0].note is missing or not a string']);
  });

  test('a table latte grew that the editor has not is refused', () => {
    // The same drift from the other side. A new table that the editor silently
    // ignored would make the drift gate green about a vocabulary the editor
    // does not actually carry.
    assert.deepEqual(bxProblems({ ...goodVocabulary, signals: ['live'] }), [
      'signals is a table the editor has never heard of',
    ]);
    const problems = bxProblems({
      ...goodVocabulary,
      events: [{ event: 'click', family: 'MouseEvent', method: 'on_click', bubbles: 'yes' }],
    });
    assert.deepEqual(problems, [
      'events[0] carries bubbles, which the editor has never heard of',
    ]);
  });

  test('missing provenance is refused', () => {
    assert.deepEqual(bxProblems({ ...goodVocabulary, $source: undefined }), [
      '$source is missing or not a non-empty string',
    ]);
  });

  test('the generator itself fails on one, rather than emitting empty tables', () => {
    // The end of the story the unit checks start: a wrong-shaped vocabulary
    // used to reach `vscode/src/bx-data.ts`. Running the real generator is
    // what proves it cannot any more — `--check` writes nothing, so this is
    // safe to run against the working tree.
    const path = poisoned((d) => {
      delete d.events;
      delete d.voidElements;
    });
    let failed = false;
    let output = '';
    try {
      execFileSync('node', ['scripts/generate.mjs', '--check', '--bx', path], {
        cwd: editorsRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (problem) {
      failed = true;
      output = `${problem.stdout ?? ''}${problem.stderr ?? ''}`;
    }
    assert.ok(failed, 'generate --check must fail on a wrong-shaped bx.json');
    assert.match(output, /events is missing/);
    assert.match(output, /voidElements is missing/);
    // And it must name the file rather than a field in the TypeScript it would
    // otherwise have written, which is the whole complaint about the old bug.
    assert.match(output, /is not a latte \.bx vocabulary/);
  });
});

// ---------------------------------------------------------------------------
// The Beans scanners, mirrored from latte's lex.b
// ---------------------------------------------------------------------------

describe('finding where copied-through Beans ends', () => {
  test('a group is balanced through nested brackets', () => {
    assert.equal(endOfGroup('(a + (b * c)) rest', 0), 13);
    assert.equal(endOfGroup('{ f(fn() { 1 }) } tail', 0), 17);
  });

  test('a brace inside a string is a byte, not a brace', () => {
    assert.equal(endOfGroup('{ "a } b" }', 0), 11);
  });

  test('a raw string has no escapes and no interpolation', () => {
    // The literal crema's driver mis-scanned. `r"/users/{id}"` is bytes, so
    // its `{` opens nothing and its `}` closes nothing.
    assert.equal(endOfGroup('{ r"/users/{id}" }', 0), 18);
    assert.equal(endOfGroup('{ r#"a "} b"# }', 0), 15);
  });

  test('a comment inside a group is nothing at all', () => {
    assert.equal(endOfGroup('{ // }\n 1 }', 0), 11);
    assert.equal(endOfGroup('{ /* } /* } */ */ 1 }', 0), 21);
  });

  test('a header runs to the first brace outside parentheses', () => {
    assert.equal(findHeaderBrace(' c {', 0), 3);
    // A closure in a header is safe: its braces sit inside the call's parens.
    const header = ' rows.filter(fn(r: Row) -> bool { r.ok }) {';
    assert.equal(findHeaderBrace(header, 0), header.length - 1);
    // The documented ambiguity, ending early at a map literal, exactly as
    // latte does — the escape is to parenthesise the comparison.
    assert.equal(findHeaderBrace(' self.m == {1: 2} {', 0), 11);
  });

  test('a chain stops where it stops', () => {
    assert.equal('self.count'.slice(0, endOfChain('self.count and more', 0)), 'self.count');
    assert.equal('user.name'.slice(0, endOfChain('user.name (active)', 0)), 'user.name');
    assert.equal(endOfChain('self.rows[0].title!', 0), 18);
    assert.equal(endOfChain('self.clock.now().', 0), 16);
  });
});

// ---------------------------------------------------------------------------
// Where the cursor is
// ---------------------------------------------------------------------------

describe('where the cursor is', () => {
  test('right after a `<` is a tag name', () => {
    const context = at('<sect|\n');
    assert.equal(context.kind, 'tag');
    assert.equal(context.prefix, 'sect');
  });

  test('inside an open tag is an attribute', () => {
    const context = at('<div class="a" |>\n');
    assert.equal(context.kind, 'attr');
    assert.equal(context.tag, 'div');
  });

  test('a partly typed attribute comes back as the prefix', () => {
    const context = at('<div on:|>\n');
    assert.equal(context.kind, 'attr');
    assert.equal(context.prefix, 'on:');
  });

  test('inside a quoted value names the attribute it belongs to', () => {
    const context = at('<a href="htt|">\n');
    assert.equal(context.kind, 'value');
    assert.equal(context.attr, 'href');
    assert.equal(context.prefix, 'htt');
  });

  test('inside a `{ }` value it is Beans, and nobody here answers Beans', () => {
    const context = at('<a href={self.u|rl}>x</a>\n');
    assert.equal(context.kind, 'expr');
    assert.equal(context.attr, 'href');
  });

  test('a handler body with its own braces does not end the tag early', () => {
    const context = at('<div on:click={fn(e: MouseEvent) { self.n += 1 }} |>\n');
    assert.equal(context.kind, 'attr');
    assert.equal(context.tag, 'div');
  });

  test('a tag broken over lines is still one tag', () => {
    const context = at('<div\n    class="a"\n    disabled\n    |\n>\n');
    assert.equal(context.kind, 'attr');
    assert.equal(context.tag, 'div');
  });

  test('after the tag closes it is markup text, inside the element', () => {
    const context = at('<ul><li>x|</li></ul>\n');
    assert.equal(context.kind, 'text');
    assert.equal(context.tag, 'li');
  });

  test('after the closing tag the element is off the stack', () => {
    const context = at('<ul><li>x</li>|</ul>\n');
    assert.equal(context.kind, 'text');
    assert.equal(context.tag, 'ul');
  });

  test('a void element takes no children and closes itself', () => {
    const context = at('<p><br>still in the p|</p>\n');
    assert.equal(context.kind, 'text');
    assert.equal(context.tag, 'p');
  });

  test('a self-closing tag closes', () => {
    const context = at('<div><input value="a" />|</div>\n');
    assert.equal(context.kind, 'text');
    assert.equal(context.tag, 'div');
  });

  // ---- the inversion, case by case ---------------------------------------

  test('`List<string>` is markup here, which is the whole inversion', () => {
    // In crema's `.bx` this was Beans and the `<` was an operator, because a
    // name ended just before it. In latte's it is a document: `<string>` opens
    // a tag, and the cursor inside it is in that tag.
    const context = at('let xs: List<string |>\n');
    assert.equal(context.kind, 'attr');
    assert.equal(context.tag, 'string');
  });

  test('a `<div>` in what looks like a string is a tag, because it is markup', () => {
    const context = at('the value is "a <div |>" here\n');
    assert.equal(context.kind, 'attr');
    assert.equal(context.tag, 'div');
  });

  test('a `//` is two characters of running text, not a comment', () => {
    const context = at('<p>// <b>not a comment</b> |</p>\n');
    assert.equal(context.kind, 'text');
    assert.equal(context.tag, 'p');
  });

  // ---- the places that are not markup ------------------------------------

  test('inside `<beans>` it is Beans and nothing is scanned', () => {
    const source = '<p>x</p>\n<beans>\nlet a: List<int> = []\nfn f() { "<div>" }\n|\n</beans>\n';
    const context = at(source);
    assert.equal(context.kind, 'beans');
  });

  test('after `</beans>` the file is markup again', () => {
    const context = at('<beans>\nlet a: int = 1\n</beans>\n<p>|</p>\n');
    assert.equal(context.kind, 'text');
    assert.equal(context.tag, 'p');
  });

  test('a `<script>` body is raw text, not markup', () => {
    const context = at('<script>if (a < b) { go("</x>") }|</script>\n');
    assert.equal(context.kind, 'raw');
    assert.equal(context.tag, 'script');
  });

  test('after a `<script>` closes, it is markup again', () => {
    const context = at('<script>var a = 1</script>\n<p>|</p>\n');
    assert.equal(context.kind, 'text');
    assert.equal(context.tag, 'p');
  });

  test('a `<style>` body is raw text too', () => {
    const context = at('<style>.a { color: red |}</style>\n');
    assert.equal(context.kind, 'raw');
    assert.equal(context.tag, 'style');
  });

  test('an HTML comment holding a tag is not a tag', () => {
    assert.equal(at('<!-- <div class="a" | --> \n').kind, 'comment');
    assert.equal(at('<!-- <div> -->\n<p>|</p>\n').kind, 'text');
  });

  test('a doctype offers nothing', () => {
    assert.equal(at('<!DOCTYPE ht|ml>\n').kind, 'none');
  });

  // ---- the `$` forms ------------------------------------------------------

  test('a `$` in markup text is where the blocks are offered', () => {
    const context = at('<p>$i|</p>\n');
    assert.equal(context.kind, 'text');
    assert.equal(context.prefix, '$i');
  });

  test('a `$if` header is Beans; its body is markup again', () => {
    assert.equal(at('$if self.count > 1|0 {\n<p>x</p>\n}\n').kind, 'expr');
    const body = at('$if self.count > 10 {\n<p>|</p>\n}\n');
    assert.equal(body.kind, 'text');
    assert.equal(body.tag, 'p');
  });

  test('after a block closes, the file is markup at the outer level', () => {
    const context = at('<ul>\n$for row: Row in self.rows {\n<li>x</li>\n}\n|\n</ul>\n');
    assert.equal(context.kind, 'text');
    assert.equal(context.tag, 'ul');
  });

  test('a closure in a `$for` header does not end it early', () => {
    const source =
      '$for r: Row in self.rows.filter(fn(x: Row) -> bool { x.ok }) {\n<li>|</li>\n}\n';
    const context = at(source);
    assert.equal(context.kind, 'text');
    assert.equal(context.tag, 'li');
  });

  test('`$( )`, `${ }` and `$html( )` are Beans', () => {
    assert.equal(at('<p>$(self.a + |self.b)</p>\n').kind, 'expr');
    assert.equal(at('<p>${ let t: int = |1 }</p>\n').kind, 'expr');
    assert.equal(at('<p>$html(self.rend|ered)</p>\n').kind, 'expr');
  });

  test('an implicit chain is Beans, and the text after it is not', () => {
    assert.equal(at('<p>$self.co|unt</p>\n').kind, 'expr');
    const after = at('<p>$self.count and |more</p>\n');
    assert.equal(after.kind, 'text');
    assert.equal(after.tag, 'p');
  });

  test('a `$` that is not a transition is ordinary text', () => {
    // `$5.00`, `US$` and `$ 20` need no escape: the classifier only ever looks
    // at the byte after the `$`.
    const context = at('<p>$5.00 and US$ and $ 20 |</p>\n');
    assert.equal(context.kind, 'text');
    assert.equal(context.tag, 'p');
  });

  test('`$$` is the escape and does not open a transition', () => {
    const context = at('<p>$$if is text |</p>\n');
    assert.equal(context.kind, 'text');
    assert.equal(context.tag, 'p');
  });

  test('a `\\}` in running text does not close a block', () => {
    const context = at('$if c {\n<p>a \\} b</p>\n|\n}\n');
    assert.equal(context.kind, 'text');
    assert.equal(context.tag, '');
  });

  test('a component tag is a tag like any other, and knows it is one', () => {
    const context = at('<ui.Button label="Go" |/>\n');
    assert.equal(context.kind, 'attr');
    assert.equal(context.tag, 'ui.Button');
    assert.ok(namesAComponent(context.tag));
  });

  test('the end of a whole document is markup, not somewhere it fell into', () => {
    const source = readFileSync(join(here, 'fixtures', 'latte-page.bx'), 'utf8');
    // A scanner that fell into a tag, a block or a raw body and never came out
    // would fail here rather than at some offset nobody thought to test.
    assert.equal(bxContextAt(source, source.length).kind, 'text');
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

// `<script>` and `<style>` hand their bodies to `source.js` and `source.css`,
// which VS Code always has and this harness does not. Stand-ins rather than
// nothing, because **vscode-textmate disables a whole rule whose include it
// cannot resolve** — without these the raw-text regions would never be entered
// and the suite would report that a `<script>` body reads as markup, which is
// the opposite of what VS Code does.
const STUB = (scope, name) => ({
  name,
  scopeName: scope,
  patterns: [{ name: `string.quoted.double.${name}`, begin: '"', end: '"' }],
});
const STUBS = { 'source.js': STUB('source.js', 'js'), 'source.css': STUB('source.css', 'css') };

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
      if (STUBS[scopeName] !== undefined) return STUBS[scopeName];
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

async function assertNoScope(source, text, scope) {
  const tokens = await tokenize(source);
  const matches = tokens.filter((t) => t.text.includes(text));
  assert.ok(matches.length > 0, `no token containing ${JSON.stringify(text)}`);
  assert.ok(
    matches.every((t) => t.scopes.every((s) => !s.startsWith(scope))),
    `expected ${JSON.stringify(text)} not to carry ${scope}; got ${JSON.stringify(
      matches.map((m) => m.scopes),
    )}`,
  );
}

describe('the .bx grammar', () => {
  test('a tag names itself, and a component names itself apart', async () => {
    await assertScope('<div class="a" />\n', 'div', 'entity.name.tag.bx');
    await assertScope('<div class="a" />\n', 'class', 'entity.other.attribute-name.bx');
    await assertScope('<div class="a" />\n', 'a', 'string.quoted.double.bx');
    await assertScope('<ui.Button label="Go" />\n', 'ui.Button', 'entity.name.tag.component.bx');
  });

  test('a handler is an event and its body is Beans', async () => {
    const source = '<div on:click={fn(e: MouseEvent) { self.n += 1 }}>x</div>\n';
    await assertScope(source, 'click', 'entity.other.attribute-name.event.bx');
    await assertScope(source, 'fn', 'storage.type.beans');
    await assertScope(source, 'MouseEvent', 'entity.name.type.beans');
  });

  test('an event latte does not have is painted as the error it is', async () => {
    await assertScope('<div on:clik={f}>x</div>\n', 'on:clik', 'invalid.illegal.unknown-event');
    await assertScope(
      '<input bnd:value={self.n} />\n',
      'bnd:value',
      'invalid.illegal.unknown-namespace',
    );
    await assertScope(
      '<div onclick="alert(1)">x</div>\n',
      'onclick',
      'invalid.illegal.inline-handler',
    );
    await assertScope(
      '<input disabled="false" />\n',
      'disabled="false"',
      'invalid.illegal.boolean-attribute-string',
    );
    // A `<` that opens nothing: latte refuses it and says to write `&lt;`.
    await assertScope('<p>a < b</p>\n', '<', 'invalid.illegal.unexpected-lt');
  });

  test('a component tag is answered by the component rules, not the element ones', async () => {
    // on: is a DOM event and a component reports through a Callback parameter;
    // attrs and preserve belong to elements; a parameter name is a Beans name.
    await assertScope('<Hint on:click={f} />\n', 'on:click', 'invalid.illegal.event-on-component');
    await assertScope('<Hint preserve />\n', 'preserve', 'invalid.illegal.element-attribute-on-component');
    await assertScope('<Hint data-x="1" />\n', 'data-x', 'invalid.illegal.not-a-parameter-name');
    // …and on an element every one of those three is fine.
    await assertScope('<div preserve />\n', 'preserve', 'keyword.other.attribute.reserved.bx');
    await assertScope('<div data-x="1" />\n', 'data-x', 'entity.other.attribute-name.bx');
  });

  test('latte\'s own attributes are painted apart from the wire ones', async () => {
    await assertScope('<li key={row.id}>x</li>\n', 'key', 'keyword.other.attribute.reserved.bx');
    await assertScope('<input ref={self.box} />\n', 'ref', 'keyword.other.attribute.reserved.bx');
    await assertScope('<div attrs={extra}>x</div>\n', 'attrs', 'keyword.other.attribute.reserved.bx');
    await assertScope('<input bind:value.int={self.n} />\n', 'bind', 'entity.other.attribute-name.binding.bx');
    await assertScope('<input disabled />\n', 'disabled', 'entity.other.attribute-name.boolean.bx');
    await assertScope('<a xlink:href="#a">x</a>\n', 'xlink', 'entity.other.attribute-name.namespace.bx');
  });

  test('the `$` forms are latte\'s, and the headers are Beans', async () => {
    await assertScope('$if self.n > 1 {\n', 'if', 'keyword.control.bx');
    await assertScope('$if self.n > 1 {\n', 'self', 'variable.language.self.beans');
    await assertScope('} else if self.n > 0 {\n', 'else', 'keyword.control.bx');
    await assertScope('$for row: Row in self.rows {\n', 'for', 'keyword.control.bx');
    await assertScope('$match self.v {\n', 'match', 'keyword.control.bx');
    await assertScope('$html(self.raw)\n', 'html', 'keyword.other.unsafe.bx');
    await assertScope('$slot:row\n', 'slot', 'keyword.control.bx');
    await assertScope('<p>$self.count</p>\n', 'count', 'variable.other.property.beans');
    await assertScope('<p>${ let t: int = 1 }</p>\n', 'let', 'storage.type.beans');
    await assertScope('<p>$$5.00</p>\n', '$$', 'constant.character.escape.bx');
    await assertScope('<p>a \\} b</p>\n', '\\}', 'constant.character.escape.bx');
    await assertScope('<p>a &lt; b</p>\n', '&lt;', 'constant.character.entity.bx');
  });

  test('a `$match` arm pattern is Beans, not running text', async () => {
    const source = '$match self.v {\n    some(x) => { <b>$x</b> }\n}\n';
    await assertScope(source, 'some', 'entity.name.function.call.beans');
    await assertScope(source, '=>', 'keyword.operator.arrow.beans');
  });

  test('`<beans>` is Beans and nothing inside it is markup', async () => {
    const source =
      '<beans>\nimport {Clock} from app.clock\nlet a: List<int> = []\nfn f() { "<div>" }\n</beans>\n';
    await assertScope(source, 'beans', 'entity.name.tag.beans-block.bx');
    await assertScope(source, 'import', 'keyword.control.import.beans');
    await assertScope(source, 'List', 'support.class.beans');
    await assertScope(source, '<div>', 'string.quoted.double.beans');
    // The two that would have been tags anywhere else in the file: the `<int>`
    // of a generic, and the `<div>` inside a Beans string.
    const tokens = await tokenize(source);
    const tags = tokens.filter(
      (t) => t.scopes.some((sc) => sc.startsWith('entity.name.tag')) && t.text !== 'beans',
    );
    assert.deepEqual(tags, [], 'nothing inside <beans> may be a tag');
  });

  test('a `<script>` body is not markup, and its `</x>` does not close a tag', async () => {
    const source = '<script>if (a < b) { go("</x>") }</script>\n';
    await assertNoScope(source, 'a < b', 'invalid.illegal.unexpected-lt');
    await assertScope(source, 'a < b', 'meta.embedded.block.script');
    await assertNoScope(source, '</x>', 'entity.name.tag.bx');
    await assertScope('<style>.a { color: red }</style>\n', 'color: red', 'meta.embedded.block.style');
  });

  test('a comment and a doctype are what they are', async () => {
    await assertScope('<!-- <div flex> -->\n', '<div flex>', 'comment.block.bx');
    await assertScope('<!DOCTYPE html>\n', 'DOCTYPE', 'keyword.other.doctype.bx');
    await assertScope('<![CDATA[x]]>\n', '<![CDATA[x]]>', 'invalid.illegal.unknown-declaration');
  });

  test('the whole page fixture paints without falling into a region', async () => {
    const source = readFileSync(join(here, 'fixtures', 'latte-page.bx'), 'utf8');
    const tokens = await tokenize(source);
    // The last line is markup at the top level of the document. A grammar that
    // fell into a `<script>`, a `<beans>` or a comment and never came out
    // would carry that region's scope here.
    const last = tokens[tokens.length - 1];
    for (const scope of last.scopes) {
      assert.ok(
        !scope.startsWith('meta.embedded') && !scope.startsWith('comment'),
        `the document ends inside ${scope}`,
      );
    }
  });
});
