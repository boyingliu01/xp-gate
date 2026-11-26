// @no-test-required: mutmut wrapper — tested via gate-m integration + pre-push Gate M
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import type {
  MutationRunner,
  RunMutationOptions,
  MutationRunOutcome,
  MutationRunResult,
} from './types';
import { runMutationCommand } from './spawn-with-capture';

type Platform = NodeJS.Platform;
type MutmutRoute = 'native' | 'wsl' | 'unavailable' | 'unresolved';

/**
 * mutmut mutation runner for Python files.
 *
 * Uses `mutmut run` to generate mutants and parses emoji progress output.
 * Supports mutmut v3.x (primary) with fallback to v2.x behavior.
 *
 * v3.x changes (GitHub issue #339):
 * - Removed `--paths-to-mutate` CLI flag
 * - Uses `source_paths` in `[tool.mutmut]` section of pyproject.toml
 * - Results stored in SQLite; `mutmut results` outputs per-mutant status lines
 * - `mutmut run` stdout shows emoji progress: 🎉 N 🫥 N ⏰ N 🤔 N 🙁 N
 */
/**
 * Wire a child process's stdout/stderr into one accumulating callback.
 *
 * Extracted from `runMutmut`: the two listeners were six lines of pure
 * accumulation inside an already-long Promise body, and their nesting was part
 * of what made that method exceed both the length and the nesting budget.
 */
/** How long a SIGTERMed mutmut gets before it is killed outright. */
/** Where the pre-run copy of pyproject.toml lives. */
function pyprojectBackupPath(pyprojectPath: string): string {
  return `${pyprojectPath}.xp-gate-backup`;
}

/**
 * Put pyproject.toml back the way it was, or remove the one we generated.
 *
 * Cleanup is best-effort by design: the mutation run's own result is what the
 * caller acts on, and failing here would replace a usable outcome with an
 * exception raised from a `finally`. Extracted from `run` because the nested
 * try/if/if/else was what pushed that method to 5 nesting levels.
 */
function restorePyproject(pyprojectPath: string, hadExisting: boolean): void {
  const backupPath = pyprojectBackupPath(pyprojectPath);
  restoreFromBackup({ pyprojectPath, backupPath, hadExisting });
}

/**
 * Put `pyproject.toml` back the way it was.
 *
 * Two cases, because the file may not have EXISTED before: restoring a backup that was
 * never taken would leave an empty file, and deleting a file we did not create would
 * destroy the project's own configuration.
 */
/** What a restore needs: the file, its backup, and whether the file pre-existed. */
interface RestoreTarget {
  pyprojectPath: string;
  backupPath: string;
  hadExisting: boolean;
}

/** The two paths a backup restore needs. */
type BackupPair = Omit<RestoreTarget, 'hadExisting'>;

function restoreFromBackup({ pyprojectPath, backupPath, hadExisting }: RestoreTarget): void {
  try {
    if (hadExisting) restoreExisting({ pyprojectPath, backupPath });
    else removeCreated(pyprojectPath);
  } catch (err) {
    // LOUD, not silent: a failed restore leaves `pyproject.toml` as MUTMUT rewrote it, in
    // the user's working tree. Swallowing that would let them commit a mutated manifest.
    // Not thrown, because that would turn a mutation RESULT into a crash -- but the
    // backup path is named so the content can still be recovered by hand.
    console.error(
      `[mutmut] WARNING: could not restore ${pyprojectPath}; it may still carry the `
        + `mutmut edit. Backup: ${backupPath} (${String(err)})`,
    );
  }
}

/**
 * Restore the backed-up content, then drop the backup.
 *
 * Best-effort: the workspace is left as mutmut left it, and throwing here would turn a
 * mutation RESULT into a crash.
 */
