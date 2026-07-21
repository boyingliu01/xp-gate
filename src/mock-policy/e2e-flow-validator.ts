/**
 * E2E Flow Through Validator
 *
 * Validates that E2E test files do not mock system-internal modules.
 * E2E tests should exercise real code paths within the system boundary.
 * Only external dependencies (npm packages, Node builtins) may be mocked.
 */

import { readFile } from 'fs/promises';
import { isAbsolute, join } from 'path';
import { detectTestLayer, detectTestLayerFromContent } from '../mutation/detect-ai-test';

export interface E2EFlowResult {
  status: 'pass' | 'fail' | 'skip';
  totalE2EFiles: number;
  filesWithInternalMocks: string[];
}

function filterTestFiles(files: string[]): string[] {
  return files.filter(f => f.endsWith('.test.ts') || f.endsWith('.spec.ts'));
}

const MOCK_CALL_PATTERNS = [
  /(?:vi|jest)\.(?:do)?mock\(\s*['"]([^'"]+)['"]/,
  /(?:vi|jest)\.spyOn\(\s*[^,]+,\s*['"]([^'"]+)['"]/,
];

/**
 * Extract all mock targets from test file content.
 * Returns the import paths that are being mocked.
 */
function extractMockTargets(content: string): string[] {
  const targets: string[] = [];
  for (const pattern of MOCK_CALL_PATTERNS) {
    let match: RegExpExecArray | null;
    const regex = new RegExp(pattern.source, 'g');
    while ((match = regex.exec(content)) !== null) {
      targets.push(match[1]);
    }
  }
  return [...new Set(targets)];
}

/**
 * Check if a mock target is an internal (system-internal) module.
 * Internal = relative imports (starting with . or /) or @/ alias imports.
 * External = bare npm package names or Node.js builtins.
 */
function isInternalMock(mockTarget: string): boolean {
  // Relative imports are internal
  if (mockTarget.startsWith('.')) return true;
  // Absolute path imports are internal
  if (mockTarget.startsWith('/')) return true;
  // @/ alias imports are internal (project path alias)
  if (mockTarget.startsWith('@/')) return true;
  // Everything else (bare package names) is external
  return false;
}

/**
 * Determine if a file is an E2E test, checking annotation first, then path.
 */
function isE2ETest(filePath: string, content: string): boolean {
  const annotationLayer = detectTestLayerFromContent(content);
  if (annotationLayer) return annotationLayer === 'e2e';
  return detectTestLayer(filePath) === 'e2e';
}

/**
 * Validate E2E test files for internal mock violations.
 *
 * @param files - List of file paths to check
 * @param projectRoot - Project root directory
 * @returns E2EFlowResult with pass/fail/skip status
 */
export async function validateE2EFlowThrough(
  files: string[],
  projectRoot: string = process.cwd(),
): Promise<E2EFlowResult> {
  const testFiles = filterTestFiles(files);

  // Collect E2E test files
  const e2eFiles: Array<{ path: string; content: string }> = [];
  for (const testFile of testFiles) {
    const fullPath = isAbsolute(testFile) ? testFile : join(projectRoot, testFile);
    try {
      const content = await readFile(fullPath, 'utf-8');
      if (isE2ETest(testFile, content)) {
        e2eFiles.push({ path: testFile, content });
      }
    } catch {
      // File not readable — skip
    }
  }

  if (e2eFiles.length === 0) {
    return {
      status: 'skip',
      totalE2EFiles: 0,
      filesWithInternalMocks: [],
    };
  }

  const filesWithInternalMocks: string[] = [];
  for (const { path, content } of e2eFiles) {
    const mockTargets = extractMockTargets(content);
    const hasInternalMock = mockTargets.some(isInternalMock);
    if (hasInternalMock) {
      filesWithInternalMocks.push(path);
    }
  }

  return {
    status: filesWithInternalMocks.length > 0 ? 'fail' : 'pass',
    totalE2EFiles: e2eFiles.length,
    filesWithInternalMocks,
  };
}
