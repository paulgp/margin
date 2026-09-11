import type {ReviewState, Session} from '@margin/core';

/** Immutable review order: edits, file moves and attachment confidence cannot reorder discussions. */
export function nextOpenComment(session: Pick<Session, 'comments'>, state: Pick<ReviewState, 'comments'>, current: string | undefined, direction: 1 | -1): string | undefined {
  const comments = session.comments;
  const index = comments.findIndex(c => c.id === current);
  const start = index < 0 ? (direction === 1 ? -1 : comments.length) : index;
  for (let step = 1; step <= comments.length; step++) {
    const candidate = comments[(start + direction * step + comments.length) % comments.length];
    if (state.comments[candidate.id]?.status === 'open') return candidate.id;
  }
  return undefined;
}

export function reviewProgress(session: Pick<Session, 'comments'>, state: Pick<ReviewState, 'comments'>): {open: number; total: number} {
  return {open: session.comments.filter(c => state.comments[c.id]?.status === 'open').length, total: session.comments.length};
}
