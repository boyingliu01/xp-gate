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
   * Optional on purpose: a third-party adapter written before this existed keeps
   * compiling and keeps the pre-existing "no duplication data ⇒ no violation"
   * behaviour. Without this member the `clean-code.code-duplication` rule was
   * unreachable in production — nothing ever supplied the number it judged, so
   * a rule configured `enabled: true` never fired (REQ-PRINCIPLES-DUP).
   */
  getDuplication?: () => DuplicationReport;
}
