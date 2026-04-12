export type Severity = 'error' | 'warning' | 'info';

export interface Rule {
  id: string;
  name: string;
  threshold: number;
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
  countLines: () => number;
}