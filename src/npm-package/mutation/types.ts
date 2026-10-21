export interface MutationScore {
  score: number;
  /**
   * Mutant outcome counts. Optional on purpose (#544): a runner that did not
   * report them must leave them absent, so a consumer can tell "not measured"
   * from "measured zero". They used to be hardcoded to 0, which made every
   * unmeasured file read as a clean one.
   */
  mutants?: number;
  killed?: number;
  survived?: number;
}

export interface MutationBaseline {
  version: string;
  generatedAt: string;
  source: 'local' | 'ci';
  scores: Record<string, MutationScore>;
}

export interface GateMOptions {
  changedFiles: string[];
  baselinePath: string;
  criticalPathsPath: string;
  timeoutMs: number;
}

export type GateMStatus = 'pass' | 'block' | 'skip' | 'timeout';

export interface GateMResult {
  exitCode: number;
  status: GateMStatus;
  filesChecked: number;
  scores: Record<string, MutationScore>;
  warnings: string[];
  errors: string[];
}

export type TestLayer = 'unit' | 'integration' | 'e2e' | 'unknown';

export interface AITestDetectionResult {
  isAiGenerated: boolean;
  mockDensity: number;
  layer: TestLayer;
  explicitThreshold?: number;
  annotations: {
    hasTest: boolean;
    hasIntent: boolean;
    hasCovers: boolean;
  };
}

export interface TestIntentCheckResult {
  sourceFile: string;
  testFile: string | null;
  hasTestAnnotation: boolean;
  hasIntentAnnotation: boolean;
  hasCoversAnnotation: boolean;
  missingAnnotations: string[];
}

export interface FileThreshold {
  file: string;
  threshold: number;
  isCriticalPath: boolean;
  explicitThreshold?: number;
}

export interface ScoreEvaluation {
  file: string;
  score: number;
  threshold: number;
  baselineScore?: number;
  passed: boolean;
  isRegression: boolean;
}
