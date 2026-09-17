# Latest local build: 1.7.9

Install `diff-viewer-1.7.9-vscode-style.vsix`, then run **Developer: Reload Window**.
Background, foreground, font family/size/weight, line numbers, headers and inserted/deleted line colors use VS Code webview theme variables. Syntax token colors use an approximate VS Code Dark+/Light+ palette; this is not the editor's exact TextMate or semantic highlighting. No diagnostics are enabled.
Validation: 255 unit tests, lint, TypeScript, production build, formatting, desktop syntax colors/diagnostics, and Chromium computed background colors passed.
Build using the commands below with output version 1.7.9.
Theme API: https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content

# Latest local build: 1.7.8

Install `diff-viewer-1.7.8-no-loading-flash.vsix`, then run **Developer: Reload Window**.
The Loading overlay now appears only before the first successful render. Subsequent prepare messages and asynchronous refreshes leave the existing diff visible. Background file/focus checks remain enabled.
255 unit tests passed, including a regression asserting Loading stays hidden during prepare and asynchronous refresh. Production build, lint and TypeScript passed. Build using the commands below with output version 1.7.8.

# Latest local build: 1.7.7

Install `diff-viewer-1.7.7-refresh-dedup.vsix`, then run **Developer: Reload Window**.
Repeated file/focus/poll notifications now skip both loading UI and redraw when the complete render data is unchanged. File and focus checks remain enabled. Includes all 1.7.6 changes below.
Validation: 254 unit tests, lint, TypeScript, production build and formatting passed.
Build with the commands below, replacing the output filename with 1.7.7.

# Local build 1.7.6

Install `diff-viewer-1.7.6-auto-refresh.vsix` using VS Code's **Extensions → Install from VSIX**, then run **Developer: Reload Window**.

This snapshot includes the terminal maximization/search fix, syntax highlighting toggle, language detection for revision-labelled filenames (spaces or tabs), disk reload handling, a visible-editor polling fallback every two seconds, refresh on editor/window focus, and **Diff Viewer: Show diagnostics**.

The stale-content issue after window reload in the user's Dev Container remains unconfirmed. The diagnostics command reports the source of reads and content hashes without including source code. Unsaved document edits are preserved.

## Build

Use Node.js 22, from the repository root:

```sh
npm ci
npm test -- --runInBand
npm run build:prod
npx tsc --noEmit -p tsconfig.json
npm run format:check
npx vsce package --no-dependencies --githubBranch main -o /tmp/diff-viewer-1.7.6-auto-refresh.vsix
```

Validation: 253 unit tests, lint, TypeScript, formatting and production build passed. Desktop tests passed for syntax colors, read diagnostics, external rewrites/atomic replacements, and search/terminal maximization. See `integration/desktop/` for test sources. `syntax-colors.cjs` accepts an optional external diff via `DIFF_VIEWER_TEST_FIXTURE`; the user's private diff is not included.

The VSIX is the exact tested build. This backup branch does not update upstream PR #178. Version 1.7.6 is a local build identifier, not an upstream release.
