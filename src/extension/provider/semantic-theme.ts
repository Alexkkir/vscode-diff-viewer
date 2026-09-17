import type { IRawTheme } from "vscode-textmate";

export type SemanticColorRules = Readonly<Record<string, string | { foreground?: string }>>;

/** Matching theme-specific entries, in setting order; apply them after globals. */
export function matchingThemeCustomizations(
  custom: Record<string, unknown>,
  name: string | undefined,
): Record<string, unknown>[] {
  if (name === undefined) return [];
  const result: Record<string, unknown>[] = [];
  for (const [selector, value] of Object.entries(custom)) {
    if (
      !selector.startsWith("[") ||
      !selector.endsWith("]") ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    )
      continue;
    const matches = Array.from(selector.matchAll(/\[(.+?)\]/g), (match) => match[1]).some((pattern) => {
      // VS Code permits a wildcard at either edge. An interior '*' and regex
      // punctuation are literal parts of the theme name, not a general glob.
      const leading = pattern.startsWith("*");
      const trailing = pattern.endsWith("*");
      const core = pattern.slice(leading ? 1 : 0, trailing ? -1 : undefined);
      const escaped = core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`${leading ? "" : "^"}${escaped}${trailing ? "" : "$"}`).test(name);
    });
    if (matches) result.push(value as Record<string, unknown>);
  }
  return result;
}

// These are the standard VS Code semantic-to-TextMate scope probes. Each
// alternative is tried in order; a more specific semantic selector wins.
const fallbackScopes: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["comment", ["comment"]],
  ["string", ["string"]],
  ["keyword", ["keyword.control"]],
  ["number", ["constant.numeric"]],
  ["regexp", ["constant.regexp"]],
  ["operator", ["keyword.operator"]],
  ["namespace", ["entity.name.namespace"]],
  ["type", ["entity.name.type", "support.type"]],
  ["struct", ["entity.name.type.struct"]],
  ["class", ["entity.name.type.class", "support.class"]],
  ["interface", ["entity.name.type.interface"]],
  ["enum", ["entity.name.type.enum"]],
  ["typeParameter", ["entity.name.type.parameter"]],
  ["function", ["entity.name.function", "support.function"]],
  ["method", ["entity.name.function.member", "support.function"]],
  ["macro", ["entity.name.function.preprocessor"]],
  ["variable", ["variable.other.readwrite", "entity.name.variable"]],
  ["parameter", ["variable.parameter"]],
  ["property", ["variable.other.property"]],
  ["enumMember", ["variable.other.enummember"]],
  ["event", ["variable.other.event"]],
  ["decorator", ["entity.name.decorator", "entity.name.function"]],
  ["variable.readonly", ["variable.other.constant"]],
  ["property.readonly", ["variable.other.constant.property"]],
  ["type.defaultLibrary", ["support.type"]],
  ["class.defaultLibrary", ["support.class"]],
  ["interface.defaultLibrary", ["support.class"]],
  ["variable.defaultLibrary", ["support.variable", "support.other.variable"]],
  ["variable.defaultLibrary.readonly", ["support.constant"]],
  ["property.defaultLibrary", ["support.variable.property"]],
  ["property.defaultLibrary.readonly", ["support.constant.property"]],
  ["function.defaultLibrary", ["support.function"]],
  ["member.defaultLibrary", ["support.function"]],
];

function selectorScore(selector: string, type: string, modifiers: readonly string[], language: string): number {
  const [classification, selectorLanguage, extra] = selector.split(":");
  if (extra !== undefined || (selectorLanguage !== undefined && selectorLanguage !== language)) return -1;
  const [selectorType, ...selectorModifiers] = classification.split(".");
  if (!selectorType || (selectorType !== "*" && selectorType !== type)) return -1;
  if (selectorModifiers.some((modifier) => !modifier || !modifiers.includes(modifier))) return -1;
  return (selectorType === "*" ? 0 : 100) + (selectorLanguage === undefined ? 0 : 10) + selectorModifiers.length * 100;
}

function scopeColor(settings: IRawTheme["settings"], probe: string): string | undefined {
  let result: string | undefined;
  let specificity = -1;
  for (const rule of settings) {
    if (!rule.scope || !rule.settings.foreground) continue;
    const selectors = (Array.isArray(rule.scope) ? rule.scope : [rule.scope]).flatMap((scope) => scope.split(","));
    for (const candidate of selectors) {
      const scope = candidate.trim();
      // The standard fallback probes contain a single scope, so parent-scope
      // selectors cannot match them. Unscoped defaults must not erase TextMate.
      if (scope && (probe === scope || probe.startsWith(scope + ".")) && scope.length >= specificity) {
        specificity = scope.length;
        result = rule.settings.foreground;
      }
    }
  }
  return result;
}

/** Resolve the foreground only; absent styles leave the TextMate token intact. */
export function resolveSemanticColor(
  settings: IRawTheme["settings"],
  ruleLayers: readonly SemanticColorRules[],
  type: string,
  modifiers: readonly string[],
  language: string,
): string | undefined {
  let result: string | undefined;
  let specificity = -1;
  for (const rules of ruleLayers) {
    for (const [selector, style] of Object.entries(rules)) {
      const foreground = typeof style === "string" ? style : style?.foreground;
      const score = selectorScore(selector, type, modifiers, language);
      if (foreground && score >= 0 && score >= specificity) {
        specificity = score;
        result = foreground;
      }
    }
  }
  if (result !== undefined) return result;

  for (const [selector, probes] of fallbackScopes) {
    const score = selectorScore(selector, type, modifiers, language);
    if (score < 0 || score < specificity) continue;
    for (const probe of probes) {
      const foreground = scopeColor(settings, probe);
      if (foreground !== undefined) {
        specificity = score;
        result = foreground;
        break;
      }
    }
  }
  return result;
}
