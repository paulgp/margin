import {execFileSync} from 'node:child_process';
import {mkdirSync, copyFileSync} from 'node:fs';
mkdirSync('dist', {recursive:true});
copyFileSync('LICENSE', 'packages/vscode/LICENSE');
execFileSync(process.execPath, ['../../node_modules/@vscode/vsce/vsce', 'package', '--no-dependencies', '--allow-missing-repository', '--out', '../../dist/margin-0.1.0.vsix'], {cwd:'packages/vscode', stdio:'inherit'});
