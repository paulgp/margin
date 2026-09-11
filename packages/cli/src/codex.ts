import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {StringDecoder} from 'node:string_decoder';
import {packetText, responseSchema, json, Request} from '@margin/core';
import {Provider, ProviderResult, ProviderOptions} from './providers';

export const supportedVersion = '0.154.0';
// 0.154.0 forces the unified_exec backend on. Disable tool exposure (shell_tool),
// and rely on the outer OS process boundary; do not claim that backend is disabled.
export const disabledFeatures = ['apps', 'plugins', 'remote_plugin', 'hooks', 'shell_tool', 'shell_snapshot', 'multi_agent', 'multi_agent_v2', 'code_mode', 'code_mode_host', 'browser_use', 'browser_use_external', 'computer_use', 'in_app_browser', 'image_generation', 'view_image', 'skill_search', 'skill_mcp_dependency_install', 'workspace_dependencies', 'memories', 'goals', 'request_permissions_tool', 'exec_permission_approvals', 'guardian_approval', 'in_app_local_automation', 'tool_suggest', 'unbounded_connection_retries'];
export interface RunOptions {cwd: string; env: NodeJS.ProcessEnv; input?: string; timeoutMs?: number; outputBytes?: number; signal?: AbortSignal; onLine?: (line: string, stream: 'stdout' | 'stderr') => void; failureDetail?: (stderr: string) => string}

