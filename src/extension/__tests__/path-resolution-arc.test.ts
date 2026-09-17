import * as vscode from "vscode";
import { resolveAccessibleUri } from "../path-resolution";

function uri(path: string, scheme = "file", authority = ""): vscode.Uri {
  return {
    path,
    fsPath: path,
    scheme,
    authority,
    with: (change: Partial<vscode.Uri>) =>
      uri(change.path ?? path, change.scheme ?? scheme, change.authority ?? authority),
  } as vscode.Uri;
}

function resolve(diffUri: vscode.Uri, path = "ml/tensorflow/train.py") {
  return resolveAccessibleUri({ diffDocument: { uri: diffUri } as vscode.TextDocument, path });
}

describe("Arc file resolution", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string, fallback: unknown) => fallback,
    });
    (vscode.Uri.joinPath as jest.Mock).mockImplementation((base: vscode.Uri, ...parts: string[]) =>
      base.with({ path: [base.path, ...parts].join("/") }),
    );
    (vscode.Uri.file as jest.Mock).mockImplementation((path: string) => uri(path));
    (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue({ uri: uri("/home/user/1arcadia") });
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({});
  });

  it("uses the containing 5arcadia instead of a workspace rooted in 1arcadia", async () => {
    const result = await resolve(uri("/home/user/5arcadia/project/diff.diff"));
    expect(result?.path).toBe("/home/user/5arcadia/ml/tensorflow/train.py");
    expect(vscode.workspace.getWorkspaceFolder).not.toHaveBeenCalled();
    expect(vscode.workspace.fs.stat).toHaveBeenCalledTimes(1);
    expect(vscode.workspace.fs.stat).toHaveBeenCalledWith(result);
  });

  it("preserves a remote mount's scheme and host when checking accessibility", async () => {
    const result = await resolve(
      uri("/home/user/5arcadia/project/diff.diff", "vscode-remote", "ssh-remote+dev-server"),
    );
    expect(result).toMatchObject({
      scheme: "vscode-remote",
      authority: "ssh-remote+dev-server",
      path: "/home/user/5arcadia/ml/tensorflow/train.py",
    });
    expect(vscode.workspace.fs.stat).toHaveBeenCalledWith(result);
    expect(vscode.Uri.file).not.toHaveBeenCalled();
  });

  it("finds the containing mount beyond eight ancestor directories", async () => {
    const result = await resolve(uri("/home/user/5arcadia/a/b/c/d/e/f/g/h/i/j/k/diff.diff"));
    expect(result?.path).toBe("/home/user/5arcadia/ml/tensorflow/train.py");
  });

  it("does not open a different mount's copy when the file is missing from 5arcadia", async () => {
    (vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (candidate: vscode.Uri) => {
      if (candidate.path.startsWith("/home/user/1arcadia/")) return {};
      throw new Error("File not found in 5arcadia");
    });
    expect(await resolve(uri("/home/user/5arcadia/project/diff.diff"))).toBeUndefined();
    expect(vscode.workspace.fs.stat).toHaveBeenCalledTimes(1);
    expect(vscode.workspace.fs.stat).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/home/user/5arcadia/ml/tensorflow/train.py" }),
    );
    expect(vscode.workspace.getWorkspaceFolder).not.toHaveBeenCalled();
  });

  it("keeps generic workspace resolution when Arc mode is disabled", async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (key: string, fallback: unknown) => (key === "arcMode" ? false : fallback),
    });
    const diffUri = uri("/home/user/5arcadia/project/diff.diff");
    expect((await resolve(diffUri))?.path).toBe("/home/user/1arcadia/ml/tensorflow/train.py");
    expect(vscode.workspace.getWorkspaceFolder).toHaveBeenCalledWith(diffUri);
  });

  it.each([
    "ml/tensorflow/train.py (working tree)",
    "ml/tensorflow/train.py\t(446896b256014781a4d94f1ccc267c8615eb1474)",
    "ml/tensorflow/{old.py (446896b256014781a4d94f1ccc267c8615eb1474) → train.py (working tree)}",
  ])("normalizes revision and rename display metadata before resolving: %s", async (path) => {
    expect((await resolve(uri("/home/user/5arcadia/project/diff.diff"), path))?.path).toBe(
      "/home/user/5arcadia/ml/tensorflow/train.py",
    );
  });
});
