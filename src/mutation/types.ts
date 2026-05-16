export interface MutationScore {
  score: number;
  mutants: number;
  killed: number;
  survived: number;
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

export interface StrykerFileReport {
  mutationScore: number;
  nrOfMutants: number;
  nrOfKilledMutants: number;
  nrOfSurvivedMutants: number;
}

export interface StrykerReport {
  mutationScore: number;
  nrOfMutants: number;
  nrOfKilledMutants: number;
  nrOfSurvivedMutants: number;
  files?: Record<string, StrykerFileReport>;
}

export interface AITestDetectionResult {
  isAiGenerated: boolean;
  mockDensity: number;
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
