// The VS Code debugger wiring: compiler resolution, launch configuration, and
// starting the adapter for real.
//
// Runs against the compiled extension (`vscode/out/debug.js`), so it tests what
// ships. `src/debug.ts` imports nothing from `vscode` exactly so this can be a
// plain `node --test`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const editorsRoot = join(here, '..');
const compiled = join(editorsRoot, 'vscode', 'out', 'debug.js');
const resolver = join(editorsRoot, 'vscode', 'out', 'beansc.js');

if (!existsSync(compiled)) {
  throw new Error(
    `${compiled} is missing — run \`npm --workspace beans-vscode run build\` first.`,
  );
}

const require = createRequire(import.meta.url);
const {
  DEBUG_ADAPTER_ARGS,
  DEBUG_TYPE,
  adapterNotFoundMessage,
  completeConfiguration,
  initialConfiguration,
  NoProgramError,
  resolveDebugAdapter,
} = require(compiled);
const { CompilerNotFoundError } = require(resolver);

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

describe('resolving the debug adapter', () => {
  test('starts the same compiler as the language server, with debug-adapter', () => {
    const found = resolveDebugAdapter({
      ...base,
      settingPath: '/opt/beans/beansc',
      isExecutableFile: fs('/opt/beans/beansc'),
    });
    assert.equal(found.command, '/opt/beans/beansc');
    assert.deepEqual(found.args, ['debug-adapter']);
    assert.equal(found.source, 'setting');
  });

  test('follows the same search order, so both halves agree on one build', () => {
    const found = resolveDebugAdapter({
      ...base,
      env: { BEANSC: '/env/beansc' },
      isExecutableFile: fs('/env/beansc', '/work/beansc'),
      workspaceFolders: ['/work'],
    });
    assert.equal(found.command, '/env/beansc');
    assert.equal(found.source, 'environment');
  });

  test('a path containing spaces is carried through unquoted', () => {
    const spaced = '/Users/a person/tools/beansc';
    const found = resolveDebugAdapter({
      ...base,
      settingPath: spaced,
      isExecutableFile: fs(spaced),
    });
    assert.equal(found.command, spaced, 'the command must not be quoted or split');
    assert.deepEqual(found.args, ['debug-adapter']);
  });

  test('a missing compiler names what was tried', () => {
    let error;
    try {
      resolveDebugAdapter({
        ...base,
        env: { PATH: '/usr/local/bin' },
        workspaceFolders: ['/work'],
        isExecutableFile: () => false,
      });
    } catch (thrown) {
      error = thrown;
    }
    assert.ok(error instanceof CompilerNotFoundError, 'expected CompilerNotFoundError');
    const message = adapterNotFoundMessage(error);
    assert.match(message, /Cannot start the Beans debugger/);
    assert.match(message, /beans\.compiler\.path/);
    assert.ok(error.searched.length > 0, 'the error should list what was tried');
    assert.match(message, /\/work/, 'the message should name real locations');
  });
});

