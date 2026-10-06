# Contributing

Thanks for contributing to Diff Viewer.

## Prerequisites

- Node.js 22.x
- npm
- VS Code

## Setup

```bash
npm ci
```

The repository declares `engines.node = 22.x` in `package.json`. Using Node 22 locally keeps installs, tests, and webpack output aligned with CI and contributor expectations. The repo also includes `.nvmrc` and `.node-version` set to `22` for local toolchains that read them.

## Common Commands

```bash
npm run build:dev
npm test
npm run test:matching
npm run test:coverage:ci
npm run test:integration:desktop
npm run smoke:web
npm run test:all
npm run lint
npm run format:check
npx tsc --noEmit -p tsconfig.json
```

## Diff Matching Regressions

```bash
npm run test:matching
```

This focused suite runs the real parser, hunk realignment and both renderers. The conversation corpus in `src/shared/testing/conversation-matching-corpus.ts` combines previously reported problems: translated arguments with newly inserted keys, reordered option-name components, imports with removed annotations, guards and returns, and decorated or duplicated classes.

Expected pairs and one-sided rows are handwritten source line numbers, not results copied from the matcher. Each story also runs in reverse and with leading context and different old/new line offsets. Every matching mode must preserve exact source text, ordering and numbering. `lines` and `words` additionally check visual pairs and isolated additions/deletions; `none` deliberately retains positional behavior. In unified output, adjacent rows count as a replacement only when both carry the renderer's change marker. Split output checks that the missing counterpart contains neither a number nor text. Separate verbatim patches check context/hunk barriers.

Add small synthetic examples with explicit `pairs`, `added` and `removed` expectations. Keep private source files and internal paths out of fixtures. Preserve hunk boundaries in tests that exercise those boundaries instead of rebuilding them as one replacement. The focused suite is also part of ordinary `npm test` and the existing CI test jobs.

## Web Smoke Test

```bash
npx playwright install chromium
npm run smoke:web
```

The smoke flow builds the extension, launches VS Code Web, and runs browser-hosted extension tests against sample patch fixtures, including a generated large-diff case.
Playwright's Chromium browser must be installed locally before running the smoke command.

## Desktop Integration Test

```bash
npm run test:integration:desktop
```

The desktop integration flow builds the extension, launches a real Extension Development Host through `@vscode/test-electron`, and verifies activation, custom editor opening, raw-file fallback, collapsed opening, and a configuration-driven rerender.
On headless Linux environments, run it through `xvfb-run -a npm run test:integration:desktop`, which is also how GitHub Actions executes the desktop lane.

## Local Development

- Open the workspace in VS Code.
- Run the extension in an Extension Development Host or use the web smoke flow above for browser-mode coverage.
- Open `.diff` or `.patch` files to exercise the custom editor.

## Pull Requests

- Keep changes focused.
- Add or update tests for behavior changes.
- Run the relevant verification commands before opening a PR. At minimum, mirror the checks affected by your change; for CI parity on Linux, that usually means `npm run format:check`, `npm run test:coverage:ci`, `npm run smoke:web`, and `xvfb-run -a npm run test:integration:desktop`.
