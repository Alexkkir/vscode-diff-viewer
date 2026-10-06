# Latest local build: 1.8.17

Install `diff-viewer-1.8.17-viewed-anchors.vsix`, then run **Developer: Reload Window**.

The visible-line anchor now verifies source text and retains both old/new coordinates. Inserting lines above the viewport keeps the previously read text at the same position rather than following a reused line number. Pending Viewed checks now survive a redraw of unchanged content; changed content stays open, and later uncheck/Expand all actions still win. Hashes for repeated paths include every section so a change in an earlier section cannot remain incorrectly marked viewed.

The [report](viewed-anchors-1.8.17.md) describes reproduced failures and regression coverage. Build with the commands below using output version 1.8.17. The browser `view-state.cjs` suite includes insertions above the viewport; `viewed-lifecycle.test.ts` controls asynchronous hashing and overlapping updates with the actual renderer.

# Latest local build: 1.8.16

Install `diff-viewer-1.8.16-refresh-fidelity.vsix`, then run **Developer: Reload Window**.

This follow-up covers sequences of actions: refresh keeps horizontal scroll and manually opened large-diff files; layout changes keep the visible source-line anchor; delayed semantic highlighting preserves forward/backward and multiline selections. Real Git-generated patches also exposed source/path failures: embedded CR, header TAB delimiters, and literal filenames resembling revision or rename presentation. These are now handled at the parser boundary without changing decoded filesystem names.

For changed groups containing CR, intraline highlighting is disabled to avoid an upstream bug that mixed deleted text into the inserted side. Source text, side pairing, syntax colors and whole-line backgrounds remain intact. The [report](refresh-fidelity-1.8.16.md) records before/after evidence and repeatable checks. Build with the commands below using output version 1.8.16.

# Latest local build: 1.8.15

Install `diff-viewer-1.8.15-ui-contracts.vsix`, then run **Developer: Reload Window**.

Names are selectable without accidental navigation. **Copy path** and native menu actions copy exact paths, basenames or selected source text using the system clipboard. Read-only menus omit Cut/Paste; Find retains its editing menu. Open source with Ctrl/Cmd+click, Enter or Open file. Horizontal wheel and Shift+wheel work over the global scrollbar.

Early toolbar actions and actions during asynchronous redraw are replayed on the correct rendered view. A Viewed click during refresh survives for unchanged file contents, without falsely marking new contents reviewed. Isolated and fully rewritten statements align by compatible role/indentation while preserving source text and ordered anchors. Combined merge patches open as exact original text because the viewer has only two source columns.

The [validation report](ui-contract-1.8.15.md) records the source corpus and the actual desktop click/keyboard/menu/clipboard checks. Build with the commands below using output version 1.8.15. For the desktop UI suite, build production then run `DIFF_UI_AUDIT_PHASE=final node scripts/test-ui-controls-desktop.mjs`; it uses an isolated profile and restores the clipboard. The installed executable can be set with `VSCODE_EXECUTABLE`.

Validation: 732 tests passed in 43 suites; 67 source fixtures were checked in six rendering configurations. The full actual VS Code UI run passed all 28 groups without browser errors. Bundle hashes in the final report are verified against the packaged VSIX.

# Latest local build: 1.8.14

Install `diff-viewer-1.8.14-review-fixes.vsix`, then run **Developer: Reload Window**.

This build includes the fixes from a review of alignment, parsing, source identity, editor lifecycle, review state, syntax and scrolling. The [review report](review-1.8.14.md) records all 13 reproduced issues and the regression coverage. Fixes include preserving smaller valid diffs, preventing wrong-file links/colors/EOF markers, keeping Viewed state consistent across quick actions, handling quoted Git paths and folder-specific configuration, respecting custom token colors, and avoiding large-search crashes and asymmetric-scroll rollback.

Validation: 605 tests, lint, TypeScript, formatting, production build, 33 browser scenarios and eight isolated VS Code regressions passed. Large lexical work yields to the extension-host event loop and can be canceled; total processing time is not eliminated. Find retains all results and navigation while rendering at most 2,000 matching highlights at a time. All prior user-facing features remain included.

Build with the commands below using output version 1.8.14. The report includes browser, desktop and benchmark commands; packaging uses `npx vsce package --no-dependencies --githubBranch main -o /tmp/diff-viewer-1.8.14-review-fixes.vsix` after the production build.

