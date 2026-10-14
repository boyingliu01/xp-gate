// @no-test-required: gremlins wrapper — tested via gremlins-runner.test.ts + pre-push Gate M
import { spawn, execSync, type ChildProcess } from 'child_process';
import { dirname } from 'path';
import type {
  MutationRunner,
  RunMutationOptions,
  MutationRunOutcome,
  MutationRunResult,
} from './types';

/**
 * pytest-gremlins mutation runner for Python files (#410).
 *
 * Why a second Python engine exists: mutmut 3.x is built on fork(), so on
 * Windows it can only run under WSL — a native Windows user had a structural
 * deadlock (installed => `mutmut run` exits 1 => push blocked; uninstalled =>
 * Gate M skips). pytest-gremlins uses mutation *switching* (instrument once,
 * flip an env var per mutant) with no fork and no per-mutant file I/O, making
 * it natively cross-platform. It also matches Gate M's needs: coverage-guided
 * test selection, an incremental content-hash cache, parallel workers and
 * console/HTML/JSON reports.
 *
 * Constraint: pytest-gremlins requires Python >= 3.11. On older interpreters
 * the import probe simply fails and the caller keeps the mutmut path (or
 * SKIPs) — no new hard dependency.
 */
/**
 * How long to wait after SIGTERM before escalating to SIGKILL. pytest-gremlins
 * runs a whole pytest session per invocation, so a child that ignores SIGTERM
 * (stuck in a C extension) still needs a hard backstop.
 */
const SIGKILL_ESCALATION_MS = 5000;

/** Bound on the one-shot import probe; a hung interpreter must not stall Gate M. */
const PROBE_TIMEOUT_MS = 10000;

/**
 * Exactly-once resolve bookkeeping for a spawned mutation run.
 *
 * A child can report `close`, `error`, a timeout, and the SIGKILL escalation in
 * any interleaving; without a single latched gate the Promise resolves twice
 * (subsequent resolves are silent no-ops, but the *first* one wins, which can
 * be the wrong verdict). `settled` makes the ordering irrelevant. Extracted
 * from `spawnGremlins` so that function stays under the long-function budget.
 *
 * A factory rather than a class: it holds no collaborators to inject, and the
 * SOLID analyzer flags `new X()` as a dependency-inversion smell regardless of
 * whether the type is injectable.
 */
function createSettleGuard(resolve: (o: MutationRunOutcome) => void) {
  let settled = false;
  let escalationId: NodeJS.Timeout | undefined;
  let timeoutId: NodeJS.Timeout | undefined;

  const escalateToKill = (child: ChildProcess): void => {
    if (!settled) child.kill('SIGKILL');
  };

  const guard = {
    timedOut: false,
    /** SIGTERM at `timeoutMs`, escalating to SIGKILL if the child ignores it. */
    armTimeout(child: ChildProcess, timeoutMs: number): void {
      timeoutId = setTimeout(() => {
        guard.timedOut = true;
        child.kill('SIGTERM');
        if (settled) return;
        escalationId = setTimeout(() => escalateToKill(child), SIGKILL_ESCALATION_MS);
      }, timeoutMs);
    },
    settle(outcome: MutationRunOutcome): void {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (escalationId) clearTimeout(escalationId);
      resolve(outcome);
    },
  };
  return guard;
}

export class GremlinsRunner implements MutationRunner {
  readonly name = 'pytest-gremlins';
  readonly extensions = ['py'];

  async isAvailable(): Promise<boolean> {
    try {
      execSync('python -c "import pytest_gremlins"', {
        stdio: 'pipe',
        timeout: PROBE_TIMEOUT_MS,
      });
      return true;
    } catch {
      return false;
    }
  }

