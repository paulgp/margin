# Margin

Margin is a local, source-first writing reviewer. Ask for editorial comments from the CLI, then read and discuss them in native VS Code comment threads. **You revise the draft. Margin never edits or saves it.** Resolving or dismissing a comment changes only its review state.

Supports UTF-8 `.md`, `.markdown`, `.typ`, and `.tex`, without rendering or compilation. Requires Node 22 or 24 LTS, npm, and desktop VS Code 1.100+. Protected Codex execution currently requires macOS and Codex CLI **0.154.0**; the core, mock provider, and prepare/import workflow are portable.

## Install

With Node 22 or 24 LTS, npm, and desktop VS Code installed, run this from your Margin checkout:

```sh
npm run setup
```

Setup installs the pinned build dependencies, builds matching **0.4.0** CLI/extension packages, checks their SHA-256 hashes, and installs both. It detects VS Code on PATH or in the usual macOS Applications locations. The CLI is installed into your existing npm global prefix as a standalone package, so it keeps working if you move the checkout. No `npm link` or F5 session is needed. Nothing is published, no model is called, and setup does not open an editor window.

In your existing VS Code window, run **Developer: Reload Window** once after installation. Open your writing project's folder normally, save your draft deliberately, and run in that folder's terminal:

```sh
margin --version
margin init  # once per writing project
margin review draft.md --provider mock
```

Use **Margin: Select Review** when the new review appears. For a real review, use `--provider codex` and your editorial brief. Reviewing remains explicitly initiated from the CLI; the extension displays comments in your normal editor window.

If the npm prefix is not writable, use `npm run setup -- --prefix "$HOME/.local"`. Setup prints a PATH command if the installed `margin` is not the one your shell finds; it never edits shell startup files or npm configuration. Use `--code /path/to/code` for another VS Code installation, `--profile NAME` for a specific profile, or `--cli-only` on a machine without VS Code. Run `npm run setup -- --help` for all options. The setup helper supports macOS/Linux; core/CLI artifacts remain portable.

## Update

From the same checkout:

```sh
git pull --ff-only
npm run setup
```

Reload your VS Code window once. Setup replaces only the Margin CLI and extension, retains your drafts/reviews, and refuses to silently downgrade a newer installed version. If installation stops partway through, it identifies which component succeeded; rerun the same command to finish. An existing development `npm link` for Margin in the selected npm prefix is replaced by the standalone package.

## Try offline

```sh
npm run demo
code --reuse-window .demo/markdown
```

Trust the disposable workspace, open `draft.md`, and use **Margin: Select Review**. The Explorer's Margin tree lists every comment. Click a comment to reveal its thread. The demo creates Markdown, Typst, and multi-file LaTeX workspaces under `.demo/`; rerunning it preserves existing source edits and creates new review sessions. No authentication or model/network call is involved. `--reuse-window` opens the demo in your existing editor; opening a new window is your choice.

To generate another review from the **repository directory**, choose the demo's project root explicitly:

```sh
margin review draft.md --root .demo/markdown --provider mock
# For a real model review, replace mock with codex.
```

The file argument is relative to `--root`. `margin review .demo/markdown/draft.md` instead selects the repository as the project root and rejects `.demo` as a hidden source path. The CLI prints the project folder and review location; VS Code must have that same project folder open. From a terminal already in `.demo/markdown`, omit `--root` and use `margin review draft.md --provider mock`.

For extension development, open the repository in VS Code and press **F5**, selecting **Margin: Offline Development Host**. That development-only launch opens a separate window on `.demo/markdown`. You can also use `npm run margin -- ...` directly from the checkout without installing the CLI.

In the demo window:

1. Insert text before a highlighted passage; the comment follows the editor's actual text changes.
2. Rewrite the passage; Margin labels it `changed` when its location is defensible. Delete it or create ambiguous copies; it becomes `unanchored` and remains in the tree.
3. Reply locally, resolve, dismiss, or reopen using thread or tree menus. Resolve and Dismiss close the editor's comment thread; the comment stays in the review tree and can be opened again. Use **Margin: Filter Discussions** to show all/open/resolved/dismissed comments.
4. Use **Compare Reviewed Version with Current** or **Show Original**. Originals and editorial letters are read-only virtual documents.
5. To reattach, select a nonempty passage in an eligible source file, then invoke **Reattach to Selection** from the tree or command palette. The original evidence is preserved.

The status bar and threads label unsaved buffers. Margin reviews **saved disk contents**; the CLI cannot detect every editor's unsaved changes and never saves them. Replies stay local. Attachment status does not tell you whether an editorial concern still applies.

## Work through a review

Use **Margin: Next Open Comment** or **Margin: Previous Open Comment** from the Command Palette or the arrow buttons in the Margin tree. Navigation follows the original review order, skips resolved/dismissed discussions, and wraps at either end. It selects the tree item, opens its passage, and expands its thread. Changed passages retain their warning; detached comments open the read-only original. If a resolved/dismissed filter hides open comments, navigation switches the filter to **open**.

| Action | macOS shortcut | Windows/Linux shortcut |
| --- | --- | --- |
| Next open comment | `Cmd+K`, then `Alt+Down` | `Ctrl+K`, then `Alt+Down` |
| Previous open comment | `Cmd+K`, then `Alt+Up` | `Ctrl+K`, then `Alt+Up` |

On macOS, Alt is Option. These are two-step shortcuts; release the first combination before pressing the second. Customize them in VS Code's Keyboard Shortcuts by searching for Margin.

**Margin: Resolve and Next** and **Margin: Dismiss and Next** are available in thread/tree menus and the Command Palette. From a menu they act on that comment; from the palette they act on the last comment opened through Margin (marked **current** in the tree), or ask you to choose if none is current. They save the decision, close the thread, and move to the next open comment. A conflicting state write stops the action without advancing. Ordinary Resolve/Dismiss still close the thread without moving you.

