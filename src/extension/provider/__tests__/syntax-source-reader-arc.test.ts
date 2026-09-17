import * as vscode from "vscode";
import { parse } from "diff2html";
import { readSyntaxSources } from "../syntax-source-reader";

jest.mock("vscode", () => ({
  FileType: { File: 1, Directory: 2 },
  Uri: { joinPath: jest.fn() },
  workspace: {
    getConfiguration: jest.fn(),
    getWorkspaceFolder: jest.fn(),
    fs: { stat: jest.fn(), readFile: jest.fn() },
  },
}));

const { posix } = jest.requireActual<typeof import("node:path")>("node:path");
const sourcePath = "ml/tensorflow/models/yagen/train_imagen_superres.py";
const newSource = "VALUE = 2\n";
const files = new Map<string, Uint8Array>();
let arcMode: boolean | undefined;

function uri(path: string, scheme = "file", authority = "", query = "", fragment = ""): vscode.Uri {
  return {
    path,
    fsPath: path,
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
    toString: () => `${scheme}://${authority}${path}${query ? `?${query}` : ""}${fragment ? `#${fragment}` : ""}`,
  } as vscode.Uri;
}

function arcDiff() {
  return parse(
    `--- ${sourcePath} (446896b256014781a4d94f1ccc267c8615eb1474)\n` +
      `+++ ${sourcePath} (working tree)\n` +
      "@@ -1 +1 @@\n-VALUE = 1\n+VALUE = 2\n",
  )[0];
}

function addSource(target: vscode.Uri) {
  files.set(target.toString(), Buffer.from(newSource, "utf8"));
}

function deepDiffUri(scheme: string, authority: string) {
  const nested = Array.from({ length: 12 }, (_, index) => `level-${index}`).join("/");
  return uri(`/home/user/5arcadia/${nested}/diff.diff`, scheme, authority, "query", "fragment");
}

beforeEach(() => {
  jest.clearAllMocks();
  files.clear();
  arcMode = undefined;
  (vscode.Uri.joinPath as jest.Mock).mockImplementation((base: vscode.Uri, ...parts: string[]) =>
    base.with({ path: posix.join(base.path, ...parts) }),
  );
  (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
    get: (_key: string, fallback: boolean) => arcMode ?? fallback,
  });
  (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue({ uri: uri("/home/user/1arcadia") });
  (vscode.workspace.fs.stat as jest.Mock).mockImplementation(async (target: vscode.Uri) => {
    const bytes = files.get(target.toString());
    if (!bytes) throw new Error("File not found");
    return { type: vscode.FileType.File, size: bytes.byteLength };
  });
  (vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (target: vscode.Uri) => {
    const bytes = files.get(target.toString());
    if (!bytes) throw new Error("File not found");
    return bytes;
  });
});

describe("Arc syntax source selection", () => {
  it.each([
    ["file", ""],
    ["vscode-remote", "ssh-remote+dev"],
  ])("reads the labelled source from the diff's deep mount using %s", async (scheme, authority) => {
    const diffUri = deepDiffUri(scheme, authority);
    const expected = uri(`/home/user/5arcadia/${sourcePath}`, scheme, authority);
    addSource(expected);
    addSource(uri(`/home/user/1arcadia/${sourcePath}`, scheme, authority));
    (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue({
      uri: uri("/home/user/1arcadia", scheme, authority),
    });

    const [source] = await readSyntaxSources([arcDiff()], diffUri);

    expect(source?.old).toEqual(["VALUE = 1"]);
    expect(source?.new).toEqual(["VALUE = 2"]);
    expect(source?.uri.toString()).toBe(expected.toString());
    expect(source?.uri).toMatchObject({ scheme, authority, query: "", fragment: "" });
    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("diffviewer", diffUri);
    expect(vscode.workspace.getWorkspaceFolder).not.toHaveBeenCalled();
    expect(vscode.workspace.fs.stat).toHaveBeenCalledTimes(1);
    expect(vscode.workspace.fs.readFile).toHaveBeenCalledTimes(1);
    expect((vscode.workspace.fs.readFile as jest.Mock).mock.calls[0][0].toString()).toBe(expected.toString());
  });

  it.each([
    ["file", ""],
    ["vscode-remote", "ssh-remote+dev"],
  ])("never substitutes matching source from another mount when %s source is missing", async (scheme, authority) => {
    addSource(uri(`/home/user/1arcadia/${sourcePath}`, scheme, authority));
    (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue({
      uri: uri("/home/user/1arcadia", scheme, authority),
    });

    await expect(readSyntaxSources([arcDiff()], deepDiffUri(scheme, authority))).resolves.toEqual([undefined]);

    expect(vscode.workspace.getWorkspaceFolder).not.toHaveBeenCalled();
    expect(vscode.workspace.fs.stat).toHaveBeenCalledTimes(1);
    expect((vscode.workspace.fs.stat as jest.Mock).mock.calls[0][0].toString()).toBe(
      uri(`/home/user/5arcadia/${sourcePath}`, scheme, authority).toString(),
    );
    expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
  });

  it("keeps workspace-first source lookup when Arc mode is disabled", async () => {
    arcMode = false;
    const expected = uri(`/home/user/1arcadia/${sourcePath}`);
    addSource(expected);
    addSource(uri(`/home/user/5arcadia/${sourcePath}`));

    const diffUri = deepDiffUri("file", "");
    const [source] = await readSyntaxSources([arcDiff()], diffUri);

    expect(source?.uri.toString()).toBe(expected.toString());
    expect(source?.new).toEqual(["VALUE = 2"]);
    expect(vscode.workspace.getWorkspaceFolder).toHaveBeenCalledWith(diffUri);
    expect(vscode.workspace.fs.stat).toHaveBeenCalledTimes(1);
    expect(vscode.workspace.fs.readFile).toHaveBeenCalledTimes(1);
  });

  it("keeps parent-directory fallback when Arc mode is disabled and there is no workspace", async () => {
    arcMode = false;
    (vscode.workspace.getWorkspaceFolder as jest.Mock).mockReturnValue(undefined);
    const expected = uri(`/home/user/5arcadia/project/${sourcePath}`);
    addSource(expected);

    const [source] = await readSyntaxSources([arcDiff()], uri("/home/user/5arcadia/project/review/output/diff.diff"));

    expect(source?.uri.toString()).toBe(expected.toString());
    expect(source?.new).toEqual(["VALUE = 2"]);
    expect(vscode.workspace.fs.stat).toHaveBeenCalledTimes(3);
    expect(vscode.workspace.fs.readFile).toHaveBeenCalledTimes(1);
  });
});
