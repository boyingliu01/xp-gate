export type MockStrategy = 'real' | 'mock' | 'partial';

export type DependencyScope = 'internal' | 'external' | 'pending';

export interface MockDecision {
  strategy: MockStrategy;
  reason: string;
  layer?: TestLayer;
  pendingRemoval?: {
    ticket: string;
    reason: string;
  };
}

export type TestLayer = 'unit' | 'integration' | 'e2e' | 'unknown';

export interface ProjectScope {
  implementedModules: string[];
  unimplementedModules: string[];
  externalPackages: string[];
  projectBoundary: string[];
}

export interface MockPolicyViolation {
  file: string;
  line: number;
  dependency: string;
  actualStrategy: MockStrategy;
  expectedStrategy: MockStrategy;
  reason: string;
  severity: 'error' | 'warning';
}

export interface MockPolicyLayerRules {
  mockPolicy: 'strict' | 'lenient';
  requireRealForImplemented: boolean;
  allowExternalMock: boolean;
  requirePendingRemoval: boolean;
  maxMockDensity?: number;
}

export type MockPolicySeverity = 'error' | 'warning';

export interface MockPolicyConfig {
  version: 1;
  layers: {
    unit: MockPolicyLayerRules;
    integration: MockPolicyLayerRules;
    e2e: MockPolicyLayerRules;
  };
  projectBoundary: string[];
  severity: MockPolicySeverity;
}

export interface MockPolicyResult {
  exitCode: number;
  status: 'pass' | 'block' | 'skip';
  violations: MockPolicyViolation[];
  scores: {
    totalTests: number;
    integrationTests: number;
    mockDensity: number;
    pendingMocks: number;
  };
}
