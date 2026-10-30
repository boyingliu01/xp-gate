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
    /**
     * Sources the pairing convention does not describe (#642).
     *
     * Reported apart from `unpairedSources` because the two call for opposite
     * responses: an unpaired source needs a test, whereas an out-of-scope source
     * (a shell script covered by BATS) needs the convention widened. Counting it
     * as "unpaired" would ask the reader to write a .test.ts for `pre-commit`.
     */
    outOfScopeSources: string[];
    pairRate: number;
  };
  /** Test suites that live outside src/ -- BATS and other shell-level suites (#642). */
  shellSuites: {
    total: number;
    bats: number;
    files: string[];
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

/**
 * Directories that never hold hand-written source, so scanning them inflates
 * the source count and fabricates "unpaired" entries (#636 follow-up).
 *
 * `coverage` matters most: `src/npm-package/coverage/` is a gitignored istanbul
 * output directory (`.gitignore:99`), so it is untracked yet full of `.js`
 * files. Counting `block-navigation.js` / `prettify.js` / `sorter.js` as sources
 * understated the pairing rate and pushed three phantom files into the unpaired
 * list — the metric was measuring a build artifact.
 *
 * Kept as a Set for O(1) lookup; names are matched exactly, not by substring,
 * so a real source directory called e.g. `coverage-rules/` stays scanned.
 */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  '__pycache__',
  '.next',
  '.turbo',
  'build',
  'out',
]);

/**
 * Read a directory, tolerating the ways it can be unreadable.
 *
 * An unreadable directory (EACCES, ENOENT from a racing delete, a broken
 * symlink) must not abort the whole scan: this runs inside gate reporting, where
 * a partial answer beats a crash. Returning an empty list skips the subtree
 * instead of throwing.
 */
