#!/usr/bin/env node
// Proves editors/shared/language.json still matches the compiler.
//
//   node scripts/sync-beans.mjs [--beans <path>] [--json]
//
// The compiler owns the language. Everything in shared/language.json is a copy
// of something in the beans repository, and a copy rots. This reads the real
// sources — the keyword table, the builtin registry, the LSP server's
// capabilities and both semantic-token legends — and reports any drift.
//
// It never writes to the beans repository, and it exits 0 with a skip message
// when no checkout is available, so it is safe to wire into CI unconditionally.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { editorsRoot, loadLanguageData } from './lib/language-data.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};

const beansRoot = resolve(
  argValue('--beans') ?? process.env.BEANS_ROOT ?? join(editorsRoot, '..', 'beans'),
);

const read = (relative) => {
  const path = join(beansRoot, relative);
  if (!existsSync(path)) throw new Error(`missing ${relative} under ${beansRoot}`);
  return readFileSync(path, 'utf8');
};

if (!existsSync(join(beansRoot, 'compiler', 'bootstrap', 'token.cpp'))) {
  console.log(`skip: no beans checkout at ${beansRoot}`);
  console.log('Pass --beans <path> or set BEANS_ROOT to check for drift.');
  process.exit(0);
}

const data = loadLanguageData();
const findings = [];

const compare = (what, source, expected, actual) => {
  const missing = expected.filter((x) => !actual.includes(x));
  const extra = actual.filter((x) => !expected.includes(x));
  if (missing.length === 0 && extra.length === 0) return;
  findings.push({
    what,
    source,
    // "missing" = in the compiler but not in shared/language.json.
    missing,
    extra,
  });
};