function restoreExisting({ pyprojectPath, backupPath }: BackupPair): void {
  if (!existsSync(backupPath)) return;
  // Each step is guarded on its own rather than wrapped in one try/catch, because they
  // fail differently and only the CALLER can report usefully (it knows the backup path):
  //
  //   - an unreadable backup leaves the workspace untouched -- nothing was written, so
  //     there is nothing to report beyond the caller's warning;
  //   - a failed WRITE is the serious one: pyproject.toml still carries mutmut's edit,
  //     and the backup must survive so the content can be recovered by hand;
  //   - the backup is unlinked only after the write succeeded, since deleting it first
  //     would destroy the only copy if the write then failed.
  //
  // Failures PROPAGATE to `restoreFromBackup`, which is the one place that can name the
  // backup path and print a warning.
  const content = readFileSync(backupPath, 'utf-8');
  try {
    writeFileSync(pyprojectPath, content, { encoding: 'utf-8' });
  } catch (err) {
    // The write is the step that leaves DAMAGE behind: pyproject.toml keeps mutmut's
    // edit. Add the backup path here, so the caller's warning tells the reader how to
    // recover even after the file is gone from the log.
    throw new Error(`restore of ${pyprojectPath} failed (backup kept at ${backupPath}): ${String(err)}`);
  }
  unlinkSync(backupPath);
}

/** Delete the file this run created, if it is still there. */
function removeCreated(pyprojectPath: string): void {
  try {
    if (existsSync(pyprojectPath)) unlinkSync(pyprojectPath);
  } catch {
    // Best effort -- see `restoreExisting`.
  }
}

export class MutmutRunner implements MutationRunner {
  readonly name = 'mutmut';
  readonly extensions = ['py'];

  private route: MutmutRoute = 'unresolved';

  constructor(private readonly platform: Platform = process.platform) {}

  async isAvailable(): Promise<boolean> {
    if (this.platform !== 'win32') {
      try {
        execSync('mutmut --version', { stdio: 'pipe', timeout: 5000 });
        this.route = 'native';
        return true;
      } catch {
        this.route = 'unavailable';
        return false;
      }
    }

    // Windows: mutmut 3.x is fork()-based and can ONLY run under WSL. A native
    // `mutmut --version` succeeding therefore proves nothing about `mutmut run`
    // — reporting route='native' here is exactly the #410 deadlock: every push
    // reached `mutmut run`, which exits 1 with "please use the WSL", and the
    // gate blocked on a structurally unachievable check. The route is decided
    // by the WSL probe alone so an unavailable WSL yields a clean SKIP.
    try {
      execSync('wsl mutmut --version', { stdio: 'pipe', timeout: 10000 });
      this.route = 'wsl';
      return true;
    } catch {
      this.route = 'unavailable';
      return false;
    }
  }

  async run(options: RunMutationOptions): Promise<MutationRunOutcome> {
    if (this.route === 'unresolved' && this.platform === 'win32') {
      await this.isAvailable();
    }
    if (this.route === 'unavailable') {
      return { report: null, timedOut: false };
    }

    // Extract unique directories from file list
    const sourceDirs = this.extractUniqueDirs(options.files);

    const pyprojectPath = join(options.cwd, 'pyproject.toml');
    // Backing up and writing are OUTSIDE the `finally` on purpose, and both are caught:
    // a failure to prepare the workspace is a TOOL failure, and this module's contract is
    // that tool failures arrive as an outcome with `error`, never as a rejected promise
    // (a rejection reaches the caller's `catch` and reads as "no mutants found").
    let hadExisting = false;
    let backedUp = false;
    try {
      hadExisting = this.backupPyproject(pyprojectPath);
      backedUp = true;
      this.writeMutmutConfig(pyprojectPath, sourceDirs);
    } catch (err) {
      // Roll back ONLY what was done. `backedUp` distinguishes "the backup ran but the
      // write failed" from "the backup itself failed": with `restorePyproject(path,
      // false)` hardcoded, the first case DELETES a pyproject.toml that was there all
      // along -- the user's own file -- because `hadExisting` was never consulted.
      if (backedUp) restorePyproject(pyprojectPath, hadExisting);
      return { report: null, timedOut: false, error: err instanceof Error ? err.message : String(err) };
    }

    try {
      return await this.runMutmut(options);
    } finally {
      restorePyproject(pyprojectPath, hadExisting);
    }
  }

