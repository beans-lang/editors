// Bundles the extension for packaging.
//
// `vscode-languageclient` is the extension's only runtime dependency, and in
// this npm workspace it is hoisted to the repository root — so `vsce package`
// cannot find it under `vscode/node_modules` and would ship a .vsix that fails
// to activate. Bundling sidesteps that entirely and keeps the artifact small.
//
//   node esbuild.mjs [--watch] [--production]

import { context } from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const ctx = await context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  // VS Code loads extensions as CommonJS in a Node host.
  format: 'cjs',
  platform: 'node',
  // Matches the `engines.vscode` floor, which ships Node 20.
  target: 'node20',
  // `vscode` is provided by the editor at runtime and must never be bundled.
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
