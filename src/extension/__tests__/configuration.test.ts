import { ColorSchemeType } from "diff2html/lib/types";
import * as vscode from "vscode";
import { extractConfig, isAutoColorScheme, setOutputFormatConfig } from "../configuration";

jest.mock("vscode", () => ({
  workspace: {
    getConfiguration: jest.fn(),
  },
  window: {
    activeColorTheme: {
      kind: 1,
    },
  },
  ColorThemeKind: {
    Light: 1,
    Dark: 2,
    HighContrast: 3,
    HighContrastLight: 4,
  },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
}));

describe("configuration", () => {
  const mockGet = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: mockGet,
    });
    mockGet.mockImplementation((key: string, fallback: unknown) => {
      if (key === "colorScheme") {
        return "auto";
      }
      return fallback;
    });
  });

  it("should resolve auto color scheme to dark when VS Code theme is dark", () => {
    Object.defineProperty(vscode.window, "activeColorTheme", {
      value: { kind: vscode.ColorThemeKind.Dark },
      configurable: true,
    });

    const config = extractConfig();

    expect(config.diff2html.colorScheme).toBe(ColorSchemeType.DARK);
  });

  it("should resolve auto color scheme to light when VS Code theme is light", () => {
    Object.defineProperty(vscode.window, "activeColorTheme", {
      value: { kind: vscode.ColorThemeKind.Light },
      configurable: true,
    });

    const config = extractConfig();

    expect(config.diff2html.colorScheme).toBe(ColorSchemeType.LIGHT);
  });

  it("should preserve explicit color scheme values", () => {
    mockGet.mockImplementation((key: string, fallback: unknown) => {
      if (key === "colorScheme") {
        return ColorSchemeType.DARK;
      }
      return fallback;
    });

    const config = extractConfig();

    expect(config.diff2html.colorScheme).toBe(ColorSchemeType.DARK);
  });

  it("should default the global scrollbar setting to disabled", () => {
    const config = extractConfig();

    expect(config.globalScrollbar).toBe(false);
  });

  it("should preserve an explicit global scrollbar setting", () => {
    mockGet.mockImplementation((key: string, fallback: unknown) => {
      if (key === "globalScrollbar") {
        return true;
      }
      return fallback;
    });

    const config = extractConfig();

    expect(config.globalScrollbar).toBe(true);
  });

  it("should preserve explicit words matching", () => {
    mockGet.mockImplementation((key: string, fallback: unknown) => {
      if (key === "matching") {
        return "words";
      }
      return fallback;
    });

    const config = extractConfig();

    expect(config.diff2html.matching).toBe("words");
  });

  it("should preserve explicit lines matching", () => {
    mockGet.mockImplementation((key: string, fallback: unknown) => {
      if (key === "matching") {
        return "lines";
      }
      return fallback;
    });

    const config = extractConfig();

    expect(config.diff2html.matching).toBe("lines");
  });

  it.each([
    ["word", "words"],
    ["char", "lines"],
  ])("should normalize legacy %s matching", (legacyValue, expectedValue) => {
    mockGet.mockImplementation((key: string, fallback: unknown) => {
      if (key === "matching") {
        return legacyValue;
      }
      return fallback;
    });

    const config = extractConfig();

    expect(config.diff2html.matching).toBe(expectedValue);
  });

  it("should report when auto color scheme mode is enabled", () => {
    expect(isAutoColorScheme()).toBe(true);
  });

  it("should report when auto color scheme mode is disabled", () => {
    mockGet.mockImplementation((key: string, fallback: unknown) => {
      if (key === "colorScheme") {
        return ColorSchemeType.LIGHT;
      }
      return fallback;
    });

    expect(isAutoColorScheme()).toBe(false);
  });

  it("uses each diff document's folder overrides in a multi-root workspace", () => {
    const firstRootDiff = { path: "/first/changes.diff" } as vscode.Uri;
    const secondRootDiff = { path: "/second/changes.diff" } as vscode.Uri;
    const firstSettings: Record<string, unknown> = {
      colorScheme: "auto",
      matching: "words",
      outputFormat: "side-by-side",
      globalScrollbar: true,
    };
    const secondSettings: Record<string, unknown> = {
      colorScheme: "light",
      matching: "none",
      outputFormat: "line-by-line",
      globalScrollbar: false,
    };
    jest.mocked(vscode.workspace.getConfiguration).mockImplementation((_section, resource) => {
      const settings = resource === firstRootDiff ? firstSettings : resource === secondRootDiff ? secondSettings : {};
      return { get: (key: string, fallback: unknown) => settings[key] ?? fallback } as vscode.WorkspaceConfiguration;
    });
    Object.defineProperty(vscode.window, "activeColorTheme", {
      value: { kind: vscode.ColorThemeKind.Dark },
      configurable: true,
    });

    expect(extractConfig(firstRootDiff)).toMatchObject({
      globalScrollbar: true,
      diff2html: { matching: "words", outputFormat: "side-by-side", colorScheme: ColorSchemeType.DARK },
    });
    expect(extractConfig(secondRootDiff)).toMatchObject({
      globalScrollbar: false,
      diff2html: { matching: "none", outputFormat: "line-by-line", colorScheme: ColorSchemeType.LIGHT },
    });
    expect(isAutoColorScheme(firstRootDiff)).toBe(true);
    expect(isAutoColorScheme(secondRootDiff)).toBe(false);
  });

  it("uses the document's color-scheme override when deciding whether to follow theme changes", () => {
    const uri = { path: "/explicit-theme/changes.diff" } as vscode.Uri;
    jest.mocked(vscode.workspace.getConfiguration).mockImplementation((_section, resource) => {
      return { get: () => (resource === uri ? "light" : "auto") } as unknown as vscode.WorkspaceConfiguration;
    });

    expect(isAutoColorScheme(uri)).toBe(false);
  });

  it.each([
    [
      { workspaceFolderValue: "side-by-side", workspaceValue: "side-by-side" },
      vscode.ConfigurationTarget.WorkspaceFolder,
    ],
    [{ workspaceValue: "side-by-side" }, vscode.ConfigurationTarget.Workspace],
    [{ globalValue: "side-by-side" }, vscode.ConfigurationTarget.Global],
    [undefined, vscode.ConfigurationTarget.Global],
  ])("changes the existing effective output-format override for the selected resource", async (inspected, target) => {
    const uri = { path: "/selected-folder/changes.diff" } as vscode.Uri;
    const inspect = jest.fn(() => inspected);
    const update = jest.fn().mockResolvedValue(undefined);
    jest
      .mocked(vscode.workspace.getConfiguration)
      .mockReturnValue({ inspect, update } as unknown as vscode.WorkspaceConfiguration);

    await setOutputFormatConfig("line-by-line", uri);

    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("diffviewer", uri);
    expect(inspect).toHaveBeenCalledWith("outputFormat");
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("outputFormat", "line-by-line", target);
  });

  it("preserves the global output-format update when there is no selected resource", async () => {
    const inspect = jest.fn();
    const update = jest.fn().mockResolvedValue(undefined);
    jest
      .mocked(vscode.workspace.getConfiguration)
      .mockReturnValue({ inspect, update } as unknown as vscode.WorkspaceConfiguration);

    await setOutputFormatConfig("line-by-line");

    expect(inspect).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith("outputFormat", "line-by-line", true);
  });
});
