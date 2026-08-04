# Beans editor support

Official editor integrations for the
[Beans programming language](https://github.com/beans-lang/beans).

| Editor | Location | Status |
| --- | --- | --- |
| VS Code | [`vscode/`](vscode/) | Syntax highlighting and full language intelligence |
| Zed | [`zed/`](zed/) | Syntax highlighting and full language intelligence |

Both are thin clients over `beansc lsp`, the language server built into the
Beans compiler. Diagnostics, completion, hover, signature help, definition,
references, document symbols, semantic tokens and rename all come from the
compiler itself, so the editors never disagree with it.

## Requirements

The `beansc` compiler. No binary has been published yet, so build it from the
[beans repository](https://github.com/beans-lang/beans):

```bash
git clone https://github.com/beans-lang/beans
cd beans && make
```

That produces `build/beansc`. Both extensions find it automatically when
`beans` and `editors` sit side by side; otherwise point them at it with a
setting.

## Installing

### VS Code

Download `beans-vscode-<version>.vsix` from the
[latest release](https://github.com/beans-lang/editors/releases/latest) and
install it:

```bash
code --install-extension beans-vscode-<version>.vsix
```

Or build it yourself:

```bash
git clone https://github.com/beans-lang/editors
cd editors && npm install
npm --workspace beans-vscode run package
code --install-extension vscode/beans-vscode.vsix
```

### Zed

Zed builds extensions from source, so this needs Rust with the `wasm32-wasip2`
target:

```bash
rustup target add wasm32-wasip2
```

Open the command palette, run **zed: extensions**, click
**Install Dev Extension**, and choose the `zed` directory — either from a clone
of this repository or from the unzipped `beans-zed-<version>.zip` in a release.

## Features

Everything in this table is served by `beansc lsp` and reaches both editors
through standard LSP capability negotiation.

| Feature | VS Code | Zed |
| --- | --- | --- |
| Syntax highlighting, before the server starts | ● | ● |
| Live diagnostics while typing | ● | ● |
| Completion, including members after `.` | ● | ● |
| Hover with signatures and documentation | ● | ● |
| Signature help | ● | ● |
| Go to definition, across packages | ● | ● |
| Find references | ● | ● |
| Document symbols and outline | ● | ● |
| Rename | ● | ● |
| Semantic tokens | ● | ○ |
| Brackets, comment toggling, indentation, folding | ● | ● |
| File icons for `.b` and `beans.pot` | ● | — |

● supported ○ opt-in — not available

Zed requests semantic tokens only when `"semantic_tokens"` is set to
`"combined"` or `"full"`; the extension ships the styling so it looks right the
moment you enable it.

Zed has no way for a language extension to contribute a file icon — icons come
only from an icon theme, one of which is active at a time, and a theme replaces
the whole set rather than extending it. A Beans-only theme would drop every
other language to the generic file icon, so none is shipped. The assets are in
[`icons/`](icons/) for adding `.b` to an existing icon theme, which is how
every other language gets its icon in Zed.

### Not yet available

Formatting, code actions, inlay hints, workspace symbols, go-to-type-definition,
go-to-implementation, call and type hierarchy, document highlight, selection
ranges and code lens are **not implemented**. Each needs `beansc lsp` to grow
the capability first; neither client fakes them. When the compiler adds one, it
appears in both editors with no extension change.

## Configuration

Both extensions look for the compiler in the same order:

1. an editor setting
2. the `BEANSC` environment variable
3. `beansc` at a workspace root, then on `PATH`
4. a source build at `build/beansc`, `beans/build/beansc` or
   `../beans/build/beansc`

A setting that points at nothing is reported as an error rather than silently
falling through to a different compiler. The compiler is launched directly as
`beansc lsp`, never through a shell, so a path containing spaces needs no
quoting.

**VS Code** — `beans.compiler.path`, `beans.compiler.searchDevelopmentPaths`,
`beans.trace.server`. See [`vscode/README.md`](vscode/README.md).

**Zed** — `lsp.beansc.binary.path`, `.arguments`, `.env`. See
[`zed/README.md`](zed/README.md).

## Documentation

- [`vscode/README.md`](vscode/README.md) — settings, commands, development, packaging
- [`zed/README.md`](zed/README.md) — settings, dev extension install, grammar pinning
- [`tree-sitter-beans/README.md`](tree-sitter-beans/README.md) — the Tree-sitter grammar
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — architecture, tests, how to change the language data

## Contributing

```bash
npm install
npm test
```

The suite covers manifests, TextMate scopes, compiler resolution, the
Tree-sitter corpus, the Rust crate, and a real `beansc lsp` session. Steps that
need a beans checkout or a Rust toolchain skip themselves when those are
absent. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Licence

Apache-2.0. See [LICENSE](LICENSE).
