export type Severity = 'error' | 'warning' | 'info';

export interface Rule {
  id: string;
  name: string;
  /**
   * The rule's BUILT-IN default threshold.
   *
   * @deprecated This is NOT necessarily the value being enforced. Since #457 the
   * effective threshold comes from the active `.principlesrc` and is read inside
   * `check()`. Reading this field to decide whether a violation should occur will
   * disagree with the checker whenever the project overrides the threshold. Use
   * `getActiveConfig().rules[group][rule].threshold` for the enforced value.
   */
  threshold: number;
  /**
   * The rule's BUILT-IN default severity.
   *
   * @deprecated See {@link Rule.threshold}: the enforced severity comes from the
   * active config. Individual `Violation.severity` values are authoritative.
   */
  severity: Severity;
  check: (file: string, adapter: Adapter) => Violation[];
}

export interface Violation {
  file: string;
  line: number;
  column?: number;
  ruleId: string;
  message: string;
  severity: Severity;
}

/**
 * Duplication measured for one file.
 *
 * `blocks` exists so a caller can explain the percentage rather than only assert
 * it; the rule reports the number, the CLI can point at the lines.
 */
export interface DuplicationReport {
  /** Share of the file's significant lines that repeat elsewhere in the file. */
  percentage: number;
  /** Each repeated region, longest first. */
  blocks: DuplicationBlock[];
}

export interface DuplicationBlock {
  /** 1-based inclusive line range of the first occurrence. */
  startLine: number;
  endLine: number;
  /** How many further occurrences of this block exist in the same file. */
  occurrences: number;
  /** Normalised text shared by the occurrences, for human diagnosis. */
  snippet: string;
}

export interface Adapter {
  detectLanguage: () => string;
  parseAST: () => unknown;
  extractFunctions: () => unknown[];
  extractClasses: () => unknown[];
  extractExports: () => unknown[];
  countLines: () => number;
  /**
   * Measure intra-file duplication.
   *
   * REQUIRED, deliberately. The first version of this member was optional, and
   * that re-created the very defect it was added to fix: an optional member plus
   * a `undefined`-means-no-violation branch is still "a rule configured
   * `enabled: true` that silently never fires" — the failure just moved from
   * "the field was never declared" to "the adapter forgot to implement it".
   * A silent capability gap is the same lie as a silent field gap.
   *
   * Every in-repo adapter extends `BaseAdapter`, which implements this, so
   * requiring it costs nothing here. A third-party adapter written against the
   * old interface gets a compile error — which is the point: it must decide,
   * not default into silence.
   */
  getDuplication: () => DuplicationReport;
}
