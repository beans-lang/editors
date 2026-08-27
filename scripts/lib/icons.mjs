// The file icons, in one palette per theme.
//
// `icons/source/*.svg` is the art, authored once, in the colours it should
// have on a light background. An editor also puts it on a dark one, where the
// same dark browns turn into a smudge, so each theme gets the same paths with
// a different palette — and the palette is written down here rather than
// living in four hand-edited copies of the same drawing that drift apart the
// first time a path changes.
//
// The ramp is Material's brown, which is what the art already uses:
//
//     50  #EFEBE9   100 #D7CCC8   300 #A1887F   400 #8D6E63
//     500 #795548   600 #6D4C41   700 #5D4037   800 #4E342E

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { editorsRoot } from './language-data.mjs';

/** The three colours the source art is drawn in, by the role each plays. */
const SOURCE = {
  body: '#5D4037',
  accent: '#4E342E',
  highlight: '#D7CCC8',
};

/**
 * What each role becomes per theme.
 *
 * `light` is the art as authored. `dark` lifts every role so the icon reads on
 * an editor background rather than disappearing into it, keeping the same
 * order — the accent stays darker than the body, the highlight stays the
 * lightest. `zed` is one icon for both themes, so it sits in the middle.
 */
const THEMES = {
  light: { body: '#5D4037', accent: '#4E342E', highlight: '#D7CCC8' },
  dark: { body: '#A1887F', accent: '#795548', highlight: '#FBF7F5' },
  zed: { body: '#8D6E63', accent: '#6D4C41', highlight: '#EFEBE9' },
};

/** The icons, and the file each theme's copy is written to. */
export const ICONS = {
  'beans-b': 'beans.svg',
  'beans-pot': 'pot.svg',
};

function repaint(svg, theme) {
  let out = svg;
  for (const [role, from] of Object.entries(SOURCE)) {
    // Every spelling of the colour, since the same brown is both a fill and a
    // stroke in the source and both have to move together.
    out = out.replaceAll(from, THEMES[theme][role]);
  }
  return out;
}

/**
 * Every icon file to write, as `{ path, content }`.
 *
 * VS Code takes a light/dark pair per language and Zed takes one file, and
 * both `icons/` and `vscode/icons/` hold a copy — the extension is packaged
 * from `vscode/`, so the art has to travel with it.
 */
export function buildIcons() {
  const out = [];
  for (const [name, file] of Object.entries(ICONS)) {
    const source = readFileSync(join(editorsRoot, 'icons', 'source', file), 'utf8');
    for (const theme of ['light', 'dark']) {
      const content = repaint(source, theme);
      out.push({ path: `icons/vscode/${name}-${theme}.svg`, content });
      out.push({ path: `vscode/icons/${name}-${theme}.svg`, content });
    }
    out.push({ path: `icons/zed/${name}.svg`, content: repaint(source, 'zed') });
  }
  return out;
}
