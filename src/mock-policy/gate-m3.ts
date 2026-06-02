import { readFile } from 'fs/promises';
import { join } from 'path';
import { loadMockPolicyConfig } from './config';
import { scanProjectScope } from './scope-scanner';
import MockDecisionEngine from './mock-decision-engine';
import { MockPolicyResult, MockPolicyViolation, MockStrategy } from './types';
import { detectTestLayer } from '../mutation/detect-ai-test';

function filterTestFiles(files: string[]): string[] {
  return files.filter(f => f.endsWith('.test.ts') || f.endsWith('.spec.ts'));
}

function collectImports(testContent: string): string[] {
  const importRegex = /import\s*(?:type\s*)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)?\s*(?:from\s*)?['"]([^'"]+)['"]/g;
  const requireRegex = /(?:const|let|var)\s+(?:\{[^}]*\}|\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const exportFromRegex = /export\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\*|\w+)\s+from\s+['"]([^'"]+)['"]/g;

  const imports: string[] = [];
  let match: RegExpExecArray | null;

  const patterns = [importRegex, requireRegex, dynamicImportRegex, exportFromRegex];
  for (const regex of patterns) {
    while ((match = regex.exec(testContent)) !== null) {
      imports.push(match[1]);
    }
  }

  return [...new Set(imports)];
}

function detectMockUsage(testContent: string, importPath: string): MockStrategy {
  const escaped = importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const mockPatterns = [
    new RegExp(`(?:vi|jest)\\.(?:do)?mock\\(['"]${escaped}['"]`),
    new RegExp(`(?:vi|jest)\\.spyOn\\([^,]+,['"]${escaped}['"]`),
  ];
  return mockPatterns.some(p => p.test(testContent)) ? 'mock' : 'real';
}

async function validateFile(
  testFile: string,
  engine: MockDecisionEngine,
  projectRoot: string,
  severity: 'warning' | 'error',
): Promise<MockPolicyViolation[]> {
      const fullPath = testFile.startsWith('/') ? testFile : join(projectRoot, testFile);
  const content = await readFile(fullPath, 'utf-8');
  const layer = detectTestLayer(testFile);
  const imports = collectImports(content);
  const violations: MockPolicyViolation[] = [];

  for (const importPath of imports) {
    const decision = engine.decide(importPath, layer);
    const actualStrategy = detectMockUsage(content, importPath);

    if (decision.strategy !== actualStrategy) {
      violations.push({
        file: testFile,
        line: 0,
        dependency: importPath,
        actualStrategy,
        expectedStrategy: decision.strategy,
        reason: decision.reason,
        severity,
      });
    }

    if (decision.pendingRemoval && actualStrategy === 'mock') {
      const hasRemovalAnnotation = content.includes(
        '@mock-justified'
      );
      if (!hasRemovalAnnotation) {
        violations.push({
          file: testFile,
          line: 0,
          dependency: importPath,
          actualStrategy: 'mock',
          expectedStrategy: 'mock',
          reason: `Pending dependency "${importPath}" requires @mock-justified annotation with removal plan`,
          severity,
        });
      }
    }
  }

  return violations;
}

export async function runGateM3(
  changedFiles: string[],
  projectRoot: string = process.cwd(),
): Promise<MockPolicyResult> {
  const testFiles = filterTestFiles(changedFiles);

  if (testFiles.length === 0) {
    return {
      exitCode: 0,
      status: 'skip',
      violations: [],
      scores: { totalTests: 0, integrationTests: 0, mockDensity: 0, pendingMocks: 0 },
    };
  }

  const config = await loadMockPolicyConfig(projectRoot);
  const severity: 'warning' | 'error' = config.severity;

  // Collect all imports from all test files
  const allImports: string[] = [];
  for (const testFile of testFiles) {
    try {
  const fullPath = testFile.startsWith('/') ? testFile : join(projectRoot, testFile);
      const content = await readFile(fullPath, 'utf-8');
      allImports.push(...collectImports(content));
    } catch {
      // File not readable — skip
    }
  }

  const scope = await scanProjectScope({
    projectRoot,
    imports: [...new Set(allImports)],
    boundary: config.projectBoundary,
  });

  const engine = new MockDecisionEngine(scope, config, projectRoot);
  const allViolations: MockPolicyViolation[] = [];

  let integrationCount = 0;
  for (const testFile of testFiles) {
    const layer = detectTestLayer(testFile);
    if (layer === 'integration') integrationCount++;

    const violations = await validateFile(testFile, engine, projectRoot, severity);
    allViolations.push(...violations);
  }

  const hasBlockableViolations = allViolations.some(v => v.severity === 'error');
  const blocked = severity === 'error' && hasBlockableViolations;

  return {
    exitCode: blocked ? 1 : 0,
    status: blocked ? 'block' : 'pass',
    violations: allViolations,
    scores: {
      totalTests: testFiles.length,
      integrationTests: integrationCount,
      mockDensity: 0,
      pendingMocks: allViolations.filter(v => v.reason.includes('pending')).length,
    },
  };
}

export async function main(args: string[]): Promise<number> {
  if (args.length === 0) {
    console.error('Usage: npx tsx src/mock-policy/gate-m3.ts <file1> <file2> ...');
    return 1;
  }

  console.log('Gate M3: Mock Layering Validation');
  console.log(`  Changed files: ${args.length}`);

  const result = await runGateM3(args);

  if (result.violations.length > 0) {
    console.log('\nViolations:');
    for (const v of result.violations) {
      const icon = v.severity === 'error' ? String.fromCodePoint(0x2717) : String.fromCodePoint(0x26A0);
      console.log(`  ${icon} ${v.file}: ${v.reason}`);
    }
  }

  const label = result.status === 'block' ? `${String.fromCodePoint(0x2717)} BLOCK` : `${String.fromCodePoint(0x2713)} PASS`;
  console.log(`\n${label}  Integration tests: ${result.scores.integrationTests}  Pending mocks: ${result.scores.pendingMocks}`);

  return result.exitCode;
}

// Entry point — process.argv detection for ESM compatibility
const scriptIndex = process.argv.findIndex(a => a.endsWith('gate-m3.ts'));
const cliArgs = scriptIndex >= 0 ? process.argv.slice(scriptIndex + 1) : process.argv.slice(2);

if (cliArgs.length > 0) {
  main(cliArgs)
    .then(exitCode => { if (exitCode !== 0) process.exit(exitCode); })
    .catch(err => { console.error('Gate M3 failed:', err.message); process.exit(1); });
}
