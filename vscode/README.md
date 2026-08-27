# Beans for VS Code

Syntax highlighting and full language intelligence for the
[Beans programming language](https://github.com/beans-lang/beans).

The extension is a thin client. It starts `beansc lsp` — the language server
built into the Beans compiler — and renders whatever that server advertises.
Diagnostics, completion, hover, signature help, definition, declaration,
implementation, type definition, references, document highlights, document and
workspace symbols, call and type hierarchy, semantic tokens and rename all come
from the compiler.

Debugging works the same way: the extension contributes a `beans` debug type
that starts `beansc debug-adapter`, which speaks the Debug Adapter Protocol.
Nothing about the language lives in this extension.

## `.bx` markup

A `.bx` file is a Beans file with tag expressions in it, which
[crema](https://github.com/beans-lang/crema)'s `bx` package compiles to a `.b`.
It opens as its own language, `beans-bx`, and gets:

- **Highlighting.** The grammar is a thin layer over the Beans one — tags,
  attributes, `on:` handlers, embedded `{…}` expressions and quoted values are
  painted, and everything else falls through to `source.beans`. Which `<` opens
  a tag mirrors `bx/compile.b` exactly, so `List<string>`, `xs[i]<n`, `f()<n`
  and a `<div>` inside a string or a comment all keep their meaning.
- **Completion.** Tags after `<`; inside a tag, every flag, ramp family and its
  steps, counted family, string and expression attribute and listener, each
  with the call it becomes; every colour name after `bg="`, with a swatch.
- **Hover** naming what an attribute compiles to, and **colour swatches** with
  a picker for the colours a tag names.

That vocabulary is generated out of crema's own tables, not written down here:
`community-libs/crema/tests/_bx_editor_data.b` prints it into
`editors/shared/bx.json`.

Markup is the one thing the extension answers itself, and only because the
compiler cannot: tags are crema's, not the language's, so `beansc` has never
heard of them. The Beans *around* a tag gets no language server — `beansc lsp`
is not offered `.bx` documents, because it would report a syntax error on every
tag. Hover and go-to-definition inside a `.bx` file would need bx reachable
from the compiler, or a `bx` CLI to compile a buffer and map positions back.

## Requirements

Install the released `beansc` compiler:

```bash
curl -fsSL https://github.com/beans-lang/beans/releases/latest/download/beans-install.sh | sh
```

The [Beans install guide](https://github.com/beans-lang/beans/blob/main/docs/INSTALL.md)
also has the Windows command and source-build steps. The extension checks the
normal install directory directly, even when VS Code started with an old PATH.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `beans.compiler.path` | `""` | Path to `beansc`. Absolute, or relative to the workspace. Supports `~` and `${workspaceFolder}`. |
| `beans.compiler.searchDevelopmentPaths` | `true` | Also look for a source build at `build/beansc`, `beans/build/beansc`, `../beans/build/beansc`. |
| `beans.trace.server` | `"off"` | `"messages"` or `"verbose"` to log the JSON-RPC traffic. |
| `beans.debug.trace` | `false` | Log the debug adapter's startup, and where `beansc` was found. |

The compiler is resolved in this order:

1. `beans.compiler.path`
2. the `BEANSC` environment variable
3. `BEANS_HOME`, then the normal installer location
4. `beansc` at a workspace root, then on `PATH`
5. a development build, unless `searchDevelopmentPaths` is off

A path with spaces in it needs no quoting — the compiler is spawned directly,
never through a shell.

## Commands

| Command | What it does |
| --- | --- |
| **Beans: Restart Language Server** | Stops and restarts `beansc lsp`. |
| **Beans: Show Language Server Output** | Opens the log, including how the compiler was found. |

The server also restarts by itself when the compiler settings or the workspace
folders change.

## Debugging

Open a `.b` file and press <kbd>F5</kbd>. With no `launch.json`, the extension
debugs the file in the active editor. To write one, pick **Beans** in the
launch-configuration list, or use a snippet:

```json
{
  "type": "beans",
  "request": "launch",
  "name": "Debug Beans Program",
  "program": "${file}",
  "cwd": "${workspaceFolder}",
  "args": [],
  "env": {},
  "stopOnEntry": false
}
```

| Attribute | Default | What it does |
| --- | --- | --- |
| `program` | `${file}` | The Beans file to run. Required. |
| `cwd` | `${workspaceFolder}` | Working directory for the program. |
| `args` | `[]` | Arguments passed to the program. |
| `env` | `{}` | Extra environment variables. |
| `stopOnEntry` | `false` | Stop before the first statement of `main`. |
| `mode` | `interpreter` | `interpreter` runs it under `beansc debug-adapter`; `native` builds with `--debug` and debugs the binary. |
| `output` | `build/` beside the source | Where a native build writes its binary. |
| `adapter` | best installed | The debug type a native launch hands the binary to. |

By default the debugger runs your program with the compiler's tree interpreter
— no build step, no second toolchain. You get breakpoints on Beans lines, a
call stack of Beans function names, `self`, parameters and locals with real
values, paging through large lists, maps and objects, watch expressions over
variable paths (`name`, `name.field`, `name[0]`), step over / into / out,
continue, and a stop on a runtime panic with the stack still standing.

### Debugging the compiled binary

`"mode": "native"` builds with `beansc build --debug` and hands the binary to a
native debugger. `--debug` writes a DWARF line table for your Beans statements,
so breakpoints, backtraces, stepping and locals all work on the program that
actually ships. Install [CodeLLDB][codelldb], [LLDB DAP][lldbdap] or
[C/C++][cpptools] — this extension ships no native adapter, because the binary
is an ordinary one and those already read it.

[codelldb]: https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb
[lldbdap]: https://marketplace.visualstudio.com/items?itemName=llvm-vs-code-extensions.lldb-dap
[cpptools]: https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools

Use it when the bug is about the compiled program — a crash in the runtime or a
C library, threads, timing. The interpreter debugger stays better at values:
native shows scalars, `bool`s and strings exactly, and lists, maps and objects
as a Beans type and an address. See
[the top-level README](../README.md#interpreter-debugging-vs-native-debugging).

The debugger uses the same compiler resolution as the language server, so both
halves are always the same build.

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
npm run test:debug      # launch configurations and a real DAP session
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

For `.b`, the extension registers no language feature providers of its own, and
it implements no part of the debugger beyond finding and starting `beansc
debug-adapter`. The `.bx` providers above are the single exception, and they
answer only about markup. A missing feature is missing from the compiler, and that is
where it should be added; a second engine in the editor would drift from it.
See the feature matrix in the [top-level README](../README.md).

Browser-only VS Code is not supported. `beansc lsp` is a native executable, so
the document selector is `scheme: file` and `virtualWorkspaces` is declared
unsupported.

## Files

```
vscode/
  package.json                          extension manifest
  language-configuration.json           brackets, comments, indentation, word rules
  manifest-language-configuration.json  the same for beans.pot
  bx-language-configuration.json        the same for .bx, plus tags
  syntaxes/                             generated TextMate grammars
  icons/                                generated light/dark icons
  src/
    extension.ts                        activation, commands, config changes
    client.ts                           the language client lifecycle
    beansc.ts                           compiler resolution (no vscode imports)
    debug.ts                            launch configurations (no vscode imports)
    debugger.ts                         the debug provider and adapter factory
    bx.ts                               the .bx providers
    bx-model.ts                         the bx tables and the cursor scanner
                                        (no vscode imports)
    bx-data.ts                          generated: crema's bx vocabulary
```

`syntaxes/`, `icons/`, `src/bx-data.ts` and the Zed queries are generated —
from `editors/shared/language.json`, `editors/shared/bx.json` and
`editors/icons/source/`. Edit those and run `npm run generate`.
