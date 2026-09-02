// Builds the Tree-sitter query files that Zed reads.
//
// Only the lists come from shared/language.json — the structural patterns are
// written against node names in tree-sitter-beans/grammar.js. Keeping the two
// in one generator is what stops the keyword list and the grammar drifting
// apart.

import { GENERATED_BANNER, builtinTypeNames } from './language-data.mjs';

const banner = (name) => `; ${name}\n; ${GENERATED_BANNER}\n`;

const scmList = (items, capture, indent = '  ') =>
  items.length === 0
    ? ''
    : `[\n${items.map((k) => `${indent}"${k}"`).join('\n')}\n] ${capture}\n`;

// Some keywords are a rule's entire body in grammar.js, so tree-sitter makes
// them a named node instead of an anonymous token inside a larger rule. A
// query has to name the node — `"pub"` is not a node type, `(visibility_modifier)`
// is. Everything not listed here is an ordinary anonymous keyword token.
export const KEYWORD_NODES = {
  break: 'break_statement',
  continue: 'continue_statement',
  pub: 'visibility_modifier',
  static: 'static_modifier',
  override: 'override_modifier',
  unique: 'unique_modifier',
  packed: 'packed_modifier',
  opaque: 'opaque_modifier',
  // Highlighted by their own rules further up (`@variable.special`,
  // `@constant.builtin`) rather than as keywords, but listed here so the
  // coverage test can find where each reserved word is styled.
  self: 'self_expression',
  super: 'super_expression',
  true: 'boolean_literal',
  false: 'boolean_literal',
};

/** Emits a keyword group, splitting anonymous tokens from named-node keywords. */
/**
 * The contextual modifiers grammar.js has yet to learn, written into the
 * generated query as a comment so the gap is visible where it matters rather
 * than only in a tracker.
 */
const pendingModifiers = (ctx) => {
  const pending = ctx.modifiers.filter((m) => !GRAMMAR_CONTEXTUAL_MODIFIERS.has(m));
  if (pending.length === 0) return '';
  return (
    '; Not yet in tree-sitter-beans/grammar.js, so not yet queryable here:\n' +
    pending.map((w) => `;   ${w}`).join('\n') +
    '\n'
  );
};

const scmKeywords = (words, capture) => {
  const anonymous = words.filter((w) => !(w in KEYWORD_NODES));
  const nodes = words.filter((w) => w in KEYWORD_NODES);
  return (
    scmList(anonymous, capture) +
    nodes.map((w) => `(${KEYWORD_NODES[w]}) ${capture}\n`).join('')
  );
};

/**
 * The contextual modifiers `tree-sitter-beans/grammar.js` actually produces a
 * token for. A `.scm` query naming a token the grammar never emits does not
 * fail loudly — it takes the whole query file down with it, and Zed then has
 * no highlighting at all — so the ones the grammar has yet to learn are
 * listed as a comment instead of a query.
 *
 * Adding a word to grammar.js means adding it here. The VS Code TextMate
 * grammar has all of them already; this list is only about tree-sitter.
 */
const GRAMMAR_CONTEXTUAL_MODIFIERS = new Set([
  'unique', 'packed', 'align', 'feature', 'opaque',
]);

export function buildHighlights(data) {
  const kw = data.keywords.byRole;
  const ctx = data.contextualKeywords;
  const o = data.operators;

  const operators = [
    ...o.assignment, ...o.comparison, ...o.logical,
    ...o.arithmetic, ...o.bitwise, ...o.range,
  ];

  return `${banner('Beans syntax highlighting for Zed')}
; Comments -------------------------------------------------------------------
(line_comment) @comment
(block_comment) @comment
(doc_comment) @comment.doc

; Literals -------------------------------------------------------------------
(integer_literal) @number
(float_literal) @number
(boolean_literal) @constant.builtin
(string_literal) @string
; A raw literal holds no escapes and no interpolation: the whole token is
; string, braces and backslashes included.
(raw_string_literal) @string
(escape_sequence) @string.escape
(format_spec) @string.special

; An interpolated expression is code, not string text.
(interpolation
  "{" @punctuation.special
  "}" @punctuation.special)

; Types ----------------------------------------------------------------------
(primitive_type) @type.builtin
(type_identifier) @type
(scoped_type_identifier (identifier) @namespace)
(type_parameter name: (type_identifier) @type.parameter)

; Builtin types are ordinary capitalized names in the grammar, so they are
; matched by value rather than by node type.
((type_identifier) @type.builtin
  (#any-of? @type.builtin
${builtinTypeNames(data).map((t) => `    "${t}"`).join('\n')}))

; Declarations ---------------------------------------------------------------
(function_declaration name: (identifier) @function.definition)
(lambda_expression "fn" @keyword)
(parameter name: (identifier) @variable.parameter)
(field_declaration name: (identifier) @property)
(field_initializer name: (identifier) @property)
(enum_variant name: (identifier) @constant)
(variable_declaration name: (identifier) @variable)

(class_declaration name: (type_identifier) @type.definition)
(struct_declaration name: (type_identifier) @type.definition)
(union_declaration name: (type_identifier) @type.definition)
(interface_declaration name: (type_identifier) @type.definition)
(enum_declaration name: (type_identifier) @type.definition)

; Uses -----------------------------------------------------------------------
(call_expression
  function: (identifier) @function)
(call_expression
  function: (field_expression field: (identifier) @function.method))
(field_expression field: (identifier) @property)
(variant_pattern name: (identifier) @constructor)

(import_declaration path: (import_path) @string.special.path)
(import_declaration alias: (identifier) @namespace)

; The package clause names the package itself, so it reads like an import.
(package_declaration "package" @keyword.import)
(package_declaration name: (identifier) @namespace)

(layout_expression operator: _ @function.builtin)

; Keywords -------------------------------------------------------------------
${scmKeywords(kw.declaration, '@keyword')}
${scmKeywords(kw.control, '@keyword')}
${scmKeywords(kw.modifier, '@keyword.modifier')}
${scmKeywords(kw.relation, '@keyword.modifier')}
${scmKeywords(kw.operatorLike, '@keyword.operator')}
${scmKeywords(kw.import, '@keyword.import')}

(self_expression) @variable.special
(super_expression) @variable.special

; Contextual modifiers: highlighted only where the compiler treats them as
; modifiers. Everywhere else they are ordinary identifiers.
${scmKeywords(
  ctx.modifiers.filter((m) => m !== 'align' && GRAMMAR_CONTEXTUAL_MODIFIERS.has(m)),
  '@keyword.modifier',
)}
(align_modifier (align_keyword) @keyword.modifier)
${pendingModifiers(ctx)}

; The brew that starts a child fiber, anchored inside its own node so the
; TaskGroup method group.brew(...) stays an ordinary call.
(brew_keyword) @keyword

; Operators and punctuation --------------------------------------------------
${scmList(operators, '@operator')}
[
  "."
  ","
  ":"
  ";"
  "?"
  "=>"
  "->"
] @punctuation.delimiter

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

; Fallback: a bare identifier is a variable.
(identifier) @variable
`;
}

