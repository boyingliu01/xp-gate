# Issue #78: Mock Layering Strategy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a proactive mock decision engine that classifies dependencies by project scope (internal vs external) and implementation state, replacing the reactive mock density heuristic in Gate M2 with architectural boundary-aware mock policies.

**Architecture:** Create `src/mock-policy/` module (scope scanner + decision engine + config loader), extend `detect-ai-test.ts` with layering awareness, add Gate M3 in pre-push hook. Follow existing mutation module patterns - standalone TS module consumed by shell-based git hooks.

**Tech Stack:** TypeScript (Node.js), Vitest (TDD), shell scripting (githooks), js-yaml + zod for config
**Delphi Review:** Round 1 REQUEST_CHANGES (2 experts, 100% consensus) — see `.sprint-state/phase-outputs/delphi-round-1-report.md`
**Config Format:** `.mockpolicyrc` (JSON, same style as `.principlesrc`), validated with zod schema
**Scope:** v1 = TypeScript only (TypeScript+JavaScript test files), v2 = Python/Go adapter support

**Design Reference:** https://github.com/boyingliu01/xp-gate/issues/78
**Research Reference:** `.sprint-state/phase-outputs/delphi-round-1-report.md` (community comment with industry research)

---
**Specification:**
- REQ-1: Project Scope Scanner — auto-detect internal/external/pending modules
- REQ-2: Mock Decision Engine — rules-based mock strategy per dependency
- REQ-3: Layering-Aware AI Test Detection — extend detect-ai-test.ts with test type classification
- REQ-4: Gate M3 — pre-push mock layering enforcement
- REQ-5: Config — `.mockpolicyrc` (JSON, validated with zod schema — same style as `.principlesrc`)
- REQ-6: Gate M2/M3 Interaction — M3 overrides M2 when enabled, M2 skips files already checked by M3
---

### Task 1: Mock Policy Types

**Files:**
- Create: `src/mock-policy/types.ts`

**Step 1: Write the types file**

```typescript
// src/mock-policy/types.ts

export type MockStrategy = 'real' | 'mock' | 'partial';

export type DependencyScope = 'internal' | 'external' | 'pending';

export interface DependencyInfo {
  importPath: string;
  scope: DependencyScope;
  isImplemented: boolean;
  reason: string;
  pendingTicket?: string;
}

export interface MockDecision {
  strategy: MockStrategy;
  reason: string;
  layer?: 'unit' | 'integration' | 'e2e';
  pendingRemoval?: {
    ticket: string;
    reason: string;
  };
}

export interface ProjectScope {
  implementedModules: string[];
  unimplementedModules: string[];
  externalPackages: string[];
  projectBoundary: string[];  // glob patterns for internal paths
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

export interface MockPolicyConfig {
  version: number;
  layers: {
    unit: MockPolicyLayerRules;
    integration: MockPolicyLayerRules;
    e2e: MockPolicyLayerRules;
  };
  projectBoundary: string[];
  severity: 'error' | 'warning';
}

export interface MockPolicyLayerRules {
  mockPolicy: 'strict' | 'lenient';
  requireRealForImplemented: boolean;
  allowExternalMock: boolean;
  requirePendingRemoval: boolean;
  maxMockDensity?: number;
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
```

**Step 2: Verify types compile**

```bash
npx tsc --noEmit src/mock-policy/types.ts
```

Expected: No errors (just the file being isolated, types compile clean)

**Step 3: Commit**

```bash
git add src/mock-policy/types.ts
git commit -m "feat(mock-policy): add type definitions for mock layering strategy"
```

---

### Task 2: Mock Policy Config Loader

**Files:**
- Create: `src/mock-policy/config.ts`
- Test: `src/mock-policy/__tests__/config.test.ts`

**Step 1: Write the failing test**

```typescript
// src/mock-policy/__tests__/config.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs/promises';
import { loadMockPolicyConfig } from '../config';

vi.mock('fs/promises');
vi.mock('fs', () => ({ existsSync: vi.fn() }));

describe('loadMockPolicyConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return default config when no file exists', async () => {
    const { existsSync } = await import('fs');
    vi.mocked(existsSync).mockReturnValue(false);

    const config = await loadMockPolicyConfig();

    expect(config.version).toBe(1);
    expect(config.layers.integration.requireRealForImplemented).toBe(true);
    expect(config.layers.unit.mockPolicy).toBe('lenient');
    expect(config.projectBoundary).toEqual(['src/**']);
  });

  it('should load and merge user config', async () => {
    const { existsSync } = await import('fs');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({
      version: 1,
      layers: {
        unit: { mockPolicy: 'strict', requireRealForImplemented: false, allowExternalMock: true, requirePendingRemoval: false, maxMockDensity: 100 },
        integration: { mockPolicy: 'strict', requireRealForImplemented: false, allowExternalMock: true, requirePendingRemoval: false, maxMockDensity: 30 },
        e2e: { mockPolicy: 'strict', requireRealForImplemented: true, allowExternalMock: false, requirePendingRemoval: false, maxMockDensity: 0 },
      },
      projectBoundary: ['src/**'],
      severity: 'warning',
    }));

    const config = await loadMockPolicyConfig();

    expect(config.layers.integration.requireRealForImplemented).toBe(false);
    // Other defaults preserved — unit still has its own rules
    expect(config.layers.unit.mockPolicy).toBe('strict');
  });

  it('should reject invalid config via zod validation', async () => {
    const { existsSync } = await import('fs');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ version: 99 }));

    await expect(loadMockPolicyConfig()).rejects.toThrow('Invalid mock policy config');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/mock-policy/__tests__/config.test.ts
```

