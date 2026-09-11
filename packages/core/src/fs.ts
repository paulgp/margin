import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

export const hash = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export const id = (prefix: string): string => `${prefix}-${randomUUID()}`;
export function localId(value: string): string {
  if (!/^(snapshot|request|review|comment|reply|diagnostic)-[a-f0-9-]{36}$/.test(value)) throw new Error('Invalid Margin ID');
  return value;
}
export function relativePath(value: string): string {
  if (!value || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.split('/').some(p => !p || p === '.' || p === '..')) throw new Error(`Unsafe project-relative path: ${value}`);
  return value;
}
export function sourcePath(value: string, context = false): string {
  relativePath(value);
  const excluded = new Set(['.git', '.reviews', 'node_modules', 'vendor', 'dist', 'build', 'out', 'target', '.next']);
  if (value.split('/').some(p => excluded.has(p.toLowerCase()) || p.startsWith('.'))) throw new Error(`Excluded source path: ${value}`);
  if (/\.(generated|gen|min)\./i.test(value)) throw new Error(`Generated source path is excluded: ${value}`);
  if (!(context ? /\.(md|markdown|typ|tex|bib|sty|cls|txt)$/i : /\.(md|markdown|typ|tex)$/i).test(value)) throw new Error(`Unsupported ${context ? 'context' : 'source'} file: ${value}`);
  return value;
}
/** Reject every symlink (also in-root links), special file, and escaping component. */
export function safePath(root: string, rel: string, allowMissing = false): string {
  relativePath(rel);
  const base = fs.realpathSync(root);
  let current = base;
  const parts = rel.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error(`Symlink not allowed: ${rel}`);
      if (i < parts.length - 1 && !stat.isDirectory()) throw new Error(`Expected directory: ${rel}`);
      if (!stat.isFile() && !stat.isDirectory()) throw new Error(`Not a regular file/directory: ${rel}`);
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }
  return current;
}
export function mkdir(root: string, rel: string): void {
  const target = safePath(root, rel, true);
  fs.mkdirSync(target, {recursive: true, mode: 0o700});
  safePath(root, rel);
}
export function readBytes(root: string, rel: string, limit = 16 * 1024 * 1024): Buffer {
  const p = safePath(root, rel);
  const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new Error(`${rel} exceeds the ${limit}-byte limit or is not a file`);
    const bytes = fs.readFileSync(fd);
    if (bytes.length > limit) throw new Error(`${rel} exceeds the ${limit}-byte limit`);
    return bytes;
  } finally { fs.closeSync(fd); }
}
export function readJson<T>(root: string, rel: string): T { return JSON.parse(readBytes(root, rel).toString('utf8')) as T; }
export const json = (value: unknown): string => JSON.stringify(value, null, 2) + '\n';
/** Immutable writes use link(2) for atomic create-if-absent; mutable writes run under a lock. */
export function atomicWrite(root: string, rel: string, data: string | Buffer, replace = false): void {
  relativePath(rel);
  if (!rel.startsWith('.reviews/')) throw new Error('Writes are restricted to .reviews');
  mkdir(root, path.posix.dirname(rel));
  const destination = safePath(root, rel, true);
  const tempRel = `${path.posix.dirname(rel)}/.tmp-${randomUUID()}`;
  const temp = safePath(root, tempRel, true);
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try {
    safePath(root, rel, true);
    if (replace) fs.renameSync(temp, destination);
    else fs.linkSync(temp, destination);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
export function decode(bytes: Buffer): string {
  try { return new TextDecoder('utf-8', {fatal: true, ignoreBOM: false}).decode(bytes); }
  catch { throw new Error('Source must be valid UTF-8 (UTF-8 BOM is supported)'); }
}
