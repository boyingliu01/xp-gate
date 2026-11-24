/**
 * lint-baseline.ts — Lint baseline engine for pre-commit gate
 *
 * Extends the BaselineEntry system to support lint tool baselines
 * (ESLint, ruff, golangci-lint, shellcheck).
 *
 * Used by:
 *   - pre-commit hook (Gate 1): diff current lint against baseline
 *   - xp-gate baseline CLI: create/show/reset/diff baselines
 */

import type { BaselineEntry } from './baseline';

// ── Parsing ───────────────────────────────────────────────

interface ESLintFileResult {
  filePath: string;
  errorCount: number;
  warningCount: number;
  messages?: Array<{ ruleId?: string; severity?: number }>;
}

interface RuffMessage {
  kind?: string;
  message?: string;
}

interface RuffFileResult {
  file: string;
  messages?: RuffMessage[];
}

interface GolangciIssue {
  file: string;
  line?: number;
  severity?: string;
  text?: string;
}

interface GolangciOutput {
  Issues?: GolangciIssue[];
}

interface ShellcheckResult {
  file: string;
  line?: number;
  level?: string;
  message?: string;
}

/**
 * Parse ESLint JSON output into BaselineEntry format.
 * ESLint -f json output: Array<{filePath, errorCount, warningCount, messages}>
 */
/**
 * Build a matcher from a reported path to the project-relative file it belongs to.
 *
 * The three parsers each did this inline, with slightly different rules, and the
 * differences were accidents rather than decisions: ESLint compares BOTH directions
 * because it reports absolute paths and the caller passes relative ones, while
 * golangci and shellcheck only need one direction.
 *
 * Matching both directions is the safe superset: a path that ends with a known file, OR
 * a known file that ends with the reported path, names the same file. The membership
 * check afterwards is what stops a path from matching a file the caller never asked
 * about.
 *
 * @param files project-relative paths the caller asked for
 * @param bidirectional compare both directions (absolute reporters need this)
 * @returns a function from a reported path to the matched file, or null
 */
function makeFileMatcher(files: string[], bidirectional: boolean) {
  const fileSet = new Set(files);
  return (reported: string): string | null => {
    const matched = files.find((f) => f.endsWith(reported) || (bidirectional && reported.endsWith(f)));
    return matched && fileSet.has(matched) ? matched : null;
  };
}

function parseESLint(parsed: ESLintFileResult[], files: string[]): Record<string, BaselineEntry> {
  const result: Record<string, BaselineEntry> = {};
  // ESLint reports absolute paths and the caller passes relative ones, so both
  // directions are compared.
  const matchFile = makeFileMatcher(files, true);

  for (const fileResult of parsed) {
    const matchedFile = matchFile(fileResult.filePath);
    if (!matchedFile) continue;

    result[matchedFile] = {
      eslint: {
        warnings: fileResult.warningCount || 0,
        errors: fileResult.errorCount || 0,
      },
      totalWarnings: fileResult.warningCount || 0,
      lastAnalyzed: new Date().toISOString(),
    };
  }

  return result;
}

/**
 * Parse ruff JSON output into BaselineEntry format.
 * ruff check --output-format json: Array<{file, noqa_count, cells, messages: [{kind, message}]}>
 */
function parseRuff(parsed: RuffFileResult[], files: string[]): Record<string, BaselineEntry> {
  const result: Record<string, BaselineEntry> = {};
  const fileSet = new Set(files);

  for (const fileResult of parsed) {
    if (!fileSet.has(fileResult.file)) continue;
    const messages = fileResult.messages || [];
    const warnings = messages.length;

    result[fileResult.file] = {
      ruff: { warnings, errors: 0 },
      totalWarnings: warnings,
      lastAnalyzed: new Date().toISOString(),
    };
  }

  return result;
}

/**
 * Parse golangci-lint JSON output into BaselineEntry format.
 * golangci-lint --out-format json: {Issues: [{file, line, severity, text}]}
 */
function parseGolangci(parsed: GolangciOutput, files: string[]): Record<string, BaselineEntry> {
  const result: Record<string, BaselineEntry> = {};
  const fileSet = new Set(files);
  const warningsByFile: Record<string, { warnings: number; errors: number }> = {};

  for (const issue of parsed.Issues || []) {
    // Issues have absolute paths; match against files list
    const matchedFile = files.find(f => issue.file.endsWith(f));
    if (!matchedFile || !fileSet.has(matchedFile)) continue;

    if (!warningsByFile[matchedFile]) {
      warningsByFile[matchedFile] = { warnings: 0, errors: 0 };
    }

    if (issue.severity === 'error') {
      warningsByFile[matchedFile].errors++;
    } else {
      warningsByFile[matchedFile].warnings++;
    }
  }

  for (const [file, counts] of Object.entries(warningsByFile)) {
    result[file] = {
      golangci: counts,
      totalWarnings: counts.warnings,
      lastAnalyzed: new Date().toISOString(),
    };
  }

  return result;
}