Expected: FAIL with module not found

**Step 3: Write minimal implementation (uses js-yaml + zod)**

```typescript
// src/mock-policy/config.ts
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { MockPolicyConfigSchema, type MockPolicyConfig } from './schema';

const DEFAULT_CONFIG: MockPolicyConfig = {
  version: 1,
  layers: {
    unit: {
      mockPolicy: 'lenient',
      requireRealForImplemented: false,
      allowExternalMock: true,
      requirePendingRemoval: false,
      maxMockDensity: 100,
    },
    integration: {
      mockPolicy: 'strict',
      requireRealForImplemented: true,
      allowExternalMock: true,
      requirePendingRemoval: true,
      maxMockDensity: 30,
    },
    e2e: {
      mockPolicy: 'strict',
      requireRealForImplemented: true,
      allowExternalMock: false,
      requirePendingRemoval: false,
      maxMockDensity: 0,
    },
  },
  projectBoundary: ['src/**'],
  severity: 'warning',
};

const CONFIG_FILENAME = '.mockpolicyrc';

export async function loadMockPolicyConfig(
  projectRoot?: string
): Promise<MockPolicyConfig> {
  const root = projectRoot || process.cwd();
  // Try .mockpolicyrc first (JSON), fallback to .xp-gate/mock-policy.yaml for migration
  const jsonPath = join(root, CONFIG_FILENAME);
  const yamlPath = join(root, '.xp-gate', 'mock-policy.yaml');

  let rawConfig: unknown;

  if (existsSync(jsonPath)) {
    const content = await readFile(jsonPath, 'utf-8');
    rawConfig = JSON.parse(content);
  } else if (existsSync(yamlPath)) {
    const content = await readFile(yamlPath, 'utf-8');
    rawConfig = load(content);
  } else {
    return { ...DEFAULT_CONFIG };
  }

  // Validate with zod schema
  const result = MockPolicyConfigSchema.safeParse(rawConfig);
  if (!result.success) {
    throw new Error(
      `Invalid mock policy config: ${result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')}`
    );
  }

  return result.data;
}

export { DEFAULT_CONFIG };
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run src/mock-policy/__tests__/config.test.ts
```

Expected: PASS

**Step 3: Add dependencies**

```bash
npm install zod js-yaml @types/js-yaml
```

**Step 4: Commit**

```bash
git add src/mock-policy/config.ts src/mock-policy/__tests__/config.test.ts src/mock-policy/schema.ts
git commit -m "feat(mock-policy): add config loader with zod validation and defaults"
```

---

### Task 3: Project Scope Scanner

**Files:**
- Create: `src/mock-policy/scope-scanner.ts`
- Test: `src/mock-policy/__tests__/scope-scanner.test.ts`

**Step 1: Write the failing test**

```typescript
// src/mock-policy/__tests__/scope-scanner.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs/promises';
import { scanProjectScope } from '../scope-scanner';
import { ProjectScope } from '../types';

vi.mock('fs/promises');
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(() => '{}'),
}));