# Latest local build: 1.8.13

Install `diff-viewer-1.8.13-block-alignment.vsix`, then run **Developer: Reload Window**.

Changed blocks can extend their reliable code matches to adjacent moderately similar lines. This keeps a rewritten condition and its early return on corresponding rows instead of adding artificial gaps. Extension requires equal indentation and shared lexical identifiers, stops at incompatible lines, and cannot cross existing matches. Comment/literal anchors and blocks without a reliable code match do not trigger it. Existing source text, line order, comparison budgets and opt-out settings remain intact.

Build with the commands below using output version 1.8.13. `node integration/browser/line-alignment.cjs` includes the guard/return regression in both layouts alongside previous alignment cases. The fixture reproduces the reported two-line edit using synthetic surrounding code.

Validation: 566 tests, lint, TypeScript, formatting and production build passed. Eight synthetic browser cases and ten checks on previously supplied external files passed with full source projections and paired row geometry preserved. The guard/return screenshot was visually checked; its two source rows are paired without inserted gaps. Another 3,000 generated sequences preserved source order, object identity and input immutability. Private patch contents remain outside the repository.

# Latest local build: 1.8.12

Install `diff-viewer-1.8.12-import-alignment.vsix`, then run **Developer: Reload Window**.

Short imports and ordinary Python statements now stay paired when only a long trailing comment changes. Comment recognition respects quotes and escapes and skips ambiguous f-strings/triple-quoted strings. A multiline `from` import rewritten on one line aligns with its original header, preferring the exact module over a similar neighboring import or a continuation line. Full source text remains available for inline highlighting. Existing opt-out and comparison limits remain honored.

The fixed line-number columns now composite translucent theme diff colors over an opaque editor background, preventing horizontally scrolled code from showing through. This applies to side-by-side and unified layouts while retaining insertion/deletion colors and diagonal gaps.

Validation: 551 unit tests, lint, TypeScript, formatting and production build passed. Chromium checked five affected files from the exact external patch in both layouts (nine expected line pairs per layout), preserving full source projections and row geometry. Six existing browser alignment scenarios passed. Dark/light themes in both layouts retained identical pixels in all 76 tested line-number cells after local scrolling and global scrollbar interaction. Screenshots were visually checked. Private input and private screenshots are not included in the repository.

Build with the commands below using output version 1.8.12. Regressions: `node integration/browser/line-alignment.cjs` and `node integration/browser/scroll-gutter.cjs` after a production build (requires Playwright). External fixture configuration is documented under 1.8.10; the harness now also recognizes paired replacement rows in unified layout.

# Latest local build: 1.8.11

Install `diff-viewer-1.8.11-expand-all.vsix`, then run **Developer: Reload Window**.

The footer now has an **Expand all** checkbox beside **Syntax highlighting**. Check it to expand every file, or uncheck it to collapse them using the existing review actions. It reflects individual file toggles and title-bar actions, shows a mixed state when some files are closed, and is disabled for empty diffs. Expanding a large diff overrides automatic collapse for that document across refreshes and webview restoration; individually marked viewed files still retain their review state. Context within a file continues to use the existing 50-line folding and 20-line expansion controls.

Build with the commands below using output version 1.8.11. Browser regression: after `npm run build:prod`, run `node integration/browser/expand-all.cjs` (requires Playwright in the test environment). The fixture uses 96 synthetic files.

Validation: 524 tests, lint, TypeScript, formatting and production build passed. Chromium verified both layouts through initial collapse, Expand all, content refresh, individual Viewed/mixed state, re-expansion, collapse and empty state; no browser errors occurred.

# Latest local build: 1.8.10

Install `diff-viewer-1.8.10-blank-context.vsix`, then run **Developer: Reload Window**.

Fixes another repeated-constructor case: a newly added docstring followed by a blank line could make the matcher delete the original constructor and retain a later test class's copy. Blank separators no longer act as unique code anchors or increase the code-matching score. Exact blank context is restored separately within the chosen matches; source text, line numbers and EOF status remain intact. The subsequence shortcut also respects this rule. All earlier features remain included.

Validation: 522 unit tests, lint, TypeScript, formatting and production build passed. Chromium verified the exact external patch in both layouts: all 16 constructor lines align, removed test-class code stays unpaired, source projections are preserved, and paired rows share the same geometry. Isolated VS Code regressions passed for context folding, external rewrites, refresh performance and syntax colors. The side-by-side screenshot was also visually checked.

