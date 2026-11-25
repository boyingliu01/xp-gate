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

    const nrOfKilledMutants = killed;
    const nrOfSurvivedMutants =
      survived + timeout + suspicious + untested + unknown1 + unknown2;
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
  private extractEmojiCount(line: string, emoji: string): number {
    const escapedEmoji = emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = line.match(new RegExp(`${escapedEmoji}\\s*(\\d+)`));
    return parseInt(match?.[1] ?? '0', 10);
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
    const sourcePathsLine = `source_paths = [${sourceDirs.map((d) => `"${d}"`).join(', ')}]`;
    try {
      // Read here so the content builder stays pure: it then has no I/O to
      // fail on, and the one place that can fail is the one that explains why.
      const existing = existsSync(pyprojectPath) ? readFileSync(pyprojectPath, 'utf-8') : null;
      writeFileSync(pyprojectPath, mutmutConfigContent(existing, sourcePathsLine), {
        encoding: 'utf-8',
      });
    } catch (err) {
      // A missing or half-written pyproject.toml would make mutmut scan the wrong
      // tree, so surface the path instead of letting a bare fs error escape.
      throw new Error(`Could not write mutmut config to ${pyprojectPath}: ${(err as Error).message}`);
    }
  }
}

/**
 * pyproject.toml content with `[tool.mutmut] source_paths` set as requested.
 *
 * Pure by design: the caller reads the existing file and passes it in, so this
 * function has no I/O that could fail partway through. Three shapes have to be
 * preserved -- an existing `source_paths` is rewritten in place, a bare
 * `[tool.mutmut]` table gets the key added, and a file without the table gets
 * one appended (a fresh file passes `null`).
 *
 * @param existing current file content, or null when the file does not exist.
 */
export function mutmutConfigContent(existing: string | null, sourcePathsLine: string): string {
  if (existing === null) return `[tool.mutmut]\n${sourcePathsLine}\n`;
  const table = findMutmutTable(existing);
  if (table === null) return existing.trimEnd() + `\n\n[tool.mutmut]\n${sourcePathsLine}\n`;
  const at = findSourcePathsValue(existing, table.bodyStart, table.bodyEnd);
  if (at === UNCLOSED) {
    // The table has a `source_paths` whose array never closes -- a file that is already
    // invalid. Appending a second key would compound it (measured: two `source_paths`
    // in one table). Leave the text alone and let the operator fix it.
    return existing;
  }
  if (at === null) {
    // No key in the table: add it first thing in the body.
    return existing.slice(0, table.bodyStart) + `\n${sourcePathsLine}` + existing.slice(table.bodyStart);
  }
  return existing.slice(0, at.start) + sourcePathsLine + existing.slice(at.end);
}

/** The `[tool.mutmut]` table's span in the document. */
interface TableSpan {
  /** First character AFTER the header line. */
  bodyStart: number;
  /** Index of the next table header, or the end of the document. */
  bodyEnd: number;
}

/**
 * Locate the `[tool.mutmut]` TABLE, by INDEX rather than by rebuilding the text.
 *
 * Every earlier attempt matched text and replaced it, and each one broke on a
 * different input: a commented header, another table's `source_paths`, an array
 * containing `]`, and -- once the text was assembled -- a body that happens to appear
 * earlier in the file, so `replace` rewrote the WRONG place. All four are measured.
 * Working with indices removes the class: nothing is found by its text twice.
 *
 * A commented `# [tool.mutmut]` is not a table, and neither is a string that contains
 * the text; the header must be a line of its own.
 */
