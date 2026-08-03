// Manifests and package metadata.
//
// These are the files nothing else validates: a typo in `extension.toml`, a
// grammar path that points nowhere, or a language id that does not match
// between the Zed config and the language-server entry all fail at install
// time in front of a user rather than in CI.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const editorsRoot = join(here, '..');
const require = createRequire(import.meta.url);

const readJson = (...parts) => JSON.parse(readFileSync(join(editorsRoot, ...parts), 'utf8'));
const readText = (...parts) => readFileSync(join(editorsRoot, ...parts), 'utf8');

const shared = readJson('shared', 'language.json');

/** Enough TOML for these manifests: `key = value` and `[section]` headers. */
function parseToml(text) {
  const root = {};
  let table = root;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/(^|\s)#.*$/, '').trim();
    if (line === '') continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header !== null) {
      table = root;
      for (const part of header[1].split('.')) {
        table[part] ??= {};
        table = table[part];
      }
      continue;
    }
    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (pair === null) continue;
    const [, key, raw] = pair;
    let value = raw.trim();
    if (value.startsWith('"')) value = value.slice(1, value.lastIndexOf('"'));
    else if (value.startsWith('[')) {
      value = [...value.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    } else if (value === 'true' || value === 'false') value = value === 'true';
    else if (/^-?\d+$/.test(value)) value = Number(value);
    table[key] = value;
  }
  return root;
}

describe('versioning', () => {
  const version = readJson('package.json').version;

  test('every manifest carries the same version', () => {
    // The release workflow refuses a tag that disagrees with
    // vscode/package.json, so a mismatch here would fail a release rather
    // than ship a half-bumped set of manifests.
    assert.equal(readJson('vscode', 'package.json').version, version, 'vscode/package.json');
    assert.equal(
      readJson('tree-sitter-beans', 'package.json').version,
      version,
      'tree-sitter-beans/package.json',
    );
    assert.equal(
      readJson('tree-sitter-beans', 'tree-sitter.json').metadata.version,
      version,
      'tree-sitter-beans/tree-sitter.json',
    );

    const zed = parseToml(readText('zed', 'extension.toml'));
    assert.equal(zed.version, version, 'zed/extension.toml');

    const cargo = parseToml(readText('zed', 'Cargo.toml'));
    assert.equal(cargo.package.version, version, 'zed/Cargo.toml');
  });

  test('the changelog has an entry for this version', () => {
    // Release notes are extracted from here, so a missing section means a
    // release with nothing to say.
    const changelog = readText('CHANGELOG.md');
    const heading = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm');
    assert.match(changelog, heading, `CHANGELOG.md needs a section for ${version}`);
  });
});

describe('shared language data', () => {
  test('records the exact 33 reserved keywords', () => {
    // The compiler's token.h says so in as many words: "tokens with reserved
    // keyword spellings (33; `unique` is contextual)".
    assert.equal(shared.keywords.reserved.length, 33);
    assert.ok(!shared.keywords.reserved.includes('unique'));
    assert.ok(shared.contextualKeywords.modifiers.includes('unique'));
  });

  test('every keyword appears in exactly one role', () => {
    const roles = Object.values(shared.keywords.byRole).flat();
    for (const keyword of shared.keywords.reserved) {
      const count = roles.filter((k) => k === keyword).length;
      assert.equal(count, 1, `${keyword} should appear in exactly one role, found ${count}`);
    }
    for (const keyword of roles) {
      assert.ok(
        shared.keywords.reserved.includes(keyword),
        `${keyword} has a role but is not reserved`,
      );
    }
  });

  test('names that only look like keywords are kept out', () => {
    for (const name of shared.notKeywords.names) {
      assert.ok(
        !shared.keywords.reserved.includes(name),
        `${name} is an ordinary name in Beans and must not be reserved`,
      );
    }
  });

  test('`.pot` is never claimed as a suffix', () => {
    // gettext owns `.pot`. Beans only owns the exact filename.
    assert.deepEqual(shared.language.fileExtensions, ['.b']);
    assert.deepEqual(shared.language.fileNames, ['beans.pot']);
  });

  test('the semantic token union covers both implementations', () => {
    const { bootstrap, selfHosted, all } = shared.languageServer.semanticTokens;
    for (const type of [...bootstrap.types, ...selfHosted.types]) {
      assert.ok(all.includes(type), `${type} is advertised by a compiler but not in \`all\``);
    }
  });

  test('the server is launched as `beansc lsp`', () => {
    assert.equal(shared.languageServer.command, 'beansc');
    assert.deepEqual(shared.languageServer.args, ['lsp']);
  });
});

