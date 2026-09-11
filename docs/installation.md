# Installation and updates

Margin 0.3.0 provides one setup command from a trusted checkout:

```sh
npm run setup
```

It requires Node 22/24 LTS, npm, and VS Code 1.100+. The helper supports macOS and Linux; the protected Codex provider still requires the separately audited macOS/Codex runtime. Setup does not install or authenticate Codex. Use the mock or prepare/import workflows without it.

The default sequence is: check Node/npm/VS Code and installed versions; install lockfile-pinned build dependencies; build and package both components; verify package checksums; install the CLI tarball locally with npm; install the VSIX through VS Code's CLI; verify both versions. The installer uses subprocess argument arrays, bounded execution and cancellation. It does not run Git commands, open a project window, modify drafts/reviews or shell startup files, or publish anything. Existing VS Code windows need one **Developer: Reload Window** after installation or updates.

The CLI uses your configured npm global prefix. If that prefix is protected, choose a user-owned prefix:

```sh
npm run setup -- --prefix "$HOME/.local"
```

Setup prints a safely quoted PATH command when needed. Add it to your shell configuration yourself to make it permanent. It also detects when another `margin` earlier on PATH would shadow this installation. No global `sudo` or npm-config mutation is used.

VS Code's CLI is detected on PATH and, on macOS, inside the normal system/user Applications directories. `--code /path/to/code` accepts an executable path, never a shell command. `--profile NAME` selects a VS Code profile. `--extensions-dir DIR` and `--user-data-dir DIR` support isolated installations/testing. Installation uses the [official VS Code extension CLI](https://code.visualstudio.com/docs/configure/command-line); F5 launches the separate extension development workflow.

## Updates and partial failures

```sh
git pull --ff-only
npm run setup
```

Both components use the same release version. A newer installed CLI or extension prevents an accidental downgrade. Same-version reinstallation is supported, including replacing the earlier development `npm link` in that npm prefix. Existing linked source files are not edited. Changes to the checkout after setup do not change an installed CLI until setup is rerun.

CLI and VS Code installation are separate operations, not a shared transaction. If the CLI fails, the extension is not attempted. If extension installation fails after the CLI succeeds, setup reports that partial result and exits unsuccessfully. Rerunning setup retries installation; it does not roll back unrelated software. An interrupted setup may leave an incomplete npm or VS Code installation that needs the same retry.

`--skip-dependencies` uses existing `node_modules`, while still building and packaging. `--from-dist` installs existing checksum-verified packages without rebuilding or downloading dependencies. `--cli-only` does not require or change VS Code. The default npm dependency installation may use the network; installation of the standalone CLI tarball uses npm's offline mode with scripts/audit disabled.

## Artifacts and manual installation

`npm run package` produces:

- `dist/margin-cli-0.3.0.tgz`: bundled CLI, package metadata, README, and license; no workspace links, runtime dependencies, or install scripts.
- `dist/margin-0.3.0.vsix`: the bundled VS Code extension.
- `dist/margin-0.3.0.json`: version and SHA-256 checksums for both artifacts.

The filenames are generated from package versions, not hard-coded in the packaging script. It rejects mismatched workspace versions and a stale CLI bundle. The completion manifest is written after both packages. Checksums catch incomplete/corrupted copies, not malicious modification of both a package and its manifest; use artifacts from your trusted checkout. No review sidecars, examples, authentication files, or dependency trees are included in either package.

With those artifacts copied from a trusted machine, manual installation is also possible:

```sh
npm install --global ./margin-cli-0.3.0.tgz --offline --ignore-scripts --no-audit --no-fund
code --install-extension ./margin-0.3.0.vsix --force
margin --version
```

No checkout is needed to run either installed component. The [npm install reference](https://docs.npmjs.com/cli/v10/commands/npm-install/) documents installing local tarballs and global prefixes. For release maintenance, increment root/core/CLI/extension versions together, update the CLI's core dependency and lockfile, then build/test/package. Release artifacts are local and excluded from Git; no npm or Marketplace publication is performed.

## Uninstall

```sh
npm uninstall --global margin-cli
code --uninstall-extension margin-local.margin
```

Use the same `--prefix`, VS Code profile, or custom directories if you selected them during setup. Uninstalling the components leaves your writing projects and `.reviews` directories intact.

## Verification

`npm test` exercises installer planning, prerequisite/version checks, corrupted artifacts, partial failures, and cancellation without real installations or network calls. `npm run test:install` performs actual installations in disposable npm and VS Code directories, replaces a simulated old development link, runs an offline review from the installed CLI, and reinstalls the packages. It never targets your normal VS Code installation. The separate extension smoke tests native comment behavior in a Development Host.
