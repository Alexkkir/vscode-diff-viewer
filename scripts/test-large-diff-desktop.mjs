// Build first, then run with Node 22. Uses only a disposable VS Code profile/workspace.
// Optional: DIFF_LARGE_EXTENSION_PATH points to an extracted baseline VSIX's extension directory.
// Private inputs use DIFF_BENCH_FIXTURE and DIFF_BENCH_SCROLL_FIXTURE; no source is written to reports.
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profile = mkdtempSync(join(tmpdir(), "diff-large-desktop-"));
const workspace = join(profile, "workspace");
mkdirSync(workspace);
process.env.DIFF_LARGE_WORKSPACE = workspace;
process.env.DIFF_LARGE_CDP_PORT ||= "9365";
process.env.DIFF_LARGE_OUTPUT ||= join(
  tmpdir(),
  "diff-viewer-large-desktop-" + (process.env.DIFF_LARGE_BASELINE ? "before" : "after"),
);
process.env.DIFF_LARGE_EXTENSION_PATH = resolve(process.env.DIFF_LARGE_EXTENSION_PATH || root);
try {
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
    extensionDevelopmentPath: process.env.DIFF_LARGE_EXTENSION_PATH,
    extensionTestsPath: join(root, "integration/desktop/large-diff.cjs"),
    launchArgs: [
      workspace,
      `--user-data-dir=${join(profile, "user")}`,
      `--extensions-dir=${join(profile, "extensions")}`,
      `--remote-debugging-port=${process.env.DIFF_LARGE_CDP_PORT}`,
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-workspace-trust",
    ],
  });
} finally {
  rmSync(profile, { recursive: true, force: true });
}
