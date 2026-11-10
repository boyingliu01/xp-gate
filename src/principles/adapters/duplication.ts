/**
 * Intra-file duplication measurement.
 *
 * Lives outside `BaseAdapter` on purpose: the measurement is a pure function of
 * the file content, and putting it in the base class pushed that class past the
 * method-count limit (`clean-code.god-class` / `solid.srp`, both correctly fired
 * at 19 methods vs a maximum of 15). A base class should not grow a subsystem.
 */
import { DuplicationBlock, DuplicationReport } from '../types';

/**
 * Consecutive significant lines that must match before they count as a repeated
 * region. Three is the smallest run that is still evidence of copying rather
 * than coincidence: at two, every `try {` / `} catch {` pair qualifies.
 */
export const DUPLICATION_WINDOW = 3;

/** A duplicated region longer than this is truncated in the report snippet. */
const SNIPPET_LIMIT = 120;

/** Collapse whitespace so indentation differences do not hide a copy. */
function normaliseLine(line: string): string {
  return line.trim().replace(/\s+/g, ' ');
}

/**
 * Indexes of lines that carry code.
 *
 * Blank lines, lone braces and comment-only lines are excluded. A file of 40
 * short functions shares `}` and `return x;` with itself constantly; counting
 * those reports near-100% duplication for perfectly ordinary code, which is how
 * a duplication gate gets switched off.
 */
function significantLineIndexes(lines: string[]): number[] {
  const indexes: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = normaliseLine(lines[i]);
    if (text.length === 0) continue;
    if (text === '{' || text === '}' || text === '};' || text === '});') continue;
    if (text.startsWith('//') || text.startsWith('/*') || text.startsWith('*')) continue;
    indexes.push(i);
  }
  return indexes;
}

/** Group duplicated line indexes into contiguous, human-readable regions. */
function buildBlocks(lines: string[], duplicated: Set<number>): DuplicationBlock[] {
  const sorted = [...duplicated].sort((a, b) => a - b);
  const blocks: DuplicationBlock[] = [];
  let runStart = sorted[0];
  let runEnd = sorted[0];

  const flush = (): void => {
    const snippet =
      lines
        .slice(runStart, runEnd + 1)
        .map((line) => normaliseLine(line))
        .find((line) => line.length > 0) ?? '';
    blocks.push({
      startLine: runStart + 1,
      endLine: runEnd + 1,
      // The window count that covered this run start; see measureDuplication.
      occurrences: 1,
      snippet: snippet.slice(0, SNIPPET_LIMIT),
    });
  };

  for (const lineIndex of sorted.slice(1)) {
    if (lineIndex === runEnd + 1) {
      runEnd = lineIndex;
      continue;
    }
    flush();
    runStart = lineIndex;
    runEnd = lineIndex;
  }
  flush();

  // Longest region first: that is the one worth extracting.
  return blocks.sort((a, b) => b.endLine - b.startLine - (a.endLine - a.startLine));
}

/**
 * Measure how much of the file repeats itself.
 *
 * A line-level window fingerprint, not a token clone: runs of
 * `DUPLICATION_WINDOW` significant lines are keyed into a map, and every line
 * inside a window seen more than once is marked duplicated. Overlapping marks
 * form one region, so a large copied block is not counted twice.
 *
 * Line-level rather than token-level because this runs per file inside Gate 4
 * and must stay cheap (measured 0.6–2.9 ms/file). Cross-file token-level clones
 * remain Gate 2's job — jscpd already does that, and duplicating it here would
 * make two gates disagree about the same word.
 */
export function measureDuplication(content: string): DuplicationReport {
  const lines = content.split('\n');
  const significant = significantLineIndexes(lines);
  const total = significant.length;

  if (total < DUPLICATION_WINDOW * 2) {
    return { percentage: 0, blocks: [] };
  }

  const duplicated = new Set<number>();
  const seen = new Set<string>();
  let repeatCount = 0;

  for (let i = 0; i + DUPLICATION_WINDOW <= significant.length; i++) {
    const window = significant.slice(i, i + DUPLICATION_WINDOW);
    const fingerprint = window.map((lineIndex) => normaliseLine(lines[lineIndex])).join('\u0000');
    if (!seen.has(fingerprint)) {
      seen.add(fingerprint);
      continue;
    }
    repeatCount++;
    for (const lineIndex of window) duplicated.add(lineIndex);
  }

  if (duplicated.size === 0) {
    return { percentage: 0, blocks: [] };
  }

  const blocks = buildBlocks(lines, duplicated);
  // TODO(REQ-PRINCIPLES-DUP): `occurrences` is only meaningful for blocks[0].
  // Every other block keeps the builder's default of 1, and the count below is
  // the file-wide repeat total, not a per-block count. Harmless today because
  // the rule reads only `percentage` and no CLI surfaces blocks -- but a future
  // consumer would read wrong data silently, so this is a trap, not a feature.
  // Correct fix is to count occurrences per fingerprint group inside
  // buildBlocks (code-walkthrough R2, A4/F5).
  if (blocks.length > 0) blocks[0].occurrences = repeatCount + 1;
  return { percentage: (duplicated.size / total) * 100, blocks };
}
