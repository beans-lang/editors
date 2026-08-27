#!/usr/bin/env node
// Proves editors/shared/language.json still matches the compiler.
//
//   node scripts/sync-beans.mjs [--beans <path>] [--json]
//
// The compiler owns the language. Everything in shared/language.json is a copy
// of something in the beans repository, and a copy rots. This reads the real
// sources — the keyword table, the parser's contextual words, the builtin type
// names, the LSP dispatch table and the semantic-token legend — and reports any
// drift.
//
// It reads `beans/src/*.b`, the self-hosted compiler. It used to read
// `beans/compiler/bootstrap/*.cpp`, and when those files went away with the
// bootstrap it did not fail — it *skipped*, on every run, for months. That is
// how `priv`, `abstract`, `partial`, `singleton`, `weak`, `send`,
// `thread_local`, `annotation`, `type_of` and `from` all reached the language
// without reaching the grammar. A missing source is now a finding, not a skip,
// for exactly that reason; only a missing checkout skips.
//
// It never writes to the beans repository.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  builtinTypeNames,
  contextualKeywords,
  editorsRoot,
  loadLanguageData,
} from './lib/language-data.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};

const beansRoot = resolve(
  argValue('--beans') ?? process.env.BEANS_ROOT ?? join(editorsRoot, '..', 'beans'),
);

const data = loadLanguageData();
const findings = [];

/** The compiler sources this script reads, all under `src/`. */
const SOURCES = {
  token: 'src/token.b',
  parser: 'src/parser.b',
  resolve: 'src/resolve.b',
  semantic: 'src/semantic.b',
  // `super` is resolved where a call's receiver is, not in the parser.
  expression: 'src/expression.b',
  lspServer: 'src/lsp_server.b',
};

if (!existsSync(join(beansRoot, 'src'))) {
  console.log(`skip: no beans checkout at ${beansRoot}`);
  console.log('Pass --beans <path> or set BEANS_ROOT to check for drift.');
  process.exit(0);
}

const text = {};
for (const [name, relative] of Object.entries(SOURCES)) {
  const path = join(beansRoot, relative);
  if (!existsSync(path)) {
    findings.push({
      what: 'compiler sources',
      source: relative,
      error: `missing under ${beansRoot} — the compiler layout moved, and every check that reads it is now blind`,
    });
    continue;
  }
  text[name] = readFileSync(path, 'utf8');
}

const compare = (what, source, expected, actual, note) => {
  const missing = expected.filter((x) => !actual.includes(x));
  const extra = actual.filter((x) => !expected.includes(x));
  if (missing.length === 0 && extra.length === 0) return;
  // "missing" = in the compiler but not in shared/language.json.
  findings.push({ what, source, missing, extra, note });
};

