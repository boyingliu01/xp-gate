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

/** How many unpaired sources are listed individually before summarising. */
const UNPAIRED_DISPLAY_LIMIT = 10;

/** The per-layer counts one scan produces, before formatting. */
interface LayerCounts {
  sourceFiles: string[];
  testFiles: string[];
  unitTests: string[];
  integrationTests: string[];
  e2eTests: string[];
  unpairedSources: string[];
  pairedCount: number;
}

/**
 * Append the Layer 1 block: pairing rate plus the unpaired list, truncated once
 * it gets long enough that printing every path would bury the summary (#620).
 */
function appendPairingLines(messages: string[], counts: LayerCounts, totalNeedingTests: number): void {
  const pairRate = totalNeedingTests > 0
    ? Math.round((counts.pairedCount / totalNeedingTests) * 100)
    : 100;
  messages.push('  Layer 1 (Unit Pairing):');
  messages.push(`    Paired:    ${counts.pairedCount}/${totalNeedingTests} (${pairRate}%)`);

  const unpaired = counts.unpairedSources;
  if (unpaired.length === 0 || unpaired.length > UNPAIRED_DISPLAY_LIMIT) {
    if (unpaired.length > 0) {
      messages.push(`    Unpaired:  ${unpaired.length} files (showing first 10)`);
      unpaired.slice(0, UNPAIRED_DISPLAY_LIMIT).forEach(f => messages.push(`      - ${f}`));
    }
    return;
  }
  messages.push(`    Unpaired:  ${unpaired.join(', ')}`);
}

/** Format the console block for one analysis. */
function buildLayerMessages(counts: LayerCounts, totalNeedingTests: number): string[] {
  const messages: string[] = [
    '',
    '━━━ Test Layer Analytics ━━━',
    '',
    `  Sources:     ${counts.sourceFiles.length} files`,
    `  Tests:       ${counts.testFiles.length} total`,
    `    Unit:      ${counts.unitTests.length}`,
    `    Integra:   ${counts.integrationTests.length}`,
    `    E2E:       ${counts.e2eTests.length}`,
    '',
  ];

  appendPairingLines(messages, counts, totalNeedingTests);

  // Layers 2 and 3 only earn a section when they have content.
  if (counts.integrationTests.length > 0) {
    messages.push('', `  Layer 2 (Integration): ${counts.integrationTests.length} files`);
  }
  if (counts.e2eTests.length > 0) {
    messages.push('', `  Layer 3 (E2E): ${counts.e2eTests.length} files`);
  }
  messages.push('');

  return messages;
}

/**
 * Analyze test layer distribution for a project.
 */
export function analyzeTestLayers(cwd?: string): TestLayerReport {
  const dir = cwd || process.cwd();
  const allFiles = scanDirectory(path.join(dir, 'src'));

  const sourceFiles = allFiles.filter(f => !isExcluded(f) && !isTestFile(f));
  const testFiles = allFiles.filter(f => isTestFile(f));
  const byLayer = (layer: string): string[] => testFiles.filter(f => classifyTestLayer(f) === layer);

  // Layer 1: source-test pairing. findExpectedTest works on src-relative paths.
  const allSourceRelative = allFiles.map(f => path.join('src', f));
  const unpairedSources: string[] = [];
  let pairedCount = 0;

  for (const source of sourceFiles) {
    if (isExempt(path.basename(source))) continue;
    if (findExpectedTest(path.join('src', source), allSourceRelative)) {
      pairedCount++;
    } else {
      unpairedSources.push(source);
    }
  }

  const counts: LayerCounts = {
    sourceFiles,
    testFiles,
    unitTests: byLayer('unit'),
    integrationTests: byLayer('integration'),
    e2eTests: byLayer('e2e'),
    unpairedSources,
    pairedCount,
  };
  const totalNeedingTests = sourceFiles.filter(f => !isExempt(path.basename(f))).length;

  return {
    summary: {
      totalSources: sourceFiles.length,
      totalTests: testFiles.length,
      unitTests: counts.unitTests.length,
      integrationTests: counts.integrationTests.length,
      e2eTests: counts.e2eTests.length,
    },
    layer1: {
      pairedSources: pairedCount,
      unpairedSources,
      pairRate: totalNeedingTests > 0 ? Math.round((pairedCount / totalNeedingTests) * 100) : 100,
    },
    layer2: {
      integrationFiles: counts.integrationTests.length,
    },
    layer3: {
      e2eFiles: counts.e2eTests.length,
    },
    verdict: 'INFO',
    messages: buildLayerMessages(counts, totalNeedingTests),
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
