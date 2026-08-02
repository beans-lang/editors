# Beans editor icons

The source icon is one coffee bean. The module manifest icon is a group of
three beans. All SVGs are transparent and have no font or filter dependency.

## VS Code

- `vscode/beans-b-dark.svg` and `vscode/beans-b-light.svg` — `.b`
- `vscode/beans-pot-dark.svg` and `vscode/beans-pot-light.svg` — `beans.pot`

Use the light and dark files in the matching `contributes.languages[].icon`
entries, or copy their paths into a file icon theme.

## Zed

- `zed/beans-b.svg` — `.b`
- `zed/beans-pot.svg` — `beans.pot`

In an icon theme, map `.b` files to `beans-b.svg` and the exact manifest name
`beans.pot` to `beans-pot.svg` using the editor's file-name association.

Map the manifest by exact name, not by the broad `.pot` suffix. Other tools use
`.pot` for gettext templates.