The regression uses the same blank-line layout and repeated constructor structure. The private input is not included in the repository. For an external patch, set `DIFF_VIEWER_EXTERNAL_FIXTURE`, `DIFF_VIEWER_EXTERNAL_FILE_INDEX`, `DIFF_VIEWER_EXTERNAL_EXPECT_PAIRS` (JSON pairs of old/new line numbers), and `DIFF_VIEWER_EXTERNAL_DELETED_RANGES` (JSON inclusive old-side ranges), then run `node integration/browser/line-alignment.cjs` after a production build. Private screenshots and numeric reports are stored in a new OS temporary directory. Build with the commands below using output version 1.8.10.

# Latest local build: 1.8.9

Install `diff-viewer-1.8.9-diff-alignment.vsix`, then run **Developer: Reload Window**.

Changed-line matching now considers the ordered block as a whole, so a moved URL does not displace related decorator, class and docstring lines. This applies when `diffviewer.matching` is `lines` or `words`; `none` and configured comparison limits remain respected. Exact context inside each available hunk is also realigned, preferring earlier coherent copies of repeated code. A surviving constructor can remain context while later removed classes appear as deletions, even when Arc originally paired their duplicate lines incorrectly. Source projections and original line numbers are preserved; omitted hunk gaps are not filled. Work budgets retain the original hunk when a comparison would be too expensive.

Missing final-newline markers are preserved on the correct side and rendered outside source text, with paired row heights kept aligned. Arc revision labels are removed from real file headers, fixing false RENAMED badges while preserving actual renames and header-like source text. All prior syntax, folding, refresh, Arc links and terminal behavior remains included.

Validation: 510 unit tests, lint, TypeScript, formatting and production build passed. Chromium verified 18 scenarios in both layouts, including the combined removed-neighbor/renamed-class/repeated-constructor case, exact source projections and paired row geometry. Isolated VS Code regressions covered Arc links, context folding, external rewrites, semantic colors, diagnostics and refresh performance. Updated alignment on synthetic 10,000-line hunks takes approximately 0.5–4.3 ms locally; these are controlled parser measurements, not a remote filesystem guarantee.

Regression sources: `src/shared/__tests__/diff.test.ts`, `hunk-alignment.test.ts`, `hunk-alignment-renderer.test.ts`, frontend alignment/EOF tests, and `integration/browser/{line-alignment,no-newline}.cjs`. Fixtures use synthetic code. Run the browser scripts with Node after a production build; an optional first argument chooses the screenshot/report directory. Build using the commands below with output version 1.8.9.

# Latest local build: 1.8.8

Install `diff-viewer-1.8.8-hide-terminal-default.vsix`, then run **Developer: Reload Window**.
**DiffViewer: Hide Terminal On Open** (`diffviewer.hideTerminalOnOpen`) is now enabled by default, both in the settings manifest and the runtime fallback. Explicit user/workspace values remain honored, including false. All 1.8.7 behavior and prior fixes are retained.

Build using the commands below with output version 1.8.8. Validation: existing unit tests, lint, TypeScript, formatting and production build; VSIX manifest and compiled contents checked.

# Latest local build: 1.8.7

Install `diff-viewer-1.8.7-hide-terminal.vsix`, then run **Developer: Reload Window**. Enable **DiffViewer: Hide Terminal On Open** (`diffviewer.hideTerminalOnOpen`) if it is not already enabled; the default remains false.

Fixes reopening an already-active diff with `code diff.diff` from the integrated terminal. That operation can restore a maximized panel without changing the custom editor's active state, so the previous activation-only handler missed it. The webview now reports actual focus after a frame, and the extension executes Hide Panel after VS Code restores the editor. Pending focus is canceled on blur; outdated/disposed/hidden/inactive webviews are ignored. No content redraw or polling is introduced. The same setting also applies to manually focusing Diff Viewer, as its description now explains.

