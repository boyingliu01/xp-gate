import * as fs from 'fs/promises';
import { analyze, getAdapterForFile } from './analyzer';
import { getAllRules } from './index';
import { loadConfig, setActiveConfig } from './config';
// Imported for the `--prune-baseline` command. The logic lives in its own module
// because this file is already at the clean-code.many-exports limit; consumers
// that need it should import from './baseline-prune' directly.
import { pruneBaselineEntries } from './baseline-prune';
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


/**
 * Validate one baseline entry.
 *
 * The on-disk shape is `{ totalWarnings: number, lastAnalyzed: string }`. A bare
 * number -- `{"src/a.ts": 1}` -- is accepted by `JSON.parse` and by TypeScript's
 * unchecked cast, but `entry.totalWarnings` then reads `undefined`, and BOTH
 * block conditions in `evaluateModifiedFile` become false:
 *
 *   `currentWarnings > undefined`  === false
 *   `undefined <= 5`               === false
 *
 * So the file silently passes forever no matter how many warnings it gains. That
 * exact shape is committed in 791d825 and still present in HEAD, which is why
 * this is a hard failure rather than a warning (#455). A baseline whose numbers
 * cannot be trusted is worse than no baseline, because the gate still reports
 * "PASSED" and nobody looks.
 */
function assertValidEntry(file: string, entry: unknown): asserts entry is BaselineEntry {
  const malformed = (detail: string): never => {
    throw new Error(
      `Malformed baseline entry for ${file}: ${detail}. ` +
        `Expected { totalWarnings: number, lastAnalyzed: string }. ` +
        `Repair it with \`xp-gate baseline create\` rather than editing by hand.`,
    );
  };

  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    malformed(`got ${Array.isArray(entry) ? 'an array' : typeof entry}`);
  }
  const total = (entry as BaselineEntry).totalWarnings;
  if (typeof total !== 'number' || !Number.isFinite(total)) {
    malformed(`totalWarnings is ${total === undefined ? 'missing' : String(total)}`);
  }
}

/**
 * Read the warning baseline.
 *
 * A missing file is normal (first run) and yields `{}`. A file that exists but
 * cannot be parsed or whose entries are malformed is an error: continuing with
 * silently-empty budgets is what let the gate pass everything in #455.
 */
export async function loadBaseline(baselinePath: string): Promise<Record<string, BaselineEntry>> {
  let baselineContent: string;
  try {
    baselineContent = await fs.readFile(baselinePath, 'utf-8');
  } catch (error) {
    // ONLY "not there yet" means first run. Any other I/O failure (EACCES, EPERM,
    // a TOCTOU between access and read, a transient disk error) must NOT be read
    // as an empty budget: callers react to an empty baseline by auto-initialising
    // and then SAVING, which overwrites whatever real entries the file held --
    // exactly the destructive overwrite #445 removed. Reporting a hard error is
    // the only safe response when we cannot tell what the baseline contains.
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return {};
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read baseline ${baselinePath}: ${reason}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(baselineContent);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Baseline ${baselinePath} is not valid JSON: ${reason}`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Baseline ${baselinePath} must be a JSON object mapping paths to entries.`);
  }

  for (const [file, entry] of Object.entries(parsed as Record<string, unknown>)) {
    assertValidEntry(file, entry);
  }
  return parsed as Record<string, BaselineEntry>;
}

/**
 * Read the baseline for repair, tolerating entries `loadBaseline` would reject.
 *
 * `initBaselineCommand` is the tool that fixes a broken baseline, so it cannot
 * require the baseline to be well-formed first -- otherwise a corrupt entry is
 * unrecoverable by any supported path (#455). Malformed entries are dropped and
 * reported; everything else is preserved, because silently discarding unrelated
 * budgets is the destructive overwrite fixed in #445.
 *
 * The file is read once and parsed once -- re-reading after `loadBaseline` threw
 * would race a concurrent writer and could report a different set of drops than
 * the caller then saves.
 */
async function loadBaselineForRepair(
  baselinePath: string,
): Promise<{ entries: Record<string, BaselineEntry>; dropped: string[]; readError: string | null }> {
  const absent = (readError: string | null) => ({ entries: {} as Record<string, BaselineEntry>, dropped: [] as string[], readError });

  const content = await readBaselineText(baselinePath);
  if (typeof content !== 'string') {
    // `null` means the file is simply not there yet -- a normal first run. Any
    // other failure must be reported rather than treated as empty, so the caller
    // can refuse to write instead of saving over content we never inspected.
    return absent(content === null ? null : `Cannot read baseline ${baselinePath}: ${content.reason}`);
  }

  const parsed = parseBaselineJson(content, baselinePath);
  if (typeof parsed === 'string') {
    return absent(parsed);
  }

  return { ...partitionEntries(parsed), readError: null };
}

