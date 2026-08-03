# Beans for VS Code

Syntax highlighting and full language intelligence for the
[Beans programming language](https://github.com/beans-lang/beans).

The extension is a thin LSP client. It starts `beansc lsp` — the language
server built into the Beans compiler — and renders whatever that server
advertises. Diagnostics, completion, hover, signature help, definition,
references, document symbols, semantic tokens and rename all come from the
compiler.

## Requirements

The `beansc` compiler. There is no published binary yet, so build it from the
[beans repository](https://github.com/beans-lang/beans):

```bash
make
```

That leaves the compiler at `build/beansc`.

The extension finds it automatically when `beans` and `editors` are checked out
side by side. Otherwise set the path (see below).

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `beans.compiler.path` | `""` | Path to `beansc`. Absolute, or relative to the workspace. Supports `~` and `${workspaceFolder}`. |
| `beans.compiler.searchDevelopmentPaths` | `true` | Also look for a source build at `build/beansc`, `beans/build/beansc`, `../beans/build/beansc`. |
| `beans.trace.server` | `"off"` | `"messages"` or `"verbose"` to log the JSON-RPC traffic. |

The compiler is resolved in this order:

1. `beans.compiler.path`
2. the `BEANSC` environment variable
3. `beansc` at a workspace root, then on `PATH`
4. a development build, unless `searchDevelopmentPaths` is off

A path with spaces in it needs no quoting — the compiler is spawned directly,
never through a shell.

## Commands

| Command | What it does |
| --- | --- |
| **Beans: Restart Language Server** | Stops and restarts `beansc lsp`. |
| **Beans: Show Language Server Output** | Opens the log, including how the compiler was found. |

The server also restarts by itself when the compiler settings or the workspace
folders change.

## Development

From `editors/`:

```bash
npm install
npm --workspace beans-vscode run build     # tsc
npm --workspace beans-vscode run watch     # tsc --watch
npm --workspace beans-vscode run lint      # eslint
```

To run the extension:

1. Open `editors/vscode` in VS Code.
2. Press <kbd>F5</kbd> — this launches an Extension Development Host.
3. Open any `.b` file. It highlights immediately; the server starts behind it.
4. Check **Beans: Show Language Server Output** to see which compiler was found.

If nothing happens, the output channel says what was tried and where.

### Tests

The tests live at the `editors/` root, because they cover more than this
extension:

```bash
npm test                # everything
npm run test:resolve    # compiler path resolution
npm run test:grammar    # TextMate scopes
npm run test:lsp        # a real beansc lsp session
```

See [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Packaging

```bash
npm --workspace beans-vscode run package
```

That produces `beans-vscode.vsix`. Install it with:

```bash
code --install-extension beans-vscode.vsix
```

`--no-dependencies` is used because the only runtime dependency,
`vscode-languageclient`, is hoisted by the npm workspace. To package for
publication, run `npm install --omit=dev` inside `vscode/` first so the
dependency is present in `vscode/node_modules`, then package without that flag.

## Scope

The extension registers no language feature providers of its own. A missing
feature is missing from `beansc lsp`, and that is where it should be added; a
second feature engine in the editor would drift from the compiler. See the
feature matrix in the [top-level README](../README.md).

Browser-only VS Code is not supported. `beansc lsp` is a native executable, so
the document selector is `scheme: file` and `virtualWorkspaces` is declared
unsupported.

## Files

```
vscode/
  package.json                          extension manifest
  language-configuration.json           brackets, comments, indentation, word rules
  manifest-language-configuration.json  the same for beans.pot
  syntaxes/                             generated TextMate grammars
  icons/                                light/dark icons for .b and beans.pot
  src/
    extension.ts                        activation, commands, config changes
    client.ts                           the language client lifecycle
    beansc.ts                           compiler resolution (no vscode imports)
```

`syntaxes/` is generated from `editors/shared/language.json` — edit that and run
`npm run generate`.
