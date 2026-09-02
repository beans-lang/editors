// Builds the VS Code TextMate grammar from shared/language.json.
//
// TextMate highlighting is the "instant" layer: it paints a `.b` file the
// moment it opens, before `beansc lsp` has started. Anything that needs real
// name resolution is the server's job and arrives as semantic tokens.

import { GENERATED_BANNER, wordAlternation, builtinTypeNames } from './language-data.mjs';

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
 * The `.bx` grammar: Beans with tag expressions in it.
 *
 * It is a thin layer over `source.beans` rather than a copy of it. A `.bx`
 * file *is* a Beans file — bx/DESIGN.md says so in as many words, and its
 * compiler copies everything outside a tag through untouched — so the tag
 * rules go first and everything else falls through to the Beans grammar by
 * scope name. Nothing here has to be kept in step with the Beans grammar,
 * because none of it is repeated here.
 *
 * Which `<` opens a tag is bx/compile.b's decision and this mirrors it
 * exactly, both halves:
 *
 *   1. the byte after `<` starts a name, so `n < 10` is a comparison;
 *   2. the byte before `<` does not end one, so `List<string>`, `xs[i]<n`
 *      and `f()<n` keep their `<` as an operator.
 *
 * What is left over is `a <b`, a comparison with a space on one side only.
 * bx reads that as a tag and so does this — painting it as a comparison
 * would hide an error the compiler is about to report.
 */
export function buildBxTmLanguage(data) {
  const TAG = '[A-Za-z_][A-Za-z0-9_]*';
  // Rule 2: what may not sit immediately before a tag's `<`.
  const NOT_AFTER = '(?<![A-Za-z0-9_\\)\\]])';
  const ATTR = '[A-Za-z_][A-Za-z0-9_]*(?:[-/][A-Za-z0-9_./]+)*';

  return {
    $schema:
      'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    $generated: GENERATED_BANNER,
    name: `${data.language.name} Markup`,
    scopeName: 'source.beans.bx',
    fileTypes: ['bx'],
    patterns: [{ include: '#tag' }, { include: 'source.beans' }],
    repository: {
      tag: {
        patterns: [{ include: '#tag-close' }, { include: '#tag-open' }],
      },
      'tag-close': {
        match: `(</)(${TAG})?\\s*(>)`,
        captures: {
          1: { name: 'punctuation.definition.tag.begin.bx' },
          2: { name: 'entity.name.tag.bx' },
          3: { name: 'punctuation.definition.tag.end.bx' },
        },
      },
      'tag-open': {
        begin: `${NOT_AFTER}(<)(${TAG})`,
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

      // ---- what sits between the tag name and its `>` --------------------
      'tag-attributes': {
        patterns: [
          { include: 'source.beans#comment' },
          { include: '#attr-handler' },
          { include: '#attr-expr' },
          { include: '#attr-text' },
          { include: '#attr-name' },
        ],
      },
      // `on:click={fn(e, f, c) { ... }}` — a listener. The body is Beans and
      // holds braces of its own, so #braces swallows every balanced pair and
      // the block ends on the one that is left.
      'attr-handler': {
        begin: `\\b(on)(:)(${ATTR})\\s*(=)\\s*(\\{)`,
        beginCaptures: {
          1: { name: 'entity.other.attribute-name.event.bx' },
          2: { name: 'punctuation.separator.event.bx' },
          3: { name: 'entity.other.attribute-name.event.bx' },
          4: { name: 'punctuation.separator.key-value.bx' },
          5: { name: 'punctuation.section.embedded.begin.bx' },
        },
        end: '(\\})',
        endCaptures: { 1: { name: 'punctuation.section.embedded.end.bx' } },
        patterns: [{ include: '#braces' }, { include: 'source.beans' }],
      },
      // `w={my_width}` — an ordinary Beans expression as the value.
      'attr-expr': {
        begin: `\\b(${ATTR})\\s*(=)\\s*(\\{)`,
        beginCaptures: {
          1: { name: 'entity.other.attribute-name.bx' },
          2: { name: 'punctuation.separator.key-value.bx' },
          3: { name: 'punctuation.section.embedded.begin.bx' },
        },
        end: '(\\})',
        endCaptures: { 1: { name: 'punctuation.section.embedded.end.bx' } },
        patterns: [{ include: '#braces' }, { include: 'source.beans' }],
      },
      // `bg="red"` — a quoted value, resolved by bx at compile time.
      'attr-text': {
        match: `\\b(${ATTR})\\s*(=)\\s*(")([^"]*)(")`,
        captures: {
          1: { name: 'entity.other.attribute-name.bx' },
          2: { name: 'punctuation.separator.key-value.bx' },
          3: { name: 'punctuation.definition.string.begin.bx' },
          4: { name: 'string.quoted.double.bx' },
          5: { name: 'punctuation.definition.string.end.bx' },
        },
      },
      // `flex`, `gap-2`, `m-neg-4`, `w-1/2` — a flag or a family and a step.
      'attr-name': {
        match: `\\b(${ATTR})`,
        captures: { 1: { name: 'entity.other.attribute-name.bx' } },
      },
      // One balanced `{ ... }`, so an embedded expression can hold a whole
      // function body without its first `}` ending the attribute.
      braces: {
        begin: '\\{',
        beginCaptures: { 0: { name: 'punctuation.section.braces.beans' } },
        end: '\\}',
        endCaptures: { 0: { name: 'punctuation.section.braces.beans' } },
        patterns: [{ include: '#braces' }, { include: 'source.beans' }],
      },
    },
  };
}
