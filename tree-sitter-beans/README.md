# tree-sitter-beans

A [Tree-sitter](https://tree-sitter.github.io) grammar for the
[Beans programming language](https://github.com/beans-lang/beans).

It exists because Zed requires a Tree-sitter grammar for every language
extension. It is deliberately a **syntax** grammar: anything that needs name
resolution or types is answered by `beansc lsp`, not here.

## Status

Parses every `.b` file in the beans repository — 320 files across
`examples/`, `stdlib/`, `compiler/beans/` and `test/`, about 60k lines — with
no errors, and rejects exactly the eight files the compiler's own parser
rejects.

```bash
cd editors
npm run test:corpus                 # against ../beans
npm run test:corpus -- --beans /path/to/beans
```

## Building

```bash
cd editors
npm install
npm run grammar          # regenerate grammar-data.json, then tree-sitter generate
```

Or directly:

```bash
cd editors/tree-sitter-beans
../node_modules/.bin/tree-sitter generate
../node_modules/.bin/tree-sitter test
../node_modules/.bin/tree-sitter parse path/to/file.b
```

`src/parser.c`, `src/scanner.c` and `src/tree_sitter/` are **committed**. Zed
clones this repository and compiles the parser from source, so the generated
parser has to be in git.

## Where the keywords come from

Not from this directory. `grammar.js` reads `grammar-data.json`, which is
generated from `editors/shared/language.json`, which records the compiler's own
keyword table as its source. `editors/scripts/sync-beans.mjs` diffs it against a
beans checkout.

Adding a keyword means editing `shared/language.json`, running
`npm run generate`, then `tree-sitter generate`.

## Notable decisions

**Newlines are whitespace.** Beans ends statements at a newline, Go-style. This
grammar puts `\n` in `extras` instead of modelling the lexer's terminator
insertion, because Beans always brackets blocks with braces and never starts a
statement with an infix operator. `return` and `fn` are `prec.right` so they
take their operand and body greedily. The whole-repository corpus run is what
justifies this rather than a guess.

**Block comments need an external scanner.** `/* /* */ */` nests, so the
closing delimiter cannot be found with a regular expression. `src/scanner.c`
counts depth, exactly like `Lexer::skip_block_comment` in the compiler. An
unterminated comment runs to end of input, which is what the compiler does and
what looks least broken in an editor.

**`primitive_type` carries no token precedence.** `int` is a prefix of
`interface`. Raising `int` above the other keywords makes the keyword lexer stop
at `int` and never reach `interface`, and every `interface` declaration in the
repository fails to parse. This cost an afternoon; the comment in `grammar.js`
is there so it costs nobody else one.

**Contextual modifiers are scoped tightly.** `align`, `packed`, `unique`,
`feature` and `opaque` are ordinary identifiers outside a declaration's modifier
list — the compiler's own `layout.b` has a field called `align`, and
`signal.b` has a local called `packed`. A keyword the parser allows in a
position is a keyword the lexer will produce there, so the modifier sets are
narrowed per declaration and `align(` is lexed as a single token.

**Struct literals lose ties, map literals lose ties.** `Name { ... }` is a
struct literal wherever that reading completes; in `match x as? Circle { ... }`
it does not, because match arms are not `field: value`, so GLR drops it. This is
the same call the compiler's `StructGuard` makes.

## Queries

`queries/` mirrors `editors/zed/languages/beans/`, so `tree-sitter highlight`
and other consumers see what Zed sees. Both are generated.

## Publishing for Zed

Zed references a grammar by repository, revision and optional subdirectory
path, and compiles `<path>/src/parser.c`. This grammar is referenced in place:

```toml
[grammars.beans]
repository = "https://github.com/beans-lang/editors"
rev = "<commit sha>"
path = "tree-sitter-beans"
```

No separate `tree-sitter-beans` repository is needed. See
[`../zed/README.md`](../zed/README.md) for the pin step.
