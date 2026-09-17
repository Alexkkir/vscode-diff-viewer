import * as vscode from "vscode";
import { diffReadDiagnostics, readDiffText, watchDiffFile } from "../document";

jest.mock("vscode", () => {
  class Disposable {
    constructor(public dispose: () => void) {}
    static from(...values: { dispose: () => void }[]) {
      return new Disposable(() => values.forEach((value) => value.dispose()));
    }
  }
  return {
    Disposable,
    RelativePattern: jest.fn((base, pattern) => ({ base, pattern })),
    Uri: { joinPath: jest.fn((uri) => ({ parent: uri })) },
    workspace: {
      fs: { readFile: jest.fn(), stat: jest.fn() },
      getConfiguration: jest.fn(),
      createFileSystemWatcher: jest.fn(),
    },
  };
});

describe("external diff changes", () => {
  let document: vscode.TextDocument;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    document = {
      uri: { scheme: "file" },
      version: 1,
      isDirty: false,
      isUntitled: false,
      getText: () => "old buffer",
    } as unknown as vscode.TextDocument;
    jest
      .mocked(vscode.workspace.getConfiguration)
      .mockReturnValue({ get: () => "utf8" } as unknown as vscode.WorkspaceConfiguration);
    jest.mocked(vscode.workspace.fs.readFile).mockResolvedValue(new TextEncoder().encode("new disk text"));
    jest.mocked(vscode.workspace.fs.stat).mockResolvedValue({ type: 1, ctime: 1, mtime: 1, size: 13 });
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });
  it("uses disk contents even when the clean document buffer is stale", async () => {
    expect(await readDiffText(document)).toBe("new disk text");
  });
  it.each(["isDirty", "isUntitled"])("preserves the buffer when %s", async (key) => {
    Object.assign(document, { [key]: true });
    expect(await readDiffText(document)).toBe("old buffer");
    expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
  });
  it("does not replace edits made during the disk read", async () => {
    jest.mocked(vscode.workspace.fs.readFile).mockImplementation(async () => {
      Object.assign(document, { isDirty: true, version: 2, getText: () => "unsaved edit" });
      return new TextEncoder().encode("disk text");
    });
    expect(await readDiffText(document)).toBe("unsaved edit");
  });
  it("falls back on read failures without changing the document", async () => {
    jest.mocked(vscode.workspace.fs.readFile).mockRejectedValue(new Error("unavailable"));
    expect(await readDiffText(document)).toBe("old buffer");
  });
  it("reports a failed disk read instead of hiding a stale-buffer fallback", async () => {
    Object.assign(document, { uri: { toString: () => "vscode-remote://container/changes.diff" } });
    jest.mocked(vscode.workspace.fs.readFile).mockRejectedValue(new Error("remote unavailable"));
    jest.mocked(vscode.workspace.fs.stat).mockRejectedValue(new Error("remote unavailable"));
    await readDiffText(document);
    const report = await diffReadDiagnostics(document);
    expect(report).toMatchObject({
      lastRead: { source: "buffer-after-read-error", error: "Error: remote unavailable" },
      disk: { error: "Error: remote unavailable" },
    });
    expect(JSON.stringify(report)).not.toContain("old buffer");
  });
  it("recognizes a UTF-16 BOM", async () => {
    jest.mocked(vscode.workspace.fs.readFile).mockResolvedValue(new Uint8Array([255, 254, 104, 0, 105, 0]));
    expect(await readDiffText(document)).toBe("hi");
  });
  function subscribe(onChange: () => void, isVisible?: () => boolean) {
    const uri = { toString: () => "vscode-remote://container/changes.diff" };
    Object.assign(document, { uri: { with: () => uri } });
    jest.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue({
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
      onDidCreate: jest.fn(() => ({ dispose: jest.fn() })),
      dispose: jest.fn(),
    } as unknown as vscode.FileSystemWatcher);
    return watchDiffFile(document, onChange, isVisible);
  }
  it("detects a same-size remote rewrite within 250ms without a filesystem event", async () => {
    const changed = jest.fn();
    const subscription = subscribe(changed);
    await jest.advanceTimersByTimeAsync(0);
    jest.mocked(vscode.workspace.fs.readFile).mockResolvedValue(new TextEncoder().encode("new disk data"));
    jest.mocked(vscode.workspace.fs.stat).mockResolvedValue({ type: 1, ctime: 1, mtime: 2, size: 13 });
    await jest.advanceTimersByTimeAsync(249);
    expect(changed).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(changed).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(250);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(vscode.workspace.fs.readFile).toHaveBeenCalledTimes(2);
    subscription.dispose();
  });
  it("checks unchanged metadata cheaply and verifies bytes every two seconds", async () => {
    const changed = jest.fn();
    const subscription = subscribe(changed);
    await jest.advanceTimersByTimeAsync(0);
    // Equal size and timestamps do not prove equal content on remote mounts.
    jest.mocked(vscode.workspace.fs.readFile).mockResolvedValue(new TextEncoder().encode("new disk data"));
    await jest.advanceTimersByTimeAsync(1999);
    expect(vscode.workspace.fs.stat).toHaveBeenCalledTimes(8);
    expect(vscode.workspace.fs.readFile).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(vscode.workspace.fs.readFile).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledTimes(1);
    subscription.dispose();
  });
  it("still verifies content when the filesystem provider cannot stat", async () => {
    jest.mocked(vscode.workspace.fs.stat).mockRejectedValue(new Error("not supported"));
    const changed = jest.fn();
    const subscription = subscribe(changed);
    await jest.advanceTimersByTimeAsync(0);
    jest.mocked(vscode.workspace.fs.readFile).mockResolvedValue(new TextEncoder().encode("updated text"));
    await jest.advanceTimersByTimeAsync(2000);
    expect(changed).toHaveBeenCalledTimes(1);
    subscription.dispose();
  });
  it("does not notify if the buffer becomes dirty during a poll", async () => {
    const changed = jest.fn();
    const subscription = subscribe(changed);
    await jest.advanceTimersByTimeAsync(0);
    jest.mocked(vscode.workspace.fs.stat).mockResolvedValue({ type: 1, ctime: 1, mtime: 2, size: 13 });
    jest.mocked(vscode.workspace.fs.readFile).mockImplementation(async () => {
      Object.assign(document, { isDirty: true });
      return new TextEncoder().encode("updated text");
    });
    await jest.advanceTimersByTimeAsync(250);
    expect(changed).not.toHaveBeenCalled();
    jest.mocked(vscode.workspace.fs.readFile).mockClear();
    await jest.advanceTimersByTimeAsync(2000);
    expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
    subscription.dispose();
  });
  it("detects missed filesystem events, pauses when hidden, and stops after disposal", async () => {
    const uri = { toString: () => "vscode-remote://container/changes.diff" };
    Object.assign(document, { uri: { with: () => uri } });
    const watcher = {
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
      onDidCreate: jest.fn(() => ({ dispose: jest.fn() })),
      dispose: jest.fn(),
    };
    jest
      .mocked(vscode.workspace.createFileSystemWatcher)
      .mockReturnValue(watcher as unknown as vscode.FileSystemWatcher);
    let visible = true;
    const changed = jest.fn();
    const subscription = watchDiffFile(document, changed, () => visible);
    await jest.advanceTimersByTimeAsync(0);
    jest.mocked(vscode.workspace.fs.readFile).mockResolvedValue(new TextEncoder().encode("updated text"));
    await jest.advanceTimersByTimeAsync(2000);
    expect(changed).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2000);
    expect(changed).toHaveBeenCalledTimes(1);
    visible = false;
    jest.mocked(vscode.workspace.fs.readFile).mockResolvedValue(new TextEncoder().encode("another text"));
    await jest.advanceTimersByTimeAsync(2000);
    expect(changed).toHaveBeenCalledTimes(1);
    visible = true;
    await jest.advanceTimersByTimeAsync(2000);
    expect(changed).toHaveBeenCalledTimes(2);
    subscription.dispose();
    jest.mocked(vscode.workspace.fs.readFile).mockClear();
    await jest.advanceTimersByTimeAsync(4000);
    expect(vscode.workspace.fs.readFile).not.toHaveBeenCalled();
  });
  it("watches changes and atomic replacements of only this file, and disposes subscriptions", () => {
    const uri = { toString: () => "vscode-remote://host/repo/[changes].diff" };
    Object.assign(document, { uri: { with: () => uri } });
    const dispose = jest.fn();
    const watcher = { onDidChange: jest.fn(() => ({ dispose })), onDidCreate: jest.fn(() => ({ dispose })), dispose };
    jest
      .mocked(vscode.workspace.createFileSystemWatcher)
      .mockReturnValue(watcher as unknown as vscode.FileSystemWatcher);
    const changed = jest.fn();
    const subscription = watchDiffFile(document, changed);
    const onChange = (watcher.onDidChange.mock.calls as unknown as [(uri: unknown) => void][])[0][0];
    const onCreate = (watcher.onDidCreate.mock.calls as unknown as [(uri: unknown) => void][])[0][0];
    onChange({ toString: () => "vscode-remote://host/repo/other.diff" });
    expect(changed).not.toHaveBeenCalled();
    onChange(uri);
    onCreate(uri);
    expect(changed).toHaveBeenCalledTimes(2);
    subscription.dispose();
    expect(dispose).toHaveBeenCalledTimes(3);
  });
});
