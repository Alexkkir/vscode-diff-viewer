import { isArcModeEnabled } from "../arc-paths";
import { parse } from "diff2html";
import { normalizeDiffFilePath } from "../../shared/extract";
import { resolveAccessibleUri } from "../path-resolution";
import { WebviewContext } from "./types";

export async function collectAccessiblePaths(args: {
  webviewContext: WebviewContext;
  diffFiles: ReturnType<typeof parse>;
}): Promise<string[]> {
  const candidatePaths = new Set<string>();

  for (const diffFile of args.diffFiles) {
    const oldPath = normalizeDiffFilePath(diffFile.oldName);
    const newPath = normalizeDiffFilePath(diffFile.newName);
    if (oldPath) {
      candidatePaths.add(oldPath);
    }
    if (newPath) {
      candidatePaths.add(newPath);
    }
  }

  const cacheKey = JSON.stringify([
    isArcModeEnabled(args.webviewContext.document.uri),
    Array.from(candidatePaths).sort((a, b) => a.localeCompare(b)),
  ]);
  if (args.webviewContext.accessiblePathsCacheKey === cacheKey && args.webviewContext.accessiblePathsCache) {
    return args.webviewContext.accessiblePathsCache;
  }

  const accessiblePaths = await Promise.all(
    Array.from(candidatePaths).map(async (path) => {
      const uri = await resolveAccessibleUri({
        diffDocument: args.webviewContext.document,
        path,
      });
      return uri ? path : undefined;
    }),
  );

  const resolvedPaths = accessiblePaths.filter((path): path is string => Boolean(path));
  args.webviewContext.accessiblePathsCacheKey = cacheKey;
  args.webviewContext.accessiblePathsCache = resolvedPaths;
  return resolvedPaths;
}

export function clearAccessiblePathsCache(webviewContext: WebviewContext): void {
  webviewContext.accessiblePathsCacheKey = undefined;
  webviewContext.accessiblePathsCache = undefined;
}
