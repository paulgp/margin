# Verification and manual checks

Run `npm ci`, then:

Initial implementation verification on Node 22.22.0/macOS: build and typecheck passed; all **37** original default tests passed with no skips; the actual Development Host smoke passed; the three-workspace offline demo ran; CLI linking/execution worked in an isolated npm prefix; VSIX packaging and `npm audit` passed (zero reported vulnerabilities). Additional provider tests cover progress privacy, split UTF-8 events, and retention of diagnostic classes on timeout.

Progress-update verification: build/typecheck and all **40** default tests passed, with no skips. A separate live review completed as described below; no live calls were added to the default test suite.

Connection-diagnostic verification on macOS **26.6.2**, arm64, Node **22.22.0**: all **45** default tests passed with no skips. Added offline tests cover specific error classification and redaction, fixed HEAD requests and certificate verification, DNS/TLS/deadline failures, strict probe output parsing, paired sandbox/control environments, source/index preservation, cleanup, and cancellation. Test subprocess/network results are mocked except for the existing provider tests' actual Seatbelt boundary. No live calls were added to the default tests.

The actual `npm run margin -- doctor --json` command was also run on that server. Control HTTPS probes reached both hosts (HTTP 403/421); protected Node probes failed TLS certificate verification (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`). The earlier successful live Codex review used a different TLS implementation, so this finding cannot establish the cause of a laptop's Codex timeout. The laptop was reported to run macOS **14.1.1**; its protected connection and UI compatibility have not been verified here. No new live model review was run for this diagnostic change.

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

A separate live Codex smoke on 2026-09-11 used the protected adapter on the bundled Markdown example: it completed in 18 seconds, imported an editorial letter and four comments, and left source hashes unchanged. This is one observed run, not a latency benchmark or a broad editorial-quality evaluation. The default suite remains fully offline. macOS OS updates and future Codex versions can require an adapter audit. This MVP does not claim security against a malicious runtime or a same-user process racing filesystem checks.
