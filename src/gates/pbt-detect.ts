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

function scanDirectory(dir: string, basePath?: string): string[] {
  const results: string[] = [];
  const base = basePath || dir;
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      results.push(...scanDirectory(fullPath, base));
    } else if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.js') ||
               entry.name.endsWith('.spec.ts') || entry.name.endsWith('.spec.js')) {
      results.push(fullPath);
    }
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

// ── Main Analysis ──

/**
 * Analyze PBT usage in the project.
 */
export function detectPBT(cwd?: string): PBTReport {
  const dir = cwd || process.cwd();
  const srcDir = path.join(dir, 'src');
  const messages: string[] = [];

  // Find all test files
  const testFiles = scanDirectory(srcDir);
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

  // Build messages
  messages.push('');
  messages.push('━━━ Property-Based Testing Report ━━━');
  messages.push('');
  messages.push(`  Test files:    ${totalTests}`);
  messages.push(`  PBT files:     ${pbtTestFiles.length} (${coverage}%)`);
  messages.push(`  Frameworks:    ${detected ? [...allFrameworks].join(', ') : 'none detected'}`);
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
