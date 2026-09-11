import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {repositoryRoot as root, releaseInfo, checksum, runCommand, npmCommand, readJSON} from './release.mjs';

const info = releaseInfo(), destination = path.join(root, 'dist');
fs.mkdirSync(destination, {recursive: true});
// Stage both packages before publishing their completion manifest.
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'margin-package-'));
try {
  const cli = path.join(temp, 'cli'); fs.mkdirSync(path.join(cli, 'dist'), {recursive: true});
  const cliPackage = readJSON(path.join(root, 'packages/cli/package.json'));
  fs.writeFileSync(path.join(cli, 'package.json'), JSON.stringify({name: 'margin-cli', version: info.version, private: true, description: 'Margin source-first, comment-only writing reviewer', license: 'MIT', bin: {margin: 'dist/main.js'}, engines: cliPackage.engines, files: ['dist/main.js', 'LICENSE', 'README.md']}, null, 2) + '\n');
  fs.copyFileSync(path.join(root, 'packages/cli/dist/main.js'), path.join(cli, 'dist/main.js'));
  fs.chmodSync(path.join(cli, 'dist/main.js'), 0o755);
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(cli, 'LICENSE'));
  fs.copyFileSync(path.join(root, 'README.md'), path.join(cli, 'README.md'));
  const actual = await runCommand(process.execPath, [path.join(cli, 'dist/main.js'), '--version'], {cwd: temp, capture: true});
  if (actual !== `margin ${info.version}`) throw new Error('CLI bundle version is stale. Run npm run build before packaging.');
  const pack = npmCommand(['pack', '--ignore-scripts', '--json', '--pack-destination', temp]);
  await runCommand(pack.command, pack.args, {cwd: cli, capture: true});
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(root, 'packages/vscode/LICENSE'));
  await runCommand(process.execPath, [path.join(root, 'node_modules/@vscode/vsce/vsce'), 'package', '--no-dependencies', '--out', path.join(temp, info.extension)], {cwd: path.join(root, 'packages/vscode')});
  const artifacts = Object.fromEntries(['cli', 'extension'].map(key => [key, {file: info[key], sha256: checksum(path.join(temp, info[key]))}]));
  for (const key of ['cli', 'extension']) fs.copyFileSync(path.join(temp, info[key]), path.join(destination, info[key]));
  const manifestTemp = path.join(destination, `.margin-release-${process.pid}.tmp`);
  fs.writeFileSync(manifestTemp, JSON.stringify({schema_version: 1, version: info.version, artifacts}, null, 2) + '\n', {flag: 'wx'});
  fs.renameSync(manifestTemp, path.join(destination, info.manifest));
  console.log(`Margin ${info.version} packaged:\n${['cli', 'extension', 'manifest'].map(key => path.join(destination, info[key])).join('\n')}`);
} finally { fs.rmSync(temp, {recursive: true, force: true}); }
