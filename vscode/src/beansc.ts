// Finding the Beans compiler.
//
// This module deliberately imports nothing from `vscode`. Everything it needs
// — the setting, the environment, the workspace roots, the filesystem — is
// passed in, so the resolution order can be tested directly with `node --test`
// instead of only inside a running editor.
//
// There is no published Beans binary yet, so there is nothing to download.
// When the compiler is missing we say so and stop.

import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

/** Where a resolved `beansc` came from. Used in the output channel. */
export type ResolutionSource =
  | 'setting'
  | 'environment'
  | 'workspace'
  | 'path'
  | 'development';

export interface Resolution {
  /** Absolute path to the executable. Never quoted — it is spawned directly. */
  command: string;
  args: string[];
  source: ResolutionSource;
  /** Human-readable note for the log, e.g. the setting or variable used. */
  detail: string;
}

export interface ResolveOptions {
  /** `beans.compiler.path`, verbatim from the settings. */
  settingPath?: string;
  /** Usually `process.env`. */
  env: Record<string, string | undefined>;
  /** Absolute filesystem paths of the open workspace folders, in order. */
  workspaceFolders: readonly string[];
  /** `beans.compiler.searchDevelopmentPaths`. */
  searchDevelopmentPaths: boolean;
  /** Injected so tests can describe a filesystem without touching disk. */
  isExecutableFile?: (candidate: string) => boolean;
  /** Injected for the same reason; defaults to the real platform. */
  platform?: NodeJS.Platform;
}

export class CompilerNotFoundError extends Error {
  constructor(readonly searched: readonly string[]) {
    super('beansc not found');
    this.name = 'CompilerNotFoundError';
  }
}

/** Executable names to try, in order. Windows needs the suffix. */
function executableNames(platform: NodeJS.Platform): string[] {
  return platform === 'win32' ? ['beansc.exe', 'beansc'] : ['beansc'];
}

function defaultIsExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Expands `~` and `${workspaceFolder}` and resolves a relative path against
 * the first workspace folder. A path with spaces needs no quoting here: the
 * result is handed straight to the process spawner, never to a shell.
 */
export function expandPath(
  value: string,
  workspaceFolders: readonly string[],
  home = homedir(),
): string {
  let out = value.trim();
  if (out === '') return out;

  const first = workspaceFolders[0];
  if (first !== undefined) {
    out = out
      .replaceAll('${workspaceFolder}', first)
      .replaceAll('${workspaceRoot}', first);
  }

  if (out === '~') out = home;
  else if (out.startsWith('~/') || out.startsWith('~\\')) out = join(home, out.slice(2));

  if (!isAbsolute(out) && first !== undefined) out = resolve(first, out);

  return out;
}

/**
 * Relative locations of a compiler built from source, tried against every
 * workspace folder. These exist because `beans` and `editors` are usually
 * checked out side by side and there is no released binary to install yet.
 */
const DEVELOPMENT_RELATIVE_PATHS = [
  join('build'),
  join('beans', 'build'),
  join('..', 'beans', 'build'),
];

/**
 * Resolves `beansc` in the documented order:
 *
 *   1. the `beans.compiler.path` setting
 *   2. the `BEANSC` environment variable
 *   3. `beansc` at a workspace root, then on `PATH`
 *   4. a source build — `build/beansc`, `beans/build/beansc`,
 *      `../beans/build/beansc` — unless development paths are switched off
 *
 * Throws `CompilerNotFoundError` carrying everything that was tried, so the
 * editor can show a message that names real locations.
 */
export function resolveBeansc(options: ResolveOptions): Resolution {
  const {
    settingPath,
    env,
    workspaceFolders,
    searchDevelopmentPaths,
    isExecutableFile = defaultIsExecutableFile,
    platform = process.platform,
  } = options;

  const searched: string[] = [];
  const names = executableNames(platform);

  const accept = (
    candidate: string,
    source: ResolutionSource,
    detail: string,
  ): Resolution | null => {
    searched.push(candidate);
    return isExecutableFile(candidate)
      ? { command: candidate, args: ['lsp'], source, detail }
      : null;
  };

  // 1. Explicit setting. An explicit setting that does not exist is an error
  //    rather than a reason to keep looking — silently using a different
  //    compiler than the one asked for would be worse.
  if (settingPath !== undefined && settingPath.trim() !== '') {
    const expanded = expandPath(settingPath, workspaceFolders);
    const hit = accept(expanded, 'setting', 'beans.compiler.path');
    if (hit) return hit;
    throw new CompilerNotFoundError(searched);
  }

  // 2. BEANSC — the same variable beans/test/lsp_server.sh uses.
  const fromEnv = env.BEANSC;
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    const expanded = expandPath(fromEnv, workspaceFolders);
    const hit = accept(expanded, 'environment', 'BEANSC');
    if (hit) return hit;
    throw new CompilerNotFoundError(searched);
  }

  // 3a. A compiler sitting at a workspace root.
  for (const folder of workspaceFolders) {
    for (const name of names) {
      const hit = accept(join(folder, name), 'workspace', folder);
      if (hit) return hit;
    }
  }

  // 3b. PATH.
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    for (const name of names) {
      const hit = accept(join(dir, name), 'path', 'PATH');
      if (hit) return hit;
    }
  }

  // 4. A compiler built from source next to the workspace.
  if (searchDevelopmentPaths) {
    for (const folder of workspaceFolders) {
      for (const relative of DEVELOPMENT_RELATIVE_PATHS) {
        for (const name of names) {
          const hit = accept(
            resolve(folder, relative, name),
            'development',
            `${relative} (development build)`,
          );
          if (hit) return hit;
        }
      }
    }
  }

  throw new CompilerNotFoundError(searched);
}

/** The message shown when nothing was found. Kept short and actionable. */
export function notFoundMessage(): string {
  return (
    'Beans language features are off: the `beansc` compiler was not found. ' +
    'Set `beans.compiler.path`, or put `beansc` on your PATH. ' +
    'There is no published Beans binary yet, so it has to be built from the ' +
    'beans repository (`make`), which leaves it at `build/beansc`.'
  );
}

/** The detail written to the output channel alongside the message. */
export function notFoundDetail(error: CompilerNotFoundError): string {
  if (error.searched.length === 0) return 'Nothing was searched.';
  return ['Searched:', ...error.searched.map((p) => `  ${p}`)].join('\n');
}
