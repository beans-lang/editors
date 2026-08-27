// The `bx` markup vocabulary, and where a cursor sits in it.
//
// This module deliberately imports nothing from `vscode`, the same way
// `src/beansc.ts` does: the scanner below is the part that can be wrong in
// interesting ways — a `<div>` inside a string, a tag broken over four lines,
// a `{...}` hole with braces of its own — and all of that is testable with a
// plain `node --test` run instead of only inside a running editor.
//
// The tables come from `bx-data.ts`, which is printed out of bx's own tables
// in crema. Nothing here restates them.

import { BX, type BxTag } from './bx-data';

// One import site for the vocabulary: everything that needs it goes through
// here, so `bx-data.ts` being generated is a fact only this file has to know.
export { BX };

export const BX_LANGUAGE_ID = 'beans-bx';

// ---------------------------------------------------------------------------
// Where the cursor is
// ---------------------------------------------------------------------------

/** What the cursor sits in, once the tags around it have been worked out. */
export interface BxContext {
  /**
   * `tag` — inside a tag's name, right after the `<`.
   * `attr` — inside an open tag, between the name and its `>`.
   * `value` — inside a quoted attribute value.
   * `none` — ordinary Beans, including inside a `{...}` hole.
   */
  kind: 'tag' | 'attr' | 'value' | 'none';
  /** The enclosing tag's name, or "" when it is not known yet. */
  tag: string;
  /** For `value`, the attribute whose value this is. */
  attr: string;
  /** The partial word before the cursor, for filtering and replacing. */
  prefix: string;
}

const NONE: BxContext = { kind: 'none', tag: '', attr: '', prefix: '' };

/** A byte that may not sit immediately before a tag's `<` (bx/compile.b). */
function endsAName(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_)\]]/.test(ch);
}

function startsAName(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z_]/.test(ch);
}

interface Frame {
  kind: 'code' | 'tag';
  /** For `tag`, the tag's name. */
  tag: string;
  /** For `code`, whether a `}` closes this frame rather than being stray. */
  brace: boolean;
}

/**
 * The context at `offset`, from a single forward pass over the document.
 *
 * Scanning from the top rather than backwards from the cursor is what makes a
 * tag broken over several lines work, and it is what bx's own driver does. It
 * carries the same four states a `.bx` file can be in — code, string, line
 * comment, block comment — because a `<div>` inside a string or a comment is
 * not a tag, and offering attribute completions inside one would be a lie.
 */
