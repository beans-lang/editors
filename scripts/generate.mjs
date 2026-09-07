#!/usr/bin/env node
// Regenerates every derived editor asset from editors/shared/language.json and
// editors/shared/bx.json.
//
//   node scripts/generate.mjs               write the files
//   node scripts/generate.mjs --check       fail if anything is out of date (CI)
//   node scripts/generate.mjs --bx <path>   read the .bx vocabulary from <path>
//
// `--bx` is for regenerating against a latte checkout other than the one whose
// output is committed, and for the test that proves a wrong-shaped vocabulary
// is refused rather than silently emptied.
//
// Nothing here reads the beans repository. Proving shared/language.json still
// matches the compiler is sync-beans.mjs's job.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import {
  loadLanguageData,
  loadBxData,
  editorsRoot,
  BX_SCHEMA,
  BX_ROW_FIELDS,
  GENERATED_BANNER,
  BX_GENERATED_BANNER,
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

const bxFlag = process.argv.indexOf('--bx');
if (bxFlag !== -1 && process.argv[bxFlag + 1] === undefined) {
  console.error('--bx needs a path to a bx.json after it');
  process.exit(2);
}

const data = loadLanguageData();

// Loud, and before anything is written. `loadBxData` refuses a vocabulary of
// the wrong shape; printing the message without the stack keeps the reason —
// which names every missing table — the first thing on the screen.
let bx;
try {
  bx = bxFlag === -1 ? loadBxData() : loadBxData(process.argv[bxFlag + 1]);
} catch (problem) {
  console.error(problem.message);
  process.exit(1);
}

/** The TypeScript type each schema kind emits. */
const BX_TS_TYPE = { rows: 'BxRow[]', events: 'BxEvent[]', names: 'string[]' };

/**
 * `shared/bx.json` as a TypeScript module.
 *
 * The extension is bundled from `src/`, and `tsconfig.json` sets `rootDir` to
 * it, so a JSON file two directories up cannot be imported. Emitting it as a
 * source file keeps the data typed, bundled and generated all at once.
 *
 * **Both the interface and the object are built from `BX_SCHEMA`**, and that is
 * the fix for a real bug rather than tidiness. The old version destructured the
 * nine keys it wanted and handed them to `JSON.stringify`, which drops every
 * `undefined` without a word: a `bx.json` of the wrong shape produced a
 * `bx-data.ts` with eight of its nine tables gone, and got past both `npm run
 * generate` and the drift gate on the way. `loadBxData` now refuses that file,
 * and this function can no longer name a key the check has not seen.
 */
function buildBxData(b) {
  const fields = Object.entries(BX_SCHEMA)
    .map(([key, kind]) => `  ${key}: ${BX_TS_TYPE[kind]};`)
    .join('\n');
  // The `$`-prefixed provenance keys belong in shared/bx.json, where a reader
  // needs them; the module says the same thing in its header.
  const vocabulary = Object.fromEntries(
    Object.keys(BX_SCHEMA).map((key) => [key, b[key]]),
  );
  const json = JSON.stringify(vocabulary, null, 2);
  const row = (kind) => BX_ROW_FIELDS[kind].map((f) => `  ${f}: string;`).join('\n');

  return `// ${BX_GENERATED_BANNER}
//
// The vocabulary itself is printed by latte, out of its own tables:
//
//     cd community-libs/latte
//     build/latte-bx vocabulary > editors/shared/bx.json
//     cd editors && npm run generate
//
// latte's suite tests/w2_editor_data.b holds the same string as its golden and
// tests/markup.b asks html.b's predicates about every name in it, so this
// cannot drift from the compiler without failing latte's own gate.

/** One named thing in the surface: what to write, and why. */
export interface BxRow {
${row('rows')}
}

/** One DOM event: the class its handler takes, and the Builder method. */
export interface BxEvent {
${row('events')}
}

export interface BxVocabulary {
${fields}
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
    content: `${JSON.stringify(buildBxTmLanguage(data, bx), null, 2)}\n`,
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
