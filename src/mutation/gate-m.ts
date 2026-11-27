import fs from 'fs/promises';
import path from 'path';
import {
  GateMOptions,
  GateMResult,
  GateMStatus,
  MutationBaseline,
  MutationScore,
  FileThreshold,
  ScoreEvaluation
} from './types';
import { detectAITestCharacteristics } from './detect-ai-test';
import {
  resolveRunner,
  resolveRunners,
  registerAllRunners,
  MutationRunOutcome,
  MutationRunner,
} from './runners';

// ── Pre-run auto-registration of all language runners ──

registerAllRunners();

const DEFAULT_THRESHOLD = 60;
const CRITICAL_PATH_THRESHOLD = 80;

type ArgHandler = (options: GateMOptions, args: string[], i: number) => void;

const ARG_HANDLERS: Record<string, ArgHandler> = {
  '--changed-files': parseChangedFiles,
  '--baseline': parseBaseline,
  '--critical-paths': parseCriticalPaths,
  '--timeout': parseTimeout,
};

function parseArgs(args: string[]): GateMOptions {
  const options: GateMOptions = {
    changedFiles: [],
    baselinePath: '.mutation-baseline.json',
    criticalPathsPath: '.mutation-critical-paths',
    timeoutMs: 120000,
  };

  for (let i = 0; i < args.length; i++) {
    const handler = ARG_HANDLERS[args[i]];
    if (handler) {
      handler(options, args, i);
    }
  }

  return options;
}

function parseChangedFiles(options: GateMOptions, args: string[], i: number): void {
  const next = args[++i];
  if (next) {
    options.changedFiles = next
      .replace(/\n/g, ',')
      .split(',')
      .map(f => f.trim())
      .filter(Boolean);
  }
}

function parseBaseline(options: GateMOptions, args: string[], i: number): void {
  const next = args[++i];
  if (next) options.baselinePath = next;
}

function parseCriticalPaths(options: GateMOptions, args: string[], i: number): void {
  const next = args[++i];
  if (next) options.criticalPathsPath = next;
}

function parseTimeout(options: GateMOptions, args: string[], i: number): void {
  const next = args[++i];
  if (next) options.timeoutMs = parseInt(next, 10);
}

// ── File filtering: excludes tests, declarations, adapters ──
// Delegate per-language filtering to a helper.
//
// Every exclusion is a "does this normalized path look like X?" question, so
// they are stated as data rather than as a chain of early returns. Keeping the
// list declarative is what makes the rules reviewable: a new convention is one
// line, and the reasons stay attached to the pattern they justify.
export function filterSourceFiles(files: string[]): string[] {
  return files.filter(file => {
    // One separator view for every pattern below: the path arrives from the
    // adapter layer, which on Windows yields backslash-delimited relative paths.
    const normalized = file.replace(/\\/g, '/');
    if (isExcludedPath(normalized)) return false;
    // Skip files with no registered runner
    return resolveRunner(path.extname(file)) !== undefined;
  });
}