Validation: 440 unit tests, lint, TypeScript, formatting and production build passed. A real CLI test in isolated VS Code 1.138 reproduced the old maximized 743px → visible 267px behavior. With this fix, both unchanged-file and shell-redirection/reopen cases end with an invisible 0px panel. First opens also hide it. Manual terminal opening/maximization, background file refresh and disabling the setting preserve normal behavior; sessions are not terminated. Desktop search/maximize, external rewrite, refresh-performance and syntax/diagnostics regressions passed. `terminal-panel-1.8.7.json` records the measured panel states.

Regression source: `integration/desktop/hide-terminal-on-open.cjs`. It uses Playwright/CDP against an isolated VS Code workbench (Playwright must be available in the test environment). Run via `@vscode/test-electron` with `extensionTestsPath` pointing at that script; set `DIFF_VIEWER_TEST_CDP_PORT=9333` and `DIFF_VIEWER_TEST_USER_DATA_DIR=/private/tmp/diff-viewer-hide-panel-profile`, and pass matching `--remote-debugging-port=9333` / `--user-data-dir=/private/tmp/diff-viewer-hide-panel-profile` launch arguments plus a separate extensions directory and `--disable-extensions`. The integrated terminal launches the actual VS Code CLI with that isolated user-data path, leaving the normal user profile unchanged.

Build using the commands below with output version 1.8.7. All 1.8.6 performance, context, syntax and Arc features remain included.

# Latest local build: 1.8.6

Install `diff-viewer-1.8.6-fast-refresh.vsix`, then run **Developer: Reload Window**.

Large diffs render without waiting for language-server semantic tokens. Lexical TextMate colors, multiline context and the Python constant fallback appear first; validated semantic colors update the existing rows later, preserving expanded context, search, scroll and the syntax toggle. Loaded grammars are reused and exact lexical snapshots have a bounded cache. Native-token rows no longer pass through highlight.js too, and hidden context receives DOM syntax spans only when revealed. Full text and tokenization state remain available to Find and Expand.

File notifications are coalesced for 20 ms. The visible-editor fallback checks metadata every 250 ms instead of reading all bytes every two seconds; a two-second content check still covers unchanged/coarse metadata. Source link checks and syntax preparation run concurrently; content hashes for diagnostics are computed only on request. A briefly empty/incomplete overwrite keeps the old view during a bounded stabilization check, avoiding an extra render for shell redirection. Intentional empty diffs still update.

Measured locally on synthetic 1600-line Python diffs with a deliberately slow 1000 ms semantic provider: opening 1532–1662 ms → 284–434 ms; rewriting 2090–2505 ms → 276–283 ms. The new text appeared before the provider responded, and enrichment did not increment the DOM render generation. These controlled measurements are not a guarantee for every remote filesystem. Frontend-only Chromium measurements: 1600 lines initial 171 → 74 ms and refresh 148–159 → 56–59 ms; 5000 lines initial 475 → 186 ms and refresh 427–435 → 163–166 ms. Raw results are in `benchmarks-1.8.6/`.

Validation: 435 unit tests, lint, TypeScript, formatting and production build passed. Desktop checks passed for semantic colors, f-strings, context folding, Arc mode, external rewrites, find/terminal maximization and diagnostics. Chromium checks passed for lazy syntax, hidden-text search, expansion and scroll anchoring.

Regression scripts: `integration/browser/performance.cjs` (run with Node after a production build) and `integration/desktop/refresh-performance.cjs` (run via `@vscode/test-electron` with an isolated VS Code profile). Set `DIFF_VIEWER_PERF_BASELINE=1` to permit the old blocking behavior when testing an extracted 1.8.5 VSIX; `DIFF_VIEWER_PERF_REPORT` chooses the JSON report path. Existing desktop scripts cover external rewrites, f-strings, semantic colors, context folding, Arc links, find/terminal behavior and read diagnostics. Build using the commands below with output version 1.8.6. All previous features remain included.

# Latest local build: 1.8.5

