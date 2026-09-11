# Using Margin

Start a review from the terminal, then read and discuss it in VS Code. The [README](../README.md) walks through installation and a first example. This guide covers the options you may need as you keep writing.

## Project folders and saved files

Open the writing project's folder in VS Code and run Margin from a terminal in that folder. If your terminal is elsewhere, pass `--root /path/to/project`. The file argument is relative to that root.

For example, from the Margin repository:

```sh
margin review draft.md --root .demo/markdown --provider mock
code --reuse-window .demo/markdown
```

The review is stored in `.demo/markdown/.reviews`. Running `margin review .demo/markdown/draft.md` instead treats the repository as the writing project and rejects `.demo` as a hidden source path.

Margin reviews saved disk contents. Save changes deliberately before requesting a review. If you keep editing during or after the review, the extension uses your current editor text to locate comments and labels unsaved changes. It never saves those changes itself.

## Navigation and shortcuts

**Margin: Next Open Comment** and **Margin: Previous Open Comment** visit open discussions in their original review order. They wrap around at either end and include comments whose passages have changed or disappeared. A missing passage opens its saved original. If a resolved/dismissed filter would hide the destination, navigation switches the filter to open.

| Action | macOS | Windows/Linux |
| --- | --- | --- |
| Next open comment | `Cmd+K`, then `Option+Down` | `Ctrl+K`, then `Alt+Down` |
| Previous open comment | `Cmd+K`, then `Option+Up` | `Ctrl+K`, then `Alt+Up` |

Release the first key combination before pressing the second. Search for Margin in VS Code's Keyboard Shortcuts to change these bindings.

Use the comment's menu to reply locally, resolve, dismiss, reopen, show the original, compare versions, or reattach it. **Resolve and Next** and **Dismiss and Next** save the decision before moving on. From the Command Palette, these actions use the last comment opened through Margin, marked *current* in the sidebar; if none is current, they ask you to choose. A state-write conflict stops the action without advancing. Ordinary Resolve/Dismiss close the comment without moving you.

The sidebar and status bar count all open discussions in the selected review, even those hidden by a filter. Click the status bar to visit the next open comment. The current position resets when you select a review or reload VS Code; replies and discussion status are saved.

**Margin: Filter Discussions** shows all, open, resolved, or dismissed comments. **Margin: Show Editorial Letter** opens the overall review. **Margin: Refresh** reloads reviews and checks comment locations against current text.

## What happens when you edit

| Attachment label | What it means |
| --- | --- |
| `attached` | Margin has verified the current passage. |
| `changed` | Margin can still identify the location, but the passage has been edited. Read the original quotation before deciding whether the feedback still applies. |
| `unanchored` | The passage is missing or ambiguous. The comment remains in the sidebar without a source highlight. |

These labels are separate from open/resolved/dismissed discussion status. Editing a passage never automatically resolves its comment.

**Show Original** opens the saved source copy as a read-only document. **Compare Reviewed Version with Current** opens that copy beside today's text. Both work without Git. To reattach a comment, select a nonempty passage in an eligible source file and choose **Reattach to Selection**. Margin saves the new attachment separately and retains the original quotation. Attachments made in unsaved buffers are labeled and checked again after reload.

For a renamed file or a passage moved to another file, add the destination to the project file list and refresh. Margin searches only explicitly eligible files. It can recover exact passages when the evidence is clear; ambiguous matches stay detached. Rewrapping or substantial rewriting may require manual reattachment.

## Focus on specific lines

```sh
margin review draft.md --provider codex --lines 12-25,40-55
margin prepare draft.md --lines 12-25 --lines 40-55 --json
```

`--lines` accepts individual lines, inclusive ranges, comma-separated lists, and repeated options. Numbers are one-based physical source lines in the saved file; wrapped display rows do not count. Overlapping or adjacent ranges merge. Invalid, out-of-file, or entirely blank ranges produce an error. Up to 200 input ranges are allowed.

Full selected files still go into the saved copy and review packet as context. Focus restricts where local comments may originate, not how much text is shared. File and packet size limits still apply. The importer rejects an entire response if any quotation falls outside focus or crosses its boundary. The prompt also asks the editorial letter to concentrate on the chosen passages.

