// Builds the VS Code TextMate grammar from shared/language.json.
//
// TextMate highlighting is the "instant" layer: it paints a `.b` file the
// moment it opens, before `beansc lsp` has started. Anything that needs real
// name resolution is the server's job and arrives as semantic tokens.

import { GENERATED_BANNER, wordAlternation, builtinTypeNames } from './language-data.mjs';

const IDENT = '[A-Za-z_][A-Za-z0-9_]*';

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
          { include: '#string' },
          { include: '#number' },
          { include: '#package' },
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
        name: 'constant.character.escape.beans',
        match: '\\\\[ntr0\\\\"{}]',
      },
      'string-escape-invalid': {
        name: 'invalid.illegal.unknown-escape.beans',
        match: '\\\\.',
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

      import: {
        patterns: [
          {
            match: `\\b(import)\\s+([A-Za-z_][A-Za-z0-9_./-]*)(?:\\s+(as)\\s+(${IDENT}))?`,
            captures: {
              1: { name: 'keyword.control.import.beans' },
              2: { name: 'entity.name.namespace.beans' },
              3: { name: 'keyword.control.import.beans' },
              4: { name: 'entity.name.namespace.alias.beans' },
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
          {
            name: 'storage.modifier.beans',
            match: '\\bunique\\b(?=\\s+(?:class))',
          },
          {
            name: 'storage.modifier.beans',
            match: '\\bpacked\\b(?=\\s+(?:struct|union))',
          },
          { name: 'storage.modifier.beans', match: '\\balign\\b(?=\\s*\\()' },
          { name: 'storage.modifier.beans', match: '\\bfeature\\b(?=\\s*")' },
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