function findMutmutTable(doc: string): TableSpan | null {
  const header = /^[^\S\n]*\[tool\.mutmut\][^\S\n]*$/m;
  const found = header.exec(doc);
  if (!found) return null;
  const bodyStart = found.index + found[0].length;
  const rest = doc.slice(bodyStart);
  const next = /^[^\S\n]*\[/m.exec(rest);
  return { bodyStart, bodyEnd: next ? bodyStart + next.index : doc.length };
}

/**
 * The span of the `source_paths = [...]` VALUE inside the table, or null when absent.
 *
 * The array is delimited by BALANCING brackets, not by a lazy `[\s\S]*?\]`: a path may
 * legitimately contain `]` (`"src]"`), and a lazy match stops there and produced
 * invalid TOML (measured). Quotes are skipped so a `[` or `]` inside a string cannot
 * move the depth.
 */
function findSourcePathsValue(
  doc: string,
  bodyStart: number,
  bodyEnd: number,
): { start: number; end: number } | null | typeof UNCLOSED {
  const key = findKeyOutsideStrings(doc, bodyStart, bodyEnd);
  if (key === -1) return null;
  const open = doc.indexOf('[', key);
  // No `[` after the key within the table: `source_paths` is assigned something that is
  // not an array (a bare string, a number). Reporting `null` here would mean "no key",
  // and the caller would INSERT a second one -- measured: two `source_paths` in one
  // table. `UNCLOSED` says "there IS a key, and I cannot rewrite it safely".
  if (open === -1 || open >= bodyEnd) return UNCLOSED;
  const close = matchingBracket(doc, open, bodyEnd);
  return close === -1 ? UNCLOSED : { start: key, end: close + 1 };
}

/** A line that assigns `source_paths`. */
const KEY_LINE = /^[^\S\n]*source_paths[^\S\n]*=/;

/**
 * Index where a REAL `source_paths =` key starts, or -1.
 *
 * Line-by-line with a string state machine, not `^.../m`: a MULTI-LINE string can hold
 * a line that looks exactly like the key. Measured -- a
 * `description = """` containing `source_paths = ["fake"]` inside `[tool.mutmut]` was
 * rewritten while the REAL key below it was left alone.
 *
 * All four TOML string forms are tracked: `"..."`, `'...'`, `"""..."""` and
 * `'''...'''`. The multi-line forms are why a single-line regex cannot work here --
 * they legitimately span the newlines the regex would anchor on.
 */
function findKeyOutsideStrings(doc: string, from: number, to: number): number {
  let quote: string | null = null;
  let offset = from;
  for (const line of doc.slice(from, to).split('\n')) {
    const isKey = quote === null && KEY_LINE.test(line);
    quote = scanLineForQuote(line, quote);
    if (isKey && quote === null) return offset;
    offset += line.length + 1;
  }
  return -1;
}

/** The string delimiter still open after this line, or null when outside one. */
function scanLineForQuote(line: string, quote: string | null): string | null {
  let open = quote;
  for (let i = 0; i < line.length; i += 1) {
    const hit = QUOTE_TOKENS.find((token) => line.startsWith(token.delimiter, i));
    if (!hit) continue;
    if (open === null) open = hit.delimiter;
    else if (open === hit.delimiter) open = null;
    i += hit.delimiter.length - 1;
  }
  return open;
}

/** The TOML string delimiters, longest first so `"""` wins over `"`. */
const QUOTE_TOKENS = [
  { delimiter: '"""' },
  { delimiter: "'''" },
  { delimiter: '"' },
  { delimiter: "'" },
];

/** Marks a `source_paths` whose array never closes, so the caller can leave it alone. */
const UNCLOSED = Symbol('unclosed array');

/** Index of the `]` balancing the `[` at `open`, skipping quoted strings; -1 if none. */
function matchingBracket(doc: string, open: number, limit: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < limit; i += 1) {
    const step = bracketStep(doc, i, quote);
    // Inside a string the character is DATA: it must not move the depth, and a backslash
    // also consumes the next one.
    if (step.escape) i += 1;
    else quote = step.quote;
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
  /** The character was a backslash inside a string, so the NEXT one is data. */
  escape: boolean;
}

/**
 * Classify one character.
 *
 * Quotes are tracked because a path may contain `[` or `]` -- `"src]"` must not close
 * the array, which is exactly what a lazy regex got wrong.
 */
function bracketStep(doc: string, i: number, quote: string | null): BracketStep {
  const ch = doc[i];
  if (quote === null) return outsideString(ch);
  return { quote: nextQuote(ch, quote), delta: 0, escape: ch === '\\' };
}

/** What a character does when the scan is OUTSIDE a string. */
function outsideString(ch: string): BracketStep {
  if (isQuote(ch)) return { quote: ch, delta: 0, escape: false };
  return { quote: null, delta: BRACKET_DELTA[ch] ?? 0, escape: false };
}

/** The quote still open after this character, or null when the string ended. */
function nextQuote(ch: string, quote: string): string | null {
  return ch === quote ? null : quote;
}

/** Whether a character opens a TOML string. */
function isQuote(ch: string): boolean {
  return ch === '"' || ch === "'";
}

/** How each bracket moves the depth, in one place. */
const BRACKET_DELTA: Record<string, number> = { '[': 1, ']': -1 };

/** How each bracket moves the depth, in one place. */
