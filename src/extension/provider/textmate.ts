import { readSyntaxSources } from "./syntax-source-reader";
import { pythonHunkPrefix } from "./syntax-context";
import { PythonConstants } from "./python-constants";
import { readSemanticSpans, overlayTokenColor, SemanticSpan } from "./semantic-tokens";
import { resolveSemanticColor, SemanticColorRules, matchingThemeCustomizations } from "./semantic-theme";
import * as vscode from "vscode";
import { parse as parseJson } from "jsonc-parser";
import { Registry, parseRawGrammar, INITIAL, IRawTheme, StateStack } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import { DiffFile, LineType } from "diff2html/lib/types";
import { FileSyntax } from "../../shared/syntax";
import wasm from "vscode-oniguruma/release/onig.wasm";

const onig = loadWASM(Uint8Array.from(atob(wasm.split(",")[1]), (c) => c.charCodeAt(0)).buffer).then(() => ({
  createOnigScanner: (patterns: string[]) => new OnigScanner(patterns),
  createOnigString: (text: string) => new OnigString(text),
}));
function fileSuffix(file: DiffFile): string {
  return "." + file.language.toLowerCase();
}
function languageExtensions(installed: readonly vscode.Extension<unknown>[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const extension of installed)
    for (const language of extension.packageJSON.contributes?.languages ?? [])
      for (const suffix of language.extensions ?? []) result.set(suffix.toLowerCase(), language.id);
  return result;
}
async function readJson(uri: vscode.Uri): Promise<Record<string, unknown>> {
  return parseJson(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
}
interface ThemeRules {
  settings: IRawTheme["settings"];
  semantics: SemanticColorRules[];
  enabled: boolean;
}
async function themeRules(uri: vscode.Uri, seen = new Set<string>()): Promise<ThemeRules> {
  if (seen.has(uri.toString())) return { settings: [], semantics: [], enabled: false };
  seen.add(uri.toString());
  const theme = await readJson(uri);
  const parent =
    typeof theme.include === "string"
      ? await themeRules(vscode.Uri.joinPath(uri, "..", theme.include), seen)
      : { settings: [], semantics: [], enabled: false };
  const colors = theme.colors as Record<string, string> | undefined;
  return {
    settings: [
      ...parent.settings,
      ...(colors?.["editor.foreground"] ? [{ settings: { foreground: colors["editor.foreground"] } }] : []),
      ...(Array.isArray(theme.tokenColors) ? theme.tokenColors : []),
    ],
    semantics: [...parent.semantics, (theme.semanticTokenColors ?? {}) as SemanticColorRules],
    enabled: typeof theme.semanticHighlighting === "boolean" ? theme.semanticHighlighting : parent.enabled,
  };
}

interface ThemeSnapshot {
  key: string;
  name: string | undefined;
  custom: Record<string, unknown>;
  installed: readonly vscode.Extension<unknown>[];
}
interface HighlightEnvironment {
  registry: Registry;
  theme: ThemeRules;
  languages: Map<string, string>;
  extensions: Map<string, string>;
}

// Match the named editor.tokenColorCustomizations groups before applying the
// explicit TextMate rules, as the editor does for global and theme overrides.
const tokenColorGroups: Readonly<Record<string, string[]>> = {
  comments: ["comment", "punctuation.definition.comment"],
  strings: ["string", "meta.embedded.assembly"],
  keywords: ["keyword - keyword.operator", "keyword.control", "storage", "storage.type"],
  numbers: ["constant.numeric"],
  types: ["entity.name.type", "entity.name.class", "support.type", "support.class"],
  functions: ["entity.name.function", "support.function"],
  variables: ["variable", "entity.name.variable"],
};

function customTokenRules(custom: Record<string, unknown>): IRawTheme["settings"] {
  const settings: IRawTheme["settings"] = [];
  for (const [group, scopes] of Object.entries(tokenColorGroups)) {
    const value = custom[group];
    const style = typeof value === "string" ? { foreground: value } : value;
    if (style && typeof style === "object" && !Array.isArray(style)) settings.push({ scope: scopes, settings: style });
  }
  if (Array.isArray(custom.textMateRules)) settings.push(...custom.textMateRules);
  return settings;
}
interface EnvironmentEntry {
  promise: Promise<HighlightEnvironment | undefined>;
  users: number;
  retired: boolean;
  disposed: boolean;
}

function themeSnapshot(): ThemeSnapshot {
  const name = vscode.workspace.getConfiguration("workbench").get<string>("colorTheme");
  const custom = vscode.workspace
    .getConfiguration("editor")
    .get<Record<string, unknown>>("tokenColorCustomizations", {});
  const installed = [...vscode.extensions.all];
  const key = JSON.stringify([
    name,
    custom,
    installed.map((e) => [e.id, e.packageJSON.version, e.extensionUri.toString()]),
  ]);
  return { key, name, custom, installed };
}

async function createEnvironment(snapshot: ThemeSnapshot): Promise<HighlightEnvironment | undefined> {
  const { name, custom, installed } = snapshot;
  const grammars = new Map<string, vscode.Uri>();
  const languages = new Map<string, string>();
  const extensions = languageExtensions(installed);
  let selectedTheme: vscode.Uri | undefined;
  for (const extension of installed) {
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
  }
  if (!selectedTheme) return undefined;
  const scoped = matchingThemeCustomizations(custom, name);
  const theme = await themeRules(selectedTheme);
  const settings = theme.settings;
  settings.push(...customTokenRules(custom));
  // Group values use the last matching theme entry, while textMateRules are
  // concatenated across matching entries in their configured order.
  const themeCustom = Object.assign({}, ...scoped);
  themeCustom.textMateRules = scoped.flatMap((entry) =>
    Array.isArray(entry.textMateRules) ? entry.textMateRules : [],
  );
  settings.push(...customTokenRules(themeCustom));
  const registry = new Registry({
    onigLib: onig,
    theme: { settings },
    loadGrammar: async (scope) => {
      const uri = grammars.get(scope);
      return uri ? parseRawGrammar(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)), uri.path) : null;
    },
  });
  return { registry, theme, languages, extensions };
}

