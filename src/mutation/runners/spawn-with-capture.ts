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
import { spawn, type SpawnOptions } from 'node:child_process';
import type { MutationRunOutcome, MutationRunResult } from './types';

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
    return { child: spawn(command, args as string[], spawnOptionsFor(options)) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The spawn options for this run.
 *
 * `env` is forwarded only when the CALLER supplied one. Passing `process.env` explicitly
 * is not the same as omitting it: the options object would then carry an env nobody asked
 * for, which surprises callers that assert on the options.
 *
 * stdin is `ignore` on purpose -- a mutated runner has nothing to feed, and an inherited
 * stdin would let it consume the terminal's input instead.
 */
function spawnOptionsFor(options: SpawnCaptureOptions): SpawnOptions {
  return {
    cwd: options.cwd,
    ...(options.env ? { env: options.env } : {}),
    shell: options.shell === true,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
}

/**
 * Arm the timeout: SIGTERM at the deadline, SIGKILL after a grace period.
 *
 * A tool that ignores SIGTERM must not hold the gate open forever, and a tool
 * that needs a moment to flush must not be killed outright.
 */
/**
 * Whether the grace period should end in a SIGKILL.
 *
 * Three guards, and each rules out a different way of signalling the wrong process:
 *
 *   - `state.settled` -- the run already reported an outcome, so there is nothing left
 *     to kill and the pid belongs to nobody in particular;
 *   - `exitCode`/`signalCode` -- the child DIED even if `close` has not fired yet. These
 *     are the fields that say so; `child.killed` does NOT (Node sets it the moment
 *     `kill()` is called, which would make the escalation dead code -- measured).
 *
 * NOT `typeof child.pid === 'number'`: measured, Node KEEPS the pid after the child is
 * reaped, so that check only rules out a spawn that never produced one -- it does not
 * detect recycling, which is what it looked like it was doing. The dead-process guard
 * above is what actually covers that case.
 *
 * The remaining risk is the TOCTOU gap between THIS check and the `kill` call in
 * `armTimeout`. It cannot be closed in user land; it is narrowed by the check being the
 * last statement before the call, and by `kill()` returning false rather than throwing
 * when the child is already gone (measured).
 */
export function shouldEscalate(
  state: Pick<CaptureState, 'settled'>,
  child: ReturnType<typeof spawn>,
): boolean {
  if (state.settled) return false;
  return child.exitCode === null && child.signalCode === null;
}

function armTimeout(
  child: ReturnType<typeof spawn>,
  state: CaptureState,
  timeoutMs: number,
): void {
  state.killTimer = setTimeout(() => {
    state.timeoutFired = true;
    child.kill('SIGTERM');
    state.sigkillTimer = setTimeout(() => {
      if (shouldEscalate(state, child)) child.kill('SIGKILL');
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
  // BOUNDED accumulation: a runner that emits gigabytes would grow these strings until
  // the process dies of OOM, and `common-process.ts` has capped the same risk at 10 MB
  // since it was written (review technical CI-01).
  child.stdout?.on('data', (data: Buffer) => {
    state.stdout = appendBounded(state.stdout, data);
  });
  child.stderr?.on('data', (data: Buffer) => {
    state.stderr = appendBounded(state.stderr, data);
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
      // Clear HERE rather than only in the handlers: a `kill` can deliver `close`
      // SYNCHRONOUSLY, so the timeout path would settle before the handler cleared the
      // escalation timer -- leaving a live timer after the promise resolved. One place
      // that every exit route passes through is what makes "settled means no timers"
      // true instead of probable.
      clearTimers(state);
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

/**
 * Run a mutation command and turn its spawn result into a RUN OUTCOME.
 *
 * Three runners had the same eight lines after their `spawnWithCapture` call: an
 * error becomes `{report: null, error}`, a timeout becomes `{report: null,
 * timedOut: true}`, and otherwise the report is parsed. Each copy was correct, and
 * three copies of a decision is how the fourth runner -- the one written later --
 * gets it subtly different.
 *
 * The order matters: a TIMED-OUT run that also failed to spawn is reported as an
 * error, because "could not start" is the more actionable of the two facts. A
 * timeout implies the process ran.
 *
 * @param command the executable
 * @param args its arguments
 * @param options spawn options
 * @param parse reads the report from the working directory on success
 * @returns the outcome the runner interface expects
 */
export async function runMutationCommand(
  command: string,
  args: string[],
  options: SpawnCaptureOptions,
  parse: (stdout: string) => MutationRunResult | null,
): Promise<MutationRunOutcome> {
  const result = await spawnWithCapture(command, args, options);
  if (result.error) {
    return { report: null, timedOut: false, error: result.error };
  }
  if (result.timedOut) {
    return { report: null, timedOut: true };
  }
  // A non-zero exit is not itself a failure verdict: mutation tools exit non-zero
  // for "score below threshold", and still write the report that says so. The
  // stderr is carried as an `error` so the caller can show WHY without discarding
  // the report the run produced.
  return {
    report: safeParse(parse, result.stdout),
    timedOut: false,
    error: result.code !== 0 ? result.stderr || result.stdout : undefined,
  };
}

/**
 * Run the caller's parser, converting a THROW into a null report.
 *
 * Rejecting this async function instead would let a caller's `catch` swallow the
 * exception into "the tool found nothing" -- a clean pass produced by a parse bug. A null
 * report is the honest answer: nothing was read, so nothing is claimed.
 */
function safeParse(
  parse: (stdout: string) => MutationRunResult | null,
  stdout: string,
): MutationRunResult | null {
  try {
    return parse(stdout);
  } catch (err) {
    console.error(`[mutation] could not read the report: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** The most captured text either stream may hold, matching `common-process.ts`. */
const MAX_CAPTURE_BYTES = 10 * 1024 * 1024;

/**
 * Append a chunk, keeping at most `MAX_CAPTURE_BYTES`.
 *
 * The TAIL is kept, not the head: a failing tool prints its diagnosis last, so truncating
 * the front would drop exactly the lines that explain the failure.
 */
function appendBounded(existing: string, chunk: Buffer): string {
  const combined = existing + chunk.toString();
  if (combined.length <= MAX_CAPTURE_BYTES) return combined;
  return combined.slice(combined.length - MAX_CAPTURE_BYTES);
}
