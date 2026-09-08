// latte's `.bx` vocabulary, and where a cursor sits in one.
//
// This module deliberately imports nothing from `vscode`, the same way
// `src/beansc.ts` does: the scanner below is the part that can be wrong in
// interesting ways — a `<div>` inside a `<script>`, a tag broken over four
// lines, a `{...}` hole with braces of its own, a `}` that closes a `$for` —
// and all of that is testable with a plain `node --test` run instead of only
// inside a running editor.
//
// The tables come from `bx-data.ts`, which latte prints out of its own tables.
// Nothing here restates them.
//
// **A latte `.bx` file is a markup document, not Beans with tags in it.** That
// is the whole difference from what this file used to scan. Outside the
// `<beans>` block a `<` *always* opens a tag — `parse.b` refuses one that does
// not, by name — and the text around it is markup rather than Beans. So the
// scanner starts in markup and enters Beans only where latte puts it: the
// `<beans>` block, a `$` block's header, a `{ }` attribute value and the
// `$( )` / `${ }` forms.

import { BX, type BxRow, type BxEvent } from './bx-data';

// One import site for the vocabulary: everything that needs it goes through
// here, so `bx-data.ts` being generated is a fact only this file has to know.
export { BX };
export type { BxRow, BxEvent };

export const BX_LANGUAGE_ID = 'beans-bx';

// ---------------------------------------------------------------------------
// The tables, indexed
// ---------------------------------------------------------------------------

export const EVENTS = new Map<string, BxEvent>(BX.events.map((e) => [e.event, e]));
export const BLOCKS = new Map<string, BxRow>(BX.blocks.map((b) => [b.name, b]));
export const INTERPOLATIONS = new Map<string, BxRow>(
  BX.interpolations.map((r) => [r.name, r]),
);
export const NAMESPACES = new Map<string, BxRow>(BX.namespaces.map((r) => [r.name, r]));
export const BINDINGS = new Map<string, BxRow>(BX.bindings.map((r) => [r.name, r]));
export const RESERVED = new Map<string, BxRow>(
  BX.reservedAttributes.map((r) => [r.name, r]),
);
export const VOID_ELEMENTS = new Set(BX.voidElements);
export const RAW_TEXT_ELEMENTS = new Set(BX.rawTextElements);
export const RCDATA_ELEMENTS = new Set(BX.rcdataElements);
export const NEWLINE_EATING_ELEMENTS = new Set(BX.newlineEatingElements);
export const BOOLEAN_ATTRIBUTES = new Set(BX.booleanAttributes);
export const URL_ATTRIBUTES = new Set(BX.urlAttributes);

/** `<beans>` is latte's own element, not one of HTML's (`parse_beans`). */
export const BEANS_BLOCK = 'beans';

/**
 * Whether a tag names a component rather than an HTML element.
 *
 * `names_a_component` in latte's html.b: the last dotted segment decides, so
 * `Hint` and `ui.Button` are components and `div` and `my-widget` are not.
 * There is no component registry — the compiler emits the name and beansc
 * resolves it — which is why this is a spelling rule and not a lookup.
 */
export function namesAComponent(tag: string): boolean {
  const parts = tag.split('.');
  const last = parts[parts.length - 1] as string;
  return last.length > 0 && /[A-Z]/.test(last[0] as string);
}

/**
 * The `bind:` target and conversion in a partly-typed attribute name.
 *
 * `bind:value.int` is target `value` and conversion `int`; `bind:checked` is
 * target `checked` and no conversion. Only `bind:value` takes one, which is
 * the vocabulary's own rule (`bind:checked` "takes no conversion") and is why
 * this answers the pieces rather than a boolean.
 */
export function bindingOf(
  prefix: string,
): { target: string; conversion: string } | undefined {
  if (!prefix.startsWith('bind:')) return undefined;
  const rest = prefix.slice('bind:'.length);
  const dot = rest.indexOf('.');
  if (dot === -1) return { target: rest, conversion: '' };
  return { target: rest.slice(0, dot), conversion: rest.slice(dot + 1) };
}