// Keep the expensive loaded grammar/Oniguruma scanners between rewrites. An
// evicted registry stays alive until its in-flight lexical passes have finished.
const environments = new Map<string, EnvironmentEntry>();
function disposeRetiredEnvironment(entry: EnvironmentEntry): void {
  if (!entry.retired || entry.users || entry.disposed) return;
  entry.disposed = true;
  void entry.promise.then(
    (value) => value?.registry.dispose(),
    () => undefined,
  );
}
function acquireEnvironment(snapshot: ThemeSnapshot): EnvironmentEntry {
  let entry = environments.get(snapshot.key);
  if (entry) environments.delete(snapshot.key);
  else {
    entry = { promise: createEnvironment(snapshot), users: 0, retired: false, disposed: false };
    const created = entry;
    void entry.promise.catch(() => {
      if (environments.get(snapshot.key) === created) environments.delete(snapshot.key);
      created.retired = true;
      disposeRetiredEnvironment(created);
    });
  }
  entry.users++;
  environments.set(snapshot.key, entry);
  while (environments.size > 2) {
    const oldest = environments.keys().next().value!;
    const retired = environments.get(oldest)!;
    environments.delete(oldest);
    retired.retired = true;
    disposeRetiredEnvironment(retired);
  }
  return entry;
}

interface EditorSettings {
  highlighting: { enabled?: boolean | string } | undefined;
  custom: Record<string, unknown>;
}
interface FileSemantics {
  enabled: boolean;
  language: string;
  settings: IRawTheme["settings"];
  rules: SemanticColorRules[];
  unchanged: Map<number, number>;
  colors: Map<string, string | undefined>;
}
interface PreparedSyntax {
  syntax: Array<FileSyntax | null>;
  semantics: Array<FileSemantics | undefined>;
}

function applySemanticSpan(
  highlighted: FileSyntax,
  semantics: FileSemantics,
  side: "old" | "new",
  span: SemanticSpan,
  number = span.line,
): boolean {
  const tokens = highlighted[side][number];
  if (!tokens) return false;
  const key = JSON.stringify([span.type, span.modifiers]);
  if (!semantics.colors.has(key))
    semantics.colors.set(
      key,
      resolveSemanticColor(semantics.settings, semantics.rules, span.type, span.modifiers, semantics.language),
    );
  const color = semantics.colors.get(key);
  if (!color || !tokens.some((token) => token.start < span.end && token.end > span.start && token.color !== color))
    return false;
  highlighted[side][number] = overlayTokenColor(tokens, span.start, span.end, color);
  return true;
}

