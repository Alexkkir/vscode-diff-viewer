import * as vscode from "vscode";
import { overlayTokenColor, readSemanticSpans, SemanticSource } from "../semantic-tokens";

jest.mock("vscode", () => ({
  commands: { executeCommand: jest.fn() },
  workspace: { openTextDocument: jest.fn(), getConfiguration: jest.fn() },
}));

const openDocument = vscode.workspace.openTextDocument as jest.Mock;
const executeCommand = vscode.commands.executeCommand as jest.Mock;
const getConfiguration = vscode.workspace.getConfiguration as jest.Mock;
const legend = { tokenTypes: ["variable", "namespace"], tokenModifiers: ["readonly", "declaration", "static"] };
const tokens = { data: new Uint32Array([0, 0, 4, 0, 1]) };
let sourceId = 0;

function fixture(lines = ["NAME = 1"]) {
  const uri = { toString: () => `file:///fixture-${sourceId++}.py` } as vscode.Uri;
  // A stable URI is important for testing cache reuse.
  const key = uri.toString();
  uri.toString = () => key;
  const document = {
    uri,
    languageId: "python",
    version: 1,
    isClosed: false,
    text: lines.join("\n") + "\n",
    getText() {
      return this.text;
    },
  };
  openDocument.mockResolvedValue(document);
  const source: SemanticSource = { uri, new: lines };
  return { document, source };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.resetAllMocks();
  getConfiguration.mockReturnValue({ get: () => true });
  executeCommand.mockImplementation(async (command) =>
    command === "vscode.provideDocumentSemanticTokensLegend" ? legend : tokens,
  );
});
afterEach(() => jest.useRealTimers());

