// End-to-end against the real `beansc lsp`.
//
// This is the test that proves the client contract: the compiler is found by
// the shipped resolver, spawned directly with `lsp` and no shell, speaks
// LSP over stdio, and advertises the capabilities the editors rely on.
//
// It also runs the whole thing from a directory whose name contains spaces,
// because that is where "we pass the path to a shell somewhere" would show up.
//
// Skips when no compiler can be found, so a clone without a beans checkout
// still has a green suite.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const editorsRoot = join(here, '..');
const compiled = join(editorsRoot, 'vscode', 'out', 'beansc.js');

const require = createRequire(import.meta.url);
const { resolveBeansc } = require(compiled);

/** Finds a compiler the same way the extension does. */
function findCompiler() {
  try {
    return resolveBeansc({
      env: process.env,
      workspaceFolders: [editorsRoot],
      searchDevelopmentPaths: true,
    });
  } catch {
    return null;
  }
}

const resolution = findCompiler();
const skip = resolution === null ? 'no beansc found — build it in the beans repository' : false;

if (resolution === null) {
  // A `skip:` line so the suite runner reports this as skipped rather than
  // passed. node:test's own SKIP output does not distinguish the two in a way
  // the runner can see, and a skip counted as a pass overstates coverage.
  console.log('skip: no beansc found — the LSP smoke test needs a built compiler.');
}

// ---- a minimal LSP client over stdio ---------------------------------------

class StdioClient {
  constructor(command, args) {
    this.proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Explicitly not a shell. A spaced path must work as-is.
      shell: false,
    });
    this.buffer = Buffer.alloc(0);
    this.messages = [];
    this.waiters = [];
    this.stderr = '';
    this.proc.stdout.on('data', (chunk) => this.#onData(chunk));
    this.proc.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString();
    });
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString('ascii');
      const match = /Content-Length: *(\d+)/i.exec(header);
      if (match === null) return;
      const length = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return;
      const body = this.buffer.subarray(start, start + length).toString('utf8');
      this.buffer = this.buffer.subarray(start + length);
      const message = JSON.parse(body);
      this.messages.push(message);
      for (const waiter of this.waiters.splice(0)) waiter();
    }
  }

  send(message) {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    this.proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.proc.stdin.write(body);
  }

  /** Waits for a message matching `predicate`, or rejects after `timeoutMs`. */
  async waitFor(predicate, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.messages.find(predicate);
      if (hit !== undefined) return hit;
      if (this.proc.exitCode !== null) {
        throw new Error(`server exited (${this.proc.exitCode}); stderr: ${this.stderr}`);
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timed out waiting for a message');
      await new Promise((done) => {
        const timer = setTimeout(done, Math.min(50, remaining));
        this.waiters.push(() => {
          clearTimeout(timer);
          done();
        });
      });
    }
  }

  reply(id) {
    return this.waitFor((m) => m.id === id);
  }

  async close() {
    this.send({ jsonrpc: '2.0', id: 9999, method: 'shutdown' });
    await this.reply(9999).catch(() => {});
    this.send({ jsonrpc: '2.0', method: 'exit' });
    return new Promise((done) => {
      const timer = setTimeout(() => {
        this.proc.kill();
        done(null);
      }, 5000);
      this.proc.on('exit', (code) => {
        clearTimeout(timer);
        done(code);
      });
    });
  }
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    processId: null,
    rootUri: null,
    capabilities: {
      textDocument: {
        synchronization: { dynamicRegistration: false },
        completion: { completionItem: { snippetSupport: false } },
        hover: { contentFormat: ['markdown', 'plaintext'] },
        semanticTokens: { requests: { full: true }, tokenTypes: [], tokenModifiers: [], formats: [] },
        rename: { prepareSupport: true },
      },
    },
  },
};

// A file whose name has a space, opened from a directory that has one too.
let workdir;
let sourcePath;
let sourceUri;

