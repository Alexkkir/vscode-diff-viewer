import { DiffLine } from "diff2html/lib/types";

export type AlignedLineGroup = [DiffLine[], DiffLine[]];

// Line count and line length limits also come from diff2html's settings. This
// independent ceiling bounds work if those user settings are unusually large.
const MAX_COMPARISONS = 100_000;
const MAX_CHARACTER_COMPARISONS = 5_000_000;
const MIN_SIMILARITY = 0.5;
const MIN_NEIGHBOR_SIMILARITY = 0.3;
const CONTINUITY_BONUS = 0.5;
const CODE_KEYWORDS = new Set(
  (
    "and as assert async await break case catch class const continue def default delete do else elif enum except " +
    "export false False finally for from function if import in instanceof interface is lambda let match new None " +
    "not null of or pass private protected public raise return static struct super switch this throw true True " +
    "try type typeof undefined var void while with yield"
  ).split(" "),
);
const STATEMENT_KEYWORDS = new Set(
  (
    "assert await break case catch class continue def do else elif enum except finally for from function if import " +
    "interface match pass raise return struct switch throw try type while with yield"
  ).split(" "),
);
const IDENTIFIER = "[\\p{L}_$][\\p{L}\\p{N}_$]*";
const MEMBER = `${IDENTIFIER}(?:\\s*(?:\\.\\s*${IDENTIFIER}|\\[[^\\]\\r\\n]*\\]))*`;
const ASSIGNMENT = new RegExp(
  `^(?:(?:const|let|var|final|val)\\s+)?${MEMBER}\\s*(?::[^=]+)?\\s*(?:\\*\\*|//|<<|>>|[-+*/%&|^])?=(?!=)`,
  "u",
);
const CALL = new RegExp(`^(?:new\\s+)?${MEMBER}\\s*\\(`, "u");

type LinePair = [number, number];

interface CodeShape {
  indentation: string;
  identifiers: Set<string>;
}