describe('launch configurations', () => {
  test('the offered configuration is the documented shape', () => {
    assert.deepEqual(initialConfiguration(), {
      type: 'beans',
      request: 'launch',
      name: 'Debug Beans Program',
      program: '${file}',
      cwd: '${workspaceFolder}',
      args: [],
      env: {},
      stopOnEntry: false,
    });
    assert.equal(DEBUG_TYPE, 'beans');
    assert.deepEqual([...DEBUG_ADAPTER_ARGS], ['debug-adapter']);
  });

  test('an empty configuration debugs the open Beans file', () => {
    const done = completeConfiguration(
      {},
      { activeFile: '/work/app/main.b', workspaceFolder: '/work' },
    );
    assert.equal(done.program, '/work/app/main.b');
    assert.equal(done.cwd, '/work');
    assert.equal(done.request, 'launch');
    assert.equal(done.stopOnEntry, false);
  });

  test('a relative program is resolved against the workspace folder', () => {
    const done = completeConfiguration(
      { program: 'examples/hello.b' },
      { workspaceFolder: '/work' },
    );
    assert.equal(done.program, resolve('/work', 'examples/hello.b'));
  });

  test('a path with spaces survives untouched', () => {
    const done = completeConfiguration(
      { program: '/Users/a person/code/my program.b' },
      { workspaceFolder: '/Users/a person/code' },
    );
    assert.equal(done.program, '/Users/a person/code/my program.b');
  });

  test('a VS Code variable is left for VS Code to substitute', () => {
    const done = completeConfiguration(
      { program: '${file}', cwd: '${workspaceFolder}' },
      { workspaceFolder: '/work' },
    );
    assert.equal(done.program, '${file}');
    assert.equal(done.cwd, '${workspaceFolder}');
  });

  test('args, env and stopOnEntry are normalized', () => {
    const done = completeConfiguration(
      {
        program: '/work/main.b',
        args: ['--fast', 7],
        env: { LEVEL: 3 },
        stopOnEntry: true,
      },
      { workspaceFolder: '/work' },
    );
    assert.deepEqual(done.args, ['--fast', '7']);
    assert.deepEqual(done.env, { LEVEL: '3' });
    assert.equal(done.stopOnEntry, true);
  });

  test('no program and no open file is an error, not a guess', () => {
    assert.throws(
      () => completeConfiguration({}, {}),
      (error) => error instanceof NoProgramError,
    );
  });
});

// ---------------------------------------------------------------------------
// The adapter really starts, from a path with spaces, without a shell
// ---------------------------------------------------------------------------

function beanscPath() {
  const fromEnv = process.env.BEANSC;
  // Absolute, because tests spawn the adapter with a different cwd.
  if (fromEnv !== undefined && existsSync(fromEnv)) return resolve(fromEnv);
  for (const candidate of [
    join(editorsRoot, '..', 'beans', 'build', 'beansc'),
    join(editorsRoot, '..', '..', 'beans', 'build', 'beansc'),
  ]) {
    if (existsSync(candidate)) return resolve(candidate);
  }
  return undefined;
}

/** One DAP request/response exchange against a freshly spawned adapter. */
function talk(command, args, request, { cwd } = {}) {
  return new Promise((resolvePromise, reject) => {
    // `spawn` with an argument array: no shell, so spaces cannot be re-split.
    const child = spawn(command, args, { cwd, shell: false });
    let out = Buffer.alloc(0);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('the adapter did not answer'));
    }, 30_000);
    child.stdout.on('data', (chunk) => {
      out = Buffer.concat([out, chunk]);
      const header = /Content-Length: (\d+)\r\n\r\n/.exec(out.toString('latin1'));
      if (header === null) return;
      const start = header.index + header[0].length;
      const length = Number(header[1]);
      if (out.length < start + length) return;
      clearTimeout(timer);
      const body = JSON.parse(out.subarray(start, start + length).toString('utf8'));
      child.kill();
      resolvePromise(body);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    const body = Buffer.from(JSON.stringify(request), 'utf8');
    child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    child.stdin.write(body);
  });
}

const compiler = beanscPath();

