/**
 * @test REQ-327 mock-policy test coverage
 * @intent Verify config schema validation for valid and invalid configurations
 * @covers AC-327-02
 */

import { describe, it, expect } from 'vitest';
import { MockPolicyConfigSchema, MockPolicyLayerRulesSchema } from '../schema';

// ---------------------------------------------------------------------------
// MockPolicyLayerRulesSchema
// ---------------------------------------------------------------------------
describe('MockPolicyLayerRulesSchema', () => {
  const validLayerRules = {
    mockPolicy: 'strict' as const,
    requireRealForImplemented: true,
    allowExternalMock: false,
    requirePendingRemoval: true,
  };

  it('accepts valid layer rules without optional maxMockDensity', () => {
    const result = MockPolicyLayerRulesSchema.safeParse(validLayerRules);
    expect(result.success).toBe(true);
  });

  it('accepts valid layer rules with optional maxMockDensity', () => {
    const result = MockPolicyLayerRulesSchema.safeParse({
      ...validLayerRules,
      maxMockDensity: 50,
    });
    expect(result.success).toBe(true);
  });

  it('accepts maxMockDensity of 0', () => {
    const result = MockPolicyLayerRulesSchema.safeParse({
      ...validLayerRules,
      maxMockDensity: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts maxMockDensity of 100', () => {
    const result = MockPolicyLayerRulesSchema.safeParse({
      ...validLayerRules,
      maxMockDensity: 100,
    });
    expect(result.success).toBe(true);
  });

  it('rejects maxMockDensity below 0', () => {
    const result = MockPolicyLayerRulesSchema.safeParse({
      ...validLayerRules,
      maxMockDensity: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects maxMockDensity above 100', () => {
    const result = MockPolicyLayerRulesSchema.safeParse({
      ...validLayerRules,
      maxMockDensity: 101,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid mockPolicy value', () => {
    const result = MockPolicyLayerRulesSchema.safeParse({
      ...validLayerRules,
      mockPolicy: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required field mockPolicy', () => {
    const rest = { ...validLayerRules };
    delete (rest as Record<string, unknown>).mockPolicy;
    const result = MockPolicyLayerRulesSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing required field requireRealForImplemented', () => {
    const rest = { ...validLayerRules };
    delete (rest as Record<string, unknown>).requireRealForImplemented;
    const result = MockPolicyLayerRulesSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects wrong type for boolean field', () => {
    const result = MockPolicyLayerRulesSchema.safeParse({
      ...validLayerRules,
      allowExternalMock: 'yes',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MockPolicyConfigSchema
// ---------------------------------------------------------------------------
describe('MockPolicyConfigSchema', () => {
  const validConfig = {
    version: 1 as const,
    layers: {
      unit: {
        mockPolicy: 'lenient' as const,
        requireRealForImplemented: false,
        allowExternalMock: true,
        requirePendingRemoval: false,
        maxMockDensity: 100,
      },
      integration: {
        mockPolicy: 'strict' as const,
        requireRealForImplemented: true,
        allowExternalMock: true,
        requirePendingRemoval: true,
        maxMockDensity: 30,
      },
      e2e: {
        mockPolicy: 'strict' as const,
        requireRealForImplemented: true,
        allowExternalMock: false,
        requirePendingRemoval: false,
        maxMockDensity: 0,
      },
    },
    projectBoundary: ['src/**'],
    severity: 'warning' as const,
  };

  it('accepts a valid full config', () => {
    const result = MockPolicyConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('accepts config with severity=error', () => {
    const result = MockPolicyConfigSchema.safeParse({
      ...validConfig,
      severity: 'error',
    });
    expect(result.success).toBe(true);
  });

  it('accepts config with multiple projectBoundary entries', () => {
    const result = MockPolicyConfigSchema.safeParse({
      ...validConfig,
      projectBoundary: ['src/**', 'lib/**'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects version other than 1', () => {
    const result = MockPolicyConfigSchema.safeParse({
      ...validConfig,
      version: 2,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing version', () => {
    const rest = { ...validConfig };
    delete (rest as Record<string, unknown>).version;
    const result = MockPolicyConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects empty projectBoundary array', () => {
    const result = MockPolicyConfigSchema.safeParse({
      ...validConfig,
      projectBoundary: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid severity value', () => {
    const result = MockPolicyConfigSchema.safeParse({
      ...validConfig,
      severity: 'critical',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing layers object', () => {
    const rest = { ...validConfig };
    delete (rest as Record<string, unknown>).layers;
    const result = MockPolicyConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing unit layer', () => {
    const restLayers = { ...validConfig.layers };
    delete (restLayers as Record<string, unknown>).unit;
    const result = MockPolicyConfigSchema.safeParse({
      ...validConfig,
      layers: restLayers,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing integration layer', () => {
    const restLayers = { ...validConfig.layers };
    delete (restLayers as Record<string, unknown>).integration;
    const result = MockPolicyConfigSchema.safeParse({
      ...validConfig,
      layers: restLayers,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing e2e layer', () => {
    const restLayers = { ...validConfig.layers };
    delete (restLayers as Record<string, unknown>).e2e;
    const result = MockPolicyConfigSchema.safeParse({
      ...validConfig,
      layers: restLayers,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-string projectBoundary entries', () => {
    const result = MockPolicyConfigSchema.safeParse({
      ...validConfig,
      projectBoundary: [123],
    });
    expect(result.success).toBe(false);
  });

  it('produces correct inferred type for valid config', () => {
    const result = MockPolicyConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
      expect(result.data.severity).toBe('warning');
      expect(result.data.projectBoundary).toEqual(['src/**']);
      expect(result.data.layers.unit.mockPolicy).toBe('lenient');
      expect(result.data.layers.integration.mockPolicy).toBe('strict');
      expect(result.data.layers.e2e.allowExternalMock).toBe(false);
    }
  });
});