// Lexical state covers the full reconstructed source, including folded context.
// Slow language-server tokens can subsequently enrich this immutable snapshot.
async function highlightLexically(
  files: DiffFile[],
  sources: Awaited<ReturnType<typeof readSyntaxSources>>,
  environment: HighlightEnvironment,
  name: string | undefined,
  editors: EditorSettings[],
  isCurrent: () => boolean,
): Promise<PreparedSyntax> {
  const { registry, theme, languages, extensions } = environment;
  const result: PreparedSyntax = { syntax: [], semantics: [] };
  let yieldedAt = Date.now();
  const assertCurrent = () => {
    if (!isCurrent()) throw new Error("Obsolete syntax request");
  };
  const yieldIfNeeded = (): Promise<void> | undefined => {
    if (Date.now() - yieldedAt < 8) return;
    assertCurrent();
    return new Promise<void>((resolve) => setTimeout(resolve, 0)).then(() => {
      assertCurrent();
      yieldedAt = Date.now();
    });
  };
  for (const [fileIndex, file] of files.entries()) {
    assertCurrent();
    const language = extensions.get(fileSuffix(file)) ?? "";
    const scope = languages.get(language);
    const grammar = scope ? await registry.loadGrammar(scope).catch(() => null) : null;
    assertCurrent();
    if (!grammar) {
      result.syntax.push(null);
      result.semantics.push(undefined);
      continue;
    }
    const highlighted: FileSyntax = { old: {}, new: {} };
    const semanticCustom = editors[fileIndex].custom;
    const semanticScoped = Object.assign({}, ...matchingThemeCustomizations(semanticCustom, name)) as Record<
      string,
      unknown
    >;
    const configured = editors[fileIndex].highlighting?.enabled;
    const semanticEnabled =
      typeof configured === "boolean"
        ? configured
        : (semanticScoped?.enabled ?? semanticCustom.enabled ?? theme.enabled);
    const ruleLayers = [
      ...theme.semantics,
      semanticCustom.rules ?? {},
      semanticScoped?.rules ?? {},
    ] as SemanticColorRules[];
    const semantics: FileSemantics = {
      enabled: !!semanticEnabled,
      language,
      settings: theme.settings,
      rules: ruleLayers,
      unchanged: new Map(),
      colors: new Map(),
    };
    for (const side of ["old", "new"] as const) {
      let state: StateStack = INITIAL;
      const constants = semanticEnabled && language === "python" ? new PythonConstants(grammar) : undefined;
      const emit = (text: string, number: number, visible: boolean) => {
        constants?.collect(text, number, state);
        const tokenized = grammar.tokenizeLine2(text, state, 50);
        state = tokenized.ruleStack;
        if (!visible) return;
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
      };
      const fullSource = sources[fileIndex]?.[side];
      if (fullSource) {
        const visibleLines = new Set(
          file.blocks.flatMap((block) =>
            block.lines
              .map((line) => (side === "old" ? line.oldNumber : line.newNumber))
              .filter((number): number is number => number !== undefined),
          ),
        );
        let last = 0;
        for (const number of visibleLines) last = Math.max(last, number);
        for (let index = 0; index < last; index++) {
          emit(fullSource[index], index + 1, visibleLines.has(index + 1));
          const pause = yieldIfNeeded();
          if (pause) await pause;
        }
      } else {
        const prefixLength = file.isCombined ? 2 : 1;
        let previous = -1;
        for (const block of file.blocks) {
          const lines = block.lines.filter((line) => (side === "old" ? line.oldNumber : line.newNumber) !== undefined);
          const first = lines[0] && (side === "old" ? lines[0].oldNumber : lines[0].newNumber);
          if (first !== previous + 1) {
            state = INITIAL;
            const prefix =
              first && first > 1 && scope === "source.python"
                ? pythonHunkPrefix(lines.map((line) => line.content.slice(prefixLength)))
                : undefined;
            if (prefix) state = grammar.tokenizeLine2(prefix, INITIAL).ruleStack;
          }
          for (const line of lines) {
            const number = (side === "old" ? line.oldNumber : line.newNumber)!;
            emit(line.content.slice(prefixLength), number, true);
            previous = number;
            const pause = yieldIfNeeded();
            if (pause) await pause;
          }
        }
      }
      for (const span of constants?.spans() ?? []) {
        applySemanticSpan(highlighted, semantics, side, span);
        const pause = yieldIfNeeded();
        if (pause) await pause;
      }
    }
    if (semanticEnabled) {
      for (const block of file.blocks)
        for (const line of block.lines)
          if (line.type === LineType.CONTEXT && line.oldNumber !== undefined && line.newNumber !== undefined)
            semantics.unchanged.set(line.newNumber, line.oldNumber);
    }
    result.syntax.push(highlighted);
    result.semantics.push(semantics);
  }
  return result;
}

