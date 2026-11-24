/**
 * Run a mutation tool and capture everything it said.
 *
 * WHY THIS EXISTS
 * ---------------
 * Four runners (stryker, pitest, go-mutant, gremlins) each carried their own
 * copy of the same skeleton: spawn, accumulate stdout/stderr, arm a timer, send
 * SIGTERM then SIGKILL, and resolve with a code. jscpd measured 116 duplicated
 * lines across them on 2026-11-24. Four copies of a timeout policy means four
 * places it can disagree with itself, and only one of them gets tested.
 *
 * The contract every caller relies on:
 *
 *   - a child that EXITS, cleanly or not, yields its code and `timedOut: false`;
 *   - a child killed by the timeout yields `code: null, timedOut: true`;
 *   - a child that cannot start yields `code: null, error: <message>`.
 *
 * The last one is the reason this resolves instead of rejecting: callers wrap it
 * in a Promise chain whose `catch` turns a thrown error into "the tool produced
 * no findings", which reads as a pass. A broken toolchain must not look like a
 * clean one.
 */
import { spawn } from 'node:child_process';

export interface SpawnCaptureResult {
  stdout: string;
  stderr: string;
  /** Exit code, or null when the child was killed or never started. */
  code: number | null;
  /** True when the timeout fired and the child was terminated. */
  timedOut: boolean;
  /** Set only when the process could not be started at all. */
  error?: string;
}

export interface SpawnCaptureOptions {
  timeoutMs: number;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Run through a shell.
   *
   * `npx` is a shell script on some platforms, and the runners this replaced all
   * passed `shell: true`. Dropping it would change how the command is located --
   * a migration must not quietly change behaviour it is only meant to relocate.
   */
  shell?: boolean;
}

/** How long a child gets to honour SIGTERM before it is killed outright. */
const SIGKILL_GRACE_MS = 5_000;

/** Mutable capture state shared by the listeners below. */
interface CaptureState {
  stdout: string;
  stderr: string;
  settled: boolean;
  timeoutFired: boolean;
  sigkillTimer?: NodeJS.Timeout;
  killTimer?: NodeJS.Timeout;
}

/**
 * Spawn the child, or report why it could not be started.
 *
 * Separated because a synchronous throw here is a different failure from an
 * async 'error' event, and the caller must see both as `error` results rather
 * than as a rejection.
 */
function trySpawn(
  command: string,
  args: readonly string[],
  options: SpawnCaptureOptions,
): { child?: ReturnType<typeof spawn>; error?: string } {
  try {
    const child = spawn(command, args as string[], {
      cwd: options.cwd,
      // Only forward `env` when the caller supplied one. Passing `process.env`
      // explicitly is not the same as omitting it: the options object then
      // carries an env the caller never asked for, which surprises callers that
      // assert on the options.
      ...(options.env ? { env: options.env } : {}),
      shell: options.shell === true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { child };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Arm the timeout: SIGTERM at the deadline, SIGKILL after a grace period.
 *
 * A tool that ignores SIGTERM must not hold the gate open forever, and a tool
 * that needs a moment to flush must not be killed outright.
 */
function armTimeout(
  child: ReturnType<typeof spawn>,
  state: CaptureState,
  timeoutMs: number,
): void {
  state.killTimer = setTimeout(() => {
    state.timeoutFired = true;
    child.kill('SIGTERM');
    state.sigkillTimer = setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
    }, SIGKILL_GRACE_MS);
  }, timeoutMs);
}

function clearTimers(state: CaptureState): void {
  if (state.killTimer) clearTimeout(state.killTimer);
  if (state.sigkillTimer) clearTimeout(state.sigkillTimer);
}

/**
 * Wire the listeners that turn a running child into a settled result.
 *
 * Kept out of `spawnWithCapture` so the exported function reads as the sequence
 * it is: try to start, wire the outcome, arm the deadline.
 */
function wireOutcome(
  child: ReturnType<typeof spawn>,
  state: CaptureState,
  settle: (result: SpawnCaptureResult) => void,
): void {
  child.stdout?.on('data', (data: Buffer) => {
      state.stdout += data.toString();
    });
  child.stderr?.on('data', (data: Buffer) => {
    state.stderr += data.toString();
  });

  // Async spawn failures (ENOENT) arrive as an 'error' event, not a throw.
  child.on('error', (err: Error) => {
    clearTimers(state);
    settle({ stdout: state.stdout, stderr: state.stderr, code: null, timedOut: false, error: err.message });
  });

  child.on('close', (code) => {
    clearTimers(state);
    settle({
      stdout: state.stdout,
      stderr: state.stderr,
      code: code ?? null,
      // A null exit code means the child did not exit on its own: our timer
      // killed it, or something else did. Both are "we did not get a verdict".
      // Preferring `timeoutFired` alone would be wrong -- a child killed by an
      // external signal also arrives with `code === null` while the timer never
      // fired, and calling that a clean exit is the fail-open this module
      // exists to prevent.
      timedOut: code === null || state.timeoutFired,
    });
  });
}

export function spawnWithCapture(
  command: string,
  args: readonly string[],
  options: SpawnCaptureOptions,
): Promise<SpawnCaptureResult> {
  return new Promise((resolve) => {
    const state: CaptureState = { stdout: '', stderr: '', settled: false, timeoutFired: false };
    const settle = (result: SpawnCaptureResult): void => {
      if (state.settled) return;
      state.settled = true;
      resolve(result);
    };

    const { child, error } = trySpawn(command, args, options);
    if (!child) {
      settle({ stdout: '', stderr: '', code: null, timedOut: false, error });
      return;
    }
    wireOutcome(child, state, settle);
    armTimeout(child, state, options.timeoutMs);
  });
}
