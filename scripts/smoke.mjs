import {runTests} from '@vscode/test-electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const core = require('../packages/core/dist');
const {mockProvider} = require('../packages/cli/dist/providers');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-smoke-'));
try {
  fs.copyFileSync('examples/markdown/draft.md', path.join(root,'draft.md'));
  const {request} = core.prepare(root, {file:'draft.md'});
  const result = await mockProvider.run(request); core.importResponse(root, request.id, result.response, result.provenance);
  const installed = '/Applications/Visual Studio Code.app/Contents/MacOS/Electron';
  const macBinary = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
  const vscodeExecutablePath = process.env.MARGIN_VSCODE_EXECUTABLE ?? (fs.existsSync(installed) ? installed : fs.existsSync(macBinary) ? macBinary : undefined);
  await runTests({extensionDevelopmentPath:path.resolve('packages/vscode'), extensionTestsPath:path.resolve('tests/extension/suite.cjs'), ...(vscodeExecutablePath ? {vscodeExecutablePath} : {}), launchArgs:[root, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--user-data-dir', path.join(root,'.vscode-user'), '--extensions-dir', path.join(root,'.vscode-extensions')]});
} finally { fs.rmSync(root, {recursive:true, force:true}); }