// ---- reserved keywords ------------------------------------------------------
// beans/compiler/bootstrap/token.cpp — the `keyword_or_ident` lookup table.
{
  const text = read('compiler/bootstrap/token.cpp');
  const table = /TokenKind keyword_or_ident[\s\S]*?static const Entry table\[\] = \{([\s\S]*?)\};/.exec(
    text,
  );
  if (table === null) {
    findings.push({
      what: 'reserved keywords',
      source: 'compiler/bootstrap/token.cpp',
      error: 'could not find the keyword table — the compiler layout changed',
    });
  } else {
    const keywords = [...table[1].matchAll(/\{"([^"]+)",/g)].map((m) => m[1]);
    compare(
      'reserved keywords',
      'compiler/bootstrap/token.cpp — keyword_or_ident()',
      keywords,
      data.keywords.reserved,
    );
  }
}

// ---- builtin generic classes ------------------------------------------------
// beans/compiler/bootstrap/checker.cpp — Checker::register_builtins.
{
  const text = read('compiler/bootstrap/checker.cpp');
  const set = /builtin_generic_classes_\s*=\s*\{([\s\S]*?)\};/.exec(text);
  if (set === null) {
    findings.push({
      what: 'builtin generic classes',
      source: 'compiler/bootstrap/checker.cpp',
      error: 'could not find builtin_generic_classes_',
    });
  } else {
    const names = [...set[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    compare(
      'builtin generic classes',
      'compiler/bootstrap/checker.cpp — register_builtins()',
      names,
      data.types.genericClasses,
    );
  }
}

// ---- LSP methods ------------------------------------------------------------
// beans/compiler/bootstrap/lspserver.cpp — the dispatch table. Every method the
// server answers should be reflected in the documented capability list.
{
  // Which advertised capability each dispatched method belongs to. A method
  // the server answers that is not in this map is a new feature, and the
  // editors' documentation and feature matrix need updating.
  const METHOD_TO_CAPABILITY = {
    'textDocument/didOpen': 'textDocumentSync',
    'textDocument/didChange': 'textDocumentSync',
    'textDocument/didClose': 'textDocumentSync',
    'textDocument/hover': 'hoverProvider',
    'textDocument/signatureHelp': 'signatureHelpProvider',
    'textDocument/completion': 'completionProvider',
    'textDocument/definition': 'definitionProvider',
    'textDocument/references': 'referencesProvider',
    'textDocument/documentSymbol': 'documentSymbolProvider',
    'textDocument/semanticTokens/full': 'semanticTokensProvider',
    'textDocument/prepareRename': 'renameProvider',
    'textDocument/rename': 'renameProvider',
  };

  const text = read('compiler/bootstrap/lspserver.cpp');
  const dispatched = [
    ...new Set([...text.matchAll(/method == "(textDocument\/[A-Za-z/]+)"/g)].map((m) => m[1])),
  ];

  const unknown = dispatched.filter((method) => !(method in METHOD_TO_CAPABILITY));
  if (unknown.length > 0) {
    findings.push({
      what: 'LSP methods',
      source: 'compiler/bootstrap/lspserver.cpp — dispatch()',
      missing: unknown,
      extra: [],
      note: 'the server answers these but the editors do not know about them yet — update the capability list and the feature matrix',
    });
  }

  // The other direction: a capability we claim but the server no longer serves.
  const documented = data.languageServer.capabilities.map((c) => c.split(' ')[0]);
  const served = new Set(dispatched.map((m) => METHOD_TO_CAPABILITY[m]).filter(Boolean));
  const unserved = documented.filter((capability) => !served.has(capability));
  if (unserved.length > 0) {
    findings.push({
      what: 'LSP capabilities',
      source: 'compiler/bootstrap/lspserver.cpp — dispatch()',
      missing: [],
      extra: unserved,
      note: 'shared/language.json claims these but the server dispatches no method for them',
    });
  }
}

// ---- semantic token legends -------------------------------------------------
// The two implementations advertise different legends today, so both are
// recorded and both are checked.
{
  const text = read('compiler/bootstrap/lsp.cpp');
  const legend = /semantic_token_types\(\)\s*\{[\s\S]*?static const std::vector<std::string> t = \{([\s\S]*?)\};/.exec(
    text,
  );
  if (legend === null) {
    findings.push({
      what: 'semantic token legend (bootstrap)',
      source: 'compiler/bootstrap/lsp.cpp',
      error: 'could not find semantic_token_types()',
    });
  } else {
    const types = [...legend[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    compare(
      'semantic token legend (bootstrap)',
      'compiler/bootstrap/lsp.cpp — semantic_token_types()',
      types,
      data.languageServer.semanticTokens.bootstrap.types,
    );
  }
}

{
  const text = read('compiler/beans/lsp.b');
  const legend = /"tokenTypes",\s*lsp_array\(\[([\s\S]*?)\]\)\)/.exec(text);
  if (legend === null) {
    findings.push({
      what: 'semantic token legend (self-hosted)',
      source: 'compiler/beans/lsp.b',
      error: 'could not find the tokenTypes array',
    });
  } else {
    const types = [...legend[1].matchAll(/lsp_quote\("([^"]+)"\)/g)].map((m) => m[1]);
    compare(
      'semantic token legend (self-hosted)',
      'compiler/beans/lsp.b — the initialize reply',
      types,
      data.languageServer.semanticTokens.selfHosted.types,
    );
  }
}

// The union must cover both, or an editor would receive a token type it has no
// style for.
{
  const all = data.languageServer.semanticTokens.all;
  const union = [
    ...new Set([
      ...data.languageServer.semanticTokens.bootstrap.types,
      ...data.languageServer.semanticTokens.selfHosted.types,
    ]),
  ];
  const uncovered = union.filter((t) => !all.includes(t));
  if (uncovered.length > 0) {
    findings.push({
      what: 'semantic token union',
      source: 'shared/language.json',
      missing: uncovered,
      extra: [],
      note: 'languageServer.semanticTokens.all must cover every implementation',
    });
  }
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
