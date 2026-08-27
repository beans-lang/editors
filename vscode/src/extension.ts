// Beans support for VS Code.
//
// The extension is a thin client. It starts `beansc lsp`, keeps it running,
// and gets out of the way. TextMate highlighting paints a `.b` file the
// instant it opens; everything else arrives from the compiler over LSP.
// Debugging works the same way: `beansc debug-adapter` speaks DAP, and the
// extension only finds it and starts it.
//
// The one exception is `.bx` markup. Tags are crema's, not the language's, so
// `beansc` has never heard of them and cannot be asked; src/bx.ts answers
// those from crema's own tables and nothing else.

import * as vscode from 'vscode';

import { registerBx } from './bx';
import { BeansLanguageClient } from './client';
import { registerDebugger } from './debugger';

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

  // The debugger is the same compiler under a different subcommand. It needs
  // no second engine in the editor either.
  registerDebugger(context, output);

  // Markup is the one thing the compiler cannot answer. `.bx` is crema's, not
  // the language's, so its tags, attributes and colour names come from crema's
  // own tables rather than from `beansc lsp` — see src/bx.ts.
  registerBx(context);

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
