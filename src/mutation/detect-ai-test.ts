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

export function detectTestLayer(testFilePath: string): TestLayer {
  if (testFilePath.includes('.e2e.') || testFilePath.includes('/e2e/') || testFilePath.startsWith('e2e/')) {
    return 'e2e';
  }
  if (testFilePath.includes('.integration.') || testFilePath.includes('/integration/') || testFilePath.startsWith('integration/')) {
    return 'integration';
  }
  if (testFilePath.includes('/__tests__/') || testFilePath.includes('.test.') || testFilePath.includes('.spec.')) {
    return 'unit';
  }
  return 'unknown';
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