  /**
   * Copy an existing pyproject.toml aside so `run` can put it back.
   * @returns whether a file was there to back up.
   */
  private backupPyproject(pyprojectPath: string): boolean {
    if (!existsSync(pyprojectPath)) return false;
    const backupPath = pyprojectBackupPath(pyprojectPath);
    try {
      writeFileSync(backupPath, readFileSync(pyprojectPath, 'utf-8'), { encoding: 'utf-8' });
    } catch (err) {
      // Failing here must be loud: without a backup, `restorePyproject` would
      // silently leave this repo's pyproject.toml overwritten by a generated one.
      throw new Error(
        `Could not back up ${pyprojectPath} before writing a mutmut config: ${(err as Error).message}`,
      );
    }
    return true;
  }

  /**
   * Build the terminal-outcome handler for one `mutmut run`.
   *
   * Three separate events (close / error / timeout) can end a run, and each one
   * has to cancel both timers, mark the promise settled exactly once, and hand
   * back the right shape. Factoring that into a single small object keeps
   * `runMutmut` down to spawning and wiring, which is all it should express.
   */


  /**
   * How to invoke `mutmut run` for the current route, or null when a WSL path
   * could not be derived (in which case the run must be skipped, not attempted).
   */
  private buildInvocation(cwd: string): { command: string; args: string[] } | null {
    if (this.route !== 'wsl') {
      return { command: 'mutmut', args: ['run'] };
    }
    const wslPath = this.toWslPath(cwd);
    if (wslPath === null) return null;
    return { command: 'wsl', args: ['--cd', wslPath, 'mutmut', 'run'] };
  }

  /**
   * Run mutmut through the SHARED spawn/timeout/capture path.
   *
   * This runner used to carry its own `spawn` + `armTimeout` + `collectOutput` +
   * `settleTracker`: a second definition of the timeout policy, which is how the two
   * could disagree (and did -- one guarded the SIGKILL escalation on `child.killed`,
   * which Node sets when `kill()` is CALLED, so the escalation never fired).
   *
   * The report parser stays local: reading mutmut's emoji progress is this runner's
   * business, and the shared path takes it as a callback.
   */
  private async runMutmut(options: RunMutationOptions): Promise<MutationRunOutcome> {
    const invocation = this.buildInvocation(options.cwd);
    if (invocation === null) return { report: null, timedOut: false };
    return runMutationCommand(
      invocation.command,
      invocation.args,
      { cwd: options.cwd, timeoutMs: options.timeoutMs },
      (stdout: string) => this.parseEmojiProgress(stdout),
    );
  }

  private toWslPath(path: string): string | null {
    const match = path.match(/^([A-Za-z]):[\\/](.*)$/);
    if (!match) return null;
    const drive = match[1]?.toLowerCase();
    const remainder = match[2]?.replaceAll('\\', '/');
    return `/mnt/${drive}/${remainder}`;
  }

