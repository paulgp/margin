# Margin

Source-first, comment-only editorial review for Markdown, Typst, and LaTeX.
Margin displays native comment threads and a review tree. It never edits or saves your draft.

Install the companion CLI from the Margin repository:

```sh
npm ci
npm run build
npm link --workspace margin-cli
```

From your writing project's root:

```sh
margin init
margin review draft.md --provider mock
```

Open that project in a trusted VS Code desktop workspace. Use **Margin: Select Review**,
then the Explorer's Margin tree. Reply locally, resolve, dismiss, reopen, show original,
compare reviewed/current text, or manually reattach to your current source selection.
Unanchored comments remain in the tree. Dirty buffers are visibly labeled and never saved.

Use **Margin: Show Editorial Letter**, **Margin: Refresh**, and **Margin: Filter Discussions**
from the command palette. Multi-file projects use an explicit `.reviews/config.json` manifest.
For a renamed target, add its new path to that manifest and refresh.

Snapshots contain full text and are private via `.reviews/.gitignore` by default.
The extension never calls a model. The CLI also supports provider-independent prepare/import
and protected Codex execution on macOS (audited CLI version 0.154.0).

See the repository README and `docs/` for complete CLI installation, manifest examples,
write protection, tests, limits, and the repeatable offline F5 demo.
