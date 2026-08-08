// The editor half of Beans debugging: a configuration provider and an adapter
// factory. Both are thin — every decision lives in `src/debug.ts` (pure, and
// tested) or in `beansc debug-adapter` itself.

import * as vscode from 'vscode';

import { CompilerNotFoundError } from './beansc';
import {
  DEBUG_TYPE,
  adapterNotFoundMessage,
  completeConfiguration,
  initialConfiguration,
  NoProgramError,
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

class BeansConfigurationProvider implements vscode.DebugConfigurationProvider {
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
      new BeansConfigurationProvider(),
    ),
    vscode.debug.registerDebugConfigurationProvider(
      DEBUG_TYPE,
      new BeansConfigurationProvider(),
      vscode.DebugConfigurationProviderTriggerKind.Dynamic,
    ),
    vscode.debug.registerDebugAdapterDescriptorFactory(
      DEBUG_TYPE,
      new BeansAdapterFactory(output),
    ),
  );
}
