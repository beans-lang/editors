// Debugging Beans from VS Code.
//
// The extension stays a thin client here too: it finds `beansc`, starts
// `beansc debug-adapter`, and hands the socket to VS Code. Every decision the
// debugger makes — where a breakpoint really lands, what a frame is called,
// what a variable holds — belongs to the compiler.
//
// Like `beansc.ts`, this module imports nothing from `vscode`, so the parts
// worth testing can be tested with `node --test`.

import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';

import {
  CompilerNotFoundError,
  Resolution,
  ResolveOptions,
  resolveBeansc,
} from './beansc';

/** The subcommand that speaks DAP on stdio. */
export const DEBUG_ADAPTER_ARGS = ['debug-adapter'] as const;

/** The `type` a launch configuration uses. */
export const DEBUG_TYPE = 'beans';

/**
 * Which machinery runs the program.
 *
 * `interpreter` runs it under `beansc debug-adapter`, which knows every Beans
 * value and is the richer debugger. `native` builds with `--debug` and hands
 * the binary to a native debugger, which is the only way to debug the thing
 * that actually ships — optimizer aside, it is the same code path, the same
 * runtime and the same threads.
 */
export type DebugMode = 'interpreter' | 'native';

export const DEBUG_MODES: readonly DebugMode[] = ['interpreter', 'native'];

/** A Beans launch configuration, after defaults are filled in. */
export interface BeansLaunchConfiguration {
  type: string;
  request: 'launch';
  name: string;
  /** Absolute path to the `.b` file to run. */
  program: string;
  cwd: string;
  args: string[];
  env: Record<string, string>;
  stopOnEntry: boolean;
  mode: DebugMode;
  /**
   * Where a native build writes its binary. Empty means "beside the source, in
   * `build/`", which is where `beansc` already keeps its own artifacts.
   */
  output: string;
  /**
   * The debug type a native launch hands the binary to. Empty picks the best
   * installed one.
   */
  adapter: string;
}

/**
 * The same compiler the language server uses, started with `debug-adapter`
 * instead of `lsp`. One resolver means the debugger can never end up on a
 * different build than the one reporting diagnostics.
 */
export function resolveDebugAdapter(options: ResolveOptions): Resolution {
  const found = resolveBeansc(options);
  return { ...found, args: [...DEBUG_ADAPTER_ARGS] };
}

export class NoProgramError extends Error {
  constructor() {
    super('a Beans launch configuration needs a `program` to run');
    this.name = 'NoProgramError';
  }
}

/**
 * Fills a partial launch configuration in.
 *
 * VS Code calls this twice: once when the user presses F5 with no
 * `launch.json` (an empty configuration, which becomes "debug the open file"),
 * and once for a configuration read from disk. Both paths land here so there
 * is one definition of what a Beans launch means.
 */
export function completeConfiguration(
  configuration: Partial<BeansLaunchConfiguration> & Record<string, unknown>,
  context: {
    /** The `.b` file in the active editor, if any. */
    activeFile?: string;
    /** The first workspace folder, if any. */
    workspaceFolder?: string;
  },
): BeansLaunchConfiguration {
  const program = (configuration.program ?? context.activeFile ?? '').trim();
  if (program === '') throw new NoProgramError();

  const folder = context.workspaceFolder ?? '';
  const cwd = (configuration.cwd ?? folder ?? '').trim();

  const output = (configuration.output ?? '').trim();

  return {
    type: DEBUG_TYPE,
    request: 'launch',
    name: configuration.name ?? 'Debug Beans Program',
    program: absolutize(program, folder),
    cwd: cwd === '' ? '' : absolutize(cwd, folder),
    args: Array.isArray(configuration.args) ? configuration.args.map(String) : [],
    env: isPlainObject(configuration.env)
      ? Object.fromEntries(
          Object.entries(configuration.env).map(([k, v]) => [k, String(v)]),
        )
      : {},
    stopOnEntry: configuration.stopOnEntry === true,
    mode: configuration.mode === 'native' ? 'native' : 'interpreter',
    output: output === '' ? '' : absolutize(output, folder),
    adapter: (configuration.adapter ?? '').trim(),
  };
}

/**
 * What a fresh `launch.json` is offered.
 *
 * The native-only fields are deliberately absent: `mode` defaults to the
 * interpreter and the other two only mean anything beside it, so writing all
 * three as empty strings would be three questions a first launch does not need
 * to answer. `contributes.debuggers.initialConfigurations` in package.json is
 * this same object, and the two must not drift.
 */
export type OfferedConfiguration = Omit<
  BeansLaunchConfiguration,
  'mode' | 'output' | 'adapter'
>;

/**
 * The configuration offered when a user picks "Beans" with no `launch.json`.
 * Kept beside `completeConfiguration` so the snippet and the defaults cannot
 * drift.
 */
