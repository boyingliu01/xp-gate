import * as fs from 'fs/promises';
import { analyze, getAdapterForFile } from './analyzer';
import { getAllRules } from './index';
import { isDirectExecution } from './direct-execution.js';

interface FileClassification {
  new: string[];
  modified: string[];
  deleted: string[];
  renamed: { oldPath: string; newPath: string }[];
}

/** A git rename line is `R<score> <oldPath> <newPath>` -- three fields minimum. */
const RENAME_PARTS = 3;

/**
 * A file already tracked with at most this many warnings must be brought to
 * zero the next time it is modified. Above it, the normal "must not increase"
 * contract applies. Named rather than inlined so the threshold is greppable and
 * so it stops registering as a magic number.
 */
const SMALL_WARNING_BUDGET = 5;

// Exported helper to get warning counts for a batch of files using the principles checker
export async function analyzeWarningsForFiles(filesInput: string | string[]): Promise<Record<string, number>> {
  const files = (typeof filesInput === 'string' ? filesInput.split(',') : filesInput)
    .flatMap(f => f.split(',').map(s => s.trim()))
    .filter(f => f);
  if (files.length === 0) {
    return {};
  }

  const rules = getAllRules();
  const result = await analyze(files, rules, getAdapterForFile);

  const fileWarnings: Record<string, number> = {};
  
  // Initialize all requested files with 0 warnings
  for (const file of files) {
    fileWarnings[file] = 0;
  }
  
  // Count violations per file
  for (const violation of result.violations) {
    // Only count warnings and errors (ignore info level)
    if (violation.severity === 'warning' || violation.severity === 'error') {
      fileWarnings[violation.file] = (fileWarnings[violation.file] || 0) + 1;
    }
  }
  
  return fileWarnings;
}

interface BaselineEntry {
  eslint?: { warnings: number; errors: number };
  principles?: { warnings: number; errors: number };
  ccn?: { warnings: number; max: number };
  totalWarnings: number;
  lastAnalyzed: string;
}

interface DeltaResult {
  file: string;
  status: 'NEW' | 'MODIFIED' | 'UNCHANGED';
  baselineWarnings: number;
  currentWarnings: number;
  delta: number;
  enforcement: 'PASS' | 'BLOCK';
  reason: string;
}

interface EnforcementResult {
  overallStatus: 'PASS' | 'BLOCK';
  violations: DeltaResult[];
  detailedReport: DeltaResult[];
  summary: {
    totalFiles: number;
    passedFiles: number;
    blockedFiles: number;
  };
}

export function classifyFiles(gitDiffLines: string[]): FileClassification {
  const result: FileClassification = {
    new: [],
    modified: [],
    deleted: [],
    renamed: []
  };

  for (const line of gitDiffLines) {
    if (!line.trim()) continue;

    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue;

    const status = parts[0].trim();
    // Guard the rename case before the switch so the body needs no extra level.
    if (status.charAt(0) === 'R') {
      // A rename line carries both the old and the new path.
      if (parts.length < RENAME_PARTS) continue;
      result.renamed.push({
        oldPath: parts[1],
        newPath: parts[2]
      });
      continue;
    }

    switch (status.charAt(0)) {
      case 'A':
        result.new.push(parts.slice(1).join(' '));
        break;
      case 'M':
        result.modified.push(parts.slice(1).join(' '));
        break;
      case 'D':
        result.deleted.push(parts.slice(1).join(' '));
        break;
      default:
        break;
    }
  }

  return result;
}

export async function loadBaseline(baselinePath: string): Promise<Record<string, BaselineEntry>> {
  try {
    await fs.access(baselinePath);
    const baselineContent = await fs.readFile(baselinePath, 'utf-8');
    return JSON.parse(baselineContent);
  } catch {
    return {};
  }
}

/**
 * Persist the baseline.
 *
 * A write failure here is not cosmetic: the caller's whole contract is "record
 * what we found so the next run can compare against it". Silently swallowing the
 * error would leave the baseline stale while reporting success, so the failure
 * is wrapped with the path and re-thrown -- callers already surface a thrown
 * error as a non-zero exit.
 */
