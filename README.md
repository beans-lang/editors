# Beans editor support

Editor integrations for the
[Beans programming language](https://github.com/beans-lang/beans).

Both clients are **thin**. Beans ships its own language server inside the
compiler:

```bash
beansc lsp
```

Highlighting, completion, hover, diagnostics, go-to-definition and everything
else come from there over ordinary LSP capability negotiation. Neither
extension implements a second feature engine, and neither should: the compiler
is the only thing that knows what a Beans program means.

## Layout

```
editors/
  shared/language.json        the one place editor-side language facts live
  scripts/                    generators, the drift check, the test runner
  tree-sitter-beans/          Tree-sitter grammar (Zed needs one)
  vscode/                     VS Code extension (TypeScript)
  zed/                        Zed extension (Rust → Wasm)
  icons/                      light/dark file icons for .b and beans.pot
  test/                       manifests, grammar fixtures, resolution, LSP smoke
```

### Shared language data

`shared/language.json` is the single source of truth for keywords, operators,
builtin types, comment and string rules, and the file associations. Every entry
records where it comes from in the beans repository.

Nothing downstream is hand-maintained:

| Generated file | From |
| --- | --- |
| `vscode/syntaxes/beans.tmLanguage.json` | `shared/language.json` |
| `vscode/syntaxes/beans-manifest.tmLanguage.json` | `shared/language.json` |
| `tree-sitter-beans/grammar-data.json` | `shared/language.json` |
| `zed/languages/beans/*.scm` | `shared/language.json` + grammar node names |
| `zed/languages/beans/semantic_token_rules.json` | `shared/language.json` |

```bash
npm run generate          # rewrite the generated assets
npm run generate:check    # fail if any are stale (CI)
npm run sync              # diff shared/language.json against a beans checkout
npm run sync -- --beans ../beans
```

`npm run sync` reads the real compiler sources — the keyword table in
`token.cpp`, `register_builtins()` in `checker.cpp`, the LSP dispatch table, and
both semantic-token legends — and reports drift in either direction. It exits 0
with a skip message when no beans checkout is present.

## Feature matrix

Everything in the first group is served by `beansc lsp` and reaches both
editors through capability negotiation. Nothing in it is implemented in the
editor clients.

| Feature | Source | VS Code | Zed |
| --- | --- | --- | --- |
| Syntax highlighting (instant, no server) | TextMate / Tree-sitter | yes | yes |
| Live diagnostics while typing | `beansc lsp` | yes | yes |
| Completion, including members after `.` | `beansc lsp` | yes | yes |
| Hover with signatures and docs | `beansc lsp` | yes | yes |
| Signature help | `beansc lsp` | yes | yes |
| Go to definition (across packages) | `beansc lsp` | yes | yes |
| Find references | `beansc lsp` | yes | yes |
| Document symbols / outline | `beansc lsp` | yes | yes |
| Semantic tokens | `beansc lsp` | yes | yes¹ |
| Prepare rename and rename | `beansc lsp` | yes | yes |
| Bracket matching, comment toggling, indentation | editor config | yes | yes |
| Code folding | editor | yes | yes |
| File icons for `.b` and `beans.pot` | assets | yes | no² |

¹ Zed requests semantic tokens only when `"semantic_tokens"` is set to
`"combined"` or `"full"`; it is `"off"` by default. The extension ships
`semantic_token_rules.json` so the styling is right the moment it is enabled.

² Zed's icon themes replace the icon set wholesale — there is no way to add one
file type to the user's existing theme. A Beans-only icon theme would blank
every other file's icon, so this extension ships none. The assets are in
`icons/zed/` for anyone building a full theme.

### Not provided — future compiler work

These are **not** implemented anywhere, and the editor clients deliberately do
not fake them. Each needs the compiler's language server to grow the capability
first; the clients will pick it up automatically through negotiation.

| Feature | Status |
| --- | --- |
| Formatting (`textDocument/formatting`) | not served by `beansc lsp` |
| Range formatting, on-type formatting | not served by `beansc lsp` |
| Code actions and quick fixes | not served by `beansc lsp` |
| Inlay hints | not served by `beansc lsp` |
| Workspace symbols | not served by `beansc lsp` |
| Go to type definition | not served by `beansc lsp` |
| Go to implementation | not served by `beansc lsp` |
| Call hierarchy, type hierarchy | not served by `beansc lsp` |
| Document highlight | not served by `beansc lsp` |
| Folding ranges from the server | not served by `beansc lsp` |
| Selection ranges | not served by `beansc lsp` |
| Code lens | not served by `beansc lsp` |
| Incremental document sync | server uses full sync (`textDocumentSync: 1`) |
| Semantic token modifiers | legend advertises an empty modifier list |
| Debugging | no Beans debug adapter exists |

## Finding the compiler

There is no published Beans binary yet, so **neither extension downloads
anything**. Both resolve `beansc` in the same order:

1. an explicit editor setting
   (`beans.compiler.path` in VS Code, `lsp.beansc.binary.path` in Zed)
2. the `BEANSC` environment variable
3. `beansc` at a workspace root, then on `PATH`
4. a source build — `build/beansc`, `beans/build/beansc`,
   `../beans/build/beansc` — so a side-by-side `beans` and `editors` checkout
   works with no configuration

An explicit setting that does not resolve is an **error**, not a reason to fall
through: quietly starting a different compiler than the one configured would be
worse than failing. When nothing is found, each editor shows a short message
naming what was tried.

The compiler is spawned directly as `beansc lsp` — never through a shell — so a
path containing spaces needs no quoting and nothing in it can be interpreted.
There is a test for exactly that.

## Building and testing

```bash
npm install
npm test
```

`npm test` runs, in order:

| Step | What it proves |
| --- | --- |
| `generate --check` | no generated asset has drifted from `shared/language.json` |
| `tsc` | the VS Code extension compiles |
| `eslint` | it lints clean |
| `test/manifests.test.mjs` | manifests, package metadata, cross-file consistency |
| `test/tmgrammar.test.mjs` | TextMate scopes, tokenized with VS Code's own libraries |
| `test/vscode-resolve.test.mjs` | resolution order, `~`/`${workspaceFolder}`, Windows, paths with spaces |
| `tree-sitter test` | the grammar's corpus |
| `scripts/parse-corpus.mjs` | the grammar parses every `.b` file in a beans checkout |
| `scripts/check-rust.mjs` | `cargo fmt --check`, `cargo check`, `cargo clippy -D warnings` |
| `test/lsp-smoke.test.mjs` | a real `beansc lsp` session, end to end |
| `scripts/sync-beans.mjs` | `shared/language.json` still matches the compiler |

Steps that need something the machine may not have — a beans checkout, a Rust
toolchain — skip with a message rather than failing, so a fresh clone of just
this repository goes green.

To point the beans-dependent steps somewhere specific:

```bash
npm test -- --beans /path/to/beans
```

## Per-extension docs

- [`vscode/README.md`](vscode/README.md) — development, debugging, packaging
- [`zed/README.md`](zed/README.md) — dev extension install, the grammar pin
- [`tree-sitter-beans/README.md`](tree-sitter-beans/README.md) — the grammar

## Known issues in `beansc lsp`

Found while building and testing these clients. All three are compiler-side;
the clients work around them where they can and the fixes belong in the beans
repository.

1. **Location URIs are not percent-encoded.**
   `path_to_uri` in `compiler/bootstrap/lspserver.cpp` is `"file://" + path`, so
   a file at `/a b/c.b` comes back as `file:///a b/c.b` rather than
   `file:///a%20b/c.b`. Both editors' URI parsers accept it today, but it is not
   a valid URI and any stricter client would reject it. Note that
   `publishDiagnostics` is unaffected — it echoes the URI the client sent.

2. **The two compiler implementations advertise different semantic token
   legends.** The bootstrap C++ server (`compiler/bootstrap/lsp.cpp`) sends
   `type, function, method, parameter, variable, property, enum, enumMember`;
   the self-hosted one (`compiler/beans/lsp.b`) sends
   `type, function, variable, property, enumMember, keyword`. Both clients ship
   styles for the union so either build looks right, and `npm run sync` checks
   both legends against `shared/language.json`.

3. **Member completion on builtin receivers is missing from the self-hosted
   server.** `p.` on a user class offers its fields and methods in both
   implementations, but `s.` where `s: string`, or `xs.` where
   `xs: List<int>`, returns top-level names from the self-hosted server. The
   bootstrap server's `members_of` handles builtins. The LSP smoke test asserts
   the behaviour both implementations share.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