/** Align a changed run as a whole, rather than anchoring on its closest pair. */
export function alignChangedLines(oldLines: DiffLine[], newLines: DiffLine[], language?: string): AlignedLineGroup[] {
  if (!oldLines.length || !newLines.length) return oldLines.length || newLines.length ? [[oldLines, newLines]] : [];
  const width = newLines.length + 1;
  const comparisons = oldLines.length * newLines.length;
  if (comparisons > MAX_COMPARISONS) return [[oldLines, newLines]];

  const oldText = oldLines.map((line) => line.content.slice(1).trim());
  const newText = newLines.map((line) => line.content.slice(1).trim());
  const python = /^(?:py|pyi|pyw|python)$/i.test(language ?? "");
  const oldCode = python ? oldText.map(pythonCode) : [];
  const newCode = python ? newText.map(pythonCode) : [];
  const oldDeclarations = oldText.map(declarationShape);
  const newDeclarations = newText.map(declarationShape);
  const oldImports = oldText.map(importStatement);
  const newImports = newText.map(importStatement);
  const scores = new Float64Array((oldLines.length + 1) * width);
  const similarities = new Float64Array(scores.length);
  const directions = new Uint8Array(scores.length);
  const pairScores = new Float64Array(scores.length).fill(-Infinity);
  const weights = new Float64Array(scores.length);
  const consecutive = new Uint8Array(scores.length);
  let characterBudget = MAX_CHARACTER_COMPARISONS;

  // Weighted longest common subsequence: several related source lines outweigh
  // a single near-identical URL/comment that has moved across those lines.
  for (let oldIndex = 1; oldIndex <= oldLines.length; oldIndex++) {
    for (let newIndex = 1; newIndex <= newLines.length; newIndex++) {
      const left = oldText[oldIndex - 1];
      const right = newText[newIndex - 1];
      const oldImport = oldImports[oldIndex - 1];
      const newImport = newImports[newIndex - 1];
      // Pair a rewritten import with its header, not with a continuation name
      // or a nearby comment. Its length can change greatly when unwrapped.
      const importScore =
        oldImport && newImport
          ? oldImport.statement === newImport.statement
            ? 1
            : oldImport.module !== undefined && oldImport.module === newImport.module
              ? 0.9
              : undefined
          : oldImport || newImport
            ? 0
            : undefined;
      const unchangedCode = oldCode[oldIndex - 1] !== undefined && oldCode[oldIndex - 1] === newCode[newIndex - 1];
      const compared = unchangedCode
        ? { score: 1, work: 0 }
        : importScore !== undefined
          ? { score: importScore, work: 0 }
          : similarity(left, right, characterBudget);
      if (!compared) return [[oldLines, newLines]];
      characterBudget -= compared.work;
      // A one-character module rename can otherwise outscore the matching
      // header when that header's imported names moved onto the same line.
      if (oldImport?.module !== undefined && newImport?.module !== undefined && oldImport.module !== newImport.module) {
        compared.score = Math.min(compared.score, 0.8);
      }
      const declaration = oldDeclarations[oldIndex - 1];
      const renamedDeclaration = declaration !== undefined && declaration === newDeclarations[newIndex - 1];
      const score = Math.max(compared.score, renamedDeclaration ? 0.8 : 0);
      similarities[oldIndex * width + newIndex] = score;
      const weight =
        score > MIN_SIMILARITY ? (score - MIN_SIMILARITY) * Math.min(1, Math.min(left.length, right.length) / 10) : 0;
      const index = oldIndex * width + newIndex;
      const deletion = scores[index - width];
      const insertion = scores[index - 1];
      const previous = index - width - 1;
      const separate = scores[previous] + weight;
      const adjacent = pairScores[previous] + weight + CONTINUITY_BONUS * Math.min(weight, weights[previous]);
      const pair = weight > 0 ? Math.max(separate, adjacent) : -Infinity;
      pairScores[index] = pair;
      weights[index] = weight;
      consecutive[index] = adjacent > separate ? 1 : 0;
      if (pair >= deletion && pair >= insertion) {
        scores[index] = pair;
        directions[index] = 1;
      } else if (deletion >= insertion) {
        scores[index] = deletion;
        directions[index] = 2;
      } else {
        scores[index] = insertion;
        directions[index] = 3;
      }
    }
  }

  const anchors: LinePair[] = [];
  let oldIndex = oldLines.length;
  let newIndex = newLines.length;
  let followPair = false;
  while (oldIndex > 0 && newIndex > 0) {
    const index = oldIndex * width + newIndex;
    const direction = followPair ? 1 : directions[index];
    if (direction === 1) {
      followPair = !!consecutive[index];
      anchors.push([--oldIndex, --newIndex]);
    } else if (direction === 2) {
      oldIndex--;
    } else {
      newIndex--;
    }
  }
  anchors.reverse();
  const oldShapes = oldLines.map(codeShape);
  const newShapes = newLines.map(codeShape);
  const pairs = pairCoherentReplacement(
    extendCodeAnchors(anchors, oldShapes, newShapes, similarities, width),
    oldLines,
    newLines,
    oldShapes,
    newShapes,
    similarities,
    width,
  );

  const result: AlignedLineGroup[] = [];
  oldIndex = 0;
  newIndex = 0;
  for (const [oldAnchor, newAnchor] of pairs) {
    if (oldAnchor > oldIndex) result.push([oldLines.slice(oldIndex, oldAnchor), []]);
    if (newAnchor > newIndex) result.push([[], newLines.slice(newIndex, newAnchor)]);
    result.push([[oldLines[oldAnchor]], [newLines[newAnchor]]]);
    oldIndex = oldAnchor + 1;
    newIndex = newAnchor + 1;
  }
  if (oldIndex < oldLines.length) result.push([oldLines.slice(oldIndex), []]);
  if (newIndex < newLines.length) result.push([[], newLines.slice(newIndex)]);
  return result;
}

/**
 * Equal-sized gaps are useful positional comparisons when each row has the
 * same statement role and indentation, even if all operand names changed.
 * Existing anchors remain fixed. A shared identifier also permits related
 * role changes, without letting comments or literals establish that relation.
 */
