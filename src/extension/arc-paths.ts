import * as vscode from "vscode";

export function isArcModeEnabled(uri: vscode.Uri): boolean {
  return vscode.workspace.getConfiguration("diffviewer", uri).get<boolean>("arcMode", true);
}

/** The diff's containing mount is authoritative when several Arcadias are open. */
export function getArcadiaRoot(diffUri: vscode.Uri): vscode.Uri | undefined {
  const ancestors = diffUri.path.split("/");
  ancestors.pop(); // A diff named "arcadia" is not itself a mount directory.
  for (let index = ancestors.length - 1; index >= 0; index--) {
    if (/^(?:\d+)?arcadia$/.test(ancestors[index])) {
      return diffUri.with({
        path: ancestors.slice(0, index + 1).join("/"),
        query: "",
        fragment: "",
      });
    }
  }
  return undefined;
}

/** Resolve an already cleaned Arc-relative filename without trying other mounts. */
export function getArcFileUri(diffUri: vscode.Uri, relativePath: string): vscode.Uri | undefined {
  const normalizedPath = relativePath.replaceAll("\\", "/");
  if (!normalizedPath || normalizedPath.includes("\0") || /^(?:\/|[a-zA-Z][a-zA-Z0-9+.-]*:)/.test(normalizedPath)) {
    return undefined;
  }
  const parts = normalizedPath.split("/");
  if (parts.includes("..")) {
    return undefined;
  }
  const names = parts.filter((part) => part && part !== ".");
  const root = getArcadiaRoot(diffUri);
  return root && names.length ? vscode.Uri.joinPath(root, ...names) : undefined;
}
