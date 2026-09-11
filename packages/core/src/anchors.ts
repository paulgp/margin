import {diffChars} from 'diff';
import {Attachment, Evidence, Span, TextEdit} from './types';
import {occurrences} from './reviews';

export class Generation {
  private current = 0;
  next(): number { return ++this.current; }
  isCurrent(token: number): boolean { return token === this.current; }
}
export function offsetPosition(text: string, offset: number): {line: number; character: number} {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) throw new Error('UTF-16 offset outside document');
  let line = 0, start = 0;
  for (let i = 0; i < offset; i++) {
    if (text[i] === '\n' || (text[i] === '\r' && text[i + 1] !== '\n')) { line++; start = i + 1; }
  }
  return {line, character: offset - start};
}
export function applyEdits(before: string, edits: readonly TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.rangeOffset - a.rangeOffset); let end = before.length; let result = before;
  for (const e of sorted) {
    if (!Number.isInteger(e.rangeOffset) || !Number.isInteger(e.rangeLength) || e.rangeOffset < 0 || e.rangeLength < 0 || e.rangeOffset + e.rangeLength > end) throw new Error('Edits must be nonoverlapping, in pre-edit UTF-16 coordinates');
    result = result.slice(0, e.rangeOffset) + e.text + result.slice(e.rangeOffset + e.rangeLength); end = e.rangeOffset;
  }
  return result;
}
/** All edits use the same pre-event document, including undo/redo events. */
export function mapEdits(anchor: Evidence, previous: Attachment, before: string, edits: readonly TextEdit[], after = applyEdits(before, edits)): Attachment {
  if (applyEdits(before, edits) !== after) return {status: 'unanchored', reason: 'Editor text/version mismatch'};
  if (previous.start === undefined || previous.end === undefined || !previous.path) return previous;
  let start = previous.start, end = previous.end, overlap = false;
  for (const e of [...edits].sort((a, b) => b.rangeOffset - a.rangeOffset)) {
    const from = e.rangeOffset, to = from + e.rangeLength, delta = e.text.length - e.rangeLength;
    if (to <= start) { start += delta; end += delta; }
    else if (from >= end) { /* insertion at end belongs outside the highlight */ }
    else {
      overlap = true;
      start = start < from ? start : from;
      end = end > to ? end + delta : from + e.text.length;
    }
  }
  if (end <= start || start < 0 || end > after.length) return {status: 'unanchored', reason: 'Reviewed passage was deleted'};
  if (after.slice(start, end) === anchor.quote) return {status: 'attached', path: previous.path, start, end, reason: 'Verified against editor text'};
  if (overlap || previous.status === 'changed') return {status: 'changed', path: previous.path, start, end, reason: 'Edits overlap the reviewed passage; criticism has not been reassessed'};
  return {status: 'unanchored', reason: 'Mapped range no longer matches the evidence'};
}
function sharedSuffix(a: string, b: string): number { let n = 0; while (n < a.length && n < b.length && a[a.length - n - 1] === b[b.length - n - 1]) n++; return n; }
function sharedPrefix(a: string, b: string): number { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; }
function contextScore(anchor: Evidence, text: string, start: number): number {
  return sharedSuffix(anchor.prefix, text.slice(Math.max(0, start - 96), start)) + sharedPrefix(anchor.suffix, text.slice(start + anchor.quote.length, start + anchor.quote.length + 96));
}
function diffEdits(before: string, after: string): TextEdit[] | undefined {
  const changes = diffChars(before, after, {timeout: 80, maxEditLength: 20000});
  if (!changes) return undefined;
  const edits: TextEdit[] = []; let offset = 0;
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    if (!c.added && !c.removed) { offset += c.value.length; continue; }
    const e = {rangeOffset: offset, rangeLength: 0, text: ''};
    while (i < changes.length && (changes[i].added || changes[i].removed)) {
      const part = changes[i++]; if (part.removed) { e.rangeLength += part.value.length; offset += part.value.length; } else e.text += part.value;
    }
    i--; edits.push(e);
  }
  return edits;
}
/** Only caller-supplied eligible current files are searched. No filesystem traversal or semantic matching. */
export function attach(anchor: Evidence, reviewedText: string, currentFiles: ReadonlyMap<string, string>): Attachment {
  const same = currentFiles.get(anchor.path);
  if (same === reviewedText && same.slice(anchor.start, anchor.end) === anchor.quote) return {status: 'attached', path: anchor.path, start: anchor.start, end: anchor.end, reason: 'Exact reviewed source'};
  if (same === undefined) {
    const identical = [...currentFiles].filter(([, text]) => text === reviewedText);
    if (identical.length === 1 && reviewedText.slice(anchor.start, anchor.end) === anchor.quote) return {status: 'attached', path: identical[0][0], start: anchor.start, end: anchor.end, reason: 'Verified unique whole-file correspondence'};
  }
  const candidates: {path: string; start: number; score: number; text: string}[] = [];
  for (const [path, text] of currentFiles) for (const start of occurrences(text, anchor.quote)) candidates.push({path, start, score: contextScore(anchor, text, start), text});
  const found = (c: typeof candidates[number]): Attachment => ({status: 'attached', path: c.path, start: c.start, end: c.start + anchor.quote.length, reason: c.path === anchor.path ? 'Exact passage recovered' : 'Exact passage recovered in another eligible file'});
  if (candidates.length === 1) {
    const c = candidates[0];
    // Removing one of two historical copies must not transfer a comment to the survivor.
    const historical = occurrences(reviewedText, anchor.quote);
    const competingContext = historical.filter(start => start !== anchor.start).some(start => {
      const other = {...anchor, prefix: reviewedText.slice(Math.max(0, start - 96), start), suffix: reviewedText.slice(start + anchor.quote.length, start + anchor.quote.length + 96)};
      return contextScore(other, c.text, c.start) >= c.score;
    });
    if (historical.length > 1 && (c.score < 24 || competingContext)) return {status: 'unanchored', reason: 'Remaining quotation may belong to a different historical copy'};
    // A short generic quote needs supporting context for cross-file correspondence.
    if (c.path === anchor.path || c.text === reviewedText || c.score >= 16 || anchor.quote.trim().length >= 80) return found(c);
  }
  if (candidates.length > 1) {
    const sorted = candidates.sort((a, b) => b.score - a.score);
    if (sorted[0].score >= 24 && sorted[0].score > sorted[1].score + 16) return found(sorted[0]);
    return {status: 'unanchored', reason: 'Ambiguous repeated quotation; reattach explicitly'};
  }
  if (same === undefined) return {status: 'unanchored', reason: 'Source missing or no verified correspondence within eligible files'};
  const edits = diffEdits(reviewedText, same);
  if (!edits) return {status: 'unanchored', reason: 'Diff exceeded conservative work bound'};
  const mapped = mapEdits(anchor, {status: 'attached', path: anchor.path, start: anchor.start, end: anchor.end, reason: ''}, reviewedText, edits, same);
  if (mapped.status === 'changed' && mapped.start !== undefined && mapped.end !== undefined) {
    const left = sharedSuffix(anchor.prefix, same.slice(Math.max(0, mapped.start - 96), mapped.start));
    const right = sharedPrefix(anchor.suffix, same.slice(mapped.end, mapped.end + 96));
    // Both boundaries must retain real context. Pure deletion and whole-document rewrites are not targets.
    if (left >= Math.min(12, anchor.prefix.length) && right >= Math.min(12, anchor.suffix.length) && left + right >= 16) return mapped;
  }
  return {status: 'unanchored', reason: 'No exact passage or defensible edit mapping remains'};
}