export function initialConfiguration(): OfferedConfiguration {
  return {
    type: DEBUG_TYPE,
    request: 'launch',
    name: 'Debug Beans Program',
    program: '${file}',
    cwd: '${workspaceFolder}',
    args: [],
    env: {},
    stopOnEntry: false,
  };
}

/**
 * The debug types a native binary can be handed to, best first.
 *
 * Beans ships no native debug adapter of its own and should not: the binary is
 * an ordinary one with an ordinary DWARF line table, and the debuggers people
 * already have read it. This list is only about which of them is installed.
 */
export const NATIVE_ADAPTERS = [
  { extension: 'vadimcn.vscode-lldb', type: 'lldb' },
  { extension: 'llvm-vs-code-extensions.lldb-dap', type: 'lldb-dap' },
  { extension: 'ms-vscode.cpptools', type: 'cppdbg' },
] as const;

export class NoNativeDebuggerError extends Error {
  readonly tried: string[];

  constructor() {
    super('no native debugger extension is installed');
    this.name = 'NoNativeDebuggerError';
    this.tried = NATIVE_ADAPTERS.map((entry) => entry.extension);
  }
}

/**
 * The installed debug type to hand a native binary to, or an error naming what
 * would have worked.
 */
export function pickNativeAdapter(
  isInstalled: (extensionId: string) => boolean,
  requested = '',
): string {
  if (requested !== '') return requested;
  for (const entry of NATIVE_ADAPTERS) {
    if (isInstalled(entry.extension)) return entry.type;
  }
  throw new NoNativeDebuggerError();
}

export function noNativeDebuggerMessage(error: NoNativeDebuggerError): string {
  return (
    'Cannot debug a native Beans build: no native debugger is installed. ' +
    `Install one of ${error.tried.join(', ')}, or set \`adapter\` in your ` +
    'launch configuration. `"mode": "interpreter"` needs none of them.'
  );
}

/**
 * Where a native build puts its binary.
 *
 * `build/` beside the source, which is where `beansc` already writes the `.ll`
 * and the `.dSYM` a debugger looks for. An explicit `output` wins.
 */
export function nativeBinaryPath(
  configuration: BeansLaunchConfiguration,
  platform: string = process.platform,
): string {
  if (configuration.output !== '') return configuration.output;
  const stem = basename(
    configuration.program,
    extname(configuration.program),
  );
  const suffix = platform === 'win32' ? '.exe' : '';
  return join(dirname(configuration.program), 'build', `${stem}${suffix}`);
}

/**
 * The build that has to run before a native session starts.
 *
 * `--debug` is the whole point: it is the mode that writes the Beans line
 * table, keeps frame pointers and runs no optimizer, so the binary a debugger
 * opens still looks like the program that was written.
 */
export function nativeBuildCommand(
  configuration: BeansLaunchConfiguration,
  compiler: Resolution,
  platform: string = process.platform,
): { command: string; args: string[]; cwd: string } {
  return {
    command: compiler.command,
    args: [
      'build',
      '--debug',
      configuration.program,
      '-o',
      nativeBinaryPath(configuration, platform),
    ],
    cwd: configuration.cwd === '' ? dirname(configuration.program) : configuration.cwd,
  };
}

/**
 * The configuration handed to the native debugger.
 *
 * Every adapter here launches a program with arguments in a directory; they
 * disagree only on spelling. cppdbg additionally has to be told which
 * debugger to drive, because it drives several.
 */
export function nativeLaunchConfiguration(
  configuration: BeansLaunchConfiguration,
  type: string,
  platform: string = process.platform,
): Record<string, unknown> {
  const program = nativeBinaryPath(configuration, platform);
  const cwd =
    configuration.cwd === '' ? dirname(configuration.program) : configuration.cwd;
  const base = {
    type,
    request: 'launch',
    name: configuration.name,
    program,
    cwd,
    args: configuration.args,
  };
  if (type === 'cppdbg') {
    return {
      ...base,
      environment: Object.entries(configuration.env).map(([name, value]) => ({
        name,
        value,
      })),
      MIMode: platform === 'darwin' ? 'lldb' : 'gdb',
      stopAtEntry: configuration.stopOnEntry,
    };
  }
  return {
    ...base,
    env: configuration.env,
    stopOnEntry: configuration.stopOnEntry,
  };
}

/** A message that names what was tried, for a missing compiler. */
export function adapterNotFoundMessage(error: CompilerNotFoundError): string {
  return (
    'Cannot start the Beans debugger: no `beansc` found. ' +
    'Set `beans.compiler.path`, or put `beansc` on your PATH. ' +
    `Tried: ${error.searched.join(', ')}`
  );
}

function absolutize(value: string, folder: string): string {
  if (value === '' || isAbsolute(value)) return value;
  // A variable VS Code has not substituted yet is left alone: resolving it
  // against a folder would turn `${file}` into a path that cannot exist.
  if (value.startsWith('${')) return value;
  return folder === '' ? resolve(value) : resolve(folder, value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
