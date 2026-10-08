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

export interface Adapter {
  detectLanguage: () => string;
  parseAST: () => unknown;
  extractFunctions: () => unknown[];
  extractClasses: () => unknown[];
  extractExports: () => unknown[];
  countLines: () => number;
}