function pairCoherentReplacement(
  anchors: LinePair[],
  oldLines: DiffLine[],
  newLines: DiffLine[],
  oldShapes: Array<CodeShape | undefined>,
  newShapes: Array<CodeShape | undefined>,
  similarities: Float64Array,
  width: number,
): LinePair[] {
  const canPair = (oldIndex: number, newIndex: number) => {
    const old = oldShapes[oldIndex];
    const next = newShapes[newIndex];
    if (!old || !next || old.indentation !== next.indentation) return false;
    const oldRole = statementRole(oldLines[oldIndex]);
    const newRole = statementRole(newLines[newIndex]);
    if (oldRole && oldRole === newRole) return true;
    if ([oldRole, newRole].some((role) => role === "from" || role === "import")) return false;
    // Without a tokenizer's state, strings and comments cannot provide reliable
    // identifier evidence for a replacement between different statement roles.
    const text = oldLines[oldIndex].content.slice(1) + "\n" + newLines[newIndex].content.slice(1);
    if (/["'`#]|\/\/|\/\*/.test(text)) return false;
    if (similarities[(oldIndex + 1) * width + newIndex + 1] < MIN_NEIGHBOR_SIMILARITY) return false;
    if (![...old.identifiers].some((identifier) => !CODE_KEYWORDS.has(identifier) && next.identifiers.has(identifier)))
      return false;
    // Bare prose is not evidence of a code replacement. Both rows must have
    // code punctuation; punctuation-only rows already failed codeShape above.
    return [oldLines[oldIndex], newLines[newIndex]].every((line) => /[()[\]=:;{}]/.test(line.content));
  };
  const pairs: LinePair[] = [];
  let oldStart = 0;
  let newStart = 0;
  for (const [oldEnd, newEnd] of [...anchors, [oldLines.length, newLines.length]]) {
    if (oldEnd - oldStart === newEnd - newStart) {
      const gap: LinePair[] = [];
      for (let offset = 0; offset < oldEnd - oldStart; offset++) {
        if (!canPair(oldStart + offset, newStart + offset)) break;
        gap.push([oldStart + offset, newStart + offset]);
      }
      if (gap.length === oldEnd - oldStart) pairs.push(...gap);
    }
    if (oldEnd < oldLines.length) pairs.push([oldEnd, newEnd]);
    oldStart = oldEnd + 1;
    newStart = newEnd + 1;
  }
  return pairs;
}

function statementRole(line: DiffLine): string | undefined {
  const text = line.content
    .slice(1)
    .trim()
    .replace(/^(?:(?:export|default|async|public|private|protected|static)\s+)+/, "");
  const keyword = /^[\p{L}_$][\p{L}\p{N}_$]*/u.exec(text)?.[0];
  if (keyword && STATEMENT_KEYWORDS.has(keyword)) return keyword;
  // Only the statement's prefix is classified; operand strings and comments
  // remain untouched for inline highlighting and exact source reconstruction.
  if (ASSIGNMENT.test(text)) return "assignment";
  if (CALL.test(text)) return "call";
  return undefined;
}

function codeShape(line: DiffLine): CodeShape | undefined {
  const text = line.content.slice(1);
  const trimmed = text.trim();
  // Comments, literals and punctuation-only rows must not lend their matching
  // score to unrelated neighboring code. This is lexical, not keyword-specific.
  if (!/^[\p{L}_$]/u.test(trimmed) || /^(?:[fFrRbBuU]{1,2})?["']/.test(trimmed)) return undefined;
  return {
    indentation: /^[ \t]*/.exec(text)![0],
    identifiers: new Set(trimmed.match(/[\p{L}_$][\p{L}\p{N}_$]*/gu) ?? []),
  };
}

function extendCodeAnchors(
  anchors: LinePair[],
  oldShapes: Array<CodeShape | undefined>,
  newShapes: Array<CodeShape | undefined>,
  similarities: Float64Array,
  width: number,
): LinePair[] {
  if (!anchors.length) return anchors;
  const score = ([old, next]: LinePair) => similarities[(old + 1) * width + next + 1];
  const isCode = ([old, next]: LinePair) => !!oldShapes[old] && !!newShapes[next];
  const canExtend = (pair: LinePair): boolean => {
    const [old, next] = pair;
    const left = oldShapes[old];
    const right = newShapes[next];
    return !!(
      left &&
      right &&
      left.indentation === right.indentation &&
      score(pair) >= MIN_NEIGHBOR_SIMILARITY &&
      [...left.identifiers].some((identifier) => right.identifiers.has(identifier))
    );
  };

  const result: LinePair[] = [];
  for (let index = 0; index <= anchors.length; index++) {
    const before = anchors[index - 1];
    const after = anchors[index];
    let oldStart = before ? before[0] + 1 : 0;
    let newStart = before ? before[1] + 1 : 0;
    let oldEnd = after ? after[0] : oldShapes.length;
    let newEnd = after ? after[1] : newShapes.length;
    const prefix: LinePair[] = [];
    const suffix: LinePair[] = [];
    const extend = (fromStart: boolean) => {
      const boundary = fromStart ? before : after;
      if (!boundary || !isCode(boundary)) return;
      while (oldStart < oldEnd && newStart < newEnd) {
        const pair: LinePair = fromStart ? [oldStart, newStart] : [oldEnd - 1, newEnd - 1];
        if (!canExtend(pair)) break;
        if (fromStart) {
          prefix.push(pair);
          oldStart++;
          newStart++;
        } else {
          suffix.push(pair);
          oldEnd--;
          newEnd--;
        }
      }
    };
    // Both ends may claim an unequal gap. Start with its stronger existing
    // anchor, then extend the other side only into the still-unmatched range.
    const fromStart = !!before && isCode(before) && (!after || !isCode(after) || score(before) >= score(after));
    extend(fromStart);
    extend(!fromStart);
    result.push(...prefix, ...suffix.reverse());
    if (after) result.push(after);
  }
  return result;
}

function pythonCode(text: string): string | undefined {
  let quote: string | undefined;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quote) {
      if (character === "\\") index++;
      else if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      // F-string expressions can reuse the outer quote in modern Python.
      // Leave them to full-text matching instead of mistaking a nested # for
      // a comment; syntax highlighting has its own complete tokenizer.
      const prefix = /[a-z]+$/i.exec(text.slice(0, index))?.[0];
      if (prefix && /^(?:f|fr|rf)$/i.test(prefix)) return undefined;
      // Multiline string state is unavailable to line pairing; keep its full
      // text rather than guessing which hashes might belong to the string.
      if (text.slice(index, index + 3) === character.repeat(3)) return undefined;
      quote = character;
    } else if (character === "#") {
      return text.slice(0, index).trimEnd() || undefined;
    }
  }
  return quote ? undefined : text || undefined;
}

function importStatement(text: string): { statement: string; module?: string } | undefined {
  // Python imports cannot contain string literals. Recognize only their bare
  // syntax so a long trailing # comment cannot outweigh an unchanged import;
  // never strip # from arbitrary expressions, strings or comment-only lines.
  const statement = text.split("#", 1)[0].trimEnd();
  if (!/^(?:from\s+[\p{L}\p{N}_.]+\s+import\s+|import\s+)[\p{L}\p{N}_.,*() \t]+$/u.test(statement)) return undefined;
  return { statement, module: /^from\s+([\p{L}\p{N}_.]+)\s+import\s+/u.exec(statement)?.[1] };
}

function declarationShape(text: string): string | undefined {
  // A long renamed declaration can have little character overlap despite the
  // same syntax/base class/signature. Only abstract its declared name, keeping
  // every other token exact; strings, comments and arbitrary expressions do
  // not acquire a false similarity from sharing punctuation.
  const declaration =
    /^((?:export\s+)?(?:async\s+)?(?:class|def|function|interface|struct|enum|type)\s+)[\p{L}_$][\p{L}\p{N}_$]*/u;
  return declaration.test(text) ? text.replace(declaration, "$1\0") : undefined;
}

function similarity(left: string, right: string, budget: number): { score: number; work: number } | undefined {
  if (left === right) return { score: 1, work: 0 };
  const length = Math.max(left.length, right.length);
  if (Math.min(left.length, right.length) / length <= MIN_NEIGHBOR_SIMILARITY) return { score: 0, work: 0 };

  // Unchanged indentation, identifiers and long URL prefixes should not cause
  // quadratic character comparisons for every possible pair of lines.
  let start = 0;
  while (start < Math.min(left.length, right.length) && left[start] === right[start]) start++;
  let leftEnd = left.length;
  let rightEnd = right.length;
  while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd--;
    rightEnd--;
  }
  const a = left.slice(start, leftEnd);
  const b = right.slice(start, rightEnd);
  const work = a.length * b.length;
  if (work > budget) return undefined;
  const row = new Uint32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const previous = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = previous;
    }
  }
  return { score: 1 - row[b.length] / length, work };
}
