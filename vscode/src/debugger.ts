// The editor half of Beans debugging: a configuration provider and an adapter
// factory. Both are thin — every decision lives in `src/debug.ts` (pure, and
// tested) or in `beansc debug-adapter` itself.

import { spawn } from 'node:child_process';

import * as vscode from 'vscode';

import { CompilerNotFoundError, resolveBeansc } from './beansc';
import {
  BeansLaunchConfiguration,
  DEBUG_TYPE,
  adapterNotFoundMessage,
  completeConfiguration,
  initialConfiguration,
  nativeBuildCommand,
  nativeLaunchConfiguration,
  NoNativeDebuggerError,
  noNativeDebuggerMessage,
  NoProgramError,
  pickNativeAdapter,
  resolveDebugAdapter,
} from './debug';

function readConfiguration(): {
  compilerPath: string;
  searchDevelopmentPaths: boolean;
  trace: boolean;
} {
  const config = vscode.workspace.getConfiguration('beans');
  return {
    compilerPath: config.get<string>('compiler.path', ''),
    searchDevelopmentPaths: config.get<boolean>('compiler.searchDevelopmentPaths', true),
    trace: config.get<boolean>('debug.trace', false),
  };
}

function workspaceFolderPaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? [])
    .filter((folder) => folder.uri.scheme === 'file')
    .map((folder) => folder.uri.fsPath);
}

/** The `.b` file in the active editor, if there is one. */
function activeBeansFile(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) return undefined;
  if (editor.document.uri.scheme !== 'file') return undefined;
  if (editor.document.languageId !== 'beans') return undefined;
  return editor.document.uri.fsPath;
}

/**
 * Runs `beansc build --debug` and resolves when it succeeds.
 *
 * Spawned as an argument vector, never through a shell, so a path with a space
 * in it cannot be re-split into two arguments.
 */
function runNativeBuild(
  build: { command: string; args: string[]; cwd: string },
  output: vscode.LogOutputChannel,
): Promise<void> {
  return new Promise((settle, reject) => {
    output.info(`Building for the debugger: ${build.command} ${build.args.join(' ')}`);
    const child = spawn(build.command, build.args, { cwd: build.cwd });
    let log = '';
    child.stdout.on('data', (chunk) => { log += String(chunk); });
    child.stderr.on('data', (chunk) => { log += String(chunk); });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (log !== '') output.info(log.trimEnd());
      if (code === 0) {
        settle();
        return;
      }
      reject(new Error(log.trim() === '' ? `beansc build exited ${code}` : log.trim()));
    });
  });
}

/**
 * Builds the program with `--debug` and starts a native debug session on the
 * binary.
 *
 * The extension stays a thin client here too. It does not debug anything: it
 * compiles, then hands an ordinary binary with an ordinary DWARF line table to
 * whichever native debugger the user already has.
 */
