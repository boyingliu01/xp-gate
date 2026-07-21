/**
 * Layered Test Reporter
 *
 * Scans test files and produces a statistical report by test layer
 * (unit / integration / e2e / unknown). Reports file counts and
 * mock density per layer. This is an observability output — it does
 * NOT block any gate.
 */

import { readFile } from 'fs/promises';
import { isAbsolute, join } from 'path';
import { detectTestLayer, detectTestLayerFromContent } from '../mutation/detect-ai-test';
import type { TestLayer } from '../mock-policy/types';

export interface LayerStats {
  testFiles: number;
  mockDensity: number;
}

export interface LayeredTestReport {
  unit: LayerStats;
  integration: LayerStats;
  e2e: LayerStats;
  unknown: { testFiles: number };
  total: {
    testFiles: number;
    layerDistribution: Record<TestLayer, number>;
  };
}

function filterTestFiles(files: string[]): string[] {
  return files.filter(f => f.endsWith('.test.ts') || f.endsWith('.spec.ts'));
}

const MOCK_KEYWORDS = ['vi.mock', 'jest.mock', 'vi.doMock', 'jest.doMock', 'vi.spyOn', 'jest.spyOn'];

function countMockReferences(content: string): number {
  let count = 0;
  for (const keyword of MOCK_KEYWORDS) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    const matches = content.match(regex);
    if (matches) count += matches.length;
  }
  return count;
}

function countTestLines(content: string): number {
  return content.split('\n').filter(line => {
    const trimmed = line.trim();
    return (
      trimmed.startsWith('it(') || trimmed.startsWith('test(') ||
      trimmed.startsWith('describe(') || trimmed.startsWith('it.each(') ||
      trimmed.startsWith('test.each(') || trimmed.startsWith('describe.each(')
    );
  }).length;
}

function computeMockDensity(content: string): number {
  const mockCount = countMockReferences(content);
  const testLines = countTestLines(content);
  if (testLines === 0) return 0;
  return Math.round((mockCount / testLines) * 10000) / 100;
}

/**
 * Generate a layered test report from a list of files.
 *
 * @param files - File paths to scan
 * @param projectRoot - Project root directory
 * @returns LayeredTestReport with per-layer statistics
 */
export async function generateLayeredTestReport(
  files: string[],
  projectRoot: string = process.cwd(),
): Promise<LayeredTestReport> {
  const testFiles = filterTestFiles(files);

  const layers: Record<TestLayer, { testFiles: number; totalMockDensity: number }> = {
    unit: { testFiles: 0, totalMockDensity: 0 },
    integration: { testFiles: 0, totalMockDensity: 0 },
    e2e: { testFiles: 0, totalMockDensity: 0 },
    unknown: { testFiles: 0, totalMockDensity: 0 },
  };

  for (const testFile of testFiles) {
    const fullPath = isAbsolute(testFile) ? testFile : join(projectRoot, testFile);
    let layer: TestLayer;
    let content = '';

    try {
      content = await readFile(fullPath, 'utf-8');
      const annotationLayer = detectTestLayerFromContent(content);
      layer = annotationLayer ?? detectTestLayer(testFile);
    } catch {
      layer = detectTestLayer(testFile);
    }

    layers[layer].testFiles++;
    layers[layer].totalMockDensity += computeMockDensity(content);
  }

  const totalFiles = testFiles.length;

  return {
    unit: {
      testFiles: layers.unit.testFiles,
      mockDensity: layers.unit.testFiles > 0
        ? Math.round(layers.unit.totalMockDensity / layers.unit.testFiles * 100) / 100
        : 0,
    },
    integration: {
      testFiles: layers.integration.testFiles,
      mockDensity: layers.integration.testFiles > 0
        ? Math.round(layers.integration.totalMockDensity / layers.integration.testFiles * 100) / 100
        : 0,
    },
    e2e: {
      testFiles: layers.e2e.testFiles,
      mockDensity: layers.e2e.testFiles > 0
        ? Math.round(layers.e2e.totalMockDensity / layers.e2e.testFiles * 100) / 100
        : 0,
    },
    unknown: {
      testFiles: layers.unknown.testFiles,
    },
    total: {
      testFiles: totalFiles,
      layerDistribution: {
        unit: totalFiles > 0 ? Math.round(layers.unit.testFiles / totalFiles * 10000) / 100 : 0,
        integration: totalFiles > 0 ? Math.round(layers.integration.testFiles / totalFiles * 10000) / 100 : 0,
        e2e: totalFiles > 0 ? Math.round(layers.e2e.testFiles / totalFiles * 10000) / 100 : 0,
        unknown: totalFiles > 0 ? Math.round(layers.unknown.testFiles / totalFiles * 10000) / 100 : 0,
      },
    },
  };
}
