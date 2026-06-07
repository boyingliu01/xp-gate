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
function parseESLint(parsed: ESLintFileResult[], files: string[]): Record<string, BaselineEntry> {
  const result: Record<string, BaselineEntry> = {};
  const fileSet = new Set(files);

  for (const fileResult of parsed) {
    // Try to find a match in the files list
    const matchedFile = files.find(f =>
      fileResult.filePath.endsWith(f) || f.endsWith(fileResult.filePath)
    );
    if (!matchedFile || !fileSet.has(matchedFile)) continue;

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
  const fileSet = new Set(files);
  const warningsByFile: Record<string, { warnings: number; errors: number }> = {};

  for (const item of parsed) {
    const matchedFile = files.find(f => item.file.endsWith(f));
    if (!matchedFile || !fileSet.has(matchedFile)) continue;

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
export function parseLintOutput(
  tool: string,
  output: string,
  files: string[],
): Record<string, BaselineEntry> {
  if (!output || output === '[]' || output === '{}') return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return {};
  }

  switch (tool) {
    case 'eslint':
      return parseESLint(parsed as ESLintFileResult[], files);
    case 'ruff':
      return parseRuff(parsed as RuffFileResult[], files);
    case 'golangci':
      return parseGolangci(parsed as GolangciOutput, files);
    case 'shellcheck':
      return parseShellcheck(parsed as ShellcheckResult[], files);
    default:
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
  const filesAdded: LintDiffFileResult[] = [];
  const filesRemoved: LintDiffFileResult[] = [];
  const filesIncreased: LintDiffFileResult[] = [];
  const filesDecreased: LintDiffFileResult[] = [];
  const filesUnchanged: LintDiffFileResult[] = [];
  let totalWarningsDelta = 0;

  const allFiles = new Set([...Object.keys(oldBaseline), ...Object.keys(newBaseline)]);

  for (const file of allFiles) {
    const oldEntry = oldBaseline[file];
    const newEntry = newBaseline[file];
    const oldW = oldEntry ? getEffectiveWarnings(oldEntry) : 0;
    const newW = newEntry ? getEffectiveWarnings(newEntry) : 0;
    const delta = newW - oldW;

    totalWarningsDelta += delta;

    const result: LintDiffFileResult = { file, oldWarnings: oldW, newWarnings: newW, warningsDelta: delta };

    if (!oldEntry && newEntry) {
      filesAdded.push(result);
    } else if (oldEntry && !newEntry) {
      filesRemoved.push(result);
    } else if (delta > 0) {
      filesIncreased.push(result);
    } else if (delta < 0) {
      filesDecreased.push(result);
    } else {
      filesUnchanged.push(result);
    }
  }

  return {
    totalWarningsDelta,
    filesAdded,
    filesRemoved,
    filesIncreased,
    filesDecreased,
    filesUnchanged,
  };
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
export function computeLintDelta(
  baseline: BaselineEntry | null,
  current: BaselineEntry,
): LintDeltaResult {
  if (!baseline) {
    return {
      enforcement: 'PASS',
      newWarnings: 0,
      newErrors: 0,
      reduction: 0,
      message: 'New file — baseline created. No comparison needed.',
    };
  }

  const oldW = baseline.totalWarnings;
  const oldE = (baseline.eslint?.errors || 0) +
    (baseline.ruff?.errors || 0) +
    (baseline.golangci?.errors || 0) +
    (baseline.shellcheck?.errors || 0);
  const newW = current.totalWarnings;
  const newE = (current.eslint?.errors || 0) +
    (current.ruff?.errors || 0) +
    (current.golangci?.errors || 0) +
    (current.shellcheck?.errors || 0);

  if (newW > oldW) {
    return {
      enforcement: 'BLOCK',
      newWarnings: newW - oldW,
      newErrors: newE > oldE ? newE - oldE : 0,
      reduction: 0,
      message: `Lint debt increased by ${newW - oldW} warnings (${oldW} → ${newW}). Fix new errors before committing.`,
    };
  }

  if (newW < oldW) {
    return {
      enforcement: 'PASS',
      newWarnings: 0,
      newErrors: 0,
      reduction: oldW - newW,
      message: `Lint debt reduced by ${oldW - newW} warnings (${oldW} → ${newW}). Good job!`,
    };
  }

  return {
    enforcement: 'PASS',
    newWarnings: 0,
    newErrors: 0,
    reduction: 0,
    message: 'No change in lint debt.',
  };
}

// ── Formatting ────────────────────────────────────────────

/**
 * Format baseline as a human-readable summary string.
 */
export function formatBaselineSummary(baseline: Record<string, BaselineEntry>): string {
  const files = Object.keys(baseline);
  if (files.length === 0) {
    return 'No baseline data available. Run `xp-gate baseline create` to initialize.';
  }

  const totalWarnings = files.reduce((sum, f) => sum + baseline[f].totalWarnings, 0);

  // Count tool usage
  let eslintFiles = 0;
  let ruffFiles = 0;
  let golangciFiles = 0;
  let shellcheckFiles = 0;

  for (const entry of Object.values(baseline)) {
    if (entry.eslint) eslintFiles++;
    if (entry.ruff) ruffFiles++;
    if (entry.golangci) golangciFiles++;
    if (entry.shellcheck) shellcheckFiles++;
  }

  const lines: string[] = [
    `Lint Baseline Summary:`,
    `  Files tracked: ${files.length}`,
    `  Total warnings: ${totalWarnings}`,
  ];

  if (eslintFiles > 0) lines.push(`  ESLint: ${eslintFiles} files`);
  if (ruffFiles > 0) lines.push(`  Ruff: ${ruffFiles} files`);
  if (golangciFiles > 0) lines.push(`  golangci-lint: ${golangciFiles} files`);
  if (shellcheckFiles > 0) lines.push(`  ShellCheck: ${shellcheckFiles} files`);

  return lines.join('\n');
}