function readDirectoryEntries(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function scanDirectory(dir: string, basePath?: string): string[] {
  const results: string[] = [];
  const base = basePath || dir;

  if (!fs.existsSync(dir)) return results;

  for (const entry of readDirectoryEntries(dir)) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(base, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
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
  outOfScopeSources: string[];
  shellSuites: string[];
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

  appendUnpairedLines(messages, counts.unpairedSources);

  // Out-of-scope sources get their own line: folding them into the unpaired list
  // would ask the reader to write a module test for a shell script (#642).
  if (counts.outOfScopeSources.length > 0) {
    messages.push(`    Not pair-able (shell/other): ${counts.outOfScopeSources.length}`);
  }
}

/** Unpaired list, kept short enough not to bury the summary above it (#620). */
function appendUnpairedLines(messages: string[], unpaired: string[]): void {
  if (unpaired.length === 0) return;
  if (unpaired.length <= UNPAIRED_DISPLAY_LIMIT) {
    messages.push(`    Unpaired:  ${unpaired.join(', ')}`);
    return;
  }
  messages.push(`    Unpaired:  ${unpaired.length} files (showing first 10)`);
  unpaired.slice(0, UNPAIRED_DISPLAY_LIMIT).forEach(f => messages.push(`      - ${f}`));
}

/** Format the console block for one analysis. */
function buildLayerMessages(counts: LayerCounts, totalNeedingTests: number): string[] {
  const messages: string[] = [
    '',
    '━━━ Test Layer Analytics ━━━',
    '',
    `  Sources:     ${counts.sourceFiles.length} files`,
    `  Tests:       ${counts.testFiles.length + counts.shellSuites.length} total`,
    `    Unit:      ${counts.unitTests.length}`,
    `    Integra:   ${counts.integrationTests.length + counts.shellSuites.length}`,
    `    E2E:       ${counts.e2eTests.length}`,
    // Printed separately rather than folded into "Integra": whether a suite is
    // BATS or a TS integration test is a fact about the repo that the reader is
    // here to learn, and a shell suite is never counted as a unit test (#642).
    `    Shell:     ${counts.shellSuites.length}`,
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
 * Layer 1 pairing: split sources into paired and unpaired against the sibling
 * test that should cover each one. Works on src-relative paths because
 * findExpectedTest resolves a source path against that root.
 */
function computePairing(
  sourceFiles: string[],
  allFiles: string[],
): { unpairedSources: string[]; outOfScopeSources: string[]; pairedCount: number } {
  const allSourceRelative = allFiles.map(f => path.join('src', f));
  const unpairedSources: string[] = [];
  const outOfScopeSources: string[] = [];
  let pairedCount = 0;

  for (const source of sourceFiles) {
    if (isExempt(path.basename(source))) continue;
    // A source the convention does not describe is not "unpaired" -- nobody was
    // ever asked to pair it. Reporting it as unpaired would send the reader to
    // write a module test for a shell script (#642).
    if (isPairingOutOfScope(source)) {
      outOfScopeSources.push(source);
      continue;
    }
    if (findExpectedTest(path.join('src', source), allSourceRelative)) {
      pairedCount++;
    } else {
      unpairedSources.push(source);
    }
  }

  return { unpairedSources, outOfScopeSources, pairedCount };
}

/**
 * Directories that hold test suites but are not under `src/` (#642).
 *
 * `test-layers` used to scan only `<repo>/src`, so this repository's 166 BATS
 * suites were invisible: the report said "Integration: 0" about a repo whose
 * hook tests spawn real git, real shell adapters and real processes. A metric
 * that omits 37% of the suites cannot be used to judge the test strategy.
 */
const SHELL_SUITE_DIRS = [
  'githooks/__tests__',
  'scripts/__tests__',
  'tests',
  'test',
];

/** A shell-level test suite: BATS or a bare .test.cjs/.test.mjs. */
function isShellSuite(normalized: string): boolean {
  return /\.test\.bats$/.test(normalized)
    || /\.test\.(cjs|mjs)$/.test(normalized)
    || /\/__tests__\/[^/]+\.bats$/.test(normalized);
}

/**
 * Find test suites outside `src/` (#642).
 *
 * Bounded to the conventional test directories rather than walking the whole
 * repo: node_modules and build output would otherwise dominate, and a suite that
 * is not under one of these roots is not discoverable by the runner either.
 */
function listDirNames(abs: string): string[] {
  try {
    // Explicit encoding: without it readdirSync may hand back Buffer entries.
    // The array check covers stubbed/mocked fs implementations too -- a suite
    // that exercises the "directory missing" path must not crash the scanner.
    const listing = fs.readdirSync(abs, { encoding: 'utf8' });
    return Array.isArray(listing) ? listing : [];
  } catch {
    return [];
  }
}

/** Suites under one shell-test root, as repo-relative forward-slash paths. */
function suitesInDir(root: string, rel: string): string[] {
  const prefix = rel.split(path.sep).join('/');
  return listDirNames(path.join(root, rel))
    .map(name => `${prefix}/${name}`)
    .filter(isShellSuite);
}

export function discoverShellSuites(cwd?: string): string[] {
  const root = cwd || process.cwd();
  const found = SHELL_SUITE_DIRS.flatMap(rel => suitesInDir(root, rel));
  // Sorted so the report is stable across filesystems with differing readdir order.
  return found.sort();
}

/**
 * Files the `.test.ts` pairing convention does not apply to (#642).
 *
 * Shell scripts are exercised by BATS suites, not by a neighbouring module
 * test. Listing them separately keeps the pair rate about the language whose
 * convention it actually describes.
 */
function isPairingOutOfScope(filePath: string): boolean {
  return /\.(sh|bash|bats)$/.test(filePath) || !/\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt)$/.test(filePath);
}

/** The summary block; shell suites are added to the test total (#642). */
function buildSummary(counts: LayerCounts, shellOutsideSrc: string[]): TestLayerReport['summary'] {
  return {
    totalSources: counts.sourceFiles.length,
    totalTests: counts.testFiles.length + shellOutsideSrc.length,
    unitTests: counts.unitTests.length,
    integrationTests: counts.integrationTests.length,
    e2eTests: counts.e2eTests.length,
  };
}

/**
 * Shell-level suites that the src/ scan did not already pick up (#642).
 *
 * Keeping these out of the count made "Integration: 0" a statement about the
 * scanner rather than about the repository.
 */
function shellSuitesOutside(testFiles: string[], dir: string): string[] {
  return discoverShellSuites(dir).filter(f => !testFiles.includes(f));
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

  const { unpairedSources, outOfScopeSources, pairedCount } = computePairing(sourceFiles, allFiles);
  const shellOutsideSrc = shellSuitesOutside(testFiles, dir);

  const counts: LayerCounts = {
    sourceFiles,
    testFiles,
    unitTests: byLayer('unit'),
    integrationTests: byLayer('integration'),
    e2eTests: byLayer('e2e'),
    unpairedSources,
    outOfScopeSources,
    shellSuites: shellOutsideSrc,
    pairedCount,
  };
  const totalNeedingTests = sourceFiles.filter(f => !isExempt(path.basename(f)) && !isPairingOutOfScope(f)).length;

  return {
    summary: buildSummary(counts, shellOutsideSrc),
    layer1: {
      pairedSources: pairedCount,
      unpairedSources,
      outOfScopeSources,
      pairRate: totalNeedingTests > 0 ? Math.round((pairedCount / totalNeedingTests) * 100) : 100,
    },
    shellSuites: {
      total: shellOutsideSrc.length,
      bats: shellOutsideSrc.filter(f => f.endsWith('.test.bats') || f.endsWith('.bats')).length,
      files: shellOutsideSrc,
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
