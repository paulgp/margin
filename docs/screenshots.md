# Reproducing the screenshots

The README images are Playwright captures of the actual desktop VS Code application running Margin. They show native comment threads, the Margin review list, and VS Code's original/current diff view.

From this repository, with Node and desktop VS Code installed:

```sh
npm ci
npm run screenshots
```

The script uses the pinned `playwright-core` dependency; it does not download a browser. On macOS it launches `/Applications/Visual Studio Code.app/Contents/MacOS/Code`. To use another installation, set `MARGIN_VSCODE_EXECUTABLE` to the application's executable, rather than the `code` shell launcher. Capture has been checked on macOS with VS Code 1.136.1; other platforms have not been verified.

The script builds Margin, launches an isolated Extension Development Host, and connects Playwright to its local renderer debugger. It uses a temporary user profile, extension directory, and copy of the Markdown example. It does not use your normal editor window or settings. Workspace Trust is disabled only in this disposable capture host.

Three hand-authored comments are imported through Margin's normal prepare/import path and labeled with the `demo` provider. These are illustrative feedback, not a model assessment. No model call or authentication is needed.

The first image shows a comment beside its passage. For the second, Playwright types an example revision into the temporary editor without saving it, then opens **Compare Reviewed Version with Current**. The script checks that the draft's disk bytes remain unchanged and removes the temporary workspace when it exits.

The images are saved at 1440 × 960 in the Light Modern theme:

- [`images/review-comments.png`](images/review-comments.png)
- [`images/compare-versions.png`](images/compare-versions.png)

These are direct application screenshots, without compositing or replacement UI. Review them before committing an update: VS Code releases can change command names, layout, or screenshot timing. The capture checks these example interactions; it does not replace the broader extension smoke test or accessibility and theme checks in [verification notes](testing.md).
