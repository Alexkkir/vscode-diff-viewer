# Follow-up review — 1.8.17

Three additional cases were reproduced on 1.8.16 and fixed. They are independently found cases; the user's newly reported symptoms had not yet been described when this review was performed.

| Case                                              | Before                                                                                                                                                                         | After                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lines inserted above the viewport                 | An anchor at `source_100` followed its previous new-side line number and showed `source_80`.                                                                                   | Match both coordinates and source text; actual Chromium retains `source_100` at 60 px in both layouts.                                                              |
| Viewed clicked just before an asynchronous redraw | The old hash write was canceled while the visual checked/collapsed override survived. A changed file could remain hidden; an unchanged file's mark could be lost on reopening. | Transfer pending intent to the new render. Unchanged content persists; changed content opens and clears the stale collapse override. Later uncheck/Expand all wins. |
| Repeated sections of the same path                | The last section overwrote earlier sections in the hash map. Changes to an earlier section could stay hidden as Viewed.                                                        | Hash the ordered collection of all sections. Unique paths keep their previous hash representation.                                                                  |

## Verification

- 878 tests in 46 suites passed, plus TypeScript, ESLint and formatting.
- Real parser/renderer regressions cover delayed checks before redraw, checks during two overlapping payloads, same/changed content, subsequent redraw, rapid check/uncheck/check, uncheck/Expand all before and after transfer, and repeated paths.
- The built browser view-state suite reproduces insertion above the viewport in both layouts and checks text, line position, horizontal offsets and the existing large-diff expansion scenarios. [Report](view-state-1.8.17/view-state-results.json).
- The full desktop control suite records exact bundle hashes and real click/keyboard/menu/clipboard results in [its report](ui-controls-1.8.17/report.json).

## Repeat

```sh
npm test -- --runInBand
npm run build:prod
npx tsc --noEmit -p tsconfig.json
node integration/browser/view-state.cjs /tmp/diff-viewer-view-state
DIFF_UI_AUDIT_PHASE=final node scripts/test-ui-controls-desktop.mjs
```

Use Node.js 22; browser checks require Playwright/Chromium. Desktop checks use an isolated VS Code profile. The synthetic fixtures and test code are saved in the repository; no private user patch is included.