  /**
   * Parse v3.x emoji progress line from mutmut run stdout.
   *
   * mutmut v3.x prints a progress summary like:
   *   38/38  🎉 9 🫥 29  ⏰ 0  🤔 0  🙁 0  🔇 0  🧙 0
   *
   * Emoji mapping:
   *   🎉 = killed
   *   🫥 = not checked (untested)
   *   ⏰ = timeout
   *   🤔 = suspicious
   *   🙁 = survived
   *   🔇 = unknown (counted as survived)
   *   🧙 = unknown (counted as survived)
   */
  private parseEmojiProgress(stdout: string): MutationRunResult | null {
    // Find the last progress line (contains 🎉)
    const lines = stdout.split('\n');
    let progressLine = '';
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('🎉')) {
        progressLine = lines[i];
        break;
      }
    }
    if (!progressLine) return null;

    // Parse emoji counts: 🎉 N 🫥 N ⏰ N 🤔 N 🙁 N 🔇 N 🧙 N
    const killed = this.extractEmojiCount(progressLine, '🎉');
    const untested = this.extractEmojiCount(progressLine, '🫥');
    const timeout = this.extractEmojiCount(progressLine, '⏰');
    const suspicious = this.extractEmojiCount(progressLine, '🤔');
    const survived = this.extractEmojiCount(progressLine, '🙁');
    const unknown1 = this.extractEmojiCount(progressLine, '🔇');
    const unknown2 = this.extractEmojiCount(progressLine, '🧙');

    // Any UNREADABLE count makes the whole line untrustworthy: reporting a score built
    // from a partial parse is worse than reporting that the run could not be read.
    const counts = [killed, untested, timeout, suspicious, survived, unknown1, unknown2];
    if (counts.some((n) => n === null)) return null;

    const nrOfKilledMutants = killed as number;
    const nrOfSurvivedMutants =
      (survived as number) + (timeout as number) + (suspicious as number)
      + (untested as number) + (unknown1 as number) + (unknown2 as number);
    const nrOfMutants = nrOfKilledMutants + nrOfSurvivedMutants;

    if (nrOfMutants === 0) return null;

    return {
      mutationScore: (nrOfKilledMutants / nrOfMutants) * 100,
      nrOfMutants,
      nrOfKilledMutants,
      nrOfSurvivedMutants,
    };
  }

  /**
   * Extract count after an emoji in a progress line.
   * e.g., "🎉 9" → 9
   */
  /**
   * The count after an emoji on mutmut's progress line.
   *
   * ABSENT means zero: mutmut omits an emoji whose count is 0, so a line without `🫥`
   * really did have no untested mutants. That is a measured zero, not an unknown.
   *
   * PRESENT BUT UNREADABLE is different, and returns null: if the emoji is there and the
   * number after it is not, the line was not understood, and calling that 0 would report
   * a clean run on a parse failure.
   */
  private extractEmojiCount(line: string, emoji: string): number | null {
    const at = line.indexOf(emoji);
    if (at === -1) return 0;
    const after = line.slice(at + emoji.length).match(/^\s*(\d+)/);
    return after ? parseInt(after[1], 10) : null;
  }

  /**
   * Extract unique directories from file paths.
   * e.g., ['src/foo.py', 'src/bar.py', 'tests/baz.py'] → ['src', 'tests']
   */
  private extractUniqueDirs(files: string[]): string[] {
    const dirs = new Set<string>();
    for (const file of files) {
      const dir = dirname(file);
      if (dir && dir !== '.') {
        dirs.add(dir);
      }
    }
    // If no directories found, use current directory
    return dirs.size > 0 ? Array.from(dirs) : ['.'];
  }

  private writeMutmutConfig(pyprojectPath: string, sourceDirs: string[]): void {
    try {
      // Read here so the content builder stays pure: it then has no I/O to
      // fail on, and the one place that can fail is the one that explains why.
      const existing = existsSync(pyprojectPath) ? readFileSync(pyprojectPath, 'utf-8') : null;
      writeFileSync(pyprojectPath, mutmutConfigContent(existing, sourceDirs), {
        encoding: 'utf-8',
      });
    } catch (err) {
      // A missing or half-written pyproject.toml would make mutmut scan the wrong
      // tree, so surface the path instead of letting a bare fs error escape.
      throw new Error(`Could not write mutmut config to ${pyprojectPath}: ${(err as Error).message}`);
    }
  }
}

import { parse as parseToml } from 'smol-toml';

/**
 * pyproject.toml content with `[tool.mutmut] source_paths` set to `sourceDirs`.
 *
 * THE PARSER DECIDES, THE TEXT IS EDITED. A real TOML parser answers "is there a
 * `[tool.mutmut]` table, and is its `source_paths` an array?" -- questions that five
 * rounds of review showed cannot be answered by pattern-matching. A commented header, a
 * string containing the key, a multi-line string body, an array whose path holds a `]`,
 * and a scalar followed by another array each defeated a textual check; two of them by
 * DELETING user content (all measured).
 *
 * Serialising the parsed document would answer them too, but it rewrites the whole file
 * -- comments, ordering and spacing included -- which is not ours to discard. So the
 * parser only SELECTS the branch, and the edit is applied to the original text.
 *
 * @param existing the current file content, or null when the file does not exist.
 */
