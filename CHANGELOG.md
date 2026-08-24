# Changelog

All notable changes to the Beans editor integrations. This file is the source
of the GitHub Release notes — `scripts/release-notes.mjs` extracts the section
matching the tag.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Debug the compiled binary.** `beansc build --debug` now writes a line
  table for Beans statements, so a native debugger can stop inside the
  program that ships. The VS Code launch configuration takes
  `"mode": "native"`: the extension builds with `--debug` and hands the
  binary to CodeLLDB, LLDB DAP or the C/C++ extension — whichever is
  installed, or whichever `adapter` names. `output` says where the binary
  goes; it defaults to `build/` beside the source. `"mode": "interpreter"`
  is the default and is unchanged, and still the debugger that knows every
  Beans value.

  This extension ships no native debug adapter and does not need one: a
  Beans binary is an ordinary one with an ordinary DWARF line table, and
  the debuggers people already have read it.

- **Zed debugs the same binaries**, with no extension change — Zed's
  built-in debugger takes a `build` step, so one `.zed/debug.json` entry
  compiles and debugs. See [`zed/README.md`](zed/README.md#debugging).

## [0.2.2]

### Fixed

- **Zed could miss a normally installed compiler.** Both extensions now check
  `BEANS_HOME` and the official installer location directly before `PATH`.
  This works when a GUI editor inherited an old PATH before Beans was
  installed. Zed also checks `%LOCALAPPDATA%\\Beans` on Windows.

- **The missing-compiler help was stale.** It said no Beans binary had been
  published. The error and all editor install docs now point to the released
  compiler and its installer.

- **The editor data drift check understands the current compiler layout.** It
  now reads the self-hosted semantic-token legend from `lsp_server.b`, checks
  stage-0 against its own smaller capability list, and highlights the new
  built-in `CFunctionPtr<T>` type.

## [0.2.1]

### Fixed

- **Zed highlighted nothing.** `zed/extension.toml` pins the exact grammar
  revision Zed builds the parser from, and it still named the commit before
  `package`, `async` and `await` were added to the grammar. The queries in
  `zed/languages/beans/` had moved on and named `package_declaration`,
  `async_modifier` and `await_operator`, which that parser cannot produce.
  Tree-sitter rejects a whole query file on one unknown node type, so this
  did not lose three rules — it lost every colour in the file, with no error
  a user would ever see. Re-pinned to a revision that carries the current
  parser.

  A new check, `test/zed-queries.test.mjs`, now refuses any query naming a
  node the pinned grammar cannot produce, refuses a pin without a generated
  `parser.c`, and refuses a working-tree grammar that has drifted from the
  pin. Restoring the old pin fails it, which is how it was verified.

## [0.2.0]

### Added

- **A Beans debugger.** `beansc debug-adapter` speaks the Debug Adapter
  Protocol on stdio, and the VS Code extension contributes a `beans` debug
  type that starts it. Press F5 on a `.b` file, stop at a breakpoint, read
  locals, step, and continue.

  The debugger drives the compiler's tree interpreter, so it works with no
  build step and no second toolchain: breakpoints are Beans file and line
  positions, stack frames name Beans functions, and variables come from the
  interpreter's own frames using the binding ids the checker allocated — so a
  shadowed local stays two separate variables.

  A breakpoint on a blank line or a comment moves to the nearest line that
  carries a statement, and the adapter reports where it really landed. A
  runtime panic stops with the stack still standing. The program's stdout and
  stderr arrive as `output` events, so they land in the debug console instead
  of the protocol stream. `attach` is refused with a sentence saying why: the
  Beans debugger runs the program itself.

  Native (compiled) debugging is a separate, future thing — see the README.

- **Go to Declaration, Go to Implementation, Go to Type Definition and
  document highlights.** All four are answered from the compiler's checked
  hierarchy. Go to Declaration on an override reaches the interface or base
  method it implements; Go to Implementation on an interface or interface
  method lists every concrete type or body, across packages.

- **Workspace symbols, call hierarchy and type hierarchy.** `workspace/symbol`
  searches every loaded package with a subsequence match and keeps package
  identity in the container, so two same-named types stay tellable apart. Call
  hierarchy uses resolved call targets, and type hierarchy uses the checked
  `extends`/`implements` graph.

- **Incremental document sync.** The server advertises
  `textDocumentSync.change = 2` and applies LSP ranges to the buffer it keeps,
  so a keystroke sends a range rather than the whole file.

- **`workspace/symbol` covers the whole workspace.** It searches every Beans
  project under the folders the client opened, not only the ones with a file
  open, so a search works before anything is opened.

### Changed

- **Every language feature now answers with an exact symbol.** The self-hosted
  server was rewritten onto a semantic workspace: one checked view of the
  project per revision, indexed by the compiler's own identities — canonical
  package symbols for declarations, owner plus name for members, and the
  expression checker's binding ids for locals and parameters.

  What this fixes, concretely:

  - Completion after `.` resolves the receiver's checked type, so `a.` offers
    that type's members and nothing else — including built-in receivers such
    as `string`, `List<T>` and `Map<K, V>`, whose members are read out of the
    checker's own registry.
  - General completion returns only what is in scope at the cursor: locals
    declared later, locals of another function, and locals hidden in another
    block are all excluded, and an inner binding shadows an outer one.
  - Go to Definition, references and rename act on symbol identity, not on
    spelling. Two same-named methods on two same-named types in two packages
    are two different symbols; renaming one never touches the other, and
    renaming a shadowed local never touches the binding it shadows.
  - Rename refuses built-ins, keywords and anything without a declaration, and
    validates the new name before producing any edit.
  - Renaming a member is checked against the whole hierarchy, in both
    directions. A base member cannot take a name any subtype already declares,
    however deep — a method would start hiding it, and a field would silently
    share one slot with it.
  - A virtual method renames as one family. Starting from the interface
    declaration or from any override produces the same edit, covering every
    implementation, so the program still compiles afterwards.
  - Names written inside a string's `{}` interpolation resolve like any other
    expression.

- **File URIs are percent-encoded.** A path with a space or a non-ASCII
  character now round-trips, so navigation works in a folder called
  `my project`.

- **Positions are UTF-16 throughout.** A line with an emoji before a symbol
  lands on the right character.

- **A name owns exactly its own columns.** Spans are half-open, so the `(`
  after `draw` is not `draw` and the space before it is not either.

- **Rename refuses an edit that would rebind something else.** Renaming a local
  to a name already in scope, a type or function to one its package declares,
  or a method to one its type already has is refused with a sentence saying
  what it would collide with. Every one of those edits still compiles, which is
  exactly why they have to be caught here.

### Known limits

- `$/cancelRequest` is accepted and ignored. The server reads and answers
  strictly in order, so a cancellation is always read after the request it
  names has been answered; honouring one would need reading ahead of the
  current request, which needs threads or a non-blocking stdin. LSP permits
  answering a cancelled request normally, and that is what happens.

- `shared/language.json` records the sixteen capabilities the shipped server
  advertises, and a separate list for what the older bootstrap server still
  answers. `test/lsp-smoke.test.mjs` checks every claim against a live server,
  so the file cannot claim a menu item that does nothing.


### Added

- **`async` and `await` are highlighted.** Both landed in the compiler with
  async/await and neither was known here, so an `async fn` read as a stray
  name and, worse, the tree-sitter grammar could not parse the files that use
  them: `stdlib/std/net/net.b` and `test/cases/async_cross_thread_close.b`
  both failed the whole-repository corpus parse. They parse now.

  `async fn`, `async let`, `await <expr>` and the outline entry for an async
  function are all covered.

- **The `package` clause is highlighted.** `package <name>` opens every file
  the compiler loads as a package. The clause is a declaration in the
  tree-sitter grammar, a rule of its own in the TextMate grammar, and its name
  reads as a namespace in both.

### Changed

- `shared/language.json` records `contextualKeywords.recognizedWhen` — the
  exact shape the compiler's parser tests for, one line per contextual
  keyword. It is the contract every highlighting rule is written against.
- `npm run sync` checks the contextual keywords too: that none of them has
  become reserved, that the compiler still spells each one, and that each has
  its rule written down.

### Fixed

- A field, parameter or local called `async`, `await` or `package` stays an
  ordinary name. None of the three is reserved, and the compiler's own sources
  use all three as names, so a rule that over-matched would have broken
  highlighting on the compiler itself. `src/scanner.c` now does the same
  one-token lookahead the compiler's parser does.

## [0.1.2] - 2026-08-04

### Fixed

- **Zed: "Failed to install dev extension: failed to compile Rust extension".**
  Zed builds the extension itself by running `cargo build --target
  wasm32-wasip2` with whatever `cargo` is first on `PATH`. On a machine with
  more than one Rust installation, that is often one carrying host support
  only, and the install failed. The extension now pins its toolchain and
  target, so a rustup-managed `cargo` installs what it needs on demand.

  If it still fails, `cargo` on your `PATH` is not managed by rustup and cannot
  add targets. The Zed
  [README](https://github.com/beans-lang/editors/blob/main/zed/README.md#troubleshooting)
  has the one-line fix.

### Changed

- The Zed README has a troubleshooting section covering that failure, and
  `npm run check:rust` now reports the same problem directly instead of
  quietly building with a different toolchain than Zed would use.

The VS Code extension is unchanged in this release.

## [0.1.1] - 2026-08-03

First release of Beans language support for VS Code and Zed.

Both extensions are thin clients over `beansc lsp`, the language server built
into the Beans compiler, so the editors never disagree with it about what a
Beans program means.

### Added

- **VS Code extension.** Syntax highlighting for `.b` files and the `beans.pot`
  manifest, plus a language client that starts `beansc lsp`.
- **Zed extension.** A Tree-sitter grammar for `.b` files and the same language
  client behaviour.
- **Language intelligence**, negotiated over LSP and served by the compiler:
  live diagnostics, completion including members after `.`, hover with
  signatures and documentation, signature help, go to definition across
  packages, find references, document symbols, semantic tokens, and rename.
- **Editor behaviour**: bracket matching, comment toggling, indentation rules,
  code folding, and `///` doc-comment continuation.
- **File icons** for `.b` and `beans.pot` in VS Code.
- **Compiler discovery** in a documented order — an editor setting, the
  `BEANSC` environment variable, the workspace root and `PATH`, then a local
  source build. The compiler is launched directly, never through a shell, so a
  path containing spaces works without quoting.

### Notes

- The `beansc` compiler is required and is not bundled. No binary has been
  published yet; build it from
  [beans-lang/beans](https://github.com/beans-lang/beans) with `make`.
- Formatting, code actions, inlay hints and workspace symbols are not
  available. They need the compiler's language server to provide them first;
  neither extension imitates them.
- `beans.pot` is matched by exact filename. The `.pot` suffix belongs to
  gettext and is never claimed.

[0.1.2]: https://github.com/beans-lang/editors/releases/tag/v0.1.2
[0.1.1]: https://github.com/beans-lang/editors/releases/tag/v0.1.1
