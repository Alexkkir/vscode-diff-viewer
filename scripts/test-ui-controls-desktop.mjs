// Build first: npm run build:prod
// Uses a disposable profile and the installed desktop Code, never the user's profile.
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profile = mkdtempSync(join(tmpdir(), "diff-ui-controls-"));
const workspace = join(profile, "workspace");
mkdirSync(workspace);
process.env.DIFF_UI_WORKSPACE = workspace;
const port = process.env.DIFF_UI_CDP_PORT || "9345";
process.env.DIFF_UI_CDP_PORT = port;
process.env.DIFF_UI_AUDIT_OUTPUT ||= join(
  root,
  "local-builds",
  "ui-controls-" + (process.env.DIFF_UI_AUDIT_PHASE || "audit"),
);
try {
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, "integration/desktop/ui-controls.cjs"),
    launchArgs: [
      workspace,
      `--user-data-dir=${join(profile, "user")}`,
      `--extensions-dir=${join(profile, "extensions")}`,
      `--remote-debugging-port=${port}`,
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-workspace-trust",
    ],
  });
} finally {
  rmSync(profile, { recursive: true, force: true });
}
