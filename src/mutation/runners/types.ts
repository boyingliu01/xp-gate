// @no-test-required: LangAdapter types/interface — tested via gate-m integration
/**
 * Language-agnostic mutation runner interface.
 *
 * Each language-specific runner (Stryker for TypeScript, mutmut for Python)
 * implements this interface so gate-m.ts can route by file extension without
 * knowing the underlying tool.
 */

/** Normalized mutation score — all runners emit this shape. */
export interface MutationFileReport {
  /** Score as percentage (0–100). */
  mutationScore: number;
  /** Total number of mutants generated for this file. */
  nrOfMutants: number;
  /** Mutants killed by the test suite. */
  nrOfKilledMutants: number;
  /** Mutants that survived. */
  nrOfSurvivedMutants: number;
}

/** Aggregated result from a single runner invocation. */
export interface MutationRunResult {
  /** Top-level normalized mutation score (0–100). */
  mutationScore: number;
  /** Total mutants across all processed files. */
  nrOfMutants: number;
  /** Total killed mutants. */
  nrOfKilledMutants: number;
  /** Total survived mutants. */
  nrOfSurvivedMutants: number;
  /** Per-file breakdown (optional; runner may not support it). */
  files?: Record<string, MutationFileReport>;
}

/** Outcome of invoking a mutation runner. */
export interface MutationRunOutcome {
  /** Parsed report data. null if the run failed or timed out. */
  report: MutationRunResult | null;
  /** Whether the runner exceeded its timeout. */
  timedOut: boolean;
  /** Error message (if any). */
  error?: string;
}

/** Parameters passed to all runners. */
export interface RunMutationOptions {
  /** Source files to mutate (relative paths, no test files). */
  files: string[];
  /** Timeout in milliseconds. */
  timeoutMs: number;
  /** Project root directory (for config file resolution). */
  cwd: string;
}

/**
 * Language-specific mutation runner.
 *
 * Implement this interface for each tool (Stryker, mutmut, etc.).
 * The runner is responsible for:
 *   1. Invoking the mutation tool with the correct CLI args.
 *   2. Parsing tool-specific output into a normalized MutationRunResult.
 *   3. Enforcing the timeout and returning a MutationRunOutcome.
 *
 * Do NOT include threshold logic, baseline comparison, or file filtering here —
 * those are the responsibility of gate-m.ts (the orchestrator).
 */
export interface MutationRunner {
  /** Human-readable name (e.g. "Stryker", "mutmut"). */
  readonly name: string;

  /** File extensions this runner handles (without dot, e.g. ["ts", "tsx"]). */
  readonly extensions: string[];

  /** Whether the tool is available on the system (quick check). */
  isAvailable(): Promise<boolean>;

  /** Run mutation testing on the given files. */
  run(options: RunMutationOptions): Promise<MutationRunOutcome>;
}

/** Registry of runners, keyed by language name. */
export const runnerRegistry = new Map<string, MutationRunner>();

/** Register a runner so it can be resolved by file extension. */
export function registerRunner(runner: MutationRunner): void {
  runnerRegistry.set(runner.name, runner);
}

/**
 * Resolve the correct runner for a given file extension.
 * Returns undefined if no runner supports this extension.
 */
export function resolveRunner(ext: string): MutationRunner | undefined {
  const normalized = ext.replace(/^\./, '');
  for (const runner of Array.from(runnerRegistry.values())) {
    if (runner.extensions.includes(normalized)) return runner;
  }
  return undefined;
}
