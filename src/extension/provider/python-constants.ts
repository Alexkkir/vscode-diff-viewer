import { IGrammar, StateStack } from "vscode-textmate";
import { SemanticSpan } from "./semantic-tokens";

// Conservative fallback: color only names bound by module-level ALL_CAPS
// assignments. Reuse the main lexical pass's state instead of rescanning files.
export class PythonConstants {
  private readonly identifiers: Array<{ line: number; start: number; end: number; name: string }> = [];
  private readonly declared = new Set<string>();

  constructor(private readonly grammar: IGrammar) {}

  collect(text: string, number: number, state: StateStack): void {
    const matches = Array.from(text.matchAll(/\b[A-Z][A-Z0-9_]*\b/g));
    if (!matches.length) return;
    const result = this.grammar.tokenizeLine(text, state, 50);
    const isCode = (start: number, end: number) =>
      result.tokens.some(
        (token) =>
          token.startIndex <= start &&
          token.endIndex >= end &&
          !token.scopes.some((scope) => /^(?:string|comment)(?:\.|$)/.test(scope)),
      );
    const binding = /^([A-Z][A-Z0-9_]*)(?:\s*:\s*[^=]+)?\s*=(?!=)/.exec(text);
    if (binding && isCode(0, binding[1].length)) this.declared.add(binding[1]);
    for (const match of matches) {
      const start = match.index!;
      if (text[start - 1] !== "." && isCode(start, start + match[0].length))
        this.identifiers.push({ line: number, start, end: start + match[0].length, name: match[0] });
    }
  }

  spans(): SemanticSpan[] {
    return this.identifiers
      .filter((token) => this.declared.has(token.name))
      .map(({ line, start, end }) => ({ line, start, end, type: "variable", modifiers: ["readonly"] }));
  }
}
