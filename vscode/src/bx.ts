// Markup intelligence for `.bx` files.
//
// A latte `.bx` file is a markup document with Beans in it, and the two halves
// are answered by two different things. The Beans — the `<beans>` block, a
// header, a `{ }` value — is the compiler's to answer and this file never
// touches it. The markup is latte's, which `beansc` has never heard of: the
// vocabulary lives in latte's `bx` package, and `src/bx-data.ts` is that
// vocabulary, printed out of latte's own tables rather than typed out here.
//
// So the rule this file follows is the one `src/client.ts` states for the
// language server: one engine per question. Blocks, interpolations, attribute
// namespaces, events, bindings, reserved attributes and the HTML tables come
// from the tables; nothing else is offered.
//
// **What is deliberately not offered.** There is no list of HTML element
// names, because latte has none: any name is an element and a capitalised one
// is a component, so a list here would be this file's invention. What is
// offered instead is the elements latte has a *rule* about — the void
// elements, the raw-text elements, the ones whose content is RCDATA and the
// ones that eat a leading newline — because those are facts, and each is
// offered with the rule beside it.

import * as vscode from 'vscode';

import {
  BEANS_BLOCK,
  BINDINGS,
  BLOCKS,
  BOOLEAN_ATTRIBUTES,
  BX,
  BX_LANGUAGE_ID,
  EVENTS,
  INTERPOLATIONS,
  NAMESPACES,
  NEWLINE_EATING_ELEMENTS,
  RAW_TEXT_ELEMENTS,
  RCDATA_ELEMENTS,
  RESERVED,
  URL_ATTRIBUTES,
  VOID_ELEMENTS,
  bindingOf,
  bxContextAt,
  namesAComponent,
  type BxContext,
  type BxRow,
} from './bx-model';

export { BX_LANGUAGE_ID };

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

const RETRIGGER: vscode.Command = {
  command: 'editor.action.triggerSuggest',
  title: 'suggest what comes next',
};

function fromRow(
  row: BxRow,
  kind: vscode.CompletionItemKind,
  sort: string,
): vscode.CompletionItem {
  const entry = new vscode.CompletionItem(row.name, kind);
  entry.detail = row.detail;
  entry.documentation = new vscode.MarkdownString(row.note);
  entry.sortText = `${sort}${row.name}`;
  return entry;
}

