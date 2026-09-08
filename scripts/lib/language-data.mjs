// Loads editors/shared/language.json — the one place editor-side Beans
// language facts are written down — and exposes the derived lists the
// generators need.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** Repository root: editors/ */
export const editorsRoot = resolve(here, '..', '..');

export const sharedPath = join(editorsRoot, 'shared', 'language.json');

/**
 * The `.bx` markup vocabulary — latte's blocks, interpolations, attribute
 * namespaces, DOM events, bindings and HTML tables.
 *
 * Unlike language.json this one is *not* hand-maintained. latte prints it out
 * of its own tables and this file is that string, byte for byte:
 *
 *     cd community-libs/latte
 *     beansc build examples/latte_bx.b -o build/latte-bx
 *     build/latte-bx vocabulary > editors/shared/bx.json
 *     cd editors && npm run generate
 *
 * `latte-bx vocabulary` prints `bx/vocabulary.b`'s `vocabulary_json()`, latte's
 * suite `tests/w2_editor_data.b` has the same string as its golden, and
 * `tests/markup.b` asks `html.b`'s predicates about every name in it. So the
 * JSON cannot drift from the compiler without failing latte's own gate — which
 * is the only reason the editor is allowed to trust it. A hand-written
 * vocabulary would make this gate green about a lie.
 */
export const bxPath = join(editorsRoot, 'shared', 'bx.json');

/**
 * The shape `shared/bx.json` must have, and the only place it is written down.
 *
 * One list drives three things — the check below, the `BxVocabulary` interface
 * `generate.mjs` emits, and the object it emits — so a table cannot be
 * half-added: validated but not typed, or typed but not copied through.
 *
 * **Why this exists at all.** `buildBxData` used to destructure the keys it
 * wanted and hand them to `JSON.stringify`, which silently drops every
 * `undefined`. A `bx.json` of the wrong shape therefore produced a
 * `bx-data.ts` with most of its tables *gone*, and passed both `npm run
 * generate` and the drift gate on the way. The 21 errors `tsc` then reported
 * every one named a field and not one of them named a missing table.
 *
 * `rows`   — `{name, detail, note}`, the shape `VocabRow` prints.
 * `events` — `{event, family, method}`, out of latte's `events.b`.
 * `names`  — a flat list of names.
 */
export const BX_SCHEMA = {
  blocks: 'rows',
  interpolations: 'rows',
  namespaces: 'rows',
  events: 'events',
  bindings: 'rows',
  conversions: 'names',
  reservedAttributes: 'rows',
  voidElements: 'names',
  rawTextElements: 'names',
  rcdataElements: 'names',
  newlineEatingElements: 'names',
  booleanAttributes: 'names',
  urlAttributes: 'names',
  allowedSchemes: 'names',
};

/** The fields each row kind carries, in the order latte prints them. */
export const BX_ROW_FIELDS = {
  rows: ['name', 'detail', 'note'],
  events: ['event', 'family', 'method'],
};

/** The `$`-prefixed provenance keys latte writes at the top of the file. */
const BX_PROVENANCE = ['$generated', '$source', '$language'];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Everything wrong with `data` as a `bx.json`, as a list of sentences.
 *
 * It reports *every* fault rather than the first, because the failure this
 * guards against arrives as a whole vocabulary of the wrong shape and a reader
 * who fixes one key at a time learns nothing about the other thirteen.
 */
