import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {executableOnPath, nativeExecutable, protectedEnvironment, runProcess, seatbeltProfile, supportedVersion} from './codex';

export const destinations = ['chatgpt.com', 'api.openai.com'] as const;
const errorCodes = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH', 'EPERM', 'EACCES', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNKNOWN'] as const;
export interface ConnectionResult {phase: 'dns' | 'tcp' | 'tls' | 'http' | 'process'; status?: number; code?: string}
export interface DoctorOptions {signal?: AbortSignal; onProgress?: (message: string) => void; run?: typeof runProcess}

// Trusted fixed program: no model, authentication, response body, redirects, or project reads.
// The subprocess gets the SAME cleared environment and outer Seatbelt policy as Codex.
export const connectionProbeScript = String.raw`
const https = require('node:https');
const host = process.argv[1];
if (!['chatgpt.com', 'api.openai.com'].includes(host)) process.exit(2);
let phase = 'dns', finished = false, request;
const timer = setTimeout(() => { finish({phase, code:'ETIMEDOUT'}); request.destroy(); }, 8000);
function finish(result) {
  if (finished) return;
  finished = true; clearTimeout(timer);
  process.stdout.write(JSON.stringify(result) + '\n');
}
request = https.request({hostname:host, port:443, method:'HEAD', path:'/', agent:false, rejectUnauthorized:true}, response => {
  finish({phase:'http', status:response.statusCode}); response.destroy(); request.destroy();
});
request.on('socket', socket => {
  socket.on('lookup', error => { if (!error) phase = 'tcp'; });
  socket.on('connect', () => { phase = 'tls'; });
  socket.on('secureConnect', () => { phase = 'http'; });
});
request.on('error', error => {
  const codes = ${JSON.stringify(errorCodes)};
  finish({phase, code:codes.includes(error.code) ? error.code : 'UNKNOWN'});
});
request.end();
`;

const ignoredNames = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'CODEX_CA_CERTIFICATE', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'OPENAI_BASE_URL', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN'] as const;
export function ignoredEnvironment(env: NodeJS.ProcessEnv): string[] { return ignoredNames.filter(name => Boolean(env[name])); }

export function parseConnectionResult(stdout: string): ConnectionResult {
  const value = JSON.parse(stdout);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['phase', 'status', 'code'].includes(k))) throw new Error('Invalid connection probe result');
  if (!['dns', 'tcp', 'tls', 'http'].includes(value.phase)) throw new Error('Invalid connection probe phase');
  if (value.status !== undefined && value.phase === 'http' && Number.isInteger(value.status) && value.status >= 100 && value.status <= 599 && value.code === undefined) return {phase: 'http', status: value.status};
  if (value.status === undefined && errorCodes.includes(value.code)) return {phase: value.phase, code: value.code};
  throw new Error('Invalid connection probe status');
}

export async function doctor(projectRoot: string, options: DoctorOptions = {}) {
  if (process.platform !== 'darwin' || !fs.existsSync('/usr/bin/sandbox-exec')) throw new Error('Margin doctor currently requires macOS Seatbelt, like the protected Codex adapter.');
  options.signal?.throwIfAborted();
  const run = options.run ?? runProcess;
  const root = fs.realpathSync(projectRoot), temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'margin-codex-doctor-')));
  fs.chmodSync(temp, 0o700);
  try {
    if (!path.relative(root, temp).startsWith('..' + path.sep)) throw new Error('Cannot create a diagnostic directory outside this project root');
    const env = protectedEnvironment(temp), cwd = path.join(temp, 'work');
    fs.mkdirSync(env.CODEX_HOME!, {recursive: true, mode: 0o700}); fs.mkdirSync(cwd, {mode: 0o700});
    const node = fs.realpathSync(process.execPath);
    let executable = node, found = true;
    try { executable = nativeExecutable(executableOnPath('codex')); } catch { found = false; }
    const profile = seatbeltProfile(temp, executable, root);
    const base = {cwd, env, signal: options.signal, timeoutMs: 10000, outputBytes: 16384};
    const version = async () => {
      if (!found) return 'not found';
      try {
        const result = await run('/usr/bin/sandbox-exec', ['-p', profile, executable, '--version'], {...base, timeoutMs: 5000});
        return /^codex-cli \d+\.\d+\.\d+$/.test(result.stdout.trim()) ? result.stdout.trim() : 'unrecognized version';
      } catch { return 'version probe failed'; }
    };
    const macOS = async () => {
      try { const result = await run('/usr/bin/sw_vers', ['-productVersion'], {...base, timeoutMs: 5000}); return /^\d+(\.\d+){1,2}$/.test(result.stdout.trim()) ? result.stdout.trim() : 'unknown'; }
      catch { return 'unknown'; }
    };
    const connection = async (host: typeof destinations[number], sandboxed: boolean) => {
      let result: ConnectionResult;
      try {
        const args = ['-e', connectionProbeScript, host];
        const output = await run(sandboxed ? '/usr/bin/sandbox-exec' : node, sandboxed ? ['-p', profile, node, ...args] : args, base);
        result = parseConnectionResult(output.stdout);
      } catch (e) { result = {phase: 'process', code: /timed out/.test((e as Error).message) ? 'ETIMEDOUT' : 'PROBE_FAILED'}; }
      const mode = sandboxed ? 'protected' : 'control';
      options.onProgress?.(`${mode} ${host}: ${result.status !== undefined ? `HTTPS reached (HTTP ${result.status})` : `${result.phase} failed: ${result.code}`}`);
      return {mode, host, ...result};
    };
    options.onProgress?.('Checking macOS, Codex version, and Node DNS/TLS/HTTPS. No credentials, draft text, or model requests are used.');
    const [macos, codex, connections] = await Promise.all([macOS(), version(), Promise.all(destinations.flatMap(host => [connection(host, false), connection(host, true)]))]);
    options.signal?.throwIfAborted();
    const ignored_environment = ignoredEnvironment(process.env);
    const hints = ['HTTP responses, including 401/403/404, establish HTTPS reachability only. They do not verify login, model access, WebSockets, or Codex\'s Rust TLS implementation.', 'Both connection modes use Margin\'s cleared environment; the control omits only Seatbelt.'];
    if (connections.some(c => c.mode === 'protected' && c.status === undefined && connections.some(other => other.mode === 'control' && other.host === c.host && other.status !== undefined))) hints.push('Node HTTPS works in the control but fails inside Seatbelt. This points toward the outer sandbox or an OS interaction for Node; it does not establish why Codex failed.');
    if (ignored_environment.length) hints.push('The listed environment overrides are present but intentionally not inherited. No values were read into the report. A normal Codex session may use them.');
    return {macos, kernel: os.release(), arch: process.arch, node: process.version, codex, supported_codex: supportedVersion, ignored_environment, connections, hints};
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
}
