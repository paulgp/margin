# Verification and manual checks

Run `npm ci`, then:

Implementation verification on Node 22.22.0/macOS: build and typecheck passed; all **37** default tests passed with no skips; the actual Development Host smoke passed; the three-workspace offline demo ran; CLI linking/execution worked in an isolated npm prefix; VSIX packaging and `npm audit` passed (zero reported vulnerabilities). Installed Codex 0.154.0 feature preflight passed without authentication or a model request. No live model run was performed.

| Command | Purpose |
| --- | --- |
| `npm run build` | TypeScript project build; bundled CLI and extension |
| `npm run typecheck` | Strict TypeScript checks across workspaces |
| `npm test` | Offline core/CLI/state/anchoring/provider suite |
| `npm run demo` | Three disposable offline example workspaces; existing edits preserved |
| `npm run test:extension` | Isolated actual Extension Development Host smoke |
| `npm run package` | Local `dist/margin-0.1.0.vsix`; no publication |

The core/CLI tests cover byte/hash preservation, frozen-request import after user changes, strict rejection/diagnostics, source/context separation, scope/symlink rejection, packet limits, UTF-16 and surrogate boundaries, CRLF/BOM, multi-edit mapping, undo/redo, unchanged/moved/renamed/cross-file/changed/deleted/ambiguous passages, stale generations, local state persistence and conflict detection, and source/HEAD/index invariants on success and failure. Git fixture objects are constructed directly in disposable directories; no Git commits are made. Runtime Git commands remain read-only.

The default provider suite uses fake executables. On macOS it launches those executables inside actual Seatbelt and tests read/write denials against fixture drafts, safe-mode controls, failure/timeout/cancellation, output overflow, malformed final data, and symlink output. Other platforms skip only the macOS sandbox integration cases; subprocess/control unit tests remain portable. No test requires model authentication or performs a model request.

The Development Host smoke has been run on local VS Code 1.136.1/macOS. It activates Margin, checks native thread and tree counts, simulates an unsaved edit in a temporary draft, verifies its current attachment, writes a local reply and resolution, reloads state, opens the immutable original and editorial letter, and executes the diff command. It also deletes the highlighted passage, verifies its detached tree entry, manually reattaches a selection through the command, and verifies the override and unchanged original anchor. It asserts that draft bytes on disk remain unchanged. The host itself may emit unrelated built-in extension or account warnings; Margin does not call those integrations.

The smoke checks API behavior, not visual presentation. Still inspect these manually with F5:

- Dark/light/high-contrast decoration appearance and comment menu placement.
- Opening reply input, keyboard accessibility, long quotations, and tree filter usability.
- Reattach through the actual selection/menu interaction, then reload the window with both saved and unsaved selections.
- External rename plus manifest update; branch switch labels; deleted targets' original views.
- Native diff scroll/focus behavior (the requested selection is best-effort).
- Restricted Mode activation and a genuinely concurrent second window's conflict experience.

No live Codex model execution or editorial output quality has been verified. The installed runtime's help, version, feature controls and OS launch boundary are checked without a model request. macOS OS updates and future Codex versions can require an adapter audit. This MVP does not claim security against a malicious runtime or a same-user process racing filesystem checks.
