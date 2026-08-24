// The VS Code debugger wiring: compiler resolution, launch configuration, and
// starting the adapter for real.
//
// Runs against the compiled extension (`vscode/out/debug.js`), so it tests what
// ships. `src/debug.ts` imports nothing from `vscode` exactly so this can be a
// plain `node --test`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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
  nativeBinaryPath,
  nativeBuildCommand,
  nativeLaunchConfiguration,
  NoNativeDebuggerError,
  noNativeDebuggerMessage,
  NoProgramError,
  pickNativeAdapter,
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

  test('a launch runs under the interpreter unless it asks not to', () => {
    const done = completeConfiguration(
      { program: '/work/main.b' },
      { workspaceFolder: '/work' },
    );
    assert.equal(done.mode, 'interpreter');
  });

  test('an unknown mode is the interpreter, not a broken native launch', () => {
    const done = completeConfiguration(
      { program: '/work/main.b', mode: 'wasm' },
      { workspaceFolder: '/work' },
    );
    assert.equal(done.mode, 'interpreter');
  });
});

// ---------------------------------------------------------------------------
// Native mode: build with --debug, then hand the binary to a real debugger
// ---------------------------------------------------------------------------

describe('native launches', () => {
  const native = (extra = {}) =>
    completeConfiguration(
      { program: '/work/app/main.b', mode: 'native', ...extra },
      { workspaceFolder: '/work' },
    );

  test('mode: native is carried through', () => {
    assert.equal(native().mode, 'native');
  });

  test('the binary lands in build/ beside the source', () => {
    assert.equal(nativeBinaryPath(native(), 'darwin'), '/work/app/build/main');
    assert.equal(nativeBinaryPath(native(), 'linux'), '/work/app/build/main');
  });

  test('Windows gets the extension it needs to run the binary', () => {
    assert.equal(nativeBinaryPath(native(), 'win32'), '/work/app/build/main.exe');
  });

  test('an explicit output wins, resolved against the workspace', () => {
    assert.equal(
      nativeBinaryPath(native({ output: 'out/app' }), 'linux'),
      resolve('/work', 'out/app'),
    );
  });

  test('the build asks for --debug, which is what writes the line table', () => {
    const build = nativeBuildCommand(
      native(),
      { command: '/usr/local/bin/beansc', args: [] },
      'linux',
    );
    assert.equal(build.command, '/usr/local/bin/beansc');
    assert.deepEqual(build.args, [
      'build',
      '--debug',
      '/work/app/main.b',
      '-o',
      '/work/app/build/main',
    ]);
    assert.equal(build.cwd, '/work');
  });

  test('a path with spaces stays one argument', () => {
    const config = completeConfiguration(
      { program: '/Users/a person/my program.b', mode: 'native' },
      { workspaceFolder: '/Users/a person' },
    );
    const build = nativeBuildCommand(config, { command: 'beansc', args: [] }, 'linux');
    assert.equal(build.args[2], '/Users/a person/my program.b');
    assert.equal(build.args[4], '/Users/a person/build/my program');
  });

  test('the best installed debugger is chosen, in order', () => {
    const installed = (...ids) => (id) => ids.includes(id);
    assert.equal(
      pickNativeAdapter(installed('vadimcn.vscode-lldb', 'ms-vscode.cpptools')),
      'lldb',
    );
    assert.equal(pickNativeAdapter(installed('ms-vscode.cpptools')), 'cppdbg');
    assert.equal(
      pickNativeAdapter(installed('llvm-vs-code-extensions.lldb-dap')),
      'lldb-dap',
    );
  });

  test('an explicit adapter is taken even when nothing looks installed', () => {
    assert.equal(pickNativeAdapter(() => false, 'lldb'), 'lldb');
  });

  test('no debugger installed names the ones that would work', () => {
    assert.throws(
      () => pickNativeAdapter(() => false),
      (error) => {
        assert.ok(error instanceof NoNativeDebuggerError);
        const message = noNativeDebuggerMessage(error);
        assert.match(message, /vadimcn\.vscode-lldb/);
        assert.match(message, /ms-vscode\.cpptools/);
        // The way out that needs nothing installed has to be in the message.
        assert.match(message, /interpreter/);
        return true;
      },
    );
  });

  test('the handed-over configuration launches the binary, not the source', () => {
    const config = native({ args: ['--fast'], env: { LEVEL: '3' } });
    const handed = nativeLaunchConfiguration(config, 'lldb', 'linux');
    assert.equal(handed.type, 'lldb');
    assert.equal(handed.request, 'launch');
    assert.equal(handed.program, '/work/app/build/main');
    assert.equal(handed.cwd, '/work');
    assert.deepEqual(handed.args, ['--fast']);
    assert.deepEqual(handed.env, { LEVEL: '3' });
  });

  test('cppdbg is spelled the way cppdbg spells it', () => {
    const config = native({ env: { LEVEL: '3' }, stopOnEntry: true });
    const mac = nativeLaunchConfiguration(config, 'cppdbg', 'darwin');
    assert.equal(mac.MIMode, 'lldb');
    assert.equal(mac.stopAtEntry, true);
    assert.deepEqual(mac.environment, [{ name: 'LEVEL', value: '3' }]);
    assert.equal(mac.env, undefined);
    const linux = nativeLaunchConfiguration(config, 'cppdbg', 'linux');
    assert.equal(linux.MIMode, 'gdb');
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

// ---------------------------------------------------------------------------
// Native mode, for real: the argv the extension builds produces a binary a
// debugger can stop inside on a Beans line.
//
// This is the whole claim of `"mode": "native"`. The unit tests above check
// the strings; this checks that the strings describe something that works.
// ---------------------------------------------------------------------------

function nativeDebugger() {
  for (const name of ['lldb', 'gdb']) {
    const probe = spawnSync(name, ['--version']);
    if (probe.status === 0) return name;
  }
  return undefined;
}

const debuggerName = compiler === undefined ? undefined : nativeDebugger();

/** `runtime/beans_rt.c` beside a development compiler, if that is what this is. */
const runtimeSource = (() => {
  if (compiler === undefined) return undefined;
  const candidate = resolve(dirname(compiler), '..', 'runtime', 'beans_rt.c');
  return existsSync(candidate) ? candidate : undefined;
})();

describe('native mode end to end', {
  skip:
    (compiler === undefined && 'no beansc built') ||
    (debuggerName === undefined && 'no lldb or gdb installed'),
}, () => {
  test('the built binary stops on the Beans line it was asked for', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beans-native-'));
    try {
      const program = join(dir, 'main.b');
      writeFileSync(
        program,
        [
          'package main',
          '',
          'import std.io',
          '',
          'fn total(count: int) -> int {',
          '    var sum: int = 0',
          '    for i: int in 0..count {',
          '        sum = sum + i',
          '    }',
          '    return sum',
          '}',
          '',
          'fn main() {',
          '    io.println("{total(10)}")',
          '}',
          '',
        ].join('\n'),
      );

      const configuration = completeConfiguration(
        { program, mode: 'native' },
        { workspaceFolder: dir },
      );
      const build = nativeBuildCommand(configuration, { command: compiler, args: [] });
      const built = spawnSync(build.command, build.args, {
        cwd: build.cwd,
        encoding: 'utf8',
        // A compiler built from source finds its C runtime relative to the
        // directory it is run from, and a native build is run from the user's
        // project. An installed compiler knows where its own runtime is; this
        // only stands in for that when the tests use a development build.
        env: { ...process.env, ...(runtimeSource ? { BEANS_RUNTIME: runtimeSource } : {}) },
      });
      assert.equal(
        built.status,
        0,
        `beansc build --debug failed: ${built.stdout}${built.stderr}`,
      );

      // Exactly where the extension says the binary is, and exactly what it
      // would hand the debugger.
      const binary = nativeLaunchConfiguration(configuration, 'lldb').program;
      assert.ok(existsSync(binary), `${binary} was not built`);

      // The breakpoint is set by absolute path, which is what an editor sends
      // and what the DWARF has to be resolvable against.
      const session =
        debuggerName === 'lldb'
          ? spawnSync(
              'lldb',
              [
                binary, '-b',
                '-o', `breakpoint set --file ${program} --line 8`,
                '-o', 'run',
                '-o', 'bt',
                '-o', 'frame variable',
                '-o', 'kill',
              ],
              { encoding: 'utf8' },
            )
          : spawnSync(
              'gdb',
              [
                '-batch', '-nx',
                '-ex', `break ${program}:8`,
                '-ex', 'run',
                '-ex', 'bt',
                '-ex', 'info locals',
                binary,
              ],
              { encoding: 'utf8' },
            );
      const transcript = `${session.stdout}${session.stderr}`;
      assert.match(transcript, /main\.b:8/, `no stop on main.b:8:\n${transcript}`);
      assert.match(transcript, /main\.total/, `frame is not named:\n${transcript}`);
      assert.match(transcript, /sum = /, `no Beans local:\n${transcript}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