describe('scanProjectScope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should classify imports as internal, external, or pending', async () => {
    const { existsSync } = await import('fs');
    vi.mocked(existsSync).mockImplementation((p: string) => {
      // Return true for existing modules
      return !p.includes('unimplemented');
    });

    // Mock package.json for external deps
    vi.mocked(fs.readFile).mockImplementation(async (p: string) => {
      if (String(p).endsWith('package.json')) {
        return JSON.stringify({
          dependencies: {
            'stripe': '^14.0.0',
            'lodash': '^4.17.21',
          }
        });
      }
      throw new Error(`Unexpected read: ${p}`);
    });

    const imports = [
      '@/services/user-service',
      '@/repositories/unimplemented-repo',
      'stripe',
      'lodash',
    ];

    const scope = await scanProjectScope({
      projectRoot: '/fake-project',
      imports,
      boundary: ['src/**'],
    });

    // Internal + implemented
    expect(scope.implementedModules).toContain('@/services/user-service');
    // Internal but not implemented
    expect(scope.unimplementedModules).toContain('@/repositories/unimplemented-repo');
    // External packages
    expect(scope.externalPackages).toContain('stripe');
    expect(scope.externalPackages).toContain('lodash');
  });

  it('should respect custom boundary patterns', async () => {
    const { existsSync } = await import('fs');
    vi.mocked(existsSync).mockReturnValue(true);

    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ dependencies: {} }));

    const scope = await scanProjectScope({
      projectRoot: '/fake-project',
      imports: ['./local-util', 'path', 'os'],
      boundary: ['lib/**', 'app/**'],
    });

    // path and os are Node builtins, should be external
    expect(scope.externalPackages).toContain('path');
    expect(scope.externalPackages).toContain('os');
    // ./local-util doesn't match boundary patterns
    expect(scope.externalPackages).toContain('./local-util');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/mock-policy/__tests__/scope-scanner.test.ts
```

Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/mock-policy/scope-scanner.ts
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { minimatch } from 'minimatch'; // Note: we'll use a simple glob match
import { ProjectScope, DependencyScope } from './types';

const NODE_BUILTINS = new Set([
  'fs', 'path', 'os', 'http', 'https', 'crypto', 'stream',
  'events', 'util', 'url', 'querystring', 'assert', 'buffer',
  'child_process', 'cluster', 'dns', 'net', 'tls', 'readline',
  'process', 'v8', 'vm', 'zlib',
]);

interface ScanOptions {
  projectRoot: string;
  imports: string[];
  boundary: string[];
}

function simpleGlobMatch(pattern: string, path: string): boolean {
  const regexStr = pattern
    .replace(/\*\*/g, '___GLOBSTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___GLOBSTAR___/g, '.*');
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(path);
}

function isExternalImport(importPath: string, options: ScanOptions): boolean {
  // Node.js builtins
  if (NODE_BUILTINS.has(importPath)) return true;

  // Absolute npm packages (don't start with . or /)
  if (!importPath.startsWith('.') && !importPath.startsWith('/') && !importPath.startsWith('@')) {
    return true;
  }

  // Check if matches project boundary
  const relativePath = importPath.startsWith('@/')
    ? importPath.replace('@/', 'src/')
    : importPath;

  return !options.boundary.some(pattern => simpleGlobMatch(pattern, relativePath));
}

function resolveToRealPath(importPath: string, projectRoot: string): string {
  if (importPath.startsWith('@/')) {
    return join(projectRoot, 'src', importPath.replace('@/', ''));
  }
  if (importPath.startsWith('./') || importPath.startsWith('../')) {
    return resolve(projectRoot, importPath);
  }
  // For absolute npm packages, resolve in node_modules
  return join(projectRoot, 'node_modules', importPath);
}

async function loadExternalDependencies(projectRoot: string): Promise<Set<string>> {
  try {
    const pkgPath = join(projectRoot, 'package.json');
    const content = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    // Collect npm dependencies, excluding workspace:* internal packages
    const workspacePatterns: string[] = [];
    if (Array.isArray(pkg.workspaces)) {
      workspacePatterns.push(...pkg.workspaces);
    }

    const deps = new Set<string>();
    for (const [name, version] of Object.entries(pkg.dependencies || {})) {
      if (typeof version === 'string' && !version.startsWith('workspace:')) {
        deps.add(name);
      }
    }
    for (const name of Object.keys(pkg.devDependencies || {})) {
      // Don't auto-exclude devDeps — they're still external packages
      deps.add(name);
    }
    for (const name of Object.keys(pkg.peerDependencies || {})) {
      deps.add(name);
    }
    return deps;
  } catch {
    return new Set();
  }
}

export async function scanProjectScope(options: ScanOptions): Promise<ProjectScope> {
  const { projectRoot, imports, boundary } = options;
  const externalDeps = await loadExternalDependencies(projectRoot);

  const implementedModules: string[] = [];
  const unimplementedModules: string[] = [];
  const externalPackages: string[] = [];

  // Performance: cache already-checked paths (avoids duplicate fs.existsSync calls)
  const existCache = new Map<string, boolean>();

  for (const importPath of imports) {
    if (isExternalImport(importPath, options)) {
      externalPackages.push(importPath);
      continue;
    }

    // Check if implemented with caching
    const resolvedPath = resolveToRealPath(importPath, projectRoot);
    if (!existCache.has(resolvedPath)) {
      existCache.set(
        resolvedPath,
        existsSync(resolvedPath) || existsSync(resolvedPath + '.ts') || existsSync(resolvedPath + '.js')
      );
    }
    const isImplemented = existCache.get(resolvedPath)!;

    if (isImplemented) {
      implementedModules.push(importPath);
    } else {
      unimplementedModules.push(importPath);
    }
  }

  return {
    implementedModules: [...new Set(implementedModules)],
    unimplementedModules: [...new Set(unimplementedModules)],
    externalPackages: [...new Set(externalPackages)],
    projectBoundary: boundary,
  };
}

export function classifyDependency(
  importPath: string,
  scope: ProjectScope
): DependencyScope {
  if (scope.externalPackages.includes(importPath)) return 'external';
  if (scope.unimplementedModules.includes(importPath)) return 'pending';
  if (scope.implementedModules.includes(importPath)) return 'internal';

  // Default: check against boundary
  const relativePath = importPath.startsWith('@/')
    ? importPath.replace('@/', 'src/')
    : importPath;

  const isInBoundary = scope.projectBoundary.some(pattern =>
    simpleGlobMatch(pattern, relativePath)
  );
  return isInBoundary ? 'pending' : 'external';
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run src/mock-policy/__tests__/scope-scanner.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/mock-policy/scope-scanner.ts src/mock-policy/__tests__/scope-scanner.test.ts
git commit -m "feat(mock-policy): add project scope scanner with boundary detection"
```

