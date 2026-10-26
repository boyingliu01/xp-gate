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

async function findTestFileForSource(sourceFile: string): Promise<string | null> {
  const ext = path.extname(sourceFile);
  const baseName = path.basename(sourceFile, ext);
  const dir = path.dirname(sourceFile);

  if (ext === '.ts' || ext === '.tsx') {
    return findTsTestFile(sourceFile, dir, baseName);
  }

  if (ext === '.py') {
    const pyTest = sourceFile.replace(/\.py$/, '_test.py');
    if (await fileExists(pyTest)) return pyTest;
    return findPyTestFile(dir, baseName);
  }

  if (ext === '.go') {
    const goTest = sourceFile.replace(/\.go$/, '_test.go');
    if (await fileExists(goTest)) return goTest;
    return null;
  }

  if (ext === '.java') {
    return findJavaTestFile(dir, baseName);
  }

  if (ext === '.kt' || ext === '.kts') {
    return findKotlinTestFile(dir, baseName);
  }

  return null;
}

interface TestIntentCheckResult {
  sourceFile: string;
  testFile: string | null;
  missingAnnotations: string[];
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
    const missingAnnotations: string[] = [];
    if (!detection.annotations.hasTest) missingAnnotations.push('@test');
    if (!detection.annotations.hasIntent) missingAnnotations.push('@intent');
    if (!detection.annotations.hasCovers) missingAnnotations.push('@covers');

