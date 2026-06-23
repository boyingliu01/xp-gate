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
  registerAllRunners,
  RunMutationOptions,
  MutationRunOutcome,
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
    options.changedFiles = next.split(',').map(f => f.trim()).filter(Boolean);
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

function filterSourceFiles(files: string[]): string[] {
  return files.filter(file => {
    const ext = path.extname(file);
    // Skip test files
    if (file.includes('.test.') || file.includes('_test.')) return false;
    // Skip declaration files
    if (file.endsWith('.d.ts')) return false;
    // Skip adapter files
    if (file.includes('/adapters/')) return false;
    // Skip files with no registered runner
    const runner = resolveRunner(ext);
    return runner !== undefined;
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findTestFileForSource(sourceFile: string): Promise<string | null> {
  const ext = path.extname(sourceFile);
  const baseName = path.basename(sourceFile, ext);
  const dir = path.dirname(sourceFile);

  if (ext === '.ts' || ext === '.tsx') {
    // TypeScript: foo.ts → foo.test.ts
    const testFile1 = sourceFile.replace(/\.tsx?$/, '.test.ts');
    if (await fileExists(testFile1)) return testFile1;

    const testFile2 = path.join(dir, '__tests__', `${baseName}.test.ts`);
    if (await fileExists(testFile2)) return testFile2;
  }

  if (ext === '.py') {
    // Python: foo.py → foo_test.py or tests/test_foo.py
    const testFile1 = sourceFile.replace(/\.py$/, '_test.py');
    if (await fileExists(testFile1)) return testFile1;

    const testFile2 = path.join('tests', `test_${baseName}.py`);
    if (await fileExists(testFile2)) return testFile2;

    const testFile3 = path.join(dir, '__tests__', `test_${baseName}.py`);
    if (await fileExists(testFile3)) return testFile3;
  }

  if (ext === '.go') {
    // Go: foo.go → foo_test.go (same directory, idiomatic convention)
    const testFile1 = sourceFile.replace(/\.go$/, '_test.go');
    if (await fileExists(testFile1)) return testFile1;
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
): Promise<Record<string, number | null>> {
  const fileScores: Record<string, number | null> = {};

  for (const [, files] of Array.from(groups.entries())) {
    const runner = resolveRunner(path.extname(files[0]));
    if (!runner) continue;

    if (!await runner.isAvailable()) {
      for (const f of files) fileScores[f] = null;
      continue;
    }

    const options: RunMutationOptions = {
      files,
      timeoutMs,
      cwd,
    };

    const outcome: MutationRunOutcome = await runner.run(options);

    if (outcome.timedOut) {
      for (const f of files) fileScores[f] = null;
      continue;
    }

    if (outcome.error) {
      for (const f of files) fileScores[f] = null;
      continue;
    }

    if (!outcome.report) {
      for (const f of files) fileScores[f] = null;
      continue;
    }

    // If per-file scores exist, use them
    if (outcome.report.files) {
      for (const [fileKey, fileReport] of Object.entries(outcome.report.files)) {
        fileScores[fileKey] = fileReport.mutationScore;
      }
    } else {
      // Top-level score applies to all files
      for (const f of files) {
        fileScores[f] = outcome.report.mutationScore;
      }
    }
  }

  return fileScores;
}

// ── Main gateway ──

export async function runGateM(options: GateMOptions): Promise<GateMResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const sourceFiles = filterSourceFiles(options.changedFiles);

  if (sourceFiles.length === 0) {
    return buildResult('skip', 0, {}, warnings, errors);
  }

  // Test intent check (async, fire-and-forget warning)
  await collectTestIntentWarnings(sourceFiles, warnings);

  const thresholds = await determineThresholds(sourceFiles, await loadCriticalPaths(options.criticalPathsPath));
  const baseline = await loadBaseline(options.baselinePath);

  if (baseline) {
    console.log(`  Loaded baseline from ${options.baselinePath} (${Object.keys(baseline.scores).length} files)`);
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

  // Route to runners by file extension
  const groups = groupByRunner(sourceFiles);
  const cwd = process.cwd();
  const fileScoresNullable = await runAllRunners(groups, options.timeoutMs, cwd);

  // Build final scores map
  const fileScores: Record<string, number> = {};
  const timeoutFiles: string[] = [];

  for (const [file, maybeScore] of Object.entries(fileScoresNullable)) {
    if (maybeScore === null) {
      timeoutFiles.push(file);
    } else {
      fileScores[file] = maybeScore;
    }
  }

  if (timeoutFiles.length > 0) {
    warnings.push(`Mutation testing timed out for: ${timeoutFiles.join(', ')}. Run locally for full report.`);
  }

  const evalResult = evaluateScores(fileScores, thresholds, baseline);

  for (const msg of evalResult.messages) {
    console.log(`  ${msg}`);
  }

  const mutationScores: Record<string, MutationScore> = {};
  for (const [file, score] of Object.entries(fileScores)) {
    mutationScores[file] = {
      score,
      mutants: 0, // Detailed stats only available from per-file reports
      killed: 0,
      survived: 0,
    };
  }

  if (evalResult.blocked) {
    return buildResult('block', sourceFiles.length, mutationScores, warnings, errors);
  }

  return buildResult('pass', sourceFiles.length, mutationScores, warnings, errors);
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

  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of result.warnings) {
      console.log(`  ⚠ ${warning}`);
    }
  }

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const error of result.errors) {
      console.error(`  ✗ ${error}`);
    }
  }

  const statusIcon = result.status === 'pass' ? '✓' :
    result.status === 'skip' ? '⊘' :
    result.status === 'timeout' ? '⏱' : '✗';

  console.log(`\n${statusIcon} Gate M ${result.status.toUpperCase()} (${result.filesChecked} files checked)`);

  return result.exitCode;
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