// ---------------------------------------------------------------------------
// Beans inside a markup file: finding where a copied-through construct ends
// ---------------------------------------------------------------------------
//
// latte copies Beans through verbatim — a header, an attribute expression, a
// `${}` block — and to copy it it has to know where it ends. That means
// knowing what a brace means, and a brace means four different things: in
// ordinary code it opens a block; inside a string it is a byte, unless it is
// `{`, which opens an interpolation; inside a *raw* string nothing is an
// escape and nothing opens an interpolation, so `r"/users/{id}"` is four
// unremarkable bytes; and inside a comment nothing is anything.
//
// crema's driver walked strings with a simpler rule and mis-scanned a raw
// literal. These four functions mirror `end_of_comment`, `end_of_raw_string`,
// `end_of_string` and `end_of_group` in latte's lex.b, which is the only
// reason a `{` in an attribute expression is found in the same place by the
// editor and by the compiler.

function isIdentByte(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

function isIdentStart(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z_]/.test(ch);
}

/** Just past the line or block comment at `at`, or `at`. Block comments nest. */
export function endOfComment(text: string, at: number): number {
  if (text[at] !== '/') return at;
  const second = text[at + 1];
  if (second === '/') {
    const nl = text.indexOf('\n', at + 2);
    return nl === -1 ? text.length : nl;
  }
  if (second !== '*') return at;
  let depth = 1;
  let i = at + 2;
  while (i < text.length && depth > 0) {
    if (text[i] === '/' && text[i + 1] === '*') {
      depth += 1;
      i += 2;
    } else if (text[i] === '*' && text[i + 1] === '/') {
      depth -= 1;
      i += 2;
    } else {
      i += 1;
    }
  }
  return i;
}

/** Just past the raw string at `at`, or `at`. `r"…"`, `r#"…"#`, and deeper. */
export function endOfRawString(text: string, at: number): number {
  if (text[at] !== 'r') return at;
  if (isIdentByte(text[at - 1])) return at;
  let hashes = 0;
  let i = at + 1;
  while (text[i] === '#') {
    hashes += 1;
    i += 1;
  }
  if (text[i] !== '"') return at;
  i += 1;
  while (i < text.length) {
    if (text[i] !== '"') {
      i += 1;
      continue;
    }
    let seen = 0;
    while (seen < hashes && text[i + 1 + seen] === '#') seen += 1;
    if (seen === hashes) return i + 1 + hashes;
    i += 1;
  }
  return text.length;
}

/** Just past the `"…"` string at `at`, or `at`. `{}` inside one interpolates. */
export function endOfString(text: string, at: number): number {
  if (text[at] !== '"') return at;
  const stack: number[] = [1]; // 1 = in a string, 2 = in an interpolation
  let i = at + 1;
  while (i < text.length) {
    if (stack.length === 0) return i;
    const mode = stack[stack.length - 1] as number;
    const ch = text[i] as string;
    if (mode === 1) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '"') {
        i += 1;
        stack.pop();
        continue;
      }
      if (ch === '{') {
        i += 1;
        stack.push(2);
        continue;
      }
      i += 1;
      continue;
    }
    const pastComment = endOfComment(text, i);
    if (pastComment > i) {
      i = pastComment;
      continue;
    }
    const pastRaw = endOfRawString(text, i);
    if (pastRaw > i) {
      i = pastRaw;
      continue;
    }
    if (ch === '"') {
      i += 1;
      stack.push(1);
      continue;
    }
    if (ch === '{') {
      i += 1;
      stack.push(2);
      continue;
    }
    if (ch === '}') {
      i += 1;
      stack.pop();
      continue;
    }
    i += 1;
  }
  return stack.length === 0 ? i : text.length;
}

function skipBeansNoise(text: string, at: number): number {
  const pastComment = endOfComment(text, at);
  if (pastComment > at) return pastComment;
  const pastRaw = endOfRawString(text, at);
  if (pastRaw > at) return pastRaw;
  return endOfString(text, at);
}

/**
 * Just past the balanced group whose opening `(`, `[` or `{` is at `from`, or
 * `text.length` when it is never closed.
 *
 * latte answers -1 for an unclosed group and reports it; the editor has no one
 * to report to, so it treats the rest of the file as the group's inside, which
 * is what the cursor is in.
 */
export function endOfGroup(text: string, from: number): number {
  const opener = text[from];
  if (opener !== '(' && opener !== '[' && opener !== '{') return from;
  let depth = 0;
  let i = from;
  while (i < text.length) {
    const past = skipBeansNoise(text, i);
    if (past > i) {
      i = past;
      continue;
    }
    const ch = text[i] as string;
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      i += 1;
      if (depth <= 0) return i;
      continue;
    }
    i += 1;
  }
  return text.length;
}

