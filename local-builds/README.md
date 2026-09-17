# Latest local build: 1.8.2

Install `diff-viewer-1.8.2-fstring-context.vsix`, then run **Developer: Reload Window**.
Fixes reversed string/code coloring when a Python diff hunk starts inside a multiline f-string. If a matching working-tree source is available beside the diff or in its workspace/ancestor path, its unchanged context is used and the old side is reconstructed by reversing the validated hunks. A mismatched source is ignored. Reads use the diff URI scheme (including remote containers), with bounded file sizes.
For standalone Python hunks, a narrow recovery recognizes a first bare triple-quote delimiter followed only by argument/list closing punctuation. Completely ambiguous fragments still cannot be reconstructed exactly without their source.
The token cache includes recovered source context. Source files are only read; they are never modified or added to this repository.
Validation: 270 unit tests, lint, TypeScript, formatting and production build passed. Desktop checks verified f-string text/interpolation and following Python code with matching/missing/stale source in both layouts, normal Python theme colors, and external diff rewrites. Source reconstruction additionally passed 250 generated Git patches.
Regression script: `integration/desktop/textmate-fstrings.cjs`.
Build using the commands below with output version 1.8.2.

# Latest local build: 1.8.1

Install `diff-viewer-1.8.1-diagonal-gaps.vsix`, then run **Developer: Reload Window**.
Missing counterpart rows in side-by-side diffs now use the native VS Code 8px diagonal fill pattern and `diffEditor.diagonalFill` theme color. Real blank source lines and line-number gutters stay unstriped. Stripes align across adjacent rows.
Validation: production build/lint and VSIX integrity passed. Chromium checks and visual inspection verified dark/light themes, gaps on either side, plain gutters and real empty lines. All 1.8.0 behavior is retained.
Build using the commands below with output version 1.8.1.

# Latest local build: 1.8.0

Install `diff-viewer-1.8.0-native-syntax.vsix`, then run **Developer: Reload Window**.

- Uses installed VS Code TextMate grammars and the selected theme's token colors, including inherited theme files and custom textMateRules. Tokenization keeps separate old/new multiline states within contiguous diff hunks. Unknown languages/themes fall back to highlight.js.
- Syntax highlighting remains toggleable. Inline diff markup and source text are preserved. Language servers, diagnostic squiggles, semantic highlighting and bracket-pair coloring are not included; these can still differ from the full editor. Missing preceding hunk context may affect multiline grammar state.
- New setting `diffviewer.hideTerminalOnOpen` (default false): hides the bottom panel on opening/activating Diff Viewer, including a file opened via `code file.diff`. It is not restricted to CLI opens and does not terminate terminal processes.
- All previous refresh and no-loading-flash fixes remain included.

Validation: 258 unit tests, lint, TypeScript, formatting and production build passed. Desktop tests verified actual Dark+ Python token colors in both layouts, installed TextMate tokens, external rewrites, and search/terminal maximization with the setting off. The opt-in closePanel command is covered by a unit test.
Reproduce the Python color test with `integration/desktop/textmate-python.cjs` via @vscode/test-electron and an isolated VS Code profile.
Build using the commands below with output version 1.8.0. WASM is bundled into extension.js; no extra runtime downloads are required.

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
