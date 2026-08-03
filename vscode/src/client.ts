// The language client: start, stop, restart, and nothing else.
//
// Every language feature — diagnostics, completion, hover, signature help,
// definition, references, document symbols, semantic tokens, rename — comes
// from `beansc lsp` through ordinary LSP capability negotiation. This file
// registers no providers of its own, and it should stay that way: a second
// feature engine in the editor would drift from the compiler.

import * as vscode from 'vscode';
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

import {
  CompilerNotFoundError,
  notFoundDetail,
  notFoundMessage,
  resolveBeansc,
  type Resolution,
} from './beansc';

export const LANGUAGE_ID = 'beans';

/** Reads the settings this extension owns. */
function readConfiguration(): {
  compilerPath: string;
  searchDevelopmentPaths: boolean;
} {
  const config = vscode.workspace.getConfiguration('beans');
  return {
    compilerPath: config.get<string>('compiler.path', ''),
    searchDevelopmentPaths: config.get<boolean>('compiler.searchDevelopmentPaths', true),
  };
}

function workspaceFolderPaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? [])
    .filter((folder) => folder.uri.scheme === 'file')
    .map((folder) => folder.uri.fsPath);
}

export class BeansLanguageClient {
  private client: LanguageClient | undefined;
  private starting = false;

  constructor(private readonly output: vscode.LogOutputChannel) {}

  get isRunning(): boolean {
    return this.client !== undefined;
  }

  /**
   * Starts the server. Safe to call when one is already running — the old one
   * is stopped first, which is what the restart command and the
   * configuration-change handler both rely on.
   */
  async start(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    try {
      await this.stop();

      let resolution: Resolution;
      try {
        const { compilerPath, searchDevelopmentPaths } = readConfiguration();
        resolution = resolveBeansc({
          settingPath: compilerPath,
          env: process.env,
          workspaceFolders: workspaceFolderPaths(),
          searchDevelopmentPaths,
        });
      } catch (error) {
        if (error instanceof CompilerNotFoundError) {
          this.output.appendLine(notFoundMessage());
          this.output.appendLine(notFoundDetail(error));
          void vscode.window
            .showErrorMessage(notFoundMessage(), 'Open Settings', 'Show Log')
            .then((choice) => {
              if (choice === 'Open Settings') {
                void vscode.commands.executeCommand(
                  'workbench.action.openSettings',
                  'beans.compiler.path',
                );
              } else if (choice === 'Show Log') {
                this.output.show(true);
              }
            });
          return;
        }
        throw error;
      }

      this.output.appendLine(
        `Starting: ${resolution.command} ${resolution.args.join(' ')} ` +
          `(found via ${resolution.source}: ${resolution.detail})`,
      );

      // Spawned directly, never through a shell — so a compiler path with
      // spaces in it needs no quoting and nothing in it can be interpreted.
      const run = {
        command: resolution.command,
        args: resolution.args,
        transport: TransportKind.stdio,
        options: { env: process.env },
      };
      const serverOptions: ServerOptions = { run, debug: run };

      const clientOptions: LanguageClientOptions = {
        // File-backed documents only. The server is a native executable, so
        // there is nothing to run in a browser-only VS Code window.
        documentSelector: [{ scheme: 'file', language: LANGUAGE_ID }],
        outputChannel: this.output,
        // The compiler reports diagnostics per document; leaving this to the
        // client's default keeps them attached to the file they came from.
        synchronize: {
          fileEvents: vscode.workspace.createFileSystemWatcher('**/beans.{pot,lock}'),
        },
        // A parse error mid-edit is the normal state of a file being typed
        // into. It must never take the server down.
        initializationFailedHandler: (error) => {
          this.output.appendLine(`Language server failed to initialize: ${String(error)}`);
          return false;
        },
      };

      this.client = new LanguageClient(
        'beans',
        'Beans Language Server',
        serverOptions,
        clientOptions,
      );

      await this.client.start();
      this.output.appendLine('Beans language server ready.');
    } catch (error) {
      this.client = undefined;
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`Beans language server failed to start: ${message}`);
      void vscode.window.showErrorMessage(
        `Beans language server failed to start: ${message}`,
      );
    } finally {
      this.starting = false;
    }
  }

  async stop(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (client === undefined) return;
    try {
      await client.stop();
    } catch (error) {
      // A server that already exited is a normal thing to find here.
      this.output.appendLine(`Stopping the language server: ${String(error)}`);
    }
  }

  async restart(): Promise<void> {
    this.output.appendLine('Restarting the Beans language server.');
    await this.start();
  }
}
