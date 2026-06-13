/**
 * @test config.ts - Mock Policy config loader
 * @intent Verify config loads and validates correctly from .mockpolicyrc and .xp-gate/mock-policy.yaml
 * @covers mock-policy-config-loader
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mock state — each test sets these before re-importing the module
let mockExistsSync: (path: string) => boolean;
let mockReadFile: (path: string) => Promise<string>;

vi.mock('fs', () => ({
  existsSync: vi.fn((path: string) => mockExistsSync(path)),
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn((path: string) => mockReadFile(path)),
}));

const MOCK_DEFAULT_CONFIG = {
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

describe('loadMockPolicyConfig', () => {
  let loadMockPolicyConfig: typeof import('../config').loadMockPolicyConfig;
  let DEFAULT_CONFIG: typeof import('../config').DEFAULT_CONFIG;

  beforeEach(async () => {
    // Default: no config files exist
    mockExistsSync = () => false;
    mockReadFile = () => Promise.reject(new Error('ENOENT'));

    // Re-import after mock state is set
    vi.resetModules();
    const mod = await import('../config');
    loadMockPolicyConfig = mod.loadMockPolicyConfig;
    DEFAULT_CONFIG = mod.DEFAULT_CONFIG;
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_CONFIG).toEqual(MOCK_DEFAULT_CONFIG);
    });

    it('should have lenient unit policy', () => {
      expect(DEFAULT_CONFIG.layers.unit.mockPolicy).toBe('lenient');
      expect(DEFAULT_CONFIG.layers.unit.allowExternalMock).toBe(true);
    });

    it('should have strict integration policy', () => {
      expect(DEFAULT_CONFIG.layers.integration.mockPolicy).toBe('strict');
      expect(DEFAULT_CONFIG.layers.integration.requirePendingRemoval).toBe(true);
      expect(DEFAULT_CONFIG.layers.integration.maxMockDensity).toBe(30);
    });

    it('should have strict e2e policy forbidding external mocks', () => {
      expect(DEFAULT_CONFIG.layers.e2e.allowExternalMock).toBe(false);
      expect(DEFAULT_CONFIG.layers.e2e.maxMockDensity).toBe(0);
    });

    it('should have projectBoundary and warning severity', () => {
      expect(DEFAULT_CONFIG.projectBoundary).toEqual(['src/**']);
      expect(DEFAULT_CONFIG.severity).toBe('warning');
    });
  });

  describe('no config files exist', () => {
    it('should return default config when no files found', async () => {
      const config = await loadMockPolicyConfig('/fake/project');
      expect(config).toEqual(DEFAULT_CONFIG);
    });
  });

  describe('JSON config (.mockpolicyrc)', () => {
    it('should merge partial JSON config with defaults', async () => {
      mockExistsSync = (path: string) => path.endsWith('.mockpolicyrc');
      mockReadFile = (path: string) => {
        if (path.endsWith('.mockpolicyrc')) {
          return Promise.resolve(JSON.stringify({
            severity: 'error',
            layers: {
              unit: { mockPolicy: 'strict', maxMockDensity: 50 },
            },
          }));
        }
        return Promise.reject(new Error('file not found'));
      };

      vi.resetModules();
      const mod = await import('../config');
      loadMockPolicyConfig = mod.loadMockPolicyConfig;

      const config = await loadMockPolicyConfig('/fake/project');

      expect(config.severity).toBe('error');
      expect(config.layers.unit.mockPolicy).toBe('strict');
      expect(config.layers.unit.maxMockDensity).toBe(50);
      // Defaults preserved for non-overridden fields
      expect(config.layers.unit.requireRealForImplemented).toBe(false);
      expect(config.layers.unit.allowExternalMock).toBe(true);
      expect(config.layers.integration).toEqual(MOCK_DEFAULT_CONFIG.layers.integration);
      expect(config.layers.e2e).toEqual(MOCK_DEFAULT_CONFIG.layers.e2e);
      expect(config.projectBoundary).toEqual(MOCK_DEFAULT_CONFIG.projectBoundary);
    });

    it('should load full JSON config correctly', async () => {
      const fullConfig = {
        version: 1,
        layers: {
          unit: {
            mockPolicy: 'strict' as const,
            requireRealForImplemented: true,
            allowExternalMock: false,
            requirePendingRemoval: true,
            maxMockDensity: 80,
          },
          integration: {
            mockPolicy: 'strict' as const,
            requireRealForImplemented: true,
            allowExternalMock: false,
            requirePendingRemoval: true,
            maxMockDensity: 20,
          },
          e2e: {
            mockPolicy: 'strict' as const,
            requireRealForImplemented: true,
            allowExternalMock: false,
            requirePendingRemoval: true,
            maxMockDensity: 5,
          },
        },
        projectBoundary: ['src/**', '!src/external/**'],
        severity: 'error' as const,
      };

      mockExistsSync = (path: string) => path.endsWith('.mockpolicyrc');
      mockReadFile = (path: string) => {
        if (path.endsWith('.mockpolicyrc')) {
          return Promise.resolve(JSON.stringify(fullConfig));
        }
        return Promise.reject(new Error('file not found'));
      };

      vi.resetModules();
      const mod = await import('../config');
      loadMockPolicyConfig = mod.loadMockPolicyConfig;

      const config = await loadMockPolicyConfig('/fake/project');

      expect(config.layers.unit.maxMockDensity).toBe(80);
      expect(config.layers.integration.mockPolicy).toBe('strict');
      expect(config.layers.e2e.maxMockDensity).toBe(5);
      expect(config.projectBoundary).toEqual(['src/**', '!src/external/**']);
      expect(config.severity).toBe('error');
    });
  });

  describe('YAML config (.xp-gate/mock-policy.yaml)', () => {
    it('should load YAML config as fallback', async () => {
      mockExistsSync = (path: string) => path.endsWith('mock-policy.yaml');
      mockReadFile = (path: string) => {
        if (path.endsWith('mock-policy.yaml')) {
          return Promise.resolve(`
version: 1
severity: error
layers:
  unit:
    mockPolicy: strict
    maxMockDensity: 60
projectBoundary:
  - src/**
          `);
        }
        return Promise.reject(new Error('file not found'));
      };

      vi.resetModules();
      const mod = await import('../config');
      loadMockPolicyConfig = mod.loadMockPolicyConfig;

      const config = await loadMockPolicyConfig('/fake/project');

      expect(config.severity).toBe('error');
      expect(config.layers.unit.mockPolicy).toBe('strict');
      expect(config.layers.unit.maxMockDensity).toBe(60);
      expect(config.projectBoundary).toEqual(['src/**']);
    });

    it('should prefer JSON over YAML when both exist', async () => {
      mockExistsSync = (path: string) =>
        path.endsWith('.mockpolicyrc') || path.endsWith('mock-policy.yaml');
      mockReadFile = (path: string) => {
        if (path.endsWith('.mockpolicyrc')) {
          return Promise.resolve(JSON.stringify({ severity: 'error' }));
        }
        if (path.endsWith('mock-policy.yaml')) {
          return Promise.resolve('severity: warning');
        }
        return Promise.reject(new Error('file not found'));
      };

      vi.resetModules();
      const mod = await import('../config');
      loadMockPolicyConfig = mod.loadMockPolicyConfig;

      const config = await loadMockPolicyConfig('/fake/project');

      // JSON has higher priority
      expect(config.severity).toBe('error');
    });
  });

  describe('validation', () => {
    it('should throw on invalid version', async () => {
      mockExistsSync = (path: string) => path.endsWith('.mockpolicyrc');
      mockReadFile = () =>
        Promise.resolve(JSON.stringify({ version: 999 }));

      vi.resetModules();
      const mod = await import('../config');
      loadMockPolicyConfig = mod.loadMockPolicyConfig;

      await expect(loadMockPolicyConfig('/fake/project')).rejects.toThrow();
    });

    it('should throw on invalid mockPolicy value', async () => {
      mockExistsSync = (path: string) => path.endsWith('.mockpolicyrc');
      mockReadFile = () =>
        Promise.resolve(
          JSON.stringify({
            layers: { unit: { mockPolicy: 'invalid' } },
          }),
        );

      vi.resetModules();
      const mod = await import('../config');
      loadMockPolicyConfig = mod.loadMockPolicyConfig;

      await expect(loadMockPolicyConfig('/fake/project')).rejects.toThrow();
    });

    it('should throw on empty projectBoundary', async () => {
      mockExistsSync = (path: string) => path.endsWith('.mockpolicyrc');
      mockReadFile = () =>
        Promise.resolve(JSON.stringify({ projectBoundary: [] }));

      vi.resetModules();
      const mod = await import('../config');
      loadMockPolicyConfig = mod.loadMockPolicyConfig;

      await expect(loadMockPolicyConfig('/fake/project')).rejects.toThrow();
    });

    it('should throw on invalid severity', async () => {
      mockExistsSync = (path: string) => path.endsWith('.mockpolicyrc');
      mockReadFile = () =>
        Promise.resolve(JSON.stringify({ severity: 'critical' }));

      vi.resetModules();
      const mod = await import('../config');
      loadMockPolicyConfig = mod.loadMockPolicyConfig;

      await expect(loadMockPolicyConfig('/fake/project')).rejects.toThrow();
    });
  });
});
