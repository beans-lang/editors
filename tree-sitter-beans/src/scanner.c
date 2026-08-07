// External scanner for Beans block comments and the two contextual keywords
// that need lookahead.
//
// `/* ... */` nests in Beans, so the closing delimiter cannot be found with a
// regular expression — the scanner has to count depth, exactly like
// Lexer::skip_block_comment in beans/compiler/bootstrap/lexer.cpp.
//
// `async` and `await` are not reserved. The compiler decides what they are by
// looking at the next token, and so does this scanner: producing them as
// ordinary identifiers unless the following text says otherwise is what keeps
// a field, parameter or local called `async` or `await` working. A regular
// expression cannot express that — tree-sitter's token regexes have no
// lookahead, and any token that swallowed the word after `async` would hide it
// from the grammar.
//
// An unterminated comment runs to end of input rather than failing. That is
// what the compiler's lexer does (it consumes to EOF and reports "block
// comment never closed"), and in an editor it keeps the rest of the buffer
// looking like the comment it is instead of flashing as broken code.

#include "tree_sitter/parser.h"

enum TokenType {
  BLOCK_COMMENT,
  ASYNC_MODIFIER,
  AWAIT_OPERATOR,
};

void *tree_sitter_beans_external_scanner_create(void) { return NULL; }

void tree_sitter_beans_external_scanner_destroy(void *payload) { (void)payload; }

unsigned tree_sitter_beans_external_scanner_serialize(void *payload, char *buffer) {
  (void)payload;
  (void)buffer;
  return 0;
}

void tree_sitter_beans_external_scanner_deserialize(void *payload, const char *buffer,
                                                    unsigned length) {
  (void)payload;
  (void)buffer;
  (void)length;
}

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }
static inline void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

static inline bool is_space(uint32_t c) {
  return c == ' ' || c == '\t' || c == '\r' || c == '\n';
}

/**
 * Same-line spacing. Both lookaheads below stop at a newline because the
 * compiler does: a newline after a token that can end a statement ends it, and
 * `async` and `await` are identifier tokens, so `await` at end of line is a
 * name and whatever starts the next line is a new statement.
 */
static inline bool is_blank(uint32_t c) { return c == ' ' || c == '\t'; }

static inline bool is_ident_char(uint32_t c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
         c == '_';
}

/** Consumes `word` if it is next. Position is only meaningful when true. */
static bool take_word(TSLexer *lexer, const char *word) {
  for (const char *p = word; *p != '\0'; p++) {
    if (lexer->lookahead != (uint32_t)*p) return false;
    advance(lexer);
  }
  return true;
}

static bool scan_block_comment(TSLexer *lexer) {
  if (lexer->lookahead != '/') return false;
  advance(lexer);
  if (lexer->lookahead != '*') return false;
  advance(lexer);

  unsigned depth = 1;
  while (depth > 0) {
    if (lexer->eof(lexer)) {
      // Unterminated: take the rest of the file, same as the compiler.
      break;
    }
    if (lexer->lookahead == '/') {
      advance(lexer);
      if (lexer->lookahead == '*') {
        advance(lexer);
        depth++;
      }
    } else if (lexer->lookahead == '*') {
      advance(lexer);
      if (lexer->lookahead == '/') {
        advance(lexer);
        depth--;
      }
    } else {
      advance(lexer);
    }
  }

  lexer->result_symbol = BLOCK_COMMENT;
  return true;
}

/**
 * `async` is a modifier only immediately before `fn` or `let` — the exact pair
 * Parser::parse_decl and Parser::parse_stmt test for. `async: int` is a field,
 * `async = 1` an assignment, `async` alone a name.
 */
static bool scan_async_modifier(TSLexer *lexer) {
  if (!take_word(lexer, "sync")) return false;
  if (is_ident_char(lexer->lookahead)) return false;
  lexer->mark_end(lexer);

  if (!is_blank(lexer->lookahead)) return false;
  while (is_blank(lexer->lookahead)) advance(lexer);

  if (!take_word(lexer, "fn") && !take_word(lexer, "let")) return false;
  if (is_ident_char(lexer->lookahead)) return false;

  lexer->result_symbol = ASYNC_MODIFIER;
  return true;
}

/**
 * `await` is a prefix operator only when a space and then the start of an
 * expression follow it on the same line. The compiler knows more — it accepts
 * `await` only inside an async body — but a syntax grammar cannot see that, so
 * the remaining ambiguity is resolved the safe way: `await(x)`, `await.field`,
 * `await = 1` and `await,` all stay an ordinary name, because reading a name
 * as a keyword is the error that actually breaks a file's highlighting.
 */
static bool scan_await_operator(TSLexer *lexer) {
  if (!take_word(lexer, "wait")) return false;
  if (is_ident_char(lexer->lookahead)) return false;
  lexer->mark_end(lexer);

  if (!is_blank(lexer->lookahead)) return false;
  while (is_blank(lexer->lookahead)) advance(lexer);

  // An operand starts with a name (`x`, `self`, `new`, `move`), or a `(`.
  uint32_t c = lexer->lookahead;
  bool starts_expression =
      (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_' || c == '(';
  if (!starts_expression) return false;

  lexer->result_symbol = AWAIT_OPERATOR;
  return true;
}

bool tree_sitter_beans_external_scanner_scan(void *payload, TSLexer *lexer,
                                             const bool *valid_symbols) {
  (void)payload;

  const bool want_async = valid_symbols[ASYNC_MODIFIER];
  const bool want_await = valid_symbols[AWAIT_OPERATOR];
  const bool want_comment = valid_symbols[BLOCK_COMMENT];

  if (!want_async && !want_await && !want_comment) return false;

  while (is_space(lexer->lookahead)) skip(lexer);

  if ((want_async || want_await) && lexer->lookahead == 'a') {
    advance(lexer);
    // `async` and `await` part ways at the second letter, so one look decides
    // which — the scanner never has to try both.
    if (want_async && lexer->lookahead == 's') return scan_async_modifier(lexer);
    if (want_await && lexer->lookahead == 'w') return scan_await_operator(lexer);
    return false;
  }

  return want_comment && scan_block_comment(lexer);
}
