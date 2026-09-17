import { parse } from "diff2html";
import type { DiffFile } from "diff2html/lib/types";
import type { SemanticSpan } from "../semantic-tokens";
import type { FileSyntax } from "../../../shared/syntax";

jest.mock("vscode", () => ({
  extensions: { all: [] },
  Uri: { joinPath: jest.fn() },
  workspace: { getConfiguration: jest.fn(), fs: { readFile: jest.fn() } },
}));
jest.mock("vscode-oniguruma/release/onig.wasm", () => "data:application/wasm;base64,AA==");
jest.mock("vscode-oniguruma", () => ({ loadWASM: jest.fn(async () => undefined) }));
jest.mock("vscode-textmate", () => ({ Registry: jest.fn(), INITIAL: {}, parseRawGrammar: jest.fn() }));
jest.mock("../syntax-source-reader", () => ({ readSyntaxSources: jest.fn() }));
jest.mock("../semantic-tokens", () => ({
  ...jest.requireActual("../semantic-tokens"),
  readSemanticSpans: jest.fn(),
}));

type Source = { uri: ReturnType<typeof uri>; old: string[]; new: string[] };
let highlightDiffProgressively: typeof import("../textmate").highlightDiffProgressively;
let highlightDiff: typeof import("../textmate").highlightDiff;
let readSources: jest.Mock;
let readSemantics: jest.Mock;
let getConfiguration: jest.Mock;
let readFile: jest.Mock;
let createRegistry: jest.Mock;
let tokenize: jest.Mock;
let themeName: string;
let tokenCustom: Record<string, unknown>;
let semanticCustom: Record<string, unknown>;
let semanticEnabled: boolean;
let source: Source | undefined;
let files: DiffFile[];
let installed: Array<Record<string, unknown>>;
let grammarGate: Promise<unknown> | undefined;
const registries: Array<{ loadGrammar: jest.Mock; dispose: jest.Mock }> = [];

function uri(path: string) {
  return { path, toString: () => "file://" + path };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
function fixture(value = "2") {
  files = parse(`--- a/code.py\n+++ b/code.py\n@@ -1,2 +1,2 @@\n import library\n-value = 1\n+value = ${value}\n`);
  source = {
    uri: uri("/project/code.py"),
    old: ["import library", "value = 1"],
    new: ["import library", `value = ${value}`],
  };
}
function at(syntax: Array<FileSyntax | null>, side: "old" | "new", line: number, column: number) {
  return syntax[0]?.[side][line]?.find((token) => token.start <= column && token.end > column)?.color;
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  registries.length = 0;
  themeName = "fixture";
  tokenCustom = {};
  semanticCustom = {};
  semanticEnabled = true;
  grammarGate = undefined;
  fixture();
  const vscode = require("vscode");
  installed = [
    {
      id: "fixture.extension",
      extensionUri: uri("/extension"),
      packageJSON: {
        version: "1",
        contributes: {
          languages: [{ id: "python", extensions: [".py"] }],
          grammars: [{ scopeName: "source.python", language: "python", path: "python.json" }],
          themes: ["fixture", "second", "third"].map((id) => ({ id, path: "theme.json" })),
        },
      },
    },
  ];
  vscode.extensions.all = installed;
  vscode.Uri.joinPath.mockImplementation((base: ReturnType<typeof uri>, path: string) => uri(base.path + "/" + path));
  getConfiguration = vscode.workspace.getConfiguration;
  getConfiguration.mockImplementation(() => ({
    get: (key: string, fallback: unknown) =>
      ({
        colorTheme: themeName,
        tokenColorCustomizations: tokenCustom,
        semanticTokenColorCustomizations: semanticCustom,
        semanticHighlighting: { enabled: semanticEnabled },
      })[key] ?? fallback,
  }));
  readFile = vscode.workspace.fs.readFile;
  readFile.mockImplementation(async () =>
    Buffer.from(
      JSON.stringify({
        semanticHighlighting: true,
        colors: { "editor.foreground": "#808080" },
        semanticTokenColors: { namespace: "#00ff00", "variable.readonly": "#0000ff" },
      }),
    ),
  );
  readSources = require("../syntax-source-reader").readSyntaxSources;
  readSources.mockImplementation(async () => [source]);
  readSemantics = require("../semantic-tokens").readSemanticSpans;
  readSemantics.mockResolvedValue([]);
  tokenize = jest.fn((text: string, state: unknown) => ({ tokens: new Uint32Array([0, 1 << 15]), ruleStack: state }));
  createRegistry = require("vscode-textmate").Registry;
  createRegistry.mockImplementation(() => {
    const grammar = {
      tokenizeLine2: tokenize,
      tokenizeLine: (text: string) => ({
        tokens: [{ startIndex: 0, endIndex: text.length, scopes: ["source.python"] }],
      }),
    };
    const gate = grammarGate;
    grammarGate = undefined;
    const registry = {
      loadGrammar: jest.fn(async () => {
        if (gate) await gate;
        return grammar;
      }),
      getColorMap: () => ["", "#808080"],
      dispose: jest.fn(),
    };
    registries.push(registry);
    return registry;
  });
  ({ highlightDiffProgressively, highlightDiff } = require("../textmate"));
});

