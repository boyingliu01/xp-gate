// Gate 10: Build/Compile Integrity Check — Type Definitions

/** Parameters for running the Gate 10 build integrity check. */
export interface Gate10Options {
  changedFiles: string[];
  projectRoot: string;
  timeoutMs: number;
}

/** Overall gate status. */
export type Gate10Status = 'pass' | 'block' | 'skip';

/** Result of a single check (tsc, pack, or imports). */
export interface CheckResult {
  status: 'pass' | 'fail' | 'skip';
  message: string;
  durationMs: number;
}

/** A broken import found by the import resolver. */
export interface ImportViolation {
  /** Absolute path to the file containing the broken import. */
  file: string;
  /** 1-based line number of the import statement. */
  line: number;
  /** The raw import path string (e.g. `../../src/baz`). */
  importPath: string;
  /** What the import resolved to on disk. */
  resolvedPath: string;
  /** Human-readable explanation (e.g. "path escapes package boundary"). */
  reason: string;
}

/** Result of the import resolver check (extends CheckResult with violations). */
export interface ImportCheckResult extends CheckResult {
  violations: ImportViolation[];
}

/** Complete result returned by Gate 10. */
export interface Gate10Result {
  /** Exit code: 0 = allow, 1 = block. */
  exitCode: number;
  status: Gate10Status;
  checks: {
    tsc: CheckResult;
    pack: CheckResult;
    imports: ImportCheckResult;
  };
  warnings: string[];
  errors: string[];
}
