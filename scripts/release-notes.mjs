#!/usr/bin/env node
// Extracts one version's section from CHANGELOG.md, for the GitHub Release.
//
//   node scripts/release-notes.mjs 0.1.1 [--out RELEASE_NOTES.md]
//
// Release notes are written, not generated. Auto-generating them from commit
// subjects puts internal detail — what broke, which flag was wrong — in front
// of users who only want to know what the thing does and how to install it.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { editorsRoot } from './lib/language-data.mjs';

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('-'));
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args[outIndex + 1] : null;

if (version === undefined) {
  console.error('usage: release-notes.mjs <version> [--out <file>]');
  process.exit(1);
}

const changelog = readFileSync(join(editorsRoot, 'CHANGELOG.md'), 'utf8');

// Everything between this version's heading and the next one.
const heading = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\][^\n]*$`, 'm');
const start = heading.exec(changelog);

if (start === null) {
  console.error(`CHANGELOG.md has no section for ${version}.`);
  console.error('Add one before tagging — the release notes come from there.');
  process.exit(1);
}

const rest = changelog.slice(start.index + start[0].length);
const next = /^## \[/m.exec(rest);
const body = (next === null ? rest : rest.slice(0, next.index)).trim();

if (body === '') {
  console.error(`The ${version} section in CHANGELOG.md is empty.`);
  process.exit(1);
}

const notes = `${body}

## Installing

**VS Code** — download \`beans-vscode-${version}.vsix\` below, then:

\`\`\`bash
code --install-extension beans-vscode-${version}.vsix
\`\`\`

**Zed** — unzip \`beans-zed-${version}.zip\`, open the command palette, run
**zed: extensions**, click **Install Dev Extension** and choose the unzipped
\`zed\` directory. Zed builds extensions from source, so this needs Rust with
the \`wasm32-wasip2\` target:

\`\`\`bash
rustup target add wasm32-wasip2
\`\`\`

Both extensions need the \`beansc\` compiler on your machine. See the
[README](https://github.com/beans-lang/editors#requirements).
`;

if (out === null || out === undefined) {
  process.stdout.write(notes);
} else {
  writeFileSync(join(editorsRoot, out), notes);
  console.log(`wrote ${out} for ${version}`);
}