const GOOD = [
  'fn add(a: int, b: int) -> int {',
  '    return a + b',
  '}',
  '',
  'fn main() {',
  '    let y: int = add(1, 2)',
  '}',
  '',
].join('\n');

const BROKEN = GOOD.replace('let y: int = add(1, 2)', 'let y: int = nope');

describe('beansc lsp', { skip }, () => {
  let client;

  before(async () => {
    workdir = mkdtempSync(join(tmpdir(), 'beans editors test '));
    sourcePath = join(workdir, 'my file.b');
    sourceUri = pathToFileURL(sourcePath).href;

    client = new StdioClient(resolution.command, resolution.args);
    client.send(INITIALIZE);
    await client.reply(1);
    client.send({ jsonrpc: '2.0', method: 'initialized', params: {} });
  });

  after(async () => {
    if (client !== undefined) await client.close();
    if (workdir !== undefined) rmSync(workdir, { recursive: true, force: true });
  });

  test('the resolver found a real executable', () => {
    assert.ok(existsSync(resolution.command), `${resolution.command} should exist`);
    assert.deepEqual(resolution.args, ['lsp']);
  });

  test('initialize advertises every capability the clients rely on', async () => {
    const initialized = await client.reply(1);
    const caps = initialized.result.capabilities;

    // Incremental sync: the client sends ranges, and the server applies them
    // to the buffer it keeps. Older stage-0 servers answer 1 (full text) and
    // the client copes, so this only asserts the shape it got.
    const sync = caps.textDocumentSync;
    const syncKind = typeof sync === 'number' ? sync : sync.change;
    assert.ok(syncKind === 1 || syncKind === 2, `document sync kind: ${syncKind}`);
    assert.equal(caps.hoverProvider, true);
    assert.equal(caps.definitionProvider, true);
    assert.equal(caps.referencesProvider, true);
    assert.equal(caps.documentSymbolProvider, true);
    assert.ok(caps.completionProvider, 'completionProvider');
    assert.ok(caps.signatureHelpProvider, 'signatureHelpProvider');
    assert.ok(caps.semanticTokensProvider, 'semanticTokensProvider');
    assert.equal(caps.renameProvider.prepareProvider, true);

    // Everything shared/language.json claims the shipped server provides must
    // actually be advertised. The list is the contract the clients render
    // menus from; a stale entry is a menu item that does nothing.
    const shipped = require(join(editorsRoot, 'shared', 'language.json'));
    const providerOf = (entry) => entry.split(' ')[0];
    for (const claim of shipped.languageServer.capabilities) {
      const name = providerOf(claim);
      if (name === 'textDocumentSync') continue;
      assert.ok(
        caps[name],
        `shared/language.json claims ${name} but the server does not advertise it`,
      );
    }

    // The trigger characters and semantic-token legend recorded in
    // shared/language.json come from here.
    assert.deepEqual(caps.completionProvider.triggerCharacters, ['.']);
    assert.deepEqual(caps.signatureHelpProvider.triggerCharacters, ['(', ',']);

    // Not an equality check. The bootstrap C++ compiler and the self-hosted
    // compiler advertise different legends, so the clients ship styles for the
    // union and the server picks from it. What must hold is that the running
    // server never sends a token type no client has a style for.
    const shared = require(join(editorsRoot, 'shared', 'language.json'));
    const known = new Set(shared.languageServer.semanticTokens.all);
    const advertised = caps.semanticTokensProvider.legend.tokenTypes;
    const unmapped = advertised.filter((t) => !known.has(t));
    assert.deepEqual(
      unmapped,
      [],
      `the server advertises semantic token type(s) the editors do not style: ${unmapped}. ` +
        'Add them to languageServer.semanticTokens.all in shared/language.json.',
    );

    assert.equal(initialized.result.serverInfo.name, 'beansc');
  });

  test('a broken buffer produces a diagnostic while typing', async () => {
    client.send({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: { uri: sourceUri, languageId: 'beans', version: 1, text: BROKEN },
      },
    });
    const published = await client.waitFor(
      (m) => m.method === 'textDocument/publishDiagnostics' && m.params.uri === sourceUri,
    );
    assert.ok(published.params.diagnostics.length > 0, 'expected at least one diagnostic');
    assert.match(published.params.diagnostics[0].message, /nope/);
  });

  test('fixing the buffer clears the diagnostics', async () => {
    client.messages.length = 0;
    client.send({
      jsonrpc: '2.0',
      method: 'textDocument/didChange',
      params: {
        textDocument: { uri: sourceUri, version: 2 },
        contentChanges: [{ text: GOOD }],
      },
    });
    const published = await client.waitFor(
      (m) => m.method === 'textDocument/publishDiagnostics' && m.params.uri === sourceUri,
    );
    assert.deepEqual(published.params.diagnostics, []);
  });

  test('hover renders a signature', async () => {
    client.send({
      jsonrpc: '2.0',
      id: 10,
      method: 'textDocument/hover',
      params: { textDocument: { uri: sourceUri }, position: { line: 0, character: 3 } },
    });
    const hover = await client.reply(10);
    assert.match(hover.result.contents.value, /fn add/);
  });

  test('completion offers members after a dot', async () => {
    // A user class, not a builtin. Member completion on builtin receivers
    // (`string`, `List<T>`) works in the bootstrap C++ server but not in the
    // self-hosted one, so asserting it here would pass or fail depending on
    // which compiler build the developer has. See the README's known issues.
    const withMembers = [
      'class Point {',
      '    x: int',
      '    fn norm2() -> int { return self.x }',
      '}',
      'fn main() {',
      '    let p: Point = new Point(1, 2)',
      '    p.',
      '}',
      '',
    ].join('\n');
    client.send({
      jsonrpc: '2.0',
      method: 'textDocument/didChange',
      params: {
        textDocument: { uri: sourceUri, version: 3 },
        contentChanges: [{ text: withMembers }],
      },
    });
    client.send({
      jsonrpc: '2.0',
      id: 11,
      method: 'textDocument/completion',
      params: { textDocument: { uri: sourceUri }, position: { line: 6, character: 6 } },
    });
    const completion = await client.reply(11);
    const items = completion.result.items ?? completion.result;
    const labels = items.map((i) => i.label);
    assert.ok(labels.includes('x'), `expected the field, got ${labels.slice(0, 8)}`);
    assert.ok(labels.includes('norm2'), `expected the method, got ${labels.slice(0, 8)}`);
  });

  test('signature help reports the active parameter', async () => {
    client.send({
      jsonrpc: '2.0',
      method: 'textDocument/didChange',
      params: {
        textDocument: { uri: sourceUri, version: 4 },
        contentChanges: [{ text: GOOD }],
      },
    });
    client.send({
      jsonrpc: '2.0',
      id: 12,
      method: 'textDocument/signatureHelp',
      params: { textDocument: { uri: sourceUri }, position: { line: 5, character: 21 } },
    });
    const help = await client.reply(12);
    assert.ok(help.result.signatures.length > 0);
    assert.match(help.result.signatures[0].label, /add\(a: int, b: int\)/);
    assert.equal(help.result.activeParameter, 0);
  });

  test('definition points at the declaration', async () => {
    client.send({
      jsonrpc: '2.0',
      id: 13,
      method: 'textDocument/definition',
      params: { textDocument: { uri: sourceUri }, position: { line: 5, character: 18 } },
    });
    const definition = await client.reply(13);
    const location = Array.isArray(definition.result) ? definition.result[0] : definition.result;
    assert.equal(location.range.start.line, 0);

    // The server builds location URIs as `"file://" + path` without
    // percent-encoding (beans/compiler/bootstrap/lspserver.cpp — path_to_uri),
    // so a path with a space comes back as `file:///a b/c.b` rather than
    // `file:///a%20b/c.b`. Both editors' URI parsers accept that, so the
    // comparison here is on the decoded path. See the README's known-issues
    // section — the fix belongs in the compiler.
    assert.equal(
      decodeURIComponent(location.uri).replace(/^file:\/\//, ''),
      sourcePath,
      'definition should point back at the same file',
    );
  });

  test('references find the declaration and the call', async () => {
    client.send({
      jsonrpc: '2.0',
      id: 14,
      method: 'textDocument/references',
      params: {
        textDocument: { uri: sourceUri },
        position: { line: 0, character: 3 },
        context: { includeDeclaration: true },
      },
    });
    const references = await client.reply(14);
    assert.equal(references.result.length, 2);
  });

  test('document symbols list the functions', async () => {
    client.send({
      jsonrpc: '2.0',
      id: 15,
      method: 'textDocument/documentSymbol',
      params: { textDocument: { uri: sourceUri } },
    });
    const symbols = await client.reply(15);
    const names = symbols.result.map((s) => s.name);
    assert.ok(names.includes('add'));
    assert.ok(names.includes('main'));
  });

  test('semantic tokens come back in the five-integer encoding', async () => {
    client.send({
      jsonrpc: '2.0',
      id: 16,
      method: 'textDocument/semanticTokens/full',
      params: { textDocument: { uri: sourceUri } },
    });
    const tokens = await client.reply(16);
    const data = tokens.result.data;
    assert.ok(data.length > 0);
    assert.equal(data.length % 5, 0);
  });

  test('rename edits every occurrence', async () => {
    client.send({
      jsonrpc: '2.0',
      id: 17,
      method: 'textDocument/prepareRename',
      params: { textDocument: { uri: sourceUri }, position: { line: 0, character: 3 } },
    });
    const prepared = await client.reply(17);
    assert.ok(prepared.result, 'prepareRename should accept the name');

    client.send({
      jsonrpc: '2.0',
      id: 18,
      method: 'textDocument/rename',
      params: {
        textDocument: { uri: sourceUri },
        position: { line: 0, character: 3 },
        newName: 'sum',
      },
    });
    const renamed = await client.reply(18);
    const edits = Object.values(renamed.result.changes)[0];
    assert.equal(edits.length, 2);
    assert.ok(edits.every((e) => e.newText === 'sum'));
  });

  test('the server survives temporarily invalid source', async () => {
    client.send({
      jsonrpc: '2.0',
      method: 'textDocument/didChange',
      params: {
        textDocument: { uri: sourceUri, version: 5 },
        contentChanges: [{ text: 'fn main() {\n    let x: int = \n' }],
      },
    });
    // Still answering requests afterwards is the point.
    client.send({
      jsonrpc: '2.0',
      id: 19,
      method: 'textDocument/documentSymbol',
      params: { textDocument: { uri: sourceUri } },
    });
    const after = await client.reply(19);
    assert.ok(after.result !== undefined, 'server should still answer after a broken buffer');
  });
});

describe('a compiler path containing spaces', { skip }, () => {
  let dir;
  let copied;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'beans compiler dir '));
    copied = join(dir, 'beansc');
    copyFileSync(resolution.command, copied);
    chmodSync(copied, 0o755);
    // Release installs use a small `beansc` launcher beside `beansc.real`.
    // Keep that pair together when the spaced-path fixture copies it.
    const payload = `${resolution.command}.real`;
    if (existsSync(payload)) {
      copyFileSync(payload, `${copied}.real`);
      chmodSync(`${copied}.real`, 0o755);
    }
  });

  after(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  });

  test('is resolved and launched without a shell', async () => {
    assert.ok(copied.includes(' '), 'the fixture path should contain a space');

    const found = resolveBeansc({
      settingPath: copied,
      env: {},
      workspaceFolders: [],
      searchDevelopmentPaths: false,
    });
    assert.equal(found.command, copied);

    const client = new StdioClient(found.command, found.args);
    try {
      client.send(INITIALIZE);
      const initialized = await client.reply(1);
      assert.ok(initialized.result.capabilities, 'a spaced path must still start the server');
      assert.equal(initialized.result.serverInfo.name, 'beansc');
    } finally {
      await client.close();
    }
  });
});
