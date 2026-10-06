# Review of 1.8.13, fixes in 1.8.14

The review covered patch parsing and alignment, file/model identity, editor lifecycle, refresh and review state, theme/syntax handling, and browser interaction. Findings below were reproduced using synthetic fixtures, controlled asynchronous tests, or actual browser/VS Code runs. Private patches and screenshots are not part of this report or repository.

## Confirmed issues and fixes

| Area                    | Reproduction / user impact                                                                                                                       | Fix and regression coverage                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hunk alignment          | Moving one unique line across five repeated context lines changed a `+1/-1` patch into `+5/-5`.                                                  | Reject a recomputation that increases the number of changes; pure-model and real-renderer regressions.                                                                              |
| File identity           | `Aa.py` and `BB.py` have colliding upstream HTML IDs, so EOF annotations or summary navigation could target the wrong file.                      | Match models and wrappers by ordered source index; give rendered files and summary links unique IDs. Both layouts and collision fixtures covered.                                   |
| Omitted empty files     | With `renderNothingWhenEmpty`, a skipped first file shifted subsequent links, context folding, and syntax to the wrong model.                    | Shared wrapper/model mapping retains original file indexes; navigation, folding, syntax and EOF regressions.                                                                        |
| Viewed reset            | Clearing saved review state could resurrect an older in-memory record.                                                                           | Persistent documents no longer reuse mutable transient fallback state; store regression.                                                                                            |
| Viewed ordering         | A delayed hash could mark a file viewed after the user unchecked it, expanded all files, or refreshed the diff.                                  | Persist only the newest action for the current render; controlled delayed-hash tests.                                                                                               |
| Editor lifetime         | Closing a tab while Hide Panel was pending missed disposal and left its editor context alive.                                                    | Register lifecycle handlers before awaiting; check disposal/cancellation before rendering.                                                                                          |
| Multi-root settings     | Folder-specific display settings were ignored; toolbar changes could be masked by an existing folder override.                                   | Read settings for the diff URI and update their effective configuration level.                                                                                                      |
| Git-quoted paths        | C-quoted UTF-8, quotes and control characters were treated as literal escape sequences, breaking filenames, language detection and source links. | Decode only path metadata, preserving source content; rename, binary and mode-only cases included.                                                                                  |
| Custom token colors     | `editor.tokenColorCustomizations.strings`, comments and other named groups were ignored.                                                         | Apply named token-color groups before explicit TextMate rules; native grammar and mocked grammar tests.                                                                             |
| Combined diff syntax    | Two-character diff prefixes were stripped as one character, shifting token positions.                                                            | Strip the correct prefix for combined diff lines and hunk context.                                                                                                                  |
| Syntax responsiveness   | Large lexical passes blocked the extension-host event loop for seconds and obsolete work kept running.                                           | Cooperative macrotask yields, cancellation checks and completed-results-only cache. Output is preserved; total work is not eliminated.                                              |
| Large Find results      | Spreading 150,000 ranges exceeded the engine argument limit; painting all ranges also froze Chromium.                                            | Retain the full count and navigation, painting at most 2,000 matches around the current result. Native-browser stress regression.                                                   |
| Unequal-width scrolling | A narrow pane's clamped scroll event pulled the wider pane back, making long lines unreachable.                                                  | Track programmatic scroll positions across asynchronous native events and synchronize only the axes the user changed. Local/global, both pane orders and vertical movement covered. |

## Validation and reproduction

Results: **605 unit tests in 40 suites**, lint, TypeScript and formatting passed. The five existing browser scripts passed **28 scenarios**; the focused review harness passed **5 more** (150,000 Find matches and four scrolling combinations), with no browser errors. All **eight desktop regressions** passed in an isolated VS Code profile.

Use Node.js 22 from the repository root:

```sh
npm ci
npm test -- --runInBand
npm run build:prod
npx tsc --noEmit -p tsconfig.json
npm run format:check
node integration/browser/line-alignment.cjs
node integration/browser/no-newline.cjs
node integration/browser/context-folding.cjs
node integration/browser/expand-all.cjs
node integration/browser/scroll-gutter.cjs
node integration/browser/review-ui.cjs
```

The browser scripts require Playwright and Chromium in the test environment. `review-ui.cjs` also accepts `--find-only` or `--scroll-only` for isolated diagnosis. Fixtures are synthetic; browser tests use the built webview bundle and actual native scrolling/Highlight APIs.

Run the eight desktop regressions in a separate VS Code profile after the production build:

```sh
VSCODE_EXECUTABLE="/Applications/Visual Studio Code.app/Contents/MacOS/Code" node scripts/test-review-desktop.mjs
```

The executable path is platform-specific. The runner creates a temporary profile, extensions directory and workspace. It covers external file rewriting, syntax colors, context expansion, f-strings, semantic colors, refresh performance, Arc links, search and terminal maximization.

## Performance boundary

A controlled lexical benchmark using the installed VS Code Python grammar and Dark+ theme, 50,000 synthetic lines / approximately 2 MB, measured a maximum event-loop gap of **6064 ms before → 23 ms after**. Total lexical processing was **6076 ms before → 7095 ms after**, with the same colors and token output size (approximately 16.5 MB). This improves responsiveness and cancellation, not total throughput. It does not measure remote filesystem latency or full webview rendering time.

Reproduce with `node integration/benchmarks/lexical-responsiveness.cjs 50000`. Outside the default macOS VS Code installation, set `VSCODE_BUILTIN_EXTENSIONS` to the installed built-in extensions directory. The script uses actual grammars with a minimal extension-host-style API mock.

The original diff remains unchanged. Alignment is still heuristic; this review establishes the listed regressions and tested behavior, not that every possible patch has a unique correct visual pairing.