export function bxContextAt(text: string, offset: number): BxContext {
  const stack: Frame[] = [{ kind: 'code', tag: '', brace: false }];
  const top = (): Frame => stack[stack.length - 1] as Frame;
  let attr = '';

  let i = 0;
  while (i < offset) {
    const frame = top();
    const ch = text[i] as string;
    const next = text[i + 1];

    // Comments, in both code and tags: bx skips them the same way.
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      if (offset <= stop) return NONE;
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < text.length && depth > 0) {
        if (text[j] === '/' && text[j + 1] === '*') {
          depth += 1;
          j += 2;
        } else if (text[j] === '*' && text[j + 1] === '/') {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      if (offset < j) return NONE;
      i = j;
      continue;
    }

    // A string ends at its quote or at the newline, which is where the
    // compiler ends one too.
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"' && text[j] !== '\n') {
        if (text[j] === '\\') j += 1;
        j += 1;
      }
      if (offset <= j) {
        // Inside the quotes. Only an attribute value is ours to answer.
        if (frame.kind === 'tag' && attr !== '') {
          return {
            kind: 'value',
            tag: frame.tag,
            attr,
            prefix: text.slice(i + 1, offset),
          };
        }
        return NONE;
      }
      i = j + 1;
      continue;
    }

    if (frame.kind === 'tag') {
      if (ch === '/' && next === '>') {
        stack.pop();
        attr = '';
        i += 2;
        continue;
      }
      if (ch === '>') {
        stack.pop();
        attr = '';
        i += 1;
        continue;
      }
      if (ch === '{') {
        // An embedded Beans expression. Its own braces balance inside it.
        stack.push({ kind: 'code', tag: '', brace: true });
        attr = '';
        i += 1;
        continue;
      }
      if (ch === '=') {
        i += 1;
        continue;
      }
      // An attribute name; remember it so its value knows what it belongs to.
      const name = /^[A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z0-9_-]+)?(?:[-/][A-Za-z0-9_./]+)*/
        .exec(text.slice(i));
      if (name !== null) {
        attr = name[0];
        i += name[0].length;
        continue;
      }
      i += 1;
      continue;
    }

    // Ordinary code.
    if (ch === '{') {
      stack.push({ kind: 'code', tag: '', brace: true });
      i += 1;
      continue;
    }
    if (ch === '}') {
      if (frame.brace && stack.length > 1) stack.pop();
      i += 1;
      continue;
    }
    if (ch === '<') {
      if (next === '/') {
        const close = /^<\/[A-Za-z_][A-Za-z0-9_]*\s*>/.exec(text.slice(i));
        i += close === null ? 1 : close[0].length;
        continue;
      }
      // The two rules that decide whether a `<` opens a tag, verbatim from
      // bx/compile.b: a name has to start after it, and nothing that ends a
      // name may sit before it.
      if (!startsAName(next) || endsAName(text[i - 1])) {
        i += 1;
        continue;
      }
      const open = /^<([A-Za-z_][A-Za-z0-9_]*)/.exec(text.slice(i)) as RegExpExecArray;
      const nameEnd = i + open[0].length;
      if (offset <= nameEnd) {
        return { kind: 'tag', tag: '', attr: '', prefix: text.slice(i + 1, offset) };
      }
      stack.push({ kind: 'tag', tag: open[1] as string, brace: false });
      attr = '';
      i = nameEnd;
      continue;
    }
    i += 1;
  }

  const frame = top();
  if (frame.kind === 'tag') {
    return { kind: 'attr', tag: frame.tag, attr: '', prefix: wordBefore(text, offset) };
  }
  return NONE;
}

/** The partial attribute or tag name immediately before `offset`. */
function wordBefore(text: string, offset: number): string {
  let start = offset;
  while (start > 0 && /[A-Za-z0-9_:/-]/.test(text[start - 1] as string)) start -= 1;
  return text.slice(start, offset);
}

// ---------------------------------------------------------------------------
// The tables, indexed
// ---------------------------------------------------------------------------

export const TAGS = new Map<string, BxTag>(BX.tags.map((t) => [t.name, t]));
export const RAMP_TABLE = new Map<string, string>(BX.ramps.map((r) => [r.family, r.table]));
export const TEXT_KIND = new Map<string, string>(BX.texts.map((t) => [t.attr, t.kind]));
export const VALUE_TAKES = new Map<string, string>(BX.values.map((v) => [v.attr, v.takes]));
export const COLOR_HEX = new Map<string, string>(BX.colors.map((c) => [c.name, c.hex]));
export const EVENTS = new Map(BX.events.map((e) => [e.event, e]));
export const FLAGS = new Set(BX.flags);
export const COUNTS = new Set(BX.counts);

/** The colour attributes: the ones whose quoted value names a colour. */
export const COLOR_KINDS = new Set(['fill', 'rgba', 'hsla', 'background']);

export function takesAColor(attr: string): boolean {
  const kind = TEXT_KIND.get(attr);
  return kind !== undefined && COLOR_KINDS.has(kind);
}

/**
 * The ramp family a partly-typed attribute belongs to, longest first.
 *
 * `m-neg-4` is family `m` and step `neg-4`, and `max-w-4` is family `max-w`
 * and step `4` — so the longest family that the text starts with is the right
 * one, and asking shortest-first would read `max-w-4` as `m` plus nonsense.
 */
export function rampFamilyOf(prefix: string): { family: string; table: string } | undefined {
  let best: { family: string; table: string } | undefined;
  for (const [family, table] of RAMP_TABLE) {
    if (!prefix.startsWith(`${family}-`)) continue;
    if (best === undefined || family.length > best.family.length) {
      best = { family, table };
    }
  }
  return best;
}

/** `#rrggbb` from bx's packed `rrggbbaa`, for a swatch. */
export function swatch(hex: string): string {
  return `#${hex.slice(0, 6)}`;
}