  async run(options: RunMutationOptions): Promise<MutationRunOutcome> {
    if (!(await this.isAvailable())) {
      return { report: null, timedOut: false };
    }

    // Spawning can throw synchronously (e.g. ENOENT on a broken interpreter
    // shim); that must surface as a null report, never as an unhandled
    // rejection that aborts the whole Gate M orchestration.
    try {
      return await this.spawnGremlins(options);
    } catch (err) {
      return {
        report: null,
        timedOut: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Build the argv for `python -m pytest`.
   *
   * `-m pytest` rather than a bare `pytest`: the import probe in
   * `isAvailable()` already proved *this* interpreter carries the plugin, so
   * running through the same interpreter is the only way to be sure the plugin
   * is actually loaded.
   */
  private gremlinsArgs(options: RunMutationOptions): string[] {
    return [
      '-m',
      'pytest',
      '--gremlins',
      `--gremlin-targets=${buildTargets(options.files)}`,
      '--gremlin-report=console',
      '--gremlin-parallel',
      '--gremlin-cache',
    ];
  }

  /** Spawn the child and settle exactly once, on close or on error. */
  private spawnGremlins(options: RunMutationOptions): Promise<MutationRunOutcome> {
    return new Promise((resolve) => {
      const guard = createSettleGuard(resolve);
      let child: ChildProcess;
      try {
        child = spawn('python', this.gremlinsArgs(options), {
          stdio: 'pipe',
          cwd: options.cwd,
        });
      } catch (err) {
        guard.settle({
          report: null,
          timedOut: false,
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      let stdout = '';
      let stderr = '';
      guard.armTimeout(child, options.timeoutMs);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        // A missing report is NOT a failure verdict: parse returns null and the
        // orchestrator keeps its non-blocking semantics (same contract as the
        // mutmut runner's null report).
        guard.settle({
          report: parseConsoleReport(stdout),
          timedOut: guard.timedOut,
          error: code !== 0 ? stderr || stdout : undefined,
        });
      });

      child.on('error', (err) => {
        guard.settle({ report: null, timedOut: guard.timedOut, error: err.message });
      });
    });
  }
}

/**
 * Comma-separated mutate targets, deduplicated, derived from the changed
 * files' directories — `--gremlin-targets` accepts files OR directories, and
 * the directories keep the mutant count bounded to the touched area.
 *
 * Module-level and pure so it is directly testable without instantiating the
 * runner.
 */
function buildTargets(files: string[]): string {
  const dirs = new Set<string>();
  for (const file of files) {
    const dir = dirname(file);
    dirs.add(dir && dir !== '.' ? dir : file);
  }
  return Array.from(dirs).join(',');
}

/**
 * Parse pytest-gremlins' console report.
 *
 * The report prints two lines (plus a banner):
 *   Zapped: 142 gremlins (89%)
 *   Survived: 18 gremlins (11%)
 *
 * Returns null when neither line is present — a run that never got to the
 * report (import failure, collection error, timeout) must not be reported as
 * a 0% score, which would be a fabricated verdict. `Zapped` maps to killed,
 * `Survived` to survived; the totals are their sum, matching the mutmut
 * runner's normalization exactly.
 */
export function parseConsoleReport(stdout: string): MutationRunResult | null {
  const zapped = extractCount(stdout, /Zapped:\s*(\d+)\s*gremlins?/i);
  const survived = extractCount(stdout, /Survived:\s*(\d+)\s*gremlins?/i);

  if (zapped === null && survived === null) return null;

  const nrOfKilledMutants = zapped ?? 0;
  const nrOfSurvivedMutants = survived ?? 0;
  const nrOfMutants = nrOfKilledMutants + nrOfSurvivedMutants;
  if (nrOfMutants === 0) return null;

  return {
    mutationScore: (nrOfKilledMutants / nrOfMutants) * 100,
    nrOfMutants,
    nrOfKilledMutants,
    nrOfSurvivedMutants,
  };
}

function extractCount(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (!match?.[1]) return null;
  const value = parseInt(match[1], 10);
  return Number.isNaN(value) ? null : value;
}
