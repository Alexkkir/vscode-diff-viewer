import * as vscode from "vscode";

const reads = new WeakMap<vscode.TextDocument, { source: string; error?: string }>();
const fingerprints = new WeakMap<vscode.TextDocument, Promise<string>>();

async function fingerprint(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function recordRead(document: vscode.TextDocument, text: string, source: string, error?: string): string {
  reads.set(document, { source, error });
  fingerprints.set(document, fingerprint(text));
  return text;
}

export async function diffReadDiagnostics(document: vscode.TextDocument): Promise<object> {
  const lastRead = reads.get(document);
  const lastReadSha256 = await fingerprints.get(document);
  let disk;
  try {
    const stat = await vscode.workspace.fs.stat(document.uri);
    const bytes = await vscode.workspace.fs.readFile(document.uri);
    disk = { size: stat.size, mtime: stat.mtime, utf8Sha256: await fingerprint(new TextDecoder().decode(bytes)) };
  } catch (error) {
    disk = { error: String(error) };
  }
  return {
    uri: document.uri.toString(),
    isDirty: document.isDirty,
    version: document.version,
    bufferSha256: await fingerprint(document.getText()),
    lastRead,
    lastReadSha256,
    disk,
  };
}

// Custom text editors can retain a clean TextDocument whose disk contents have
// changed without a text-document notification (for example in remote workspaces).
// Never replace unsaved editor content with bytes from disk.
export async function readDiffText(document: vscode.TextDocument): Promise<string> {
  if (document.isDirty || document.isUntitled) return recordRead(document, document.getText(), "editor-buffer");
  const version = document.version;
  try {
    const bytes = await vscode.workspace.fs.readFile(document.uri);
    if (document.isDirty || document.version !== version)
      return recordRead(document, document.getText(), "buffer-changed-during-read");
    let encoding = vscode.workspace.getConfiguration("files", document.uri).get<string>("encoding", "utf8");
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
    else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) encoding = "utf-8";
    else if (encoding === "utf8" || encoding === "utf8bom") encoding = "utf-8";
    else if (encoding === "utf16le") encoding = "utf-16le";
    else if (encoding === "utf16be") encoding = "utf-16be";
    else if (/^windows\d+$/.test(encoding)) encoding = encoding.replace("windows", "windows-");
    return recordRead(document, new TextDecoder(encoding).decode(bytes), "disk");
  } catch (error) {
    // Virtual documents, unavailable files and unsupported encodings keep using
    // VS Code's decoded buffer. Do not dispose the editor on a transient I/O error.
    return recordRead(document, document.getText(), "buffer-after-read-error", String(error));
  }
}

export function watchDiffFile(
  document: vscode.TextDocument,
  onChange: () => void,
  isVisible: () => boolean = () => true,
): vscode.Disposable {
  if (document.isUntitled) return new vscode.Disposable(() => {});
  const uri = document.uri.with({ query: "", fragment: "" });
  const parent = vscode.Uri.joinPath(uri, "..");
  // A non-recursive parent watch also handles atomic replacement, and avoids
  // treating glob metacharacters in the actual filename as a pattern.
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(parent, "*"));
  const changed = (changedUri: vscode.Uri) => {
    if (changedUri.toString() === uri.toString()) onChange();
  };
  let disposed = false;
  let busy = false;
  let previous: Uint8Array | undefined;
  const poll = async () => {
    if (disposed || busy || !isVisible() || document.isDirty) return;
    busy = true;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (disposed) return;
      const differs =
        previous !== undefined &&
        (bytes.length !== previous.length || bytes.some((value, index) => value !== previous![index]));
      previous = bytes.slice();
      if (differs) onChange();
    } catch {
      // Keep watching through atomic replacement or a temporary disconnect.
    } finally {
      busy = false;
    }
  };
  void poll();
  const timer = setInterval(() => void poll(), 2000);
  return vscode.Disposable.from(
    watcher,
    watcher.onDidChange(changed),
    watcher.onDidCreate(changed),
    new vscode.Disposable(() => {
      disposed = true;
      clearInterval(timer);
    }),
  );
}
