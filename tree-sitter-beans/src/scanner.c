// External scanner for Beans block comments and the contextual `brew`.
//
// `/* ... */` nests in Beans, so the closing delimiter cannot be found with a
// regular expression — the scanner has to count depth, exactly like
// Lexer::skip_block_comment in beans/compiler/bootstrap/lexer.cpp.
//
// An unterminated comment runs to end of input rather than failing. That is
// what the compiler's lexer does (it consumes to EOF and reports "block
// comment never closed"), and in an editor it keeps the rest of the buffer
// looking like the comment it is instead of flashing as broken code.
//
// `brew` is the second job. It starts a child fiber only directly before a
// call, and stays an ordinary name everywhere else — `var brew: int = 5`
// then `brew = brew + 1` is code the compiler accepts. A plain keyword token
// would win at statement start and break that, and tree-sitter's regular
// lexer cannot look past the word to decide. The scanner can: it emits the
// keyword only when a call really follows.
//
// A raw literal is the third. `r"…"`, `r#"…"#`, `r##"…"##`: the terminator
// is a quote followed by exactly as many hashes as the opener used, and a
// count is not something a regular expression holds. The body is bytes —
// nothing in it is an escape and nothing opens an interpolation — so the
// whole literal is one token. `r` is a prefix only when the quote follows
// it with nothing between, which is what keeps `str` and `ptr` names.

#include "tree_sitter/parser.h"

enum TokenType {
  BLOCK_COMMENT,
  BREW_KEYWORD,
  RAW_STRING_LITERAL,
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

static inline bool is_word(uint32_t c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
         (c >= '0' && c <= '9') || c == '_';
}

static inline bool is_name_start(uint32_t c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_';
}

// `brew`, but only when it starts a call: the word itself, then whitespace,
// then the first character of a callee name. `brew = brew + 1` fails the
// `=`, and `brew(1)` fails the missing whitespace — both fall back to the
// identifier the compiler reads there too.
static bool scan_brew_keyword(TSLexer *lexer) {
  static const char word[] = "brew";
  for (unsigned i = 0; i < sizeof word - 1; i++) {
    if (lexer->lookahead != (uint32_t)word[i]) return false;
    advance(lexer);
  }
  if (is_word(lexer->lookahead)) return false; // `brewery`, `brew2`
  if (!is_space(lexer->lookahead)) return false;

  // The token ends with the word; the rest is lookahead only.
  lexer->mark_end(lexer);
  while (is_space(lexer->lookahead)) advance(lexer);
  if (!is_name_start(lexer->lookahead)) return false;

  lexer->result_symbol = BREW_KEYWORD;
  return true;
}

// `r`, then n hashes, then a quote; the body runs to a quote followed by n
// hashes. Unterminated takes the rest of the file, the way an unterminated
// block comment does: in an editor the buffer keeps looking like the string
// it is instead of flashing as broken code.
static bool scan_raw_string(TSLexer *lexer) {
  if (lexer->lookahead != 'r') return false;
  advance(lexer);

  unsigned hashes = 0;
  while (lexer->lookahead == '#') {
    advance(lexer);
    hashes++;
  }
  if (lexer->lookahead != '"') return false;
  advance(lexer);

  for (;;) {
    if (lexer->eof(lexer)) break;
    if (lexer->lookahead == '"') {
      advance(lexer);
      unsigned seen = 0;
      while (seen < hashes && lexer->lookahead == '#') {
        advance(lexer);
        seen++;
      }
      if (seen == hashes) break;
    } else {
      advance(lexer);
    }
  }

  lexer->result_symbol = RAW_STRING_LITERAL;
  return true;
}

bool tree_sitter_beans_external_scanner_scan(void *payload, TSLexer *lexer,
                                             const bool *valid_symbols) {
  (void)payload;

  if (!valid_symbols[BLOCK_COMMENT] && !valid_symbols[BREW_KEYWORD] &&
      !valid_symbols[RAW_STRING_LITERAL])
    return false;

  while (is_space(lexer->lookahead)) skip(lexer);

  if (valid_symbols[RAW_STRING_LITERAL] && lexer->lookahead == 'r') {
    if (scan_raw_string(lexer)) return true;
    // Just a name that starts with `r`: leave it to the normal lexer.
    return false;
  }

  if (valid_symbols[BREW_KEYWORD] && lexer->lookahead == 'b') {
    if (scan_brew_keyword(lexer)) return true;
    // Not a brew that starts a call: leave the word to the normal lexer.
    return false;
  }

  if (!valid_symbols[BLOCK_COMMENT]) return false;

  return scan_block_comment(lexer);
}
