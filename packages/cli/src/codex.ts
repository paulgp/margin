import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {packetText, responseSchema, json, Request} from '@margin/core';
import {Provider, ProviderResult} from './providers';

export const supportedVersion = '0.154.0';
// 0.154.0 forces the unified_exec backend on. Disable tool exposure (shell_tool),
// and rely on the outer OS process boundary; do not claim that backend is disabled.
export const disabledFeatures = ['apps', 'plugins', 'remote_plugin', 'hooks', 'shell_tool', 'shell_snapshot', 'multi_agent', 'multi_agent_v2', 'code_mode', 'code_mode_host', 'browser_use', 'browser_use_external', 'computer_use', 'in_app_browser', 'image_generation', 'view_image', 'skill_search', 'skill_mcp_dependency_install', 'workspace_dependencies', 'memories', 'goals', 'request_permissions_tool', 'exec_permission_approvals', 'guardian_approval', 'in_app_local_automation', 'tool_suggest'];
export interface RunOptions {cwd: string; env: NodeJS.ProcessEnv; input?: string; timeoutMs?: number; outputBytes?: number; signal?: AbortSignal}
/** No shell. A new process group lets cancellation/timeouts kill descendants too. */
export function runProcess(executable: string, args: string[], options: RunOptions): Promise<{stdout: string; stderr: string}> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error('Provider cancelled')); return; }
    const child = spawn(executable, args, {cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', shell: false});
    let stdout = '', stderr = '', size = 0, failure: Error | undefined;
    const kill = () => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* Already exited. */ } };
    const stop = (message: string) => { failure ??= new Error(message); kill(); };
    const abort = () => stop('Provider cancelled');
    const timer = setTimeout(() => stop('Provider timed out'), options.timeoutMs ?? 120000);
    options.signal?.addEventListener('abort', abort, {once: true});
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); kill(); };
    child.on('error', e => { cleanup(); reject(new Error(`Cannot start reviewer executable: ${e.message}`)); });
    for (const [stream, isOut] of [[child.stdout, true], [child.stderr, false]] as const) stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > (options.outputBytes ?? 2 * 1024 * 1024)) { stop('Provider exceeded output byte limit'); return; }
      if (isOut) stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
    });
    child.on('close', (code, signal) => { cleanup(); if (failure) reject(failure); else if (code !== 0) reject(new Error(`Provider exited ${signal ?? code}: ${stderr.slice(-2000) || 'no diagnostic output; runtime may be incompatible with the isolation policy'}`)); else resolve({stdout, stderr}); });
    child.stdin.on('error', () => { /* EPIPE is reported by process exit. */ }); child.stdin.end(options.input ?? '');
  });
}
function executableOnPath(name: string): string {
  if (name.includes(path.sep)) return fs.realpathSync(name);
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory)) continue;
    const file = path.join(directory, name);
    try { fs.accessSync(file, fs.constants.X_OK); return fs.realpathSync(file); } catch { /* Next PATH entry. */ }
  }
  throw new Error('Codex executable not found. Install the supported Codex CLI, or use prepare/import.');
}
function nativeExecutable(launcher: string): string {
  if (!launcher.endsWith('/bin/codex.js')) return launcher;
  const target = process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  const pkg = `@openai/codex-darwin-${process.arch}`;
  let vendor: string;
  try { vendor = path.join(path.dirname(createRequire(launcher).resolve(`${pkg}/package.json`)), 'vendor'); }
  catch { vendor = path.resolve(path.dirname(launcher), '../vendor'); }
  return fs.realpathSync(path.join(vendor, target, 'bin/codex'));
}
const seatbeltString = (s: string) => JSON.stringify(s);
/** The OS boundary wraps the ENTIRE reviewer, not only its shell tools. */
export function seatbeltProfile(temp: string, executable: string, projectRoot?: string): string {
  const system = ['/System', '/usr', '/bin', '/sbin', '/private/etc', '/Library/Apple', '/Library/Frameworks', '/opt/homebrew/Cellar', '/opt/homebrew/opt', '/opt/homebrew/lib'];
  return `(version 1)\n(allow default)\n(deny file-write* (require-not (subpath ${seatbeltString(temp)})))\n(deny file-read-data (require-not (require-any ${system.map(p => `(subpath ${seatbeltString(p)})`).join(' ')} (subpath ${seatbeltString(temp)}) (literal ${seatbeltString(executable)}) (literal ${seatbeltString(fs.realpathSync(process.execPath))}) (subpath "/dev") (literal "/"))))\n(deny file-read-data (subpath "/private/etc/codex") (subpath "/etc/codex"))\n${projectRoot ? `(deny file-read-data (subpath ${seatbeltString(projectRoot)}))\n` : ''}(deny process-exec (require-not (require-any (literal ${seatbeltString(executable)}) (literal ${seatbeltString(fs.realpathSync(process.execPath))}) (literal "/usr/bin/true"))))\n(deny appleevent-send)\n`;
}
export function codexArgs(schema: string, output: string, cwd: string, model?: string): string[] {
  if (model !== undefined && (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(model))) throw new Error('Invalid model identifier');
  const settings = ['approval_policy="never"', 'approvals_reviewer="user"', 'mcp_servers={}', 'hooks={}', 'apps._default.enabled=false', 'agents.enabled=false', 'web_search="disabled"', 'project_doc_max_bytes=0', 'history.persistence="none"', 'cli_auth_credentials_store="file"', 'check_for_update_on_startup=false', 'allow_login_shell=false', 'shell_environment_policy.inherit="none"', 'features.skip_host_skill_discovery=true', ...disabledFeatures.map(f => `features.${f}=false`)];
  return ['--strict-config', ...settings.flatMap(s => ['-c', s]), 'exec', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--color', 'never', '--cd', cwd, '--output-schema', schema, '--output-last-message', output, ...(model ? ['--model', model] : []), '-'];
}
export function verifyRuntime(version: string, help: string, features: string): void {
  if (version.trim() !== `codex-cli ${supportedVersion}`) throw new Error(`Unsupported safe-mode runtime: require codex-cli ${supportedVersion}; found ${version.trim()}. Use prepare/import until this version is audited.`);
  for (const flag of ['--ignore-user-config', '--ignore-rules', '--sandbox', '--output-schema', '--output-last-message', '--ephemeral', '--strict-config']) if (!help.includes(flag)) throw new Error(`Safe-mode control unavailable: ${flag}. Refusing to review.`);
  for (const feature of [...disabledFeatures, 'skip_host_skill_discovery']) if (!new RegExp(`^${feature}\\s`, 'm').test(features)) throw new Error(`Safe-mode feature unavailable: ${feature}. Refusing to review.`);
}
export function verifyFeatureSettings(features: string): void {
  for (const feature of disabledFeatures) if (!new RegExp(`^${feature}\\s+.*\\sfalse$`, 'm').test(features)) throw new Error(`Safe-mode control did not take effect: ${feature}`);
  if (!/^skip_host_skill_discovery\s+.*\strue$/m.test(features)) throw new Error('Host skill discovery could not be disabled');
}
export interface CodexOptions {executable?: string; timeoutMs?: number; signal?: AbortSignal; model?: string; authHome?: string; projectRoot?: string}
export async function runCodex(request: Request, options: CodexOptions = {}): Promise<ProviderResult> {
  if (process.platform !== 'darwin' || !fs.existsSync('/usr/bin/sandbox-exec')) throw new Error('Protected Codex execution currently requires macOS Seatbelt. Use the portable prepare/import workflow on this platform.');
  options.signal?.throwIfAborted();
  const executable = nativeExecutable(executableOnPath(options.executable ?? 'codex'));
  // OS temp, never the author project; discard all inherited config, integrations, and ambient environment.
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-codex-')));
  fs.chmodSync(temp, 0o700);
  const projectRoot = fs.realpathSync(options.projectRoot ?? process.cwd());
  if (!path.relative(projectRoot, temp).startsWith('..' + path.sep)) { fs.rmSync(temp, {recursive: true, force: true}); throw new Error('Cannot create an isolated reviewer directory outside this project root'); }
  const home = path.join(temp, 'home'), codexHome = path.join(home, '.codex'), cwd = path.join(temp, 'work');
  for (const directory of [home, codexHome, cwd]) fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  const env: NodeJS.ProcessEnv = {PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, CODEX_HOME: codexHome, TMPDIR: temp, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'), OPENSSL_CONF: '/dev/null', LANG: 'en_US.UTF-8', TERM: 'dumb'};
  const profile = seatbeltProfile(temp, executable, projectRoot);
  const invoke = (args: string[], input?: string, timeoutMs = options.timeoutMs ?? 120000) => runProcess('/usr/bin/sandbox-exec', ['-p', profile, executable, ...args], {cwd, env, input, timeoutMs, signal: options.signal});
  try {
    // Probe the outer boundary without invoking a model or reading credentials.
    await runProcess('/usr/bin/sandbox-exec', ['-p', profile, '/usr/bin/true'], {cwd, env, timeoutMs: 5000, signal: options.signal});
    const version = (await invoke(['--version'], undefined, 5000)).stdout;
    const help = (await invoke(['exec', '--help'], undefined, 5000)).stdout;
    const features = (await invoke(['features', 'list'], undefined, 5000)).stdout;
    verifyRuntime(version, help, features);
    const controls = codexArgs('unused', 'unused', cwd, options.model);
    // features list rejects --strict-config in 0.154.0; exec itself requires it below.
    const configured = await invoke([...controls.slice(1, controls.indexOf('exec')), 'features', 'list'], undefined, 5000);
    verifyFeatureSettings(configured.stdout);
    // Existing file-based login stays usable. Never read or copy config, rules, MCP tokens, plugins, or skills.
    const authHome = options.authHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
    const auth = path.join(authHome, 'auth.json');
    if (process.env.OPENAI_API_KEY) fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({OPENAI_API_KEY: process.env.OPENAI_API_KEY}), {mode: 0o600, flag: 'wx'});
    else {
      let stat: fs.Stats;
      try { stat = fs.lstatSync(auth); } catch { throw new Error('Codex authentication unavailable: use file-based codex login or OPENAI_API_KEY. Keychain-only and managed integrations are unsupported; prepare/import remains available.'); }
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new Error('Unsupported Codex authentication file');
      fs.writeFileSync(path.join(codexHome, 'auth.json'), fs.readFileSync(auth), {mode: 0o600, flag: 'wx'});
    }
    const schema = path.join(temp, 'schema.json'), output = path.join(temp, 'response.json');
    fs.writeFileSync(schema, json(responseSchema(request.id, request.max_comments)), {mode: 0o600, flag: 'wx'});
    const args = codexArgs(schema, output, cwd, options.model);
    await invoke(args, packetText(request));
    // Progress output is never parsed as the final answer.
    let stat: fs.Stats;
    try { stat = fs.lstatSync(output); } catch { throw new Error('Codex produced no final response file'); }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Codex final response must be a regular file under 1 MiB');
    return {response: fs.readFileSync(output, 'utf8'), provenance: {provider: 'codex', requested_model: options.model ?? null, reported_model: null, runtime: `codex-cli ${supportedVersion}`}};
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}
export const codexProvider: Provider = {name: 'codex', run: (request, options) => runCodex(request, options)};