/**
 * The offset of the `{` that ends a block header started at `from`, or -1.
 *
 * A header runs to the first `{` that is not inside parentheses, brackets or a
 * string, so the opening brace may sit on its own line and a closure in a
 * header is safe — its braces sit inside the call's parentheses.
 */
export function findHeaderBrace(text: string, from: number): number {
  let depth = 0;
  let i = from;
  while (i < text.length) {
    const past = skipBeansNoise(text, i);
    if (past > i) {
      i = past;
      continue;
    }
    const ch = text[i] as string;
    if (ch === '(' || ch === '[') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ')' || ch === ']') {
      depth -= 1;
      if (depth < 0) return -1;
      i += 1;
      continue;
    }
    if (ch === '{' && depth === 0) return i;
    i += 1;
  }
  return -1;
}

/**
 * Just past the implicit expression chain that starts at `at`.
 *
 * The chain continues through `.name`, `(args)` and `[i]` with no space
 * between, and stops at the first character that cannot continue it — so
 * `$user.name (active)` ends before the space.
 */
export function endOfChain(text: string, at: number): number {
  let i = at;
  while (isIdentByte(text[i])) i += 1;
  if (i === at) return at;
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === '.') {
      if (!isIdentStart(text[i + 1])) return i;
      i += 1;
      while (isIdentByte(text[i])) i += 1;
      continue;
    }
    if (ch === '(' || ch === '[') {
      const stop = endOfGroup(text, i);
      if (stop <= i) return i;
      i = stop;
      continue;
    }
    return i;
  }
  return i;
}

/**
 * Whether the `$` at `at` opens a transition.
 *
 * `dollar_starts_transition` in latte's lex.b: only when the next character
 * starts an identifier, or is `(` or `{`. So `$5.00`, `US$`, `$ 20` and a
 * trailing `$` are ordinary text needing no escape, and `$$` is the escape for
 * a literal `$` in front of a word.
 */
export function dollarStartsTransition(text: string, at: number): boolean {
  if (text[at] !== '$') return false;
  const next = text[at + 1];
  return next === '(' || next === '{' || isIdentStart(next);
}

// ---------------------------------------------------------------------------
// Where the cursor is
// ---------------------------------------------------------------------------

/**
 * What the cursor sits in, once the markup around it has been worked out.
 *
 * The three that carry an answer are `tag`, `attr` and `value`; `text` carries
 * one too, because a `$` at markup level is where the blocks are offered. The
 * rest exist so a caller can tell "nothing to say here" apart from "I do not
 * know where I am", which is the difference between an empty completion list
 * and a wrong one.
 */
export interface BxContext {
  /**
   * `tag`     — inside a tag's name, right after the `<`.
   * `attr`    — inside an open tag, between the name and its `>`.
   * `value`   — inside a quoted attribute value.
   * `text`    — markup text, where a `$` opens a block or an interpolation.
   * `expr`    — Beans: a `{ }` attribute value, a header, `$( )` or `${ }`.
   * `beans`   — inside the `<beans>` block, which is Beans and nothing else.
   * `raw`     — inside a `<script>` or `<style>` body.
   * `comment` — inside `<!-- ... -->`.
   * `none`    — anywhere else with nothing to offer, such as a `<!DOCTYPE>`.
   */
  kind: 'tag' | 'attr' | 'value' | 'text' | 'expr' | 'beans' | 'raw' | 'comment' | 'none';
  /**
   * For `tag`, `attr` and `value`, the tag the cursor is in; for `raw`, the
   * raw-text element; for `text`, the innermost element still open. `""` when
   * there is none, which at the top of a file is the usual answer.
   */
  tag: string;
  /** For `value`, the attribute whose value this is. */
  attr: string;
  /** The partial word before the cursor, for filtering and replacing. */
  prefix: string;
}

const TAG_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*/;
const CLOSE_TAG = /^<\/([A-Za-z_][A-Za-z0-9_.:-]*)?\s*>/;

function context(
  kind: BxContext['kind'],
  tag = '',
  attr = '',
  prefix = '',
): BxContext {
  return { kind, tag, attr, prefix };
}

/** The partial attribute, tag or `$` word immediately before `offset`. */
function wordBefore(text: string, offset: number): string {
  let start = offset;
  while (start > 0 && /[A-Za-z0-9_:.$/-]/.test(text[start - 1] as string)) start -= 1;
  return text.slice(start, offset);
}

