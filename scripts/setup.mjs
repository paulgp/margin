import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {repositoryRoot, releaseInfo, checkNode, npmCommand, readJSON, runCommand, verifyArtifacts} from './release.mjs';

const extensionId = 'margin-local.margin';
export function findCode(explicit, {searchPath = process.env.PATH ?? '', home = os.homedir(), platform = process.platform} = {}) {
  const names = explicit ? [explicit] : ['code'];
  const candidates = names.flatMap(name => name.includes(path.sep) ? [path.resolve(name)] : searchPath.split(path.delimiter).filter(Boolean).map(dir => path.resolve(dir, name)));
  if (!explicit && platform === 'darwin') for (const apps of ['/Applications', path.join(home, 'Applications')]) candidates.push(path.join(apps, 'Visual Studio Code.app/Contents/Resources/app/bin/code'));
  for (const file of candidates) {
    try { if (fs.statSync(file).isFile()) { fs.accessSync(file, fs.constants.X_OK); return file; } } catch {}
  }
  throw new Error('VS Code CLI not found. Install VS Code or pass --code /path/to/code. In VS Code you can also run “Shell Command: Install code command in PATH”. Use --cli-only to install just the CLI.');
}
export function newerThan(installed, target) {
  const parts = v => /^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : undefined;
  const a = parts(installed), b = parts(target);
  if (!a || !b) throw new Error(`Cannot compare installed version ${installed} with ${target}; refusing an automatic replacement.`);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function writablePrefix(prefix) {
  let existing = prefix;
  while (!fs.existsSync(existing)) { const parent = path.dirname(existing); if (parent === existing) break; existing = parent; }
  try { fs.accessSync(existing, fs.constants.W_OK); } catch { throw new Error(`npm prefix is not writable: ${prefix}. Rerun with --prefix "$HOME/.local"; no sudo is needed.`); }
}
export async function setup(args = process.argv.slice(2), {root = repositoryRoot, run = runCommand, signal, log = console.log} = {}) {
  const {values} = parseArgs({args, strict: true, options: {help: {type: 'boolean'}, prefix: {type: 'string'}, code: {type: 'string'}, 'cli-only': {type: 'boolean'}, 'skip-dependencies': {type: 'boolean'}, 'from-dist': {type: 'boolean'}, 'extensions-dir': {type: 'string'}, 'user-data-dir': {type: 'string'}, profile: {type: 'string'}}});
  if (values.help) {
    log('Usage: npm run setup -- [options]\n\nInstalls the standalone Margin CLI and VS Code extension. Rerun after updating the checkout.\n\n--prefix DIR           npm global prefix (defaults to your npm configuration)\n--code PATH            VS Code CLI executable; macOS app location is also detected\n--profile NAME         Install into a specific VS Code profile\n--cli-only             Install CLI without requiring VS Code\n--skip-dependencies    Use existing node_modules; still build and package\n--from-dist            Install already packaged artifacts; no build/download\n--extensions-dir DIR   Alternate VS Code extension directory\n--user-data-dir DIR    Alternate VS Code user-data directory\n--help                 Show this help\n\nRequires Node 22/24 and npm. Setup does not open a project window or edit shell startup files.');
    return;
  }
  checkNode();
  if (process.platform === 'win32') throw new Error('The setup helper currently supports macOS/Linux. Install the CLI tarball with npm and the VSIX through VS Code on Windows.');
  signal?.throwIfAborted();
  const info = releaseInfo(root), common = {cwd: root, signal};
  const npm = (args, options = {}) => { const call = npmCommand(args); return run(call.command, call.args, {...common, ...options}); };
  const code = values['cli-only'] ? undefined : findCode(values.code);
  const codeScope = ['extensions-dir', 'user-data-dir', 'profile'].flatMap(key => values[key] ? [`--${key}`, key === 'profile' ? values[key] : path.resolve(values[key])] : []);
  log(`Preparing Margin ${info.version}. Checking installation targets.`);
  await npm(['--version'], {capture: true, timeoutMs: 10000});
  const prefix = path.resolve(values.prefix ?? await npm(['prefix', '--global'], {capture: true, timeoutMs: 10000}));
  writablePrefix(prefix);
  const existingPackage = path.join(prefix, 'lib/node_modules/margin-cli/package.json');
  if (fs.existsSync(existingPackage) && newerThan(readJSON(existingPackage).version, info.version)) throw new Error(`A newer Margin CLI is installed. Update this checkout before running setup.`);
  if (code) {
    const versionOutput = await run(code, ['--version'], {...common, capture: true, timeoutMs: 10000});
    const version = versionOutput.split(/\r?\n/).find(line => /^\d+\.\d+\.\d+$/.test(line));
    if (!version || newerThan('1.100.0', version)) throw new Error('Margin needs VS Code 1.100.0 or newer. Update VS Code and rerun setup.');
    const list = await run(code, [...codeScope, '--list-extensions', '--show-versions'], {...common, capture: true, timeoutMs: 30000});
    const installed = list.split(/\r?\n/).find(line => line.toLowerCase().startsWith(extensionId + '@'))?.split('@')[1];
    if (installed && newerThan(installed, info.version)) throw new Error('A newer Margin extension is installed. Update this checkout before running setup.');
  }
  if (!values['from-dist']) {
    if (!values['skip-dependencies']) { log('Installing the pinned build dependencies.'); await npm(['ci', '--no-audit', '--no-fund']); }
    log('Building and packaging the CLI and extension.');
    await npm(['run', 'package']);
  }
  const directory = path.join(root, 'dist'); verifyArtifacts(directory, info);
  log(`Installing Margin CLI ${info.version} into ${prefix}.`);
  try { await npm(['install', '--global', '--prefix', prefix, path.join(directory, info.cli), '--offline', '--ignore-scripts', '--no-audit', '--no-fund']); }
  catch (error) { throw new Error(`CLI installation failed. No extension installation was attempted. ${error.message}\nIf the npm prefix is protected, rerun with --prefix "$HOME/.local".`); }
  const binary = path.join(prefix, 'bin/margin');
  const cliVersion = await run(process.execPath, [binary, '--version'], {...common, capture: true, timeoutMs: 10000});
  if (cliVersion !== `margin ${info.version}`) throw new Error('CLI installation returned an unexpected version. Rerun setup.');
  if (code) {
    log(`Installing Margin extension ${info.version}.`);
    try {
      await run(code, [...codeScope, '--install-extension', path.join(directory, info.extension), '--force'], common);
      const installed = await run(code, [...codeScope, '--list-extensions', '--show-versions'], {...common, capture: true, timeoutMs: 30000});
      if (!installed.toLowerCase().split(/\r?\n/).includes(`${extensionId}@${info.version}`)) throw new Error('VS Code did not report the expected installed version');
    } catch (error) { throw new Error(`CLI ${info.version} is installed, but extension installation failed. Rerun setup to retry. ${error.message}`); }
  }
  log(`Installed Margin ${info.version}. CLI: ${binary}`);
  const found = (process.env.PATH ?? '').split(path.delimiter).map(dir => path.join(dir, 'margin')).find(file => { try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; } });
  const same = found && fs.existsSync(binary) && fs.realpathSync(found) === fs.realpathSync(binary);
  if (!same) {
    const quoted = "'" + path.join(prefix, 'bin').replaceAll("'", "'\"'\"'") + "'";
    log(`To use this installation in your shell, put its bin directory first on PATH:\nexport PATH=${quoted}:"$PATH"\nAdd that line to your shell startup file if needed; setup has not changed it.`);
  }
  if (code) log('In your existing VS Code window, run Developer: Reload Window once. Then open your writing project normally and use Margin: Select Review. F5 is only for extension development.');
  log('In a writing project: margin init, then margin review draft.md --provider mock (or --provider codex for a model review).');
  return {version: info.version, prefix, binary, extension: Boolean(code)};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController(), cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  setup(undefined, {signal: controller.signal}).catch(error => { console.error(`Margin setup: ${error.message}`); process.exitCode = 1; }).finally(() => { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); });
}
