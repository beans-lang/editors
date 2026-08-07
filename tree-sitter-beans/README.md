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

## Versioning

The grammar versions independently of the editor extensions. Zed pins it by
commit SHA and never reads its version, so bumping it with every extension
release would rewrite 57,000 lines of generated parser to change one integer.

Bump `tree-sitter.json` and `package.json` together when the *grammar* changes,
and regenerate — `tree-sitter generate` stamps that version into `parser.c`, so
changing one without the other leaves the committed parser stale. CI checks
this with `git diff --exit-code`, and `npm test` checks it before you push.

## Keywords and token lists

These are not defined here. `grammar.js` reads `grammar-data.json`, generated
from `editors/shared/language.json`, which records the compiler's own keyword
table as its source. `editors/scripts/sync-beans.mjs` checks the two for drift.

To add a keyword: edit `shared/language.json`, run `npm run generate`, then
regenerate the parser.

## Design notes

Read these before changing `grammar.js`.

**Newlines are whitespace.** Beans ends statements at a newline, Go-style. The
grammar puts `\n` in `extras` rather than modelling the lexer's terminator
insertion, because Beans always brackets blocks with braces and never starts a
statement with an infix operator. `return` and `fn` are `prec.right` so they
take their operand and body greedily. The whole-repository corpus run is what
validates this.

**Block comments need an external scanner.** `/* /* */ */` nests, so the
closing delimiter cannot be found with a regular expression. `src/scanner.c`
counts depth, matching `Lexer::skip_block_comment` in the compiler. An
unterminated comment runs to end of input, which is what the compiler does.

**`async` and `await` need one token of lookahead.** Neither is reserved. The
compiler makes `async` a modifier only immediately before `fn` or `let`, and
`await` an operator only inside an async body. A token regex cannot express
either — tree-sitter's regexes have no lookahead, and a token that swallowed
the word after `async` would hide it from the grammar — so `src/scanner.c`
produces both, and produces an ordinary identifier otherwise. Both lookaheads
stop at a newline, because a newline after `async` or `await` ends the
statement in the compiler too.

The scanner cannot see whether it is inside an async body, so `await` keeps the
remaining ambiguity resolved the safe way: it needs a space and then the start
of an operand, which leaves `await = 1`, `await.field`, `await(x)` and `await,`
as names. Reading a name as a keyword is the failure that actually shows up in
a file; reading a keyword as a name only costs a colour.

**The package clause is positional.** `package <name>` is a keyword only as the
first thing in a file, so `package_declaration` sits in `source_file` ahead of
`_top_level` rather than among the declarations. That single position is what
keeps `package` an ordinary name everywhere else — the compiler's own
`module.b` has a local called `package`.

**`primitive_type` carries no token precedence.** `int` is a prefix of
`interface`. Raising `int` above the other keywords makes the keyword lexer
stop at `int` and never reach `interface`, and every `interface` declaration in
the repository then fails to parse.

**Contextual modifiers are scoped tightly.** `align`, `packed`, `unique`,
`feature` and `opaque` are ordinary identifiers outside a declaration's
modifier list — the compiler's own `layout.b` has a field called `align`, and
`signal.b` has a local called `packed`. A keyword the parser allows in a
position is a keyword the lexer will produce there, so the modifier sets are
narrowed per declaration and `align(` is lexed as a single token. `async` is
kept out of the shared `_modifier` set for the same reason: it attaches to `fn`
and to `let`, never to a class, a struct or a field.

**Struct and map literals lose ties.** `Name { ... }` is a struct literal
wherever that reading completes; in `match x as? Circle { ... }` it does not,
because match arms are not `field: value`, so GLR drops it. This matches the
compiler's `StructGuard`.

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
