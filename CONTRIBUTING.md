# Contributing

## Getting set up

```bash
npm install
npm test
```

Everything is driven from the repository root. `vscode/` and
`tree-sitter-beans/` are npm workspaces; `zed/` is a Cargo crate.

Optional but recommended:

- a [beans](https://github.com/beans-lang/beans) checkout beside this one, so
  the drift check, the corpus parse and the LSP smoke test have something to
  run against
- Rust with the `wasm32-wasip2` target, so the Zed crate is built rather than
  only checked

Steps that need either of those skip themselves with a message rather than
failing, so a fresh clone of just this repository still goes green. They are
reported as `skip`, never as `pass` — a green summary that overstates coverage
is worse than a red one.

### What CI cannot run

GitHub Actions checks out `beans-lang/beans` but cannot build `beansc` from it:
`compiler/bootstrap` is a private submodule, and no `beansc` binary has been
published yet. Two checks therefore skip in CI and only ever run locally:

| Check | Needs |
| --- | --- |
| `real LSP smoke test against beansc lsp` | a built `beansc` |
| `debugger wiring and a real DAP session` | a built `beansc` |
| `language data matches the compiler` | `compiler/bootstrap` sources |

The corpus parse does run in CI — the `.b` files it needs are in the public
checkout, and it parses about 320 of them on every push.

So run the full suite locally before pushing anything that touches
`shared/language.json`, the grammar, or the language client. CI will not catch
drift against the compiler.

## Repository layout

```
shared/language.json     the one place editor-side language facts live
scripts/                 generators, the drift check, the test runner
tree-sitter-beans/       Tree-sitter grammar (Zed requires one)
vscode/                  VS Code extension (TypeScript)
zed/                     Zed extension (Rust → Wasm)
icons/                   light/dark file icons for .b and beans.pot
test/                    manifests, grammar fixtures, resolution, LSP and DAP
```

## Architecture

Both extensions are **thin clients**. Neither registers a language feature
provider of its own, and neither should: the compiler is the only thing that
knows what a Beans program means, and a second feature engine in the editor
would drift from it.

A client's whole job is to find `beansc`, spawn it as `beansc lsp`, and let LSP
capability negotiation do the rest. If a feature is missing, it is missing from
the compiler's language server, and that is where to add it.

Debugging follows the same rule. The VS Code extension contributes a `beans`
debug type whose only job is to start `beansc debug-adapter` — the compiler's
own Debug Adapter Protocol server — and hand VS Code the pipe. Breakpoint
placement, frames, variables, stepping and evaluation are all decided by the
compiler. `src/debug.ts` holds the launch-configuration logic and imports
nothing from `vscode`, so it can be tested with `node --test`; `src/debugger.ts`
is the thin editor wrapper around it.

The one thing the editors do own is the highlighting that appears before the
server has started: a TextMate grammar for VS Code, a Tree-sitter grammar for
Zed.

## Shared language data

`shared/language.json` is the single source of truth for keywords, operators,
builtin types, comment and string rules, and file associations. Every entry
records where it comes from in the beans repository.

Nothing downstream is hand-maintained:

| Generated | From |
| --- | --- |
| `vscode/syntaxes/beans.tmLanguage.json` | `shared/language.json` |
| `vscode/syntaxes/beans-manifest.tmLanguage.json` | `shared/language.json` |
| `tree-sitter-beans/grammar-data.json` | `shared/language.json` |
| `zed/languages/beans/*.scm` | `shared/language.json` + grammar node names |
| `zed/languages/beans/semantic_token_rules.json` | `shared/language.json` |

```bash
npm run generate          # rewrite the generated assets
npm run generate:check    # fail if any are stale
```

### Changing the language data

To add a keyword, a builtin type or an operator:

1. edit `shared/language.json`
2. `npm run generate`
3. `npm --workspace tree-sitter-beans run build` if the grammar is affected
4. `npm test`

Never edit a generated file. Each one carries a banner saying so.

A **contextual** keyword needs one thing more: an entry in
`contextualKeywords.recognizedWhen` giving the exact shape the compiler's
parser tests for. Every highlighting rule for that word is written against that
line, and `npm run sync` fails without it. The rule matters more than it looks
— `unique`, `packed`, `align`, `feature`, `opaque`, `super`
and `package` are all ordinary identifiers outside their one shape, and the
compiler's own sources use several of them as names. Over-matching breaks
highlighting on the compiler itself, so when a shape cannot be recognized for
certain, fall back to the name rather than the keyword.

### Checking for drift

```bash
npm run sync
npm run sync -- --beans /path/to/beans
```

`scripts/sync-beans.mjs` reads the compiler's own sources — the keyword table
in `token.cpp`, the contextual keywords in `parser.cpp` and `checker.cpp`,
`register_builtins()` in `checker.cpp`, the LSP dispatch table in
`lspserver.cpp`, and both semantic-token legends — and reports differences in
both directions: entries the compiler has that we lack, and entries we claim
that the compiler no longer has.

A finding here is not always a bug in this repository. When editor support
lands before the compiler change it tracks, the check reports the new word as
one "the compiler never names" — which is true, and the fix is to merge the
compiler side first.

## The Tree-sitter grammar

See [`tree-sitter-beans/README.md`](tree-sitter-beans/README.md) for the design
decisions, which are worth reading before changing `grammar.js`.

```bash
npm run grammar           # regenerate grammar-data.json, then tree-sitter generate
npm run test:treesitter   # the hand-written corpus
npm run test:corpus       # every .b file in a beans checkout
```

`src/parser.c`, `src/scanner.c` and `src/tree_sitter/` are committed, because
Zed clones this repository and compiles the parser from source. Regenerating
the grammar means committing the regenerated parser with it, and re-pinning —
see [`zed/README.md`](zed/README.md).

## Tests

```bash
npm test                            # everything, in order
npm test -- --beans /path/to/beans  # point the beans-dependent steps somewhere
```

| Step | What it proves |
| --- | --- |
| `generate --check` | no generated asset has drifted from `shared/language.json` |
| `tsc` | the VS Code extension compiles |
| `eslint` | it lints clean |
| `test/manifests.test.mjs` | manifests, package metadata, cross-file consistency |
| `test/tmgrammar.test.mjs` | TextMate scopes, tokenized with VS Code's own libraries |
| `test/vscode-resolve.test.mjs` | resolution order, `~` and `${workspaceFolder}`, Windows, paths with spaces |
| `tree-sitter test` | the grammar's corpus |
| `scripts/parse-corpus.mjs` | the grammar parses every `.b` file in a beans checkout |
| `scripts/check-rust.mjs` | `cargo fmt --check`, `check`, `clippy -D warnings`, and the Wasm build |
| `test/lsp-smoke.test.mjs` | a real `beansc lsp` session, end to end, and every capability `shared/language.json` claims |
| `test/vscode-debug.test.mjs` | launch configurations, adapter resolution, and a real `beansc debug-adapter` session that stops at a breakpoint |
| `scripts/sync-beans.mjs` | `shared/language.json` still matches the compiler |

Individual steps have their own scripts — `npm run test:resolve`,
`test:grammar`, `test:lsp`, `test:debug`, `test:treesitter`, `test:corpus`,
`check:rust`.

`test/vscode-resolve.test.mjs` runs against the compiled `vscode/out/beansc.js`
rather than the TypeScript source, so it tests what ships. `src/beansc.ts`
imports nothing from `vscode` for exactly that reason.

## Open issues in `beansc lsp`

Found while building and testing these clients. All of them are compiler-side.
The clients work around them where they can, and the fixes belong in the beans
repository.

### Location URIs are not percent-encoded — fixed in the shipped server

The self-hosted server percent-encodes file URIs, so a file at `/a b/c.b` comes
back as `file:///a%20b/c.b`. The bootstrap C++ server's `path_to_uri` in
`compiler/bootstrap/lspserver.cpp` is still `"file://" + path`. Both editors'
URI parsers accept the older form, so a stage-0 build works; a stricter client
would not.

### The two compiler implementations advertise different capabilities

The shipped self-hosted server answers declaration, implementation, type
definition, document highlight, workspace symbol, call hierarchy and type
hierarchy, and asks for incremental document sync. The bootstrap C++ server
answers the original, smaller set and asks for full sync.

`shared/language.json` records both lists — `languageServer.capabilities` for
the shipped server and `languageServer.bootstrapCapabilities` for stage 0 — and
`test/lsp-smoke.test.mjs` checks every claim in the first list against a live
server, so the file cannot advertise a menu item that does nothing. The client
negotiates, so it never assumes either list.

### The two compiler implementations advertise different semantic token legends

The bootstrap C++ server (`compiler/bootstrap/lsp.cpp`) sends `type`,
`function`, `method`, `parameter`, `variable`, `property`, `enum`,
`enumMember`. The self-hosted server (`compiler/beans/lsp.b`) sends `type`,
`function`, `variable`, `property`, `enumMember`, `keyword`.

Both clients ship styles for the union, so either build looks right, and
`npm run sync` checks both legends against `shared/language.json`. The LSP
smoke test asserts a subset relation rather than equality, which is what
catches a compiler adding a token type the editors have no style for.

### Member completion on builtin receivers — fixed in the shipped server

`s.` where `s: string`, and `xs.` where `xs: List<int>`, now offer the built-in
type's own members in the self-hosted server: the list is read out of the
expression checker's registry, so it is exactly what would type-check. The
bootstrap server has always handled this. The LSP smoke test asserts the
behaviour both implementations share.

### A request cannot be cancelled once it has started

`beansc lsp` is single-threaded and reads its input strictly in order, so a
`$/cancelRequest` is always read after the request it names has been answered.
It is accepted and ignored. Honouring one would mean reading ahead of the
request being computed, which needs either threads or a non-blocking read of
stdin. LSP allows a server to answer a cancelled request normally, so no client
is misled — but a slow request cannot be abandoned, and that is worth knowing
when profiling a large workspace.

### A running program cannot be paused

`beansc debug-adapter` is single-threaded. While the program runs, the adapter
is inside the interpreter and reads no input, so a `pause` request arriving
mid-run cannot be seen. The adapter answers it with a failed response that says
so instead of hanging or pretending. Set a breakpoint, or stop the session.

### Native builds carry no Beans line table

`beansc build --debug` produces an unoptimized binary with the platform's debug
information for the C runtime, which is the foundation a native debugger needs.
The LLVM emitter writes no `!DILocation`/`!DISubprogram` metadata for Beans
functions, so lldb and gdb cannot stop on a Beans line. Beans functions are also
emitted under generated symbol names (`.next.fnN`), which several compiler tests
pin, so renaming them is a compiler-side change with its own differential to
clear. `test/native_debug.sh` in the beans repository asserts this boundary and
fails if the emitter starts writing debug metadata, so the documentation cannot
go stale quietly.

## Releasing

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds both
artifacts, verifies them, and attaches them to the GitHub Release:

| Artifact | What it is |
| --- | --- |
| `beans-vscode-<version>.vsix` | Installable with `code --install-extension` |
| `beans-zed-<version>.zip` | The extension directory, for **Install Dev Extension** |

```bash
# bump the version in vscode/package.json and zed/extension.toml first
git tag v0.2.0 && git push origin v0.2.0
```

The workflow refuses to build if the tag and `vscode/package.json` disagree.

### The .vsix must be bundled, not vendored

`vscode-languageclient` is the extension's only runtime dependency, and this
npm workspace hoists it to the repository root — so `vsce package` cannot find
it under `vscode/node_modules`. A `.vsix` built without bundling installs fine
and then fails to activate with "Cannot find module".

`vscode/esbuild.mjs` bundles it into `dist/extension.js` instead, with `vscode`
left external because the editor provides it. `test/bundle.test.mjs` loads the
built bundle with only `vscode` stubbed, so an unresolved import fails in CI
rather than in someone's editor.

### Marketplace publishing

`.github/workflows/publish.yml` is manual-only and never runs on a tag, because
publishing cannot be undone by deleting a release. It defaults to a dry run and
needs `VSCE_PAT` (Visual Studio Marketplace) or `OVSX_PAT` (Open VSX) in the
`marketplace` environment.

### The Zed registry

Zed has no installable artifact and no upload API — the registry builds
extensions from source. Publishing is a pull request against
[`zed-industries/extensions`](https://github.com/zed-industries/extensions):

```sh
git submodule add https://github.com/beans-lang/editors.git extensions/beans
```

```toml
[beans]
submodule = "extensions/beans"
path = "zed"
version = "0.1.0"
```

Then run `pnpm sort-extensions`. The `path` field is what lets the extension
live in a subdirectory. Note that Zed requires the licence at that path, which
is why `zed/LICENSE` is a symlink to the repository's.

### Re-pinning the grammar

Zed fetches Tree-sitter grammars by cloning at an exact revision, so any
grammar change needs a new pushed commit and a new pin **before** tagging:

```bash
npm run grammar
git commit -am "Update the Beans grammar" && git push
node scripts/pin-grammar.mjs --rev "$(git rev-parse HEAD)"
node scripts/pin-grammar.mjs --status
```

`--rev` refuses a commit that does not carry
`tree-sitter-beans/src/parser.c`, so a pin that would fail at install time
fails here instead. The release workflow runs `--status` and fails if the pin
is not usable.