/**
 * Parse shellcheck JSON output into BaselineEntry format.
 * shellcheck -f json: Array<{file, line, level, message}>
 */
function parseShellcheck(parsed: ShellcheckResult[], files: string[]): Record<string, BaselineEntry> {
  const result: Record<string, BaselineEntry> = {};
  const matchFile = makeFileMatcher(files, false);
  const warningsByFile: Record<string, { warnings: number; errors: number }> = {};

  for (const item of parsed) {
    const matchedFile = matchFile(item.file);
    if (!matchedFile) continue;

    if (!warningsByFile[matchedFile]) {
      warningsByFile[matchedFile] = { warnings: 0, errors: 0 };
    }

    if (item.level === 'error') {
      warningsByFile[matchedFile].errors++;
    } else {
      warningsByFile[matchedFile].warnings++;
    }
  }

  for (const [file, counts] of Object.entries(warningsByFile)) {
    result[file] = {
      shellcheck: counts,
      totalWarnings: counts.warnings,
      lastAnalyzed: new Date().toISOString(),
    };
  }

  return result;
}

/**
 * Parse lint tool JSON output into BaselineEntry format.
 * Supports: eslint, ruff, golangci, shellcheck
 */
/** Output shapes that carry no findings: absent, an empty array, an empty object. */
const EMPTY_OUTPUTS = new Set(['', '[]', '{}']);

/** Whether this tool output has nothing to record. */
function isNothingRecorded(output: string): boolean {
  return !output || EMPTY_OUTPUTS.has(output);
}

/**
 * How each supported tool's JSON maps into baseline entries.
 *
 * A table rather than a `switch` so adding a tool is a row, and so the four casts that
 * were interleaved with the dispatch live in one place each.
 */
const TOOL_PARSERS: Record<string, (parsed: unknown, files: string[]) => Record<string, BaselineEntry>> = {
  eslint: (parsed, files) => parseESLint(parsed as ESLintFileResult[], files),
  ruff: (parsed, files) => parseRuff(parsed as RuffFileResult[], files),
  golangci: (parsed, files) => parseGolangci(parsed as GolangciOutput, files),
  shellcheck: (parsed, files) => parseShellcheck(parsed as ShellcheckResult[], files),
};

/**
 * Parse tool output into baseline entries.
 *
 * Empty output and unparseable output both mean "nothing to record", not an error: a
 * tool with nothing to report prints an empty array, and a failed run is reported by
 * the caller's exit-code check rather than inferred from the absence of JSON.
 */
export function parseLintOutput(
  tool: string,
  output: string,
  files: string[],
): Record<string, BaselineEntry> {
  if (isNothingRecorded(output)) return {};
  const parser = TOOL_PARSERS[tool];
  if (!parser) return {};

  try {
    return parser(JSON.parse(output), files);
  } catch {
    return {};
  }
}

// ── Diffing ───────────────────────────────────────────────

export interface LintDiffFileResult {
  file: string;
  oldWarnings: number;
  newWarnings: number;
  warningsDelta: number;
}

export interface LintDiffResult {
  totalWarningsDelta: number;
  filesAdded: LintDiffFileResult[];
  filesRemoved: LintDiffFileResult[];
  filesIncreased: LintDiffFileResult[];
  filesDecreased: LintDiffFileResult[];
  filesUnchanged: LintDiffFileResult[];
}

// Use numeric totalWarnings for diff computation, not entry.totalWarnings
function getEffectiveWarnings(entry: BaselineEntry): number {
  return entry.totalWarnings;
}

/**
 * Compare two baselines and produce a structured diff.
 * Used by: xp-gate baseline diff, pre-commit gate comparison
 */
export function diffBaselines(
  oldBaseline: Record<string, BaselineEntry>,
  newBaseline: Record<string, BaselineEntry>,
): LintDiffResult {
  // One list per outcome, addressed by name instead of by an if/else ladder: the five
  // outcomes are mutually exclusive and each is a sentence.
  const buckets: Record<string, LintDiffFileResult[]> = {
    filesAdded: [], filesRemoved: [], filesIncreased: [], filesDecreased: [], filesUnchanged: [],
  };
  let totalWarningsDelta = 0;
  const allFiles = new Set([...Object.keys(oldBaseline), ...Object.keys(newBaseline)]);

  for (const file of allFiles) {
    const oldEntry = oldBaseline[file];
    const newEntry = newBaseline[file];
    const oldW = oldEntry ? getEffectiveWarnings(oldEntry) : 0;
    const newW = newEntry ? getEffectiveWarnings(newEntry) : 0;
    const delta = newW - oldW;

    totalWarningsDelta += delta;
    const bucket = classifyDiff(oldEntry, newEntry, delta);
    buckets[bucket].push({ file, oldWarnings: oldW, newWarnings: newW, warningsDelta: delta });
  }

  return { totalWarningsDelta, ...buckets } as LintDiffResult;
}

