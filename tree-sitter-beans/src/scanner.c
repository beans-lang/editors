// External scanner for Beans block comments.
//
// `/* ... */` nests in Beans, so the closing delimiter cannot be found with a
// regular expression — the scanner has to count depth, exactly like
// Lexer::skip_block_comment in beans/compiler/bootstrap/lexer.cpp.
//
// An unterminated comment runs to end of input rather than failing. That is
// what the compiler's lexer does (it consumes to EOF and reports "block
// comment never closed"), and in an editor it keeps the rest of the buffer
// looking like the comment it is instead of flashing as broken code.

#include "tree_sitter/parser.h"

enum TokenType {
  BLOCK_COMMENT,
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

bool tree_sitter_beans_external_scanner_scan(void *payload, TSLexer *lexer,
                                             const bool *valid_symbols) {
  (void)payload;

  if (!valid_symbols[BLOCK_COMMENT]) return false;

  while (is_space(lexer->lookahead)) skip(lexer);

  return scan_block_comment(lexer);
}
