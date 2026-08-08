# Beans editor support

Official editor integrations for the
[Beans programming language](https://github.com/beans-lang/beans).

| Editor | Location | Status |
| --- | --- | --- |
| VS Code | [`vscode/`](vscode/) | Syntax highlighting and full language intelligence |
| Zed | [`zed/`](zed/) | Syntax highlighting and full language intelligence |

Both are thin clients over `beansc lsp`, the language server built into the
Beans compiler. Every answer — diagnostics, completion, hover, signature help,
navigation, references, rename, hierarchies — comes from the compiler's own
checked view of your project, so the editors never disagree with it.

VS Code can also debug: `beansc debug-adapter` speaks the Debug Adapter
Protocol, so F5 runs your program under the Beans interpreter with real
breakpoints, frames and variables.

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
| Go to declaration (the interface or base method) | ● | ● |
| Go to implementation | ● | ● |
| Go to type definition | ● | ● |
| Find references | ● | ● |
| Document highlights | ● | ● |
| Document symbols and outline | ● | ● |
| Workspace symbols | ● | ● |
| Call hierarchy | ● | ○ |
| Type hierarchy | ● | ○ |
| Rename | ● | ● |
| Semantic tokens | ● | ○ |
| Brackets, comment toggling, indentation, folding | ● | ● |
| Debugging (breakpoints, stepping, variables) | ● | — |
| File icons for `.b` and `beans.pot` | ● | — |

● supported ○ opt-in, or as the editor grows support — not available

### What "exact" means here

The server does not match names. A position becomes a *symbol*, and the symbol
answers:

- `value.` offers the members of `value`'s checked type and nothing else —
  including built-in receivers such as `string`, `List<T>` and `Map<K, V>`.
- Plain completion offers what is in scope at the cursor. A local declared
  further down, a local of another function, and a local hidden in another
  block are all left out; an inner binding shadows an outer one.
- Two same-named methods on two same-named types in two packages are two
  different symbols. Renaming one never touches the other, and renaming a
  shadowed local never touches the binding it shadows.
- Rename refuses built-ins, keywords, and anything with no declaration, and it
  checks the new name is a Beans identifier before producing an edit.
- Names written inside a string's `{}` interpolation resolve like any other
  expression.
- A name owns exactly its own columns, so the `(` after `draw` is not `draw`.
- Renaming is refused when the new name would rebind something else — a local
  already in scope, a type the package declares, a member the type inherits —
  even though every one of those edits would still compile.
- Workspace symbols search every project under the opened folders, whether or
  not a file from them is open.

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

Formatting, code actions, inlay hints, selection ranges, code lens, folding
ranges from the server, and semantic-token deltas are **not implemented**.
Each needs `beansc lsp` to grow the capability first; neither client fakes
them. When the compiler adds one, it appears in both editors with no extension
change.

Zed decides which capabilities it asks for. Call and type hierarchy are
advertised by the server and will appear there when Zed requests them.

## Debugging

VS Code contributes a `beans` debug type. Open a `.b` file and press F5, or
write a launch configuration:

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

You get breakpoints on Beans lines, stop-on-entry, a call stack of Beans
function names, `self`, parameters and locals with their real values, paging
through large lists, maps and objects, watch expressions over variable paths,
step over / into / out, and continue. A runtime panic stops with the stack
still standing. The program's own output arrives in the debug console.

### Interpreter debugging vs native debugging

These are two different things, and only one of them exists today.

**Interpreter debugging — what ships.** `beansc debug-adapter` runs your
program with the compiler's tree interpreter. Nothing is compiled, so there is
no build step and no second toolchain; breakpoints are Beans file and line
positions, and every value comes from the interpreter's own frames. This is
the debugger the extension starts, and it is what you want for stepping
through Beans code.

**Native debugging — not available.** `beansc build --debug` produces an
unoptimized native binary (`-O0`, frame pointers kept, link-time optimization
off) that carries the platform's debug information for the Beans C runtime.
That makes a native backtrace, a crash report or a profiler readable at the
runtime level, and it is the foundation a native debugger needs. It is *not*
Beans source-level debugging: the LLVM emitter writes no line table for Beans
statements, so lldb and gdb cannot stop on a Beans line or name a Beans
function. Use the interpreter debugger for that. `test/native_debug.sh` in the
compiler repository asserts exactly this boundary, and fails the day the
emitter starts writing debug metadata — so this paragraph cannot quietly go
stale.

### Troubleshooting

**"Cannot start the Beans debugger: no `beansc` found."** The debugger uses
the same compiler as the language server and looks for it in the same order.
Set `beans.compiler.path`, or put `beansc` on your `PATH`. The message lists
every location that was tried.

**F5 does nothing, or asks which debugger to use.** The active editor has to
hold a `.b` file for the "debug the open file" default to apply. Otherwise set
`program` in `.vscode/launch.json`.

**The breakpoint moved.** A breakpoint on a blank line, a comment, or a
declaration has no statement to stop on, so the adapter moves it to the
nearest line that does and tells the editor where it really landed. That is
the hollow-to-solid move you see in the gutter.

**"a running Beans program cannot be interrupted."** The adapter is
single-threaded: while your program runs, it is inside the interpreter and
reads nothing. Set a breakpoint instead of pressing pause. Stop the session
with the stop button, which disconnects.

**A watch expression is refused.** The debugger evaluates variable paths —
`name`, `name.field`, `name[0]`, and chains of those. It does not run
arbitrary Beans expressions, so it can never produce a value by running code
with side effects.

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
`beans.trace.server`, `beans.debug.trace`. See
[`vscode/README.md`](vscode/README.md).

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
Tree-sitter corpus, the Rust crate, a real `beansc lsp` session, and a real
`beansc debug-adapter` session that stops at a breakpoint. Steps that need a
beans checkout or a Rust toolchain skip themselves when those are absent. See
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Licence

Apache-2.0. See [LICENSE](LICENSE).