/**
 * Which bucket one file's change belongs to.
 *
 * PRESENCE is tested before the delta: a file that appeared is "added" even when its
 * previous count of zero makes the delta look like an increase, and one that vanished
 * is "removed" even though the delta is negative. Reading the delta first reported
 * both of those as ordinary increases and decreases.
 */
function classifyDiff(
  oldEntry: BaselineEntry | undefined,
  newEntry: BaselineEntry | undefined,
  delta: number,
): keyof LintDiffResult {
  if (!oldEntry && newEntry) return 'filesAdded';
  if (oldEntry && !newEntry) return 'filesRemoved';
  if (delta > 0) return 'filesIncreased';
  if (delta < 0) return 'filesDecreased';
  return 'filesUnchanged';
}

// ── Delta (per-commit enforcement) ───────────────────────

export interface LintDeltaResult {
  enforcement: 'PASS' | 'BLOCK';
  newWarnings: number;
  newErrors: number;
  reduction: number;
  message: string;
}

/**
 * Compare current lint state against a baseline entry for a single file.
 * Used by the pre-commit hook to determine if new lint errors were introduced.
 */
function countErrors(entry: BaselineEntry): number {
  return (entry.eslint?.errors || 0) +
    (entry.ruff?.errors || 0) +
    (entry.golangci?.errors || 0) +
    (entry.shellcheck?.errors || 0);
}

function deltaPass(reduction: number, message: string): LintDeltaResult {
  return { enforcement: 'PASS', newWarnings: 0, newErrors: 0, reduction, message };
}

function deltaBlock(warnings: number, errors: number, message: string): LintDeltaResult {
  return { enforcement: 'BLOCK', newWarnings: warnings, newErrors: errors, reduction: 0, message };
}

export function computeLintDelta(
  baseline: BaselineEntry | null,
  current: BaselineEntry,
): LintDeltaResult {
  if (!baseline) {
    return deltaPass(0, 'New file — baseline created. No comparison needed.');
  }

  const oldW = baseline.totalWarnings;
  const oldE = countErrors(baseline);
  const newW = current.totalWarnings;
  const newE = countErrors(current);

  if (newW > oldW) {
    const delta = newW - oldW;
    return deltaBlock(delta, newE > oldE ? newE - oldE : 0,
      `Lint debt increased by ${delta} warnings (${oldW} → ${newW}). Fix new errors before committing.`);
  }

  if (newW < oldW) {
    const delta = oldW - newW;
    return deltaPass(delta,
      `Lint debt reduced by ${delta} warnings (${oldW} → ${newW}). Good job!`);
  }

  return deltaPass(0, 'No change in lint debt.');
}

// ── Formatting ────────────────────────────────────────────

/**
 * Format baseline as a human-readable summary string.
 */
/**
 * The tools a baseline can carry, and the label each gets in the summary.
 *
 * A table so a new tool appears here and in `TOOL_PARSERS` and nowhere else -- the
 * four counters it replaces were four variables with four near-identical tests.
 */
const SUMMARY_TOOLS: Array<{ field: keyof BaselineEntry; label: string }> = [
  { field: 'eslint', label: 'ESLint' },
  { field: 'ruff', label: 'Ruff' },
  { field: 'golangci', label: 'golangci-lint' },
  { field: 'shellcheck', label: 'ShellCheck' },
];

/** How many baseline entries carry a result for `field`. */
function countFilesFor(baseline: Record<string, BaselineEntry>, field: keyof BaselineEntry): number {
  return Object.values(baseline).filter((entry) => entry[field]).length;
}

export function formatBaselineSummary(baseline: Record<string, BaselineEntry>): string {
  const files = Object.keys(baseline);
  if (files.length === 0) {
    return 'No baseline data available. Run `xpgate baseline create` to initialize.'.replace('xpgate', 'xp-gate');
  }
  const totalWarnings = files.reduce((sum, f) => sum + baseline[f].totalWarnings, 0);

  const lines = [
    'Lint Baseline Summary:',
    `  Files tracked: ${files.length}`,
    `  Total warnings: ${totalWarnings}`,
  ];
  // A tool with no entries is omitted rather than printed as 0: a summary of what the
  // baseline CONTAINS should not list what it does not.
  for (const tool of SUMMARY_TOOLS) {
    const count = countFilesFor(baseline, tool.field);
    if (count > 0) lines.push(`  ${tool.label}: ${count} files`);
  }
  return lines.join('\n');
}
