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
  try {
    if (!existsSync(backupPath)) return;
    writeFileSync(pyprojectPath, readFileSync(backupPath, 'utf-8'), { encoding: 'utf-8' });
    // The backup goes only AFTER the restore SUCCEEDED: deleting it first would destroy
    // the only copy if the write then failed.
    unlinkSync(backupPath);
  } catch (err) {
    // Re-thrown so `restoreFromBackup` reports it once, with the backup path named.
    throw err;
  }
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
    const hadExisting = this.backupPyproject(pyprojectPath);

    try {
      this.writeMutmutConfig(pyprojectPath, sourceDirs);
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
function mutmutConfigContent(existing: string | null, sourcePathsLine: string): string {
  if (existing === null) return `[tool.mutmut]\n${sourcePathsLine}\n`;
  if (!existing.includes('[tool.mutmut]')) {
    return existing.trimEnd() + `\n\n[tool.mutmut]\n${sourcePathsLine}\n`;
  }
  const sourcePathsRegex = /source_paths\s*=\s*\[.*?\]/;
  if (sourcePathsRegex.test(existing)) return existing.replace(sourcePathsRegex, sourcePathsLine);
  return existing.replace('[tool.mutmut]', `[tool.mutmut]\n${sourcePathsLine}`);
}