/** Read the baseline file. Returns the text, `null` when absent, or the failure. */
async function readBaselineText(baselinePath: string): Promise<string | null | { reason: string }> {
  try {
    return await fs.readFile(baselinePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    return { reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Parse the baseline JSON. Returns the object, or a human-readable failure. */
function parseBaselineJson(content: string, baselinePath: string): Record<string, unknown> | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `Baseline ${baselinePath} is not valid JSON: ${reason}`;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return `Baseline ${baselinePath} must be a JSON object mapping paths to entries.`;
  }
  return parsed as Record<string, unknown>;
}

/** Split entries into the valid ones and the names of the malformed ones. */
function partitionEntries(parsed: Record<string, unknown>): {
  entries: Record<string, BaselineEntry>;
  dropped: string[];
} {
  const entries: Record<string, BaselineEntry> = {};
  const dropped: string[] = [];
  for (const [file, entry] of Object.entries(parsed)) {
    try {
      assertValidEntry(file, entry);
      entries[file] = entry;
    } catch {
      dropped.push(file);
    }
  }
  return { entries, dropped };
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

  // A non-finite baseline can only come from a corrupt entry. `loadBaseline`
  // rejects those, but this is the last line of defence: `NaN` compares false
  // against everything, so without this check the file would PASS forever
  // instead of failing loudly (#455).
  if (!Number.isFinite(baselineWarnings)) {
    return {
      file: '',
      status,
      baselineWarnings,
      currentWarnings,
      // NaN, not null: the field is typed `number`, and NaN is the honest value
      // for "cannot be computed". It serialises to `null` in JSON, which reads
      // as unavailable rather than as a real 0 delta.
      delta: Number.NaN,
      enforcement: 'BLOCK',
      reason: `Baseline for this file is corrupt (totalWarnings is ${String(baselineWarnings)}). Repair .warnings-baseline.json before committing.`,
    };
  }

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
    const files = collectBaselineTargets(parsed);
    if (files.length === 0) {
      // Writing an empty baseline while reporting success is how a caller ends up
      // believing a file was recorded when nothing was. `--init-baseline` takes
      // its targets as its own value; `--new-files`/`--modified-files` also work,
      // and previously writing them was silently ignored as well.
      console.error(
        'No files to record. Pass them to --init-baseline <file1,file2,...>, ' +
          'or via --new-files/--modified-files.',
      );
      return 1;
    }
    const result = await initBaselineCommand(files, baselinePath);
    // Use the explicit result, never process.exitCode: global exit state can be
    // set by unrelated code and would misreport this command's outcome.
    return result.ok ? 0 : 1;
  } catch (error: unknown) {
    console.error('Error initializing baseline:', error);
    return 1;
  }
}

/**
 * Merge every way a caller can name files for `--init-baseline`.
 *
 * `--init-baseline` carries its own list (`parsed.files`), while
 * `--new-files`/`--modified-files` populate separate keys. Requiring exactly one
 * spelling meant the other was read as an empty list, so the command wrote `{}`
 * and exited 0 -- a silent no-op (#455 family). Union them instead, preserving
 * order and dropping duplicates.
 */
function collectBaselineTargets(parsed: Record<string, unknown>): string[] {
  const groups = [
    parsed.files as string[] | undefined,
    parsed.newFiles as string[] | undefined,
    parsed.modifiedFiles as string[] | undefined,
  ];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const file of group ?? []) {
      if (file) seen.add(file);
    }
  }
  return [...seen];
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
  // Install the project's `.principlesrc` before any rule runs. Gate 6 shares
  // the same rule singletons as Gate 4, so without this the two gates would
  // disagree about a file's warning count whenever a threshold is overridden
  // (#457).
  setActiveConfig(await loadConfig(typeof parsed.configPath === 'string' ? parsed.configPath : undefined));
  if (parsed.command === 'prune-baseline') {
    return runPruneBaselineCommand(parsed);
  }
  return parsed.command === 'init-baseline'
    ? runInitBaselineCommand(parsed)
    : runEnforcementCommand(parsed);
}

/**
 * Report, and optionally remove, baseline entries whose files are gone (#452 REQ-3).
 *
 * Prints by default so a maintainer can review the list; `--apply` rewrites the
 * file. Exits 0 either way -- stale entries are housekeeping, and failing a
 * build over them would tempt people to disable the gate instead.
 */
