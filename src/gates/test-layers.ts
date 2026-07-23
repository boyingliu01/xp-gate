/**
 * Test Layer Analytics — reports test distribution across unit/integration/e2e layers.
 * Implements #359: layered test protection network (analytics/report mode).
 *
 * Does NOT block commits/pushes. Provides visibility into test coverage distribution.
 */
import fs from 'fs';
import path from 'path';

// ── Types ──

export interface TestLayerReport {
  summary: {
    totalSources: number;
    totalTests: number;
    unitTests: number;
    integrationTests: number;
    e2eTests: number;
  };
  layer1: {
    pairedSources: number;
    unpairedSources: string[];
    pairRate: number;
  };
  layer2: {
    integrationFiles: number;
  };
  layer3: {
    e2eFiles: number;
  };
  verdict: 'INFO';
  messages: string[];
}

// ── File Classification ──

/** Files excluded from source counting (not implementation files). */
const EXCLUDED_PATTERNS = [
  /\.d\.ts$/,
  /\.test\.ts$/,
  /\.spec\.ts$/,
  /\.e2e\.test\.ts$/,
  /\.integration\.test\.ts$/,
  /\/__tests__\//,
  /\/__mocks__\//,
  /\/node_modules\//,
];

/** Source files that don't need tests (pure declarations, configs, types). */
const EXEMPT_FILENAMES = [
  'types.ts', 'interfaces.ts', 'constants.ts', 'config.ts',
  'index.ts', 'main.ts', 'app.ts',
];

function isExcluded(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return EXCLUDED_PATTERNS.some(p => p.test(normalized));
}

function isExempt(filename: string): boolean {
  return EXEMPT_FILENAMES.includes(filename);
}

function isTestFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return /\.test\.(ts|js)$/.test(normalized) || /\.spec\.(ts|js)$/.test(normalized);
}

function classifyTestLayer(filePath: string): 'unit' | 'integration' | 'e2e' | 'unknown' {
  const normalized = filePath.replace(/\\/g, '/');
  if (/\.e2e\.test\./.test(normalized) || /\/e2e\//.test(normalized)) return 'e2e';
  if (/\.integration\.test\./.test(normalized) || /\/integration\//.test(normalized)) return 'integration';
  if (isTestFile(filePath)) return 'unit';
  return 'unknown';
}

/**
 * Find the expected test file for a source file.
 * Convention: src/foo/bar.ts → src/__tests__/bar.test.ts or src/foo/bar.test.ts
 */
function findExpectedTest(sourcePath: string, allFiles: string[]): string | null {
  const basename = path.basename(sourcePath, '.ts');
  const dir = path.dirname(sourcePath);

  // Check adjacent test file: src/foo/bar.ts → src/foo/bar.test.ts
  const adjacentTest = path.join(dir, `${basename}.test.ts`);
  if (allFiles.includes(adjacentTest)) return adjacentTest;

  // Check __tests__ directory: src/foo/bar.ts → src/foo/__tests__/bar.test.ts
  const testsDirTest = path.join(dir, '__tests__', `${basename}.test.ts`);
  if (allFiles.includes(testsDirTest)) return testsDirTest;

  // Check parent __tests__: src/foo/bar.ts → src/__tests__/bar.test.ts
  const parentDir = path.dirname(dir);
  const parentTestsTest = path.join(parentDir, '__tests__', `${basename}.test.ts`);
  if (allFiles.includes(parentTestsTest)) return parentTestsTest;

  return null;
}

// ── Directory Scanner ──

function scanDirectory(dir: string, basePath?: string): string[] {
  const results: string[] = [];
  const base = basePath || dir;

  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(base, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      results.push(...scanDirectory(fullPath, base));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
      results.push(relativePath);
    }
  }

  return results;
}

// ── Main Analysis ──

/**
 * Analyze test layer distribution for a project.
 */
export function analyzeTestLayers(cwd?: string): TestLayerReport {
  const dir = cwd || process.cwd();
  const srcDir = path.join(dir, 'src');
  const messages: string[] = [];

  // Scan all files under src/
  const allFiles = scanDirectory(srcDir);

  // Classify files
  const sourceFiles = allFiles.filter(f => !isExcluded(f) && !isTestFile(f));
  const testFiles = allFiles.filter(f => isTestFile(f));

  const unitTests = testFiles.filter(f => classifyTestLayer(f) === 'unit');
  const integrationTests = testFiles.filter(f => classifyTestLayer(f) === 'integration');
  const e2eTests = testFiles.filter(f => classifyTestLayer(f) === 'e2e');

  // Layer 1: Source-test pairing
  const unpairedSources: string[] = [];
  let pairedCount = 0;

  for (const source of sourceFiles) {
    const filename = path.basename(source);
    if (isExempt(filename)) continue;

    const fullSourcePath = path.join('src', source);
    const testMatch = findExpectedTest(fullSourcePath, allFiles.map(f => path.join('src', f)));
    if (testMatch) {
      pairedCount++;
    } else {
      unpairedSources.push(source);
    }
  }

  const totalNeedingTests = sourceFiles.filter(f => !isExempt(path.basename(f))).length;
  const pairRate = totalNeedingTests > 0 ? Math.round((pairedCount / totalNeedingTests) * 100) : 100;

  // Build messages
  messages.push('');
  messages.push('━━━ Test Layer Analytics ━━━');
  messages.push('');
  messages.push(`  Sources:     ${sourceFiles.length} files`);
  messages.push(`  Tests:       ${testFiles.length} total`);
  messages.push(`    Unit:      ${unitTests.length}`);
  messages.push(`    Integra:   ${integrationTests.length}`);
  messages.push(`    E2E:       ${e2eTests.length}`);
  messages.push('');
  messages.push(`  Layer 1 (Unit Pairing):`);
  messages.push(`    Paired:    ${pairedCount}/${totalNeedingTests} (${pairRate}%)`);
  if (unpairedSources.length > 0 && unpairedSources.length <= 10) {
    messages.push(`    Unpaired:  ${unpairedSources.join(', ')}`);
  } else if (unpairedSources.length > 10) {
    messages.push(`    Unpaired:  ${unpairedSources.length} files (showing first 10)`);
    unpairedSources.slice(0, 10).forEach(f => messages.push(`      - ${f}`));
  }

  if (integrationTests.length > 0) {
    messages.push('');
    messages.push(`  Layer 2 (Integration): ${integrationTests.length} files`);
  }

  if (e2eTests.length > 0) {
    messages.push('');
    messages.push(`  Layer 3 (E2E): ${e2eTests.length} files`);
  }

  messages.push('');

  return {
    summary: {
      totalSources: sourceFiles.length,
      totalTests: testFiles.length,
      unitTests: unitTests.length,
      integrationTests: integrationTests.length,
      e2eTests: e2eTests.length,
    },
    layer1: {
      pairedSources: pairedCount,
      unpairedSources,
      pairRate,
    },
    layer2: {
      integrationFiles: integrationTests.length,
    },
    layer3: {
      e2eFiles: e2eTests.length,
    },
    verdict: 'INFO',
    messages,
  };
}

// ── CLI Entry Point ──

if (process.argv.includes('--run')) {
  const cwdIdx = process.argv.indexOf('--cwd');
  const cwd = cwdIdx >= 0 ? process.argv[cwdIdx + 1] : process.cwd();
  const report = analyzeTestLayers(cwd);
  report.messages.forEach(m => console.log(m));
  process.exit(0);
}