it("returns lexical colors while semantic tokens are still pending, then overlays without retokenizing or mutating the first result", async () => {
  const response = deferred<SemanticSpan[]>();
  readSemantics.mockReturnValue(response.promise);

  const initial = await highlightDiffProgressively(files);
  const lexicalJson = JSON.stringify(initial.syntax);
  const tokenizations = tokenize.mock.calls.length;
  expect(at(initial.syntax, "new", 1, 7)).toBe("#808080");
  expect(readSemantics).toHaveBeenCalledTimes(1);
  response.resolve([{ line: 1, start: 7, end: 14, type: "namespace", modifiers: [] }]);

  const enriched = await initial.enriched;
  expect(at(enriched, "new", 1, 7)).toBe("#00ff00");
  expect(at(enriched, "old", 1, 7)).toBe("#00ff00");
  expect(JSON.stringify(initial.syntax)).toBe(lexicalJson);
  expect(tokenize).toHaveBeenCalledTimes(tokenizations);
});

it("never overlays current-source semantic tokens on removed lines", async () => {
  readSemantics.mockResolvedValue([{ line: 2, start: 0, end: 5, type: "namespace", modifiers: [] }]);
  const syntax = await highlightDiff(files);
  expect(at(syntax, "new", 2, 0)).toBe("#00ff00");
  expect(at(syntax, "old", 2, 0)).toBe("#808080");
});

it("reuses lexical work for an exact snapshot but revalidates source and semantic tokens on every call", async () => {
  const first = await highlightDiffProgressively(files);
  const count = tokenize.mock.calls.length;
  const second = await highlightDiffProgressively(files);
  expect(second.syntax).toBe(first.syntax);
  expect(await second.enriched).toBe(second.syntax);
  expect(tokenize).toHaveBeenCalledTimes(count);
  expect(readSources).toHaveBeenCalledTimes(2);
  expect(readSemantics).toHaveBeenCalledTimes(2);
  expect(createRegistry).toHaveBeenCalledTimes(1);
  expect(readFile).toHaveBeenCalledTimes(1);
});

it("retokenizes changed diff/source content using the already loaded registry", async () => {
  await highlightDiff(files);
  const count = tokenize.mock.calls.length;
  fixture("999");
  await highlightDiff(files);
  expect(tokenize.mock.calls.length).toBeGreaterThan(count);
  expect(createRegistry).toHaveBeenCalledTimes(1);
});