describe('generated assets are in step with the shared data', () => {
  test('every generated file carries the do-not-edit banner', () => {
    const generated = [
      ['vscode', 'syntaxes', 'beans.tmLanguage.json'],
      ['vscode', 'syntaxes', 'beans-manifest.tmLanguage.json'],
      ['tree-sitter-beans', 'grammar-data.json'],
      ['zed', 'languages', 'beans', 'highlights.scm'],
      ['zed', 'languages', 'beans', 'brackets.scm'],
      ['zed', 'languages', 'beans', 'outline.scm'],
      ['zed', 'languages', 'beans', 'indents.scm'],
    ];
    for (const parts of generated) {
      const text = readText(...parts);
      assert.match(text, /generate\.mjs/, `${parts.join('/')} should say where it came from`);
    }
  });

  test('the TextMate grammar covers every reserved keyword', () => {
    const grammar = readText('vscode', 'syntaxes', 'beans.tmLanguage.json');
    for (const keyword of shared.keywords.reserved) {
      assert.ok(grammar.includes(keyword), `the TextMate grammar never mentions ${keyword}`);
    }
  });

  test('the Zed highlights query covers every reserved keyword', async () => {
    // Some keywords are a whole rule in grammar.js, so the query names the
    // node (`(visibility_modifier)`) instead of the token (`"pub"`). The
    // generator owns that mapping; the test reads it rather than repeating it.
    const { KEYWORD_NODES } = await import('../scripts/lib/queries.mjs');
    const highlights = readText('zed', 'languages', 'beans', 'highlights.scm');
    for (const keyword of shared.keywords.reserved) {
      const node = KEYWORD_NODES[keyword];
      const covered =
        highlights.includes(`"${keyword}"`) ||
        (node !== undefined && highlights.includes(`(${node})`));
      assert.ok(covered, `highlights.scm never highlights ${keyword}`);
    }
  });

  test('the grammar consumes the shared keyword list rather than its own', () => {
    const grammar = readText('tree-sitter-beans', 'grammar.js');
    assert.match(grammar, /require\('\.\/grammar-data\.json'\)/);
    const grammarData = readJson('tree-sitter-beans', 'grammar-data.json');
    assert.deepEqual(grammarData.keywords.reserved, shared.keywords.reserved);
  });

  test('the Zed semantic token rules cover the union', () => {
    const rules = readJson('zed', 'languages', 'beans', 'semantic_token_rules.json');
    const covered = rules.map((r) => r.token_type);
    assert.deepEqual(covered, shared.languageServer.semanticTokens.all);
    for (const rule of rules) {
      assert.ok(Array.isArray(rule.style) && rule.style.length > 0, `${rule.token_type} needs a style`);
    }
  });
});

describe('the VS Code extension manifest', () => {
  const pkg = readJson('vscode', 'package.json');

  test('registers `.b` for the beans language', () => {
    const beans = pkg.contributes.languages.find((l) => l.id === 'beans');
    assert.ok(beans);
    assert.deepEqual(beans.extensions, ['.b']);
    assert.equal(beans.id, shared.language.id);
  });

  test('claims beans.pot by exact filename and never by suffix', () => {
    const manifest = pkg.contributes.languages.find((l) => l.id === 'beans-manifest');
    assert.ok(manifest, 'there should be a separate language for the manifest');
    assert.deepEqual(manifest.filenames, ['beans.pot']);
    assert.equal(manifest.extensions, undefined, '`.pot` belongs to gettext');
    const serialized = JSON.stringify(pkg);
    assert.ok(!serialized.includes('".pot"'), 'nothing may register the `.pot` suffix');
  });

  test('every contributed file exists', () => {
    const paths = [
      ...pkg.contributes.languages.flatMap((l) => [
        l.configuration,
        l.icon?.light,
        l.icon?.dark,
      ]),
      ...pkg.contributes.grammars.map((g) => g.path),
    ].filter(Boolean);
    for (const relative of paths) {
      assert.ok(
        existsSync(join(editorsRoot, 'vscode', relative)),
        `${relative} is contributed but missing`,
      );
    }
  });

  test('declares the compiler path setting', () => {
    const properties = pkg.contributes.configuration.properties;
    assert.ok(properties['beans.compiler.path']);
    assert.equal(properties['beans.compiler.path'].default, '');
    assert.ok(properties['beans.trace.server']);
  });

  test('declares a restart command', () => {
    const ids = pkg.contributes.commands.map((c) => c.command);
    assert.ok(ids.includes('beans.restartLanguageServer'));
  });

  test('does not claim browser support', () => {
    // `beansc lsp` is a native executable.
    assert.equal(pkg.browser, undefined);
    assert.equal(pkg.capabilities.virtualWorkspaces.supported, false);
  });

  test('styles every semantic token type the compilers can send', () => {
    const scopes = pkg.contributes.semanticTokenScopes.find((s) => s.language === 'beans').scopes;
    for (const type of shared.languageServer.semanticTokens.all) {
      assert.ok(scopes[type], `no scope mapping for the semantic token type ${type}`);
    }
  });

  test('depends on vscode-languageclient and nothing that reimplements it', () => {
    assert.ok(pkg.dependencies['vscode-languageclient']);
    assert.equal(Object.keys(pkg.dependencies).length, 1);
  });

  test('the engine matches what the language client needs', () => {
    const client = require(join(editorsRoot, 'node_modules', 'vscode-languageclient', 'package.json'));
    assert.equal(pkg.engines.vscode, client.engines.vscode);
  });
});

