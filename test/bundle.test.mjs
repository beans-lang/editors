// The packaged VS Code bundle.
//
// `vscode-languageclient` is the extension's only runtime dependency, and in
// this npm workspace it is hoisted to the repository root. A `vsce package`
// that neither bundles nor vendors it produces a .vsix that installs fine and
// then fails to activate with "Cannot find module" — which is exactly what
// shipped before these tests existed.
//
// So: load the real bundle with only `vscode` stubbed out, and let every other
// import resolve for real. Anything missing shows up here instead of in a
// user's editor.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const editorsRoot = join(here, '..');
const vscodeDir = join(editorsRoot, 'vscode');
const require = createRequire(import.meta.url);

const pkg = JSON.parse(readFileSync(join(vscodeDir, 'package.json'), 'utf8'));
const bundlePath = join(vscodeDir, pkg.main.replace(/^\.\//, ''));

before(() => {
  if (!existsSync(bundlePath)) {
    execFileSync('npm', ['--workspace', 'beans-vscode', 'run', 'build'], {
      cwd: editorsRoot,
      stdio: 'inherit',
    });
  }
});

describe('packaging', () => {
  test('main points into the bundled output, not the tsc output', () => {
    // `out/` is for the type checker and the resolution tests; `dist/` is what
    // ships. Pointing `main` at `out/` would ship unbundled requires.
    assert.match(pkg.main, /^\.\/dist\//);
  });

  test('.vscodeignore excludes the sources but keeps the bundle', () => {
    const ignore = readFileSync(join(vscodeDir, '.vscodeignore'), 'utf8');
    assert.match(ignore, /^src\/\*\*$/m);
    assert.match(ignore, /^out\/\*\*$/m);
    assert.ok(!/^dist/m.test(ignore), 'dist/ must ship');
  });

  test('the bundle exists after a build', () => {
    assert.ok(existsSync(bundlePath), `${pkg.main} should exist after \`npm run build\``);
  });
});

describe('the bundle', () => {
  test('loads with only `vscode` provided by the host', () => {
    // Run in a child process: loading the bundle mutates the module loader,
    // and a failure should not take the whole test run down.
    const script = `
      const Module = require('module');
      const original = Module._load;
      // Any property is a usable class or function, so \`extends\` works and
      // the CommonJS interop helpers see what they expect.
      const stub = new Proxy(function VSCode() {}, {
        get: () => stub,
        construct: () => ({}),
        apply: () => stub,
      });
      Module._load = function (request, parent, isMain) {
        if (request === 'vscode') return stub;
        return original.call(this, request, parent, isMain);
      };
      const extension = require(${JSON.stringify(bundlePath)});
      if (typeof extension.activate !== 'function') {
        throw new Error('the bundle does not export activate()');
      }
      if (typeof extension.deactivate !== 'function') {
        throw new Error('the bundle does not export deactivate()');
      }
    `;
    const result = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', stdio: 'pipe' });
    assert.equal(result.trim(), '');
  });

  test('has the language client compiled into it', () => {
    // A cheap, direct check that the dependency really is inlined rather than
    // left as a bare require.
    const source = readFileSync(bundlePath, 'utf8');
    assert.ok(
      source.includes('Content-Length'),
      'the LSP framing code from vscode-languageclient should be in the bundle',
    );
    assert.ok(
      !/require\(["']vscode-languageclient/.test(source),
      'vscode-languageclient must be bundled, not required at runtime',
    );
  });

  test('does not bundle the `vscode` module itself', () => {
    // It is provided by the editor; bundling a copy would be wrong and huge.
    const source = readFileSync(bundlePath, 'utf8');
    assert.ok(/require\(["']vscode["']\)/.test(source), '`vscode` should stay an external require');
  });
});