Focus is fixed to the saved review copy. Later edits can move a comment beyond its original line numbers; the focus label still refers to the reviewed version. Focused reviews require Margin 0.4.0 or newer. Older, unfocused reviews remain supported.

## Multi-file projects

Run `margin init`, then edit `.reviews/config.json` to list your source files and any files the reviewer should use only as context:

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

Then review the project, or focus on passages within it:

```sh
margin review --project --provider codex
margin review --project --provider codex \
  --focus sections/introduction.tex:12-25 \
  --focus sections/methods.tex:40-55,70
```

Each focus target must be in `files`. Files in `context_files` cannot receive comments. The [LaTeX example](../examples/latex) includes sections, macros, and a bibliography. To try it offline from the repository:

```sh
margin review --root examples/latex --project --provider mock
```

Source files may use `.md`, `.markdown`, `.typ`, or `.tex`; context files may also use `.bib`, `.sty`, `.cls`, or `.txt`. Paths must be relative to the project folder. Hidden paths, dependencies, common build folders, and all symbolic links are rejected. Missing files and exceeded size limits produce errors; nothing is silently omitted or truncated. Margin does not follow TeX/Typst includes or scan the repository for extra context.

The manifest also sets the default brief and comment limit. Command-line options override those defaults. A positional file review reads only that file, rather than the project list.

## Prepare and import

`prepare` works without credentials or an installed model tool:

```sh
margin prepare draft.md --brief "Review the argument." --max-comments 8 --json
```

It prints a request ID and paths to a saved source copy, a review packet, a JSON response schema, and the request record. The packet contains the instructions and source; the schema describes the required response format. Give both to your chosen reviewer, then save its final JSON response and import it:

```sh
margin import request-REPLACE-WITH-RETURNED-ID response.json --json
```

Import uses that request's saved copy, even if the draft has changed. It rejects unsupported fields, the wrong request ID, ineligible files, excessive comments, and quotations that are absent or ambiguous. An invalid response produces a local diagnostic under the request folder and installs no comments. Correct the response and retry. Each successful import creates a new review; it does not overwrite an earlier one.

Quotations must be exact and unique within their indicated source block. The block IDs appear only in review files, never in your draft. Zero local comments is valid. See [the response example](architecture.md#responses-and-original-anchors) for the JSON fields.

`--json` writes a success record to stdout. Artifact paths are relative to the project root; the record also identifies that root. Progress and errors go to stderr. Focused results include their saved line ranges and offsets. `margin review` runs this same prepare/import sequence around the selected reviewer.

Manually using another external agent falls outside Margin's protection of your files. The importer itself never edits your draft.

## Troubleshooting

If a review is missing in VS Code, check that the open folder matches the CLI's printed project folder. Run **Margin: Refresh**, then **Margin: Select Review**. **Filter Discussions → all** also makes resolved and dismissed comments visible.

A Codex review prints startup information and a progress message at least every ten seconds. The 120-second timeout is a ceiling, not a typical wait time. Press Ctrl+C to cancel; the prepared request is retained so you can still import a response later. Raw model reasoning and credentials are not printed in progress messages.

If ordinary Codex works but Margin fails, check the installed version and [supported authentication and connection setup](codex-safety.md#authentication-failures-and-limits). Margin isolates Codex from user/project configuration, hooks, and integrations. A custom model, company endpoint, proxy, private certificate, or keychain-only login may therefore behave differently. `--model NAME` lets you explicitly select a model without loading the usual Codex configuration.

On macOS, run this without a draft or model request:

```sh
margin doctor --json
```

The doctor reports OS/Node/Codex versions and checks DNS, TLS, and HTTPS inside and outside the review sandbox. It reads no draft or credentials. A successful HTTPS check establishes reachability; it does not prove that Codex login, model access, or streaming will work. See [the protection policy](codex-safety.md) for the diagnostic limits.

If a reply or status update reports a state conflict, refresh before retrying. Do not overwrite another window's decisions. Margin currently supports one state-writing extension instance per project.

## Keeping reviews in Git

`.reviews/.gitignore` excludes reviews by default. To version them deliberately, edit that file yourself. For example, remove `*` and retain `.tmp-*` and `*.lock` exclusions. Margin does not edit the project's root `.gitignore`.

Saved source copies contain full selected draft/context text. Manual reattachments also store the selected buffer's decoded text so Margin can locate it later. Decide whether those files belong in the repository before sharing them.
