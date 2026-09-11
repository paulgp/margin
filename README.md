# Margin

Margin is a local, source-first writing reviewer. Ask for editorial comments from the CLI, then read and discuss them in native VS Code comment threads. **You revise the draft. Margin never edits or saves it.** Resolving or dismissing a comment changes only its review state.

Supports UTF-8 `.md`, `.markdown`, `.typ`, and `.tex`, without rendering or compilation. Requires Node 22 or 24 LTS, npm, and desktop VS Code 1.100+. Protected Codex execution currently requires macOS and Codex CLI **0.154.0**; the core, mock provider, and prepare/import workflow are portable.

## Install and try offline

From this repository:

```sh
npm ci
npm run build
npm link --workspace margin-cli
margin --help
npm run demo
```

`margin` is now on your npm global bin path. If that directory is not on your shell's PATH, use `npm run margin -- --help` (or other arguments after `--`) from this repository. The CLI is bundled; no compiled entry-point guessing is needed.

Open this repository in VS Code and press **F5**, selecting **Margin: Offline Development Host**. The new window opens `.demo/markdown`. Trust this disposable workspace to activate Margin, open `draft.md`, and use **Margin: Select Review**. The Explorer's Margin tree lists every comment. Click a comment to reveal its thread. The demo creates Markdown, Typst, and multi-file LaTeX workspaces under `.demo/`; rerunning it preserves existing source edits and creates new review sessions. No authentication or model/network call is involved.

In the demo window:

1. Insert text before a highlighted passage; the comment follows the editor's actual text changes.
2. Rewrite the passage; Margin labels it `changed` when its location is defensible. Delete it or create ambiguous copies; it becomes `unanchored` and remains in the tree.
3. Reply locally, resolve, dismiss, or reopen using thread or tree menus. Use **Margin: Filter Discussions** to show all/open/resolved/dismissed comments.
4. Use **Compare Reviewed Version with Current** or **Show Original**. Originals and editorial letters are read-only virtual documents.
5. To reattach, select a nonempty passage in an eligible source file, then invoke **Reattach to Selection** from the tree or command palette. The original evidence is preserved.

The status bar and threads label unsaved buffers. Margin reviews **saved disk contents**; the CLI cannot detect every editor's unsaved changes and never saves them. Replies stay local. Attachment status does not tell you whether an editorial concern still applies.

## Review your own source

Run commands from the author's project root (or pass `--root /path/to/project`):

```sh
margin init
margin review draft.md --provider mock --max-comments 8
margin review draft.md --provider codex \
  --brief "Focus on argument and pacing. Preserve my voice; let the opening breathe." \
  --max-comments 8
```

The default provider is `mock`, a deterministic demonstration explicitly labeled as such. `--provider codex` sends the frozen packet to Codex using existing file-based login or `OPENAI_API_KEY`; it does not install or log into Codex for you. `--model NAME` records the requested model. When the CLI does not report the actual model, provenance says `null`. Read [the protection policy](docs/codex-safety.md) for supported controls, authentication, and failure modes.

Review commands print the prepared request ID immediately, followed by elapsed-time progress on stderr. Codex reports startup checks, turn activity, and fixed diagnostic descriptions for connection, authentication, schema, and permission errors. A heartbeat appears every ten seconds. The 120-second review timeout is a ceiling, not an expected duration. On timeout, the last recognized Codex issue is retained in the error. Ctrl+C cancels the process and retains the request. JSON success output stays on stdout; `--json` progress uses JSON records on stderr. Raw model reasoning, response text, and credentials are never printed as progress.

The adapter explicitly disables Codex 0.154.0's unbounded connection retries and enables warning-level logging to surface retry activity before the wrapper times out. It reports recognized retry counts, response-decoding failures, and unavailable-model errors without printing raw logs. A local session/turn starting does **not** confirm a service connection. Reasoning activity is shown as a fixed status message without its contents. Startup identifies the authentication source (saved `auth.json` or `OPENAI_API_KEY`, never its value) and the requested model. If ordinary Codex works but Margin stalls, compare its model with `--model NAME`: Margin does not load the ordinary session's user configuration or keychain-only login.

