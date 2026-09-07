// Builds the VS Code TextMate grammars: `.b` and `beans.pot` from
// shared/language.json, and `.bx` from shared/bx.json, which latte prints.
//
// TextMate highlighting is the "instant" layer: it paints a file the moment it
// opens, before `beansc lsp` has started. Anything that needs real name
// resolution is the server's job and arrives as semantic tokens.
//
// `.bx` has no server at all — `beansc` has never heard of latte's markup — so
// what this file paints is the only structure an editor shows for one, which
// is why the `.bx` grammar below is generated from latte's own tables rather
// than typed out here.

import {
  GENERATED_BANNER,
  BX_GENERATED_BANNER,
  wordAlternation,
  builtinTypeNames,
} from './language-data.mjs';

const IDENT = '[A-Za-z_][A-Za-z0-9_]*';

/**
 * The lookaround each contextual modifier is painted behind, one per word in
 * `contextualKeywords.modifiers`. These are the shapes `recognizedWhen` in
 * shared/language.json describes, written as regex: outside them the word is
 * an ordinary name and painting it would be a bug — the compiler's own
 * sources have a field called `align` and a local called `package`.
 *
 * Missing an entry is a build error rather than a silently unhighlighted
 * keyword, so adding a word to language.json forces a decision here.
 */
const CLASS_MODIFIERS = ['unique', 'abstract', 'partial', 'singleton'];
const CLASS_MODIFIER_RUN =
  `(?=(?:\\s+(?:${CLASS_MODIFIERS.join('|')}))*\\s+class\\b)`;

const CONTEXTUAL_MODIFIERS = {
  // A run of class modifiers, in any order, ending at the `class` they modify.
  unique: CLASS_MODIFIER_RUN,
  partial: CLASS_MODIFIER_RUN,
  singleton: CLASS_MODIFIER_RUN,
  // `abstract` is the one that is also a method modifier.
  abstract: `(?:${CLASS_MODIFIER_RUN}|(?=\\s+fn\\b))`,
  packed: '(?=\\s+(?:struct|union))',
  opaque: '(?=\\s+struct\\b)',
  align: '(?=\\s*\\()',
  feature: '(?=\\s*")',
  // `priv value: T` restricts a member; a field *named* priv reads `priv:` or
  // `priv = `, and the lookahead demands a name after the space instead.
  priv: '(?=\\s+[A-Za-z_])',
  // `weak next: Option<Node>` — a non-owning field, and only a field.
  weak: `(?=\\s+${IDENT}\\s*:)`,
  send: '(?=\\s+fn\\b)',
  thread_local: '(?=\\s+(?:let|var)\\b)',
};

/** Contextual modifier rules, in the order language.json lists them. */
function contextualModifierRules(ctx) {
  return ctx.modifiers.map((word) => {
    const shape = CONTEXTUAL_MODIFIERS[word];
    if (shape === undefined) {
      throw new Error(
        `contextualKeywords.modifiers has "${word}" but tmlanguage.mjs has no ` +
          'shape for it. Add one to CONTEXTUAL_MODIFIERS, matching its ' +
          '`recognizedWhen` entry in shared/language.json.',
      );
    }
    // `.priv` and `.weak` are member reads, never modifiers.
    return { name: 'storage.modifier.beans', match: `(?<!\\.)\\b${word}\\b${shape}` };
  });
}

/**
 * The `beans.pot` manifest is its own small format — `module`/`kind`/`require`/
 * `link` lines, not Beans code. It gets its own grammar bound to the exact
 * filename, because `.pot` belongs to gettext and must not be claimed.
 */
export function buildManifestTmLanguage(data) {
  return {
    $schema:
      'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    $generated: GENERATED_BANNER,
    name: 'Beans Manifest',
    scopeName: 'source.beans-manifest',
    patterns: [
      {
        name: 'comment.line.double-slash.beans-manifest',
        begin: '//',
        beginCaptures: { 0: { name: 'punctuation.definition.comment.beans-manifest' } },
        end: '$',
      },
      {
        name: 'string.quoted.double.beans-manifest',
        begin: '"',
        end: '"',
      },
      {
        match: `^\\s*(module)\\s+([A-Za-z_][A-Za-z0-9_.]*)`,
        captures: {
          1: { name: 'keyword.control.beans-manifest' },
          2: { name: 'entity.name.namespace.beans-manifest' },
        },
      },
      {
        match: `^\\s*(kind)\\s+(${data.manifest.kinds.join('|')})\\b`,
        captures: {
          1: { name: 'keyword.control.beans-manifest' },
          2: { name: 'constant.language.beans-manifest' },
        },
      },
      {
        match: '^\\s*(require)\\s+([^\\s]+)(?:\\s+([^\\s]+))?',
        captures: {
          1: { name: 'keyword.control.beans-manifest' },
          2: { name: 'entity.name.namespace.beans-manifest' },
          3: { name: 'constant.other.version.beans-manifest' },
        },
      },
      { name: 'keyword.control.beans-manifest', match: wordAlternation(data.manifest.keywords) },
      { name: 'constant.numeric.beans-manifest', match: '\\bv?[0-9][0-9A-Za-z_.+-]*\\b' },
    ],
  };
}

