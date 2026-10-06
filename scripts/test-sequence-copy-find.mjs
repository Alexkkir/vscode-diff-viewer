// Disposable VS Code profile for sequential clipboard, keyboard-menu and Find probes.
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profile = mkdtempSync(join(tmpdir(), "diff-sequence-copy-find-"));
const workspace = join(profile, "workspace");
mkdirSync(workspace);
process.env.DIFF_SEQUENCE_WORKSPACE = workspace;
process.env.DIFF_SEQUENCE_PORT ||= "9356";
process.env.DIFF_SEQUENCE_OUTPUT ||= join(root, "local-builds", "sequence-copy-find-audit");
try {
  await runTests({
    vscodeExecutablePath: "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, "integration/desktop/sequence-copy-find.cjs"),
    launchArgs: [
      workspace,
      `--user-data-dir=${join(profile, "user")}`,
      `--extensions-dir=${join(profile, "extensions")}`,
      `--remote-debugging-port=${process.env.DIFF_SEQUENCE_PORT}`,
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-workspace-trust",
    ],
  });
} finally {
  rmSync(profile, { recursive: true, force: true });
}
