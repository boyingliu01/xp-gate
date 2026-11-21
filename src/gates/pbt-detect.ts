/**
 * Property-Based Testing Detection — reports PBT framework usage in the project.
 * Implements #337: PBT analytics (report mode, does NOT block).
 */
import fs from 'fs';
import path from 'path';

// ── Types ──

export interface PBTReport {
  detected: boolean;
  frameworks: string[];
  testFiles: string[];
  pbtTestFiles: string[];
  coverage: number;
  messages: string[];
}

// ── PBT Framework Patterns ──

/** Import patterns that indicate PBT usage. */
const PBT_IMPORT_PATTERNS = [
  { name: 'fast-check', patterns: [/from\s+['"]fast-check['"]/, /require\(['"]fast-check['"]\)/, /import.*fc.*from/] },
  { name: 'jsverify', patterns: [/from\s+['"]jsverify['"]/, /require\(['"]jsverify['"]\)/] },
  { name: 'jest-property', patterns: [/expect\(\)\.property/, /jest-property/] },
  { name: 'ava-fast-check', patterns: [/ava.*fast-check/, /test\.property/] },
];

/** PBT API usage patterns (even without explicit import). */
const PBT_API_PATTERNS = [
  /fc\.property\(/,
  /fc\.assert\(/,
  /fc\.check\(/,
  /fc\.sample\(/,
  /fc\.quickcheck\(/,
  /jsc\.property\(/,
  /\.forAll\(/,
  /property\(.*arb/,
];

// ── Scanner ──

/** Directories that never hold test sources worth scanning. */
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist']);

/**
 * Test-file suffixes recognised by the PBT scanner.
 *
 * #857: this used to be `['.test.ts', '.test.js', '.spec.ts', '.spec.js']`, which
 * made every `.mjs`/`.cjs`/`.mts`/`.cts` test invisible. Those are not exotic —
 * `.mjs`/`.cjs` are what Node tooling ships by default now, and `node --test` is
 * built in, so `tests/*.test.mjs` is an ordinary layout. Measured on such a
 * project with 14 test files: the scanner reported 0.
 *
 * Same root cause as #732 (an extension whitelist missing the module variants),
 * but a different code path — fixing the gates' `grep -E` regexes there does not
 * touch this constant. That is why it is pinned separately.
 */
const TEST_SUFFIXES = [
  '.test.mjs', '.test.cjs', '.test.mts', '.test.cts',
  '.spec.mjs', '.spec.cjs', '.spec.mts', '.spec.cts',
  '.test.ts', '.test.js', '.test.tsx', '.test.jsx',
  '.spec.ts', '.spec.js', '.spec.tsx', '.spec.jsx',
];

/**
 * Directories searched for test files, relative to the project root.
 *
 * #857: only `src` was scanned. A project following the equally common `tests/`
 * convention reported zero test files even with ordinary `.test.js` names — the
 * issue's own fixture was laid out that way, so correcting the suffixes alone
 * would still have printed `Test files: 0`.
 */
const TEST_ROOTS = ['src', 'tests', 'test', '__tests__', 'lib'];

function isTestFileName(name: string): boolean {
  return TEST_SUFFIXES.some(suffix => name.endsWith(suffix));
}

/**
 * Read a directory's entries, or [] when it cannot be read.
 *
 * Split out of scanDirectory to keep that function under the complexity ratchet:
 * the try/catch added a branch to a function already at the recorded baseline,
 * which the CCN gate rejected. A directory that cannot be read is skipped rather
 * than thrown -- readdirSync fails on a permission error, a broken symlink, or a
 * path deleted between the existsSync and the read, and one unreadable
 * subdirectory must not take the whole scan down. Returning [] keeps the count
 * honest for the directories that COULD be read.
 */
function readDirEntries(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Collect test files under `dir`, descending into subdirectories. */
function scanDirectory(dir: string, basePath?: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const results: string[] = [];
  for (const entry of readDirEntries(dir)) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) {
        results.push(...scanDirectory(path.join(dir, entry.name), basePath ?? dir));
      }
      continue;
    }
    if (isTestFileName(entry.name)) results.push(path.join(dir, entry.name));
  }
  return results;
}

function detectPBTInFile(filePath: string): { hasPBT: boolean; frameworks: string[] } {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const foundFrameworks: string[] = [];

    // Check import patterns
    for (const fw of PBT_IMPORT_PATTERNS) {
      if (fw.patterns.some(p => p.test(content))) {
        foundFrameworks.push(fw.name);
      }
    }

    // Check API usage patterns
    if (foundFrameworks.length === 0) {
      for (const pattern of PBT_API_PATTERNS) {
        if (pattern.test(content)) {
          foundFrameworks.push('unknown-pbt');
          break;
        }
      }
    }

    return { hasPBT: foundFrameworks.length > 0, frameworks: [...new Set(foundFrameworks)] };
  } catch {
    return { hasPBT: false, frameworks: [] };
  }
}

/**
 * Render the report text.
 *
 * Lifted out of detectPBT so the detector stays under the 50-line ceiling Gate 4
 * enforces on clean code; the message list has its own branching and reads better
 * as one place than as a tail of the detector.
 */
function buildMessages(input: {
  totalTests: number;
  pbtTestFiles: string[];
  coverage: number;
  detected: boolean;
  frameworks: string[];
}): string[] {
  const { totalTests, pbtTestFiles, coverage, detected, frameworks } = input;
  const messages: string[] = [];
  messages.push('');
  messages.push('━━━ Property-Based Testing Report ━━━');
  messages.push('');
  messages.push(`  Test files:    ${totalTests}`);
  // #857: a 0% figure is a MEASUREMENT, and when nothing was scanned there is no
  // measurement to report. Printing "0 (0%)" beside "No test files found" reads as
  // "this project has no property tests" when the truth is "the scanner did not
  // look" -- the same conflation as #732, one report away. Say it is not checked.
  if (totalTests > 0) {
    messages.push(`  PBT files:     ${pbtTestFiles.length} (${coverage}%)`);
  } else {
    messages.push('  PBT files:     not measured (no test files were found to inspect)');
  }
  messages.push(`  Frameworks:    ${detected ? frameworks.join(', ') : 'none detected'}`);
  messages.push('');

  if (detected) {
    messages.push('  ✅ PBT usage detected:');
    pbtTestFiles.forEach(f => messages.push(`    - ${f}`));
  } else if (totalTests > 0) {
    messages.push('  ℹ️  No property-based testing detected.');
    messages.push('  Consider adding fast-check for boundary condition coverage:');
    messages.push('    npm install -D fast-check');
    messages.push('    import fc from "fast-check";');
    messages.push('    test("property: reverse is idempotent", () => {');
    messages.push('      fc.assert(fc.property(fc.array(fc.integer()), arr => {');
    messages.push('        expect(arr.reverse().reverse()).toEqual(arr);');
    messages.push('      }));');
    messages.push('    });');
  } else {
    messages.push('  ℹ️  No test files found.');
  }
  messages.push('');
  return messages;
}

// ── Main Analysis ──

/**
 * Analyze PBT usage in the project.
 */
export function detectPBT(cwd?: string): PBTReport {
  const dir = cwd || process.cwd();

  // Find all test files, across every conventional test root (#857). A Set keeps
  // a file from being counted twice when roots nest, e.g. `tests/` under `src/`.
  const testFiles = [...new Set(
    TEST_ROOTS.flatMap(root => scanDirectory(path.join(dir, root))),
  )];
  const pbtTestFiles: string[] = [];
  const allFrameworks = new Set<string>();

  for (const testFile of testFiles) {
    const result = detectPBTInFile(testFile);
    if (result.hasPBT) {
      pbtTestFiles.push(path.relative(dir, testFile).replace(/\\/g, '/'));
      result.frameworks.forEach(fw => allFrameworks.add(fw));
    }
  }

  const totalTests = testFiles.length;
  const coverage = totalTests > 0 ? Math.round((pbtTestFiles.length / totalTests) * 100) : 0;
  const detected = pbtTestFiles.length > 0;

  const messages = buildMessages({
    totalTests,
    pbtTestFiles,
    coverage,
    detected,
    frameworks: [...allFrameworks],
  });

  return { detected, frameworks: [...allFrameworks], testFiles, pbtTestFiles, coverage, messages };
}

// ── CLI Entry Point ──

if (process.argv.includes('--run')) {
  const cwdIdx = process.argv.indexOf('--cwd');
  const cwd = cwdIdx >= 0 ? process.argv[cwdIdx + 1] : process.cwd();
  const report = detectPBT(cwd);
  report.messages.forEach(m => console.log(m));
  process.exit(0);
}
