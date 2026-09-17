import * as vscode from "vscode";
import { SyntaxToken } from "../../shared/syntax";

export interface SemanticSpan {
  line: number;
  start: number;
  end: number;
  type: string;
  modifiers: string[];
}
export interface SemanticSource {
  uri: vscode.Uri;
  new: string[];
}
const pending = new Map<
  string,
  { document: vscode.TextDocument; version: number; text: string; time: number; result: Promise<SemanticSpan[]> }
>();

async function bounded<T>(promise: PromiseLike<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    Promise.resolve(promise),
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), 1200);
    }),
  ]).finally(() => clearTimeout(timer));
}

function currentText(document: vscode.TextDocument): string {
  return document.getText().replace(/\r\n/g, "\n").replace(/\n$/, "");
}

function enabled(document: vscode.TextDocument): boolean {
  return (
    vscode.workspace
      .getConfiguration("editor", { uri: document.uri, languageId: document.languageId })
      .get("semanticHighlighting.enabled") !== false
  );
}

// Request token classifications only; no diagnostics are read or rendered in the webview.
export async function readSemanticSpans(source: SemanticSource): Promise<SemanticSpan[]> {
  return bounded(
    (async () => {
      const key = source.uri.toString();
      const text = source.new.join("\n");
      const document = await vscode.workspace.openTextDocument(source.uri);
      // Disk content alone cannot validate cached tokens: the open editor may contain unsaved edits.
      if (document.isClosed || currentText(document) !== text || !enabled(document)) return [];
      const version = document.version;
      let cached = pending.get(key);
      if (
        !cached ||
        cached.document !== document ||
        cached.version !== version ||
        cached.text !== text ||
        Date.now() - cached.time >= 5000
      ) {
        const result = bounded(
          (async () => {
            const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>(
              "vscode.provideDocumentSemanticTokensLegend",
              source.uri,
            );
            if (!legend || document.version !== version || document.isClosed) return [];
            const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
              "vscode.provideDocumentSemanticTokens",
              source.uri,
            );
            if (!tokens) return [];
            const spans: SemanticSpan[] = [];
            let line = 0;
            let start = 0;
            for (let i = 0; i + 4 < tokens.data.length; i += 5) {
              const [deltaLine, deltaStart, length, type, flags] = tokens.data.slice(i, i + 5);
              line += deltaLine;
              start = deltaLine ? deltaStart : start + deltaStart;
              if (!legend.tokenTypes[type] || !length || start + length > (source.new[line]?.length ?? 0)) continue;
              spans.push({
                line: line + 1,
                start,
                end: start + length,
                type: legend.tokenTypes[type],
                modifiers: legend.tokenModifiers.filter((_, bit) => bit < 32 && (flags & (1 << bit)) !== 0),
              });
            }
            return spans;
          })().catch(() => []),
          [],
        );
        cached = { document, version, text, time: Date.now(), result };
        if (pending.size >= 32) pending.delete(pending.keys().next().value!);
        pending.set(key, cached);
      }
      const result = await cached.result;
      if (document.isClosed || document.version !== version || currentText(document) !== text || !enabled(document)) {
        if (pending.get(key) === cached) pending.delete(key);
        return [];
      }
      return result;
    })().catch(() => []),
    [],
  );
}

export function overlayTokenColor(tokens: SyntaxToken[], start: number, end: number, color: string): SyntaxToken[] {
  if (start >= end) return tokens;
  return tokens.flatMap((token) => {
    if (token.end <= start || token.start >= end) return [token];
    return [
      ...(token.start < start ? [{ ...token, end: start }] : []),
      { ...token, start: Math.max(token.start, start), end: Math.min(token.end, end), color },
      ...(token.end > end ? [{ ...token, start: end }] : []),
    ];
  });
}
