// Debugging Beans from VS Code.
//
// The extension stays a thin client here too: it finds `beansc`, starts
// `beansc debug-adapter`, and hands the socket to VS Code. Every decision the
// debugger makes — where a breakpoint really lands, what a frame is called,
// what a variable holds — belongs to the compiler.
//
// Like `beansc.ts`, this module imports nothing from `vscode`, so the parts
// worth testing can be tested with `node --test`.

import { isAbsolute, resolve } from 'node:path';

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
  };
}

/**
 * The configuration offered when a user picks "Beans" with no `launch.json`.
 * Kept beside `completeConfiguration` so the snippet and the defaults cannot
 * drift.
 */
export function initialConfiguration(): BeansLaunchConfiguration {
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
