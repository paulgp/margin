# Architecture and invariants

`packages/core` owns the portable schemas, snapshots, storage, deterministic anchoring, and discussion state. `packages/cli` owns argument parsing and reviewer processes. `packages/vscode` bundles the core and owns only VS Code presentation and local discussion actions. The extension contains no provider, model SDK, server, browser UI, or source-editing API calls.

## Evidence flow

```text
selected saved files → exact-byte snapshot → source blocks + packet + response schema
                                                ↓
                                   mock / protected Codex / manual reviewer
                                                ↓
                                 one strict importer → immutable session
                                                ↓
                         current attachments (memory) + mutable discussion state
```

Both `review` and `prepare` use the same capture path; `review` calls the same importer as `import`. IDs for snapshots, requests, sessions, comments, replies, and diagnostics are locally generated UUIDs. Model fields never determine artifact destinations.

```text
.reviews/
  .gitignore
  config.json
  snapshots/<snapshot-id>/manifest.json
  snapshots/<snapshot-id>/files/<project-relative-path>
  requests/<request-id>/packet.txt
  requests/<request-id>/response.schema.json
  requests/<request-id>/request.json
  requests/<request-id>/diagnostics/<diagnostic-id>.json
  sessions/<review-id>.json
  state/<review-id>.json
```

Unfocused request/session records and all snapshot/config/response/state records use `schema_version: 1`. Focused request/session records use version 2, preventing older readers from silently ignoring their scope. Snapshot manifests record capture time, exact byte counts/SHA-256 hashes, roles, and nullable Git HEAD/branch. Each source is read once into bytes; stat identity/size/mtime/ctime are checked before/after and again across the capture. Blocks are built from the installed snapshot, with hash verification. This is **not a filesystem-wide atomic snapshot**: an adversarial writer preserving metadata is outside the capture guarantee. A detected ordinary concurrent edit fails the request. A failed capture may leave an unused immutable snapshot, never a completed request or review.

The splitter partitions decoded text at blank lines and splits oversized spans into bounded chunks without splitting surrogate pairs or CRLF. Concatenating a file's blocks reproduces every decoded character. Packets encode block text as JSON strings; source is data even if it contains delimiters or agent instructions. Source and context limits apply before capture; the packet limit also includes encoded source and instructions. Defaults are 512 KiB/file and 2 MiB/packet; configurable hard ceilings are 4 MiB/file, 8 MiB/packet, 200 source files, and 200 context files.

Optional focus consists of up to 200 one-based inclusive physical line ranges. The CLI parses `--lines` for a positional file or `--focus file:lines` for explicitly selected project files. Core normalizes overlapping/adjacent ranges in manifest order, rejects empty/invalid/out-of-file ranges, and derives half-open UTF-16 offsets from frozen decoded text. LF, CRLF and lone CR each end a physical line; a trailing newline creates a final empty line. A selected line includes its terminating newline when present. Neither byte snapshots nor packet text are truncated: focus boundaries add block splits, and blocks outside the ranges become context-only. File roles in the snapshot and eligible project paths remain unchanged so later attachment recovery can search the selected project normally.

Request loading independently reconstructs focus offsets from snapshot lines, verifies exact block coverage and roles, and rejects blocks crossing focus boundaries. Import checks exact quotations and focus containment. Sessions copy the immutable normalized focus and validate it against the original request on reload. Focus applies to historical comment origins, not their later editor coordinates or explicit manual overrides. The editorial letter is prompted to focus on those passages; its semantic scope cannot be enforced by JSON validation. Full selected text remains available to the reviewer, subject to the existing size limits and privacy policy.

## Responses and original anchors

```json
{
  "schema_version": 1,
  "request_id": "request-<locally-generated-uuid>",
  "summary": "A short editorial letter.",
  "comments": [{
    "file": "sections/introduction.tex",
    "block_id": "b0004",
    "quote": "This is the central problem.",
    "category": "clarity",
    "body": "Which problem does this refer to?"
  }]
}
```

Ajv validates a generated request-specific JSON Schema, with unsupported fields rejected at every response object. The importer additionally checks snapshot integrity, complete block coverage, source eligibility, exact file/block identity, unique quote membership, and Unicode boundaries. Limits are 20,000 characters for the letter/quote, 8,000 for each comment/reply, 1 MiB for the response, and the request's comment budget (default eight, allowed zero through 100). It does not accept offsets, patches, commands, replacement passages, or model-chosen IDs. Quotes that span blocks must be reduced to a unique passage within one block.

The immutable anchor includes snapshot ID, source path, exact quote, up to 96 UTF-16 units of prefix/suffix context, original half-open range, and block ID. The session retains brief, provider, requested/reported model (nullable), and request/snapshot identity. Reattachments never modify these records. The importer validates even schema-constrained provider responses and installs sessions only after all comments succeed.

## Coordinates and attachments

