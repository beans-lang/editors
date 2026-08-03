# Changelog

All notable changes to the Beans editor integrations. This file is the source
of the GitHub Release notes — `scripts/release-notes.mjs` extracts the section
matching the tag.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.1]: https://github.com/beans-lang/editors/releases/tag/v0.1.1
