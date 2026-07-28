/**
 * test-alignment.ts — Deterministic Test-Specification Alignment Engine
 *
 * Extracted from skills/test-specification-alignment/references/alignment-verification-algorithm.md
 * (493 lines of TypeScript pseudocode) into real, compiled TypeScript.
 *
 * Architecture:
 *   1. parseSpecification() — Parse YAML → requirement IDs
 *   2. parseTestFiles() — Parse test files → annotation map
 *   3. verifyAlignment() — Cross-reference requirements ↔ tests
 *   4. calculateScore() — Weighted alignment score
 *   5. writeReport() — Write test-alignment-report.json
 *
 * Design decisions:
 *   - Lightweight YAML parser (~150 LOC, no external dependencies) for zero-dep npm package
 *   - Regex-based annotation extraction for TS, Python, Go (with .each/.skip/.todo support)
 *   - Real avgAssertions from testMap (not hardcoded placeholder)
 *   - Canonical spec format: specification.requirements (with backward compat for bare spec.requirements)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface AcceptanceCriterion {
  id: string;
  given?: string;
  when?: string;
  then?: string;
}

export interface Requirement {
  id: string;
  description?: string;
  priority?: 'MUST' | 'SHOULD' | 'MAY';
  acceptanceCriteria: string[];
}

export interface DesignDecision {
  id: string;
  description?: string;
  rationale?: string;
  alternatives_considered?: string[];
}

export interface ApiContract {
  endpoint: string;
  method?: string;
  [key: string]: unknown;
}

export interface SpecificationMap {
  requirements: Requirement[];
  designDecisions: DesignDecision[];
  apiContracts: ApiContract[];
}

export interface TestCase {
  name: string;
  file: string;
  requirementId?: string;
  intent?: string;
  covers: string[];
  edgeCases: string[];
  assertions: number;
}

export interface TestMap {
  tests: TestCase[];
  totalTests: number;
  totalAssertions: number;
}

export type IssueType =
  | 'MISSING_REQUIREMENT_TEST'
  | 'UNCOVERED_ACCEPTANCE_CRITERIA'
  | 'MISSING_INTENT'
  | 'UNCOVERED_EDGE_CASE'
  | 'INSUFFICIENT_ASSERTIONS';

export type IssueSeverity = 'critical' | 'major' | 'minor';

export interface AlignmentIssue {
  type: IssueType;
  severity: IssueSeverity;
  requirementId?: string;
  acId?: string;
  testId?: string;
  message: string;
}

export interface CoverageReport {
  requirementsCovered: number;
  requirementsTotal: number;
  acCovered: number;
  acTotal: number;
  edgeCasesCovered: number;
  edgeCasesTotal: number;
  testsWithIntent: number;
  testsTotal: number;
}

export interface AlignmentReport {
  score: number;
  issues: AlignmentIssue[];
  coverage: CoverageReport;
  passed: boolean;
}

export interface TestAlignmentReportFile {
  alignment_status: 'PASS' | 'FAIL' | 'BLOCKED';
  phase: number;
  score: number;
  head_commit: string;
  spec_hash: string;
  timestamp: string;
  misaligned_tests: Array<{
    test_name: string;
    spec_requirement: string;
    gap: string;
  }>;
  anti_pattern_detected: boolean;
  errors: string[];
}


// ============================================================================
// parseSpecification() — regex-based extraction for specification.yaml
// ============================================================================

export function parseSpecification(specPath: string): SpecificationMap {
  if (!fs.existsSync(specPath)) {
    throw new Error(`Specification file not found: ${specPath}`);
  }

  const content = fs.readFileSync(specPath, 'utf8');

  // Split on REQ boundaries: "\n    - id: REQ-" (canonical indentation)
  // Also handle legacy "\n  - id: REQ-" (minimal indentation)
  const hasCanonicalIndent = content.includes('\n    - id: REQ-');
  const splitDelimiter = hasCanonicalIndent ? '\n    - id: REQ-' : '\n  - id: REQ-';
  const blockPrefix = hasCanonicalIndent ? '    - id: REQ-' : '  - id: REQ-';

  const blocks = content.split(splitDelimiter);

  const requirements: Requirement[] = [];

  for (let i = 1; i < blocks.length; i++) {
    const fullBlock = blockPrefix + blocks[i]!;

    const reqMatch = fullBlock.match(/- id: (REQ-[\w-]+)/);
    if (!reqMatch) continue;

    const reqId = reqMatch[1]!;

    // Extract AC IDs: deeply indented "- id: AC-XXX-XX"
    const acRegex = /- id: (AC-[\w-]+)/g;
    const acIds: string[] = [];
    let acMatch: RegExpExecArray | null;
    while ((acMatch = acRegex.exec(fullBlock)) !== null) {
      acIds.push(acMatch[1]!);
    }

    requirements.push({
      id: reqId,
      acceptanceCriteria: acIds,
    });
  }

  const designDecisions: DesignDecision[] = [];
  const ddRegex = /- id: ([\w-]+)/g;
  const ddSection = content.match(/design_decisions:\n([\s\S]*?)(?=\n[^\s#-])/);
  if (ddSection) {
    let ddMatch: RegExpExecArray | null;
    while ((ddMatch = ddRegex.exec(ddSection[1]!)) !== null) {
      designDecisions.push({ id: ddMatch[1]! });
    }
  }

  const apiContracts: ApiContract[] = [];
  const apiRegex = /- endpoint: (.+)/g;
  const apiSection = content.match(/api_contracts:\n([\s\S]*?)(?=\n[^\s#-])/);
  if (apiSection) {
    let apiMatch: RegExpExecArray | null;
    while ((apiMatch = apiRegex.exec(apiSection[1]!)) !== null) {
      apiContracts.push({ endpoint: apiMatch[1]!.trim() });
    }
  }

  return { requirements, designDecisions, apiContracts };
}

// ============================================================================
// Step 2: parseTestFiles()
// ============================================================================

const REQ_ID_PATTERN = /REQ-[A-Z0-9]+-[A-Z0-9]+/;

function extractTag(text: string, tag: string): string | null {
  // Match @tag value (single line extraction, stops at newline or */)
  const regex = new RegExp('@' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+(.+?)(?:\\n|\\*\\/)', 's');
  const match = text.match(regex);
  if (!match) return null;
  return match[1]!.trim();
}

