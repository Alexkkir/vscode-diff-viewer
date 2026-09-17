// A standalone hunk may start inside a multiline Python string. A bare triple
// quote followed by call/list punctuation is a closing delimiter, not the start
// of the next Python statements. Recover only this narrow, observable case.
export function pythonHunkPrefix(lines: string[]): string | undefined {
  for (const line of lines) {
    if (/^\s*#/.test(line)) continue;
    const quote = line.match(/(?<!\\)("""|''')/);
    if (!quote) continue;
    const closing = line.match(/^\s*("""|''')\s*[,)}\]]+\s*(?:#.*)?$/);
    return closing ? `f${closing[1]}` : undefined;
  }
  return undefined;
}
