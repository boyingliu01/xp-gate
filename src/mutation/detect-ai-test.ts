import fs from 'fs/promises';
import { AITestDetectionResult } from './types';

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

  const mockCount = countMockReferences(content);
  const testLines = countTestLines(content);

  const mockDensity = testLines > 0 ? (mockCount / testLines) * 100 : 0;
  const isAiGenerated = mockDensity > AI_GENERATED_DENSITY_THRESHOLD;

  return {
    isAiGenerated,
    mockDensity: Math.round(mockDensity * 100) / 100,
    explicitThreshold,
    annotations: { hasTest, hasIntent, hasCovers }
  };
}