export function mutmutConfigContent(existing: string | null, sourceDirs: string[]): string {
  const line = arrayLine(sourceDirs);
  if (existing === null) return `[tool.mutmut]\n${line}\n`;
  const table = findMutmutTable(parseDocument(existing));
  if (table === null) return withoutTable(existing, line);
  if (table.source_paths === undefined) return insertKey(existing, line);
  if (!Array.isArray(table.source_paths)) return existing;
  return replaceArrayText(existing, line);
}

/**
 * Handle a document with no USABLE `[tool.mutmut]` table.
 *
 * Two reasons to get here, and they need opposite answers: the file parses and simply has
 * no table (append one), or it does NOT parse -- in which case a header may well be there
 * and appending a second `[tool.mutmut]` would leave two, so the text is left alone.
 */
function withoutTable(existing: string, line: string): string {
  return hasMutmutHeader(existing) ? existing : appendTable(existing, line);
}

/**
 * A `[tool.mutmut]` header LINE.
 *
 * `[ ]` may hold whitespace and a trailing `#` comment is legal TOML --
 * `[ tool.mutmut ] # note` is a valid header, and a stricter pattern reported "no table"
 * for it, leaving the array unrewritten (measured). The parser has already confirmed the
 * table EXISTS; this only has to find where its body starts.
 */
const MUTMUT_HEADER = /^[^\S\n]*\[[^\S\n]*tool[^\S\n]*\.[^\S\n]*mutmut[^\S\n]*\][^\n]*$/m;

/** Whether the TEXT has a `[tool.mutmut]` header, parseable or not. */
function hasMutmutHeader(existing: string): boolean {
  return MUTMUT_HEADER.test(existing);
}

/** The `source_paths = [...]` line, as TOML with quoted entries. */
function arrayLine(sourceDirs: string[]): string {
  return `source_paths = [${sourceDirs.map((d) => JSON.stringify(d)).join(', ')}]`;
}

/** The parsed document, or `UNPARSEABLE` when the file is not valid TOML. */
const UNPARSEABLE = Symbol('unparseable');

/**
 * Parse the document, tolerating an invalid one.
 *
 * A pyproject.toml that does not parse is a file mutmut cannot use either. Returning a
 * sentinel rather than throwing keeps this function total: the caller appends its table
 * to whatever is there, which is the same thing a hand edit would do.
 */
function parseDocument(existing: string): Record<string, unknown> | typeof UNPARSEABLE {
  try {
    return parseToml(existing) as Record<string, unknown>;
  } catch {
    return UNPARSEABLE;
  }
}

/**
 * The `[tool.mutmut]` table from a parsed document, or null when there is none.
 *
 * Read STRUCTURALLY: `tool.mutmut` is a path in the parsed tree, so a commented header,
 * a string that mentions the table name, or a `[tool.other]` entry cannot be mistaken
 * for it. That is the whole reason this function takes a parsed document.
 */
function findMutmutTable(parsed: Record<string, unknown> | typeof UNPARSEABLE): Record<string, unknown> | null {
  if (parsed === UNPARSEABLE) return null;
  const tool = parsed.tool;
  if (!isRecord(tool)) return null;
  const mutmut = tool.mutmut;
  return isRecord(mutmut) ? mutmut : null;
}

/** Whether a parsed value is a TOML table. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Append a fresh `[tool.mutmut]` table.
 *
 * The table is appended rather than merged because there is no table to merge INTO --
 * either the file has none, or it does not parse and guessing where a table belongs in
 * an invalid document is worse than adding one at the end.
 */