    results.push({
      sourceFile,
      testFile,
      missingAnnotations,
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

function globToRegex(pattern: string): RegExp {
  let regexStr = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        regexStr += '.*';
        i += 2;
      } else {
        regexStr += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      regexStr += '[^/]';
      i++;
    } else if ('.[]{}()|^$+\\'.includes(c)) {
      regexStr += '\\' + c;
      i++;
    } else {
      regexStr += c;
      i++;
    }
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

function evaluateScores(
  fileScores: Record<string, number>,
  thresholds: FileThreshold[],
  baseline: MutationBaseline | null
): { evaluations: ScoreEvaluation[]; blocked: boolean; messages: string[] } {
  const evaluations: ScoreEvaluation[] = [];
  const messages: string[] = [];
  let blocked = false;

  for (const ft of thresholds) {
    const score = fileScores[ft.file] ?? 0;
    const baselineScore = baseline?.scores[ft.file]?.score;

    let effectiveThreshold = ft.threshold;
    if (baselineScore !== undefined && score < baselineScore) {
      effectiveThreshold = Math.max(effectiveThreshold, baselineScore);
    }

    const passed = score >= effectiveThreshold;
    const isRegression = baselineScore !== undefined && score < baselineScore;

    const evaluation: ScoreEvaluation = {
      file: ft.file,
      score,
      threshold: effectiveThreshold,
      baselineScore,
      passed,
      isRegression,
    };
    evaluations.push(evaluation);

    if (!passed) blocked = true;
    messages.push(buildScoreMessage({
      file: ft.file,
      score,
      effectiveThreshold,
      baselineScore,
      passed,
      isRegression,
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

async function runAllRunners(
  groups: Map<string, string[]>,
  timeoutMs: number,
  cwd: string
): Promise<{ scores: Record<string, number | null>; counts: Record<string, MutantCounts> }> {
  const fileScores: Record<string, number | null> = {};
  const counts: Record<string, MutantCounts> = {};

  for (const [, files] of Array.from(groups.entries())) {
    const ext = path.extname(files[0]);
    // #410 fallback: walk ALL runners for the extension in priority order and
    // use the first one that is actually available. A pure-mutmut environment
    // (no pytest-gremlins) thus still gets mutation testing instead of a
    // silent SKIP — the design contract "gremlins 可用→GremlinsRunner，否则
    // MutmutRunner" is honored here, not by registration order alone.
    const runner = await resolveFirstAvailable(ext);
    if (!runner) {
      applyNullScores(files, fileScores);
      continue;
    }

    const result = await runner.run({ files, timeoutMs, cwd });
    applyMutationResult(result, files, fileScores, counts);
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

function applyNullScores(files: string[], scores: Record<string, number | null>): void {
  for (const f of files) scores[f] = null;
}

function applyMutationResult(
  outcome: MutationRunOutcome,
  files: string[],
  scores: Record<string, number | null>,
  counts: Record<string, MutantCounts>,
): void {
  if (outcome.timedOut || outcome.error || !outcome.report) {
    for (const f of files) scores[f] = null;
    return;
  }

  if (outcome.report.files) {
    for (const [fileKey, fileReport] of Object.entries(outcome.report.files)) {
      scores[fileKey] = fileReport.mutationScore;
      // #544: keep the outcome counts the reporter already gave us. Dropping
      // them here is what forced buildMutationScores to invent zeros later.
      counts[fileKey] = {
        mutants: fileReport.nrOfMutants,
        killed: fileReport.nrOfKilledMutants,
        survived: fileReport.nrOfSurvivedMutants,
      };
    }
    return;
  }

  const totals: MutantCounts = {
    mutants: outcome.report.nrOfMutants,
    killed: outcome.report.nrOfKilledMutants,
    survived: outcome.report.nrOfSurvivedMutants,
  };
  for (const f of files) {
    scores[f] = outcome.report.mutationScore;
    counts[f] = totals;
  }
}

// ── Main gateway ──

function logThresholdDetails(thresholds: FileThreshold[], baseline: MutationBaseline | null): void {
  if (baseline) {
    console.log(`  Loaded baseline (${Object.keys(baseline.scores).length} files)`);
  }
  for (const ft of thresholds) {
    const level = ft.isCriticalPath ? 'critical path' : 'default';
    const thresholdSource = ft.explicitThreshold !== undefined
      ? 'explicit annotation'
      : ft.isCriticalPath
        ? 'critical path config'
        : 'default';
    console.log(`  ${ft.file}: threshold=${ft.threshold}% (${level}, ${thresholdSource})`);
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

export async function runGateM(options: GateMOptions): Promise<GateMResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const sourceFiles = filterSourceFiles(options.changedFiles);
  if (sourceFiles.length === 0) {
    return buildResult('skip', 0, {}, warnings, errors);
  }

  await collectTestIntentWarnings(sourceFiles, warnings);

  const thresholds = await determineThresholds(sourceFiles, await loadCriticalPaths(options.criticalPathsPath));
  const baseline = await loadBaseline(options.baselinePath);

  logThresholdDetails(thresholds, baseline);

  const groups = groupByRunner(sourceFiles);
  const { scores: fileScoresNullable, counts: mutantCounts } =
    await runAllRunners(groups, options.timeoutMs, process.cwd());

  const { fileScores, timeoutFiles } = partitionScores(fileScoresNullable);
  if (timeoutFiles.length > 0) {
    warnings.push(`Mutation testing timed out for: ${timeoutFiles.join(', ')}. Run locally for full report.`);
  }

  const evaluableThresholds = thresholds.filter(ft => !timeoutFiles.includes(ft.file));
  const evalResult = evaluateScores(fileScores, evaluableThresholds, baseline);
  for (const msg of evalResult.messages) console.log(`  ${msg}`);

  if (timeoutFiles.length > 0) {
    for (const f of timeoutFiles) {
      console.log(`  SKIP ${f}: mutation testing timed out (score unavailable)`);
    }
  }

  if (evalResult.blocked) {
    return buildResult('block', evaluableThresholds.length, buildMutationScores(fileScores, mutantCounts), warnings, errors);
  }
  if (evaluableThresholds.length === 0) {
    return buildResult('skip', 0, {}, warnings, errors);
  }
  return buildResult('pass', evaluableThresholds.length, buildMutationScores(fileScores, mutantCounts), warnings, errors);
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

export async function main(args: string[]): Promise<number> {
  const options = parseArgs(args);

  if (options.changedFiles.length === 0) {
    console.error('Usage: npx tsx src/mutation/gate-m.ts --changed-files "file1.ts,file2.ts" [--baseline <path>] [--critical-paths <path>]');
    return 1;
  }

  console.log(`Gate M: Mutation Testing (LangAdapter)`);
  console.log(`  Changed files: ${options.changedFiles.length}`);
  console.log(`  Baseline: ${options.baselinePath}`);
  console.log(`  Critical paths: ${options.criticalPathsPath}`);
  console.log(`  Timeout: ${options.timeoutMs}ms`);

  const result = await runGateM(options);

  // #544: survivor detail on a machine-readable line. Printed only when a report
  // exists -- absent means "not measured", never "measured: zero survivors".
  const survivors = await readSurvivorSummary();
  if (survivors) {
    console.log(`GATE_M_SURVIVORS_JSON=${JSON.stringify(survivors)}`);
  }

  logDiagnostics(result.warnings, result.errors);

  const statusIcon = result.status === 'pass' ? '✓' :
    result.status === 'skip' ? '⊘' :
    result.status === 'timeout' ? '⏱' : '✗';

  console.log(`\n${statusIcon} Gate M ${result.status.toUpperCase()} (${result.filesChecked} files checked)`);

  return result.exitCode;
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