/** Case-insensitive `indexOf`, which is how latte finds a raw element's closer. */
function indexOfInsensitive(text: string, needle: string, from: number): number {
  return text.toLowerCase().indexOf(needle.toLowerCase(), from);
}

interface Step {
  /** Set when the cursor was inside what this step consumed. */
  found?: BxContext;
  /** Where scanning continues when it was not. */
  next: number;
}

/**
 * The context at `offset`, from a single forward pass over the document.
 *
 * Scanning from the top rather than backwards from the cursor is what makes a
 * tag broken over several lines work, and it is what latte's own parser does.
 * Each construct is consumed whole; if the cursor fell inside one, that
 * construct answers and the pass stops there.
 */
export function bxContextAt(text: string, offset: number): BxContext {
  const open: string[] = [];
  let i = 0;

  while (i < offset) {
    const ch = text[i] as string;
    const next = text[i + 1];

    // `<!-- ... -->`. A markup comment is a note to the reader of the `.bx`
    // file and is not emitted, so nothing inside it is anything.
    if (ch === '<' && text.startsWith('<!--', i)) {
      const close = text.indexOf('-->', i + 4);
      const stop = close === -1 ? text.length : close + 3;
      if (offset < stop) return context('comment');
      i = stop;
      continue;
    }

    if (ch === '<' && next === '!') {
      const close = text.indexOf('>', i + 2);
      const stop = close === -1 ? text.length : close + 1;
      if (offset < stop) return context('none');
      i = stop;
      continue;
    }

    if (ch === '<' && next === '/') {
      const match = CLOSE_TAG.exec(text.slice(i));
      if (match === null) {
        i += 2;
        continue;
      }
      const name = match[1];
      if (name !== undefined) {
        const at = open.lastIndexOf(name);
        if (at !== -1) open.length = at;
      }
      i += match[0].length;
      continue;
    }

    if (ch === '<') {
      const match = TAG_NAME.exec(text.slice(i + 1));
      // A `<` that opens nothing. latte refuses it; the editor keeps scanning,
      // because a file being written is a file with an error in it.
      if (match === null) {
        i += 1;
        continue;
      }
      const tag = match[0];
      const nameEnd = i + 1 + tag.length;
      if (offset <= nameEnd) {
        return context('tag', '', '', text.slice(i + 1, offset));
      }
      // `<beans>` is raw text the way `<script>` is in HTML: nothing inside it
      // is markup and nothing inside it is scanned, so a `$`, a `<` or a brace
      // in there is just Beans.
      if (tag === BEANS_BLOCK) {
        const step = skipBeansBlock(text, nameEnd, offset);
        if (step.found !== undefined) return step.found;
        i = step.next;
        continue;
      }
      const step = scanTag(text, nameEnd, offset, tag);
      if (step.found !== undefined) return step.found;
      i = step.next;
      if (step.selfClosed || VOID_ELEMENTS.has(tag.toLowerCase())) continue;
      if (!namesAComponent(tag) && RAW_TEXT_ELEMENTS.has(tag.toLowerCase())) {
        const closer = `</${tag}>`;
        const close = indexOfInsensitive(text, closer, i);
        const body = close === -1 ? text.length : close;
        if (offset <= body) return context('raw', tag);
        i = body + closer.length;
        continue;
      }
      open.push(tag);
      continue;
    }

    // `\}` and `\{` are the only escapes markup text has. Every other
    // backslash is a backslash, so a Windows path survives running text.
    if (ch === '\\' && (next === '}' || next === '{')) {
      i += 2;
      continue;
    }

    if (ch === '$') {
      if (next === '$') {
        i += 2;
        continue;
      }
      if (dollarStartsTransition(text, i)) {
        const step = scanTransition(text, i, offset);
        if (step.found !== undefined) return step.found;
        i = step.next;
        continue;
      }
    }

    i += 1;
  }

  return context('text', open[open.length - 1] ?? '', '', wordBefore(text, offset));
}

/** `<beans> … </beans>`, whose body is copied through byte for byte. */
function skipBeansBlock(text: string, from: number, offset: number): Step {
  const open = text.indexOf('>', from);
  if (open === -1) return { found: context('beans', BEANS_BLOCK), next: text.length };
  const close = text.indexOf('</beans>', open + 1);
  if (offset <= (close === -1 ? text.length : close)) {
    return { found: context('beans', BEANS_BLOCK), next: text.length };
  }
  return { next: close + '</beans>'.length };
}