function appendTable(existing: string, line: string): string {
  const trimmed = existing.trimEnd();
  // No stacked blank lines in an otherwise empty file.
  return trimmed === '' ? `[tool.mutmut]\n${line}\n` : `${trimmed}\n\n[tool.mutmut]\n${line}\n`;
}

/**
 * Add `source_paths` to an existing table that does not have it yet.
 *
 * Inserted directly after the header, which keeps it inside the table no matter what
 * follows -- no scan for the next header, so there is nothing to get wrong.
 */
function insertKey(existing: string, line: string): string {
  // The SAME pattern the body scan uses. A second, stricter copy here meant a header
  // like `[ tool.mutmut ]` was found by one and missed by the other.
  const header = MUTMUT_HEADER.exec(existing);
  if (!header) return appendTable(existing, line);
  const at = header.index + header[0].length;
  return `${existing.slice(0, at)}\n${line}${existing.slice(at)}`;
}

/**
 * Replace the array literal with `line`, keeping the rest of the file byte for byte.
 *
 * Only reached when the parser has already confirmed the table and that its
 * `source_paths` IS an array, so all that remains is finding that array's text. The
 * search is bounded to the key's own line for the opening bracket and balanced
 * afterwards, which is what makes a `]` inside a path safe.
 */
function replaceArrayText(existing: string, line: string): string {
  const span = arraySpan(existing);
  if (span === null) return existing;
  return existing.slice(0, span.start) + line + existing.slice(span.end);
}

/** A line that assigns `source_paths`. */
const KEY_LINE = /^[^\S\n]*source_paths[^\S\n]*=/;

/**
 * Index where a REAL `source_paths =` key starts, or -1.
 *
 * The parser has already confirmed the table HAS the key; this finds its TEXT. A plain
 * regex cannot, because a multi-line string can hold a line that looks exactly like the
 * key -- measured: the STRING was rewritten and the real key below it left alone.
 *
 * All four TOML string forms are tracked, the multi-line ones included: they legitimately
 * span the newlines a `^`-anchored regex relies on.
 */
function findKeyOutsideStrings(doc: string, from: number, to: number): number {
  let quote: string | null = null;
  let offset = from;
  for (const line of doc.slice(from, to).split('\n')) {
    if (quote === null && KEY_LINE.test(line)) return offset;
    quote = scanLineForQuote(line, quote);
    offset += line.length + 1;
  }
  return -1;
}

/** The string delimiter still open after this line, or null when outside one. */
function scanLineForQuote(line: string, quote: string | null): string | null {
  let open: string | null = quote;
  let i = 0;
  while (i < line.length) {
    // A backslash escapes the NEXT character inside a basic string, so `\"` is data.
    // Without this the escaped quote ENDED the string and everything after it read as
    // outside -- a valid line then looked like a string, and the array was skipped
    // (measured with a real file).
    if (open === '"' && line[i] === '\\') {
      i += 2;
      continue;
    }
    const hit = QUOTE_TOKENS.find((token) => line.startsWith(token.delimiter, i));
    if (!hit) {
      i += 1;
      continue;
    }
    if (open === null) open = hit.delimiter;
    else if (open === hit.delimiter) open = null;
    i += hit.delimiter.length;
  }
  return open;
}

/** The TOML string delimiters, LONGEST FIRST so the triple forms win. */
const QUOTE_TOKENS = [{ delimiter: '"""' }, { delimiter: "'''" }, { delimiter: '"' }, { delimiter: "'" }];

/** Where the `source_paths = [...]` value sits in the text, or null. */
function arraySpan(doc: string): { start: number; end: number } | null {
  const body = mutmutBodyRange(doc);
  if (body === null) return null;
  const keyIndex = findKeyOutsideStrings(doc, body.start, body.end);
  if (keyIndex === -1) return null;
  const close = bracketOnKeyLine(doc, keyIndex);
  return close === -1 ? null : { start: keyIndex, end: close + 1 };
}

/**
 * Where the table body ends: the next TABLE HEADER, skipping string content.
 *
 * A plain `^\[` scan stops at a `[x]` line INSIDE a multi-line string, so the body was
 * cut short and the real key fell outside it -- the array was never rewritten (measured).
 * The line is only a header when it is not inside a string.
 */
