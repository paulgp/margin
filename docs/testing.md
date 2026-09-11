# Verification and manual checks

Margin **0.4.0** line-focus verification: all **72** offline tests passed, including focused Markdown/Typst/multi-file LaTeX prepare/import, repeated line lists, BOM/CRLF/emoji offsets, exact byte/span preservation, invalid/blank/out-of-file focus, context-only targets, whole-response rejection for out-of-focus quotations, immutable focus after user edits, tamper/version checks, legacy reviews, and unchanged source/Git evidence. The protected Codex adapter was exercised with a fake executable that checked the focus packet and returned a comment within scope; no live model call was made. The actual VS Code 1.136.1 Development Host smoke passed on the desktop, including focused version 2 session loading, visible focus labels, Unicode/CRLF selections, unsaved movement beyond original line numbers, and full read-only originals. Existing navigation/state/UI smoke checks also passed. Laptop verification remains separate.

The 0.4.0 installation smoke passed with real npm/VS Code installs in temporary directories. It ran both full-file and multi-range focused mock reviews through the installed CLI, checked focus containment, and verified repeat installation preserved the source and both sessions. `npm ci`, build/typecheck, CLI/VSIX packaging, and artifact checksum verification passed. Packages are `dist/margin-0.4.0.vsix`, `dist/margin-cli-0.4.0.tgz`, and `dist/margin-0.4.0.json`.

Margin **0.3.0** navigation verification: all **60** offline tests passed, and the actual VS Code 1.136.1 Development Host smoke passed on the macOS desktop. New coverage includes forward/backward wrap and skipping closed comments, rapid queued commands, navigation across Markdown/Typst/LaTeX files, unsaved range shifts, changed and detached targets, filtered tree visibility, open counts, Resolve/Dismiss and Next, a concurrent writer blocking advancement, session changes, and empty reviews. The smoke confirms disk draft bytes and immutable session records stay unchanged. The navigation cursor resets on session selection while persisted decisions/replies survive reload through the storage path. Keyboard commands were invoked through the VS Code API; physical shortcut dispatch and visual menu layout still need a manual check. No live model call was made.

The **0.3.0** installation smoke also passed: `npm ci` accepted the synchronized lockfile, both packages built, the real CLI/VSIX installed into temporary directories, a mock review succeeded through the installed CLI, and repeat installation preserved draft/review bytes. Packaged artifacts are `dist/margin-0.3.0.vsix`, `dist/margin-cli-0.3.0.tgz`, and their checksum manifest.

Project-folder follow-up: build and all **57** offline tests passed. A CLI regression test reproduces the rejected `.demo/markdown/draft.md` invocation, checks the `--root` guidance, and runs mock reviews with `--root .demo/markdown`. It verifies that sessions are stored only in the selected demo project, the reported VS Code folder agrees, and draft bytes, Git HEAD, and index remain unchanged. No live model or new editor UI check was performed for this CLI/documentation change.

Run `npm ci`, then:

Margin **0.2.0** installation verification: build/typecheck and all **56** offline tests passed. `npm run test:install` also passed using actual npm and VS Code 1.136.1 on the development desktop (macOS 26.6.2, Node 22.22.0). It ran the complete setup path, including `npm ci`, packaging, replacement of a simulated older development link, installation of the CLI and VSIX into temporary directories, version checks, an offline mock review through the installed CLI, and same-version reinstallation. Draft/review bytes and the former linked source stayed unchanged. The CLI is a regular standalone installation with no runtime npm dependencies or install scripts. The normal VS Code extension directory was not targeted. This smoke verifies package installation; the native comment UI is covered separately by the Development Host smoke below. No model call was made for this change. Installation on the laptop and non-macOS platforms has not been verified here.

Initial implementation verification on Node 22.22.0/macOS: build and typecheck passed; all **37** original default tests passed with no skips; the actual Development Host smoke passed; the three-workspace offline demo ran; CLI linking/execution worked in an isolated npm prefix; VSIX packaging and `npm audit` passed (zero reported vulnerabilities). Additional provider tests cover progress privacy, split UTF-8 events, and retention of diagnostic classes on timeout.

Progress-update verification: build/typecheck and all **40** default tests passed, with no skips. A separate live review completed as described below; no live calls were added to the default test suite.

Connection-diagnostic verification on macOS **26.6.2**, arm64, Node **22.22.0**: all **45** default tests passed with no skips. Added offline tests cover specific error classification and redaction, fixed HEAD requests and certificate verification, DNS/TLS/deadline failures, strict probe output parsing, paired sandbox/control environments, source/index preservation, cleanup, and cancellation. Test subprocess/network results are mocked except for the existing provider tests' actual Seatbelt boundary. No live calls were added to the default tests.