export function bxProblems(data) {
  const problems = [];
  if (!isPlainObject(data)) {
    return ['the file does not hold a JSON object'];
  }

  for (const key of BX_PROVENANCE) {
    if (typeof data[key] !== 'string' || data[key] === '') {
      problems.push(`${key} is missing or not a non-empty string`);
    }
  }

  for (const [key, kind] of Object.entries(BX_SCHEMA)) {
    const value = data[key];
    if (value === undefined) {
      problems.push(`${key} is missing`);
      continue;
    }
    if (!Array.isArray(value)) {
      problems.push(`${key} is ${typeof value}, not an array`);
      continue;
    }
    // An empty table is the shape a dropped one arrives in, and every list
    // here is a closed language fact that a working latte cannot empty.
    if (value.length === 0) {
      problems.push(`${key} is empty`);
      continue;
    }
    if (kind === 'names') {
      value.forEach((entry, i) => {
        if (typeof entry !== 'string' || entry === '') {
          problems.push(`${key}[${i}] is not a non-empty string`);
        }
      });
      continue;
    }
    const fields = BX_ROW_FIELDS[kind];
    value.forEach((entry, i) => {
      if (!isPlainObject(entry)) {
        problems.push(`${key}[${i}] is not an object`);
        return;
      }
      for (const field of fields) {
        if (typeof entry[field] !== 'string') {
          problems.push(`${key}[${i}].${field} is missing or not a string`);
        }
      }
      if (typeof entry[fields[0]] === 'string' && entry[fields[0]] === '') {
        problems.push(`${key}[${i}].${fields[0]} is empty`);
      }
      for (const field of Object.keys(entry)) {
        if (!fields.includes(field)) {
          problems.push(
            `${key}[${i}] carries ${field}, which the editor has never heard of`,
          );
        }
      }
    });
  }

  // A key latte grew and the editor has not: the exact drift the old
  // destructure hid, arriving from the other side.
  for (const key of Object.keys(data)) {
    if (BX_PROVENANCE.includes(key)) continue;
    if (key in BX_SCHEMA) continue;
    problems.push(`${key} is a table the editor has never heard of`);
  }

  return problems;
}

export function loadLanguageData(path = sharedPath) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * `shared/bx.json`, refused unless it has the shape above.
 *
 * Every reader goes through here — `generate.mjs` for both the write and the
 * `--check` run — so there is no path by which a wrong-shaped vocabulary
 * reaches a generated file. It throws rather than returning a partial object:
 * a vocabulary missing half its tables is not something to carry on with.
 */
export function loadBxData(path = bxPath) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new Error(`${path} could not be read as JSON: ${cause.message}`);
  }
  const problems = bxProblems(data);
  if (problems.length > 0) {
    throw new Error(
      `${path} is not a latte .bx vocabulary:\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\n\nRegenerate it, do not edit it by hand:\n' +
        '  cd community-libs/latte && build/latte-bx vocabulary > editors/shared/bx.json\n' +
        'A table latte grew is added to BX_SCHEMA in scripts/lib/language-data.mjs,\n' +
        'which is what types it and what copies it into vscode/src/bx-data.ts.',
    );
  }
  return data;
}

/** Every reserved keyword, sorted longest-first so alternations match greedily. */
export function keywordsLongestFirst(data) {
  return [...data.keywords.reserved].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/** All contextual keywords in one flat list. */
export function contextualKeywords(data) {
  const c = data.contextualKeywords;
  return [
    ...c.modifiers, ...c.variables, ...c.typeOperators,
    ...c.declarations, ...c.expressionOperators,
  ];
}

/** Every builtin type name (primitives excluded). */
export function builtinTypeNames(data) {
  const t = data.types;
  return [...t.genericClasses, ...t.builtinClasses, ...t.builtinEnums];
}

/**
 * Every operator spelling, longest first. Tree-sitter and TextMate both need
 * longest-match order or `<` would shadow `<<` and `<=`.
 */
export function operatorsLongestFirst(data) {
  const o = data.operators;
  const all = [
    ...o.assignment, ...o.comparison, ...o.logical, ...o.arithmetic,
    ...o.bitwise, ...o.range, ...o.arrow,
  ];
  return [...new Set(all)].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/** Escape a string for use inside a regular expression. */
export function reEscape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A `\b`-anchored alternation over a word list. */
export function wordAlternation(words) {
  return `\\b(?:${[...words].sort((a, b) => b.length - a.length || a.localeCompare(b)).map(reEscape).join('|')})\\b`;
}

export const GENERATED_BANNER =
  'Generated by editors/scripts/generate.mjs from editors/shared/language.json. Do not edit by hand.';

/**
 * The banner for the two outputs built from `shared/bx.json` instead.
 *
 * A separate string rather than a vaguer one covering both, because a reader
 * who finds a stale generated file needs to know which input to regenerate,
 * and the two have different sources of truth: language.json is hand-kept and
 * checked against the compiler by sync-beans.mjs, bx.json is printed by latte.
 */
export const BX_GENERATED_BANNER =
  'Generated by editors/scripts/generate.mjs from editors/shared/bx.json. Do not edit by hand.';