export function buildBrackets() {
  return `${banner('Beans bracket matching for Zed')}
("(" @open ")" @close)
("[" @open "]" @close)
("{" @open "}" @close)
("\\"" @open "\\"" @close)
`;
}

export function buildOutline() {
  return `${banner('Beans code outline for Zed')}
(function_declaration
  (visibility_modifier)? @context
  (static_modifier)? @context
  (override_modifier)? @context
  "fn" @context
  name: (identifier) @name) @item

(const_declaration
  (visibility_modifier)? @context
  "const" @context
  name: (identifier) @name) @item

(class_declaration
  (visibility_modifier)? @context
  (unique_modifier)? @context
  "class" @context
  name: (type_identifier) @name) @item

(struct_declaration
  (visibility_modifier)? @context
  "struct" @context
  name: (type_identifier) @name) @item

(union_declaration
  (visibility_modifier)? @context
  "union" @context
  name: (type_identifier) @name) @item

(interface_declaration
  (visibility_modifier)? @context
  "interface" @context
  name: (type_identifier) @name) @item

(enum_declaration
  (visibility_modifier)? @context
  "enum" @context
  name: (type_identifier) @name) @item

(field_declaration
  name: (identifier) @name) @item

(enum_variant
  name: (identifier) @name) @item

(doc_comment)+ @annotation
`;
}

export function buildIndents() {
  return `${banner('Beans auto-indentation for Zed')}
(block) @indent
(declaration_body) @indent
(enum_body) @indent
(match_block) @indent
(field_initializer_list) @indent
(map_literal) @indent
(list_literal) @indent
(argument_list) @indent
(parameter_list) @indent

[
  "}"
  ")"
  "]"
] @end
`;
}

export function buildInjections() {
  return `${banner('Beans language injections for Zed')}
; Inline assembly templates are assembly, not Beans strings.
((call_expression
   function: (field_expression field: (identifier) @_name)
   arguments: (argument_list . (string_literal) @injection.content))
 (#eq? @_name "value")
 (#set! injection.language "asm"))
`;
}

export function buildTextObjects() {
  return `${banner('Beans text objects for Zed')}
(function_declaration
  body: (_) @function.inside) @function.around

(lambda_expression
  body: (_) @function.inside) @function.around

(class_declaration
  body: (_) @class.inside) @class.around

(struct_declaration
  body: (_) @class.inside) @class.around

(interface_declaration
  body: (_) @class.inside) @class.around

(enum_declaration
  body: (_) @class.inside) @class.around

(line_comment) @comment.around
(doc_comment) @comment.around
(block_comment) @comment.around

(parameter) @parameter.inside
(argument_list (_) @parameter.inside)
`;
}

/**
 * Zed maps LSP semantic token types to theme styles. The compiler's legend
 * (beansc lsp) is short and all-standard, but shipping the mapping means a
 * Beans file looks right the moment semantic tokens are switched on.
 */
export function buildSemanticTokenRules(data) {
  const map = {
    type: ['type'],
    function: ['function'],
    method: ['function.method', 'function'],
    parameter: ['variable.parameter', 'variable'],
    variable: ['variable'],
    property: ['property', 'variable.member'],
    enum: ['type'],
    enumMember: ['constant'],
    keyword: ['keyword'],
  };
  // The union, not one implementation's legend: the bootstrap and self-hosted
  // compilers advertise different sets, and a user may have either build.
  return data.languageServer.semanticTokens.all.map((t) => ({
    token_type: t,
    style: map[t] ?? ['variable'],
  }));
}