/** Every `x == "word"` the file tests for, deduplicated. */
const comparedStrings = (source) => [
  ...new Set([...source.matchAll(/text == "([^"]+)"/g)].map((m) => m[1])),
];

// ---- reserved keywords ------------------------------------------------------
// src/token.b — keyword_kind(), one `text == "..."` per reserved spelling.
if (text.token !== undefined) {
  const body = /fn keyword_kind\(text: string\) -> string \{([\s\S]*?)\n\}/.exec(text.token);
  if (body === null) {
    findings.push({
      what: 'reserved keywords',
      source: SOURCES.token,
      error: 'could not find keyword_kind() — the compiler layout changed',
    });
  } else {
    compare(
      'reserved keywords',
      `${SOURCES.token} — keyword_kind()`,
      comparedStrings(body[1]),
      data.keywords.reserved,
    );
  }
}

// ---- contextual keywords ----------------------------------------------------
// The words the compiler decides about by looking at their neighbours, so the
// ones a highlighting rule gets wrong. Four things are checked, and the third
// is the one that matters: a word the parser learned and nobody told the
// editors about.
if (text.parser !== undefined && text.semantic !== undefined &&
    text.expression !== undefined) {
  const contextual = contextualKeywords(data);
  const reserved = data.keywords.reserved;

  const alsoReserved = reserved.filter((w) => contextual.includes(w));
  if (alsoReserved.length > 0) {
    findings.push({
      what: 'contextual keywords',
      source: 'shared/language.json',
      missing: [],
      extra: alsoReserved,
      note: 'listed as both reserved and contextual — a word is one or the other',
    });
  }

  // Does the compiler still spell each one? A rename would otherwise leave a
  // rule painting a word the language no longer knows.
  const sources = `${text.parser}\n${text.semantic}\n${text.expression}`;
  const unspelled = contextual.filter((word) => !sources.includes(`"${word}"`));
  if (unspelled.length > 0) {
    findings.push({
      what: 'contextual keywords',
      source: `${SOURCES.parser}, ${SOURCES.semantic}, ${SOURCES.expression}`,
      missing: [],
      extra: unspelled,
      note: 'shared/language.json highlights these but the compiler never names them',
    });
  }

  // The other direction, and the one that went unwatched: a lowercase word the
  // parser tests for that is neither reserved, nor contextual, nor written off
  // as a look-alike. Every one of those is a keyword with no highlighting.
  const known = new Set([...reserved, ...contextual, ...data.notKeywords.names]);
  const unknown = comparedStrings(text.parser)
    .filter((word) => /^[a-z][a-z0-9_]*$/.test(word))
    .filter((word) => !known.has(word));
  if (unknown.length > 0) {
    findings.push({
      what: 'contextual keywords',
      source: `${SOURCES.parser} — the words it compares against`,
      missing: unknown,
      extra: [],
      note: 'the parser treats these specially and shared/language.json has never heard of them — add each to contextualKeywords (with a recognizedWhen entry) or to notKeywords',
    });
  }

  // Every one needs its rule written down, or the next person to touch a
  // generator has nothing to check a pattern against.
  const undocumented = contextual.filter(
    (word) => !(word in data.contextualKeywords.recognizedWhen),
  );
  if (undocumented.length > 0) {
    findings.push({
      what: 'contextual keywords',
      source: 'shared/language.json',
      missing: undocumented,
      extra: [],
      note: 'no recognizedWhen entry — record the exact shape the parser tests for',
    });
  }
}

// ---- builtin type names -----------------------------------------------------
// The compiler holds no single table of these — `resolve.b` tests a long chain
// of names and the checker knows more — so this is a spelling check rather than
// a set comparison: a name the editors paint as a builtin has to be one the
// compiler still names.
if (text.resolve !== undefined && text.semantic !== undefined) {
  const sources = `${text.resolve}\n${text.semantic}`;
  const unknown = builtinTypeNames(data).filter((name) => !sources.includes(`"${name}"`));
  if (unknown.length > 0) {
    findings.push({
      what: 'builtin types',
      source: `${SOURCES.resolve}, ${SOURCES.semantic}`,
      missing: [],
      extra: unknown,
      note: 'painted as builtin types but the compiler never names them',
    });
  }
}

// ---- LSP methods ------------------------------------------------------------
// src/lsp_server.b — the dispatch chain. Every method the server answers should
// be reflected in the documented capability list.
if (text.lspServer !== undefined) {
  // Which advertised capability each dispatched method belongs to. A method the
  // server answers that is not in this map is a new feature, and the editors'
  // documentation and feature matrix need updating.
  const METHOD_TO_CAPABILITY = {
    'textDocument/didOpen': 'textDocumentSync',
    'textDocument/didChange': 'textDocumentSync',
    'textDocument/didClose': 'textDocumentSync',
    'textDocument/didSave': 'textDocumentSync',
    'textDocument/hover': 'hoverProvider',
    'textDocument/signatureHelp': 'signatureHelpProvider',
    'textDocument/completion': 'completionProvider',
    'textDocument/definition': 'definitionProvider',
    'textDocument/declaration': 'declarationProvider',
    'textDocument/typeDefinition': 'typeDefinitionProvider',
    'textDocument/implementation': 'implementationProvider',
    'textDocument/references': 'referencesProvider',
    'textDocument/documentHighlight': 'documentHighlightProvider',
    'textDocument/documentSymbol': 'documentSymbolProvider',
    'textDocument/semanticTokens/full': 'semanticTokensProvider',
    'textDocument/prepareCallHierarchy': 'callHierarchyProvider',
    'textDocument/prepareTypeHierarchy': 'typeHierarchyProvider',
    'textDocument/prepareRename': 'renameProvider',
    'textDocument/rename': 'renameProvider',
  };

  const dispatched = [
    ...new Set(
      [...text.lspServer.matchAll(/method == "(textDocument\/[A-Za-z/]+)"/g)].map((m) => m[1]),
    ),
  ];
  const unknown = dispatched.filter((method) => !(method in METHOD_TO_CAPABILITY));
  if (unknown.length > 0) {
    findings.push({
      what: 'LSP methods',
      source: `${SOURCES.lspServer} — dispatch()`,
      missing: unknown,
      extra: [],
      note: 'the server answers these but the editors do not know about them yet — update the capability list and the feature matrix',
    });
  }

  const documented = new Set(data.languageServer.capabilities.map((c) => c.split(' ')[0]));
  const served = new Set(dispatched.map((m) => METHOD_TO_CAPABILITY[m]).filter(Boolean));
  const unserved = [...served].filter((capability) => !documented.has(capability));
  if (unserved.length > 0) {
    findings.push({
      what: 'LSP capabilities',
      source: `${SOURCES.lspServer} — dispatch()`,
      missing: unserved,
      extra: [],
      note: 'the server dispatches these but shared/language.json does not list them',
    });
  }
}

// ---- semantic token legend --------------------------------------------------
// Editors negotiate the legend at initialize and must never hardcode it, but
// they do ship a style mapping per name — so a name the server sends that the
// editors have never seen renders unstyled.
if (text.lspServer !== undefined) {
  const legend = (field) => {
    const at = text.lspServer.indexOf(`"${field}"`);
    if (at === -1) return null;
    const rest = text.lspServer.slice(at);
    const array = /lsp_array\(\[([\s\S]*?)\]\)\)/.exec(rest);
    if (array === null) return null;
    return [...array[1].matchAll(/lsp_quote\("([^"]+)"\)/g)].map((m) => m[1]);
  };

  const types = legend('tokenTypes');
  if (types === null) {
    findings.push({
      what: 'semantic token legend',
      source: SOURCES.lspServer,
      error: 'could not find the tokenTypes array',
    });
  } else {
    compare(
      'semantic token legend',
      `${SOURCES.lspServer} — lsp_capabilities()`,
      types,
      data.languageServer.semanticTokens.selfHosted.types,
    );
    const uncovered = types.filter((t) => !data.languageServer.semanticTokens.all.includes(t));
    if (uncovered.length > 0) {
      findings.push({
        what: 'semantic token union',
        source: 'shared/language.json',
        missing: uncovered,
        extra: [],
        note: 'languageServer.semanticTokens.all must cover every type the server can send',
      });
    }
  }

  const modifiers = legend('tokenModifiers') ?? [];
  compare(
    'semantic token modifiers',
    `${SOURCES.lspServer} — lsp_capabilities()`,
    modifiers,
    data.languageServer.semanticTokens.modifiers,
    'a modifier the server sends that the editors do not declare cannot be themed',
  );
}

// ---- report -----------------------------------------------------------------
if (asJson) {
  console.log(JSON.stringify({ beansRoot, findings }, null, 2));
} else if (findings.length === 0) {
  console.log(`sync: shared/language.json matches ${beansRoot}`);
} else {
  console.error(`sync: ${findings.length} drift finding(s) against ${beansRoot}\n`);
  for (const finding of findings) {
    console.error(`  ${finding.what}`);
    console.error(`    source: ${finding.source}`);
    if (finding.error !== undefined) console.error(`    error: ${finding.error}`);
    if (finding.missing?.length) {
      console.error(`    in the compiler, missing here: ${finding.missing.join(', ')}`);
    }
    if (finding.extra?.length) {
      console.error(`    here, not in the compiler:     ${finding.extra.join(', ')}`);
    }
    if (finding.note !== undefined) console.error(`    note: ${finding.note}`);
    console.error('');
  }
  console.error('Update editors/shared/language.json, then run `npm run generate`.');
}

process.exit(findings.length === 0 ? 0 : 1);