function nextTableStart(doc: string, from: number): number {
  let quote: string | null = null;
  let offset = from;
  for (const line of doc.slice(from).split('\n')) {
    const isHeader = quote === null && TABLE_HEADER.test(line);
    quote = scanLineForQuote(line, quote);
    if (isHeader && quote === null) return offset;
    offset += line.length + 1;
  }
  return doc.length;
}

/** Any TOML table header line. */
const TABLE_HEADER = /^[^\S\n]*\[/;

/**
 * The character range of the `[tool.mutmut]` table body.
 *
 * BOTH bounds matter: without them the search finds the first `source_paths` in the FILE
 * -- another table's, or a fake one inside a multi-line string -- and rewrote the wrong
 * value (measured).
 */
function mutmutBodyRange(doc: string): { start: number; end: number } | null {
  const header = MUTMUT_HEADER.exec(doc);
  if (!header) return null;
  const start = header.index + header[0].length;
  return { start, end: nextTableStart(doc, start) };
}

/**
 * Index of the `]` closing the array that starts on the key's own line; -1 when there is
 * no array there.
 *
 * The bracket must be on THAT line: searching forward found the next assignment's `[`
 * and replaced everything up to its `]`, DELETING `other = ["a", "b"]` (measured).
 */
function bracketOnKeyLine(doc: string, keyIndex: number): number {
  const open = doc.indexOf('[', keyIndex);
  if (open === -1) return -1;
  const lineEnd = doc.indexOf('\n', keyIndex);
  if (lineEnd !== -1 && open > lineEnd) return -1;
  return matchingBracket(doc, open);
}

/** Index of the `]` balancing the `[` at `open`, skipping quoted strings; -1 if none. */
function matchingBracket(doc: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < doc.length; i += 1) {
    const step = bracketStep(doc, i, quote);
    if (step.escape) i += 1;
    else quote = endCommentAt(doc[i], step.quote);
    depth += step.delta;
    if (depth === 0) return i;
  }
  return -1;
}

/** What one character does to the bracket scan. */
interface BracketStep {
  quote: string | null;
  /** +1 for `[`, -1 for `]`, 0 otherwise. */
  delta: number;
  /** A backslash inside a string, so the NEXT character is data. */
  escape: boolean;
}

/** Classify one character for the bracket scan. */
function bracketStep(doc: string, i: number, quote: string | null): BracketStep {
  const ch = doc[i];
  if (quote === COMMENT) return { quote: COMMENT, delta: 0, escape: false };
  if (quote === null) return outsideString(ch);
  return { quote: ch === quote ? null : quote, delta: 0, escape: ch === '\\' };
}

/** What a character does when the scan is OUTSIDE a string. */
function outsideString(ch: string): BracketStep {
  if (isQuote(ch)) return { quote: ch, delta: 0, escape: false };
  // A `#` starts a comment that runs to the end of the LINE, and a `]` inside one is
  // prose. Without this the array closed EARLY and the rest of it was left in the file as
  // garbage -- measured: `source_paths = ["new"] tricky` followed by orphaned entries.
  if (ch === '#') return { quote: COMMENT, delta: 0, escape: false };
  return { quote: null, delta: BRACKET_DELTA[ch] ?? 0, escape: false };
}

/** Pseudo-quote standing for "inside a comment", cleared at the newline. */
const COMMENT = '#';

/** End the comment pseudo-quote at a newline; comments do not span lines. */
function endCommentAt(lineBreak: string, quote: string | null): string | null {
  return quote === COMMENT && lineBreak === '\n' ? null : quote;
}

/** Whether a character opens a TOML string. */
function isQuote(ch: string): boolean {
  return ch === '"' || ch === "'";
}

/** How each bracket moves the depth, in one place. */
const BRACKET_DELTA: Record<string, number> = { '[': 1, ']': -1 };

/** How each bracket moves the depth, in one place. */