async function runPruneBaselineCommand(parsed: Record<string, unknown>): Promise<number> {
  const baselinePath = typeof parsed.baselinePath === 'string'
    ? parsed.baselinePath
    : '.warnings-baseline.json';
  const projectRoot = process.cwd();

  let raw: string;
  try {
    raw = await fs.readFile(baselinePath, 'utf-8');
  } catch {
    console.log(`ℹ️  No baseline at ${baselinePath} — nothing to prune.`);
    return 0;
  }

  const result = pruneBaselineEntries(raw, projectRoot);
  if (result.error) {
    // Preserve the file: an entry we cannot classify must not be dropped.
    console.error(`⚠️  ${result.error} — baseline left untouched.`);
    return 1;
  }

  if (result.removed.length === 0) {
    console.log(`✅ No stale baseline entries (${result.kept.length} entries checked).`);
    return 0;
  }

  console.log(`Found ${result.removed.length} stale baseline entr(ies):`);
  for (const file of result.removed) console.log(`  - ${file}`);

  if (parsed.apply !== true) {
    console.log('Dry run — re-run with --apply to remove them.');
    return 0;
  }

  const parsedBaseline = JSON.parse(raw) as Record<string, unknown>;
  const removedSet = new Set(result.removed);
  for (const file of result.removed) delete parsedBaseline[file];
  try {
    await fs.writeFile(baselinePath, `${JSON.stringify(parsedBaseline, null, 2)}\n`, 'utf-8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`❌ Could not write ${baselinePath}: ${detail}`);
    return 1;
  }
  console.log(`✅ Removed ${removedSet.size} stale entr(ies) from ${baselinePath}.`);
  return 0;
}

function splitCsvArg(raw: string | undefined): string[] {
  return raw?.split(',').map((s: string) => s.trim()).filter(Boolean) || [];
}

/**
 * Read a flag's value, refusing to swallow the next flag.
 *
 * A bare `next` is taken as the value only when it does not itself look like a
 * flag; otherwise the flag is treated as having no value and the following token
 * is parsed normally. Without this, `--baseline --new-files x` recorded the
 * literal string "--new-files" as a path (#455).
 */
function takeValue(next: string | undefined): { value: string | undefined; consumed: boolean } {
  const isFlag = typeof next === 'string' && next.startsWith('--');
  return isFlag || next === undefined ? { value: undefined, consumed: false } : { value: next, consumed: true };
}

const ARG_HANDLERS: Record<string, (parsed: Record<string, unknown>, next: string | undefined) => boolean> = {
  '--new-files': (parsed, next) => { const v = takeValue(next); parsed.newFiles = splitCsvArg(v.value); return v.consumed; },
  '--modified-files': (parsed, next) => { const v = takeValue(next); parsed.modifiedFiles = splitCsvArg(v.value); return v.consumed; },
  '--baseline': (parsed, next) => { const v = takeValue(next); parsed.baselinePath = v.value; return v.consumed; },
  // Lets Gate 6 be pointed at a specific `.principlesrc`, so it agrees with
  // Gate 4 when the project overrides a threshold (#457).
  '--config': (parsed, next) => { const v = takeValue(next); parsed.configPath = v.value; return v.consumed; },
  '--init-baseline': (parsed, next) => {
    parsed.command = 'init-baseline';
    // The file list is OPTIONAL and positional: `--init-baseline a.ts,b.ts` works,
    // and so does `--init-baseline --new-files a.ts`. Consuming the next token
    // unconditionally swallowed the following FLAG, which silently produced an
    // empty baseline that the command then reported as success (#455).
    const v = takeValue(next);
    parsed.files = splitCsvArg(v.value);
    return v.consumed;
  },
  // Report (and with --apply, remove) baseline entries for files that are gone
  // (#452 REQ-3). Dry-run by default: deleting history is not something a gate
  // should do as a side effect of a normal run.
  '--prune-baseline': parsed => { parsed.command = 'prune-baseline'; return false; },
  '--apply': parsed => { parsed.apply = true; return false; },
};

function parseArgs(args: string[]): Record<string, unknown> {
  const parsed: Record<string, unknown> = {
    command: null,
    newFiles: [],
    modifiedFiles: [],
    baselinePath: null,
    configPath: null,
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
  --prune-baseline                 Report baseline entries whose files are gone
  --apply                          With --prune-baseline: actually remove them
  --config <path>                  Path to .principlesrc (default: git toplevel)
  --help                          Show this help message
  
Examples:
  npx tsx boy-scout.ts --new-files src/new-file.ts
  npx tsx boy-scout.ts --modified-files src/changed-file.ts --baseline my-baseline.json
  npx tsx boy-scout.ts --init-baseline src/file1.ts,src/file2.ts
  npx tsx boy-scout.ts --prune-baseline --apply
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
  const { entries: existing, dropped, readError } = await loadBaselineForRepair(baselinePath);

  // Refuse to write when we could not determine what the file holds. Saving now
  // would replace unknown content with just our own entries.
  if (readError) {
    return { ok: false, reason: readError };
  }

  const analyzed = await initBaseline(files);

  // Preserve anything already tracked; only add/refresh entries for `files`.
  // `merged` starts as a copy of `existing`, so a non-empty baseline can never
  // become empty here -- the destructive overwrite fixed in #445 is structurally
  // impossible rather than merely guarded.
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

  reportDroppedEntries(dropped, analyzed);
  await saveBaseline(baselinePath, merged);
  reportBaselineUpdate(baselinePath, added, refreshed, Object.keys(existing).filter(k => !(k in analyzed)));

  // Non-zero exit when repair cost us an entry that could not be rebuilt. The
  // write still happened (the rest of the file is valid), but a caller scripting
  // this must not see success for a run that permanently lost a budget. We cannot
  // invent a warning count we never measured, and a wrong number would silently
  // re-arm the gate -- the very bug being fixed.
  const stillDropped = dropped.filter(file => !(file in analyzed));
  if (stillDropped.length > 0) {
    return {
      ok: false,
      reason: `Dropped ${stillDropped.length} unrecoverable baseline ${stillDropped.length === 1 ? 'entry' : 'entries'}: ${stillDropped.join(', ')}. Re-run with those paths to rebuild them.`,
    };
  }
  return { ok: true };
}

/**
 * Report malformed entries that had to be discarded, distinguishing the ones the
 * current run measured afresh from the ones that are now permanently gone.
 */
function reportDroppedEntries(dropped: string[], analyzed: Record<string, BaselineEntry>): void {
  if (dropped.length === 0) return;
  const noun = dropped.length === 1 ? 'entry' : 'entries';
  console.log(`⚠️  Dropped ${dropped.length} malformed baseline ${noun}:`);
  for (const file of dropped) {
    const fate = file in analyzed ? '(recreated from the current tree)' : '(lost -- not in the file list)';
    console.log(`   - ${file} ${fate}`);
  }
}

/** Print the add/refresh/preserve summary for a completed baseline write. */
function reportBaselineUpdate(
  baselinePath: string,
  added: string[],
  refreshed: string[],
  preserved: string[],
): void {
  const list = (items: string[]) => (items.length > 0 ? items.join(', ') : '(none)');
  console.log(`ℹ️  Baseline updated: ${baselinePath}`);
  console.log(`   added:    ${list(added)}`);
  console.log(`   refreshed:${refreshed.length > 0 ? ` ${list(refreshed)}` : ' (none)'}`);
  console.log(`   preserved:${preserved.length > 0 ? ` ${list(preserved)}` : ' (none)'}`);
}

/**
 * Record budget entries for files the gate meets for the first time, then save
 * and report the write. Split out of `runEnforcement` to keep both under the
 * long-function threshold; also carries the #452 REQ-2 visibility contract:
 * the report distinguishes "created" from "updated" and names every entry the
 * auto-init introduced, never just a count.
 */
async function autoInitMissingEntries(
  baseline: Record<string, BaselineEntry>,
  missingBaselineEntries: string[],
  currentWarnings: Record<string, number>,
  baselinePath: string,
  baselineExisted: boolean,
): Promise<void> {
  recordAutoInitializedEntries(baseline, missingBaselineEntries, currentWarnings);
  await saveBaseline(baselinePath, baseline);
  const action = baselineExisted ? 'updated' : 'created';
  const noun = missingBaselineEntries.length === 1 ? 'entry' : 'entries';
  console.log(`ℹ️  Baseline ${action}: ${baselinePath}`);
  console.log(`   auto-initialized ${noun}: ${missingBaselineEntries.join(', ')}`);
}

async function runEnforcement(newFiles: string[], modifiedFiles: string[], baselinePath: string): Promise<EnforcementResult> {
  const allFiles = [...newFiles.filter(f => f.trim()), ...modifiedFiles.filter(f => f.trim())];
  const currentWarnings = await analyzeWarningsForFiles(allFiles);

  // Distinguishing "created" from "updated" is part of the auto-init contract
  // (#452 REQ-2): a silently rewritten baseline is how unrelated entries used
  // to vanish without anyone noticing.
  let baselineExisted = false;
  try {
    await fs.access(baselinePath);
    baselineExisted = true;
  } catch {
    baselineExisted = false;
  }
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
    await autoInitMissingEntries(baseline, missingBaselineEntries, currentWarnings, baselinePath, baselineExisted);
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
