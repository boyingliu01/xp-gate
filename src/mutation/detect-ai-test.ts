import fs from 'fs/promises';
import { AITestDetectionResult, TestLayer } from './types';

const MOCK_KEYWORDS = [
  'mock',
  'jest.mock',
  'vi.mock',
  'spyOn',
  'jest.spyOn',
  'vi.spyOn',
  'fn()',
  'jest.fn',
  'vi.fn',
  'mockResolvedValue',
  'mockRejectedValue',
  'mockReturnValue',
  'mockImplementation',
  'createMock',
  'mockReset',
  'mockClear',
  'mockRestore',
];

const AI_GENERATED_DENSITY_THRESHOLD = 30;

function countMockReferences(content: string): number {
  let count = 0;
  for (const keyword of MOCK_KEYWORDS) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'g');
    const matches = content.match(regex);
    if (matches) {
      count += matches.length;
    }
  }
  return count;
}

function countTestLines(content: string): number {
  const lines = content.split('\n');
  return lines.filter(line => {
    const trimmed = line.trim();
    return (
      trimmed.startsWith('it(') ||
      trimmed.startsWith('test(') ||
      trimmed.startsWith('describe(') ||
      trimmed.startsWith('it.each(') ||
      trimmed.startsWith('test.each(') ||
      trimmed.startsWith('describe.each(')
    );
  }).length;
}

const LAYER_PATTERNS: Array<[TestLayer, string[]]> = [
  ['e2e', ['.e2e.', '/e2e/', 'e2e/']],
  ['integration', ['.integration.', '/integration/', 'integration/']],
  ['unit', ['/__tests__/', '.test.', '.spec.']],
];

function matchesPattern(normalized: string, pattern: string): boolean {
  if (!pattern.startsWith('/') && pattern.endsWith('/')) {
    return normalized.startsWith(pattern);
  }
  return normalized.includes(pattern);
}

export function detectTestLayer(testFilePath: string): TestLayer {
  const normalized = testFilePath.replace(/\\/g, '/');
  for (const [layer, patterns] of LAYER_PATTERNS) {
    if (patterns.some(p => matchesPattern(normalized, p))) return layer;
  }
  return 'unknown';
}

const TEST_TYPE_ANNOTATION = /@test-type\s+(unit|integration|e2e)/i;

/**
 * Detect test layer from file content by parsing @test-type annotation.
 * Supports both JSDoc block comments and line comments.
 * Returns null if no valid @test-type annotation is found.
 */
export function detectTestLayerFromContent(content: string): TestLayer | null {
  const match = content.match(TEST_TYPE_ANNOTATION);
  if (!match) return null;
  return match[1].toLowerCase() as TestLayer;
}

/**
 * Detect test layer with annotation-first priority.
 * 1. Read file content and check @test-type annotation
 * 2. Fall back to path-based detection
 * 3. Return 'unknown' if neither matches
 */
export async function detectTestLayerWithAnnotation(testFilePath: string): Promise<TestLayer> {
  try {
    const content = await fs.readFile(testFilePath, 'utf-8');
    const annotationLayer = detectTestLayerFromContent(content);
    if (annotationLayer) return annotationLayer;
  } catch {
    // File not readable — fall through to path-based detection
  }
  return detectTestLayer(testFilePath);
}

function detectLayerAwareDensity(
  content: string,
  testFilePath: string
): { mockDensity: number; mockCount: number; testLines: number; layer: TestLayer; pendingMocks: number } {
  const mockCount = countMockReferences(content);
  const testLines = countTestLines(content);
  const mockDensity = testLines > 0 ? (mockCount / testLines) * 100 : 0;
  const layer = detectTestLayer(testFilePath);
  const pendingMocks = (content.match(/mockPending|pendingMock/g) || []).length;

  return {
    mockDensity: Math.round(mockDensity * 100) / 100,
    mockCount,
    testLines,
    layer,
    pendingMocks,
  };
}

export async function detectAITestCharacteristics(
  testFilePath: string
): Promise<AITestDetectionResult> {
  let content: string;
  try {
    content = await fs.readFile(testFilePath, 'utf-8');
  } catch {
    return {
      isAiGenerated: false,
      mockDensity: 0,
      layer: detectTestLayer(testFilePath),
      annotations: { hasTest: false, hasIntent: false, hasCovers: false }
    };
  }

  const thresholdMatch = content.match(/@mutation-threshold:\s*(\d+)/);
  const explicitThreshold = thresholdMatch
    ? parseInt(thresholdMatch[1], 10)
    : undefined;

  const hasTest = /@test\s+/i.test(content);
  const hasIntent = /@intent\s+/i.test(content);
  const hasCovers = /@covers\s+/i.test(content);

  const densityInfo = detectLayerAwareDensity(content, testFilePath);
  const isAiGenerated = densityInfo.mockDensity > AI_GENERATED_DENSITY_THRESHOLD;

  return {
    isAiGenerated,
    mockDensity: densityInfo.mockDensity,
    layer: densityInfo.layer,
    explicitThreshold,
    annotations: { hasTest, hasIntent, hasCovers }
  };
}
