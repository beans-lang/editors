# Changelog

## 0.1.0 — unreleased

First release.

- Language registration for `beans` (`.b`) and `beans-manifest` (`beans.pot`
  by exact filename — `.pot` belongs to gettext and is never claimed).
- TextMate highlighting for line, doc and nested block comments, strings with
  interpolation and format specs, all number forms, keywords, contextual
  modifiers, builtin and user types, functions, fields and operators.
- Language configuration: bracket pairs, auto-closing pairs, comment toggling,
  indentation rules, word pattern, folding markers, `///` continuation.
- A `vscode-languageclient` client that starts `beansc lsp` and lets normal LSP
  capability negotiation enable diagnostics, completion, hover, signature help,
  definition, references, document symbols, semantic tokens and rename.
- Compiler resolution: `beans.compiler.path`, then `BEANSC`, then the workspace
  root and `PATH`, then a local development build. The compiler is spawned
  directly, never through a shell.
- Clean start, stop, restart and configuration-change handling, plus a
  **Beans: Restart Language Server** command.
- A missing-compiler message that names what was tried and links to the setting.
- Light and dark file icons for `.b` and `beans.pot`.
