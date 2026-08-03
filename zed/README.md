# Beans for Zed

Tree-sitter highlighting plus full language intelligence for the
[Beans programming language](https://github.com/beans-lang/beans).

The extension is a thin shell: it finds `beansc` and hands Zed the command
`beansc lsp`. Every language feature is negotiated from the compiler's own
language server.

## Requirements

- **Zed 0.205 or newer.** The extension is built against
  `zed_extension_api` 0.7.0.
- **The `beansc` compiler.** There is no published binary yet — build it from
  the [beans repository](https://github.com/beans-lang/beans) with `make`,
  which leaves it at `build/beansc`.
- **Rust with the `wasm32-wasip2` target**, to install as a dev extension. Zed
  compiles the extension itself:

  ```bash
  rustup target add wasm32-wasip2
  ```

  A Homebrew or distro Rust has host std only, so `rustup` is what you want
  here. On macOS, note that `brew install rustup` is keg-only and creates no
  `~/.cargo/bin` shims — `npm run check:rust` finds the toolchain under
  `~/.rustup/toolchains` regardless.

## Settings

Zed configures language servers under `lsp`:

```json
{
  "lsp": {
    "beansc": {
      "binary": {
        "path": "/path/to/beansc"
      }
    }
  }
}
```

`binary.arguments` and `binary.env` are honoured too. Without a path, the
extension resolves the compiler in this order:

1. `lsp.beansc.binary.path`
2. the `BEANSC` environment variable
3. `beansc` on the worktree's `PATH`
4. a source build at `build/beansc`, `beans/build/beansc` or
   `../beans/build/beansc`, relative to the worktree root

Each candidate is verified by running `beansc --version` — an extension has no
filesystem API, and this proves more than a stat would. If nothing resolves,
Zed shows a message listing everything that was tried.

The compiler is spawned directly, so a path containing spaces needs no quoting.

### Semantic tokens

Zed does not request semantic tokens by default. To turn them on:

```json
{
  "semantic_tokens": "combined"
}
```

The extension ships `languages/beans/semantic_token_rules.json`, so the styling
is right as soon as it is enabled. It covers the token types from **both**
compiler implementations, whose legends currently differ — see the known issues
in the [top-level README](../README.md).

## Installing as a dev extension

The grammar is already pinned to a pushed commit, so this just works:

1. Open the command palette and run **zed: extensions**.
2. Click **Install Dev Extension**.
3. Choose `editors/zed`.

Zed compiles `src/lib.rs` to Wasm and builds the grammar from
`tree-sitter-beans/src/parser.c` and `src/scanner.c`.

Open a `.b` file. It highlights immediately, and `beansc lsp` starts behind it.

## Re-pinning after a grammar change

Zed fetches Tree-sitter grammars by cloning a git repository at an exact
revision, so it cannot read a working copy. Any change to `grammar.js` needs a
new pushed commit and a new pin.

```bash
cd editors
npm run grammar                       # regenerate + tree-sitter generate
git commit -am "Update the Beans grammar"
git push
node scripts/pin-grammar.mjs --rev "$(git rev-parse HEAD)"
```

`--rev` refuses a commit that does not contain
`tree-sitter-beans/src/parser.c`, so a pin that would fail at install time
fails here instead. Check the current state at any time:

```bash
node scripts/pin-grammar.mjs --status
```

To iterate on the grammar without pushing anything, point the pin at this
checkout instead — Zed accepts a `file://` URL:

```bash
git commit -am "Work in progress on the grammar"
node scripts/pin-grammar.mjs --local   # file:// URL at the current HEAD
```

Run `--rev` again before releasing, so the published extension references a
commit everyone can fetch.

> Always pin through the script rather than editing `extension.toml` by hand.
> A wrong revision fails at install time with a confusing checkout error, so
> `pin-grammar.mjs` verifies the commit carries the generated parser, and the
> manifest test accepts only a full 40-character SHA or the literal
> `UNPINNED`.

## Development

From `editors/`:

```bash
npm run check:rust        # cargo fmt --check, cargo check, cargo clippy -D warnings
npm run check:rust -- --fix
```

Or directly:

```bash
cd zed
cargo fmt
cargo check
cargo clippy --all-targets -- -D warnings
cargo build --release --target wasm32-wasip2
```

The host-target `cargo check` is what proves the code compiles against
`zed_extension_api`. The `wasm32-wasip2` build produces what Zed actually
loads — a WebAssembly **component** (binary version `0x1000d`), not a core
module. `npm run check:rust` runs both, and skips the Wasm build with a clear
message when no toolchain has the target.

## Files

```
zed/
  extension.toml                        manifest, grammar pin, language server entry
  Cargo.toml                            cdylib crate on zed_extension_api 0.7
  src/lib.rs                            compiler resolution + language_server_command
  languages/beans/
    config.toml                         suffixes, comments, brackets, indentation
    highlights.scm                      generated
    brackets.scm                        generated
    outline.scm                         generated
    indents.scm                         generated
    injections.scm                      generated
    textobjects.scm                     generated
    semantic_token_rules.json           generated
```

The `.scm` files and `semantic_token_rules.json` are generated from
`editors/shared/language.json` — edit that and run `npm run generate`.

## Limitations

**No `beans.pot` language.** Zed requires a Tree-sitter grammar for every
language, and the manifest format would need one of its own. The VS Code
extension supports it because VS Code does not have that requirement.

**No icon theme.** Zed icon themes replace the entire icon set rather than
extending it, so a Beans-only theme would leave every other file without an
icon. The assets are in [`../icons/`](../icons/) for anyone building a
complete theme.
