import { describe, it, expect } from 'vitest';
import MockDecisionEngine from '../mock-decision-engine';
import type { ProjectScope, MockPolicyConfig, TestLayer } from '../types';

/**
 * @test MockDecisionEngine decision logic
 * @intent Verify all decision paths for unit, integration, and e2e layers
 * @covers MockDecisionEngine.decide
 */

const baseScope: ProjectScope = {
  implementedModules: ['src/utils/helper', 'src/core/service'],
  unimplementedModules: ['src/feature/pending-module'],
  externalPackages: ['lodash', 'express', 'axios'],
  projectBoundary: ['src/**'],
};

const defaultConfig: MockPolicyConfig = {
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

describe('MockDecisionEngine', () => {
  describe('e2e layer — always return real', () => {
    it('returns real for any import in e2e', () => {
      const engine = new MockDecisionEngine(baseScope, defaultConfig);
      const decision = engine.decide('lodash', 'e2e');
      expect(decision.strategy).toBe('real');
      expect(decision.layer).toBe('e2e');
      expect(decision.reason).toContain('E2E tests must use real dependencies');
    });

    it('returns real for internal imports in e2e', () => {
      const engine = new MockDecisionEngine(baseScope, defaultConfig);
      const decision = engine.decide('src/core/service', 'e2e');
      expect(decision.strategy).toBe('real');
      expect(decision.reason).toContain('E2E');
    });

    it('returns real for pending imports in e2e', () => {
      const engine = new MockDecisionEngine(baseScope, defaultConfig);
      const decision = engine.decide('src/feature/pending-module', 'e2e');
      expect(decision.strategy).toBe('real');
      expect(decision.reason).toContain('E2E');
    });
  });

  describe('unit layer with lenient policy — always mock', () => {
    it('returns mock for external dependencies', () => {
      const engine = new MockDecisionEngine(baseScope, defaultConfig);
      const decision = engine.decide('lodash', 'unit');
      expect(decision.strategy).toBe('mock');
      expect(decision.layer).toBe('unit');
      expect(decision.reason).toContain('lenient policy');
    });

    it('returns mock for internal dependencies', () => {
      const engine = new MockDecisionEngine(baseScope, defaultConfig);
      const decision = engine.decide('src/utils/helper', 'unit');
      expect(decision.strategy).toBe('mock');
      expect(decision.reason).toContain('lenient policy');
    });

    it('returns mock for pending dependencies', () => {
      const engine = new MockDecisionEngine(baseScope, defaultConfig);
      const decision = engine.decide('src/feature/pending-module', 'unit');
      expect(decision.strategy).toBe('mock');
      expect(decision.reason).toContain('lenient policy');
    });
  });

  describe('unit layer with strict policy — applies integration rules', () => {
    const strictUnitConfig: MockPolicyConfig = {
      ...defaultConfig,
      layers: {
        ...defaultConfig.layers,
        unit: {
          mockPolicy: 'strict',
          requireRealForImplemented: true,
          allowExternalMock: true,
          requirePendingRemoval: true,
          maxMockDensity: 50,
        },
      },
    };

    it('returns real for internal+implemented when requireRealForImplemented is true', () => {
      const engine = new MockDecisionEngine(baseScope, strictUnitConfig);
      const decision = engine.decide('src/utils/helper', 'unit');
      expect(decision.strategy).toBe('real');
      expect(decision.reason).toContain('real implementation');
    });

    it('returns mock for internal unimplemented when not matched as implemented', () => {
      const engine = new MockDecisionEngine(baseScope, strictUnitConfig);
      const decision = engine.decide('src/utils/unknown-module', 'unit');
      // Falls through to default: unknown scope → mock for safety
      expect(decision.strategy).toBe('mock');
    });
  });

  describe('integration layer', () => {
    it('returns real for internal+implemented when requireRealForImplemented is true', () => {
      const engine = new MockDecisionEngine(baseScope, defaultConfig);
      const decision = engine.decide('src/utils/helper', 'integration');
      expect(decision.strategy).toBe('real');
      expect(decision.layer).toBe('integration');
      expect(decision.reason).toContain('real implementation');
    });

    it('returns real for internal+implemented (src/core/service)', () => {
      const engine = new MockDecisionEngine(baseScope, defaultConfig);
      const decision = engine.decide('src/core/service', 'integration');
      expect(decision.strategy).toBe('real');
      expect(decision.reason).toContain('real implementation');
    });

    it('returns mock for external dependencies when allowExternalMock is true', () => {
      const engine = new MockDecisionEngine(baseScope, defaultConfig);
      const decision = engine.decide('lodash', 'integration');
      expect(decision.strategy).toBe('mock');
      expect(decision.reason).toContain('External dependency');
    });

    it('returns mock for axios (external)', () => {
      const engine = new MockDecisionEngine(baseScope, defaultConfig);
      const decision = engine.decide('axios', 'integration');
      expect(decision.strategy).toBe('mock');
      expect(decision.reason).toContain('External dependency');
    });

    it('returns mock for express (external)', () => {
      const engine = new MockDecisionEngine(baseScope, defaultConfig);
      const decision = engine.decide('express', 'integration');
      expect(decision.strategy).toBe('mock');
    });

    it('returns mock with pendingRemoval for pending dependencies when requirePendingRemoval is true', () => {
      const engine = new MockDecisionEngine(baseScope, defaultConfig);
      const decision = engine.decide('src/feature/pending-module', 'integration');
      expect(decision.strategy).toBe('mock');
      expect(decision.pendingRemoval).toBeDefined();
      expect(decision.pendingRemoval!.ticket).toBe('src/feature/pending-module');
      expect(decision.pendingRemoval!.reason).toContain('not yet implemented');
    });

    it('returns real for external when allowExternalMock is disabled', () => {
      const noExternalMockConfig: MockPolicyConfig = {
        ...defaultConfig,
        layers: {
          ...defaultConfig.layers,
          integration: {
            ...defaultConfig.layers.integration,
            allowExternalMock: false,
          },
        },
      };
      const engine = new MockDecisionEngine(baseScope, noExternalMockConfig);
      const decision = engine.decide('lodash', 'integration');
      expect(decision.strategy).toBe('real');
      expect(decision.reason).toContain('allowExternalMock is disabled');
    });

    it('returns mock for unknown dependencies (falls to external)', () => {
      const engine = new MockDecisionEngine(baseScope, defaultConfig);
      const decision = engine.decide('some-unknown-package', 'integration');
      expect(decision.strategy).toBe('mock');
      expect(decision.reason).toContain('External dependency');
    });
  });

  describe('unknown layer — falls back to unit behavior', () => {
    it('treats unknown layer like unit — applies lenient mock for all deps', () => {
      const engine = new MockDecisionEngine(baseScope, defaultConfig);
      const decision = engine.decide('lodash', 'unknown' as TestLayer);
      expect(decision.strategy).toBe('mock');
      // Falls back to unit layer rules (lenient → all mocked per policy)
      expect(decision.reason).toContain('should be mocked');
    });
  });

  describe('edge cases', () => {
    it('handles empty implementedModules gracefully', () => {
      const emptyImplementedScope: ProjectScope = {
        ...baseScope,
        implementedModules: [],
      };
      const engine = new MockDecisionEngine(emptyImplementedScope, defaultConfig);
      const decision = engine.decide('src/utils/helper', 'integration');
      // Not matched as implemented, external, or pending → falls to unknown → mock
      expect(decision.strategy).toBe('mock');
    });

    it('handles empty externalPackages gracefully', () => {
      const noExternalScope: ProjectScope = {
        ...baseScope,
        externalPackages: [],
      };
      const engine = new MockDecisionEngine(noExternalScope, defaultConfig);
      const decision = engine.decide('lodash', 'integration');
      // lodash is a bare import, classifyDependency routes to external via
      // isExternalImport (not matched in externalPackages list), allowExternalMock=true → mock
      expect(decision.strategy).toBe('mock');
      expect(decision.reason).toContain('External dependency');
    });
  });
});