Raw snapshot bytes are preserved separately. The coordinate representation is fatal UTF-8 decoding with **one leading UTF-8 BOM removed**, original CR/LF preserved, and **half-open UTF-16 offsets** `[start, end)`. Emoji commonly occupy two units; byte positions are never editor columns. Quotes cannot start/end between surrogate halves or between CR and LF. `offsetPosition` counts lines and UTF-16 columns; the extension converts these to stable `vscode.Range`s. Open buffers use `TextDocument.getText()` and selections use `offsetAt()`, so the actual editor representation, including its EOL choices, wins.

`attached` means an exact verified target; `changed` means a defensible location with overlapping edits; `unanchored` has no highlight. Discussion state is an independent `open | resolved | dismissed` value. Text changes never resolve comments.

For live documents, all text-change offsets refer to the same pre-event text. Edits are applied in descending offset order and the resulting text is verified against the event's document. Insertions at the starting boundary shift the range; insertions at the ending boundary stay outside it; interior insertions/overlap mark it changed. Deleted ranges become unanchored. Undo/redo use the same mapping; restoring the original quotation restores a verified attachment. Whole-document replacements use the snapshot recovery path. Native threads are explicitly replaced/repositioned, not assumed to track on their own.

On refresh/reopen/external changes, exact source identity is authoritative. Otherwise all exact quote candidates within eligible files are considered together. Unique same-file quotations recover moves; cross-file recovery additionally needs exact whole-file identity, supporting context, or a substantial (80+ character) exact passage. Multiple candidates require strongly distinguishing prefix/suffix evidence; tied candidates detach. A survivor of multiple historical copies is checked against the other copies' contexts so deletion cannot transfer the comment to an unrelated survivor.

If no exact candidate survives, jsdiff's tested `diffChars` computes unchanged-region/edit mapping with an 80 ms / 20,000-edit bound. An edited span is retained only with surviving context on both boundaries (at least 16 units total). Time-bound failure detaches. Diff tie-breaking never selects among duplicate exact quotes. Full-file rewrites and deletion detach; short or context-poor quotes may detach even when a human could recognize them. There is no normalization, fuzzy matching, include parsing, Git commit replay, or LLM location decision.

Manual overrides store their own quote/range/context, relative source identity, full decoded buffer and SHA-256, timestamp, and unsaved flag in state. The full buffer supports later diff mapping without altering original evidence. After reload, overrides are revalidated against saved/current source; unsaved-origin overrides remain labeled in the reason. The selected session paths plus the explicit current manifest define recovery scope; renames outside that scope require a manifest update.

## Storage and VS Code lifecycle

All paths are checked component-by-component. Source and sidecar symlinks, traversal, special files, and unexpected paths are rejected. Only `.reviews` is writable through core APIs. Atomic immutable writes use a fsynced exclusive temporary file and create-if-absent hard link; atomic mutable writes use rename under an exclusive per-session lock. State carries a revision plus a content-hash read token: if disk changed since reading, saving fails rather than overwriting. A crash can leave a lock; close writers and remove that named lock manually. Checks defend against ordinary unsafe paths, not a hostile same-user process racing every filesystem operation. Local files are not cryptographically authenticated against the machine's owner.

Completed `request.json`/session JSON files act as publication markers. Watchers debounce JSON and eligible source events; temporary files are ignored. A monotonic generation prevents late asynchronous work from publishing over newer edits/refreshes. The current-location cache is memory-only and never rewrites sessions on keystrokes. State loads occur on refresh; conflicting local saves surface an error. Replaced threads, watchers, decorators, and timers are disposed.

Margin uses stable [CommentController, TreeDataProvider, decorations, and TextDocumentContentProvider APIs](https://code.visualstudio.com/api/references/vscode-api), following Microsoft's [official commenting sample](https://github.com/microsoft/vscode-extension-samples/tree/main/comment-sample). Source highlights are theme-aware and open concerns receive subtle decoration. Every comment remains available in the tree, including detached comments; opening a detached item shows its original. The editorial letter is a plain read-only document. Model and reply bodies are escaped using `MarkdownString.appendText`, with trust and HTML disabled; remote images and command links are inert. Workspace Trust is required.

Open-comment navigation uses immutable session comment order and mutable discussion statuses, independently of attachment confidence and file location. It wraps, skips closed discussions, and makes open targets visible by switching a closed-discussion filter to open. Counts always cover the entire selected session. The current comment ID is disposable UI state, reset on session selection/reload; it does not enter the sidecars. Menu actions target their supplied comment; palette Resolve/Dismiss and Next use the last comment opened through Margin or a chooser. Rapid navigation commands run serially. Session changes invalidate queued work and asynchronous reveals; buffer attachments are read again after opening the document. A successful state write invalidates older refresh calculations before publishing the decision; a failed write cannot advance. The default shortcuts are declared through the stable [keybindings contribution](https://code.visualstudio.com/api/references/contribution-points#contributes.keybindings) and require a trusted workspace with a selected review.

Git only supplies version labels. Read-only `rev-parse` and `symbolic-ref` run with argument arrays, optional locks disabled, and fsmonitor disabled. No Git diff, textconv, hooks, object writes, index refresh, or worktree mutation is performed. `.git` need not be a directory. HEAD/branch polling labels changes without transferring discussion semantics between branches. Snapshot/current comparison works without Git, after a verified rename, and with unsaved buffers. Deleted targets still show original evidence.
