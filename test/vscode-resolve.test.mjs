// Compiler resolution: the order, and the awkward paths.
//
// Runs against the compiled extension (`vscode/out/beansc.js`), so it tests
// what actually ships. `src/beansc.ts` imports nothing from `vscode` exactly
// so this can be a plain `node --test` run instead of a headless editor.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const compiled = join(here, '..', 'vscode', 'out', 'beansc.js');

if (!existsSync(compiled)) {
  throw new Error(
    `${compiled} is missing — run \`npm --workspace beans-vscode run build\` first.`,
  );
}

const require = createRequire(import.meta.url);
const { resolveBeansc, expandPath, CompilerNotFoundError, notFoundMessage, notFoundDetail } =
  require(compiled);

/** A fake filesystem: only the listed paths exist and are executable. */
const fs = (...paths) => {
  const set = new Set(paths);
  return (candidate) => set.has(candidate);
};

const base = {
  env: {},
  workspaceFolders: [],
  searchDevelopmentPaths: true,
  platform: 'linux',
};

describe('resolution order', () => {
  test('the setting wins over everything else', () => {
    const r = resolveBeansc({
      ...base,
      settingPath: '/opt/beans/beansc',
      env: { BEANSC: '/env/beansc', PATH: '/usr/bin' },
      isExecutableFile: fs('/opt/beans/beansc', '/env/beansc', '/usr/bin/beansc'),
    });
    assert.equal(r.command, '/opt/beans/beansc');
    assert.equal(r.source, 'setting');
    assert.deepEqual(r.args, ['lsp']);
  });

  test('a setting that points at nothing is an error, not a fallback', () => {
    // Silently starting a different compiler than the one configured would
    // be worse than failing.
    assert.throws(
      () =>
        resolveBeansc({
          ...base,
          settingPath: '/opt/beans/beansc',
          env: { PATH: '/usr/bin' },
          isExecutableFile: fs('/usr/bin/beansc'),
        }),
      CompilerNotFoundError,
    );
  });

  test('BEANSC comes next', () => {
    const r = resolveBeansc({
      ...base,
      env: { BEANSC: '/env/beansc', PATH: '/usr/bin' },
      isExecutableFile: fs('/env/beansc', '/usr/bin/beansc'),
    });
    assert.equal(r.command, '/env/beansc');
    assert.equal(r.source, 'environment');
  });

  test('an unset BEANSC does not shadow PATH', () => {
    const r = resolveBeansc({
      ...base,
      env: { BEANSC: '', PATH: '/usr/bin' },
      isExecutableFile: fs('/usr/bin/beansc'),
    });
    assert.equal(r.source, 'path');
  });

  test('the normal Unix installer location beats PATH', () => {
    const installed = '/home/jane/.beans/bin/beansc';
    const r = resolveBeansc({
      ...base,
      env: { HOME: '/home/jane', PATH: '/usr/bin' },
      isExecutableFile: fs(installed, '/usr/bin/beansc'),
    });
    assert.equal(r.command, installed);
    assert.equal(r.source, 'installation');
  });

  test('BEANS_HOME is checked before the default installer location', () => {
    const installed = '/opt/my beans/bin/beansc';
    const r = resolveBeansc({
      ...base,
      env: { BEANS_HOME: '/opt/my beans', HOME: '/home/jane' },
      isExecutableFile: fs(installed, '/home/jane/.beans/bin/beansc'),
    });
    assert.equal(r.command, installed);
    assert.equal(r.source, 'installation');
  });

  test('a compiler at the workspace root beats PATH', () => {
    const r = resolveBeansc({
      ...base,
      env: { PATH: '/usr/bin' },
      workspaceFolders: ['/work/app'],
      isExecutableFile: fs('/work/app/beansc', '/usr/bin/beansc'),
    });
    assert.equal(r.command, '/work/app/beansc');
    assert.equal(r.source, 'workspace');
  });

  test('PATH is searched in order', () => {
    const r = resolveBeansc({
      ...base,
      env: { PATH: '/empty:/usr/local/bin:/usr/bin' },
      isExecutableFile: fs('/usr/local/bin/beansc', '/usr/bin/beansc'),
    });
    assert.equal(r.command, '/usr/local/bin/beansc');
  });

  test('a development build is the last resort', () => {
    const r = resolveBeansc({
      ...base,
      env: { PATH: '/usr/bin' },
      workspaceFolders: ['/work/editors'],
      isExecutableFile: fs('/work/beans/build/beansc'),
    });
    assert.equal(r.command, '/work/beans/build/beansc');
    assert.equal(r.source, 'development');
  });

  test('the sibling checkout layout resolves', () => {
    // editors/ and beans/ side by side is how this repository is used.
    const r = resolveBeansc({
      ...base,
      workspaceFolders: ['/home/dev/beans-lang/editors'],
      isExecutableFile: fs('/home/dev/beans-lang/beans/build/beansc'),
    });
    assert.equal(r.command, '/home/dev/beans-lang/beans/build/beansc');
  });

  test('development paths can be switched off', () => {
    assert.throws(
      () =>
        resolveBeansc({
          ...base,
          searchDevelopmentPaths: false,
          workspaceFolders: ['/work/editors'],
          isExecutableFile: fs('/work/beans/build/beansc'),
        }),
      CompilerNotFoundError,
    );
  });

  test('nothing anywhere reports what was tried', () => {
    try {
      resolveBeansc({
        ...base,
        env: { PATH: '/usr/bin' },
        workspaceFolders: ['/work'],
        isExecutableFile: fs(),
      });
      assert.fail('expected CompilerNotFoundError');
    } catch (error) {
      assert.ok(error instanceof CompilerNotFoundError);
      assert.ok(error.searched.includes('/usr/bin/beansc'));
      assert.ok(error.searched.includes(join('/work', 'beansc')));
      assert.match(notFoundMessage(), /beans\.compiler\.path/);
      assert.match(notFoundDetail(error), /\/usr\/bin\/beansc/);
    }
  });
});