/** What latte knows about an element, or "" when it knows nothing special. */
function elementRule(tag: string): string {
  const name = tag.toLowerCase();
  if (name === BEANS_BLOCK) {
    return 'latte\'s Beans block: one per file, at the top level, holding Beans and nothing else.';
  }
  const rules: string[] = [];
  if (VOID_ELEMENTS.has(name)) rules.push('a void element — it takes no children');
  if (RAW_TEXT_ELEMENTS.has(name)) {
    rules.push(
      'raw text — its body is not parsed, and an expression inside it is refused: ' +
        `\`</${name}>\` closes the element from inside a string, so HTML escaping is no defence`,
    );
  }
  if (RCDATA_ELEMENTS.has(name)) rules.push('RCDATA — character references resolve, tags do not');
  if (NEWLINE_EATING_ELEMENTS.has(name)) {
    rules.push('the parser drops one newline after the start tag, so write two to keep one');
  }
  return rules.join('; ');
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
        return this.values(context);
      case 'text':
        return context.prefix.startsWith('$') ? this.transitions() : [];
      default:
        return [];
    }
  }

  /** The elements latte has a rule about, each offered with its rule. */
  private tags(): vscode.CompletionItem[] {
    const out: vscode.CompletionItem[] = [];
    const beans = new vscode.CompletionItem(BEANS_BLOCK, vscode.CompletionItemKind.Module);
    beans.detail = 'the Beans block';
    beans.documentation = new vscode.MarkdownString(elementRule(BEANS_BLOCK));
    beans.sortText = `0${BEANS_BLOCK}`;
    out.push(beans);
    const named = new Set([
      ...BX.voidElements,
      ...BX.rawTextElements,
      ...BX.rcdataElements,
      ...BX.newlineEatingElements,
    ]);
    for (const tag of [...named].sort()) {
      const entry = new vscode.CompletionItem(tag, vscode.CompletionItemKind.Class);
      entry.detail = VOID_ELEMENTS.has(tag) ? 'void element' : 'element';
      entry.documentation = new vscode.MarkdownString(elementRule(tag));
      // A void element closes itself; everything else gets a closing tag from
      // `closeTagOnType` once its `>` is typed.
      if (VOID_ELEMENTS.has(tag)) entry.insertText = new vscode.SnippetString(`${tag} $0/>`);
      entry.sortText = `1${tag}`;
      out.push(entry);
    }
    return out;
  }

  private attributes(context: BxContext): vscode.CompletionItem[] {
    const prefix = context.prefix;
    // Mid-way through `on:` or `bind:`, that namespace's members are the
    // answer and the whole attribute surface is noise.
    if (prefix.startsWith('on:')) return this.events();
    const binding = bindingOf(prefix);
    if (binding !== undefined) {
      if (binding.target === 'value' && prefix.includes('.')) return this.conversions();
      return this.bindings();
    }

    // A component takes its parameters by their Beans names, which only its
    // author knows, so nothing here can list them. What *is* known is that
    // `on:`, `attrs` and `preserve` are refused on one and `key` and `ref` are
    // not — offering the element surface here would offer four things latte
    // will reject.
    if (namesAComponent(context.tag)) {
      return BX.reservedAttributes
        .filter((row) => row.name === 'key' || row.name === 'ref')
        .map((row) => {
          const entry = fromRow(row, vscode.CompletionItemKind.Keyword, '0');
          entry.insertText = new vscode.SnippetString(`${row.name}={$1}`);
          return entry;
        });
    }

    const out: vscode.CompletionItem[] = [];
    out.push(...this.events());
    out.push(...this.bindings());
    for (const row of BX.reservedAttributes) {
      const entry = fromRow(row, vscode.CompletionItemKind.Keyword, '2');
      // `key={ }`, `ref={ }` and `attrs={ }` take an expression; `preserve`
      // and `live` are written on their own.
      if (row.detail.includes('{')) entry.insertText = new vscode.SnippetString(`${row.name}={$1}`);
      out.push(entry);
    }
    for (const name of BX.booleanAttributes) {
      const entry = new vscode.CompletionItem(name, vscode.CompletionItemKind.Property);
      entry.detail = 'boolean attribute';
      entry.documentation = new vscode.MarkdownString(
        `Present or absent, never a string: \`${name}="false"\` is a ${name} control in ` +
          `every browser, so latte refuses it. Write \`${name}\` on its own, or ` +
          `\`${name}={<condition>}\`.`,
      );
      entry.sortText = `3${name}`;
      out.push(entry);
    }
    for (const name of BX.urlAttributes) {
      const entry = new vscode.CompletionItem(name, vscode.CompletionItemKind.Property);
      entry.detail = 'a URL';
      entry.documentation = new vscode.MarkdownString(
        `Its value passes the scheme allowlist: ${BX.allowedSchemes.join(', ')}. ` +
          'Anything else is refused in a literal and becomes `about:blank` at run time.',
      );
      entry.insertText = new vscode.SnippetString(`${name}="$1"`);
      entry.sortText = `4${name}`;
      out.push(entry);
    }
    for (const row of BX.namespaces) {
      if (row.name === 'on:' || row.name === 'bind:') continue;
      const entry = fromRow(row, vscode.CompletionItemKind.Module, '5');
      entry.command = RETRIGGER;
      out.push(entry);
    }
    return out;
  }

  private values(context: BxContext): vscode.CompletionItem[] {
    if (!URL_ATTRIBUTES.has(context.attr)) return [];
    return BX.allowedSchemes.map((scheme) => {
      const entry = new vscode.CompletionItem(scheme, vscode.CompletionItemKind.Value);
      entry.detail = 'an allowed scheme';
      entry.insertText = new vscode.SnippetString(
        scheme === 'http' || scheme === 'https' ? `${scheme}://$1` : `${scheme}:$1`,
      );
      return entry;
    });
  }

  private events(): vscode.CompletionItem[] {
    return BX.events.map((event) => {
      const entry = new vscode.CompletionItem(
        `on:${event.event}`,
        vscode.CompletionItemKind.Event,
      );
      entry.detail = `fn(e: ${event.family})`;
      entry.documentation = new vscode.MarkdownString(
        `Becomes \`b.${event.method}(seq, handler)\`, whose handler takes a ` +
          `\`${event.family}\`.`,
      );
      entry.insertText = new vscode.SnippetString(
        `on:${event.event}={fn(e: ${event.family}) { $0 }}`,
      );
      entry.sortText = `0${event.event}`;
      return entry;
    });
  }

  private bindings(): vscode.CompletionItem[] {
    return BX.bindings.map((row) => {
      const entry = fromRow(row, vscode.CompletionItemKind.Field, '1');
      entry.insertText = new vscode.SnippetString(`${row.name}={$1}`);
      return entry;
    });
  }

  private conversions(): vscode.CompletionItem[] {
    return BX.conversions.map((name) => {
      const entry = new vscode.CompletionItem(name, vscode.CompletionItemKind.TypeParameter);
      entry.detail = `bind:value.${name}`;
      entry.documentation = new vscode.MarkdownString(
        'The compiler does not know the field\'s type, so the modifier carries the ' +
          'conversion. A value that will not parse leaves the field alone rather than ' +
          'writing a zero.',
      );
      return entry;
    });
  }

  /** The `$` forms, offered where a `$` has just been typed in markup text. */
  private transitions(): vscode.CompletionItem[] {
    const out: vscode.CompletionItem[] = [];
    for (const row of BX.blocks) {
      const entry = fromRow(row, vscode.CompletionItemKind.Keyword, '0');
      entry.insertText = new vscode.SnippetString(snippetFor(row.name));
      out.push(entry);
    }
    for (const row of BX.interpolations) {
      out.push(fromRow(row, vscode.CompletionItemKind.Snippet, '1'));
    }
    return out;
  }
}