async function startNativeSession(
  folder: vscode.WorkspaceFolder | undefined,
  configuration: BeansLaunchConfiguration,
  output: vscode.LogOutputChannel,
): Promise<void> {
  const settings = readConfiguration();
  let type: string;
  let compiler;
  try {
    type = pickNativeAdapter(
      (id) => vscode.extensions.getExtension(id) !== undefined,
      configuration.adapter,
    );
    compiler = resolveBeansc({
      settingPath: settings.compilerPath,
      env: process.env,
      workspaceFolders: workspaceFolderPaths(),
      searchDevelopmentPaths: settings.searchDevelopmentPaths,
    });
  } catch (error) {
    const message =
      error instanceof NoNativeDebuggerError
        ? noNativeDebuggerMessage(error)
        : error instanceof CompilerNotFoundError
          ? adapterNotFoundMessage(error)
          : String(error);
    output.error(message);
    void vscode.window.showErrorMessage(message);
    return;
  }

  try {
    await runNativeBuild(nativeBuildCommand(configuration, compiler), output);
  } catch (error) {
    const message = `Building ${configuration.program} for the debugger failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
    output.error(message);
    void vscode.window.showErrorMessage(message);
    return;
  }

  await vscode.debug.startDebugging(
    folder,
    nativeLaunchConfiguration(configuration, type) as vscode.DebugConfiguration,
  );
}

class BeansConfigurationProvider implements vscode.DebugConfigurationProvider {
  constructor(private readonly output: vscode.LogOutputChannel) {}

  provideDebugConfigurations(): vscode.DebugConfiguration[] {
    return [initialConfiguration()];
  }

  resolveDebugConfiguration(
    folder: vscode.WorkspaceFolder | undefined,
    configuration: vscode.DebugConfiguration,
  ): vscode.DebugConfiguration | undefined {
    try {
      const completed = completeConfiguration(configuration as never, {
        activeFile: activeBeansFile(),
        workspaceFolder: folder?.uri.fsPath ?? workspaceFolderPaths()[0],
      });
      if (completed.mode === 'native') {
        // A native launch is a different debugger's session, so this one is
        // cancelled and a new one started. Returning a foreign `type` from
        // here would ask VS Code to re-route a session it has already begun.
        void startNativeSession(folder, completed, this.output);
        return undefined;
      }
      return completed;
    } catch (error) {
      if (error instanceof NoProgramError) {
        void vscode.window.showErrorMessage(
          'Open a Beans file, or set `program` in your launch configuration.',
        );
        // `undefined` cancels the session without an extra error dialog.
        return undefined;
      }
      throw error;
    }
  }
}

class BeansAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  constructor(private readonly output: vscode.LogOutputChannel) {}

  createDebugAdapterDescriptor(
    session: vscode.DebugSession,
  ): vscode.DebugAdapterDescriptor {
    const settings = readConfiguration();
    let resolution;
    try {
      resolution = resolveDebugAdapter({
        settingPath: settings.compilerPath,
        env: process.env,
        workspaceFolders: workspaceFolderPaths(),
        searchDevelopmentPaths: settings.searchDevelopmentPaths,
      });
    } catch (error) {
      if (error instanceof CompilerNotFoundError) {
        const message = adapterNotFoundMessage(error);
        this.output.error(message);
        void vscode.window.showErrorMessage(message);
        throw new Error(message, { cause: error });
      }
      throw error;
    }

    const cwd =
      typeof session.configuration.cwd === 'string' && session.configuration.cwd !== ''
        ? session.configuration.cwd
        : session.workspaceFolder?.uri.fsPath;

    // `beans.debug.trace` is off by default: starting a debugger should not
    // write to a channel nobody asked to read. Failures are logged either way
    // — a silent failure is not a quieter one, only a more confusing one.
    if (settings.trace) {
      this.output.info(
        `Starting debug adapter: ${resolution.command} ${resolution.args.join(' ')}` +
          ` (${resolution.source}: ${resolution.detail})`,
      );
      this.output.info(`Debug adapter working directory: ${cwd ?? '(inherited)'}`);
    }

    // `DebugAdapterExecutable` spawns the command directly — no shell — so a
    // path with spaces needs no quoting and cannot be re-split.
    return new vscode.DebugAdapterExecutable(resolution.command, resolution.args, {
      cwd,
      env: {
        ...process.env,
        ...(session.configuration.env as Record<string, string> | undefined),
      } as Record<string, string>,
    });
  }
}

export function registerDebugger(
  context: vscode.ExtensionContext,
  output: vscode.LogOutputChannel,
): void {
  context.subscriptions.push(
    vscode.debug.registerDebugConfigurationProvider(
      DEBUG_TYPE,
      new BeansConfigurationProvider(output),
    ),
    vscode.debug.registerDebugConfigurationProvider(
      DEBUG_TYPE,
      new BeansConfigurationProvider(output),
      vscode.DebugConfigurationProviderTriggerKind.Dynamic,
    ),
    vscode.debug.registerDebugAdapterDescriptorFactory(
      DEBUG_TYPE,
      new BeansAdapterFactory(output),
    ),
  );
}