describe('the Zed extension manifest', () => {
  const manifest = parseToml(readText('zed', 'extension.toml'));
  const config = parseToml(readText('zed', 'languages', 'beans', 'config.toml'));

  test('has the fields Zed requires', () => {
    for (const key of ['id', 'name', 'version', 'schema_version', 'authors', 'repository']) {
      assert.ok(manifest[key] !== undefined, `extension.toml is missing ${key}`);
    }
    assert.equal(manifest.schema_version, 1);
    assert.equal(manifest.id, shared.language.id);
  });

  test('the language config names the grammar the manifest declares', () => {
    assert.equal(config.grammar, 'beans');
    assert.ok(manifest.grammars.beans, 'extension.toml must declare [grammars.beans]');
  });

  test('the language server entry names the language exactly', () => {
    // Zed matches this against `name` in config.toml.
    assert.deepEqual(manifest.language_servers.beansc.languages, [config.name]);
    assert.equal(config.name, shared.language.name);
  });

  test('the language server id matches the one the Rust code reads', () => {
    const lib = readText('zed', 'src', 'lib.rs');
    assert.match(lib, /const SERVER_ID: &str = "beansc";/);
    assert.ok(manifest.language_servers.beansc, 'extension.toml must declare [language_servers.beansc]');
  });

  test('registers the `.b` suffix', () => {
    assert.deepEqual(
      config.path_suffixes,
      shared.language.fileExtensions.map((e) => e.replace(/^\./, '')),
    );
  });

  test('the grammar path points at a real grammar with a generated parser', () => {
    const grammar = manifest.grammars.beans;
    assert.equal(grammar.path, 'tree-sitter-beans');
    // Zed joins `path` then compiles `<path>/src/parser.c`.
    assert.ok(
      existsSync(join(editorsRoot, grammar.path, 'src', 'parser.c')),
      'the generated parser must be committed for Zed to build the grammar',
    );
  });

  test('the grammar revision is either a real SHA or an obvious placeholder', () => {
    // A plausible-looking but wrong SHA is worse than no SHA: it fails at
    // install time with a confusing checkout error.
    const { rev } = manifest.grammars.beans;
    const isSha = /^[0-9a-f]{40}$/i.test(rev);
    assert.ok(
      isSha || rev === 'UNPINNED',
      `rev must be a full SHA or the literal UNPINNED, got ${JSON.stringify(rev)}`,
    );
  });

  test('every query file Zed reads is present', () => {
    const dir = join(editorsRoot, 'zed', 'languages', 'beans');
    const present = readdirSync(dir);
    for (const file of ['config.toml', 'highlights.scm', 'brackets.scm', 'outline.scm', 'indents.scm']) {
      assert.ok(present.includes(file), `zed/languages/beans/${file} is missing`);
    }
  });

  test('the Rust crate builds a Wasm cdylib against the current API', () => {
    const cargo = parseToml(readText('zed', 'Cargo.toml'));
    assert.deepEqual(cargo.lib['crate-type'], ['cdylib']);
    assert.match(String(cargo.dependencies.zed_extension_api), /^0\.7\./);
  });

  test('the extension does not ship or download a language server', () => {
    // Zed's guidelines: locate one in the user's environment instead.
    const lib = readText('zed', 'src', 'lib.rs');
    assert.ok(!/download_file|latest_github_release/.test(lib));
    assert.match(lib, /worktree\.which/);
  });
});

describe('the tree-sitter package', () => {
  const pkg = readJson('tree-sitter-beans', 'package.json');

  test('is named and scoped for the `.b` suffix', () => {
    assert.equal(pkg.name, 'tree-sitter-beans');
    assert.deepEqual(pkg['tree-sitter'][0]['file-types'], ['b']);
    assert.equal(pkg['tree-sitter'][0].scope, 'source.beans');
  });

  test('ships the generated parser and the external scanner', () => {
    for (const file of ['src/parser.c', 'src/scanner.c', 'src/tree_sitter/parser.h']) {
      assert.ok(existsSync(join(editorsRoot, 'tree-sitter-beans', file)), `${file} is missing`);
    }
  });

  test('the external scanner exists because block comments nest', () => {
    const scanner = readText('tree-sitter-beans', 'src', 'scanner.c');
    assert.match(scanner, /tree_sitter_beans_external_scanner_scan/);
    assert.ok(shared.comments.blockNesting);
  });
});