---

### Task 4: Mock Decision Engine

**Files:**
- Create: `src/mock-policy/mock-decision-engine.ts`
- Test: `src/mock-policy/__tests__/mock-decision-engine.test.ts`

**Step 1: Write the failing test**

```typescript
// src/mock-policy/__tests__/mock-decision-engine.test.ts
import { describe, it, expect } from 'vitest';
import { MockDecisionEngine } from '../mock-decision-engine';
import { MockPolicyConfig } from '../types';
import { DEFAULT_CONFIG } from '../config';

const defaultConfig = DEFAULT_CONFIG;

function makeScope() {
  return {
    implementedModules: ['@/services/user-service', '@/infra/database'],
    unimplementedModules: ['@/services/pending-service'],
    externalPackages: ['stripe', 'openai'],
    projectBoundary: ['src/**'],
  };
}

describe('MockDecisionEngine', () => {
  it('should use real implementation for internal+implemented in integration tests', () => {
    const engine = new MockDecisionEngine(makeScope(), defaultConfig);
    const decision = engine.decide('@/services/user-service', 'integration');

    expect(decision.strategy).toBe('real');
    expect(decision.reason).toContain('internal');
  });

  it('should allow mock for external in integration tests', () => {
    const engine = new MockDecisionEngine(makeScope(), defaultConfig);
    const decision = engine.decide('stripe', 'integration');

    expect(decision.strategy).toBe('mock');
    expect(decision.reason).toContain('external');
  });

  it('should require pending removal annotation for unimplemented in integration', () => {
    const engine = new MockDecisionEngine(makeScope(), defaultConfig);
    const decision = engine.decide('@/services/pending-service', 'integration');

    expect(decision.strategy).toBe('mock');
    expect(decision.pendingRemoval).toBeDefined();
    expect(decision.pendingRemoval!.reason.length).toBeGreaterThanOrEqual(10);
  });

  it('should be lenient for unit tests regardless of scope', () => {
    const engine = new MockDecisionEngine(makeScope(), defaultConfig);
    const configWithLenientUnit = {
      ...defaultConfig,
      layers: {
        ...defaultConfig.layers,
        unit: { ...defaultConfig.layers.unit, mockPolicy: 'lenient' as const },
      },
    };
    const engine2 = new MockDecisionEngine(makeScope(), configWithLenientUnit);

    const internalDecision = engine2.decide('@/services/user-service', 'unit');
    const externalDecision = engine2.decide('stripe', 'unit');

    // Unit tests with lenient policy allow mocks everywhere
    expect(internalDecision.strategy).toBe('mock');
    expect(externalDecision.strategy).toBe('mock');
  });

  it('should reject external mocks in e2e tests', () => {
    const engine = new MockDecisionEngine(makeScope(), defaultConfig);
    const decision = engine.decide('stripe', 'e2e');

    expect(decision.strategy).toBe('real');
  });

  it('should return mock for unknown imports in integration tests', () => {
    const engine = new MockDecisionEngine(makeScope(), defaultConfig);
    const decision = engine.decide('unknown-module', 'integration');

    expect(decision.strategy).toBe('mock');
    expect(decision.reason).toContain('unknown');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/mock-policy/__tests__/mock-decision-engine.test.ts
```

Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/mock-policy/mock-decision-engine.ts
import { ProjectScope, MockDecision, MockStrategy, DependencyScope, MockPolicyConfig } from './types';
import { classifyDependency } from './scope-scanner';