describe('starting the adapter', { skip: compiler === undefined && 'no beansc built' }, () => {
  test('beansc debug-adapter answers initialize', async () => {
    const reply = await talk(compiler, ['debug-adapter'], {
      seq: 1,
      type: 'request',
      command: 'initialize',
      arguments: { adapterID: 'beans' },
    });
    assert.equal(reply.type, 'response');
    assert.equal(reply.command, 'initialize');
    assert.equal(reply.success, true);
    assert.equal(reply.body.supportsConfigurationDoneRequest, true);
  });

  test('a compiler path containing spaces starts without a shell', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'beans debug '));
    try {
      const spaced = join(dir, 'a folder with spaces');
      mkdirSync(spaced);
      const copy = join(spaced, 'beansc');
      copyFileSync(compiler, copy);
      const reply = await talk(copy, ['debug-adapter'], {
        seq: 1,
        type: 'request',
        command: 'initialize',
        arguments: { adapterID: 'beans' },
      });
      assert.equal(reply.success, true, 'a spaced path must still start the adapter');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a program that cannot be found fails the launch with a reason', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'beans-debug-'));
    try {
      const missing = join(dir, 'nowhere.b');
      const child = spawn(compiler, ['debug-adapter'], { shell: false });
      const send = (message) => {
        const body = Buffer.from(JSON.stringify(message), 'utf8');
        child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
        child.stdin.write(body);
      };
      const messages = [];
      const done = new Promise((resolvePromise, reject) => {
        let out = '';
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error('no launch reply'));
        }, 30_000);
        child.stdout.on('data', (chunk) => {
          out += chunk.toString('utf8');
          let header;
          while ((header = /Content-Length: (\d+)\r\n\r\n/.exec(out)) !== null) {
            const start = header.index + header[0].length;
            const length = Number(header[1]);
            if (out.length < start + length) break;
            messages.push(JSON.parse(out.slice(start, start + length)));
            out = out.slice(start + length);
          }
          const launch = messages.find((m) => m.command === 'launch');
          if (launch !== undefined) {
            clearTimeout(timer);
            child.kill();
            resolvePromise(launch);
          }
        });
      });
      send({ seq: 1, type: 'request', command: 'initialize', arguments: {} });
      send({
        seq: 2,
        type: 'request',
        command: 'launch',
        arguments: { program: missing },
      });
      const launch = await done;
      assert.equal(launch.success, false, 'launching a missing file must fail');
      assert.ok(
        typeof launch.message === 'string' && launch.message.length > 0,
        'the failure should say why',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a real program stops at a breakpoint and reports its frame', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'beans-debug-run-'));
    try {
      const program = join(dir, 'main.b');
      writeFileSync(
        program,
        'package main\n\nimport std.io\n\nfn main() {\n' +
          '    let value: int = 41\n' +
          '    let next: int = value + 1\n' +
          '    io.println("{next}")\n}\n',
      );
      const child = spawn(compiler, ['debug-adapter'], { cwd: dir, shell: false });
      const send = (message) => {
        const body = Buffer.from(JSON.stringify(message), 'utf8');
        child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
        child.stdin.write(body);
      };
      const messages = [];
      const waitFor = (predicate) =>
        new Promise((resolvePromise, reject) => {
          const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`no match; saw ${JSON.stringify(messages).slice(0, 800)}`));
          }, 30_000);
          const check = () => {
            const found = messages.find(predicate);
            if (found !== undefined) {
              clearTimeout(timer);
              resolvePromise(found);
              return true;
            }
            return false;
          };
          if (check()) return;
          child.stdout.on('data', () => {
            check();
          });
        });
      let out = '';
      child.stdout.on('data', (chunk) => {
        out += chunk.toString('utf8');
        let header;
        while ((header = /Content-Length: (\d+)\r\n\r\n/.exec(out)) !== null) {
          const start = header.index + header[0].length;
          const length = Number(header[1]);
          if (out.length < start + length) break;
          messages.push(JSON.parse(out.slice(start, start + length)));
          out = out.slice(start + length);
        }
      });

      send({ seq: 1, type: 'request', command: 'initialize', arguments: {} });
      send({
        seq: 2,
        type: 'request',
        command: 'launch',
        arguments: completeConfiguration({ program }, { workspaceFolder: dir }),
      });
      send({
        seq: 3,
        type: 'request',
        command: 'setBreakpoints',
        arguments: { source: { path: program }, breakpoints: [{ line: 7 }] },
      });
      send({ seq: 4, type: 'request', command: 'configurationDone' });

      const stopped = await waitFor((m) => m.event === 'stopped');
      assert.equal(stopped.body.reason, 'breakpoint');
      send({ seq: 5, type: 'request', command: 'stackTrace', arguments: { threadId: 1 } });
      const stack = await waitFor((m) => m.command === 'stackTrace');
      assert.equal(stack.body.stackFrames[0].name, 'main');
      assert.equal(stack.body.stackFrames[0].line, 7);
      send({ seq: 6, type: 'request', command: 'disconnect' });
      child.kill();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