/** Report fixed diagnostic descriptions, never model prose, secrets, URLs, or terminal escapes. */
export function providerIssue(text: string): string | undefined {
  // URLs can contain words such as "invalid"/"token" or status-like numbers.
  // Do not let credentials, query parameters, or endpoint names select a diagnosis.
  text = text.replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, '[URL]');
  const status = Number(text.match(/(?:^|\bHTTP(?:\/[\d.]+)?(?: status)?|\bstatus(?: code)?)\s*[:=]?\s*(\d{3})\b/i)?.[1]);
  if (status === 407 || /proxy.{0,40}(failed|error|authentication|connect)|tunnel.{0,20}(failed|error)/i.test(text)) return 'Codex reported a proxy connection or proxy authentication failure.';
  if (status === 429 || /rate.limit|quota.exceeded/i.test(text)) return 'Codex reported a rate limit or exhausted quota.';
  if ([500, 502, 503, 504].includes(status) || /service unavailable|bad gateway/i.test(text)) return 'Codex reported a server or gateway error.';
  if (status === 401 || status === 403 || /unauthenticated|unauthorized|authentication|invalid.{0,20}(token|api.key)|token.{0,20}(expired|refresh)/i.test(text)) return 'Codex reported an authentication or authorization problem.';
  if (/model.{0,60}(not found|does not exist|not supported|not available)|unsupported model|model_not_found/i.test(text)) return 'Codex reported that the requested model is unavailable or unsupported.';
  if (/invalid.{0,30}schema|schema.{0,30}(invalid|unsupported)|invalid_request_error/i.test(text)) return 'Codex rejected the request or response schema.';
  if (/operation not permitted|permission denied|sandbox.{0,20}(failed|error)/i.test(text)) return 'Codex reported a permissions error inside the protected runtime.';
  if (/dns|failed to resolve|name or service not known|nodename nor servname|ENOTFOUND|EAI_AGAIN/i.test(text)) return 'Codex reported a DNS resolution failure.';
  if (/tls|ssl|certificate|UnknownIssuer|InvalidCertificate/i.test(text)) return 'Codex reported a TLS or certificate failure.';
  if (/connection refused|ECONNREFUSED/i.test(text)) return 'Codex reported a refused network connection.';
  if (/connection reset|ECONNRESET|broken pipe|EPIPE/i.test(text)) return 'Codex reported a reset or broken network connection.';
  if (/websocket|web.socket/i.test(text) && /fail|error|disconnect|reconnect|closed|retry/i.test(text)) return 'Codex reported a WebSocket connection failure or retry.';
  if (/error decoding response body|invalid.{0,15}(response|event)|failed to parse.{0,20}(response|event)/i.test(text)) return 'Codex reported a response or stream decoding failure.';
  if (/timed out|ETIMEDOUT|connect timeout/i.test(text)) return 'Codex reported a network timeout.';
  if (/reconnect|retrying|retry attempt|error sending request|failed to (connect|resolve)|connection.{0,30}(failed|closed|reset)|dns|tls|certificate|stream disconnected|timed out/i.test(text)) return 'Codex reported a connection problem or retry.';
  return undefined;
}
export function providerDiagnostic(text: string): string | undefined {
  const issue = providerIssue(text);
  if (!issue) return undefined;
  const retry = text.replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, '').match(/(?:reconnect(?:ing)?|retry(?:ing)?(?: turn)?|retry attempt)\s*\(?(\d{1,3})\s*\/\s*(\d{1,3})\b/i);
  const detail = retry ? ` Retry ${Number(retry[1])}/${Number(retry[2])}.` : '';
  if (/models_manager|refresh.{0,30}(available )?models|fetch.{0,30}model.{0,10}(list|catalog)/i.test(text)) return `${issue} Reported while fetching the model catalog; this alone does not establish that the review request failed.`;
  return issue + detail;
}
export function eventProgress(line: string): {message?: string; issue?: string} {
  let event: any; try { event = JSON.parse(line); } catch { return {}; }
  if (event?.type === 'thread.started') return {message: 'Codex created a local session; service connection is not yet confirmed.'};
  if (event?.type === 'turn.started') return {message: 'Codex started the local review turn; awaiting model output.'};
  if (['item.started', 'item.updated', 'item.completed'].includes(event?.type) && event.item?.type === 'reasoning') return {message: 'Codex emitted reasoning activity; awaiting final comments.'};
  if (event?.type === 'turn.completed') return {message: 'Codex completed the review turn.'};
  if (event?.type === 'item.completed' && event.item?.type === 'agent_message') return {message: 'Codex produced a response; waiting for the final response file.'};
  if (event?.type === 'error' || event?.type === 'turn.failed') {
    const raw = typeof event.message === 'string' ? event.message : typeof event.error?.message === 'string' ? event.error.message : '';
    const issue = providerDiagnostic(raw) ?? 'Codex reported a review error.';
    return {message: issue, issue};
  }
  return {};
}
/** No shell. A new process group lets cancellation/timeouts kill descendants too. */
export function runProcess(executable: string, args: string[], options: RunOptions): Promise<{stdout: string; stderr: string}> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error('Provider cancelled')); return; }
    const child = spawn(executable, args, {cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', shell: false});
    let stdout = '', stderr = '', size = 0, failure: Error | undefined;
    const kill = () => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* Already exited. */ } };
    const stop = (message: string) => { failure ??= new Error(message); kill(); };
    const abort = () => stop('Provider cancelled');
    const timer = setTimeout(() => stop(`Provider timed out after ${(options.timeoutMs ?? 120000) / 1000} seconds`), options.timeoutMs ?? 120000);
    options.signal?.addEventListener('abort', abort, {once: true});
    const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); kill(); };
    child.on('error', e => { cleanup(); reject(new Error(`Cannot start reviewer executable: ${e.message}`)); });
    for (const [stream, isOut] of [[child.stdout, true], [child.stderr, false]] as const) {
      const decoder = new StringDecoder('utf8'); let pending = '';
      const deliver = (text: string, finish = false) => {
        if (isOut) stdout += text; else stderr += text;
        if (!options.onLine) return;
        pending += text;
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
          options.onLine(pending.slice(0, newline).replace(/\r$/, ''), isOut ? 'stdout' : 'stderr');
          pending = pending.slice(newline + 1);
        }
        if (finish && pending) options.onLine(pending, isOut ? 'stdout' : 'stderr');
      };
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > (options.outputBytes ?? 2 * 1024 * 1024)) { stop('Provider exceeded output byte limit'); return; }
        deliver(decoder.write(chunk));
      });
      stream.on('end', () => deliver(decoder.end(), true));
    }
    child.on('close', (code, signal) => { cleanup(); if (failure) reject(failure); else if (code !== 0) reject(new Error(`Provider exited ${signal ?? code}: ${options.failureDetail ? options.failureDetail(stderr) : stderr.slice(-2000) || 'no diagnostic output; runtime may be incompatible with the isolation policy'}`)); else resolve({stdout, stderr}); });
    child.stdin.on('error', () => { /* EPIPE is reported by process exit. */ }); child.stdin.end(options.input ?? '');
  });
}
export function executableOnPath(name: string): string {
  if (name.includes(path.sep)) return fs.realpathSync(name);
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory)) continue;
    const file = path.join(directory, name);
    try { fs.accessSync(file, fs.constants.X_OK); return fs.realpathSync(file); } catch { /* Next PATH entry. */ }
  }
  throw new Error('Codex executable not found. Install the supported Codex CLI, or use prepare/import.');
}
export function nativeExecutable(launcher: string): string {
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
  return ['--strict-config', ...settings.flatMap(s => ['-c', s]), 'exec', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--json', '--color', 'never', '--cd', cwd, '--output-schema', schema, '--output-last-message', output, ...(model ? ['--model', model] : []), '-'];
}
export function verifyRuntime(version: string, help: string, features: string): void {
  if (version.trim() !== `codex-cli ${supportedVersion}`) throw new Error(`Unsupported safe-mode runtime: require codex-cli ${supportedVersion}; found ${version.trim()}. Use prepare/import until this version is audited.`);
  for (const flag of ['--ignore-user-config', '--ignore-rules', '--sandbox', '--output-schema', '--output-last-message', '--ephemeral', '--strict-config', '--json']) if (!help.includes(flag)) throw new Error(`Safe-mode control unavailable: ${flag}. Refusing to review.`);
  for (const feature of [...disabledFeatures, 'skip_host_skill_discovery']) if (!new RegExp(`^${feature}\\s`, 'm').test(features)) throw new Error(`Safe-mode feature unavailable: ${feature}. Refusing to review.`);
}
export function verifyFeatureSettings(features: string): void {
  for (const feature of disabledFeatures) if (!new RegExp(`^${feature}\\s+.*\\sfalse$`, 'm').test(features)) throw new Error(`Safe-mode control did not take effect: ${feature}`);
  if (!/^skip_host_skill_discovery\s+.*\strue$/m.test(features)) throw new Error('Host skill discovery could not be disabled');
}
export interface CodexOptions extends ProviderOptions {executable?: string; timeoutMs?: number; authHome?: string}
/** The doctor uses exactly the same fresh environment as a review. */
export function protectedEnvironment(temp: string): NodeJS.ProcessEnv {
  const home = path.join(temp, 'home');
  return {PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, CODEX_HOME: path.join(home, '.codex'), TMPDIR: temp, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'), OPENSSL_CONF: '/dev/null', LANG: 'en_US.UTF-8', TERM: 'dumb', RUST_LOG: 'warn'};
}
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
  const env = protectedEnvironment(temp);
  const profile = seatbeltProfile(temp, executable, projectRoot);
  const invoke = (args: string[], input?: string, timeoutMs = options.timeoutMs ?? 120000, onLine?: RunOptions['onLine']) => runProcess('/usr/bin/sandbox-exec', ['-p', profile, executable, ...args], {cwd, env, input, timeoutMs, signal: options.signal, onLine, failureDetail: stderr => providerDiagnostic(stderr) ?? 'No recognized diagnostic. Run margin doctor to check the protected connection.'});
  try {
    options.onProgress?.('Checking the protected Codex runtime (startup probes have 5-second limits).');
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
    options.onProgress?.(`Codex ${supportedVersion} protection checks passed; loading authentication.`);
    // Existing file-based login stays usable. Never read or copy config, rules, MCP tokens, plugins, or skills.
    const authHome = options.authHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
    const auth = path.join(authHome, 'auth.json');
    if (process.env.OPENAI_API_KEY) {
      fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({OPENAI_API_KEY: process.env.OPENAI_API_KEY}), {mode: 0o600, flag: 'wx'});
      options.onProgress?.('Authentication source: OPENAI_API_KEY environment variable (value hidden; validity not yet checked).');
    }
    else {
      let stat: fs.Stats;
      try { stat = fs.lstatSync(auth); } catch { throw new Error('Codex authentication unavailable: use file-based codex login or OPENAI_API_KEY. Keychain-only and managed integrations are unsupported; prepare/import remains available.'); }
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) throw new Error('Unsupported Codex authentication file');
      fs.writeFileSync(path.join(codexHome, 'auth.json'), fs.readFileSync(auth), {mode: 0o600, flag: 'wx'});
      options.onProgress?.('Authentication source: saved Codex auth.json (isolated copy; validity not yet checked).');
    }
    const schema = path.join(temp, 'schema.json'), output = path.join(temp, 'response.json');
    fs.writeFileSync(schema, json(responseSchema(request.id, request.max_comments)), {mode: 0o600, flag: 'wx'});
    const args = codexArgs(schema, output, cwd, options.model);
    options.onProgress?.(`Starting Codex review; ${(options.timeoutMs ?? 120000) / 1000}-second timeout. Unbounded retries disabled. Model: ${options.model ?? 'Codex default (user configuration is not loaded)'}. Press Ctrl+C to cancel.`);
    let lastIssue: string | undefined;
    try {
      await invoke(args, packetText(request), options.timeoutMs ?? 120000, (line, stream) => {
        const progress = stream === 'stdout' ? eventProgress(line) : {issue: providerDiagnostic(line)};
        if (progress.issue && progress.issue !== lastIssue) {
          lastIssue = progress.issue; options.onProgress?.(lastIssue);
        } else if ('message' in progress && progress.message && !progress.issue) options.onProgress?.(progress.message);
      });
    } catch (e) {
      throw new Error(`${(e as Error).message}${lastIssue ? `\nLast Codex issue: ${lastIssue}` : ''}`);
    }
    options.onProgress?.('Reading the final response for validation and import.');
    // Progress output is never parsed as the final answer.
    let stat: fs.Stats;
    try { stat = fs.lstatSync(output); } catch { throw new Error('Codex produced no final response file'); }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Codex final response must be a regular file under 1 MiB');
    return {response: fs.readFileSync(output, 'utf8'), provenance: {provider: 'codex', requested_model: options.model ?? null, reported_model: null, runtime: `codex-cli ${supportedVersion}`}};
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}
export const codexProvider: Provider = {name: 'codex', run: (request, options) => runCodex(request, options)};