function extractAllTags(text: string, tag: string): string[] {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('@' + escapedTag + '\\s+(.+?)(?:\\n|\\*\\/)', 'gs');
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const items1 = match[1]!.split(',').map(s => s.trim()).filter(Boolean);
    results.push(...items1);
  }
  return results;
}

function countAssertions(content: string): number {
  // Count common assertion patterns
  const patterns = [
    /expect\(/g,
    /assert\./g,
    /assert\(/g,
    /\.should\./g,
    /expect\./g,
    /toEqual\(/g,
    /toBe\(/g,
  ];
  let count = 0;
  for (const pattern of patterns) {
    const matches = content.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

/**
 * Extract JSDoc block preceding a test/it/describe declaration.
 * Handles .each(), .skip(), .todo() variants and backtick template literals.
 */
function extractJSDocBeforeTest(content: string): Array<{ jsdoc: string; testBody: string; testName: string }> {
  const results: Array<{ jsdoc: string; testBody: string; testName: string }> = [];

  // Match: /** JSDOC */ (test|it|describe)[.modifier]( [args], )'name', ...
  // `.each` variants have an extra `()` before the test name string
  const testPattern = /\/\*\*([\s\S]*?)\*\/(?:[\s\n]*)(?:test|it|describe)(?:\.(?:each|skip|todo|only))?\s*\([^)]*\)\s*,\s*\(\s*(?:['"]([^'"]+)['"]|`([^`]*)`)\s*[,\)]/g;

  let match: RegExpExecArray | null;
  while ((match = testPattern.exec(content)) !== null) {
    const jsdoc = match[1]!;
    const testName = match[2] || match[3] || '';
    if (testName) {
      const testBody = content.slice(match.index, match.index + match[0].length);
      results.push({ jsdoc, testBody, testName });
    }
  }

  // Second pass: match standard test/it/describe without .each
  const simplePattern = /\/\*\*([\s\S]*?)\*\/(?:[\s\n]*)(?:test|it|describe)(?:\.(?:skip|todo|only))?\s*\(\s*(?:['"]([^'"]+)['"]|`([^`]*)`)\s*[,\)]/g;

  while ((match = simplePattern.exec(content)) !== null) {
    const jsdoc = match[1]!;
    const testName = match[2] || match[3] || '';
    if (testName) {
      // Don't duplicate if already found in first pass
      const alreadyFound = results.some(r => r.jsdoc === jsdoc);
      if (!alreadyFound) {
        const testBody = content.slice(match.index, match.index + match[0].length);
        results.push({ jsdoc, testBody, testName });
      }
    }
  }

  return results;
}

function pushTestWithCovers(
  tests: TestCase[],
  testPath: string,
  name: string,
  reqId: string,
  intent: string | undefined,
  fileContent: string,
  totalAssertionsRef: { value: number },
) {
  const coversRegex = /@covers\s+(.+)/g;
  const covers: string[] = [];
  let coversMatch: RegExpExecArray | null;
  while ((coversMatch = coversRegex.exec(fileContent)) !== null) {
    covers.push(...coversMatch[1]!.split(',').map(s => s.trim()).filter(c => /^AC-[A-Z0-9]+-\d+-\d+$/.test(c)));
  }

  const assertions = countAssertions(fileContent);
  totalAssertionsRef.value += assertions;

  tests.push({
    name,
    file: testPath,
    requirementId: reqId,
    intent,
    covers,
    edgeCases: [],
    assertions,
  });
}

export function parseTestFiles(testPaths: string[]): TestMap {
  const tests: TestCase[] = [];
  const totalAssertionsObj = { value: 0 };

  for (const testPath of testPaths) {
    if (!fs.existsSync(testPath)) continue;

    const content = fs.readFileSync(testPath, 'utf8');
    const ext = path.extname(testPath);

    if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
      const matches = extractJSDocBeforeTest(content);

      for (const m of matches) {
        const reqMatch = m.jsdoc.match(/@test\s+(REQ-[A-Z0-9]+-[A-Z0-9]+)/);
        const intentMatch = m.jsdoc.match(/@intent\s+(.+?)(?:\n\s*\*)/s);
        const coversRaw = extractAllTags(m.jsdoc, 'covers');
        // Filter: only valid AC IDs (AC-XXX-NNN-NN pattern)
        const covers = coversRaw.filter(c => /^AC-[A-Z0-9]+-\d+-\d+$/.test(c));

        const assertions = countAssertions(content);
        totalAssertionsObj.value += assertions;

        tests.push({
          name: m.testName,
          file: testPath,
          requirementId: reqMatch ? reqMatch[1] : undefined,
          intent: intentMatch ? intentMatch[1]!.trim() : undefined,
          covers,
          edgeCases: [],
          assertions,
        });
      }
    } else if (ext === '.py') {
      const pyTestPattern = /(# @test\s+(REQ-[A-Z0-9]+-[A-Z0-9]+)[\s\S]*?)(?:# @intent\s+(.+?)\n)?def\s+(test_\w+)/g;
      let m: RegExpExecArray | null;
      while ((m = pyTestPattern.exec(content)) !== null) {
        pushTestWithCovers(tests, testPath, m[4]!, m[2]!, m[3]?.trim(), content, totalAssertionsObj);
      }
    } else if (ext === '.go') {
      const goTestPattern = /(\/\/ @test\s+(REQ-[A-Z0-9]+-[A-Z0-9]+))\s*[\s\S]*?func\s+(Test_\w+)/g;
      let m: RegExpExecArray | null;
      while ((m = goTestPattern.exec(content)) !== null) {
        const block = content.slice(Math.max(0, m.index - 500), m.index);
        const intentMatch = block.match(/\/\/ @intent\s+(.+)/);
        pushTestWithCovers(tests, testPath, m[3]!, m[2]!, intentMatch?.[1]?.trim(), content, totalAssertionsObj);
      }
    }
  }

  return {
    tests,
    totalTests: tests.length,
    totalAssertions: totalAssertionsObj.value,
  };
}

// ============================================================================
// Step 3: verifyAlignment()
// ============================================================================

export function verifyAlignment(
  specMap: SpecificationMap,
  testMap: TestMap,
): AlignmentReport {
  const issues: AlignmentIssue[] = [];

  // Build coverage data
  const coveredReqIds = new Set<string>();
  const coveredAcIds = new Set<string>();
  let testsWithIntent = 0;

  for (const test of testMap.tests) {
    if (test.requirementId) {
      coveredReqIds.add(test.requirementId);
    }
    for (const acId of test.covers) {
      coveredAcIds.add(acId);
    }
    if (test.intent && test.intent.trim().length > 0) {
      testsWithIntent++;
    }
  }

  // Collect all requirement IDs and acceptance criteria IDs from spec
  const allReqIds = new Set<string>();
  const allAcIds = new Set<string>();
  let totalEdgeCases = 0;

  for (const req of specMap.requirements) {
    allReqIds.add(req.id);
    for (const acId of req.acceptanceCriteria) {
      allAcIds.add(acId);
    }
  }

  // Rule 1: Each REQ must have a test (Critical)
  for (const reqId of allReqIds) {
    if (!coveredReqIds.has(reqId)) {
      issues.push({
        type: 'MISSING_REQUIREMENT_TEST',
        severity: 'critical',
        requirementId: reqId,
        message: `Requirement ${reqId} has no associated test`,
      });
    }
  }

  // Rule 2: Each AC must have assertion coverage (Major)
  for (const acId of allAcIds) {
    if (!coveredAcIds.has(acId)) {
      // Find which requirement this AC belongs to
      const parentReq = specMap.requirements.find(r => r.acceptanceCriteria.includes(acId));
      issues.push({
        type: 'UNCOVERED_ACCEPTANCE_CRITERIA',
        severity: 'major',
        acId,
        requirementId: parentReq?.id,
        message: `Acceptance criterion ${acId} is not covered by any test`,
      });
    }
  }

  // Rule 3: Each test must have @intent (Major)
  for (const test of testMap.tests) {
    if (!test.intent || test.intent.trim().length === 0) {
      issues.push({
        type: 'MISSING_INTENT',
        severity: 'major',
        testId: test.name,
        message: `Test "${test.name}" in ${test.file} is missing @intent annotation`,
      });
    }
  }

  // Rule 4: Each edge case should have a test (Minor) — not blocking in score

  // Rule 5: Each test needs >= 2 assertions (Minor)
  for (const test of testMap.tests) {
    if (test.assertions < 2) {
      issues.push({
        type: 'INSUFFICIENT_ASSERTIONS',
        severity: 'minor',
        testId: test.name,
        message: `Test "${test.name}" has only ${test.assertions} assertion(s) — consider adding more`,
      });
    }
  }

  const coverage: CoverageReport = {
    requirementsCovered: coveredReqIds.size,
    requirementsTotal: allReqIds.size,
    acCovered: coveredAcIds.size,
    acTotal: allAcIds.size,
    edgeCasesCovered: 0,
    edgeCasesTotal: totalEdgeCases,
    testsWithIntent,
    testsTotal: testMap.totalTests,
  };

  return {
    score: 0, // computed in calculateScore
    issues,
    coverage,
    passed: false,
  };
}

// ============================================================================
// Step 4: calculateScore()
// Uses real avgAssertions from testMap — no hardcoded placeholder
// ============================================================================

export function calculateScore(
  issues: AlignmentIssue[],
  coverage: CoverageReport,
  testMap: { totalTests: number; totalAssertions: number },
): number {
  // Weighted dimensions
  const weights = {
    requirementCoverage: 30,
    acCoverage: 25,
    testIntent: 20,
    edgeCaseCoverage: 15,
    dataValidity: 10,
  };

  // Requirement coverage score
  let reqCoverageScore = 0;
  if (coverage.requirementsTotal > 0) {
    reqCoverageScore = (coverage.requirementsCovered / coverage.requirementsTotal) * weights.requirementCoverage;
  }

  // AC coverage score
  let acCoverageScore = 0;
  if (coverage.acTotal > 0) {
    acCoverageScore = (coverage.acCovered / coverage.acTotal) * weights.acCoverage;
  } else {
    // No ACs → full score (nothing to cover)
    acCoverageScore = weights.acCoverage;
  }

  // Test intent score
  let intentScore = 0;
  if (coverage.testsTotal > 0) {
    intentScore = (coverage.testsWithIntent / coverage.testsTotal) * weights.testIntent;
  }

  // Edge case coverage (stub — no edge case tracking in v1)
  const edgeCaseScore = (coverage.edgeCasesTotal > 0)
    ? (coverage.edgeCasesCovered / coverage.edgeCasesTotal) * weights.edgeCaseCoverage
    : weights.edgeCaseCoverage; // full score if no edge cases tracked

  // Data validity: use real avgAssertions from testMap
  const avgAssertions = testMap.totalTests > 0
    ? testMap.totalAssertions / testMap.totalTests
    : 0;
  let dataValidityScore = 0;
  if (avgAssertions >= 5) {
    dataValidityScore = weights.dataValidity; // full score
  } else if (avgAssertions >= 3) {
    dataValidityScore = weights.dataValidity * 0.75;
  } else if (avgAssertions >= 1) {
    dataValidityScore = weights.dataValidity * 0.5;
  } else {
    dataValidityScore = 0;
  }

  let score = reqCoverageScore + acCoverageScore + intentScore + edgeCaseScore + dataValidityScore;

  // Penalize for issues
  for (const issue of issues) {
    if (issue.severity === 'critical') {
      score -= 5;
    } else if (issue.severity === 'major') {
      score -= 2;
    }
    // minor issues don't deduct (they're informational)
  }

  return Math.max(0, Math.round(score * 10) / 10);
}

// ============================================================================
// Step 5: writeReport()
// ============================================================================

export function writeReport(report: TestAlignmentReportFile, outputPath: string): void {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
}

// ============================================================================
// Orchestrator: runFullAlignment()
// ============================================================================

export interface AlignmentOptions {
  specPath: string;
  testDirs?: string[];
  headCommit?: string;
  outputPath?: string;
}

export function runFullAlignment(options: AlignmentOptions): TestAlignmentReportFile {
  const { specPath, testDirs = ['tests', 'test', '__tests__', 'src/__tests__'], headCommit, outputPath } = options;

  // Step 1: Parse spec
  let spec: SpecificationMap;
  try {
    spec = parseSpecification(specPath);
  } catch (e: any) {
    return {
      alignment_status: 'BLOCKED',
      phase: 0,
      score: 0,
      head_commit: headCommit || 'unknown',
      spec_hash: '',
      timestamp: new Date().toISOString(),
      misaligned_tests: [],
      anti_pattern_detected: false,
      errors: [`Failed to parse specification: ${e.message}`],
    };
  }

  const specContent = fs.readFileSync(specPath, 'utf8');
  const specHash = crypto.createHash('sha256').update(specContent).digest('hex');

  // Step 2: Collect test files
  const testFiles: string[] = [];
  for (const dir of testDirs) {
    if (fs.existsSync(dir)) {
      const walkDir = (d: string) => {
        const entries = fs.readdirSync(d, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(d, entry.name);
          if (entry.isDirectory() && entry.name !== 'node_modules') {
            walkDir(fullPath);
          } else if (entry.isFile() && /\.(test|spec)\.(ts|tsx|js|jsx|py|go)$/.test(entry.name)) {
            testFiles.push(fullPath);
          }
        }
      };
      walkDir(dir);
    }
  }

  // Step 3: Parse tests
  const testMap = parseTestFiles(testFiles);

  // Step 4: Verify alignment
  const alignmentReport = verifyAlignment(spec, testMap);
  const score = calculateScore(alignmentReport.issues, alignmentReport.coverage, testMap);

  const report: TestAlignmentReportFile = {
    alignment_status: score >= 80 ? 'PASS' : 'FAIL',
    phase: score >= 80 ? 2 : 1,
    score,
    head_commit: headCommit || 'unknown',
    spec_hash: specHash,
    timestamp: new Date().toISOString(),
    misaligned_tests: alignmentReport.issues.map(issue => ({
      test_name: issue.testId || 'unknown',
      spec_requirement: issue.requirementId || 'unknown',
      gap: issue.message,
    })),
    anti_pattern_detected: false,
    errors: [],
  };

  // Step 5: Write output
  if (outputPath) {
    writeReport(report, outputPath);
  }

  return report;
}