Install `diff-viewer-1.8.5-arc-mode.vsix`, then run **Developer: Reload Window**.
New checkbox **DiffViewer: Arc Mode** (`diffviewer.arcMode`, enabled by default, resource scoped). A relative path from an Arc diff is resolved against the nearest containing directory named `arcadia` or a numbered mount such as `5arcadia`, using the diff file's URI. It works from deeply nested folders and preserves remote URI scheme/authority. A source absent in that mount is not silently replaced by another workspace/mount. Diffs outside those directories retain normal workspace resolution; disabling the setting restores that behavior everywhere.
Arc revision labels and rename presentation are removed from filesystem paths. Available file headers are styled keyboard-accessible links; click or Enter opens their source, and new-side line numbers navigate to the corresponding line. Explicit old/new actions remain available where their files exist. The same mount selection is used for syntax source context. Setting changes invalidate accessible-path caching and refresh links immediately.
Validation: 401 unit tests, lint, TypeScript, formatting and production build passed. Desktop VS Code tests verified two mounts with duplicate filenames in both layouts, line selection, missing-file isolation, setting toggles without touching the diff, context folding, external rewrites and semantic colors. Remote/deep URI cases are covered by unit tests. Regression script: `integration/desktop/arc-mode.cjs`.
Build using the commands below with output version 1.8.5. All previous fixes remain included.

# Latest local build: 1.8.4

Install `diff-viewer-1.8.4-expand-context.vsix`, then run **Developer: Reload Window**.
Large-context patches (for example `arc diff -U 1000 HEAD > diff.diff && code diff.diff`) now initially show changes with 50 unchanged lines on each side. Excess leading, trailing and intervening context is folded; overlapping context remains visible. Added/deleted lines are never folded.
Each gap has directional Expand buttons: reveal up to 20 lines below the preceding change or above the following change. The last step shows its actual remaining count. Both panes stay aligned. Expansion updates existing rows in place and preserves syntax markup without a Loading screen or webview reload.
Search includes folded context and reveals the selected hidden match. Expansion is stored for the unchanged file content and survives layout/theme redraws; rewritten content gets fresh default folds. Late asynchronous renders cannot overwrite newer diff payloads.
Only lines already present in the patch can be expanded; missing content outside the original hunks is not fabricated or fetched. The full patch remains available to syntax highlighting. Binary/combined diffs and unchanged-only blocks are left unfolded.
Regression coverage: `src/webview/message/handler/__tests__/context-ranges.test.ts`, `context-folding.test.ts`, `find.test.ts`, and `integration/desktop/context-folding.cjs`.
Validation: 345 unit tests, lint, TypeScript, formatting and production build passed. Desktop VS Code checks covered both layouts, expansion counts, search/reveal, retained state, external rewrites, search/terminal maximization and semantic colors. Chromium checks verified paired row alignment and stable scroll position, with screenshots saved alongside local artifacts. Run `node integration/browser/context-folding.cjs [artifact-directory]` after building to reproduce visual checks. VSIX integrity and bundle equality verified.
Build using the commands below with output version 1.8.4. All previous fixes remain included.

# Latest local build: 1.8.3

Install `diff-viewer-1.8.3-semantic-colors.vsix`, then run **Developer: Reload Window**.
Adds semantic foreground colors from VS Code language providers on exactly matching current-source documents, using the selected theme, standard TextMate fallback scopes and semantic color customizations. Requests are bounded and cached briefly; dirty, changed or mismatched source documents cannot supply stale token offsets. Remote URIs are preserved. Only token colors are sent to the view, with no diagnostic underlines.
Python module constants declared with ALL_CAPS assignments also receive the theme's readonly-variable color without a language server, including references inside f-string expressions. Unknown placeholders such as `__PROMPT_COLUMN__`, string content and comments retain their lexical colors. This fallback only recognizes declarations present in the available source/hunk; it does not infer arbitrary uppercase names.
Current-source semantic tokens are applied to the new side and unchanged context on the old side; removed lines use lexical highlighting and the conservative constant fallback. Unchanged old-side references use the current classification, which may differ from their historical types; this does not reconstruct historical language-server analysis. Semantic font styles and extension-specific semantic scope mappings are not reproduced.
The existing Syntax highlighting checkbox and `editor.semanticHighlighting.enabled` remain respected. All previous refresh, search, terminal, theme and f-string-context fixes are retained.
Validation: 305 unit tests, lint, TypeScript, formatting and the production build passed. Desktop VS Code checks passed for semantic colors and their settings in both layouts, standalone constants and f-string expressions, previous multiline f-string cases, external diff rewriting, search and three terminal maximization cycles, and syntax diagnostics. VSIX contents were verified against the compiled bundles.
Regression scripts: `integration/desktop/semantic-colors.cjs` and `integration/desktop/textmate-fstrings.cjs`. Build using the commands below with output version 1.8.3; no extra runtime downloads are needed.

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
