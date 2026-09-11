import {sourcePath} from './fs';
import {FocusRange, LineRange} from './types';

export const maxFocusRanges = 200;

export function parseLineRanges(file: string, value: string): LineRange[] {
  sourcePath(file);
  const parts = value.split(',');
  if (parts.length > maxFocusRanges) throw new Error(`At most ${maxFocusRanges} focus ranges are allowed`);
  return parts.map(part => {
    const match = /^([1-9]\d*)(?:-([1-9]\d*))?$/.exec(part.trim());
    if (!match) throw new Error(`Invalid line range ${JSON.stringify(part)}; use positive, inclusive lines such as 12-25,40-55 or 12`);
    const start_line = Number(match[1]), end_line = Number(match[2] ?? match[1]);
    if (!Number.isSafeInteger(start_line) || !Number.isSafeInteger(end_line) || end_line < start_line) throw new Error(`Invalid line range ${part}: the end must be at or after the start`);
    return {file, start_line, end_line};
  });
}

/** Converts against frozen text, merging overlaps/adjacent ranges in selected-file order. */
export function normalizeFocus(ranges: readonly LineRange[], files: readonly string[], texts: ReadonlyMap<string, string>): FocusRange[] {
  if (!Array.isArray(ranges) || !ranges.length || ranges.length > maxFocusRanges) throw new Error(`Focus requires 1–${maxFocusRanges} line ranges`);
  const grouped = new Map<string, LineRange[]>();
  for (const r of ranges) {
    if (!r || typeof r.file !== 'string' || !Number.isSafeInteger(r.start_line) || !Number.isSafeInteger(r.end_line) || r.start_line < 1 || r.end_line < r.start_line) throw new Error('Invalid focus line range');
    sourcePath(r.file);
    if (!files.includes(r.file)) throw new Error(`Focus target ${r.file} is not a selected source file; context-only and unselected files cannot receive comments`);
    const group = grouped.get(r.file) ?? []; group.push({...r}); grouped.set(r.file, group);
  }
  const result: FocusRange[] = [];
  for (const file of files) {
    const group = grouped.get(file); if (!group) continue;
    const text = texts.get(file); if (text === undefined) throw new Error(`Focus source is missing: ${file}`);
    const starts = [0];
    for (const match of text.matchAll(/\r\n|\r|\n/g)) starts.push(match.index! + match[0].length);
    group.sort((a,b) => a.start_line - b.start_line || a.end_line - b.end_line);
    const merged: LineRange[] = [];
    for (const r of group) {
      if (r.end_line > starts.length) throw new Error(`Focus ${file}:${r.start_line}-${r.end_line} exceeds the saved file's ${starts.length} lines; ranges are never truncated`);
      const previous = merged.at(-1);
      if (previous && r.start_line <= previous.end_line + 1) previous.end_line = Math.max(previous.end_line, r.end_line);
      else merged.push({file, start_line: r.start_line, end_line: r.end_line});
    }
    for (const r of merged) {
      const start = starts[r.start_line - 1], end = starts[r.end_line] ?? text.length;
      if (!text.slice(start,end).trim()) throw new Error(`Focus ${file}:${r.start_line}-${r.end_line} contains no nonblank text`);
      result.push({...r, start, end});
    }
  }
  return result;
}

export function withinFocus(focus: readonly FocusRange[] | undefined, file: string, start: number, end: number): boolean {
  return focus === undefined || focus.some(r => r.file === file && start >= r.start && end <= r.end);
}

export function focusDescription(focus: readonly FocusRange[] | undefined): string {
  return focus ? focus.map(r => `${r.file}:${r.start_line}${r.start_line === r.end_line ? '' : `-${r.end_line}`}`).join(', ') : 'All selected source lines';
}
