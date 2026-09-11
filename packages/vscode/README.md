# Margin

Source-first, comment-only editorial review for Markdown, Typst, and LaTeX.
Margin displays native comment threads and a review tree. It never edits or saves your draft.

Install or update both the companion CLI and this extension from the Margin repository:

```sh
npm run setup
```

Reload your existing VS Code window once after installation. F5 and a separate Development Host
window are only needed when developing the extension. From your writing project's root:

```sh
margin init
margin review draft.md --provider mock
```

Open that project in a trusted VS Code desktop workspace. Use **Margin: Select Review**,
then the Explorer's Margin tree. Reply locally, resolve, dismiss, reopen, show original,
compare reviewed/current text, or manually reattach to your current source selection.
Unanchored comments remain in the tree. Dirty buffers are visibly labeled and never saved.

Use **Margin: Next Open Comment** / **Margin: Previous Open Comment**, the tree's arrow buttons,
or the status bar to navigate open discussions. On macOS, press **Cmd+K**, release, then
**Option+Down** (next) or **Option+Up** (previous). Windows/Linux use **Ctrl+K** then **Alt+Down/Up**.
Navigation wraps in review order and includes changed/unanchored comments; unanchored targets
open their read-only original. Closed-discussion filters switch to open when navigating.

**Margin: Resolve and Next** / **Margin: Dismiss and Next** save the selected discussion's state,
close its thread, then advance. Use a comment's menu or the Command Palette; palette actions
use the last comment opened through Margin, marked **current** in the tree, or ask you to choose.
The status bar and tree heading show how many comments remain open across the whole session.
Ordinary Resolve/Dismiss close without advancing. Failed state writes never advance.

Use **Margin: Show Editorial Letter**, **Margin: Refresh**, and **Margin: Filter Discussions**
from the command palette. Multi-file projects use an explicit `.reviews/config.json` manifest.
For a renamed target, add its new path to that manifest and refresh.

To focus a CLI review, use `margin review draft.md --lines 12-25,40-55 --provider codex`,
or `--project --focus sections/introduction.tex:12-25` with an explicit manifest.
Other selected text stays in the packet as context, and comments must originate within the chosen
inclusive saved-source lines. Focus appears in the selector, tree, and editorial letter as
**snapshot lines**. Comments follow later edits normally; Margin never saves an unsaved selection.
Focused reviews need Margin 0.4.0 or newer. Existing reviews remain supported.

Snapshots contain full text and are private via `.reviews/.gitignore` by default.
The extension never calls a model. The CLI also supports provider-independent prepare/import
and protected Codex execution on macOS (audited CLI version 0.154.0).

See the repository README and `docs/` for complete CLI installation, manifest examples,
write protection, tests, limits, and the repeatable offline F5 demo.