it("invalidates an unchanged hunk's lexical cache when preceding source context changes", async () => {
  files = parse("--- a/code.py\n+++ b/code.py\n@@ -2 +2 @@\n-value = 1\n+value = 2\n");
  await highlightDiff(files);
  const count = tokenize.mock.calls.length;
  source = { ...source!, old: ["other context", "value = 1"], new: ["other context", "value = 2"] };
  await highlightDiff(files);
  expect(tokenize.mock.calls.length).toBeGreaterThan(count);
});

it("keeps Python constant fallback in the initial result and respects semantic configuration changes", async () => {
  files = parse("--- a/code.py\n+++ b/code.py\n@@ -1 +1 @@\n-VALUE = 1\n+VALUE = 2\n");
  source = { uri: uri("/project/code.py"), old: ["VALUE = 1"], new: ["VALUE = 2"] };
  const first = await highlightDiffProgressively(files);
  expect(at(first.syntax, "new", 1, 0)).toBe("#0000ff");
  semanticEnabled = false;
  const second = await highlightDiffProgressively(files);
  expect(at(second.syntax, "new", 1, 0)).toBe("#808080");
  semanticEnabled = true;
  semanticCustom = { rules: { "variable.readonly": "#ff0000" } };
  const third = await highlightDiffProgressively(files);
  expect(at(third.syntax, "new", 1, 0)).toBe("#ff0000");
  expect(createRegistry).toHaveBeenCalledTimes(1);
});

it("creates a fresh registry when lexical customizations or installed extension versions change", async () => {
  await highlightDiff(files);
  tokenCustom = { textMateRules: [{ scope: "string", settings: { foreground: "#ff0000" } }] };
  await highlightDiff(files);
  (installed[0].packageJSON as { version: string }).version = "2";
  await highlightDiff(files);
  expect(createRegistry).toHaveBeenCalledTimes(3);
  expect(registries[0].dispose).toHaveBeenCalledTimes(1);
  expect(registries[1].dispose).not.toHaveBeenCalled();
});

it("does not dispose an evicted registry until its concurrent lexical pass completes", async () => {
  const pending = deferred<void>();
  grammarGate = pending.promise;
  const first = highlightDiffProgressively(files);
  await flush();
  expect(registries).toHaveLength(1);
  expect(registries[0].loadGrammar).toHaveBeenCalledTimes(1);
  themeName = "second";
  await highlightDiff(files);
  themeName = "third";
  await highlightDiff(files);
  expect(registries[0].dispose).not.toHaveBeenCalled();
  pending.resolve();
  await first;
  expect(registries[0].dispose).toHaveBeenCalledTimes(1);
});

it("bounds the lexical snapshot cache", async () => {
  for (const value of ["2", "3", "4", "5"]) {
    fixture(value);
    await highlightDiff(files);
  }
  const count = tokenize.mock.calls.length;
  fixture("2");
  await highlightDiff(files);
  expect(tokenize.mock.calls.length).toBeGreaterThan(count);
  expect(createRegistry).toHaveBeenCalledTimes(1);
});

it("preserves lexical colors when a semantic provider fails", async () => {
  readSemantics.mockRejectedValue(new Error("provider unavailable"));
  const first = await highlightDiffProgressively(files);
  expect(await first.enriched).toBe(first.syntax);
});

it("falls back when a source or active theme cannot be resolved", async () => {
  source = undefined;
  const standalone = await highlightDiffProgressively(files);
  expect(standalone.syntax[0]).not.toBeNull();
  expect(readSemantics).not.toHaveBeenCalled();
  themeName = "missing theme";
  const missingTheme = await highlightDiffProgressively(files);
  expect(missingTheme.syntax).toEqual([null]);
  expect(await missingTheme.enriched).toBe(missingTheme.syntax);
});

it("retries an environment after a failed theme read", async () => {
  readFile.mockRejectedValueOnce(new Error("read failed"));
  await expect(highlightDiffProgressively(files)).rejects.toThrow("read failed");
  await expect(highlightDiff(files)).resolves.not.toEqual([null]);
});
