import * as fs from 'node:fs';
import {ReviewState, Session, Override} from './types';
import {atomicWrite, readBytes, safePath, mkdir, hash, json, sourcePath, localId} from './fs';
import {evidence, config} from './reviews';
export function initialState(session: Session): ReviewState { return {schema_version: 1, review_id: session.id, revision: 0, comments: Object.fromEntries(session.comments.map(c => [c.id, {status: 'open', replies: []}]))}; }
export function validateState(state: ReviewState, session: Session): void {
  if (state.schema_version !== 1 || state.review_id !== session.id || !Number.isInteger(state.revision) || state.revision < 0 || !state.comments || Object.keys(state.comments).length !== session.comments.length) throw new Error('Invalid review state');
  for (const c of session.comments) {
    const entry = state.comments[c.id];
    if (!entry || !['open', 'resolved', 'dismissed'].includes(entry.status) || !Array.isArray(entry.replies)) throw new Error('Invalid comment state');
    for (const r of entry.replies) { localId(r.id); if (typeof r.body !== 'string' || !r.body.trim() || r.body.length > 8000 || typeof r.created_at !== 'string') throw new Error('Invalid reply'); }
    const o = entry.override;
    if (o) {
      sourcePath(o.path);
      if (typeof o.source_text !== 'string' || o.source_text.length > 4 * 1024 * 1024 || hash(o.source_text) !== o.source_sha256 || typeof o.unsaved !== 'boolean') throw new Error('Invalid manual attachment source');
      const expected = evidence(o.path, o.source_text, o.start, o.end);
      for (const key of Object.keys(expected) as (keyof typeof expected)[]) if (expected[key] !== o[key]) throw new Error('Invalid manual attachment evidence');
    }
  }
}
export function manualOverride(path: string, text: string, start: number, end: number, unsaved: boolean): Override {
  sourcePath(path); return {...evidence(path, text, start, end), source_text: text, source_sha256: hash(text), unsaved, created_at: new Date().toISOString()};
}
export function loadState(root: string, session: Session): {state: ReviewState; token: string | null} {
  try {
    const bytes = readBytes(root, `.reviews/state/${localId(session.id)}.json`); const state = JSON.parse(bytes.toString('utf8')) as ReviewState;
    validateState(state, session); return {state, token: hash(bytes)};
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {state: initialState(session), token: null}; throw e; }
}
export function saveState(root: string, session: Session, state: ReviewState, expectedToken: string | null): {state: ReviewState; token: string} {
  validateState(state, session);
  const eligible = new Set([...session.eligible_files, ...config(root).files]);
  for (const entry of Object.values(state.comments)) if (entry.override && !eligible.has(entry.override.path)) throw new Error('Manual attachment must target an explicitly eligible source file');
  mkdir(root, '.reviews/state');
  const lockRel = `.reviews/state/${localId(session.id)}.lock`; const lock = safePath(root, lockRel, true);
  let fd: number;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('State writer conflict: refresh and retry. If Margin crashed, close other windows before removing the .lock file.'); throw e; }
  try {
    const current = loadState(root, session);
    if (current.token !== expectedToken) throw new Error('State changed since it was read. Refresh before retrying; no changes were overwritten.');
    const next = {...state, revision: current.state.revision + 1}; const bytes = json(next);
    atomicWrite(root, `.reviews/state/${session.id}.json`, bytes, true); return {state: next, token: hash(bytes)};
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
