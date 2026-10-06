// Build first. VSCODE_EXECUTABLE can point at an installed VS Code binary.
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profile = mkdtempSync(join(tmpdir(), "diff-viewer-review-"));
const workspace = join(profile, "workspace");
mkdirSync(workspace);
await runTests({
  vscodeExecutablePath: process.env.VSCODE_EXECUTABLE,
  extensionDevelopmentPath: root,
  extensionTestsPath: join(root, "integration/desktop/review-regressions.cjs"),
  launchArgs: [
    workspace,
    `--user-data-dir=${join(profile, "user")}`,
    `--extensions-dir=${join(profile, "extensions")}`,
    "--disable-extensions",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-workspace-trust",
  ],
});