const EXCLUDED_PATH_PATTERNS: readonly { pattern: RegExp; reason: string }[] = [
  { pattern: /\.test\.|_test\./, reason: 'test files' },
  // Spec-named test files: the pre-push filter already excludes them, and a
  // mutant inside a *.spec.ts is scored against a production budget (#480).
  { pattern: /\.spec\./, reason: 'spec files' },
  // Test-tree directories: helpers/fixtures/factories there are test
  // infrastructure judged by the suites that run them, not by mutation
  // scoring budgeted for production code (#480)
  { pattern: /(^|\/)(tests?|__tests__)\//, reason: 'test trees' },
  // Java/Kotlin test files: FooTest.java, FooSpec.kt, etc. Case-sensitive
  // "Test"/"Spec"/"IT" suffix matching is what the Surefire/Failsafe
  // conventions actually produce -- `[A-Z]Test\.only` caught MyTest.java but
  // not FooTest.java, so most test classes stayed in the candidate list.
  { pattern: /(Test|Tests|IT|Spec)\.(java|kt|kts)$/, reason: 'JVM test classes' },
  { pattern: /\.d\.ts$/, reason: 'declaration files' },
  { pattern: /\/adapters\//, reason: 'adapter files' },
];

/** True when `normalized` matches any exclusion rule. */
function isExcludedPath(normalized: string): boolean {
  return EXCLUDED_PATH_PATTERNS.some(({ pattern }) => pattern.test(normalized));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findFirstExist(candidates: string[]): Promise<string | null> {
  for (const c of candidates) {
    if (await fileExists(c)) return c;
  }
  return null;
}

async function findTsTestFile(sourceFile: string, dir: string, baseName: string): Promise<string | null> {
  return findFirstExist([
    sourceFile.replace(/\.tsx?$/, '.test.ts'),
    path.join(dir, '__tests__', `${baseName}.test.ts`),
  ]);
}

async function findPyTestFile(dir: string, baseName: string): Promise<string | null> {
  return findFirstExist([
    '', // placeholder for the side-by-side _test.py case (handled inline below)
    path.join('tests', `test_${baseName}.py`),
    path.join(dir, '__tests__', `test_${baseName}.py`),
  ]);
}

async function findJavaTestFile(dir: string, baseName: string): Promise<string | null> {
  const dirs = [
    dir.replace(/\/src\/main\//, '/src/test/'),
    dir.replace(/^src\//, 'src/test/'),
  ];
  const suffixes = ['Test.java', 'Tests.java', 'IT.java'];
  for (const d of dirs) {
    for (const s of suffixes) {
      const c = path.join(d, `${baseName}${s}`);
      if (await fileExists(c)) return c;
    }
  }
  return null;
}

async function findKotlinTestFile(dir: string, baseName: string): Promise<string | null> {
  const dirs = [
    dir.replace(/\/src\/main\//, '/src/test/'),
    dir.replace(/^src\//, 'src/test/'),
  ];
  const suffixes = ['Test.kt', 'Tests.kt', 'Spec.kt'];
  for (const d of dirs) {
    for (const s of suffixes) {
      const c = path.join(d, `${baseName}${s}`);
      if (await fileExists(c)) return c;
    }
  }
  return null;
}

/**
 * A sibling test file by suffix convention (`x.py` -> `x_test.py`), or null.
 *
 * Preferred over a directory search because the suffix form is unambiguous: if it
 * exists, it IS the test for this source, and searching first could find a different
 * file that merely shares the basename.
 */
async function siblingTestFile(sourceFile: string, from: RegExp, to: string): Promise<string | null> {
  const candidate = sourceFile.replace(from, to);
  return (await fileExists(candidate)) ? candidate : null;
}

/** Directories searched for a source's tests, keyed by extension. */
const TEST_FILE_FINDERS: Record<string, (sourceFile: string, dir: string, baseName: string) => Promise<string | null>> = {
  '.ts': (sourceFile, dir, baseName) => findTsTestFile(sourceFile, dir, baseName),
  '.tsx': (sourceFile, dir, baseName) => findTsTestFile(sourceFile, dir, baseName),
  '.py': async (sourceFile, dir, baseName) => (await siblingTestFile(sourceFile, /\.py$/, '_test.py'))
    ?? findPyTestFile(dir, baseName),
  '.go': (sourceFile) => siblingTestFile(sourceFile, /\.go$/, '_test.go'),
  '.java': (_sourceFile, dir, baseName) => findJavaTestFile(dir, baseName),
  '.kt': (_sourceFile, dir, baseName) => findKotlinTestFile(dir, baseName),
  '.kts': (_sourceFile, dir, baseName) => findKotlinTestFile(dir, baseName),
};

/**
 * Locate the test file for a source file, or null when this language's test
 * convention does not apply.
 *
 * A table because the mapping IS the rule: each language names its tests differently,
 * and the order inside each arm (sibling suffix before directory search) is part of
 * that rule rather than an implementation detail.
 */
async function findTestFileForSource(sourceFile: string): Promise<string | null> {
  const finder = TEST_FILE_FINDERS[path.extname(sourceFile)];
  if (!finder) return null;
  const ext = path.extname(sourceFile);
  return finder(sourceFile, path.dirname(sourceFile), path.basename(sourceFile, ext));
}

interface TestIntentCheckResult {
  sourceFile: string;
  testFile: string | null;
  missingAnnotations: string[];
}

/** The mandatory annotations, with the field that records each one. */
const REQUIRED_ANNOTATIONS = [
  { label: '@test', field: 'hasTest' },
  { label: '@intent', field: 'hasIntent' },
  { label: '@covers', field: 'hasCovers' },
];

/**
 * Which mandatory annotations this test file lacks.
 *
 * A table because the three are the same question asked three times; listing them keeps
 * the set in ONE place, which matters when the annotation set changes.
 */
function missingFrom(annotations: Record<string, boolean>): string[] {
  return REQUIRED_ANNOTATIONS.filter((a) => !annotations[a.field]).map((a) => a.label);
}

async function checkTestIntents(sourceFiles: string[]): Promise<TestIntentCheckResult[]> {
  const results: TestIntentCheckResult[] = [];

  for (const sourceFile of sourceFiles) {
    const testFile = await findTestFileForSource(sourceFile);
    if (!testFile) {
      results.push({
        sourceFile,
        testFile: null,
        missingAnnotations: ['@test', '@intent', '@covers'],
      });
      continue;
    }

    const detection = await detectAITestCharacteristics(testFile);
    results.push({
      sourceFile,
      testFile,
      missingAnnotations: missingFrom(detection.annotations),
    });
  }

  return results;
}

async function loadCriticalPaths(configPath: string): Promise<string[]> {
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/** Characters with regex meaning that a glob matches literally. */
const REGEX_SPECIALS = '.[]{}()|^$+\\';

/**
 * The regex fragment for the glob token starting at `i`, and how much it consumed.
 *
 * `**` spans directories, `*` does not (`[^/]*`), and `?` is exactly one non-slash
 * character. That distinction is the whole point of a glob: `src/*.ts` and
 * `src/**.ts` must not match the same set.
 */
/** Single-character glob tokens and their regex equivalents. */
const GLOB_TOKENS: Record<string, string> = {
  '*': '[^/]*',
  '?': '[^/]',
};

/** `**` spans directories; a bare `*` does not. */
const GLOBSTAR = '.*';

function globToken(pattern: string, i: number): { text: string; width: number } {
  const c = pattern[i];
  if (c === '*' && pattern[i + 1] === '*') return { text: GLOBSTAR, width: 2 };
  const token = GLOB_TOKENS[c];
  if (token) return { text: token, width: 1 };
  // A regex-special character matches itself literally in a glob, so it is escaped.
  return { text: REGEX_SPECIALS.includes(c) ? `\\${c}` : c, width: 1 };
}

function globToRegex(pattern: string): RegExp {
  let regexStr = '';
  for (let i = 0; i < pattern.length;) {
    const token = globToken(pattern, i);
    regexStr += token.text;
    i += token.width;
  }
  return new RegExp(`^${regexStr}$`);
}

function isCriticalPath(file: string, patterns: string[]): boolean {
  return patterns.some(pattern => globToRegex(pattern).test(file));
}

async function loadBaseline(baselinePath: string): Promise<MutationBaseline | null> {
  try {
    const content = await fs.readFile(baselinePath, 'utf-8');
    const parsed = JSON.parse(content) as MutationBaseline;
    if (
      typeof parsed.version === 'string' &&
      typeof parsed.scores === 'object' &&
      parsed.scores !== null
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

async function determineThresholds(
  sourceFiles: string[],
  criticalPaths: string[]
): Promise<FileThreshold[]> {
  const thresholds: FileThreshold[] = [];

  for (const file of sourceFiles) {
    const testFile = await findTestFileForSource(file);
    let explicitThreshold: number | undefined;
    if (testFile) {
      const detection = await detectAITestCharacteristics(testFile);
      explicitThreshold = detection.explicitThreshold;
    }

    const isCritical = isCriticalPath(file, criticalPaths);
    const threshold = explicitThreshold !== undefined
      ? explicitThreshold
      : isCritical
        ? CRITICAL_PATH_THRESHOLD
        : DEFAULT_THRESHOLD;

    thresholds.push({
      file,
      threshold,
      isCriticalPath: isCritical,
      explicitThreshold,
    });
  }

  return thresholds;
}

// ── Per-file extension grouping → route to correct runner ──

function groupByRunner(files: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const file of files) {
    const ext = path.extname(file);
    const runner = resolveRunner(ext);
    if (!runner) continue;

    const key = runner.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(file);
  }

  return groups;
}

/**
 * Evaluate one file against its threshold.
 *
 * The threshold can only RISE, never fall: when the baseline scored higher than the
 * configured threshold, the baseline becomes the effective one. Otherwise a file that was
 * already good could regress back to the ceiling without being flagged -- the baseline
 * records what was ACHIEVED, and the threshold records what is merely REQUIRED.
 */
function evaluateOne(ft: FileThreshold, fileScores: Record<string, number>, baseline: MutationBaseline | null): ScoreEvaluation {
  const score = fileScores[ft.file] ?? 0;
  const baselineScore = baseline?.scores[ft.file]?.score;
  const regressed = baselineScore !== undefined && score < baselineScore;
  const threshold = regressed ? Math.max(ft.threshold, baselineScore) : ft.threshold;
  return {
    file: ft.file,
    score,
    threshold,
    baselineScore,
    passed: score >= threshold,
    isRegression: regressed,
  };
}

function evaluateScores(
  fileScores: Record<string, number>,
  thresholds: FileThreshold[],
  baseline: MutationBaseline | null
): { evaluations: ScoreEvaluation[]; blocked: boolean; messages: string[] } {
  const evaluations: ScoreEvaluation[] = [];
  const messages: string[] = [];
  let blocked = false;

  for (const ft of thresholds) {
    const evaluation = evaluateOne(ft, fileScores, baseline);
    evaluations.push(evaluation);
    if (!evaluation.passed) blocked = true;
    messages.push(buildScoreMessage({
      file: evaluation.file,
      score: evaluation.score,
      effectiveThreshold: evaluation.threshold,
      baselineScore: evaluation.baselineScore,
      passed: evaluation.passed,
      isRegression: evaluation.isRegression,
    }));
  }

  return { evaluations, blocked, messages };
}

interface ScoreMessageParams {
  file: string;
  score: number;
  effectiveThreshold: number;
  baselineScore: number | undefined;
  passed: boolean;
  isRegression: boolean;
}

function buildScoreMessage(params: ScoreMessageParams): string {
  const { file, score, effectiveThreshold, baselineScore, passed, isRegression } = params;
  if (!passed) {
    if (isRegression && baselineScore !== undefined) {
      return `BLOCK ${file}: mutation score ${score.toFixed(1)}% < baseline ${baselineScore.toFixed(1)}% (was ${effectiveThreshold}% threshold)`;
    }
    return `BLOCK ${file}: mutation score ${score.toFixed(1)}% < threshold ${effectiveThreshold}%`;
  }
  return `PASS ${file}: mutation score ${score.toFixed(1)}% >= ${effectiveThreshold}%${baselineScore !== undefined ? ` (baseline: ${baselineScore.toFixed(1)}%)` : ''}`;
}

function buildResult(
  status: GateMStatus,
  filesChecked: number,
  scores: Record<string, MutationScore>,
  warnings: string[],
  errors: string[]
): GateMResult {
  return {
    exitCode: status === 'block' ? 1 : 0,
    status,
    filesChecked,
    scores,
    warnings,
    errors,
  };
}

/**
 * Run one extension group, recording its scores and counts.
 *
 * #410 fallback: walk ALL runners for the extension in priority order and use the first
 * one that is actually AVAILABLE. A pure-mutmut environment (no pytest-gremlins) thus
 * still gets mutation testing instead of a silent SKIP -- the design contract
 * "gremlins when available, else mutmut" is honoured here, not by registration order
 * alone.
 */
async function runOneGroup(
  files: string[],
  timeoutMs: number,
  cwd: string,
  fileScores: Record<string, number | null>,
  counts: Record<string, MutantCounts>,
): Promise<void> {
  const runner = await resolveFirstAvailable(path.extname(files[0]));
  if (!runner) {
    // Null, not 0: this run did not score these files, and a zero would be
    // indistinguishable from a measured failure.
    for (const f of files) fileScores[f] = null;
    return;
  }
  const result = await runner.run({ files, timeoutMs, cwd });
  applyMutationResult(result, files, fileScores, counts);
}

async function runAllRunners(
  groups: Map<string, string[]>,
  timeoutMs: number,
  cwd: string
): Promise<{ scores: Record<string, number | null>; counts: Record<string, MutantCounts> }> {
  const fileScores: Record<string, number | null> = {};
  const counts: Record<string, MutantCounts> = {};
  for (const [, files] of Array.from(groups.entries())) {
    await runOneGroup(files, timeoutMs, cwd, fileScores, counts);
  }
  return { scores: fileScores, counts };
}

/**
 * Pick the first AVAILABLE runner for an extension, honoring registration
 * priority. Returns undefined when no registered runner for the extension is
 * installed on this machine.
 */
async function resolveFirstAvailable(ext: string): Promise<MutationRunner | undefined> {
  for (const candidate of resolveRunners(ext)) {
    if (await candidate.isAvailable()) return candidate;
  }
  return undefined;
}


export function applyMutationResult(
  outcome: MutationRunOutcome,
  files: string[],
  scores: Record<string, number | null>,
  counts: Record<string, MutantCounts>,
): void {
  // A run that timed out or errored measured NOTHING: null, not 0, so the caller
  // cannot mistake "not measured" for "scored zero".
  if (outcome.timedOut || outcome.error || !outcome.report) {
    // Null, not 0: a timed-out or errored run measured nothing here.
    for (const f of files) scores[f] = null;
    return;
  }
  // Per-file reporting is the modern shape; without it the run's totals apply to every
  // file, which is all the older reporters gave.
  if (outcome.report.files) {
    // Every file this run was asked about MUST end up with a score, null included. A
    // reporter that omits one (older Stryker builds skip files with no mutants) would
    // otherwise leave the key absent, and the evaluator's `?? 0` reads an absent key as a
    // MEASURED zero -- the exact confusion this function exists to prevent (review FC-01).
    for (const f of files) scores[f] = null;
    applyPerFileScores(outcome.report.files, scores, counts);
    return;
  }
  applyTotalsToAll(files, outcome.report, scores, counts);
}

/**
 * Record per-file scores and counts.
 *
 * #544: the outcome counts the reporter gave us are KEPT. Dropping them here is what
 * forced `buildMutationScores` to invent zeros later -- and an invented zero is
 * indistinguishable from a measured one downstream.
 */
function applyPerFileScores(
  fileReports: Record<string, FileMutationReport>,
  scores: Record<string, number | null>,
  counts: Record<string, MutantCounts>,
): void {
  for (const [fileKey, report] of Object.entries(fileReports)) {
    scores[fileKey] = report.mutationScore;
    counts[fileKey] = {
      mutants: report.nrOfMutants,
      killed: report.nrOfKilledMutants,
      survived: report.nrOfSurvivedMutants,
    };
  }
}

/** Apply a run's overall score and totals to every file it covered. */
function applyTotalsToAll(
  files: string[],
  report: MutationRunReport,
  scores: Record<string, number | null>,
  counts: Record<string, MutantCounts>,
): void {
  const totals: MutantCounts = {
    mutants: report.nrOfMutants,
    killed: report.nrOfKilledMutants,
    survived: report.nrOfSurvivedMutants,
  };
  for (const f of files) {
    scores[f] = report.mutationScore;
    counts[f] = totals;
  }
}

// ── Main gateway ──

/**
 * Where a file's threshold came from.
 *
 * Printed because the number alone does not tell the reader whether to change the
 * annotation or the config -- and an explicit annotation outranks a critical-path one,
 * so the order here is the precedence.
 */
function thresholdSource(ft: FileThreshold): string {
  if (ft.explicitThreshold !== undefined) return 'explicit annotation';
  return ft.isCriticalPath ? 'critical path config' : 'default';
}

/** One line per file, naming the threshold and where it came from. */
function logThresholdDetails(thresholds: FileThreshold[], baseline: MutationBaseline | null): void {
  if (baseline) console.log(`  Loaded baseline (${Object.keys(baseline.scores).length} files)`);
  for (const ft of thresholds) {
    const level = ft.isCriticalPath ? 'critical path' : 'default';
    console.log(`  ${ft.file}: threshold=${ft.threshold}% (${level}, ${thresholdSource(ft)})`);
  }
}

/**
 * Per-file mutant outcome counts, as reported by the runner. Absent fields mean
 * "the runner did not say", which is different from a measured zero -- the whole
 * point of #544 is that those two must not collapse into each other.
 */
export interface MutantCounts {
  mutants?: number;
  killed?: number;
  survived?: number;
}

export function buildMutationScores(
  fileScores: Record<string, number>,
  counts: Record<string, MutantCounts> = {},
): Record<string, MutationScore> {
  const scores: Record<string, MutationScore> = {};
  for (const [file, score] of Object.entries(fileScores)) {
    const c = counts[file];
    const entry: MutationScore = { score } as MutationScore;
    // Only attach what the runner actually reported. Writing `survived: 0` for
    // an unmeasured file is what made a skipped run look like a clean one.
    if (c) {
      if (c.mutants !== undefined) entry.mutants = c.mutants;
      if (c.killed !== undefined) entry.killed = c.killed;
      if (c.survived !== undefined) entry.survived = c.survived;
    }
    scores[file] = entry;
  }
  return scores;
}

/**
 * The subset of a runner report that survivor summarisation needs. Declared
 * structurally rather than as a concrete Stryker type because every runner
 * (Stryker, mutmut, gremlins, go-mutant) normalises to `MutationRunResult`,
 * which carries the same field names -- the summary must work for all of them,
 * not just the TS one.
 */
export interface StrykerReportLike {
  mutationScore: number;
  nrOfMutants: number;
  nrOfKilledMutants: number;
  nrOfSurvivedMutants: number;
  files?: Record<string, {
    mutationScore: number;
    nrOfMutants: number;
    nrOfKilledMutants: number;
    nrOfSurvivedMutants: number;
  }>;
}

/** Per-file mutant outcome detail for the pre-push journal (#544). */
export interface SurvivorSummary {
  /** Files with at least one surviving mutant, worst first, capped by `limit`. */
  survivedByFile: Record<string, number>;
  /**
   * How many files actually had survivors. Present so a capped map can be told
   * apart from a complete one -- a truncated list that looks exhaustive is how
   * "top 20" gets read as "all files".
   */
  filesWithSurvivors: number;
  /** True when `survivedByFile` dropped entries to stay under `limit`. */
  truncated: boolean;
  mutants: number;
  killed: number;
  survived: number;
}

/**
 * Condense a Stryker report into survivor detail (#544).
 *
 * Returns `null` -- never a summary of zeros -- when the report is missing or
 * carries no per-file section. A timed-out or failed run has no measurements,
 * and writing `survived: 0` next to a real-looking score would report
 * "measured: no survivors" for a run that measured nothing. That is the exact
 * shape of false success this project keeps finding, so unknown stays `null`.
 */
export function summarizeSurvivors(
  report: StrykerReportLike | null | undefined,
  options: { limit?: number } = {},
): SurvivorSummary | null {
  if (!report || !report.files) return null;

  const limit = options.limit ?? 20;
  const survivors: Array<[string, number]> = [];
  let mutants = 0;
  let killed = 0;
  let survived = 0;

  for (const [file, entry] of Object.entries(report.files)) {
    const fileSurvived = entry.nrOfSurvivedMutants ?? 0;
    mutants += entry.nrOfMutants ?? 0;
    killed += entry.nrOfKilledMutants ?? 0;
    survived += fileSurvived;
    if (fileSurvived > 0) survivors.push([file, fileSurvived]);
  }

  // Worst first, then by path so equal counts order deterministically.
  survivors.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const kept = survivors.slice(0, limit);

  return {
    survivedByFile: Object.fromEntries(kept),
    filesWithSurvivors: survivors.length,
    truncated: survivors.length > kept.length,
    mutants,
    killed,
    survived,
  };
}

/**
 * Warn about files whose measurement TIMED OUT.
 *
 * Their thresholds leave the evaluation entirely, so they must be called out here -- an
 * unmeasured file that silently drops out of the check reads as a pass.
 */
function noteTimeouts(timeoutFiles: string[], warnings: string[]): void {
  if (timeoutFiles.length === 0) return;
  warnings.push(`Mutation testing timed out for: ${timeoutFiles.join(', ')}. Run locally for full report.`);
}

/** Print one indented line per score message. */
function printScoreMessages(messages: string[]): void {
  for (const msg of messages) console.log(`  ${msg}`);
}

/**
 * The per-file thresholds and the recorded baseline, logged once.
 *
 * Grouped because the two are ALWAYS read together and their log line names both: a
 * threshold printed without the baseline it is compared against is half the story.
 */
async function resolveThresholds(options: GateMOptions, sourceFiles: string[]) {
  const thresholds = await determineThresholds(sourceFiles, await loadCriticalPaths(options.criticalPathsPath));
  const baseline = await loadBaseline(options.baselinePath);
  logThresholdDetails(thresholds, baseline);
  return { thresholds, baseline };
}

export async function runGateM(options: GateMOptions): Promise<GateMResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const sourceFiles = filterSourceFiles(options.changedFiles);
  if (sourceFiles.length === 0) {
    return buildResult('skip', 0, {}, warnings, errors);
  }

  await collectTestIntentWarnings(sourceFiles, warnings);

  const { thresholds, baseline } = await resolveThresholds(options, sourceFiles);

  const groups = groupByRunner(sourceFiles);
  const { scores: fileScoresNullable, counts: mutantCounts } =
    await runAllRunners(groups, options.timeoutMs, process.cwd());

  const { fileScores, timeoutFiles } = partitionScores(fileScoresNullable);
  noteTimeouts(timeoutFiles, warnings);
  const evaluableThresholds = thresholds.filter(ft => !timeoutFiles.includes(ft.file));
  const evalResult = evaluateScores(fileScores, evaluableThresholds, baseline);
  printScoreMessages(evalResult.messages);

  printTimeouts(timeoutFiles);
  return finalVerdict({ evalResult, evaluableThresholds, fileScores, mutantCounts, warnings, errors });
}

/** One SKIP line per file whose measurement timed out. */
function printTimeouts(timeoutFiles: string[]): void {
  for (const f of timeoutFiles) {
    console.log(`  SKIP ${f}: mutation testing timed out (score unavailable)`);
  }
}

/**
 * The gate's final verdict.
 *
 * Order matters: a BLOCK outranks everything, and an empty threshold list is a SKIP
 * because NOTHING was evaluated -- reporting PASS there would claim a check that never
 * had a criterion to apply.
 */
/** What the final verdict needs from the run. */
interface VerdictInput {
  evalResult: { blocked: boolean };
  evaluableThresholds: FileThreshold[];
  fileScores: Record<string, number>;
  mutantCounts: Record<string, MutantCounts>;
  warnings: string[];
  errors: string[];
}

function finalVerdict({ evalResult, evaluableThresholds, fileScores, mutantCounts, warnings, errors }: VerdictInput) {
  const count = evaluableThresholds.length;
  if (evalResult.blocked) {
    return buildResult('block', count, buildMutationScores(fileScores, mutantCounts), warnings, errors);
  }
  if (count === 0) return buildResult('skip', 0, {}, warnings, errors);
  return buildResult('pass', count, buildMutationScores(fileScores, mutantCounts), warnings, errors);
}

interface PartitionedScores {
  fileScores: Record<string, number>;
  timeoutFiles: string[];
}

function partitionScores(input: Record<string, number | null>): PartitionedScores {
  const fileScores: Record<string, number> = {};
  const timeoutFiles: string[] = [];
  for (const [file, maybeScore] of Object.entries(input)) {
    if (maybeScore === null) {
      timeoutFiles.push(file);
    } else {
      fileScores[file] = maybeScore;
    }
  }
  return { fileScores, timeoutFiles };
}

async function collectTestIntentWarnings(sourceFiles: string[], warnings: string[]): Promise<void> {
  const results = await checkTestIntents(sourceFiles);
  for (const result of results) {
    if (result.missingAnnotations.length > 0) {
      const testFileInfo = result.testFile ? ` (${result.testFile})` : ' (no test file found)';
      warnings.push(
        `Warning: ${result.sourceFile}${testFileInfo} missing annotations: ${result.missingAnnotations.join(', ')}`
      );
    }
  }
}

/**
 * Read the mutation report the runner left on disk and summarise it (#544).
 * Returns null when there is no readable report -- the caller then prints
 * nothing, and the journal field stays absent. Every failure here is silent by
 * design: #544 explicitly requires that missing detail must not turn Gate M
 * itself into a failure.
 */
async function readSurvivorSummary(): Promise<SurvivorSummary | null> {
  try {
    const raw = await fs.readFile('.stryker-report.json', 'utf-8');
    return summarizeSurvivors(JSON.parse(raw) as StrykerReportLike);
  } catch {
    return null;
  }
}

/**
 * Refuse an invocation that names no files.
 *
 * Exit 1 rather than a default scan: mutation testing without a change set would score
 * the WHOLE repository, which is slow and not what a commit-time gate asked for.
 */
function printUsageAndFail(): number {
  console.error('Usage: npx tsx src/mutation/gate-m.ts --changed-files "file1.ts,file2.ts" [--baseline <path>] [--critical-paths <path>]');
  return 1;
}

/** Echo the resolved arguments, so a surprising run is explainable from its own output. */
function printArguments(options: ReturnType<typeof parseArgs>): void {
  console.log(`Gate M: Mutation Testing (LangAdapter)`);
  console.log(`  Changed files: ${options.changedFiles.length}`);
  console.log(`  Baseline: ${options.baselinePath}`);
  console.log(`  Critical paths: ${options.criticalPathsPath}`);
  console.log(`  Timeout: ${options.timeoutMs}ms`);
}

export async function main(args: string[]): Promise<number> {
  const options = parseArgs(args);

  if (options.changedFiles.length === 0) return printUsageAndFail();

  printArguments(options);

  const result = await runGateM(options);

  // #544: survivor detail on a machine-readable line. Printed only when a report
  // exists -- absent means "not measured", never "measured: zero survivors".
  await printSurvivors();
  logDiagnostics(result.warnings, result.errors);
  console.log(`\n${statusIconOf(result.status)} Gate M ${result.status.toUpperCase()} (${result.filesChecked} files checked)`);
  return result.exitCode;
}

/**
 * Print the survivor detail on a machine-readable line, when a report exists.
 *
 * Absent means "not measured", never "measured: zero survivors" (#544). `readSurvivorSummary`
 * already returns null for a missing or unparsable report, so this prints nothing then.
 */
async function printSurvivors(): Promise<void> {
  const survivors = await readSurvivorSummary();
  if (!survivors) return;
  console.log(`GATE_M_SURVIVORS_JSON=${JSON.stringify(survivors)}`);
}

/** The one-character status marker, keyed by the verdict. */
const STATUS_ICONS: Record<string, string> = {
  pass: '\u2713',
  skip: '\u2298',
  timeout: '\u23F1',
};

/** The marker for a verdict; anything unrecognised reads as a failure. */
function statusIconOf(status: string): string {
  return STATUS_ICONS[status] ?? '\u2717';
}

/** Print Gate M's warnings and errors. Errors go to stderr. */
function logDiagnostics(warnings: string[], errors: string[]): void {
  if (warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of warnings) console.log(`  ⚠ ${warning}`);
  }
  if (errors.length > 0) {
    console.log('\nErrors:');
    for (const error of errors) console.error(`  ✗ ${error}`);
  }
}

const cliArgs = process.argv.slice(2);
if (typeof require !== 'undefined' && require.main === module) {
  main(cliArgs)
    .then(exitCode => {
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    })
    .catch(err => {
      console.error('Gate M failed:', err.message);
      process.exit(1);
    });
}
/**
 * One file's entry in a RAW reporter payload, as much as this gateway reads.
 *
 * Deliberately NOT `MutationFileReport` from `runners/types.ts`, which looks similar and
 * is not: that one describes a VALIDATED result (every field required, score never null),
 * while this describes untrusted JSON straight off a reporter. Widening the validated type
 * to `number | null` to share it would delete the guarantee that a parsed result is
 * complete -- the opposite of what the type is for (review technical CI-01 read the two as
 * duplicates).
 */
interface FileMutationReport {
  mutationScore: number | null;
  nrOfMutants?: number;
  nrOfKilledMutants?: number;
  nrOfSurvivedMutants?: number;
}

/** A mutation run's overall report, for reporters that only give totals. */
interface MutationRunReport extends FileMutationReport {
  files?: Record<string, FileMutationReport>;
}