export function buildTmLanguage(data) {
  const kw = data.keywords.byRole;
  const ctx = data.contextualKeywords;

  return {
    $schema:
      'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    $generated: GENERATED_BANNER,
    name: data.language.name,
    scopeName: 'source.beans',
    fileTypes: data.language.fileExtensions.map((e) => e.replace(/^\./, '')),
    patterns: [{ include: '#main' }],
    repository: {
      main: {
        patterns: [
          { include: '#comment' },
          { include: '#raw-string' },
          { include: '#string' },
          { include: '#number' },
          { include: '#package' },
          { include: '#annotation' },
          { include: '#declaration' },
          { include: '#import' },
          { include: '#keyword' },
          { include: '#type' },
          { include: '#call' },
          { include: '#member' },
          { include: '#identifier' },
          { include: '#operator' },
          { include: '#punctuation' },
        ],
      },

      // ---- comments ------------------------------------------------------
      // Order matters: `///` before `//`, so a doc comment never degrades to a
      // plain line comment. `////` is a divider, not documentation.
      comment: {
        patterns: [
          { include: '#doc-comment' },
          { include: '#line-comment' },
          { include: '#block-comment' },
        ],
      },
      'doc-comment': {
        name: 'comment.line.documentation.beans',
        begin: '///(?!/)',
        beginCaptures: {
          0: { name: 'punctuation.definition.comment.documentation.beans' },
        },
        end: '$',
      },
      'line-comment': {
        name: 'comment.line.double-slash.beans',
        begin: '//',
        beginCaptures: { 0: { name: 'punctuation.definition.comment.beans' } },
        end: '$',
      },
      // Self-including so `/* /* */ */` closes at the right `*/`, which is what
      // the compiler's lexer does (skip_block_comment counts depth).
      'block-comment': {
        name: 'comment.block.beans',
        begin: '/\\*',
        beginCaptures: { 0: { name: 'punctuation.definition.comment.begin.beans' } },
        end: '\\*/',
        endCaptures: { 0: { name: 'punctuation.definition.comment.end.beans' } },
        patterns: [{ include: '#block-comment' }],
      },

      // ---- strings -------------------------------------------------------
      string: {
        name: 'string.quoted.double.beans',
        begin: '"',
        beginCaptures: { 0: { name: 'punctuation.definition.string.begin.beans' } },
        end: '"',
        endCaptures: { 0: { name: 'punctuation.definition.string.end.beans' } },
        patterns: [
          { include: '#string-escape' },
          { include: '#string-escape-invalid' },
          { include: '#interpolation' },
        ],
      },
      'string-escape': {
        // The exact set the lexer accepts; anything else is flagged below.
        // `\\xNN` is one raw byte and `\\u{...}` one codepoint, so both carry
        // their digits: a half-written `\\x1` is not an escape, it is the
        // mistake the lexer names.
        name: 'constant.character.escape.beans',
        match: '\\\\(?:[ntr0\\\\"{}]|x[0-9a-fA-F]{2}|u\\{[0-9a-fA-F]{1,6}\\})',
      },
      'string-escape-invalid': {
        name: 'invalid.illegal.unknown-escape.beans',
        match: '\\\\.',
      },
      // `r"…"` and `r#"…"#`: bytes, not syntax. Nothing inside is an escape
      // and nothing opens an interpolation, so the body carries no patterns
      // at all. The hashed forms come first because `r#"` also starts with
      // `r`, and TextMate takes the first rule that matches. A begin/end
      // pair cannot count its own hashes, so the depths are written out —
      // three covers every form the compiler's own tests use, and a deeper
      // one falls back to being highlighted as an ordinary raw body.
      'raw-string': {
        patterns: [
          {
            name: 'string.quoted.other.raw.beans',
            begin: '\\br###"',
            beginCaptures: {
              0: { name: 'punctuation.definition.string.begin.beans' },
            },
            end: '"###',
            endCaptures: {
              0: { name: 'punctuation.definition.string.end.beans' },
            },
          },
          {
            name: 'string.quoted.other.raw.beans',
            begin: '\\br##"',
            beginCaptures: {
              0: { name: 'punctuation.definition.string.begin.beans' },
            },
            end: '"##',
            endCaptures: {
              0: { name: 'punctuation.definition.string.end.beans' },
            },
          },
          {
            name: 'string.quoted.other.raw.beans',
            begin: '\\br#"',
            beginCaptures: {
              0: { name: 'punctuation.definition.string.begin.beans' },
            },
            end: '"#',
            endCaptures: {
              0: { name: 'punctuation.definition.string.end.beans' },
            },
          },
          {
            name: 'string.quoted.other.raw.beans',
            begin: '\\br"',
            beginCaptures: {
              0: { name: 'punctuation.definition.string.begin.beans' },
            },
            end: '"',
            endCaptures: {
              0: { name: 'punctuation.definition.string.end.beans' },
            },
          },
        ],
      },
      // `{expr}` may hold a whole expression, including further strings, so the
      // body recurses into #main. A format spec (`{x:8.2}`) rides after the
      // first top-level colon.
      interpolation: {
        name: 'meta.interpolation.beans',
        begin: '\\{',
        beginCaptures: {
          0: { name: 'punctuation.section.interpolation.begin.beans' },
        },
        end: '\\}',
        endCaptures: { 0: { name: 'punctuation.section.interpolation.end.beans' } },
        patterns: [{ include: '#format-spec' }, { include: '#main' }],
      },
      'format-spec': {
        match: '(:)(-?[0-9]*(?:\\.[0-9]+)?)(?=\\})',
        captures: {
          1: { name: 'punctuation.separator.format.beans' },
          2: { name: 'constant.other.format-spec.beans' },
        },
      },

      // ---- numbers -------------------------------------------------------
      number: {
        patterns: [
          {
            name: 'constant.numeric.hex.beans',
            match: '\\b0[xX][0-9a-fA-F][0-9a-fA-F_]*\\b',
          },
          { name: 'constant.numeric.binary.beans', match: '\\b0[bB][01][01_]*\\b' },
          {
            // `0..10` is a range, not a float — the fraction needs a digit.
            name: 'constant.numeric.float.beans',
            match: '\\b[0-9][0-9_]*\\.[0-9][0-9_]*(?:[eE][+-]?[0-9]+)?\\b',
          },
          {
            name: 'constant.numeric.float.beans',
            match: '\\b[0-9][0-9_]*[eE][+-]?[0-9]+\\b',
          },
          { name: 'constant.numeric.integer.beans', match: '\\b[0-9][0-9_]*\\b' },
        ],
      },

      // ---- declarations --------------------------------------------------
      declaration: {
        patterns: [
          {
            match: `\\b(fn)\\s+(${IDENT})`,
            captures: {
              1: { name: 'storage.type.function.beans' },
              2: { name: 'entity.name.function.beans' },
            },
          },
          {
            match: `\\b(class|struct|union|interface|enum)\\s+(${IDENT})`,
            captures: {
              1: { name: 'storage.type.beans' },
              2: { name: 'entity.name.type.beans' },
            },
          },
          {
            match: `\\b(extends|implements)\\s+(${IDENT})`,
            captures: {
              1: { name: 'storage.modifier.beans' },
              2: { name: 'entity.name.type.beans' },
            },
          },
          {
            match: `\\b(new)\\s+(${IDENT}(?:\\.${IDENT})*)`,
            captures: {
              1: { name: 'keyword.operator.new.beans' },
              2: { name: 'entity.name.type.beans' },
            },
          },
          {
            match: `\\b(let|var)\\s+(${IDENT})`,
            captures: {
              1: { name: 'storage.type.beans' },
              2: { name: 'variable.other.beans' },
            },
          },
        ],
      },

      // `package money`, the first declaration in a file. TextMate has no way
      // to know a line is the first one, so the rule asks for what it can see:
      // the clause starts its line and is followed by a bare name. That keeps
      // `let package = ...` and `self.package` ordinary names, which they are.
      package: {
        patterns: [
          {
            match: `^\\s*(package)\\s+(${IDENT})\\b(?=\\s*(?://|$))`,
            captures: {
              1: { name: 'keyword.control.package.beans' },
              2: { name: 'entity.name.namespace.beans' },
            },
          },
        ],
      },

      // Two forms, and the list form has to come first: `import {` would
      // otherwise fall through to the bare `import` keyword and leave the
      // names, the `as` aliases and the `from` unpainted.
      import: {
        patterns: [
          { include: '#import-list-line' },
          { include: '#import-list-block' },
          { include: '#import-module' },
        ],
      },
      // `import {a, b as c} from pkg.path` on one line, which is how nearly
      // every one is written. Whole-line so the `from` and the path it names
      // are painted in the same pass as the names.
      'import-list-line': {
        match:
          `\\b(import)\\s*(\\{)([^}]*)(\\})` +
          `(?:\\s*(from)\\s+([A-Za-z_][A-Za-z0-9_./-]*))?`,
        captures: {
          1: { name: 'keyword.control.import.beans' },
          2: { name: 'punctuation.section.braces.beans' },
          3: { patterns: [{ include: '#import-names' }] },
          4: { name: 'punctuation.section.braces.beans' },
          5: { name: 'keyword.control.import.beans' },
          6: { name: 'entity.name.namespace.beans' },
        },
      },
      // The same list broken over lines. Kept second so the one-line rule
      // wins, and ended at the `}` plus its `from` clause.
      'import-list-block': {
        begin: `\\b(import)\\s*(\\{)`,
        beginCaptures: {
          1: { name: 'keyword.control.import.beans' },
          2: { name: 'punctuation.section.braces.beans' },
        },
        end: `(\\})(?:\\s*(from)\\s+([A-Za-z_][A-Za-z0-9_./-]*))?`,
        endCaptures: {
          1: { name: 'punctuation.section.braces.beans' },
          2: { name: 'keyword.control.import.beans' },
          3: { name: 'entity.name.namespace.beans' },
        },
        patterns: [{ include: '#comment' }, { include: '#import-names' }],
      },
      // What sits between the braces: `name`, or `name as alias`.
      'import-names': {
        patterns: [
          {
            match: `\\b(${IDENT})\\s+(as)\\s+(${IDENT})`,
            captures: {
              1: { name: 'variable.other.readwrite.alias.beans' },
              2: { name: 'keyword.control.import.beans' },
              3: { name: 'variable.other.readwrite.alias.beans' },
            },
          },
          { name: 'variable.other.readwrite.alias.beans', match: `\\b${IDENT}\\b` },
          { name: 'punctuation.separator.comma.beans', match: ',' },
        ],
      },
      'import-module': {
        match: `\\b(import)\\s+([A-Za-z_][A-Za-z0-9_./-]*)(?:\\s+(as)\\s+(${IDENT}))?`,
        captures: {
          1: { name: 'keyword.control.import.beans' },
          2: { name: 'entity.name.namespace.beans' },
          3: { name: 'keyword.control.import.beans' },
          4: { name: 'entity.name.namespace.alias.beans' },
        },
      },

      // ---- annotations ---------------------------------------------------
      // `@name` and `@pkg.name`, with optional named arguments. The name is
      // painted, the arguments are ordinary code: `value:` is a name and the
      // expression after it is an expression.
      annotation: {
        patterns: [
          {
            match: `(@)(${IDENT}(?:\\.${IDENT})?)`,
            captures: {
              1: { name: 'punctuation.definition.annotation.beans' },
              2: { name: 'entity.name.function.annotation.beans' },
            },
          },
        ],
      },

      // ---- keywords ------------------------------------------------------
      keyword: {
        patterns: [
          { name: 'keyword.control.beans', match: wordAlternation(kw.control) },
          { name: 'keyword.control.import.beans', match: wordAlternation(kw.import) },
          { name: 'constant.language.boolean.beans', match: wordAlternation(kw.constant) },
          { name: 'variable.language.self.beans', match: wordAlternation(kw.variable) },
          {
            name: 'variable.language.super.beans',
            match: wordAlternation(ctx.variables),
          },
          { name: 'keyword.operator.expression.beans', match: wordAlternation(kw.operatorLike) },
          { name: 'storage.modifier.beans', match: wordAlternation(kw.modifier) },
          { name: 'storage.modifier.beans', match: wordAlternation(kw.relation) },
          { name: 'storage.type.beans', match: wordAlternation(kw.declaration) },
          // Contextual modifiers: only where the compiler treats them as one.
          ...contextualModifierRules(ctx),
          // `annotation Name` declares one. A local called `annotation` is
          // still a local, so the declaration demands a name after it.
          {
            name: 'storage.type.beans',
            match: `\\bannotation\\b(?=\\s+${IDENT})`,
          },
          // `brew f(args)` starts a child fiber. The lookbehind keeps the
          // TaskGroup method `group.brew(...)` an ordinary call, and the
          // lookahead demands the call that must follow.
          {
            name: 'keyword.control.beans',
            match: '(?<!\\.)\\bbrew\\b(?=\\s+[A-Za-z_])',
          },
          {
            name: 'support.function.builtin.beans',
            match: `${wordAlternation(ctx.typeOperators)}(?=\\s*\\()`,
          },
        ],
      },

      // ---- types ---------------------------------------------------------
      type: {
        patterns: [
          {
            name: 'support.type.primitive.beans',
            match: wordAlternation(data.types.primitives),
          },
          { name: 'support.class.beans', match: wordAlternation(builtinTypeNames(data)) },
          // Beans convention, stated in the spec: types are Capitalized,
          // values are not (`Option` vs `some`).
          { name: 'entity.name.type.beans', match: '\\b[A-Z][A-Za-z0-9_]*\\b' },
        ],
      },

      // ---- expressions ---------------------------------------------------
      call: {
        patterns: [
          {
            match: `(?<=\\.)(${IDENT})\\s*(?=\\()`,
            captures: { 1: { name: 'entity.name.function.member.beans' } },
          },
          {
            match: `\\b(${IDENT})\\s*(?=\\()`,
            captures: { 1: { name: 'entity.name.function.call.beans' } },
          },
        ],
      },
      member: {
        patterns: [
          {
            match: `(?<=\\.)(${IDENT})\\b`,
            captures: { 1: { name: 'variable.other.property.beans' } },
          },
        ],
      },
      identifier: {
        patterns: [{ name: 'variable.other.beans', match: `\\b${IDENT}\\b` }],
      },

      // ---- operators and punctuation -------------------------------------
      operator: {
        patterns: [
          { name: 'keyword.operator.arrow.beans', match: '->|=>' },
          { name: 'keyword.operator.range.beans', match: '\\.\\.=|\\.\\.' },
          { name: 'keyword.operator.assignment.beans', match: '[+\\-*/%]=|=' },
          { name: 'keyword.operator.comparison.beans', match: '==|!=|<=|>=' },
          { name: 'keyword.operator.logical.beans', match: '&&|\\|\\||!' },
          { name: 'keyword.operator.bitwise.beans', match: '<<|>>|[&|^~]' },
          { name: 'keyword.operator.arithmetic.beans', match: '[+\\-*/%]' },
          { name: 'keyword.operator.comparison.beans', match: '[<>]' },
          { name: 'keyword.operator.optional.beans', match: '\\?' },
        ],
      },
      punctuation: {
        patterns: [
          { name: 'punctuation.section.parens.beans', match: '[()]' },
          { name: 'punctuation.section.brackets.beans', match: '[\\[\\]]' },
          { name: 'punctuation.section.braces.beans', match: '[{}]' },
          { name: 'punctuation.separator.comma.beans', match: ',' },
          { name: 'punctuation.separator.colon.beans', match: ':' },
          { name: 'punctuation.accessor.beans', match: '\\.' },
          { name: 'punctuation.terminator.beans', match: ';' },
        ],
      },
    },
  };
}

