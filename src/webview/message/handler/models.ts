import { DiffFile } from "diff2html/lib/types";
import { parsedDiffFilePath } from "../../../shared/extract";
import { UpdateWebviewPayload } from "../api";
import { getSha1Hash } from "../hash";
import { DiffFileHashMap, DiffFileViewModel } from "./types";

export { normalizeDiffFilePath } from "../../../shared/extract";

export function buildDiffFileViewModel(diffFile: DiffFile, accessiblePaths: ReadonlySet<string>): DiffFileViewModel {
  const oldPath = parsedDiffFilePath(diffFile.oldName);
  const newPath = parsedDiffFilePath(diffFile.newName);
  const primaryPath = newPath ?? oldPath ?? "";

  return {
    primaryPath,
    oldPath,
    newPath,
    isOldPathAccessible: oldPath ? accessiblePaths.has(oldPath) : false,
    isNewPathAccessible: newPath ? accessiblePaths.has(newPath) : false,
  };
}

export function buildDiffFileMap(diffFiles: DiffFile[], accessiblePaths: ReadonlySet<string>): DiffFileHashMap {
  const byPath = new Map<string, DiffFileHashMap[string]>();
  for (const diffFile of diffFiles) {
    const filePath = buildDiffFileViewModel(diffFile, accessiblePaths).primaryPath;
    if (!filePath) continue;
    const previous = byPath.get(filePath);
    if (Array.isArray(previous)) previous.push(diffFile);
    else byPath.set(filePath, previous ? [previous, diffFile] : diffFile);
  }
  return Object.fromEntries(byPath);
}

export async function buildDiffHashes(args: {
  payload: UpdateWebviewPayload;
  currentDiffFilesByPath: DiffFileHashMap;
  accessiblePaths: ReadonlySet<string>;
}): Promise<Record<string, string>> {
  const targetPaths = args.payload.performance.deferViewedStateHashing
    ? Object.keys(args.payload.viewedState)
    : args.payload.diffFiles
        .map((diffFile) => buildDiffFileViewModel(diffFile, args.accessiblePaths).primaryPath)
        .filter((filePath): filePath is string => filePath.length > 0);

  const entries = await Promise.all(
    [...new Set(targetPaths)].map(async (fileName) => {
      if (!fileName) {
        return undefined;
      }

      const diffFile = args.currentDiffFilesByPath[fileName];
      if (!diffFile) {
        return undefined;
      }

      return [fileName, await getSha1Hash(JSON.stringify(diffFile))] as const;
    }),
  );

  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry)));
}