The actual `npm run margin -- doctor --json` command was also run on that server. Control HTTPS probes reached both hosts (HTTP 403/421); protected Node probes failed TLS certificate verification (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`). The earlier successful live Codex review used a different TLS implementation, so this finding cannot establish the cause of a laptop's Codex timeout. The laptop was reported to run macOS **14.1.1**; its protected connection and UI compatibility have not been verified here. No new live model review was run for this diagnostic change.

The user subsequently supplied a laptop doctor report on macOS **14.1.1**, arm64, Node **24.18.0**, Codex **0.154.0**: both control and protected Node probes reached both hosts (HTTP 403/421), and no recognized omitted environment overrides were present. This establishes those Node HTTPS connections, not Codex authentication/streaming or overall macOS compatibility.

Retry-diagnostic verification: all **46** offline tests passed with no skips. The installed runtime was independently probed inside Seatbelt to verify `unbounded_connection_retries=false` takes effect. Fake executable tests assert that control and the fixed warning-level environment; privacy tests cover reasoning activity markers, retry-count reporting, credential-source labels, unavailable models, and numbers that must not be interpreted as HTTP statuses.

A separate real review with the updated retry settings also completed on the server on 2026-09-11 in **18 seconds**, importing four comments from the bundled Markdown example. Draft bytes and Git HEAD/branch context remained unchanged. This is a live model run outside the default test suite; it does not establish that the laptop timeout is fixed.

The laptop's next review reported a TLS/certificate failure from Codex despite its successful Node probes. The certificate-bundle change supplies Codex and both Node doctor modes with the public CA roots shipped in Node. **49 offline tests passed with no skips**, including a real loopback TLS server and clients inside actual Seatbelt: the selected test CA succeeds, an untrusted issuer fails, and a wrong hostname fails. The short-lived test CA/server keys are generated only in disposable fixtures; no external network or model call is involved. Bundle tests check exact correspondence to Node's public roots, CA parsing, private-key/extra-text rejection, size/count limits, exclusive writes, and symlink rejection. Provider tests continue to verify source/index protection and now assert the private certificate file and absence of TLS-bypass variables.

On the server, the actual doctor command with the explicit 146-certificate bundle now reaches both hosts in both modes (HTTP 403/421); the previous protected Node certificate failure is eliminated. The bundle makes the trust roots available without expanding the sandbox's file permissions. Laptop verification of the Codex fix is still pending.

A separate real Codex review with the certificate bundle completed on the server in **18 seconds**, importing four comments with draft bytes and Git HEAD/branch context unchanged. This live run is separate from the 49 offline tests and does not verify the laptop until its owner retries.

| Command | Purpose |
| --- | --- |
| `npm run build` | TypeScript project build; bundled CLI and extension |
| `npm run typecheck` | Strict TypeScript checks across workspaces |
| `npm test` | Offline core/CLI/state/anchoring/provider suite |
| `npm run demo` | Three disposable offline example workspaces; existing edits preserved |
| `npm run test:extension` | Isolated actual Extension Development Host smoke |
| `npm run test:install` | Actual install/update smoke in temporary npm and VS Code directories |
| `npm run package` | Versioned CLI tarball, VSIX, and checksum manifest in `dist/`; no publication |
| `npm run setup` | Build and install CLI/extension for ordinary use in the current VS Code window |

The core/CLI tests cover byte/hash preservation, frozen-request import after user changes, strict rejection/diagnostics, source/context separation, scope/symlink rejection, packet limits, UTF-16 and surrogate boundaries, CRLF/BOM, multi-edit mapping, undo/redo, unchanged/moved/renamed/cross-file/changed/deleted/ambiguous passages, stale generations, local state persistence and conflict detection, and source/HEAD/index invariants on success and failure. Git fixture objects are constructed directly in disposable directories; no Git commits are made. Runtime Git commands remain read-only.

The default provider suite uses fake executables. On macOS it launches those executables inside actual Seatbelt and tests read/write denials against fixture drafts, safe-mode controls, failure/timeout/cancellation, output overflow, malformed final data, and symlink output. Other platforms skip only the macOS sandbox integration cases; subprocess/control unit tests remain portable. No test requires model authentication or performs a model request.

The Development Host smoke has been run on local VS Code 1.136.1/macOS. It activates Margin, checks native thread and tree counts, simulates an unsaved edit in a temporary draft, verifies its current attachment, writes a local reply and resolution, reloads state, opens the immutable original and editorial letter, and executes the diff command. It also deletes the highlighted passage, verifies its detached tree entry, manually reattaches a selection through the command, and verifies the override and unchanged original anchor. It asserts that draft bytes on disk remain unchanged. The host itself may emit unrelated built-in extension or account warnings; Margin does not call those integrations.

The resolve/dismiss follow-up smoke also passed in the actual Development Host: each action collapses an expanded native thread after saving its discussion state, refresh preserves the collapsed state, and the tree still allows opening the comment. The simulated dirty draft remains unchanged on disk.

The smoke checks API behavior, not visual presentation. Still inspect these manually with F5:

- Dark/light/high-contrast decoration appearance and comment menu placement.
- Physical Next/Previous shortcuts (`Cmd+K`, then `Option+Down/Up` on macOS), custom keybinding conflicts, and arrow-button/status-bar placement.
- Opening reply input, keyboard accessibility, long quotations, and tree filter usability.
- Reattach through the actual selection/menu interaction, then reload the window with both saved and unsaved selections.
- External rename plus manifest update; branch switch labels; deleted targets' original views.
- Native diff scroll/focus behavior (the requested selection is best-effort).
- Restricted Mode activation and a genuinely concurrent second window's conflict experience.

A separate live Codex smoke on 2026-09-11 used the protected adapter on the bundled Markdown example: it completed in 18 seconds, imported an editorial letter and four comments, and left source hashes unchanged. This is one observed run, not a latency benchmark or a broad editorial-quality evaluation. The default suite remains fully offline. macOS OS updates and future Codex versions can require an adapter audit. This MVP does not claim security against a malicious runtime or a same-user process racing filesystem checks.