The status bar and tree heading show **N of T open**, including changed and detached comments, regardless of the tree filter. Click the status bar to visit the next open comment. Zero open comments means the session has no open discussions; it does not claim every issue was fixed. The navigation position is temporary and resets when you select a session or reload VS Code; saved decisions and replies remain.

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

Margin supplies Codex with a temporary PEM bundle of the public CA certificates shipped with Node, using Codex's supported `CODEX_CA_CERTIFICATE` setting. This makes those trust roots available inside the sandbox without granting access to user keychains or certificate configuration. Certificate and hostname verification stay enabled. The bundle is validated, contains no private keys, and is deleted with the runtime's temporary directory. Corporate/private CA overrides remain unsupported. `margin doctor` uses the same explicit bundle for both of its connection modes and reports its certificate count.

If ordinary Codex works but a protected review stalls, run `margin doctor` (or `npm run margin -- doctor --json` from this repository). It reports macOS/Node/Codex versions and compares DNS, TCP, TLS, and HTTP reachability with and without the outer sandbox, using the same cleared environment. These are **Node HTTPS probes**, not Codex model requests: they send unauthenticated HEAD requests to `chatgpt.com` and `api.openai.com`, read no draft or login files, and create no review artifacts. Each connection has an eight-second deadline. HTTP errors still establish HTTPS reachability; they do not verify authentication or model access. Node and Codex use different TLS implementations, so a failed Node probe is a clue, not proof of a Codex failure. The report lists any recognized environment overrides Margin omits, by name only. Ctrl+C cancels the probes. Protection settings are never relaxed by this command.

Open the same project root in VS Code with Margin installed or running in a Development Host. New completed reviews produce a selection notification. **Margin: Refresh** rescans completed sidecars and recomputes locations against current editor text. No model calls occur in the extension.

## Focus on specific lines

Choose one or several ranges in a saved file:

```sh
margin review draft.md --lines 12-25,40-55 --provider codex \
  --brief "Focus on the reasoning and transitions in these passages."
# From the repository, try the demo offline:
margin review draft.md --root .demo/markdown --lines 3,7-9 --provider mock
```

`--lines` accepts individual lines, inclusive ranges, comma-separated lists, and repeated options. Numbers are **1-based physical source lines in the saved snapshot**, matching the editor's line numbers after saving; wrapped visual rows do not count. Overlapping/adjacent ranges merge. Zero, reversed, out-of-file, and entirely blank ranges produce errors; nothing is silently clamped. Up to 200 input ranges are allowed.

For an explicit multi-file project, use repeatable `--focus` options with project-relative filenames:

```sh
margin review --project --provider codex \
  --focus sections/introduction.tex:12-25 \
  --focus sections/methods.tex:40-55,70
```

Focus targets must already be selected source files in the manifest; context-only files cannot receive comments. **Full selected files still go into the snapshot and packet as context.** Focus limits where comments may originate; it does not limit what source text is shared or reduce the packet/file size limits. No other project files are discovered or read.

Blocks are split at focus boundaries, with outside passages labeled context-only. The importer rejects the whole response if any comment falls outside focus, including a quote that crosses its boundary. The editorial instructions also ask the letter to concentrate on the chosen passages. Original quote anchors, context, and file identity remain intact.

Focus works with `prepare` and every provider:

```sh
margin prepare draft.md --lines 12-25,40-55 --json
margin import request-REPLACE-WITH-RETURNED-ID response.json --json
```

Import uses the saved request's ranges even after you edit the draft; it never reinterprets the old line numbers against today's file. The extension shows focus in the review selector, tree, and editorial letter, labeled as snapshot lines. Comments still follow subsequent edits and can be manually reattached. CLI JSON results include the frozen focus ranges and their UTF-16 offsets. Focused request/session records use schema version 2 and require Margin **0.4.0+**; existing version 1 reviews remain readable. The model response, config, snapshot, and mutable discussion-state schemas remain version 1.

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
npm run test:install
npm run package
```

Packaging creates `dist/margin-0.4.0.vsix`, `dist/margin-cli-0.4.0.tgz`, and `dist/margin-0.4.0.json` containing their checksums. Filenames and package versions are derived from the workspace manifests and must agree. Both packages are self-contained: the CLI archive has no runtime npm dependencies or installation scripts, and the VSIX needs no development checkout. Nothing is published. To install already built artifacts without fetching dependencies or rebuilding, run `npm run setup -- --from-dist`. The checksum manifest detects corruption; it is not a signature or proof of who produced an artifact. See [installation and release details](docs/installation.md) for manual installation and uninstalling.

The default test suite is offline and uses a fake Codex executable. On macOS the provider tests also exercise actual Seatbelt read/write denials. `test:install` builds/packages and installs the actual CLI and VSIX into temporary npm/VS Code directories, runs a mock review, and checks repeat installation without modifying your normal extension installation. It may download the pinned build dependencies; it makes no model requests. The separate Development Host smoke test opens an isolated disposable workspace; it uses the installed macOS VS Code when found, otherwise the VS Code test runner may download one. Set `MARGIN_VSCODE_EXECUTABLE` to use an existing installation elsewhere.

This MVP supports one root (the first workspace folder), one selected session, and one state-writing extension instance. Concurrent state changes are detected; refresh and retry after a conflict. No semantic/fuzzy matching, rewrapping normalization, automatic issue reassessment, history timeline, branch reconciliation, or prose edits are implemented. See [architecture and limits](docs/architecture.md) and [verification notes](docs/testing.md).
