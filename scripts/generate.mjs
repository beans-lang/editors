#!/usr/bin/env node
// Regenerates every derived editor asset from editors/shared/language.json.
//
//   node scripts/generate.mjs            write the files
//   node scripts/generate.mjs --check    fail if anything is out of date (CI)
//
// Nothing here reads the beans repository. Proving shared/language.json still
// matches the compiler is sync-beans.mjs's job.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import {
  loadLanguageData,
  loadBxData,
  editorsRoot,
  GENERATED_BANNER,
} from './lib/language-data.mjs';
import {
  buildTmLanguage,
  buildManifestTmLanguage,
  buildBxTmLanguage,
} from './lib/tmlanguage.mjs';
import { buildIcons } from './lib/icons.mjs';
import {
  buildHighlights,
  buildBrackets,
  buildOutline,
  buildIndents,
  buildInjections,
  buildTextObjects,
  buildSemanticTokenRules,
} from './lib/queries.mjs';

const check = process.argv.includes('--check');

const data = loadLanguageData();
const bx = loadBxData();

/**
 * `shared/bx.json` as a TypeScript module.
 *
 * The extension is bundled from `src/`, and `tsconfig.json` sets `rootDir` to
 * it, so a JSON file two directories up cannot be imported. Emitting it as a
 * source file keeps the data typed, bundled and generated all at once.
 */
function buildBxData(b) {
  // The `$`-prefixed provenance keys belong in shared/bx.json, where a reader
  // needs them; the module says the same thing in its header.
  const { tags, flags, ramps, stepTables, counts, texts, values, events, colors } = b;
  const json = JSON.stringify(
    { tags, flags, ramps, stepTables, counts, texts, values, events, colors },
    null,
    2,
  );
  return `// ${GENERATED_BANNER}
//
// Printed by community-libs/crema/tests/_bx_editor_data.b, out of bx's own
// tables in crema. Regenerate with:
//
//     beansc run tests/_bx_editor_data.b > editors/shared/bx.json
//     npm run generate

export interface BxTag {
  name: string;
  call: string;
  styled: boolean;
  parent: boolean;
  note: string;
}

export interface BxRamp {
  family: string;
  table: string;
}

export interface BxText {
  attr: string;
  kind: string;
}

export interface BxValue {
  attr: string;
  takes: string;
}

export interface BxEvent {
  event: string;
  payload: string;
  signature: string;
}

export interface BxColor {
  name: string;
  hex: string;
}

export interface BxVocabulary {
  tags: BxTag[];
  flags: string[];
  ramps: BxRamp[];
  stepTables: Record<string, string[]>;
  counts: string[];
  texts: BxText[];
  values: BxValue[];
  events: BxEvent[];
  colors: BxColor[];
}

export const BX: BxVocabulary = ${json};
`;
}

/** The keyword/operator/type lists grammar.js consumes at `tree-sitter generate` time. */
function buildGrammarData(d) {
  return {
    $generated: GENERATED_BANNER,
    keywords: d.keywords,
    contextualKeywords: d.contextualKeywords,
    operators: d.operators,
    types: {
      primitives: d.types.primitives,
      genericClasses: d.types.genericClasses,
      builtinClasses: d.types.builtinClasses,
      builtinEnums: d.types.builtinEnums,
      unit: d.types.unit,
      // grammar.js builds a RegExp from this, so strip the anchors.
      simdTypeRegex: d.types.simdTypePattern.replace(/^\^|\$$/g, ''),
    },
  };
}

const outputs = [
  {
    path: 'vscode/syntaxes/beans.tmLanguage.json',
    content: `${JSON.stringify(buildTmLanguage(data), null, 2)}\n`,
  },
  {
    path: 'vscode/syntaxes/beans-manifest.tmLanguage.json',
    content: `${JSON.stringify(buildManifestTmLanguage(data), null, 2)}\n`,
  },
  {
    path: 'vscode/syntaxes/beans-bx.tmLanguage.json',
    content: `${JSON.stringify(buildBxTmLanguage(data), null, 2)}\n`,
  },
  { path: 'vscode/src/bx-data.ts', content: buildBxData(bx) },
  {
    path: 'tree-sitter-beans/grammar-data.json',
    content: `${JSON.stringify(buildGrammarData(data), null, 2)}\n`,
  },
  { path: 'zed/languages/beans/highlights.scm', content: buildHighlights(data) },
  { path: 'zed/languages/beans/brackets.scm', content: buildBrackets() },
  { path: 'zed/languages/beans/outline.scm', content: buildOutline() },
  { path: 'zed/languages/beans/indents.scm', content: buildIndents() },
  { path: 'zed/languages/beans/injections.scm', content: buildInjections() },
  { path: 'zed/languages/beans/textobjects.scm', content: buildTextObjects() },
  {
    path: 'zed/languages/beans/semantic_token_rules.json',
    content: `${JSON.stringify(buildSemanticTokenRules(data), null, 2)}\n`,
  },
];

// The file icons: one drawing per icon in icons/source/, repainted per theme
// and copied into vscode/ so the extension can be packaged from there.
outputs.push(...buildIcons());

// The tree-sitter package ships the same queries so `tree-sitter highlight`
// and other consumers see what Zed sees.
for (const name of ['highlights', 'brackets', 'indents', 'injections', 'textobjects']) {
  const from = outputs.find((o) => o.path === `zed/languages/beans/${name}.scm`);
  outputs.push({ path: `tree-sitter-beans/queries/${name}.scm`, content: from.content });
}

let stale = 0;
let written = 0;

for (const out of outputs) {
  const abs = join(editorsRoot, out.path);
  const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null;

  if (current === out.content) continue;

  if (check) {
    console.error(`stale: ${out.path}`);
    stale += 1;
    continue;
  }

  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, out.content);
  console.log(`wrote ${relative(editorsRoot, abs)}`);
  written += 1;
}

if (check) {
  if (stale > 0) {
    console.error(
      `\n${stale} generated file(s) out of date. Run \`npm run generate\` and commit the result.`,
    );
    process.exit(1);
  }
  console.log(`generate --check: ${outputs.length} file(s) up to date`);
} else {
  console.log(`generate: ${written} written, ${outputs.length - written} already current`);
}