interface TagStep extends Step {
  selfClosed?: boolean;
}

/**
 * The inside of one open tag, from just past its name to its `>` or `/>`.
 *
 * The cursor can be in three places in here and they take three different
 * answers: on an attribute name (`attr`), inside a quoted value (`value`), and
 * inside a `{ }` value, which is Beans and therefore nobody's here to answer
 * (`expr`).
 */
function scanTag(text: string, from: number, offset: number, tag: string): TagStep {
  const attrContext = (attr: string): BxContext =>
    context('attr', tag, attr, wordBefore(text, offset));
  let attr = '';
  let i = from;

  while (i < text.length) {
    if (i >= offset) return { found: attrContext(attr), next: i };
    const ch = text[i] as string;

    if (ch === '>') return { next: i + 1, selfClosed: false };
    if (ch === '/' && text[i + 1] === '>') return { next: i + 2, selfClosed: true };
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '=') {
      i += 1;
      continue;
    }
    if (ch === '"') {
      // A literal attribute value: bytes, passed through. There is no `$` in
      // attribute position and no interpolation in a literal — `{}` delimits
      // an expression and `$` marks one, and a value is already delimited.
      const close = text.indexOf('"', i + 1);
      const stop = close === -1 ? text.length : close;
      if (offset <= stop) {
        return {
          found: context('value', tag, attr, text.slice(i + 1, offset)),
          next: stop,
        };
      }
      i = stop + 1;
      continue;
    }
    if (ch === '{') {
      const stop = endOfGroup(text, i);
      if (offset < stop) return { found: context('expr', tag, attr), next: stop };
      i = stop;
      attr = '';
      continue;
    }
    const match = TAG_NAME.exec(text.slice(i));
    if (match !== null) {
      if (offset <= i + match[0].length) return { found: attrContext(match[0]), next: i };
      attr = match[0];
      i += match[0].length;
      continue;
    }
    i += 1;
  }
  // The tag was never closed, so the cursor is still inside it.
  return { found: attrContext(attr), next: text.length };
}

/**
 * One `$...`, from the `$` to just past whatever it opens.
 *
 * A block's *header* is Beans and is consumed here; its *body* is markup and
 * is not — the `{` is stepped over and the main pass carries on, which is how
 * a `$if` body gets the same rules as the rest of the document.
 */
function scanTransition(text: string, at: number, offset: number): Step {
  const next = text[at + 1];

  if (next === '(' || next === '{') {
    const stop = endOfGroup(text, at + 1);
    if (offset < stop) return { found: context('expr'), next: stop };
    return { next: stop };
  }

  let wordEnd = at + 1;
  while (isIdentByte(text[wordEnd])) wordEnd += 1;
  const word = text.slice(at + 1, wordEnd);
  // The cursor is in the keyword itself: `$i|f`, `$|`. The prefix carries the
  // `$` so a completion can replace the whole thing.
  if (offset <= wordEnd) {
    return { found: context('text', '', '', text.slice(at, offset)), next: wordEnd };
  }

  if (word === 'if' || word === 'for' || word === 'match') {
    const brace = findHeaderBrace(text, wordEnd);
    if (brace === -1) {
      // No `{` at the header's own level: a broken header, and the rest of the
      // file is inside it as far as anyone can tell.
      return { found: context('expr'), next: text.length };
    }
    if (offset <= brace) return { found: context('expr'), next: brace };
    return { next: brace + 1 };
  }

  if (word === 'html') {
    let paren = wordEnd;
    while (/\s/.test(text[paren] ?? '')) paren += 1;
    if (text[paren] !== '(') return { next: wordEnd };
    const stop = endOfGroup(text, paren);
    if (offset < stop) return { found: context('expr'), next: stop };
    return { next: stop };
  }

  if (word === 'slot') {
    let i = wordEnd;
    if (text[i] === ':') {
      i += 1;
      while (isIdentByte(text[i])) i += 1;
    }
    if (text[i] === '(') {
      const stop = endOfGroup(text, i);
      if (offset < stop) return { found: context('expr'), next: stop };
      return { next: stop };
    }
    if (offset <= i) return { found: context('text', '', '', text.slice(at, offset)), next: i };
    return { next: i };
  }

  // An implicit chain: `$self.count`, `$row.title`, `$self.rows[0]`.
  const stop = endOfChain(text, at + 1);
  if (offset < stop) return { found: context('expr'), next: stop };
  return { next: Math.max(stop, at + 1) };
}
