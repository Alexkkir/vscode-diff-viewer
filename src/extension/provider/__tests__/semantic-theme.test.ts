import type { IRawTheme } from "vscode-textmate";
import { matchingThemeCustomizations, resolveSemanticColor } from "../semantic-theme";

const darkPlus: IRawTheme["settings"] = [
  { settings: { foreground: "#D4D4D4" } },
  { scope: "variable, entity.name.variable", settings: { foreground: "#9CDCFE" } },
  { scope: ["variable.other.constant", "variable.other.enummember"], settings: { foreground: "#4FC1FF" } },
  { scope: ["entity.name.type", "entity.name.namespace", "support.class"], settings: { foreground: "#4EC9B0" } },
];

describe("matchingThemeCustomizations", () => {
  it("matches combined theme names and preserves setting order after globals", () => {
    const broad = { enabled: false };
    const combined = { rules: { variable: "#010101" } };
    const exact = { rules: { variable: "#020202" } };
    const custom = {
      enabled: true,
      rules: { variable: "#030303" },
      "[*Dark*]": broad,
      "[Default Light+][Default Dark+]": combined,
      "[Default Dark+]": exact,
      "[Unrelated]": { enabled: true },
    };
    expect(matchingThemeCustomizations(custom, "Default Dark+")).toEqual([broad, combined, exact]);
    expect(matchingThemeCustomizations(custom, undefined)).toEqual([]);
  });

  it("supports leading, trailing and surrounding wildcards without interpreting regex punctuation", () => {
    const all = {};
    const prefix = {};
    const suffix = {};
    const contains = {};
    const custom = {
      "[*]": all,
      "[Theme (Dark+)*]": prefix,
      "[*Dark+]": suffix,
      "[*Theme (Dark+)*]": contains,
      "[Theme (Dark.)]": { enabled: false },
      "[Theme*Dark+]": { enabled: false },
    };
    expect(matchingThemeCustomizations(custom, "Theme (Dark+) Extra")).toEqual([all, prefix, contains]);
    expect(matchingThemeCustomizations(custom, "Other Dark+")).toEqual([all, suffix]);
    expect(matchingThemeCustomizations(custom, "ThemeZZDark+")).toEqual([all, suffix]);
  });

  it("ignores malformed or non-object entries and matches a combined entry once", () => {
    const combined = { textMateRules: [] };
    expect(
      matchingThemeCustomizations(
        {
          "[*Dark*][Default Dark+]": combined,
          "[Default Dark+]": null,
          "[Dark+]": [],
          "[Default Dark+": {},
          "Default Dark+]": {},
          "[]": {},
        },
        "Default Dark+",
      ),
    ).toEqual([combined]);
  });
});

describe("resolveSemanticColor", () => {
  it("uses the theme's constant and namespace colors for semantic classifications", () => {
    expect(resolveSemanticColor(darkPlus, [], "variable", ["readonly", "declaration"], "python")).toBe("#4FC1FF");
    expect(resolveSemanticColor(darkPlus, [], "variable", [], "python")).toBe("#9CDCFE");
    expect(resolveSemanticColor(darkPlus, [], "namespace", [], "python")).toBe("#4EC9B0");
    expect(resolveSemanticColor(darkPlus, [], "class", [], "python")).toBe("#4EC9B0");
  });

  it("keeps TextMate colors when no semantic or scoped fallback foreground is available", () => {
    expect(
      resolveSemanticColor([{ settings: { foreground: "#D4D4D4" } }], [], "variable", [], "python"),
    ).toBeUndefined();
    expect(resolveSemanticColor(darkPlus, [], "unknownCustomType", [], "python")).toBeUndefined();
    expect(resolveSemanticColor([], [{ variable: {} }], "variable", [], "python")).toBeUndefined();
  });

  it("lets explicit semantic colors override even more specific TextMate fallbacks", () => {
    expect(resolveSemanticColor(darkPlus, [{ "*": "#112233" }], "variable", ["readonly"], "python")).toBe("#112233");
  });

  it("matches type, modifiers and language using VS Code specificity", () => {
    const rules = {
      "variable.readonly:python": "#010101",
      "variable.readonly": "#020202",
      "*.readonly:python": "#030303",
      "variable:python": "#040404",
      "*": "#050505",
    };
    expect(resolveSemanticColor([], [rules], "variable", ["readonly", "declaration"], "python")).toBe("#010101");
    expect(resolveSemanticColor([], [rules], "variable", ["readonly"], "typescript")).toBe("#020202");
    expect(resolveSemanticColor([], [rules], "property", ["readonly"], "python")).toBe("#030303");
    expect(resolveSemanticColor([], [rules], "variable", [], "python")).toBe("#040404");
    expect(resolveSemanticColor([], [rules], "class", [], "python")).toBe("#050505");
  });

  it("uses later customization layers on equal specificity, without discarding a more specific theme rule", () => {
    const theme = { "variable.readonly": "#010101", namespace: "#020202" };
    const custom = { variable: "#030303", namespace: { foreground: "#040404" } };
    expect(resolveSemanticColor([], [theme, custom], "variable", ["readonly"], "python")).toBe("#010101");
    expect(resolveSemanticColor([], [theme, custom], "namespace", [], "python")).toBe("#040404");
    expect(
      resolveSemanticColor([], [{ variable: "#010101", "*.readonly": "#020202" }], "variable", ["readonly"], "python"),
    ).toBe("#020202");
  });

  it("does not let foreground-less customizations erase a theme foreground", () => {
    expect(
      resolveSemanticColor(
        [],
        [{ variable: "#010101" }, { "variable.readonly": {} }],
        "variable",
        ["readonly"],
        "python",
      ),
    ).toBe("#010101");
  });

  it("prefers more specific TextMate scopes and later equal matches in comma or array selectors", () => {
    const settings: IRawTheme["settings"] = [
      ...darkPlus,
      { scope: "variable.other.constant, unrelated.scope", settings: { foreground: "#010101" } },
      { scope: ["variable"], settings: { foreground: "#020202" } },
    ];
    expect(resolveSemanticColor(settings, [], "variable", ["readonly"], "python")).toBe("#010101");
  });

  it("tries ordered fallback scopes and handles default-library constants", () => {
    const settings: IRawTheme["settings"] = [
      ...darkPlus,
      { scope: "support.function", settings: { foreground: "#010101" } },
      { scope: "support.constant", settings: { foreground: "#020202" } },
    ];
    expect(resolveSemanticColor(settings, [], "function", [], "python")).toBe("#010101");
    expect(resolveSemanticColor(settings, [], "variable", ["readonly", "defaultLibrary"], "python")).toBe("#020202");
  });

  it("does not confuse scope name prefixes or parent selectors with a matching fallback", () => {
    const settings: IRawTheme["settings"] = [
      { scope: "variable.other.const", settings: { foreground: "#010101" } },
      { scope: "source.python variable.other.constant", settings: { foreground: "#020202" } },
    ];
    expect(resolveSemanticColor(settings, [], "variable", ["readonly"], "python")).toBeUndefined();
  });
});