export async function saveBaseline(baselinePath: string, baseline: Record<string, BaselineEntry>): Promise<void> {
  try {
    await fs.writeFile(baselinePath, JSON.stringify(baseline, null, 2));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write baseline to ${baselinePath}: ${reason}`);
  }
}

function evaluateNewFile(currentWarnings: number): Pick<DeltaResult, 'enforcement' | 'reason'> {
  if (currentWarnings > 0) {
    return {
      enforcement: 'BLOCK',
      reason: `New files must have zero warnings (currently: ${currentWarnings}). Boy Scout Rule: Leave the code cleaner than you found it.`,
    };
  }
  return { enforcement: 'PASS', reason: 'New file with zero warnings' };
}

function describeNonIncreasedDelta(delta: number, currentWarnings: number): string {
  if (delta < 0) return `Warnings decreased by ${Math.abs(delta)}`;
  if (currentWarnings === 0) return 'All warnings cleared';
  return 'No new warnings introduced';
}

function evaluateModifiedFile(
  baselineEntry: BaselineEntry | null,
  currentWarnings: number,
  baselineWarnings: number,
): Pick<DeltaResult, 'enforcement' | 'reason'> {
  if (!baselineEntry) {
    return { enforcement: 'PASS', reason: 'File added to baseline with current warning count' };
  }

  if (currentWarnings > baselineWarnings) {
    return {
      enforcement: 'BLOCK',
      reason: `Modified files cannot increase warnings (${currentWarnings} > ${baselineWarnings}). Boy Scout Rule: Leave the code cleaner than you found it.`,
    };
  }

  if (baselineWarnings <= SMALL_WARNING_BUDGET && currentWarnings > 0) {
    return {
      enforcement: 'BLOCK',
      reason: `Files with <=5 warnings must clear to zero (currently: ${currentWarnings}/${baselineWarnings}). Boy Scout Rule: Leave the code cleaner than you found it.`,
    };
  }

  return {
    enforcement: 'PASS',
    reason: describeNonIncreasedDelta(currentWarnings - baselineWarnings, currentWarnings),
  };
}

export function calculateDelta(
  baselineEntry: BaselineEntry | null,
  currentWarnings: number,
  status: 'NEW' | 'MODIFIED'
): DeltaResult {
  const baselineWarnings = baselineEntry ? baselineEntry.totalWarnings : 0;
  const delta = status === 'NEW' ? currentWarnings : currentWarnings - baselineWarnings;

  const evaluation = status === 'NEW'
    ? evaluateNewFile(currentWarnings)
    : evaluateModifiedFile(baselineEntry, currentWarnings, baselineWarnings);

  return {
    file: '',
    status,
    baselineWarnings,
    currentWarnings,
    delta,
    enforcement: evaluation.enforcement,
    reason: evaluation.reason,
  };
}

export function enforceBoyScoutRule(deltas: DeltaResult[]): EnforcementResult {
  const violations = deltas.filter(delta => delta.enforcement === 'BLOCK');
  
  let passedCount = 0;
  deltas.forEach(delta => {
    if (delta.enforcement === 'PASS') passedCount++;
  });

  return {
    overallStatus: violations.length > 0 ? 'BLOCK' : 'PASS',
    violations,
    detailedReport: deltas,
    summary: {
      totalFiles: deltas.length,
      passedFiles: passedCount,
      blockedFiles: violations.length
    }
  };
}

export async function initBaseline(files: string[]): Promise<Record<string, BaselineEntry>> {
  const currentWarnings = await analyzeWarningsForFiles(files);
  const baseline: Record<string, BaselineEntry> = {};

  for (const file of files) {
    const entry = baselineEntryFor(currentWarnings[file]);
    if (entry) baseline[file] = entry;
  }

  return baseline;
}

/**
 * Build the baseline entry for one file, or null when there is nothing to record.
 *
 * Extracted from `initBaseline` so the loop body is a single call: the previous
 * try/if nesting reached 5 levels, over the 4-level limit. Analysis failures are
 * handled by `analyzeWarningsForFiles`, which omits files it cannot read, so a
 * missing count here means "no warnings", not "the read blew up".
 */
function baselineEntryFor(warningCount: number | undefined): BaselineEntry | null {
  const total = warningCount || 0;
  // Only files that actually carry warnings are tracked; a clean file needs no budget.
  if (total === 0) return null;
  return { totalWarnings: total, lastAnalyzed: new Date().toISOString() };
}

/**
 * Record a first-seen count for files with no baseline entry yet.
 *
 * Extracted from `runEnforcement`, whose if/for/if nesting reached 5 levels.
 * Files that are already clean gain no entry -- there is nothing to budget.
 */
function recordAutoInitializedEntries(
  baseline: Record<string, BaselineEntry>,
  files: string[],
  currentWarnings: Record<string, number>,
): void {
  for (const file of files) {
    const entry = baselineEntryFor(currentWarnings[file]);
    if (entry) baseline[file] = entry;
  }
}

 /**
 * Initializes baseline from current violations for the specified files
 */
async function autoInitBaseline(
  files: string[], 
  baselinePath: string
): Promise<Record<string, BaselineEntry>> {
  const currentWarnings = await analyzeWarningsForFiles(files);
  const baseline: Record<string, BaselineEntry> = {};

  for (const file of files) {
    const count = currentWarnings[file] || 0;
    if (count > 0) {
      baseline[file] = {
        totalWarnings: count,
        lastAnalyzed: new Date().toISOString(),
      };
    }
  }

  await saveBaseline(baselinePath, baseline);
  return baseline;
}

async function runInitBaselineCommand(parsed: Record<string, unknown>): Promise<number> {
  try {
    // Honor --baseline; the old code hardcoded the default path (#445).
    const baselinePath = (parsed.baselinePath as string) || '.warnings-baseline.json';
    const result = await initBaselineCommand((parsed.files ?? []) as string[], baselinePath);
    // Use the explicit result, never process.exitCode: global exit state can be
    // set by unrelated code and would misreport this command's outcome.
    return result.ok ? 0 : 1;
  } catch (error: unknown) {
    console.error('Error initializing baseline:', error);
    return 1;
  }
}

export async function runEnforcementCommand(parsed: Record<string, unknown>): Promise<number> {
  try {
    const enforcementResult = await runEnforcement(
      (parsed.newFiles ?? []) as string[],
      (parsed.modifiedFiles ?? []) as string[],
      (parsed.baselinePath as string) || '.warnings-baseline.json'
    );
    console.log(JSON.stringify(enforcementResult, null, 2));
    return enforcementResult.overallStatus === 'PASS' ? 0 : 1;
  } catch (error: unknown) {
    console.error('Error during enforcement:', error);
    return 1;
  }
}

export async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  return parsed.command === 'init-baseline'
    ? runInitBaselineCommand(parsed)
    : runEnforcementCommand(parsed);
}

function splitCsvArg(raw: string | undefined): string[] {
  return raw?.split(',').map((s: string) => s.trim()).filter(Boolean) || [];
}

const ARG_HANDLERS: Record<string, (parsed: Record<string, unknown>, next: string | undefined) => boolean> = {
  '--new-files': (parsed, next) => { parsed.newFiles = splitCsvArg(next); return true; },
  '--modified-files': (parsed, next) => { parsed.modifiedFiles = splitCsvArg(next); return true; },
  '--baseline': (parsed, next) => { parsed.baselinePath = next; return true; },
  '--init-baseline': (parsed, next) => {
    parsed.command = 'init-baseline';
    parsed.files = splitCsvArg(next);
    return true;
  },
};

function parseArgs(args: string[]): Record<string, unknown> {
  const parsed: Record<string, unknown> = {
    command: null,
    newFiles: [],
    modifiedFiles: [],
    baselinePath: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      showHelp();
      process.exit(0);
    }
    const handler = ARG_HANDLERS[arg];
    if (handler && handler(parsed, args[i + 1])) {
      i++;
    }
  }

  return parsed;
}

function showHelp(): void {
  console.log(`
Usage: boy-scout <options>
Options:
  --new-files <file1,file2,...>    Specify new files to analyze
  --modified-files <file1,file2,...>    Specify modified files to analyze  
  --baseline <path>                Path to baseline file (default: .warnings-baseline.json)
  --init-baseline [file1,file2,...]    Initialize baseline with current warning counts
  --help                          Show this help message
  
Examples:
  npx tsx boy-scout.ts --new-files src/new-file.ts
  npx tsx boy-scout.ts --modified-files src/changed-file.ts --baseline my-baseline.json
  npx tsx boy-scout.ts --init-baseline src/file1.ts,src/file2.ts
`);
}

/**
 * Initialize/extend the warning baseline for the given files.
 *
 * MERGE semantics: entries already present in `baselinePath` that are not part of
 * `files` are preserved. The previous implementation wrote a freshly built object
 * containing only `files`, which silently destroyed every unrelated entry (#445),
 * and it hardcoded `.warnings-baseline.json`, ignoring `--baseline`.
 */
async function initBaselineCommand(
  files: string[],
  baselinePath = '.warnings-baseline.json',
): Promise<{ ok: boolean; reason?: string }> {
  const existing = await loadBaseline(baselinePath);
  const existingKeys = Object.keys(existing);

  const analyzed = await initBaseline(files);

  // Preserve anything already tracked; only add/refresh entries for `files`.
  const merged: Record<string, BaselineEntry> = { ...existing };
  const added: string[] = [];
  const refreshed: string[] = [];
  for (const [file, entry] of Object.entries(analyzed)) {
    if (existing[file]) {
      refreshed.push(file);
    } else {
      added.push(file);
    }
    merged[file] = entry;
  }

  // `merged` starts as a copy of `existing`, so a non-empty baseline can never
  // become empty here -- the destructive overwrite fixed in #445 is structurally
  // impossible now. No guard is needed; failure is reported via the return value
  // rather than by mutating process.exitCode.
  await saveBaseline(baselinePath, merged);

  const preserved = existingKeys.filter(k => !(k in analyzed));
  console.log(`ℹ️  Baseline updated: ${baselinePath}`);
  console.log(`   added:    ${added.length > 0 ? added.join(', ') : '(none)'}`);
  console.log(`   refreshed:${refreshed.length > 0 ? ` ${refreshed.join(', ')}` : ' (none)'}`);
  console.log(`   preserved:${preserved.length > 0 ? ` ${preserved.join(', ')}` : ' (none)'}`);
  return { ok: true };
}

async function runEnforcement(newFiles: string[], modifiedFiles: string[], baselinePath: string): Promise<EnforcementResult> {
  const allFiles = [...newFiles.filter(f => f.trim()), ...modifiedFiles.filter(f => f.trim())];
  const currentWarnings = await analyzeWarningsForFiles(allFiles);
  
  const baseline = await loadBaseline(baselinePath);
  
  // Check for missing baseline entries for modified files
  const missingBaselineEntries: string[] = [];
  for (const file of modifiedFiles) {
    if (!baseline[file]) {
      missingBaselineEntries.push(file);
    }
  }
  
  // Files being modified for the first time get their current count recorded, so
  // the next modification is compared against a real budget instead of nothing.
  if (missingBaselineEntries.length > 0) {
    recordAutoInitializedEntries(baseline, missingBaselineEntries, currentWarnings);
    await saveBaseline(baselinePath, baseline);
    console.log(`ℹ️  Auto-initialized baseline for ${missingBaselineEntries.length} files`);
  }
  
  const deltaResults: DeltaResult[] = [];

  for (const file of newFiles) {
    const warningCount = currentWarnings[file] || 0;
    const delta = calculateDelta(null, warningCount, 'NEW');
    delta.file = file;
    deltaResults.push(delta);
  }
  
  for (const file of modifiedFiles) {
    const baselineEntry = baseline[file] || null;
    const warningCount = currentWarnings[file] || 0;
    const delta = calculateDelta(baselineEntry, warningCount, 'MODIFIED');
    delta.file = file;
    deltaResults.push(delta);
  }
  
  return enforceBoyScoutRule(deltaResults);
}

// Fires only when this file IS the entry point. The previous check --
// `process.argv[1]?.includes('boy-scout')` -- both over- and under-matched, and
// silently no-oped under CI where argv[1] does not repeat the filename (#453).
if (isDirectExecution(process.argv[1], import.meta.url)) {
  main()
    .then(code => process.exit(code))
    .catch(error => {
      console.error('Unhandled error:', error);
      process.exit(1);
    });
}

export {
  initBaselineCommand,
  runEnforcement,
  autoInitBaseline
};