/** The body a `$` block is written with, so the block arrives complete. */
function snippetFor(name: string): string {
  switch (name) {
    case '$if':
      return '$if ${1:condition} {\n\t$0\n}';
    case '$for':
      return '$for ${1:row}: ${2:Row} in ${3:self.rows} {\n\t$0\n}';
    case '$match':
      return '$match ${1:value} {\n\t${2:pattern} => { $0 }\n}';
    case '$slot':
      return '$slot';
    case '$html':
      return '$html(${1:self.rendered})';
    case 'else':
      return 'else {\n\t$0\n}';
    default:
      return name;
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
      /\$?[A-Za-z_][A-Za-z0-9_]*(?:[-.:][A-Za-z0-9_.:-]+)*/,
    );
    if (range === undefined) return undefined;
    const word = document.getText(range);
    const text = document.getText();
    const start = document.offsetAt(range.start);
    const context = bxContextAt(text, start);

    if (context.kind === 'tag' || isTagName(text, start)) return tagHover(range, word);
    if (context.kind === 'attr') return attributeHover(range, word, context.tag);
    if (context.kind === 'text' && word.startsWith('$')) {
      const row = BLOCKS.get(word) ?? INTERPOLATIONS.get(word);
      if (row === undefined) return undefined;
      return markdown(range, `\`${row.detail}\``, row.note);
    }
    return undefined;
  }
}

function tagHover(range: vscode.Range, tag: string): vscode.Hover | undefined {
  if (namesAComponent(tag)) {
    return markdown(
      range,
      `\`<${tag}>\` is a component.`,
      'The last dotted segment is capitalised, so latte emits ' +
        `\`b.component<${tag}>(seq, setter)\` and beansc resolves the name. Its ` +
        'attributes are its Beans parameters, by their Beans names.',
    );
  }
  const rule = elementRule(tag);
  if (rule === '') return undefined;
  return markdown(range, `\`<${tag}>\``, rule);
}

