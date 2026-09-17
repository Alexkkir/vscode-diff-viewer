import * as vscode from "vscode";
import { clearAccessiblePathsCache, collectAccessiblePaths } from "../paths";

jest.mock("vscode", () => ({
  workspace: {
    getConfiguration: jest.fn(() => ({ get: (_key: string, fallback: unknown) => fallback })),
    fs: {
      stat: jest.fn(),
    },
    getWorkspaceFolder: jest.fn(),
    workspaceFolders: [],
  },
  Uri: {
    file: jest.fn((path: string) => ({
      fsPath: path,
      path,
      scheme: "file",
    })),
    joinPath: jest.fn((base, ...paths) => ({
      fsPath: `${base?.fsPath ?? ""}/${paths.join("/")}`.replaceAll(/\/+/g, "/"),
      path: `${base?.path ?? base?.fsPath ?? ""}/${paths.join("/")}`.replaceAll(/\/+/g, "/"),
      scheme: base?.scheme ?? "file",
    })),
  },
}));

describe("provider/paths", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue({
      uri: { fsPath: "/workspace", path: "/workspace", scheme: "file", with: jest.fn() },
    });
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({});
  });

  it("collects accessible normalized paths and caches the result", async () => {
    const webviewContext = {
      document: { uri: { fsPath: "/workspace/test.patch", path: "/workspace/test.patch", scheme: "file" } },
    } as never;

    const result = await collectAccessiblePaths({
      webviewContext,
      diffFiles: [
        { oldName: "a/src/file.ts", newName: "b/src/file.ts" },
        { oldName: "/dev/null", newName: "b/src/added.ts" },
      ] as never,
    });

    expect(result).toEqual(["a/src/file.ts", "b/src/file.ts", "b/src/added.ts"]);
    expect((webviewContext as { accessiblePathsCache?: string[] }).accessiblePathsCache).toEqual(result);
  });

  it("rechecks paths when Arc mode changes without touching the diff", async () => {
    let arcMode = true;
    (vscode.workspace.getConfiguration as jest.Mock).mockImplementation(() => ({ get: () => arcMode }));
    const args = {
      webviewContext: { document: { uri: { path: "/workspace/test.diff", scheme: "file" } } } as never,
      diffFiles: [{ oldName: "src/file.ts", newName: "src/file.ts (working tree)" }] as never,
    };
    expect(await collectAccessiblePaths(args)).toEqual(["src/file.ts"]);
    const before = (vscode.workspace.fs.stat as jest.Mock).mock.calls.length;
    await collectAccessiblePaths(args);
    expect(vscode.workspace.fs.stat).toHaveBeenCalledTimes(before);
    arcMode = false;
    await collectAccessiblePaths(args);
    expect((vscode.workspace.fs.stat as jest.Mock).mock.calls.length).toBeGreaterThan(before);
  });

  it("clears the accessible path cache", () => {
    const webviewContext = {
      accessiblePathsCacheKey: "key",
      accessiblePathsCache: ["src/file.ts"],
    } as never;

    clearAccessiblePathsCache(webviewContext);

    expect((webviewContext as { accessiblePathsCacheKey?: string }).accessiblePathsCacheKey).toBeUndefined();
    expect((webviewContext as { accessiblePathsCache?: string[] }).accessiblePathsCache).toBeUndefined();
  });
});
