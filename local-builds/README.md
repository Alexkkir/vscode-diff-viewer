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
