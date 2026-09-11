import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import {setup} from './setup.mjs';
import {repositoryRoot, releaseInfo, runCommand} from './release.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-install-smoke-'));
const prefix = path.join(temp, 'npm prefix'), extensions = path.join(temp, 'extensions'), userData = path.join(temp, 'vscode user');
// Avoid routing the CLI through an existing editor's IPC socket during this isolated test.
const env = {...process.env}; delete env.VSCODE_IPC_HOOK_CLI;
const run = (command, args, options) => runCommand(command, args, {...options, env});
try {
  // Simulate an older npm-link installation without pointing at the real checkout.
  const legacy = path.join(temp, 'old checkout'); fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(legacy, 'package.json'), JSON.stringify({name: 'margin-cli', version: '0.1.0', bin: {margin: 'main.js'}}));
  fs.writeFileSync(path.join(legacy, 'main.js'), '#!/usr/bin/env node\nconsole.log("margin 0.1.0");\n', {mode: 0o755});
  fs.mkdirSync(path.join(prefix, 'lib/node_modules'), {recursive: true}); fs.mkdirSync(path.join(prefix, 'bin'));
  fs.symlinkSync(legacy, path.join(prefix, 'lib/node_modules/margin-cli'));
  fs.symlinkSync(path.join(legacy, 'main.js'), path.join(prefix, 'bin/margin'));
  const legacyBefore = fs.readFileSync(path.join(legacy, 'main.js'));
  const args = ['--prefix', prefix, '--extensions-dir', extensions, '--user-data-dir', userData];
  const installed = await setup(args, {run});
  const first = await run(process.execPath, [installed.binary, '--version', '--json'], {cwd: temp, capture: true});
  assert.equal(JSON.parse(first).version, releaseInfo().version);
  const project = path.join(temp, 'writing project'); fs.mkdirSync(project);
  fs.copyFileSync(path.join(repositoryRoot, 'examples/markdown/draft.md'), path.join(project, 'draft.md'));
  const before = fs.readFileSync(path.join(project, 'draft.md'));
  await run(process.execPath, [installed.binary, 'init'], {cwd: project});
  const review = JSON.parse(await run(process.execPath, [installed.binary, 'review', 'draft.md', '--provider', 'mock', '--json'], {cwd: project, capture: true}));
  const sessionFile = path.join(project, review.session), session = fs.readFileSync(sessionFile);
  assert.ok(JSON.parse(session).comments.length > 0);
  const focused = JSON.parse(await run(process.execPath, [installed.binary, 'review', 'draft.md', '--lines', '3,7-9', '--provider', 'mock', '--json'], {cwd: project, capture: true}));
  const focusedFile = path.join(project, focused.session), focusedBytes = fs.readFileSync(focusedFile), focusedSession = JSON.parse(focusedBytes);
  assert.equal(focusedSession.schema_version, 2);
  assert.equal(focusedSession.focus.length, 2);
  assert.ok(focusedSession.comments.every(c => focusedSession.focus.some(r => r.file === c.anchor.path && c.anchor.start >= r.start && c.anchor.end <= r.end)));
  await setup(['--from-dist', ...args], {run}); // Same-version reinstall/update must be repeatable.
  assert.deepEqual(fs.readFileSync(path.join(project, 'draft.md')), before);
  assert.deepEqual(fs.readFileSync(sessionFile), session);
  assert.deepEqual(fs.readFileSync(focusedFile), focusedBytes);
  assert.deepEqual(fs.readFileSync(path.join(legacy, 'main.js')), legacyBefore);
  const pkg = JSON.parse(fs.readFileSync(path.join(prefix, 'lib/node_modules/margin-cli/package.json')));
  assert.equal(pkg.dependencies, undefined); assert.equal(pkg.scripts, undefined);
  assert.ok(!fs.lstatSync(path.join(prefix, 'lib/node_modules/margin-cli')).isSymbolicLink());
  console.log('Installation smoke passed: real standalone CLI and VSIX installed in isolated directories; full/focused offline reviews and repeat installation preserved draft/review bytes.');
} finally { fs.rmSync(temp, {recursive: true, force: true}); }
