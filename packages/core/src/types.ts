export const categories = ['argument', 'structure', 'clarity', 'style', 'technical', 'keep'] as const;
export type Category = typeof categories[number];
export interface Config {
  schema_version: 1; files: string[]; context_files: string[]; brief: string; max_comments: number;
  limits: {file_bytes: number; packet_bytes: number; block_chars: number};
}
export interface GitContext {head: string | null; branch: string | null}
export interface SourceFile {path: string; role: 'source' | 'context'; sha256: string; bytes: number}
export interface Snapshot {schema_version: 1; id: string; captured_at: string; git: GitContext; files: SourceFile[]}
export interface Block {id: string; file: string; start: number; end: number; text: string; role: 'source' | 'context'}
export interface Request {
  schema_version: 1; id: string; snapshot_id: string; created_at: string; brief: string; max_comments: number;
  eligible_files: string[]; blocks: Block[]; instructions: string;
}
export interface ResponseComment {file: string; block_id: string; quote: string; category: Category; body: string}
export interface ReviewResponse {schema_version: 1; request_id: string; summary: string; comments: ResponseComment[]}
/** Half-open UTF-16 offsets in fatal UTF-8 decoded text, one leading BOM removed; CR/LF retained. */
export interface Span {start: number; end: number}
export interface Evidence extends Span {path: string; quote: string; prefix: string; suffix: string}
export interface Anchor extends Evidence {snapshot_id: string; block_id: string}
export interface ReviewComment {id: string; category: Category; body: string; anchor: Anchor}
export interface Provenance {provider: string; requested_model: string | null; reported_model: string | null; runtime?: string}
export interface Session {
  schema_version: 1; id: string; request_id: string; snapshot_id: string; created_at: string; brief: string;
  summary: string; provenance: Provenance; eligible_files: string[]; comments: ReviewComment[];
}
export type Discussion = 'open' | 'resolved' | 'dismissed';
export interface Override extends Evidence {source_text: string; source_sha256: string; unsaved: boolean; created_at: string}
export interface CommentState {status: Discussion; replies: {id: string; body: string; created_at: string}[]; override?: Override}
export interface ReviewState {schema_version: 1; review_id: string; revision: number; comments: Record<string, CommentState>}
export interface Attachment extends Partial<Span> {status: 'attached' | 'changed' | 'unanchored'; path?: string; reason: string; unsaved?: boolean}
export interface TextEdit {rangeOffset: number; rangeLength: number; text: string}
