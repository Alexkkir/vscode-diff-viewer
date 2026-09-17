import { getArcadiaRoot, getArcFileUri, isArcModeEnabled } from "../arc-paths";
import { normalizeDiffFilePath } from "../../shared/extract";
import * as vscode from "vscode";
import { DiffFile } from "diff2html/lib/types";
import { reconstructSyntaxSources } from "./syntax-source";

type Sources = (NonNullable<ReturnType<typeof reconstructSyntaxSources>> & { uri: vscode.Uri }) | undefined;

export async function readSyntaxSources(files: DiffFile[], diffUri?: vscode.Uri): Promise<Sources[]> {
  if (!diffUri) return files.map(() => undefined);
  const result: Sources[] = [];
  let budget = 8 * 1024 * 1024;
  for (const file of files) {
    let source: Sources;
    const path = normalizeDiffFilePath(file.newName);
    if (budget > 0 && path && !file.isBinary && !file.isCombined) {
      const candidates: vscode.Uri[] = [];
      if (path.startsWith("/")) candidates.push(diffUri.with({ path, query: "", fragment: "" }));
      else if (isArcModeEnabled(diffUri) && getArcadiaRoot(diffUri)) {
        const uri = getArcFileUri(diffUri, path);
        if (uri) candidates.push(uri);
      } else {
        const folder = vscode.workspace.getWorkspaceFolder(diffUri);
        if (folder) candidates.push(vscode.Uri.joinPath(folder.uri, path));
        let parent = vscode.Uri.joinPath(diffUri.with({ query: "", fragment: "" }), "..");
        for (let depth = 0; depth < 8; depth++) {
          candidates.push(vscode.Uri.joinPath(parent, path));
          const next = vscode.Uri.joinPath(parent, "..");
          if (next.path === parent.path) break;
          parent = next;
        }
      }
      const seen = new Set<string>();
      for (const uri of candidates) {
        if (seen.has(uri.toString())) continue;
        seen.add(uri.toString());
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (!(stat.type & vscode.FileType.File) || stat.size > Math.min(budget, 2 * 1024 * 1024)) continue;
          const bytes = await vscode.workspace.fs.readFile(uri);
          budget -= bytes.byteLength;
          const reconstructed = reconstructSyntaxSources(file, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
          source = reconstructed ? { ...reconstructed, uri } : undefined;
          if (source) break;
          if (budget <= 0) break;
        } catch {
          /* Missing or mismatched source: use standalone hunk recovery. */
        }
      }
    }
    result.push(source);
  }
  return result;
}