/**
 * The `.bx` grammar: a latte markup document.
 *
 * **This is inverted from what it was.** crema's `.bx` was a Beans file with
 * tag expressions in it, so the old grammar was a thin layer of tag rules over
 * `source.beans`: everything that was not a tag fell through to Beans, a `<`
 * opened a tag only where a name did not end just before it, and `"…<div>…"`
 * was a string. latte's `.bx` is the other language. It is a **markup
 * document** — outside the `<beans>` block a `<` *always* opens a tag
 * (`parse.b`: "a < that does not open a tag — write &lt;"), and the same text
 * *is* markup, not a string. So the document is markup by default and Beans
 * only inside the places that hold Beans: the `<beans>` block, a `$` block's
 * header, a `{ }` attribute value and the `$( )` / `${ }` forms.
 *
 * Everything the grammar paints as latte's own — the `$` blocks, the
 * interpolation forms, the attribute namespaces, the event names, the
 * bindings and their conversions, the reserved attributes, the boolean
 * attributes and the raw-text elements — is **generated from
 * `shared/bx.json`**, which latte prints out of its own tables. Where a shape
 * cannot be derived from a table (which `$` word takes a header, which raw-text
 * element embeds which language), the classification is written here *and
 * checked against the table*: a name latte adds and this file has no shape for
 * is a build error, not a silently unpainted keyword. That is the same rule
 * `CONTEXTUAL_MODIFIERS` follows above.
 *
 * **What TextMate cannot do here, stated rather than hidden.** A `.bx` file is
 * brace-structured and TextMate is a per-line regex machine, so the grammar is
 * deliberately *flat*: a `$if` body is not a region, it is the same markup
 * rules with a `{` before it and a `}` after. That choice is why a stray `{` in
 * running text — which latte reads as ordinary text — cannot swallow the rest
 * of the file, which a balanced-brace region would. The costs are named at
 * each rule below.
 */