type TestLayer = 'unit' | 'integration' | 'e2e';

export class MockDecisionEngine {
  private scope: ProjectScope;
  private config: MockPolicyConfig;

  constructor(scope: ProjectScope, config: MockPolicyConfig) {
    this.scope = scope;
    this.config = config;
  }

  decide(importPath: string, layer: TestLayer): MockDecision {
    const scope = classifyDependency(importPath, this.scope);
    const layerRules = this.config.layers[layer];

    // E2E: almost nothing should be mocked
    if (layer === 'e2e') {
      return this.decideE2e(importPath, scope);
    }

    // Unit: lenient - mock everything
    if (layer === 'unit' && layerRules.mockPolicy === 'lenient') {
      return {
        strategy: 'mock',
        reason: `Unit test: ${scope} dependency "${importPath}" - mock allowed per lenient policy`,
        layer: 'unit',
      };
    }

    // Unit with strict policy
    if (layer === 'unit' && layerRules.mockPolicy === 'strict') {
      return this.decideStrict(importPath, scope, layerRules, 'unit');
    }

    // Integration: strict rules
    return this.decideIntegration(importPath, scope, layerRules);
  }

  private decideE2e(importPath: string, scope: DependencyScope): MockDecision {
    const layerRules = this.config.layers.e2e;

    if (scope === 'external' && !layerRules.allowExternalMock) {
      return {
        strategy: 'real',
        reason: `E2E test: external dependency "${importPath}" must use real implementation`,
        layer: 'e2e',
      };
    }

    return {
      strategy: 'real',
      reason: `E2E test: dependency "${importPath}" should use real implementation`,
      layer: 'e2e',
    };
  }

  private decideIntegration(
    importPath: string,
    scope: DependencyScope,
    layerRules: { requireRealForImplemented: boolean; allowExternalMock: boolean; requirePendingRemoval: boolean }
  ): MockDecision {
    if (scope === 'external') {
      return {
        strategy: layerRules.allowExternalMock ? 'mock' : 'real',
        reason: layerRules.allowExternalMock
          ? `Integration test: external dependency "${importPath}" mock allowed`
          : `Integration test: external dependency "${importPath}" must use real implementation`,
        layer: 'integration',
      };
    }

    if (scope === 'internal') {
      return {
        strategy: layerRules.requireRealForImplemented ? 'real' : 'mock',
        reason: layerRules.requireRealForImplemented
          ? `Integration test: internal dependency "${importPath}" is implemented - must use real implementation`
          : `Integration test: internal dependency "${importPath}" mock allowed by config`,
        layer: 'integration',
      };
    }

    if (scope === 'pending') {
      const decision: MockDecision = {
        strategy: 'mock',
        reason: `Integration test: pending dependency "${importPath}" - mock allowed`,
        layer: 'integration',
      };

      if (layerRules.requirePendingRemoval) {
        decision.pendingRemoval = {
          ticket: 'TBD',
          reason: `Dependency "${importPath}" must be replaced with real implementation when available`,
        };
      }

      return decision;
    }

    // Unknown scope
    return {
      strategy: 'mock',
      reason: `Integration test: unknown dependency "${importPath}" - mock for safety`,
      layer: 'integration',
    };
  }

  private decideStrict(
    importPath: string,
    scope: DependencyScope,
    layerRules: { requireRealForImplemented: boolean; allowExternalMock: boolean; requirePendingRemoval: boolean },
    layer: TestLayer
  ): MockDecision {
    // Same logic as integration but for unit tests with strict policy
    return this.decideIntegration(importPath, scope, layerRules);
  }

  getConfig(): MockPolicyConfig {
    return this.config;
  }