function attributeHover(
  range: vscode.Range,
  word: string,
  tag: string,
): vscode.Hover | undefined {
  if (word.startsWith('on:')) {
    const name = word.slice(3);
    const event = EVENTS.get(name);
    if (event === undefined) {
      return markdown(
        range,
        `\`${word}\` is not an event latte has.`,
        `The table is ${BX.events.map((e) => e.event).join(', ')}.`,
      );
    }
    if (namesAComponent(tag)) {
      return markdown(
        range,
        `\`${word}\` is a DOM event and \`<${tag}>\` is a component.`,
        `A component reports an event through a Callback parameter, written ` +
          `\`on_${name}={...}\` with the name its author gave it.`,
      );
    }
    return markdown(
      range,
      `\`${word}={fn(e: ${event.family}) { ... }}\``,
      `Becomes \`b.${event.method}(seq, handler)\`.`,
    );
  }

  const binding = bindingOf(word);
  if (binding !== undefined) {
    const row = BINDINGS.get(`bind:${binding.target}`);
    if (row === undefined) {
      return markdown(
        range,
        `\`bind:${binding.target}\` is not a binding latte has.`,
        `The two are ${BX.bindings.map((b) => b.name).join(' and ')}.`,
      );
    }
    if (binding.conversion !== '' && !BX.conversions.includes(binding.conversion)) {
      return markdown(
        range,
        `\`.${binding.conversion}\` is not a conversion \`${row.name}\` takes.`,
        `The three are ${BX.conversions.join(', ')}.`,
      );
    }
    return markdown(range, `\`${row.name}\` on ${row.detail}`, row.note);
  }

  const reserved = RESERVED.get(word);
  if (reserved !== undefined) {
    return markdown(range, `\`${reserved.detail}\``, reserved.note);
  }

  const colon = word.indexOf(':');
  if (colon > 0) {
    const namespace = NAMESPACES.get(`${word.slice(0, colon)}:`);
    if (namespace === undefined) {
      return markdown(
        range,
        `\`${word}\` uses an attribute namespace latte does not have.`,
        `The list is ${BX.namespaces.map((n) => n.name).join(', ')}.`,
      );
    }
    return markdown(range, `\`${namespace.detail}\``, namespace.note);
  }

  if (BOOLEAN_ATTRIBUTES.has(word.toLowerCase())) {
    return markdown(
      range,
      `\`${word}\` is a boolean attribute: present or absent, never a string.`,
      `\`${word}="false"\` is a ${word} control in every browser, so latte refuses ` +
        `the string form. Write \`${word}\` on its own, or \`${word}={<condition>}\`.`,
    );
  }
  if (URL_ATTRIBUTES.has(word.toLowerCase())) {
    return markdown(
      range,
      `\`${word}\` carries a URL.`,
      `Its scheme must be one of ${BX.allowedSchemes.join(', ')}; anything else is ` +
        'refused in a literal and becomes `about:blank` at run time.',
    );
  }
  // latte refuses every attribute three bytes or longer whose name starts with
  // `on`, not only the ones HTML defines — an inline handler exists as an id
  // and the client never evaluates a string.
  if (word.length >= 3 && word.toLowerCase().startsWith('on') && !namesAComponent(tag)) {
    return markdown(
      range,
      `\`${word}\` starts with \`on\`, and latte refuses every attribute whose name does.`,
      'Rename it, or write `on:<event>={...}` if you meant a handler.',
    );
  }
  return undefined;
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
// Closing a tag as it is typed
// ---------------------------------------------------------------------------

/**
 * Types `</div>` when `<div …>` is completed, the way an HTML editor does.
 *
 * Not for a void element: latte reads `<br>` as complete and closed, so a
 * `</br>` after it is a closing tag with nothing open. That list is latte's,
 * which is the only reason this can be right about it.
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
  if (VOID_ELEMENTS.has(open.toLowerCase())) return undefined;

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
export function openTagBefore(text: string, offset: number): string | undefined {
  // The `>` is already in the buffer; ask what the character before it was in.
  const context = bxContextAt(text, offset - 1);
  if (context.kind !== 'attr' && context.kind !== 'tag') return undefined;
  return context.tag === '' ? tagNameAt(text, offset) : context.tag;
}

/** The name of the tag being opened, read back from the `<`. */
function tagNameAt(text: string, offset: number): string | undefined {
  const head = text.slice(Math.max(0, offset - 256), offset);
  const match = /<([A-Za-z_][A-Za-z0-9_.:-]*)[^<>]*>$/.exec(head);
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
      // `<` opens a tag, `$` opens a block or an interpolation, `:` follows
      // `on` and `bind`, `.` follows `bind:value`, `"` opens a URL: every one
      // of them is a point where the list changes.
      '<',
      '$',
      ':',
      '.',
      '"',
    ),
    vscode.languages.registerHoverProvider(selector, new BxHoverProvider()),
    vscode.workspace.onDidChangeTextDocument((event) => {
      void closeTagOnType(event);
    }),
  );
}
