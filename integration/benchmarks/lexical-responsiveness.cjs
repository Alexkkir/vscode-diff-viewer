// Run from the repository with Node 22:
//   node integration/benchmarks/lexical-responsiveness.cjs 50000
// Set VSCODE_BUILTIN_EXTENSIONS to VS Code's built-in extensions directory on
// non-macOS installations. SEMANTICS=off disables the Python constant fallback.
// This uses real Python/TextMate grammars with an extension-host-style API mock;
// it measures lexical work and event-loop responsiveness, not a real webview.
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const repo = path.resolve(__dirname, "../..");
const base =
  process.env.VSCODE_BUILTIN_EXTENSIONS || "/Applications/Visual Studio Code.app/Contents/Resources/app/extensions";
const count = Number(process.argv[2] || 1000);
if (!Number.isSafeInteger(count) || count < 1) throw new Error("The row count must be a positive integer.");

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: "CommonJS", moduleResolution: "node" });
require("ts-node/register/transpile-only");

function uri(value) {
  return { path: value, toString: () => `file://${value}` };
}

const packages = ["python", "theme-defaults"].map((id) => ({
  id: "vscode." + id,
  packageJSON: JSON.parse(fs.readFileSync(path.join(base, id, "package.json"))),
  extensionUri: uri(path.join(base, id)),
}));
const wasm =
  "data:application/wasm;base64," +
  fs.readFileSync(require.resolve("vscode-oniguruma/release/onig.wasm")).toString("base64");
const configuration = {
  colorTheme: "Dark+",
  tokenColorCustomizations: {},
  semanticTokenColorCustomizations: {},
  semanticHighlighting: { enabled: process.env.SEMANTICS !== "off" },
};
const vscode = {
  extensions: { all: packages },
  Uri: { joinPath: (value, ...parts) => uri(path.join(value.path, ...parts)) },
  workspace: {
    getConfiguration: () => ({ get: (key, fallback) => configuration[key] ?? fallback }),
    fs: { readFile: async (value) => fs.promises.readFile(value.path) },
  },
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "vscode") return vscode;
  if (request === "vscode-oniguruma/release/onig.wasm") return wasm;
  return originalLoad.call(this, request, ...rest);
};
const { parse } = require("diff2html");
const { highlightDiffProgressively } = require(path.join(repo, "src/extension/provider/textmate.ts"));

async function run() {
  const source = 'VALUE = compute(VALUE, "value", result)\n'.repeat(count);
  const lines = source.split("\n").filter(Boolean);
  const files = parse(
    `--- a/code.py\n+++ b/code.py\n@@ -0,0 +1,${lines.length} @@\n` + lines.map((line) => `+${line}\n`).join(""),
  );
  let previous = performance.now();
  let maxGap = 0;
  const heartbeat = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - previous);
    previous = now;
  }, 5);
  try {
    const start = performance.now();
    const result = await highlightDiffProgressively(files);
    const elapsed = performance.now() - start;
    // Let the heartbeat observe the last synchronous chunk before measuring
    // serialization separately; outputBytes is not part of the lexical timing.
    await new Promise((resolve) => setTimeout(resolve, 10));
    clearInterval(heartbeat);
    console.log(
      JSON.stringify({
        count,
        bytes: Buffer.byteLength(source),
        elapsed: Math.round(elapsed),
        maxGap: Math.round(maxGap),
        outputBytes: Buffer.byteLength(JSON.stringify(result.syntax)),
      }),
    );
  } finally {
    clearInterval(heartbeat);
    Module._load = originalLoad;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