describe("readSemanticSpans", () => {
  it("decodes line-relative positions, same-line deltas, and modifier bitsets", async () => {
    const { source } = fixture(["A BBB CCCC", "    DDD"]);
    executeCommand.mockResolvedValueOnce(legend).mockResolvedValueOnce({
      data: new Uint32Array([0, 2, 3, 0, 5, 0, 4, 4, 1, 0, 1, 4, 3, 0, 3]),
    });
    await expect(readSemanticSpans(source)).resolves.toEqual([
      { line: 1, start: 2, end: 5, type: "variable", modifiers: ["readonly", "static"] },
      { line: 1, start: 6, end: 10, type: "namespace", modifiers: [] },
      { line: 2, start: 4, end: 7, type: "variable", modifiers: ["readonly", "declaration"] },
    ]);
  });

  it("normalizes CRLF and one final newline when validating a source snapshot", async () => {
    const { source, document } = fixture(["NAME = 1", ""]);
    document.text = "NAME = 1\r\n\r\n";
    await expect(readSemanticSpans(source)).resolves.toHaveLength(1);
  });

  it("skips invalid types, out-of-bounds spans, zero lengths, and incomplete trailing data", async () => {
    const { source } = fixture();
    executeCommand.mockResolvedValueOnce(legend).mockResolvedValueOnce({
      data: new Uint32Array([0, 0, 4, 10, 0, 0, 0, 9, 0, 1, 0, 0, 0, 0, 1, 0, 0, 4, 0, 1, 1, 0]),
    });
    await expect(readSemanticSpans(source)).resolves.toEqual([
      { line: 1, start: 0, end: 4, type: "variable", modifiers: ["readonly"] },
    ]);
  });

  it("reopens and validates the live document before reusing cached tokens", async () => {
    const { source } = fixture();
    const first = await readSemanticSpans(source);
    await expect(readSemanticSpans(source)).resolves.toEqual(first);
    expect(openDocument).toHaveBeenCalledTimes(2);
    expect(executeCommand).toHaveBeenCalledTimes(2);
  });

  it("does not reuse cached tokens when unsaved content differs from the disk snapshot", async () => {
    const { source, document } = fixture();
    await readSemanticSpans(source);
    document.text = "OTHER = 1\n";
    document.version++;
    await expect(readSemanticSpans(source)).resolves.toEqual([]);
    expect(executeCommand).toHaveBeenCalledTimes(2);
  });

  it("refreshes cached tokens after a document version change even if its text was restored", async () => {
    const { source, document } = fixture();
    await readSemanticSpans(source);
    document.version += 2;
    await readSemanticSpans(source);
    expect(executeCommand).toHaveBeenCalledTimes(4);
  });

  it("refreshes tokens after closing and reopening the URI with a reset version", async () => {
    const { source, document } = fixture();
    await readSemanticSpans(source);
    openDocument.mockResolvedValue({ ...document });
    await readSemanticSpans(source);
    expect(executeCommand).toHaveBeenCalledTimes(4);
  });

  it("rejects a source snapshot that already differs before requesting tokens", async () => {
    const { source, document } = fixture();
    document.text = "different = 1\n";
    await expect(readSemanticSpans(source)).resolves.toEqual([]);
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it("rejects provider results after edits while a token request is pending", async () => {
    const { source, document } = fixture();
    const response = deferred<typeof tokens>();
    executeCommand.mockResolvedValueOnce(legend).mockReturnValueOnce(response.promise);
    const pending = readSemanticSpans(source);
    await Promise.resolve();
    await Promise.resolve();
    document.version++;
    document.text = "CHANGED = 1\n";
    response.resolve(tokens);
    await expect(pending).resolves.toEqual([]);
  });

  it("rejects a cached promise if the document changes while the caller awaits it", async () => {
    const { source, document } = fixture();
    const response = deferred<typeof tokens>();
    executeCommand.mockResolvedValueOnce(legend).mockReturnValueOnce(response.promise);
    const first = readSemanticSpans(source);
    await Promise.resolve();
    await Promise.resolve();
    const second = readSemanticSpans(source);
    await Promise.resolve();
    document.version++;
    response.resolve(tokens);
    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toEqual([]);
    expect(executeCommand).toHaveBeenCalledTimes(2);
  });

  it("uses the source language override and respects disabled semantic highlighting before cache reuse", async () => {
    const { source } = fixture();
    await readSemanticSpans(source);
    getConfiguration.mockReturnValue({ get: () => false });
    await expect(readSemanticSpans(source)).resolves.toEqual([]);
    expect(getConfiguration).toHaveBeenCalledWith("editor", { uri: source.uri, languageId: "python" });
    expect(executeCommand).toHaveBeenCalledTimes(2);
  });

  it("does not request any tokens when highlighting is disabled", async () => {
    const { source } = fixture();
    getConfiguration.mockReturnValue({ get: () => false });
    await expect(readSemanticSpans(source)).resolves.toEqual([]);
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it.each(["legend", "tokens"])("preserves TextMate colors when the %s response is missing", async (missing) => {
    const { source } = fixture();
    executeCommand.mockResolvedValueOnce(missing === "legend" ? undefined : legend).mockResolvedValueOnce(undefined);
    await expect(readSemanticSpans(source)).resolves.toEqual([]);
  });

  it.each(["open", "legend", "tokens"])("recovers from a failed %s request", async (failure) => {
    const { source } = fixture();
    const error = new Error("provider unavailable");
    if (failure === "open") openDocument.mockRejectedValueOnce(error);
    else if (failure === "legend") executeCommand.mockRejectedValueOnce(error);
    else executeCommand.mockResolvedValueOnce(legend).mockRejectedValueOnce(error);
    await expect(readSemanticSpans(source)).resolves.toEqual([]);
  });

  it.each(["open", "legend", "tokens"])("bounds a stalled %s request", async (stalled) => {
    jest.useFakeTimers();
    const { source } = fixture();
    const never = new Promise(() => {});
    if (stalled === "open") openDocument.mockReturnValueOnce(never);
    else if (stalled === "legend") executeCommand.mockReturnValueOnce(never);
    else executeCommand.mockResolvedValueOnce(legend).mockReturnValueOnce(never);
    const pending = readSemanticSpans(source);
    await jest.advanceTimersByTimeAsync(1200);
    await expect(pending).resolves.toEqual([]);
  });

  it("refreshes the provider after the cache expires", async () => {
    jest.useFakeTimers();
    const { source } = fixture();
    await readSemanticSpans(source);
    await jest.advanceTimersByTimeAsync(5000);
    await readSemanticSpans(source);
    expect(executeCommand).toHaveBeenCalledTimes(4);
  });
});

describe("overlayTokenColor", () => {
  it("splits overlapping tokens and preserves TextMate font style and unrelated spans", () => {
    const original = [
      { start: 0, end: 4, color: "gray", fontStyle: 1 },
      { start: 4, end: 8, color: "green", fontStyle: 2 },
      { start: 8, end: 10, color: "orange", fontStyle: 4 },
    ];
    expect(overlayTokenColor(original, 2, 6, "blue")).toEqual([
      { start: 0, end: 2, color: "gray", fontStyle: 1 },
      { start: 2, end: 4, color: "blue", fontStyle: 1 },
      { start: 4, end: 6, color: "blue", fontStyle: 2 },
      { start: 6, end: 8, color: "green", fontStyle: 2 },
      { start: 8, end: 10, color: "orange", fontStyle: 4 },
    ]);
    expect(original[0]).toEqual({ start: 0, end: 4, color: "gray", fontStyle: 1 });
  });

  it("leaves empty overlays unchanged", () => {
    const original = [{ start: 0, end: 5, color: "gray", fontStyle: 0 }];
    expect(overlayTokenColor(original, 2, 2, "blue")).toBe(original);
  });
});
