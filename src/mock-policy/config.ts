import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { MockPolicyConfigSchema } from './schema';
import type { z } from 'zod';

type MockPolicyConfig = z.infer<typeof MockPolicyConfigSchema>;

export const DEFAULT_CONFIG: MockPolicyConfig = {
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

function findConfigPaths(root: string): { jsonPath: string; yamlPath: string } {
  return {
    jsonPath: join(root, '.mockpolicyrc'),
    yamlPath: join(root, '.xp-gate', 'mock-policy.yaml'),
  };
}

async function readJsonConfig(path: string): Promise<Record<string, unknown>> {
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content) as Record<string, unknown>;
}

async function readYamlConfig(path: string): Promise<Record<string, unknown>> {
  const content = await readFile(path, 'utf-8');
  return load(content) as Record<string, unknown>;
}

function deepMerge(
  defaults: MockPolicyConfig,
  overrides: Partial<MockPolicyConfig>,
): MockPolicyConfig {
  return {
    ...defaults,
    ...overrides,
    layers: {
      unit: { ...defaults.layers.unit, ...overrides.layers?.unit },
      integration: { ...defaults.layers.integration, ...overrides.layers?.integration },
      e2e: { ...defaults.layers.e2e, ...overrides.layers?.e2e },
    },
    projectBoundary: overrides.projectBoundary ?? defaults.projectBoundary,
    severity: overrides.severity ?? defaults.severity,
  };
}

/**
 * Load mock policy configuration from the project root.
 *
 * Resolution order:
 * 1. `.mockpolicyrc` (JSON) — highest priority
 * 2. `.xp-gate/mock-policy.yaml` (YAML) — fallback
 * 3. Falls back to `DEFAULT_CONFIG`
 *
 * @param root - Project root directory (defaults to `process.cwd()`)
 * @returns Validated MockPolicyConfig
 * @throws {Error} If the config file exists but the content fails validation
 */
export async function loadMockPolicyConfig(
  root?: string,
): Promise<MockPolicyConfig> {
  const projectRoot = root ?? process.cwd();
  const { jsonPath, yamlPath } = findConfigPaths(projectRoot);

  if (existsSync(jsonPath)) {
    const raw = await readJsonConfig(jsonPath);
    // Validate the raw user config before merging so that invalid values
    // are caught regardless of defaults.
    MockPolicyConfigSchema.parse(deepMerge(DEFAULT_CONFIG, raw));
    return deepMerge(DEFAULT_CONFIG, raw);
  }

  if (existsSync(yamlPath)) {
    const raw = await readYamlConfig(yamlPath);
    MockPolicyConfigSchema.parse(deepMerge(DEFAULT_CONFIG, raw));
    return deepMerge(DEFAULT_CONFIG, raw);
  }

  return DEFAULT_CONFIG;
}