  getScope(): ProjectScope {
    return this.scope;
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run src/mock-policy/__tests__/mock-decision-engine.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/mock-policy/mock-decision-engine.ts src/mock-policy/__tests__/mock-decision-engine.test.ts
git commit -m "feat(mock-policy): add mock decision engine with layering-aware rules"
```

---

### Task 5: Extend AI Test Detection with Layering Awareness

**Files:**
- Modify: `src/mutation/detect-ai-test.ts`
- Modify: `src/mutation/__tests__/detect-ai-test.test.ts`
- Modify: `src/mutation/types.ts`

**Step 1: Add test layer detection to types**

Add to `src/mutation/types.ts`:

```typescript
export type TestLayer = 'unit' | 'integration' | 'e2e' | 'unknown';

export interface MockDensityInfo {
  density: number;
  mockCount: number;
  totalTestLines: number;
  layer: TestLayer;
  pendingMocks: number;
}
```

**Step 2: Write extensible layer detection in detect-ai-test.ts**

Add a new function `detectTestLayer` that classifies tests by their location, annotations, and naming patterns:

```typescript
export function detectTestLayer(
  testFilePath: string
): TestLayer {
  // Priority: more specific patterns first
  // Check file naming conventions — e2e > integration > unit
  if (testFilePath.includes('.e2e.') || testFilePath.includes('/e2e/')) {
    return 'e2e';
  }
  if (testFilePath.includes('.integration.') || testFilePath.includes('/integration/')) {
    return 'integration';
  }
  if (testFilePath.includes('/__tests__/') || testFilePath.includes('.test.') || testFilePath.includes('.spec.')) {
    return 'unit';
  }
  return 'unknown';
}
```

**Step 3: Update detectAiTestCharacteristics to include layer info**

Modify the `AITestDetectionResult` interface and `detectAITestCharacteristics` function to compute and return layer-aware mock density.

**Step 4: Run existing tests + new tests**

```bash
npx vitest run src/mutation/__tests__/detect-ai-test.test.ts
```

Expected: All existing tests + new layer tests PASS

**Step 5: Commit**

```bash
git add src/mutation/detect-ai-test.ts src/mutation/types.ts src/mutation/__tests__/detect-ai-test.test.ts
git commit -m "feat(mutation): add test layer classification to AI test detection"
```

---

### Task 5.5: Gate M2/M3 Interaction Decision

**Design Decision**: Gate M3 (Mock Layering) **overrides** Gate M2 (Mock Density) for files it checks.

| Scenario | Gate M2 | Gate M3 | Result |
|----------|---------|---------|--------|
| M3 enabled, file is integration test | SKIP (M3 handles it) | Runs | M3 decision is authoritative |
| M3 enabled, file is unit test | Runs (but M3 also checks) | Runs | Both run; M3 warnings are additional |
| M3 not installed | Runs normally | SKIP | M2 only |

**Implementation**: In `githooks/pre-push`, Gate M3 runs before Gate M2. M2 skips any test file that was already validated by M3 (tracked via a temp file `.gate-m3-checked`).

This prevents confusing double-rejection where M2 says "too many mocks" but M3 says "mocks are appropriate for these external deps".

---

### Task 6: Gate M3 — Mock Layering Validation in Pre-push

**Files:**
- Create: `src/mock-policy/gate-m3.ts`
- Modify: `githooks/pre-push`

**Step 1: Create Gate M3 entry point**

```typescript
// src/mock-policy/gate-m3.ts
import { loadMockPolicyConfig } from './config';
import { scanProjectScope } from './scope-scanner';
import { MockDecisionEngine } from './mock-decision-engine';
import { MockPolicyResult, MockPolicyViolation } from './types';
import { detectTestLayer } from '../mutation/detect-ai-test';
import fs from 'fs/promises';

function filterTestFiles(files: string[]): string[] {
  return files.filter(f => f.endsWith('.test.ts') || f.endsWith('.spec.ts'));
}

function collectImports(testContent: string): string[] {
  // Match: import X from 'y', import { X } from 'y', import type { X } from 'y'
  // Also: const X = await import('y'), import('y')
  const importRegex = /import\s*(?:type\s*)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)?\s*(?:from\s*)?['"]([^'"]+)['"]/g;
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const imports: string[] = [];
  let match;
  while ((match = importRegex.exec(testContent)) !== null) {
    imports.push(match[1]);
  }
  while ((match = dynamicImportRegex.exec(testContent)) !== null) {
    imports.push(match[1]);
  }
  return [...new Set(imports)];
}

function detectMockUsage(testContent: string, importPath: string): MockStrategy {
  // Check if import is mocked via vi.mock() or jest.mock()
  const escaped = importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mockPatterns = [
    new RegExp(`(?:vi|jest)\\.(?:do)?mock\\(['"]${escaped}['"]`),
    new RegExp(`(?:vi|jest)\\.mock\\(['"]${escaped}['"]\\s*,`),
  ];
  return mockPatterns.some(p => p.test(testContent)) ? 'mock' : 'real';
}

async function validateFile(
  testFile: string,
  engine: MockDecisionEngine,
  projectRoot: string
): Promise<MockPolicyViolation[]> {
  const content = await fs.readFile(testFile, 'utf-8');
  const layer = detectTestLayer(testFile);
  const imports = collectImports(content);
  const violations: MockPolicyViolation[] = [];

  for (const importPath of imports) {
    const decision = engine.decide(importPath, layer);
    const actualStrategy = detectMockUsage(content, importPath);

    if (decision.strategy !== actualStrategy) {
      violations.push({
        file: testFile,
        line: 0, // Approximate - could be improved with AST
        dependency: importPath,
        actualStrategy,
        expectedStrategy: decision.strategy,
        reason: decision.reason,
        severity: 'warning',
      });
    }

    // Special check: pending mocks without removal annotation
    if (decision.pendingRemoval && actualStrategy === 'mock') {
      const hasRemovalAnnotation = content.includes(
        `@mock-justified: ${decision.pendingRemoval.reason}`
      );
      if (!hasRemovalAnnotation) {
        violations.push({
          file: testFile,
          line: 0,
          dependency: importPath,
          actualStrategy: 'mock',
          expectedStrategy: 'mock',
          reason: `Pending dependency "${importPath}" requires @mock-justified annotation with removal plan: ${decision.pendingRemoval.reason}`,
          severity: 'warning',
        });
      }
    }
  }

  return violations;
}

export async function runGateM3(
  changedFiles: string[],
  projectRoot: string = process.cwd()
): Promise<MockPolicyResult> {
  const testFiles = filterTestFiles(changedFiles);

  if (testFiles.length === 0) {
    return {
      exitCode: 0,
      status: 'skip',
      violations: [],
      scores: { totalTests: 0, integrationTests: 0, mockDensity: 0, pendingMocks: 0 },
    };
  }

  const config = await loadMockPolicyConfig(projectRoot);

  // Collect all imports from all test files
  const allImports: string[] = [];
  for (const testFile of testFiles) {
    try {
      const content = await fs.readFile(testFile, 'utf-8');
      allImports.push(...collectImports(content));
    } catch {
      // skip
    }
  }

  const scope = await scanProjectScope({
    projectRoot,
    imports: [...new Set(allImports)],
    boundary: config.projectBoundary,
  });

  const engine = new MockDecisionEngine(scope, config);
  const allViolations: MockPolicyViolation[] = [];

  let integrationCount = 0;
  for (const testFile of testFiles) {
    const layer = detectTestLayer(testFile);
    if (layer === 'integration') integrationCount++;

    const violations = await validateFile(testFile, engine, projectRoot);
    allViolations.push(...violations);
  }

  const blocked = allViolations.some(v => v.severity === 'error');

  return {
    exitCode: blocked ? 1 : 0,
    status: blocked ? 'block' : allViolations.length > 0 ? 'pass' : 'pass',
    violations: allViolations,
    scores: {
      totalTests: testFiles.length,
      integrationTests: integrationCount,
      mockDensity: 0, // Could be calculated
      pendingMocks: allViolations.filter(v => v.reason.includes('pending')).length,
    },
  };
}

export async function main(args: string[]): Promise<number> {
  if (args.length === 0) {
    console.error('Usage: npx tsx src/mock-policy/gate-m3.ts <file1> <file2> ...');
    return 1;
  }

  console.log('Gate M3: Mock Layering Validation');
  console.log(`  Changed files: ${args.length}`);

  const result = await runGateM3(args);

  if (result.violations.length > 0) {
    console.log('\nViolations:');
    for (const v of result.violations) {
      const icon = v.severity === 'error' ? '✗' : '⚠';
      console.log(`  ${icon} ${v.file}: ${v.reason}`);
    }
  }

  console.log(`\n${result.status === 'block' ? '✗' : '✓'} Gate M3 ${result.status.toUpperCase()}`);
  console.log(`  Integration tests: ${result.scores.integrationTests}`);
  console.log(`  Pending mocks: ${result.scores.pendingMocks}`);

  return result.exitCode;
}

// (Called via npx tsx <script> <args> — npx tsx handles ESM entry)
// For direct ESM invocation: node --import tsx src/path.ts arg1 arg2
const scriptIndex = process.argv.findIndex(a => a.endsWith('gate-m3.ts'));
const cliArgs = scriptIndex >= 0 ? process.argv.slice(scriptIndex + 1) : process.argv.slice(2);
main(cliArgs)
  .then(exitCode => { if (exitCode !== 0) process.exit(exitCode); })
  .catch(err => { console.error('Gate M3 failed:', err.message); process.exit(1); });
```

**Step 2: Add Gate M3 to pre-push hook**

In `githooks/pre-push`, after the Gate M2 section (~line 233), add:

```bash
# ============================================================================
# Gate M3: Mock Layering Strategy
# Validates mock policies based on test layer and dependency scope
# ============================================================================
run_gate_m3() {
  local changed_files="$1"
  local project_root="$2"

  log_gate "Gate M3" "Mock Layering Strategy" "START"

  if [[ ! -f "$project_root/src/mock-policy/gate-m3.ts" ]]; then
    log_gate "Gate M3" "Mock Layering Strategy" "SKIP (module not found)"
    return 0
  fi

  if [[ "$(detect_project_lang "$project_root")" != "typescript" ]]; then
    log_gate "Gate M3" "Mock Layering Strategy" "SKIP (TypeScript only)"
    return 0
  fi

  # Run Gate M3 on changed test files
  local test_files=$(echo "$changed_files" | grep -E '\.(test|spec)\.ts$' || true)

  if [[ -z "$test_files" ]]; then
    log_gate "Gate M3" "Mock Layering Strategy" "SKIP (no test files changed)"
    return 0
  fi

  echo "  Changed test files: $(echo "$test_files" | wc -l)"

  # Convert newline-separated to space-separated args safely
  local args=()
  while IFS= read -r f; do
    [[ -n "$f" ]] && args+=("$f")
  done <<< "$test_files"

  if npx tsx "$project_root/src/mock-policy/gate-m3.ts" "${args[@]}"; then
    log_gate "Gate M3" "Mock Layering Strategy" "PASS"
    return 0
  else
    log_gate "Gate M3" "Mock Layering Strategy" "BLOCK"
    return 1
  fi
}

# In the main flow, after Gate M2:
run_gate_m3 "$CHANGED_FILES" "$PROJECT_ROOT" || gate_failed=1
```

**Step 3: Commit**

```bash
git add src/mock-policy/gate-m3.ts githooks/pre-push
git commit -m "feat(mock-policy): add Gate M3 mock layering validation in pre-push"
```

---

### Task 7: Default Config File (JSON format, schema-validated)

**Files:**
- Create: `.mockpolicyrc`
- Create: `src/mock-policy/schema.ts` (zod schema)

**Step 1: Create zod schema for validation**

```typescript
// src/mock-policy/schema.ts
import { z } from 'zod';

export const MockPolicyLayerRulesSchema = z.object({
  mockPolicy: z.enum(['strict', 'lenient']),
  requireRealForImplemented: z.boolean(),
  allowExternalMock: z.boolean(),
  requirePendingRemoval: z.boolean(),
  maxMockDensity: z.number().min(0).max(100).optional(),
});

export const MockPolicyConfigSchema = z.object({
  version: z.literal(1),
  layers: z.object({
    unit: MockPolicyLayerRulesSchema,
    integration: MockPolicyLayerRulesSchema,
    e2e: MockPolicyLayerRulesSchema,
  }),
  projectBoundary: z.array(z.string()).min(1),
  severity: z.enum(['error', 'warning']),
});

export type MockPolicyConfig = z.infer<typeof MockPolicyConfigSchema>;
```

**Step 2: Create default config as JSON (same style as .principlesrc)**

```json
{
  "version": 1,
  "layers": {
    "unit": {
      "mockPolicy": "lenient",
      "requireRealForImplemented": false,
      "allowExternalMock": true,
      "requirePendingRemoval": false,
      "maxMockDensity": 100
    },
    "integration": {
      "mockPolicy": "strict",
      "requireRealForImplemented": true,
      "allowExternalMock": true,
      "requirePendingRemoval": true,
      "maxMockDensity": 30
    },
    "e2e": {
      "mockPolicy": "strict",
      "requireRealForImplemented": true,
      "allowExternalMock": false,
      "requirePendingRemoval": false,
      "maxMockDensity": 0
    }
  },
  "projectBoundary": ["src/**"],
  "severity": "warning"
}
```

**Step 2: Commit**

```bash
git add .mockpolicyrc src/mock-policy/schema.ts
git commit -m "chore(mock-policy): add default .mockpolicyrc configuration with zod schema"
```

---

### Task 8: Integration Test for Full Pipeline

**Files:**
- Create: `src/mock-policy/__tests__/integration.test.ts`

**Step 1: Write integration test**

This test exercises the full pipeline: scanner → decision engine → gate validation.

**Step 2: Run full test suite**

```bash
npx vitest run src/mock-policy/
```

Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/mock-policy/__tests__/integration.test.ts
git commit -m "test(mock-policy): add integration test for full pipeline"
```

---

### Task 9: Update AGENTS.md

**Files:**
- Create: `src/mock-policy/AGENTS.md`

**Step 1: Create module documentation**

Follow the pattern from `src/mutation/AGENTS.md` for consistency.

**Step 2: Commit**

```bash
git add src/mock-policy/AGENTS.md
git commit -m "docs(mock-policy): add AGENTS.md module documentation"
```

---

### Task 10: Lint + Coverage Check

**Files:**
- All modified files

**Step 1: Run lint**

```bash
npx eslint src/mock-policy/ --ext .ts
```

**Step 2: Run full test suite with coverage**

```bash
npx vitest run --coverage
```

Expected: Coverage ≥ 80%, all tests pass

**Step 3: Run principles checker**

```bash
npx tsx src/principles/index.ts --files "src/mock-policy/**/*.ts" --format console
```

Expected: Zero violations

**Step 4: Final commit if any fixes needed**

```bash
git add -A && git commit -m "chore(mock-policy): lint fixes and coverage adjustments"
```