function enrichSyntax(prepared: PreparedSyntax, semanticSpans: SemanticSpan[][]): Array<FileSyntax | null> {
  let result = prepared.syntax;
  for (const [index, syntax] of prepared.syntax.entries()) {
    const semantics = prepared.semantics[index];
    if (!syntax || !semantics?.enabled || !semanticSpans[index].length) continue;
    const highlighted = { old: { ...syntax.old }, new: { ...syntax.new } };
    let changed = false;
    for (const span of semanticSpans[index]) {
      changed = applySemanticSpan(highlighted, semantics, "new", span) || changed;
      const oldNumber = semantics.unchanged.get(span.line);
      if (oldNumber !== undefined)
        changed = applySemanticSpan(highlighted, semantics, "old", span, oldNumber) || changed;
    }
    if (changed) {
      if (result === prepared.syntax) result = [...prepared.syntax];
      result[index] = highlighted;
    }
  }
  return result;
}

// Small exact-snapshot cache: focus/layout changes do not retokenize identical
// sources. Large patches remain bounded rather than retaining multiple token trees.
const lexicalCache = new Map<string, PreparedSyntax>();
export interface ProgressiveSyntax {
  syntax: Array<FileSyntax | null>;
  enriched: Promise<Array<FileSyntax | null>>;
}
export async function highlightDiffProgressively(
  files: DiffFile[],
  diffUri?: vscode.Uri,
  isCurrent: () => boolean = () => true,
): Promise<ProgressiveSyntax> {
  const snapshot = themeSnapshot();
  const entry = acquireEnvironment(snapshot);
  try {
    const [sources, environment] = await Promise.all([readSyntaxSources(files, diffUri), entry.promise]);
    if (!isCurrent()) throw new Error("Obsolete syntax request");
    if (!environment) {
      const syntax = files.map(() => null);
      return { syntax, enriched: Promise.resolve(syntax) };
    }
    const editors = files.map((file, index): EditorSettings => {
      const editor = vscode.workspace.getConfiguration("editor", {
        uri: sources[index]?.uri,
        languageId: environment.extensions.get(fileSuffix(file)) ?? "",
      });
      return {
        highlighting: editor.get("semanticHighlighting"),
        custom: editor.get("semanticTokenColorCustomizations", {}),
      };
    });
    const semanticSpans = Promise.all(
      sources.map((source) => (source ? readSemanticSpans(source).catch(() => []) : Promise.resolve([]))),
    );
    const key = JSON.stringify([
      snapshot.key,
      files,
      sources.map((source) => source && [source.uri.toString(), source.old, source.new]),
      editors,
    ]);
    let prepared = lexicalCache.get(key);
    if (prepared) lexicalCache.delete(key);
    else prepared = await highlightLexically(files, sources, environment, snapshot.name, editors, isCurrent);
    if (!isCurrent()) throw new Error("Obsolete syntax request");
    if (key.length <= 1024 * 1024) {
      lexicalCache.set(key, prepared);
      while (lexicalCache.size > 3) lexicalCache.delete(lexicalCache.keys().next().value!);
    }
    return {
      syntax: prepared.syntax,
      enriched: semanticSpans.then((spans) => (isCurrent() ? enrichSyntax(prepared, spans) : prepared.syntax)),
    };
  } finally {
    entry.users--;
    disposeRetiredEnvironment(entry);
  }
}

// Compatibility for callers that explicitly require the final semantic colors.
export async function highlightDiff(files: DiffFile[], diffUri?: vscode.Uri): Promise<Array<FileSyntax | null>> {
  return (await highlightDiffProgressively(files, diffUri)).enriched;
}
