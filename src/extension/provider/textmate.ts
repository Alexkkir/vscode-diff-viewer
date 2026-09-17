import * as vscode from "vscode";
import { parse as parseJson } from "jsonc-parser";
import { Registry, parseRawGrammar, INITIAL, IRawTheme, StateStack } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import { DiffFile } from "diff2html/lib/types";
import { FileSyntax } from "../../shared/syntax";
import wasm from "vscode-oniguruma/release/onig.wasm";

const onig = loadWASM(Uint8Array.from(atob(wasm.split(",")[1]), (c) => c.charCodeAt(0)).buffer).then(() => ({
  createOnigScanner: (patterns: string[]) => new OnigScanner(patterns),
  createOnigString: (text: string) => new OnigString(text),
}));
async function readJson(uri: vscode.Uri): Promise<Record<string, unknown>> {
  return parseJson(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
}
async function themeRules(uri: vscode.Uri, seen = new Set<string>()): Promise<IRawTheme["settings"]> {
  if (seen.has(uri.toString())) return [];
  seen.add(uri.toString());
  const theme = await readJson(uri);
  const parent =
    typeof theme.include === "string" ? await themeRules(vscode.Uri.joinPath(uri, "..", theme.include), seen) : [];
  const colors = theme.colors as Record<string, string> | undefined;
  return [
    ...parent,
    ...(colors?.["editor.foreground"] ? [{ settings: { foreground: colors["editor.foreground"] } }] : []),
    ...(Array.isArray(theme.tokenColors) ? theme.tokenColors : []),
  ];
}

// Uses installed TextMate grammars and token theme rules only. No language server
// or diagnostics are requested, and incomplete diff hunks remain valid input.
async function highlightDiffUncached(files: DiffFile[]): Promise<Array<FileSyntax | null>> {
  const name = vscode.workspace.getConfiguration("workbench").get<string>("colorTheme");
  const grammars = new Map<string, vscode.Uri>();
  const languages = new Map<string, string>();
  const extensions = new Map<string, string>();
  let selectedTheme: vscode.Uri | undefined;
  for (const extension of vscode.extensions.all) {
    const contributes = extension.packageJSON.contributes;
    for (const theme of contributes?.themes ?? []) {
      if (
        theme.id === name ||
        theme.label === name ||
        (extension.id === "vscode.theme-defaults" && theme.id === name?.replace(/^Default /, ""))
      )
        selectedTheme = vscode.Uri.joinPath(extension.extensionUri, theme.path);
    }
    for (const grammar of contributes?.grammars ?? []) {
      grammars.set(grammar.scopeName, vscode.Uri.joinPath(extension.extensionUri, grammar.path));
      if (grammar.language) languages.set(grammar.language, grammar.scopeName);
    }
    for (const language of contributes?.languages ?? []) {
      for (const suffix of language.extensions ?? []) extensions.set(suffix.toLowerCase(), language.id);
    }
  }
  if (!selectedTheme) return files.map(() => null);
  const custom = vscode.workspace
    .getConfiguration("editor")
    .get<Record<string, unknown>>("tokenColorCustomizations", {});
  const scoped = custom[`[${name}]`] as Record<string, unknown> | undefined;
  const settings = await themeRules(selectedTheme);
  for (const rules of [custom.textMateRules, scoped?.textMateRules]) if (Array.isArray(rules)) settings.push(...rules);
  const registry = new Registry({
    onigLib: onig,
    theme: { settings },
    loadGrammar: async (scope) => {
      const uri = grammars.get(scope);
      return uri ? parseRawGrammar(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)), uri.path) : null;
    },
  });
  try {
    const result: Array<FileSyntax | null> = [];
    for (const file of files) {
      const suffix = "." + file.language.replace(/[ \t]+\((?:working tree|[a-f0-9]{7,64})\)$/i, "").toLowerCase();
      const scope = languages.get(extensions.get(suffix) ?? "");
      const grammar = scope ? await registry.loadGrammar(scope).catch(() => null) : null;
      if (!grammar) {
        result.push(null);
        continue;
      }
      const highlighted: FileSyntax = { old: {}, new: {} };
      for (const side of ["old", "new"] as const) {
        let state: StateStack = INITIAL;
        let previous = -1;
        for (const block of file.blocks)
          for (const line of block.lines) {
            const number = side === "old" ? line.oldNumber : line.newNumber;
            if (number === undefined) continue;
            if (number !== previous + 1) state = INITIAL;
            const text = line.content.slice(1);
            const tokenized = grammar.tokenizeLine2(text, state, 50);
            state = tokenized.ruleStack;
            previous = number;
            const colors = registry.getColorMap();
            const tokens = tokenized.tokens;
            highlighted[side][number] = [];
            for (let i = 0; i < tokens.length; i += 2)
              highlighted[side][number].push({
                start: tokens[i],
                end: i + 2 < tokens.length ? tokens[i + 2] : text.length,
                color: colors[(tokens[i + 1] >>> 15) & 511],
                fontStyle: (tokens[i + 1] >>> 11) & 15,
              });
          }
      }
      result.push(highlighted);
    }
    return result;
  } finally {
    registry.dispose();
  }
}

let cachedKey = "";
let cachedResult: Promise<Array<FileSyntax | null>> | undefined;
export function highlightDiff(files: DiffFile[]): Promise<Array<FileSyntax | null>> {
  const key = JSON.stringify([
    files,
    vscode.workspace.getConfiguration("workbench").get("colorTheme"),
    vscode.workspace.getConfiguration("editor").get("tokenColorCustomizations"),
    vscode.extensions.all.map((e) => [e.id, e.packageJSON.version]),
  ]);
  if (key !== cachedKey || !cachedResult) {
    cachedKey = key;
    cachedResult = highlightDiffUncached(files).catch((error) => {
      cachedResult = undefined;
      throw error;
    });
  }
  return cachedResult;
}
