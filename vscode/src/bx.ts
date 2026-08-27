// Markup intelligence for `.bx` files.
//
// A `.bx` file is a Beans file with tag expressions in it, and the two halves
// are answered by two different things. Everything outside a tag is Beans, and
// Beans is `beansc lsp`'s to answer — this file never touches it. Everything
// inside a tag is markup, which the compiler has never heard of: the vocabulary
// lives in `crema`'s `bx` package, and `src/bx-data.ts` is that vocabulary,
// printed out of bx's own tables rather than typed out again here.
//
// So the rule this file follows is the same one `src/client.ts` states for the
// language server: one engine per question. Tag names, attributes, ramp steps,
// events and colour names come from the tables; nothing else is offered.

import * as vscode from 'vscode';

import {
  BX,
  BX_LANGUAGE_ID,
  COLOR_HEX,
  COUNTS,
  EVENTS,
  FLAGS,
  RAMP_TABLE,
  TAGS,
  TEXT_KIND,
  VALUE_TAKES,
  bxContextAt,
  rampFamilyOf,
  swatch,
  takesAColor,
  type BxContext,
} from './bx-model';

export { BX_LANGUAGE_ID };

function colorOf(hex: string): vscode.Color {
  const channel = (at: number): number => parseInt(hex.slice(at, at + 2), 16) / 255;
  return new vscode.Color(channel(0), channel(2), channel(4), channel(6));
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

const RETRIGGER: vscode.Command = {
  command: 'editor.action.triggerSuggest',
  title: 'suggest the step',
};

function item(
  label: string,
  kind: vscode.CompletionItemKind,
  detail: string,
): vscode.CompletionItem {
  const entry = new vscode.CompletionItem(label, kind);
  entry.detail = detail;
  return entry;
}

class BxCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const context = bxContextAt(document.getText(), document.offsetAt(position));
    switch (context.kind) {
      case 'tag':
        return this.tags();
      case 'attr':
        return this.attributes(context);
      case 'value':
        return takesAColor(context.attr) ? this.colors() : [];
      default:
        return [];
    }
  }

  private tags(): vscode.CompletionItem[] {
    return BX.tags.map((tag) => {
      const entry = item(tag.name, vscode.CompletionItemKind.Class, tag.call);
      entry.documentation = new vscode.MarkdownString(
        tag.parent
          ? `Builds \`${tag.call}\`. Takes attributes and children.`
          : `Builds \`${tag.call}\`.${tag.note === '' ? '' : ` ${tag.note}.`}`,
      );
      return entry;
    });
  }

  private attributes(context: BxContext): vscode.CompletionItem[] {
    // Mid-way through `gap-`, the steps of that family are the answer and the
    // whole attribute surface is noise.
    const ramp = rampFamilyOf(context.prefix);
    if (ramp !== undefined) {
      const steps = BX.stepTables[ramp.table] ?? [];
      return steps.map((step) => {
        const entry = item(
          `${ramp.family}-${step}`,
          vscode.CompletionItemKind.EnumMember,
          `style.${ramp.table}.${step}`,
        );
        entry.filterText = `${ramp.family}-${step}`;
        return entry;
      });
    }
    if (context.prefix.startsWith('on:')) return this.events();

    const out: vscode.CompletionItem[] = [];
    for (const flag of BX.flags) {
      out.push(item(flag, vscode.CompletionItemKind.Property, `.${flag.replace(/-/g, '_')}()`));
    }
    for (const [family, table] of RAMP_TABLE) {
      const entry = item(
        `${family}-`,
        vscode.CompletionItemKind.Field,
        `a step from style.${table}`,
      );
      entry.command = RETRIGGER;
      entry.sortText = `1${family}`;
      out.push(entry);
    }
    for (const family of COUNTS) {
      const entry = new vscode.CompletionItem(
        `${family}-`,
        vscode.CompletionItemKind.Field,
      );
      entry.detail = 'a whole number';
      entry.insertText = new vscode.SnippetString(`${family}-\${1:1}`);
      entry.sortText = `1${family}`;
      out.push(entry);
    }
    for (const text of BX.texts) {
      const entry = new vscode.CompletionItem(text.attr, vscode.CompletionItemKind.Property);
      entry.detail = takesAColor(text.attr) ? `a colour name (${text.kind})` : text.kind;
      entry.insertText = new vscode.SnippetString(`${text.attr}="$1"`);
      if (takesAColor(text.attr)) entry.command = RETRIGGER;
      entry.sortText = `2${text.attr}`;
      out.push(entry);
    }
    for (const value of BX.values) {
      // A name already offered as a flag, a ramp or a string keeps that form;
      // `attr={code}` is the fallback for the rest.
      if (FLAGS.has(value.attr) || RAMP_TABLE.has(value.attr) ||
          COUNTS.has(value.attr) || TEXT_KIND.has(value.attr)) {
        continue;
      }
      const entry = new vscode.CompletionItem(value.attr, vscode.CompletionItemKind.Property);
      entry.detail = value.takes;
      entry.insertText = new vscode.SnippetString(`${value.attr}={$1}`);
      entry.sortText = `3${value.attr}`;
      out.push(entry);
    }
    out.push(...this.events());
    return out;
  }

  private events(): vscode.CompletionItem[] {
    return BX.events.map((event) => {
      const entry = new vscode.CompletionItem(
        `on:${event.event}`,
        vscode.CompletionItemKind.Event,
      );
      entry.detail = event.signature;
      entry.documentation = new vscode.MarkdownString(
        `Calls the handler with \`${event.payload}\`, the frame and the app.`,
      );
      entry.insertText = new vscode.SnippetString(
        `on:${event.event}={fn(e: ${event.payload}, frame: element.Frame, ` +
          `cx: app.App) { $0 }}`,
      );
      entry.sortText = `4${event.event}`;
      return entry;
    });
  }

  private colors(): vscode.CompletionItem[] {
    return BX.colors.map((color) => {
      const entry = new vscode.CompletionItem(color.name, vscode.CompletionItemKind.Color);
      // VS Code paints a swatch from the documentation when it reads as one.
      entry.documentation = swatch(color.hex);
      entry.detail = `#${color.hex}`;
      return entry;
    });
  }
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

class BxHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    const range = document.getWordRangeAtPosition(
      position,
      /[A-Za-z_][A-Za-z0-9_]*(?:[-/][A-Za-z0-9_./]+)*/,
    );
    if (range === undefined) return undefined;
    const word = document.getText(range);
    const text = document.getText();
    const context = bxContextAt(text, document.offsetAt(range.start));

    if (context.kind === 'tag' || isTagName(text, document.offsetAt(range.start))) {
      const tag = TAGS.get(word);
      if (tag === undefined) return undefined;
      return markdown(
        range,
        `\`<${tag.name}>\` builds \`${tag.call}\`.`,
        tag.parent ? 'Takes attributes and children.' : tag.note,
      );
    }
    if (context.kind === 'value') {
      const hex = COLOR_HEX.get(word);
      if (hex === undefined) return undefined;
      return markdown(range, `\`${word}\` is \`#${hex}\`.`, '');
    }
    if (context.kind !== 'attr') return undefined;
    return this.attributeHover(range, word);
  }

  private attributeHover(range: vscode.Range, word: string): vscode.Hover | undefined {
    if (word.startsWith('on:')) {
      const event = EVENTS.get(word.slice(3));
      if (event === undefined) return undefined;
      return markdown(
        range,
        `\`on:${event.event}\` takes \`${event.signature}\`.`,
        `The handler is called with \`${event.payload}\`.`,
      );
    }
    if (FLAGS.has(word)) {
      return markdown(range, `Calls \`.${word.replace(/-/g, '_')}()\`.`, '');
    }
    const ramp = rampFamilyOf(word);
    if (ramp !== undefined) {
      const step = word.slice(ramp.family.length + 1);
      const known = (BX.stepTables[ramp.table] ?? []).includes(step);
      return markdown(
        range,
        `Calls \`.${ramp.family.replace(/-/g, '_')}(style.${ramp.table}.${step})\`.`,
        known ? '' : `\`${step}\` is not a step of \`style.${ramp.table}\`.`,
      );
    }
    const kind = TEXT_KIND.get(word);
    if (kind !== undefined) {
      return markdown(
        range,
        `\`${word}="…"\` takes ${takesAColor(word) ? 'a colour name' : kind}.`,
        '',
      );
    }
    const takes = VALUE_TAKES.get(word);
    if (takes !== undefined) {
      return markdown(range, `\`${word}={…}\` takes \`${takes}\`.`, '');
    }
    return undefined;
  }
}

function markdown(range: vscode.Range, head: string, note: string): vscode.Hover {
  const body = new vscode.MarkdownString(note === '' ? head : `${head}\n\n${note}`);
  return new vscode.Hover(body, range);
}

/** Is the name at `offset` the name of a tag rather than an attribute? */
function isTagName(text: string, offset: number): boolean {
  return text[offset - 1] === '<' || text.slice(Math.max(0, offset - 2), offset) === '</';
}

// ---------------------------------------------------------------------------
// Colour swatches
// ---------------------------------------------------------------------------

/** `attr="value"` inside a tag, wherever it appears. */
const ATTRIBUTE_VALUE = /\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"\n]*)"/g;

/**
 * A swatch beside every colour a tag names, and a picker that writes the name
 * back when one exists for the colour chosen.
 */
