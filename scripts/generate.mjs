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

import { loadLanguageData, editorsRoot, GENERATED_BANNER } from './lib/language-data.mjs';
import { buildTmLanguage, buildManifestTmLanguage } from './lib/tmlanguage.mjs';
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
