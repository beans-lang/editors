// Beans support for VS Code.
//
// The extension is a thin client. It starts `beansc lsp`, keeps it running,
// and gets out of the way. TextMate highlighting paints a `.b` file the
// instant it opens; everything else arrives from the compiler over LSP.

import * as vscode from 'vscode';

import { BeansLanguageClient } from './client';

let client: BeansLanguageClient | undefined;

/** Settings that require a server restart when they change. */
const RESTART_ON_CHANGE = [
  'beans.compiler.path',
  'beans.compiler.searchDevelopmentPaths',
];

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // A log channel: vscode-languageclient 10 wants one, and it gives users the
  // standard log-level control for `beans.trace.server` output.
  const output = vscode.window.createOutputChannel('Beans Language Server', { log: true });
  context.subscriptions.push(output);

  client = new BeansLanguageClient(output);
  context.subscriptions.push({ dispose: () => void client?.stop() });

  context.subscriptions.push(
    vscode.commands.registerCommand('beans.restartLanguageServer', async () => {
      await client?.restart();
    }),
    vscode.commands.registerCommand('beans.showOutputChannel', () => {
      output.show(true);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (RESTART_ON_CHANGE.some((key) => event.affectsConfiguration(key))) {
        output.appendLine('Compiler settings changed; restarting.');
        await client?.restart();
      }
    }),
  );

  // A folder added or removed changes where `beansc` is looked for.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
      if (client?.isRunning === true) {
        output.appendLine('Workspace folders changed; restarting.');
        await client.restart();
      }
    }),
  );

  await client.start();
}

export async function deactivate(): Promise<void> {
  await client?.stop();
  client = undefined;
}