If ordinary Codex works but a protected review stalls, run `margin doctor` (or `npm run margin -- doctor --json` from this repository). It reports macOS/Node/Codex versions and compares DNS, TCP, TLS, and HTTP reachability with and without the outer sandbox, using the same cleared environment. These are **Node HTTPS probes**, not Codex model requests: they send unauthenticated HEAD requests to `chatgpt.com` and `api.openai.com`, read no draft or login files, and create no review artifacts. Each connection has an eight-second deadline. HTTP errors still establish HTTPS reachability; they do not verify authentication or model access. Node and Codex use different TLS implementations, so a failed Node probe is a clue, not proof of a Codex failure. The report lists any recognized environment overrides Margin omits, by name only. Ctrl+C cancels the probes. Protection settings are never relaxed by this command.

Open the same project root in VS Code with Margin installed or running in a Development Host. New completed reviews produce a selection notification. **Margin: Refresh** rescans completed sidecars and recomputes locations against current editor text. No model calls occur in the extension.

## Prepare and import with any reviewer

```sh
margin prepare draft.md --brief "Review the argument." --max-comments 8 --json
# Send the printed packet.txt and response.schema.json to your chosen reviewer.
# Save its final JSON response locally, then use the returned request ID:
margin import request-REPLACE-WITH-RETURNED-ID response.json --json
```

`prepare` prints the request ID and paths to the frozen snapshot manifest, packet, request, and response schema. JSON output uses project-relative artifact paths; human output prints absolute paths for convenience. JSON success records go to stdout; saved-disk notices and errors go to stderr. Import uses that request's frozen bytes, even if you have since edited the draft. It rejects the entire response on any invalid field, request mismatch, ineligible file, missing block, excessive comment count, or absent/ambiguous quote. Diagnostics are kept under the request; no partial review is installed. Retrying an import creates a new session and never overwrites an existing one.

The response format is illustrated in [the architecture note](docs/architecture.md). Quotes must be exact and unique **inside the indicated block**. Source block IDs only exist in review artifacts. Zero local comments is valid; document-wide observations belong in the editorial letter.

## Multi-file projects

Edit `.reviews/config.json` explicitly. For example:

```json
{
  "schema_version": 1,
  "files": ["main.tex", "sections/introduction.tex", "sections/methods.tex"],
  "context_files": ["macros.tex", "references.bib"],
  "brief": "Review the argument and technical consistency. Preserve my voice.",
  "max_comments": 8,
  "limits": {"file_bytes": 524288, "packet_bytes": 2097152, "block_chars": 6000}
}
```

```sh
margin review --project --provider mock
# Included runnable example:
margin review --root examples/latex --project --provider mock
```

Only `files` can receive comments. Context files support the source extensions plus `.bib`, `.sty`, `.cls`, and `.txt`. Single-file reviews include only the positional file. Paths must be project-relative; all symlinks are rejected, including in-root links. Hidden paths, `.git`, `.reviews`, dependencies, and common build output directories are excluded. There is no include discovery or repository sweep. Missing files and exceeded byte limits fail explicitly; nothing is truncated.

For a renamed file or a cross-file passage move, add its new path to the manifest's `files` list and refresh. Searches use the union of the session's original eligible paths and the current explicit manifest. Exact whole-file content verifies a rename; exact quotes and context can verify passage moves. Unclear correspondence stays detached. Context-only files are never recovery targets.

## Privacy and packaging

`.reviews/.gitignore` defaults to `*`; Margin never edits the author's root `.gitignore`. **Snapshots contain complete selected draft/context text**, and manual attachments store the selected buffer's full decoded text. Reviews, replies, diagnostics, and local auth temp files should be treated as private. To deliberately version reviews, edit `.reviews/.gitignore` yourself; for example, remove `*` and retain `.tmp-*` and `*.lock` exclusions. The LaTeX example deliberately versions only its manifest and sidecar ignore file. No credentials or machine-specific absolute paths belong in portable review records.

```sh
npm run typecheck
npm test
npm run test:extension
npm run package
code --install-extension dist/margin-0.1.0.vsix
```

Packaging creates `dist/margin-0.1.0.vsix` locally; nothing is published. The default test suite is offline and uses a fake Codex executable. On macOS the provider tests also exercise actual Seatbelt read/write denials. The separate Development Host smoke test opens an isolated disposable workspace; it uses the installed macOS VS Code when found, otherwise the VS Code test runner may download one. Set `MARGIN_VSCODE_EXECUTABLE` to use an existing installation elsewhere.

This MVP supports one root (the first workspace folder), one selected session, and one state-writing extension instance. Concurrent state changes are detected; refresh and retry after a conflict. No semantic/fuzzy matching, rewrapping normalization, automatic issue reassessment, history timeline, branch reconciliation, or prose edits are implemented. See [architecture and limits](docs/architecture.md) and [verification notes](docs/testing.md).
