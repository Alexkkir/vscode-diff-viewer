import * as vscode from "vscode";
import { getArcadiaRoot, getArcFileUri, isArcModeEnabled } from "../arc-paths";

jest.mock("vscode", () => ({
  Uri: { joinPath: jest.fn() },
  workspace: { getConfiguration: jest.fn() },
}));

function uri(path: string, scheme = "file", authority = "", query = "", fragment = ""): vscode.Uri {
  return {
    path,
    scheme,
    authority,
    query,
    fragment,
    with: (change: Partial<vscode.Uri>) =>
      uri(
        change.path ?? path,
        change.scheme ?? scheme,
        change.authority ?? authority,
        change.query ?? query,
        change.fragment ?? fragment,
      ),
  } as vscode.Uri;
}

describe("Arc mount paths", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.Uri.joinPath as jest.Mock).mockImplementation((base: vscode.Uri, ...parts: string[]) =>
      base.with({ path: [base.path, ...parts].join("/") }),
    );
  });

  it.each(["arcadia", "1arcadia", "2arcadia", "5arcadia", "123arcadia"])("uses the diff's %s mount", (mount) => {
    const diffUri = uri(`/home/user/${mount}/ml/tensorflow/diff.diff`);
    expect(getArcadiaRoot(diffUri)?.path).toBe(`/home/user/${mount}`);
    expect(getArcFileUri(diffUri, "ml/tensorflow/models/train.py")?.path).toBe(
      `/home/user/${mount}/ml/tensorflow/models/train.py`,
    );
  });

  it("chooses the nearest matching ancestor rather than another mount", () => {
    expect(getArcadiaRoot(uri("/home/user/1arcadia/tools/5arcadia/diff.diff"))?.path).toBe(
      "/home/user/1arcadia/tools/5arcadia",
    );
  });

  it.each([
    "/home/user/diff.diff",
    "/home/user/5arcadia",
    "/home/user/myarcadia/diff.diff",
    "/home/user/arcadia-backup/diff.diff",
  ])("does not infer an Arc root for %s", (path) => {
    expect(getArcadiaRoot(uri(path))).toBeUndefined();
    expect(getArcFileUri(uri(path), "ml/file.py")).toBeUndefined();
  });

  it("keeps the remote host and scheme, discarding query and fragment", () => {
    const fileUri = getArcFileUri(
      uri("/home/user/5arcadia/project/diff.diff", "vscode-remote", "ssh-remote+dev", "query", "fragment"),
      "ml/file.py",
    );
    expect(fileUri).toMatchObject({
      scheme: "vscode-remote",
      authority: "ssh-remote+dev",
      path: "/home/user/5arcadia/ml/file.py",
      query: "",
      fragment: "",
    });
  });

  it("preserves literal filename characters and accepts redundant relative separators", () => {
    expect(getArcFileUri(uri("/home/user/5arcadia/diff.diff"), "./ml//my file#{x}.py")?.path).toBe(
      "/home/user/5arcadia/ml/my file#{x}.py",
    );
  });

  it.each([
    "",
    ".",
    "./",
    "/dev/null",
    "/tmp/file.py",
    "C:/file.py",
    "C:file.py",
    "\\\\server\\share\\file.py",
    "file:///tmp/file.py",
    "../2arcadia/file.py",
    "ml/../../file.py",
    "ml/../file.py",
    "ml\\..\\file.py",
    "ml/\0file.py",
  ])("rejects paths outside the mount and invalid filenames: %s", (path) => {
    expect(getArcFileUri(uri("/home/user/5arcadia/diff.diff"), path)).toBeUndefined();
    expect(vscode.Uri.joinPath).not.toHaveBeenCalled();
  });

  it("looks up Arc mode for the diff's workspace with a true default", () => {
    const get = jest.fn((_key, fallback) => fallback);
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({ get });
    const diffUri = uri("/home/user/5arcadia/diff.diff");
    expect(isArcModeEnabled(diffUri)).toBe(true);
    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("diffviewer", diffUri);
    expect(get).toHaveBeenCalledWith("arcMode", true);
  });

  it("honors a disabled Arc mode setting", () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({ get: () => false });
    expect(isArcModeEnabled(uri("/home/user/5arcadia/diff.diff"))).toBe(false);
  });
});