describe('paths with spaces', () => {
  // The compiler is spawned directly, never through a shell, so a path with
  // spaces must survive verbatim — no quoting, no escaping, no splitting.
  const spaced = '/Users/jane doe/My Projects/beans lang/build/beansc';

  test('a setting containing spaces is used verbatim', () => {
    const r = resolveBeansc({
      ...base,
      settingPath: spaced,
      isExecutableFile: fs(spaced),
    });
    assert.equal(r.command, spaced);
    assert.ok(!r.command.includes('"'));
    assert.ok(!r.command.includes('\\ '));
  });

  test('BEANSC containing spaces is used verbatim', () => {
    const r = resolveBeansc({ ...base, env: { BEANSC: spaced }, isExecutableFile: fs(spaced) });
    assert.equal(r.command, spaced);
  });

  test('a workspace folder containing spaces resolves', () => {
    const folder = '/Users/jane doe/My Projects/app';
    const r = resolveBeansc({
      ...base,
      workspaceFolders: [folder],
      isExecutableFile: fs(join(folder, 'beansc')),
    });
    assert.equal(r.command, join(folder, 'beansc'));
  });

  test('a development build under a spaced folder resolves', () => {
    const folder = '/Users/jane doe/beans lang/editors';
    const target = resolve(folder, '..', 'beans', 'build', 'beansc');
    const r = resolveBeansc({ ...base, workspaceFolders: [folder], isExecutableFile: fs(target) });
    assert.equal(r.command, target);
    assert.ok(r.command.includes('beans lang'));
  });

  test('a PATH entry containing spaces resolves', () => {
    const dir = '/opt/my tools/bin';
    const r = resolveBeansc({
      ...base,
      env: { PATH: `/usr/bin:${dir}` },
      isExecutableFile: fs(join(dir, 'beansc')),
    });
    assert.equal(r.command, join(dir, 'beansc'));
  });

  test('a relative setting resolves against a spaced workspace folder', () => {
    const folder = '/Users/jane doe/app';
    const r = resolveBeansc({
      ...base,
      settingPath: 'tools/beansc',
      workspaceFolders: [folder],
      isExecutableFile: fs(join(folder, 'tools', 'beansc')),
    });
    assert.equal(r.command, join(folder, 'tools', 'beansc'));
  });
});

describe('path expansion', () => {
  test('${workspaceFolder} is substituted', () => {
    assert.equal(
      expandPath('${workspaceFolder}/build/beansc', ['/work/app']),
      join('/work/app', 'build', 'beansc'),
    );
  });

  test('~ expands to the home directory', () => {
    assert.equal(expandPath('~/bin/beansc', [], '/home/jane'), join('/home/jane', 'bin', 'beansc'));
  });

  test('a bare ~ expands', () => {
    assert.equal(expandPath('~', [], '/home/jane'), '/home/jane');
  });

  test('surrounding whitespace is trimmed', () => {
    assert.equal(expandPath('  /opt/beansc  ', []), '/opt/beansc');
  });

  test('an absolute path is left alone', () => {
    assert.equal(expandPath('/opt/beans lang/beansc', ['/work']), '/opt/beans lang/beansc');
  });

  test('an empty value stays empty', () => {
    assert.equal(expandPath('   ', ['/work']), '');
  });
});

describe('windows', () => {
  test('the normal Windows installer location is checked directly', () => {
    const installed = join('C:\\Users\\Jane\\AppData\\Local', 'Beans', 'bin', 'beansc.exe');
    const r = resolveBeansc({
      ...base,
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\Jane\\AppData\\Local' },
      isExecutableFile: fs(installed),
    });
    assert.equal(r.command, installed);
    assert.equal(r.source, 'installation');
  });

  test('beansc.exe is preferred on win32', () => {
    const r = resolveBeansc({
      ...base,
      platform: 'win32',
      workspaceFolders: [`C:${sep}work`],
      isExecutableFile: fs(join(`C:${sep}work`, 'beansc.exe')),
    });
    assert.ok(r.command.endsWith('beansc.exe'));
  });

  test('an extensionless beansc is still accepted on win32', () => {
    const r = resolveBeansc({
      ...base,
      platform: 'win32',
      workspaceFolders: [`C:${sep}work`],
      isExecutableFile: fs(join(`C:${sep}work`, 'beansc')),
    });
    assert.ok(r.command.endsWith('beansc'));
  });
});

describe('the launch command', () => {
  test('is always `beansc lsp` with no shell metacharacters added', () => {
    const r = resolveBeansc({ ...base, settingPath: '/opt/beansc', isExecutableFile: fs('/opt/beansc') });
    assert.deepEqual(r.args, ['lsp']);
    assert.equal(r.args.length, 1);
  });
});