class BxColorProvider implements vscode.DocumentColorProvider {
  provideDocumentColors(document: vscode.TextDocument): vscode.ColorInformation[] {
    const text = document.getText();
    const out: vscode.ColorInformation[] = [];
    for (const match of text.matchAll(ATTRIBUTE_VALUE)) {
      const attr = match[1] as string;
      const value = match[2] as string;
      if (!takesAColor(attr)) continue;
      const start = (match.index ?? 0) + match[0].length - value.length - 1;
      if (bxContextAt(text, start).kind !== 'value') continue;
      const hex = COLOR_HEX.get(value) ?? hexLiteral(value);
      if (hex === undefined) continue;
      out.push(
        new vscode.ColorInformation(
          new vscode.Range(
            document.positionAt(start),
            document.positionAt(start + value.length),
          ),
          colorOf(hex),
        ),
      );
    }
    return out;
  }

  provideColorPresentations(
    color: vscode.Color,
    context: { range: vscode.Range },
  ): vscode.ColorPresentation[] {
    const byte = (v: number): string =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, '0');
    const packed = `${byte(color.red)}${byte(color.green)}${byte(color.blue)}${byte(color.alpha)}`;
    const out: vscode.ColorPresentation[] = [];
    // A name, when the colour is exactly one bx knows: `bg="red"` reads better
    // than the hex, and it is what the table resolves at compile time anyway.
    for (const [name, hex] of COLOR_HEX) {
      if (hex === packed) {
        const named = new vscode.ColorPresentation(name);
        named.textEdit = new vscode.TextEdit(context.range, name);
        out.push(named);
        break;
      }
    }
    const literal = color.alpha >= 1 ? `#${packed.slice(0, 6)}` : `#${packed}`;
    const hex = new vscode.ColorPresentation(literal);
    hex.textEdit = new vscode.TextEdit(context.range, literal);
    out.push(hex);
    return out;
  }
}

/** `#rgb`, `#rrggbb` or `#rrggbbaa` as bx's packed `rrggbbaa`. */
function hexLiteral(value: string): string | undefined {
  const match = /^#([0-9a-fA-F]{3,8})$/.exec(value.trim());
  if (match === null) return undefined;
  const digits = (match[1] as string).toLowerCase();
  if (digits.length === 3) {
    const [r, g, b] = digits;
    return `${r}${r}${g}${g}${b}${b}ff`;
  }
  if (digits.length === 6) return `${digits}ff`;
  if (digits.length === 8) return digits;
  return undefined;
}

// ---------------------------------------------------------------------------
// Closing a tag as it is typed
// ---------------------------------------------------------------------------

/**
 * Types `</div>` when `<div …>` is completed, the way an HTML editor does.
 *
 * Only for a tag bx knows and only for one that can hold a child: `<empty>`
 * cannot, so closing it would write markup bx is about to refuse.
 */
export function closeTagOnType(
  event: vscode.TextDocumentChangeEvent,
): Thenable<boolean> | undefined {
  if (event.document.languageId !== BX_LANGUAGE_ID) return undefined;
  if (event.contentChanges.length !== 1) return undefined;
  const change = event.contentChanges[0] as vscode.TextDocumentContentChangeEvent;
  if (change.text !== '>' || change.rangeLength !== 0) return undefined;

  const editor = vscode.window.activeTextEditor;
  if (editor?.document !== event.document) return undefined;

  const text = event.document.getText();
  const closed = change.rangeOffset + 1;
  // `/>` closes itself, and so does a `>` that is not ending an open tag.
  if (text[closed - 2] === '/') return undefined;
  const open = openTagBefore(text, closed);
  if (open === undefined) return undefined;
  const tag = TAGS.get(open);
  if (tag === undefined || !tag.parent) return undefined;

  const at = event.document.positionAt(closed);
  return editor
    .edit((builder) => builder.insert(at, `</${open}>`), {
      undoStopBefore: false,
      undoStopAfter: false,
    })
    .then((applied) => {
      if (applied) editor.selection = new vscode.Selection(at, at);
      return applied;
    });
}

/** The tag whose `>` sits at `offset`, or undefined when none does. */
function openTagBefore(text: string, offset: number): string | undefined {
  // The `>` is already in the buffer; ask what the character before it was in.
  const context = bxContextAt(text, offset - 1);
  return context.kind === 'attr' || context.kind === 'tag'
    ? context.tag === ''
      ? tagNameAt(text, offset)
      : context.tag
    : undefined;
}

/** The name of the tag being opened, read back from the `<`. */
function tagNameAt(text: string, offset: number): string | undefined {
  const head = text.slice(Math.max(0, offset - 256), offset);
  const match = /<([A-Za-z_][A-Za-z0-9_]*)[^<>]*>$/.exec(head);
  return match === null ? undefined : match[1];
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerBx(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = { scheme: 'file', language: BX_LANGUAGE_ID };
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      new BxCompletionProvider(),
      // `<` opens a tag, `:` follows `on`, `-` starts a step, `"` opens a
      // colour: every one of them is a point where the list changes.
      '<',
      ':',
      '-',
      '"',
    ),
    vscode.languages.registerHoverProvider(selector, new BxHoverProvider()),
    vscode.languages.registerColorProvider(selector, new BxColorProvider()),
    vscode.workspace.onDidChangeTextDocument((event) => {
      void closeTagOnType(event);
    }),
  );
}
