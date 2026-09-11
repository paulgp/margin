import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const checksum = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function releaseInfo(root = repositoryRoot) {
  const project = readJSON(path.join(root, 'package.json'));
  const version = project.version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Release version must be MAJOR.MINOR.PATCH');
  for (const workspace of ['core', 'cli', 'vscode']) {
    if (readJSON(path.join(root, 'packages', workspace, 'package.json')).version !== version) throw new Error(`Version mismatch in packages/${workspace}/package.json`);
  }
  return {version, cli: `margin-cli-${version}.tgz`, extension: `margin-${version}.vsix`, manifest: `margin-${version}.json`};
}
export function checkNode(version = process.versions.node) {
  if (![22, 24].includes(Number(version.split('.')[0]))) throw new Error(`Margin requires Node 22 or 24 LTS; found ${version}. Install a supported Node version, then rerun setup.`);
}
export function npmCommand(args) {
  // npm run supplies its JS entry point, avoiding shell/.cmd interpolation.
  if (process.env.npm_execpath) return {command: process.execPath, args: [process.env.npm_execpath, ...args]};
  return {command: 'npm', args};
}
export async function runCommand(command, args, {cwd = repositoryRoot, signal, capture = false, timeoutMs = 300000, env = process.env} = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit']});
    let stdout = '', stderr = '', failure;
    const kill = () => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} };
    const abort = () => { failure ??= new Error('Setup cancelled. Rerun setup to finish any incomplete installation.'); kill(); };
    const timer = setTimeout(() => { failure ??= new Error(`${path.basename(command)} timed out; rerun setup to retry.`); kill(); }, timeoutMs);
    signal?.addEventListener('abort', abort, {once: true});
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    for (const [stream, out] of [[child.stdout, true], [child.stderr, false]]) stream?.on('data', chunk => {
      if (out) stdout += chunk.toString(); else stderr += chunk.toString();
      if (stdout.length + stderr.length > 2 * 1024 * 1024) { failure ??= new Error('Setup subprocess exceeded its output limit'); kill(); }
    });
    child.once('error', error => { cleanup(); reject(new Error(`Cannot run ${path.basename(command)}: ${error.message}`)); });
    child.once('close', code => { cleanup(); if (failure) reject(failure); else if (code !== 0) reject(new Error(`${path.basename(command)} exited ${code}${stderr ? ': ' + stderr.slice(-1500) : ''}`)); else resolve(stdout.trim()); });
    if (signal?.aborted) abort();
  });
}
export function verifyArtifacts(directory, info) {
  const manifestFile = path.join(directory, info.manifest);
  const stat = fs.lstatSync(manifestFile);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Release manifest must be a regular file');
  const manifest = readJSON(manifestFile);
  if (manifest.schema_version !== 1 || manifest.version !== info.version) throw new Error('Release manifest version mismatch');
  for (const key of ['cli', 'extension']) {
    const entry = manifest.artifacts?.[key];
    if (entry?.file !== info[key] || !/^[a-f0-9]{64}$/.test(entry?.sha256)) throw new Error(`Invalid ${key} artifact entry`);
    const file = path.join(directory, info[key]), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || checksum(file) !== entry.sha256) throw new Error(`${key} artifact failed checksum validation. Run npm run package again.`);
  }
  return manifest;
}