export function buildBxTmLanguage(data, bx) {
  // A tag or attribute name, exactly `is_name_byte` in latte's lex.b: letters,
  // digits, `_`, and `-` `.` `:` after the first byte. The dot is what makes
  // `<ui.Button>` and `bind:value.int` one name; the colon is what makes
  // `on:click` one token rather than three the parser reassembles.
  const NAME = '[A-Za-z_][A-Za-z0-9_.:-]*';
  // `names_a_component` in latte's html.b: the last dotted segment decides, so
  // `Hint` and `ui.Button` are components and `div` and `my-widget` are not.
  const COMPONENT = '(?:[A-Za-z_][A-Za-z0-9_]*\\.)*[A-Z][A-Za-z0-9_]*';
  const IDENT = '[A-Za-z_][A-Za-z0-9_]*';
  // An attribute's `= value`, so a rule that paints a *wrong* attribute name
  // swallows the value with it instead of leaving `="x"` behind for the
  // ordinary rules to paint as a second, healthy-looking attribute. One level
  // of brace nesting, which is all an error path needs.
  const ATTR_VALUE =
    '(?:\\s*=\\s*(?:"[^"]*"|\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\}))?';

  const names = (rows) => rows.map((r) => r.name);
  const alt = (words) =>
    [...words].sort((a, b) => b.length - a.length || a.localeCompare(b)).join('|');

  // ---- what latte's tables say, checked against what this file can paint ---

  /**
   * The shape of each `$` word. A word latte grows without a shape here is a
   * build error: an unpainted keyword in a markup file reads as running text,
   * which is exactly the mistake this grammar exists to stop.
   */
  const BLOCK_SHAPE = {
    $if: 'header',
    $for: 'header',
    $match: 'header',
    $slot: 'slot',
    $html: 'call',
    else: 'else',
  };
  for (const name of names(bx.blocks)) {
    if (BLOCK_SHAPE[name] === undefined) {
      throw new Error(
        `shared/bx.json lists the block "${name}", and tmlanguage.mjs has no ` +
          'shape for it. Add one to BLOCK_SHAPE — a header block, a call, or a ' +
          'form of its own — so it is painted rather than read as running text.',
      );
    }
  }
  const headerWords = Object.entries(BLOCK_SHAPE)
    .filter(([, shape]) => shape === 'header')
    .map(([name]) => name.replace(/^\$/, ''));

  /** The four interpolation forms, by the name latte prints for each. */
  const INTERPOLATIONS = ['$<chain>', '$( )', '${ }', '$$'];
  for (const name of names(bx.interpolations)) {
    if (!INTERPOLATIONS.includes(name)) {
      throw new Error(
        `shared/bx.json lists the interpolation "${name}", which tmlanguage.mjs ` +
          'does not paint. Add a rule for it and list it in INTERPOLATIONS.',
      );
    }
  }

  /**
   * Which namespaces are latte's own and which are ordinary XML. `on:` and
   * `bind:` carry behaviour; the rest are attributes with a colon in the name.
   */
  const OWN_NAMESPACES = ['on:', 'bind:'];
  const namespaceNames = names(bx.namespaces);
  for (const own of OWN_NAMESPACES) {
    if (!namespaceNames.includes(own)) {
      throw new Error(
        `tmlanguage.mjs paints ${own} as one of latte's own namespaces and ` +
          'shared/bx.json no longer lists it. Either latte dropped it — remove ' +
          'the rule — or the vocabulary is wrong.',
      );
    }
  }
  const xmlNamespaces = namespaceNames
    .filter((n) => !OWN_NAMESPACES.includes(n))
    .map((n) => n.replace(/:$/, ''));
  const allNamespaces = namespaceNames.map((n) => n.replace(/:$/, ''));

  /** `key={ }` and friends take a value; `preserve` and `live` are bare. */
  const RESERVED_SHAPE = {
    key: 'value',
    ref: 'value',
    attrs: 'value',
    preserve: 'bare',
    live: 'bare',
  };
  for (const name of names(bx.reservedAttributes)) {
    if (RESERVED_SHAPE[name] === undefined) {
      throw new Error(
        `shared/bx.json reserves the attribute "${name}" and tmlanguage.mjs has ` +
          'no shape for it. Add one to RESERVED_SHAPE, "value" or "bare".',
      );
    }
  }
  const reservedValued = Object.entries(RESERVED_SHAPE)
    .filter(([, shape]) => shape === 'value')
    .map(([name]) => name);
  const reservedBare = Object.entries(RESERVED_SHAPE)
    .filter(([, shape]) => shape === 'bare')
    .map(([name]) => name);

  /**
   * The language a raw-text element's body is written in. latte refuses
   * interpolation inside one and never parses it, so the only question left is
   * what to hand it to — and a new raw-text element with no answer here would
   * otherwise have its body scanned as markup, which is the one thing it must
   * never be.
   */
  const RAW_TEXT_EMBED = { script: 'source.js', style: 'source.css' };
  for (const tag of bx.rawTextElements) {
    if (RAW_TEXT_EMBED[tag] === undefined) {
      throw new Error(
        `shared/bx.json calls <${tag}> a raw-text element and tmlanguage.mjs ` +
          'does not know what its body is written in. Add it to RAW_TEXT_EMBED, ' +
          'or its body will be painted as markup, which it is not.',
      );
    }
  }

  // `bind:value` takes a conversion suffix and `bind:checked` takes none, which
  // is a rule from the vocabulary's own note and not a guess.
  const bindingTargets = names(bx.bindings).map((n) => n.replace(/^bind:/, ''));
  const conversions = alt(bx.conversions);
  const bindKnown =
    `(?:value(?:\\.(?:${conversions}))?|` +
    `${alt(bindingTargets.filter((t) => t !== 'value'))})`;

  // ---- the repository -----------------------------------------------------

  const repository = {
    // Order is the grammar. `<beans>` and the raw-text elements are matched
    // before the general element rule, because both of those names would
    // otherwise open an ordinary tag and their bodies would be read as markup.
    markup: {
      patterns: [
        { include: '#beans-block' },
        { include: '#comment' },
        { include: '#doctype' },
        { include: '#bang-unknown' },
        ...bx.rawTextElements.map((tag) => ({ include: `#raw-${tag}` })),
        { include: '#close-tag' },
        { include: '#element-component' },
        { include: '#element' },
        { include: '#stray-lt' },
        { include: '#transition' },
        { include: '#match-arm' },
        { include: '#block-punctuation' },
        { include: '#text-escape' },
        { include: '#entity' },
      ],
    },

    // ---- the Beans half --------------------------------------------------
    // `<beans>` is a raw-text element the way `<script>` is in HTML: nothing
    // inside it is markup and nothing inside it is scanned, so a `$`, a `<` or
    // a brace in there is just Beans (`parse_beans` takes the bytes to the
    // first `</beans>` and copies them through). That is why the whole body is
    // handed to `source.beans` and nothing else is tried inside it.
    'beans-block': {
      begin: '(<)(beans)\\s*(>)',
      beginCaptures: {
        1: { name: 'punctuation.definition.tag.begin.bx' },
        2: { name: 'entity.name.tag.beans-block.bx' },
        3: { name: 'punctuation.definition.tag.end.bx' },
      },
      end: '(</)(beans)\\s*(>)',
      endCaptures: {
        1: { name: 'punctuation.definition.tag.begin.bx' },
        2: { name: 'entity.name.tag.beans-block.bx' },
        3: { name: 'punctuation.definition.tag.end.bx' },
      },
      contentName: 'meta.embedded.block.beans',
      patterns: [{ include: 'source.beans' }],
    },

    // ---- markup punctuation ----------------------------------------------
    comment: {
      name: 'comment.block.bx',
      begin: '<!--',
      beginCaptures: { 0: { name: 'punctuation.definition.comment.begin.bx' } },
      end: '-->',
      endCaptures: { 0: { name: 'punctuation.definition.comment.end.bx' } },
    },
    doctype: {
      match: '(<!)((?i:doctype))([^>]*)(>)',
      captures: {
        1: { name: 'punctuation.definition.tag.begin.bx' },
        2: { name: 'keyword.other.doctype.bx' },
        3: { name: 'entity.other.doctype-value.bx' },
        4: { name: 'punctuation.definition.tag.end.bx' },
      },
    },
    // `<![CDATA[…]]>`, `<?xml …>` and the rest: "only <!-- comments --> and
    // <!DOCTYPE ...> may start with <!".
    'bang-unknown': {
      name: 'invalid.illegal.unknown-declaration.bx',
      match: '<!(?!--)[^>]*>?',
    },
    // A `<` that opens nothing. latte refuses it by name — "outside the
    // <beans> block every < opens one, so write &lt;" — so painting it as an
    // error is the grammar agreeing with the compiler rather than guessing.
    'stray-lt': {
      name: 'invalid.illegal.unexpected-lt.bx',
      match: '<(?![A-Za-z_!/])',
    },
    entity: {
      name: 'constant.character.entity.bx',
      match: '&(?:[A-Za-z][A-Za-z0-9]{1,31}|#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6});',
    },
    // `\}` and `\{` are the only escapes markup text has (`parse_nodes`), and
    // every other backslash is a backslash — so a Windows path and a regexp
    // survive being written in running text and must not be painted.
    'text-escape': {
      name: 'constant.character.escape.bx',
      match: '\\\\[{}]',
    },
    // The braces that open and close a `$` block's body. They are painted as a
    // pair without being tracked as one: see the header note above for why the
    // grammar stays flat.
    'block-punctuation': {
      name: 'punctuation.section.block.bx',
      match: '[{}]',
    },

    // ---- elements ---------------------------------------------------------
    'close-tag': {
      match: `(</)(${NAME})?\\s*(>)`,
      captures: {
        1: { name: 'punctuation.definition.tag.begin.bx' },
        2: { name: 'entity.name.tag.bx' },
        3: { name: 'punctuation.definition.tag.end.bx' },
      },
    },
    'element-component': {
      begin: `(<)(${COMPONENT})(?![A-Za-z0-9_.:-])`,
      beginCaptures: {
        1: { name: 'punctuation.definition.tag.begin.bx' },
        2: { name: 'entity.name.tag.component.bx' },
      },
      end: '(/>)|(>)',
      endCaptures: {
        1: { name: 'punctuation.definition.tag.end.bx' },
        2: { name: 'punctuation.definition.tag.end.bx' },
      },
      patterns: [{ include: '#component-attributes' }],
    },
    element: {
      begin: `(<)(${NAME})`,
      beginCaptures: {
        1: { name: 'punctuation.definition.tag.begin.bx' },
        2: { name: 'entity.name.tag.bx' },
      },
      end: '(/>)|(>)',
      endCaptures: {
        1: { name: 'punctuation.definition.tag.end.bx' },
        2: { name: 'punctuation.definition.tag.end.bx' },
      },
      patterns: [{ include: '#tag-attributes' }],
    },

    // ---- what sits between a tag name and its `>` -------------------------
    'tag-attributes': {
      patterns: [
        { include: '#attr-event' },
        { include: '#attr-binding' },
        { include: '#attr-reserved-value' },
        { include: '#attr-reserved-bare' },
        { include: '#attr-unknown-namespace' },
        { include: '#attr-inline-handler' },
        { include: '#attr-boolean-string' },
        { include: '#attr-expr' },
        { include: '#attr-string' },
        { include: '#attr-boolean' },
        { include: '#attr-name' },
      ],
    },
    // A component tag takes its parameters by their Beans names, and latte's
    // rules for it are not the element rules: `on:` is refused because a
    // component reports an event through a Callback parameter (`on_click={…}`),
    // `attrs` and `preserve` belong to elements, and a parameter name that is
    // not a Beans identifier — anything with a `-` or a `:` in it — is refused
    // by name. Painting a component's `on:click` as an ordinary handler would
    // be the grammar telling the author the opposite of what latte will.
    'component-attributes': {
      patterns: [
        { include: '#attr-component-event' },
        { include: '#attr-component-forbidden' },
        { include: '#attr-reserved-value' },
        { include: '#attr-reserved-bare' },
        { include: '#attr-component-bad-name' },
        { include: '#attr-expr' },
        { include: '#attr-string' },
        { include: '#attr-name' },
      ],
    },
    'attr-component-event': {
      name: 'invalid.illegal.event-on-component.bx',
      match: `\\b(?:on|bind):${IDENT}${ATTR_VALUE}`,
    },
    'attr-component-forbidden': {
      name: 'invalid.illegal.element-attribute-on-component.bx',
      match: `\\b(?:attrs|preserve)\\b${ATTR_VALUE}`,
    },
    // `is_beans_identifier` in latte's lex.b: letters, digits and underscore.
    'attr-component-bad-name': {
      name: 'invalid.illegal.not-a-parameter-name.bx',
      match: `\\b${IDENT}[.:-][A-Za-z0-9_.:-]*${ATTR_VALUE}`,
    },
    // `on:click={fn(e: MouseEvent) { ... }}`. The event name is checked against
    // latte's own table, so `on:clik` is painted as the error latte will
    // report rather than as an attribute nobody notices.
    'attr-event': {
      patterns: [
        {
          begin: `\\b(on)(:)(${alt(bx.events.map((e) => e.event))})\\b\\s*(=)\\s*(\\{)`,
          beginCaptures: {
            1: { name: 'entity.other.attribute-name.event.bx' },
            2: { name: 'punctuation.separator.namespace.bx' },
            3: { name: 'entity.other.attribute-name.event.bx' },
            4: { name: 'punctuation.separator.key-value.bx' },
            5: { name: 'punctuation.section.embedded.begin.bx' },
          },
          end: '(\\})',
          endCaptures: { 1: { name: 'punctuation.section.embedded.end.bx' } },
          patterns: [{ include: '#braces' }, { include: 'source.beans' }],
        },
        {
          name: 'invalid.illegal.unknown-event.bx',
          match: `\\b(?:on)(?::)${IDENT}\\b${ATTR_VALUE}`,
        },
      ],
    },
    // `bind:value={self.note}`, `bind:value.int={self.n}`, `bind:checked={…}`.
    // Only `bind:value` takes a conversion, which is the vocabulary's rule and
    // not this file's.
    'attr-binding': {
      patterns: [
        {
          begin: `\\b(bind)(:)(${bindKnown})\\s*(=)\\s*(\\{)`,
          beginCaptures: {
            1: { name: 'entity.other.attribute-name.binding.bx' },
            2: { name: 'punctuation.separator.namespace.bx' },
            3: { name: 'entity.other.attribute-name.binding.bx' },
            4: { name: 'punctuation.separator.key-value.bx' },
            5: { name: 'punctuation.section.embedded.begin.bx' },
          },
          end: '(\\})',
          endCaptures: { 1: { name: 'punctuation.section.embedded.end.bx' } },
          patterns: [{ include: '#braces' }, { include: 'source.beans' }],
        },
        {
          name: 'invalid.illegal.unknown-binding.bx',
          match: `\\b(?:bind)(?::)[A-Za-z0-9_.]+${ATTR_VALUE}`,
        },
      ],
    },
    // latte's own attributes. None of them reaches the wire, which is why they
    // are painted apart from the attributes that do.
    'attr-reserved-value': {
      begin: `\\b(${alt(reservedValued)})\\s*(=)\\s*(\\{)`,
      beginCaptures: {
        1: { name: 'keyword.other.attribute.reserved.bx' },
        2: { name: 'punctuation.separator.key-value.bx' },
        3: { name: 'punctuation.section.embedded.begin.bx' },
      },
      end: '(\\})',
      endCaptures: { 1: { name: 'punctuation.section.embedded.end.bx' } },
      patterns: [{ include: '#braces' }, { include: 'source.beans' }],
    },
    'attr-reserved-bare': {
      name: 'keyword.other.attribute.reserved.bx',
      match: `\\b(?:${alt(reservedBare)})\\b(?!\\s*[=:.-])`,
    },
    // A colon in an attribute name means a namespace, and latte's list is an
    // allowlist: a mistyped `bnd:value` stays an error instead of becoming an
    // attribute literally called `bnd:value` in the page (`is_xml_namespace`).
    'attr-unknown-namespace': {
      name: 'invalid.illegal.unknown-namespace.bx',
      match: `\\b(?!(?:${alt(allNamespaces)}):)${IDENT}:[A-Za-z0-9_.:-]+${ATTR_VALUE}`,
    },
    // latte refuses **every** attribute whose name is three bytes or longer and
    // starts with `on` (`is_inline_handler_attribute`), not just the ones HTML
    // defines: an inline handler exists only as an id and the client never
    // evaluates a string, so `onclick="alert(1)"` is refused rather than
    // dropped quietly. `once` and `only` are refused by the same rule, and the
    // message says to rename them. On a component tag the rule does not apply,
    // which is why this lives in the element attribute set alone.
    'attr-inline-handler': {
      name: 'invalid.illegal.inline-handler.bx',
      match: `\\b(?i:on)[A-Za-z0-9_.-]{1,}${ATTR_VALUE}`,
    },
    // `disabled="false"` is a *disabled* control in every browser, so latte
    // refuses the string form of a boolean attribute outright. The expression
    // form `disabled={cond}` is accepted and #attr-expr paints it.
    'attr-boolean-string': {
      name: 'invalid.illegal.boolean-attribute-string.bx',
      match: `\\b(?:${alt(bx.booleanAttributes)})\\s*=\\s*"[^"]*"`,
    },
    // `href={self.url}` — a Beans expression as the value. The body holds
    // braces of its own, so #braces swallows every balanced pair and the
    // attribute ends on the one that is left.
    'attr-expr': {
      begin: `\\b(${NAME})\\s*(=)\\s*(\\{)`,
      beginCaptures: {
        1: { name: 'entity.other.attribute-name.bx' },
        2: { name: 'punctuation.separator.key-value.bx' },
        3: { name: 'punctuation.section.embedded.begin.bx' },
      },
      end: '(\\})',
      endCaptures: { 1: { name: 'punctuation.section.embedded.end.bx' } },
      patterns: [{ include: '#braces' }, { include: 'source.beans' }],
    },
    // `class="counter"` — bytes, passed through. There is no `$` in attribute
    // position and no interpolation in a literal: `{}` delimits an expression
    // and `$` marks one, and an attribute value is already delimited. Single
    // quotes are not a form latte has, so they are not painted as one.
    'attr-string': {
      match: `\\b(${NAME})\\s*(=)\\s*(")([^"]*)(")`,
      captures: {
        1: { name: 'entity.other.attribute-name.bx' },
        2: { name: 'punctuation.separator.key-value.bx' },
        3: { name: 'punctuation.definition.string.begin.bx' },
        4: { name: 'string.quoted.double.bx', patterns: [{ include: '#entity' }] },
        5: { name: 'punctuation.definition.string.end.bx' },
      },
    },
    // A boolean attribute is present or absent, never a string —
    // `disabled="false"` is a *disabled* control in every browser, and latte
    // refuses the string form. Painted apart so the difference is visible
    // before the compiler says it. The lookahead keeps `open="x"` out: that is
    // the refusal's case, and #attr-string paints it as what was written.
    'attr-boolean': {
      name: 'entity.other.attribute-name.boolean.bx',
      match: `\\b(?:${alt(bx.booleanAttributes)})\\b(?!\\s*=)`,
    },
    'attr-name': {
      patterns: [
        {
          match: `\\b(${alt(xmlNamespaces)})(:)(${NAME})`,
          captures: {
            1: { name: 'entity.other.attribute-name.namespace.bx' },
            2: { name: 'punctuation.separator.namespace.bx' },
            3: { name: 'entity.other.attribute-name.bx' },
          },
        },
        { name: 'entity.other.attribute-name.bx', match: `\\b${NAME}` },
      ],
    },

    // ---- raw-text elements -------------------------------------------------
    // `<script>` and `<style>` hold no markup. latte refuses an expression in
    // one, and that is a security control rather than a diagnostic: the
    // serializer escapes for HTML text, and HTML escaping inside a script is
    // no defence because `</script>` closes the element from inside a
    // JavaScript string. So the body is handed to the embedded language and
    // never to the markup rules.
    ...Object.fromEntries(
      bx.rawTextElements.map((tag) => [
        `raw-${tag}`,
        {
          // The whole open tag in the `begin`, so the body is the region's
          // content and nothing has to be sequenced inside it. `(?<!/)` before
          // the `>` keeps a self-closed `<script/>` out: latte reads that as an
          // element with no body, and a region opened on one would swallow the
          // rest of the file looking for a close tag that is not coming. When
          // the open tag is broken over lines this rule does not match and
          // #element paints it — the body then reads as markup, which is wrong
          // but bounded, where a runaway region is not.
          begin: `(<)(${tag})\\b([^>]*?)(?<!/)(>)`,
          beginCaptures: {
            1: { name: 'punctuation.definition.tag.begin.bx' },
            2: { name: 'entity.name.tag.bx' },
            3: { patterns: [{ include: '#tag-attributes' }] },
            4: { name: 'punctuation.definition.tag.end.bx' },
          },
          end: `(</)(${tag})\\s*(>)`,
          endCaptures: {
            1: { name: 'punctuation.definition.tag.begin.bx' },
            2: { name: 'entity.name.tag.bx' },
            3: { name: 'punctuation.definition.tag.end.bx' },
          },
          contentName: `meta.embedded.block.${tag}`,
          patterns: [{ include: RAW_TEXT_EMBED[tag] }],
        },
      ]),
    ),

    // ---- `$` transitions ---------------------------------------------------
    // A `$` is a transition only when the next character starts an identifier
    // or is `(` or `{` (`dollar_starts_transition`), so `$5.00`, `US$`, `$ 20`
    // and a trailing `$` are text and no rule here matches them.
    transition: {
      patterns: [
        { include: '#escape-dollar' },
        { include: '#block-header' },
        { include: '#block-else' },
        { include: '#slot' },
        { include: '#raw-html' },
        { include: '#expr-group' },
        { include: '#expr-braced' },
        { include: '#expr-chain' },
      ],
    },
    'escape-dollar': {
      name: 'constant.character.escape.bx',
      match: '\\$\\$',
    },
    // `$if c { }`, `$for row: Row in self.rows { }`, `$match v { }`. The
    // header runs to the first `{` that is not inside parentheses, brackets or
    // a string, which is what #group and #brackets are for — without them a
    // closure in a header would end it at the closure's own brace.
    'block-header': {
      begin: `(\\$)(${alt(headerWords)})\\b`,
      beginCaptures: {
        1: { name: 'punctuation.definition.keyword.bx' },
        2: { name: 'keyword.control.bx' },
      },
      end: '(\\{)',
      endCaptures: { 1: { name: 'punctuation.section.block.bx' } },
      contentName: 'meta.embedded.line.beans',
      patterns: [
        { include: '#group' },
        { include: '#brackets' },
        { include: 'source.beans' },
      ],
    },
    // `else` and `else if`, written without a `$` because they continue the
    // `$if` that opened the block. The lookahead is what keeps the English
    // word in running text from being painted as a keyword.
    'block-else': {
      patterns: [
        {
          begin: '\\b(else)\\s+(if)\\b',
          beginCaptures: {
            1: { name: 'keyword.control.bx' },
            2: { name: 'keyword.control.bx' },
          },
          end: '(\\{)',
          endCaptures: { 1: { name: 'punctuation.section.block.bx' } },
          contentName: 'meta.embedded.line.beans',
          patterns: [
            { include: '#group' },
            { include: '#brackets' },
            { include: 'source.beans' },
          ],
        },
        { name: 'keyword.control.bx', match: '\\b(?:else)\\b(?=\\s*\\{)' },
      ],
    },
    // `$slot`, `$slot(expr)`, `$slot:name`, `$slot:name as …`. The forms after
    // `as` are left to the ordinary markup rules: a `(expr)` is painted by
    // #group, and `p: Type {` reads as text and its brace as block
    // punctuation. Painting the typed-parameter form would need the parser's
    // "a body is what tells a definition from a placement" rule, which is not
    // a distinction a regex can make.
    slot: {
      patterns: [
        {
          begin: '(\\$)(slot)(?=\\()',
          beginCaptures: {
            1: { name: 'punctuation.definition.keyword.bx' },
            2: { name: 'keyword.control.bx' },
          },
          end: '(?<=\\))',
          contentName: 'meta.embedded.line.beans',
          patterns: [{ include: '#group' }],
        },
        {
          match: `(\\$)(slot)(:)(${IDENT})(?:\\s+(as)\\b)?`,
          captures: {
            1: { name: 'punctuation.definition.keyword.bx' },
            2: { name: 'keyword.control.bx' },
            3: { name: 'punctuation.separator.namespace.bx' },
            4: { name: 'variable.other.fragment.bx' },
            5: { name: 'keyword.control.bx' },
          },
        },
        {
          match: '(\\$)(slot)\\b',
          captures: {
            1: { name: 'punctuation.definition.keyword.bx' },
            2: { name: 'keyword.control.bx' },
          },
        },
      ],
    },
    // `$html(expr)` — unescaped HTML, the only bypass latte has, named so it
    // greps. Painted as a keyword rather than a call for the same reason.
    'raw-html': {
      begin: '(\\$)(html)(?=\\()',
      beginCaptures: {
        1: { name: 'punctuation.definition.keyword.bx' },
        2: { name: 'keyword.other.unsafe.bx' },
      },
      end: '(?<=\\))',
      contentName: 'meta.embedded.line.beans',
      patterns: [{ include: '#group' }],
    },
    // `$(a + b)` — a parenthesised expression, escaped on the way out.
    'expr-group': {
      begin: '(\\$)(?=\\()',
      beginCaptures: { 1: { name: 'punctuation.definition.template-expression.begin.bx' } },
      end: '(?<=\\))',
      contentName: 'meta.embedded.line.beans',
      patterns: [{ include: '#group' }],
    },
    // `${ let total: int = a + b }` — statements, no markup inside.
    'expr-braced': {
      begin: '(\\$)(\\{)',
      beginCaptures: {
        1: { name: 'punctuation.definition.template-expression.begin.bx' },
        2: { name: 'punctuation.section.embedded.begin.bx' },
      },
      end: '(\\})',
      endCaptures: { 1: { name: 'punctuation.section.embedded.end.bx' } },
      contentName: 'meta.embedded.line.beans',
      patterns: [{ include: '#braces' }, { include: 'source.beans' }],
    },
    // `$self.count`, `$row.title`, `$self.rows[0]`, `$self.clock.now()`. The
    // chain continues through `.name`, `(args)` and `[i]` with no space
    // between and stops at the first character that cannot continue it
    // (`end_of_chain`), so `$user.name (active)` ends before the space. The
    // groups are matched one level deep, which covers `$f(g(x))`; a deeper
    // nest ends the paint early and nothing else.
    'expr-chain': {
      match:
        `(\\$)(${IDENT}` +
        `(?:\\.${IDENT}` +
        '|\\((?:[^()]|\\([^()]*\\))*\\)' +
        '|\\[(?:[^\\[\\]]|\\[[^\\[\\]]*\\])*\\]' +
        ')*)',
      captures: {
        1: { name: 'punctuation.definition.template-expression.begin.bx' },
        2: {
          name: 'meta.embedded.line.beans',
          patterns: [{ include: 'source.beans' }],
        },
      },
    },
    // A `$match` arm's pattern, which sits at markup level between the match's
    // `{` and the arm body's own. Anchored to the start of a line and required
    // to end in `=> {`, because that is a shape running text does not have;
    // an arm written inline on one line with its match is left as text rather
    // than risking a rule that fires inside prose.
    'match-arm': {
      match: '^\\s*([^<>${}\\n]+?)\\s*(=>)\\s*(?=\\{)',
      captures: {
        1: {
          name: 'meta.embedded.line.beans',
          patterns: [{ include: 'source.beans' }],
        },
        2: { name: 'keyword.operator.arrow.beans' },
      },
    },

    // ---- balanced helpers --------------------------------------------------
    // One balanced `( ... )`, `[ ... ]` or `{ ... }`, each self-including, so
    // an embedded expression can hold a whole function body without its first
    // closing byte ending the region. They are listed before `source.beans` at
    // every use site: at the same offset the earlier pattern wins, and
    // `source.beans`'s punctuation rule would otherwise take the open byte as
    // one character and leave the region unbalanced.
    group: {
      begin: '\\(',
      beginCaptures: { 0: { name: 'punctuation.section.parens.beans' } },
      end: '\\)',
      endCaptures: { 0: { name: 'punctuation.section.parens.beans' } },
      patterns: [
        { include: '#group' },
        { include: '#brackets' },
        { include: 'source.beans' },
      ],
    },
    brackets: {
      begin: '\\[',
      beginCaptures: { 0: { name: 'punctuation.section.brackets.beans' } },
      end: '\\]',
      endCaptures: { 0: { name: 'punctuation.section.brackets.beans' } },
      patterns: [
        { include: '#group' },
        { include: '#brackets' },
        { include: 'source.beans' },
      ],
    },
    braces: {
      begin: '\\{',
      beginCaptures: { 0: { name: 'punctuation.section.braces.beans' } },
      end: '\\}',
      endCaptures: { 0: { name: 'punctuation.section.braces.beans' } },
      patterns: [{ include: '#braces' }, { include: 'source.beans' }],
    },
  };

  return {
    $schema:
      'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    $generated: BX_GENERATED_BANNER,
    name: `${data.language.name} Markup`,
    scopeName: 'source.beans.bx',
    fileTypes: ['bx'],
    patterns: [{ include: '#markup' }],
    repository,
  };
}
