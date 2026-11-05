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
  /**
   * Test files whose extension has no parser (#702).
   *
   * These used to be dropped on the floor: the file was read, its extension
   * taken, and then no branch matched. A pure-Java project therefore reported
   * `totalTests: 0` and computed its alignment score over an empty set, with
   * nothing distinguishing "no tests" from "tests I could not read". Callers
   * must surface this instead of treating the map as complete.
   */
  unsupportedFiles: string[];
}

/**
 * Test-file extensions that this module can parse (#702).
 *
 * Listed explicitly rather than implied by the presence of an `if` branch,
 * because that is exactly how `.java` disappeared: an if/else chain with a
 * missing arm looks identical to a complete one at the call site. This list is
 * the contract the branches are checked against.
 */
export const SUPPORTED_TEST_EXTENSIONS: readonly string[] = [
  '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.py', '.go', '.java', '.bats',
];

/**
 * Test-file extensions this module deliberately does NOT parse, but recognises
 * as tests (#702).
 *
 * Being on this list means "report it", not "ignore it". The distinction
 * matters: before, both "not a test file" and "a test file I cannot read"
 * produced the same silent skip.
 */
export const UNSUPPORTED_TEST_EXTENSIONS: readonly string[] = [
  '.kt', '.kts', '.cs', '.rb', '.rs', '.swift', '.php', '.scala',
];

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
/**
 * Directories never worth walking when discovering test files. `node_modules`
 * and build output cannot contain this repo's tests; `.worktrees` holds full
 * copies of the repo, so walking it would double-count every test and report
 * phantom duplications.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  '.worktrees',
  '.stryker-tmp',
  '.sprint-history',
]);

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

const AC_ID = /^AC-[A-Z0-9]+-(?:[A-Z0-9]+-)?\d+[a-z]?$/;

/**
 * Ceiling for `AC-X-01 through AC-X-N` expansion.
 *
 * Why 200: this repo's largest AC block is 19 criteria (REQ-670), and the spec
 * has never exceeded two digits per requirement. 200 is ~10x the observed
 * maximum, so no genuine annotation can reach it, while a mistyped bound
 * (`AC-X-1 through AC-X-999999999`) is rejected in constant time instead of
 * allocating until the worker dies. Deliberately NOT configurable: the value
 * only needs to separate "a real range" from "a typo", and a per-project knob
 * would be one more thing to get wrong. Widen it only with evidence of a real
 * requirement block approaching it.
 */
const MAX_AC_RANGE_SPAN = 200;

/**
 * Normalise a raw `@covers` token list into concrete AC ids.
 *
 * Two things happen here:
 *   - Non-AC tokens are dropped. Some headers list a function or module name
 *     (`@covers mock-policy-config-loader`) instead of criteria ids.
 *   - Range notation is expanded. Eight files in this repo write
 *     `AC-TDD-001-01 through AC-TDD-001-14`; reading only the two endpoints
 *     reported the twelve criteria in between as uncovered even though the file
 *     was explicitly annotated for all of them.
 */
function expandAcCovers(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const rangeMatch = tokens[i + 1] === 'through' && AC_ID.test(token) && AC_ID.test(tokens[i + 2] || '');
    if (!rangeMatch) {
      if (AC_ID.test(token)) out.push(token);
      continue;
    }
    const from = token;
    const to = tokens[i + 2]!;
    const prefix = from.slice(0, from.lastIndexOf('-') + 1);
    const startNum = Number(from.slice(prefix.length).replace(/[a-z]$/, ''));
    const endNum = Number(to.slice(prefix.length).replace(/[a-z]$/, ''));
    if (!to.startsWith(prefix) || Number.isNaN(startNum) || Number.isNaN(endNum) || endNum < startNum) {
      out.push(from, to);
      i += 2;
      continue;
    }
    // A range is a convenience, not a data-transport format: real annotations
    // span a handful of criteria. Without a ceiling, one mistyped digit
    // (`AC-X-1 through AC-X-999999999`) allocates until the worker dies with
    // ERR_WORKER_OUT_OF_MEMORY -- measured, not hypothetical. Past the ceiling
    // keep only the two literal endpoints: they are genuine references, and
    // silently dropping them would lose the only real signal in the line.
    const span = endNum - startNum + 1;
    if (span > MAX_AC_RANGE_SPAN) {
      // Report the refusal. Returning quietly would present "two ACs" as the
      // whole annotation, and a reader comparing that against the report has no
      // way to tell a deliberate ceiling from an annotation that lists two ids.
      console.warn(
        `[test-alignment] refused to expand a ${span}-criterion range ` +
        `(${from} through ${to}); keeping only the endpoints. ` +
        `If this is a real range it is too wide to be an AC annotation -- check for a typo.`,
      );
      out.push(from, to);
      i += 2;
      continue;
    }
    for (let n = startNum; n <= endNum; n++) {
      out.push(prefix + String(n).padStart(from.slice(prefix.length).length, '0'));
    }
    i += 2;
  }
  return out;
}

function extractAllTags(text: string, tag: string): string[] {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A tag's value runs until the NEXT tag or the end of the block -- not merely
  // to the first newline. JSDoc in this repo wraps long `@covers` lists across
  // lines, and stopping at the first newline read only line one, so every AC on
  // a continuation line was reported uncovered.
  const regex = new RegExp('@' + escapedTag + '\\s+([\\s\\S]*?)(?=\\n\\s*\\*\\s*@|\\n\\s*\\*\\/|$)', 'g');
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    // Split on commas AND whitespace: this repo uses both `@covers A, B` and
    // `@covers A B`, and commas alone dropped every id in the spaced form.
    const items1 = match[1]!
      .replace(/\n\s*\*?/g, ' ')
      .split(/[,\s]+/)
      .map(s => s.trim())
      .filter(Boolean);
    results.push(...items1);
  }
  return results;
}

/**
 * Count assertions in a shell/BATS file.
 *
 * Shell has no `expect()`, so the JS patterns all report zero -- and a parsed
 * test with zero assertions drags the data-validity dimension down as if the
 * suite were empty. These are the constructs that actually fail a BATS test.
 */
function countBashAssertions(content: string): number {
  const patterns = [
    // `[ ... ]` as a statement OR as a guard (`[ x ] || { ... }`, `[ x ] && ...`).
    // Requiring the bracket to be the last thing on the line counted zero for
    // every `[ ... ] || { echo ...; return 1; }` guard, which is how most BATS
    // assertions in this repo are written — those files then looked assertion-
    // free and were reported as low-quality tests.
    /^[ \t]*\[[^\]\n]*\](?:[ \t]*(?:\|\||&&).*)?$/gm,
    /^[ \t]*\[\[[^\]\n]*\]\](?:[ \t]*(?:\|\||&&).*)?$/gm,
    /assert_(?:success|failure|output|line|equal|not_equal|regex|file_exists)/g,
    /grep\s+-[qa-z]*q/g,
  ];
  let count = 0;
  for (const pattern of patterns) {
    const matches = content.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

function countAssertions(content: string): number {
  // Count common assertion patterns.
  //
  // #702: the JUnit 5 family was absent, so a parsed Java test would have been
  // recorded as zero-assertion — the same "detector that never fires" shape as
  // the missing branch itself. A test with assertions that reports 0 is worse
  // than no test at all: it drags the coverage dimension down without any hint
  // that the number is unmeasured.
  const patterns = [
    /expect\(/g,
    /assert\./g,
    /assert\(/g,
    /\.should\./g,
    /expect\./g,
    /toEqual\(/g,
    /toBe\(/g,
    // JUnit 5 / Jupiter assertions (Java, Kotlin). Matched by the assert-prefix
    // family rather than an enumeration of every overload, so assertAll,
    // assertThat, assertThrows, assertDoesNotThrow etc. are all counted.
    /\bassert[A-Z]\w*\s*\(/g,
    // AssertJ fluent style, common in the same test suites.
    /\bassertThat\s*\(/g,
    // Node's own `assert` module and assert-like guards. `throw new Error` is how
    // the script-style suites under plugins/*/skills signal a failed expectation;
    // counting only framework assertions made those suites look assertion-free.
    /\bassert\.(?:ok|equal|strictEqual|deepEqual|notEqual|throws|fail)\s*\(/g,
    /throw\s+new\s+(?:Error|AssertionError)\s*\(/g,
  ];
  let count = 0;
  for (const pattern of patterns) {
    const matches = content.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

/**
 * Given a content string and the index where the test callback arrow/function
 * begins (the position of `() =>` or `function() {`), scan forward with brace
 * matching to return the full callback body (including the outer braces).
 * Skips single/double quoted strings, backtick template literals, and line/block
 * comments so braces inside them do not throw off matching.
 */
function extractCallbackBody(content: string, callbackStart: number): string {
  // Find the opening brace of the callback body after `() => {` / `function() {`.
  let i = callbackStart;
  let inLineComment = false;
  let inBlockComment = false;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let depth = 0;
  let started = false;
  let openIdx = -1;

  while (i < content.length) {
    const c = content[i];
    const n = content[i + 1];

    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && n === '/') { inBlockComment = false; i += 2; continue; }
      i++;
      continue;
    }
    if (inSingle) {
      if (c === '\\') { i += 2; continue; }
      if (c === '\'') inSingle = false;
      i++;
      continue;
    }
    if (inDouble) {
      if (c === '\\') { i += 2; continue; }
      if (c === '"') inDouble = false;
      i++;
      continue;
    }
    if (inTemplate) {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') inTemplate = false;
      // Template `${}` interpolation can contain braces; treat interpolation
      // content conservatively by not toggling depth on braces inside it.
      i++;
      continue;
    }

    if (c === '/' && n === '/') { inLineComment = true; i += 2; continue; }
    if (c === '/' && n === '*') { inBlockComment = true; i += 2; continue; }
    if (c === '\'') { inSingle = true; i++; continue; }
    if (c === '"') { inDouble = true; i++; continue; }
    if (c === '`') { inTemplate = true; i++; continue; }

    if (c === '{') {
      if (!started) { started = true; openIdx = i; depth = 1; }
      else depth++;
      i++;
      continue;
    }
    if (c === '}') {
      depth--;
      if (depth === 0) {
        return content.slice(openIdx, i + 1);
      }
      i++;
      continue;
    }

    i++;
  }

  // No balanced body found — the declaration had no callback body (e.g. a
  // `test.todo('name');` line). Return an empty body so it counts 0 assertions.
  return '';
}

/**
 * Extract JSDoc block preceding a test/it/describe declaration, along with the
 * *function body* of the callback (so assertion counting is per-test, not
 * per-file). Handles .skip(), .todo(), .only() variants and backtick template
 * literals.
 *
 * Known limitation (pre-existing, not introduced by #392): `test.each([...])`
 * parameterised forms are NOT matched, because the argument list is a bracketed
 * array literal and the name string follows it without a comma. This means such
 * tests are omitted from assertion counting. Coverage determination itself is
 * driven by `@covers` tags, so this only affects the avg-assertions data-validity
 * heuristic, never AC coverage. Tracked separately from #392.
 */
/**
 * A JSDoc block counts as a per-test annotation only when it carries `@test`.
 *
 * Without this guard any doc comment above an `it()` was treated as a test
 * record -- including blocks whose `@covers` lists plain function names. Those
 * records then suppressed the file-level fallback below, so the file's real
 * annotation never got read and every case looked like it was missing
 * `@intent`. Only `@test` makes a block a test annotation.
 */
const ANNOTATED_JSDOC = /@test\s+REQ-/;

/** The `@test REQ-...` tag of a JSDoc block, or undefined when absent. */
const REQ_TAG = /@test\s+(REQ-[A-Z0-9]+(?:-[A-Z0-9]+)*)/;

/**
 * First annotation pass: `test.each([...])('name', () => { ... })`.
 *
 * `.each` variants carry an extra argument list before the name string, so they
 * need their own pattern. The callback open paren ends the match, which lets the
 * body be recovered by brace matching.
 */
const TEST_PATTERN_WITH_ARGS = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/(?:[\s\n]*)(?:test|it|describe)(?:\.(?:each|skip|todo|only))?\s*\([^)]*\)\s*,\s*\(\s*(?:['"]([^'"]+)['"]|`([^`]*)`)\s*\)?\s*,?\s*(?:\([^)]*\)\s*=>)?\s*/g;

/**
 * Second annotation pass: plain `test('name', () => { ... })` and `.skip` /
 * `.todo` / `.only` forms, which have no preceding argument list.
 */
const TEST_PATTERN_PLAIN = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/(?:[\s\n]*)(?:test|it|describe)(?:\.(?:skip|todo|only))?\s*\(\s*(?:['"]([^'"]+)['"]|`([^`]*)`)\s*\)?\s*,?\s*(?:\([^)]*\)\s*=>)?\s*/g;

/** A test record recovered from one JSDoc block. */
interface TestAnnotation {
  jsdoc: string;
  testBody: string;
  testName: string;
}

/**
 * Run one annotation-scanning pass and append every annotated match to
 * `results`.
 *
 * `dedupe` is required rather than always-on because the two passes have
 * different contracts: the first pass must not drop a legitimate second test
 * that repeats an identical doc block, while the second pass re-finds everything
 * the first pass already matched. Only the second pass may skip.
 */
function collectAnnotatedTests(
  content: string,
  pattern: RegExp,
  results: TestAnnotation[],
  dedupe: boolean,
): void {
  // The patterns are module-level `/g` regexes, so lastIndex survives between
  // calls: reset it, otherwise a caller that returns early would leave the scan
  // resuming mid-file and silently miss annotations.
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const jsdoc = match[1]!;
    const testName = match[2] || match[3] || '';
    if (!testName || !ANNOTATED_JSDOC.test(jsdoc)) continue;
    if (dedupe && results.some(r => r.jsdoc === jsdoc)) continue;
    const declaration = content.slice(match.index, match.index + match[0].length);
    // JSDoc + declaration + function body gives a self-contained test body.
    const testBody = declaration + extractCallbackBody(content, match.index + match[0].length);
    results.push({ jsdoc, testBody, testName });
  }
}

/**
 * Decide whether the file-level block adds something the per-test records do
 * not already say.
 *
 * The header is redundant only when a per-test record already carries BOTH its
 * REQ and every AC it lists. Comparing the REQ alone was wrong: a file whose
 * header covers AC-1..AC-5 while one case below happens to name the same REQ for
 * its own AC-9 lost the header, and AC-1..AC-5 were reported uncovered even
 * though the file is annotated for them.
 */
function needsFileLevelRecord(header: string, results: TestAnnotation[]): boolean {
  const headerReq = header.match(REQ_TAG)?.[1];
  const headerAcs = expandAcCovers(extractAllTags(header, 'covers'));
  const coveredReqs = new Set(results.map(r => r.jsdoc.match(REQ_TAG)?.[1]).filter(Boolean));
  const coveredAcs = new Set(results.flatMap(r => expandAcCovers(extractAllTags(r.jsdoc, 'covers'))));
  const reqMissing = !headerReq || !coveredReqs.has(headerReq);
  const acsMissing = headerAcs.some(ac => !coveredAcs.has(ac));
  return results.length === 0 || reqMissing || acsMissing;
}

function extractJSDocBeforeTest(content: string, sourcePath?: string): TestAnnotation[] {
  const results: TestAnnotation[] = [];

  collectAnnotatedTests(content, TEST_PATTERN_WITH_ARGS, results, false);
  collectAnnotatedTests(content, TEST_PATTERN_PLAIN, results, true);

  // File-level block: the dominant convention in this repo is ONE `@test` /
  // `@covers` block at the top of the file with plain `it('...')` calls below
  // it. The passes above only see an annotation that sits immediately before a
  // test, so such a file would yield nothing there.
  //
  // The block is added in TWO situations, and the difference matters:
  //   - no per-test annotation was found at all -> the block is the only record
  //     for this file;
  //   - per-test annotations exist, but the block's own `@test` names a REQ none
  //     of them carry -> the block covers something the cases do not (e.g. a
  //     module-level REQ plus per-case ACs). Dropping it reported that REQ as
  //     having no test even though the file is annotated for it.
  const fileLevelJsdoc = extractFileLevelJsdoc(content);
  if (fileLevelJsdoc && needsFileLevelRecord(fileLevelJsdoc, results)) {
    // One record for the whole file, NOT one per `it()`. The block annotates
    // the file rather than each case; a record per test made every case
    // without its own `@intent` look unannotated (2448 false findings).
    results.push({
      jsdoc: fileLevelJsdoc,
      testBody: content,
      testName: sourcePath || 'file-level',
    });
  }

  return results;
}

/**
 * The leading JSDoc block of a file, if it carries an @test tag.
 *
 * Only a block that appears before any executable code counts as file-level:
 * a trailing doc comment must not retroactively annotate the whole file.
 *
 * @param content - Full file contents
 * @returns The block's inner text, or null when there is no leading annotated block
 */
/**
 * Matches the leading JSDoc block, skipping any preceding `//` lines.
 *
 * The pattern is assembled as a string rather than a regex literal: the
 * literal form puts `*` + `/` next to each other in the source, which any
 * doc-comment scanner (including this module) reads as a comment terminator.
 * One of the seven defects found here was exactly that confusion, so the
 * source is written to be unambiguous to a reader.
 */
const FILE_LEVEL_JSDOC = new RegExp(
'^(?:#![^\\n]*\\n)?(?:(?:[ \\t]*\\/\\/[^\\n]*\\n)|(?:[ \\t]*\\n))*[ \\t]*\\/\\*\\*([\\s\\S]*?)\\*\\/',
);

/**
 * A leading JS import block, which a file-level annotation may follow.
 *
 * Several files put `import ...` first and the `@test` / `@covers` block after
 * it. Requiring the block to be line 1 made those files parse as unannotated.
 * Only `import`/`from`/`require` lines are tolerated -- an annotation must still
 * precede any executable statement, otherwise a doc comment further down would
 * retroactively annotate the whole file.
 */
const IMPORT_PRELUDE_LINE = /^(?:import\b[^;]*?;|import\b[^;]*?from\s*['"][^'"]*['"];?|const\s+\w+\s*=\s*require\([^)]*\);?|from\s+\w+\s+import\b.*?)$/;

/**
 * Drop a leading run of import / require statements (and blank lines between
 * them), leaving the rest of the file untouched.
 *
 * Used only to let a file-level annotation follow the imports; anything other
 * than an import line stops the strip, so the annotation can never move past an
 * executable statement.
 */
function stripLeadingImports(content: string): string {
  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (line === '') {
      i++;
      continue;
    }
    if (IMPORT_PRELUDE_LINE.test(line)) {
      i++;
      continue;
    }
    break;
  }
  return lines.slice(i).join('\n');
}


function extractFileLevelJsdoc(content: string): string | null {
  // Leading `//` lines are skipped: .cjs files in this repo often open with
  // `// vitest globals: true` before the annotation block.
  const jsdoc = content.match(FILE_LEVEL_JSDOC);
  if (jsdoc && /@test\s+REQ-/.test(jsdoc[1] || '')) return jsdoc[1] || null;

  // An annotation that follows a leading import block still describes the file:
  // the imports are not executable statements in the sense that matters here.
  const afterImports = stripLeadingImports(content);
  if (afterImports !== content) {
    const shifted = afterImports.match(FILE_LEVEL_JSDOC);
    if (shifted && /@test\s+REQ-/.test(shifted[1] || '')) return shifted[1] || null;
  }

  // Shell-family files (.bats, .sh) annotate with leading `#` comments rather
  // than a JSDoc block. Without this arm every BATS test file -- 177 of them
  // carrying 119 distinct REQ tags -- was invisible, and its requirements were
  // reported as having no test at all.
  // Blank lines are allowed INSIDE the block: these headers carry a long
  // `@intent` with paragraph breaks before `@covers`, and stopping at the
  // first blank line dropped the `@covers` for every such file.
  const hashHeader = content.match(/^(?:#![^\n]*\n)?(?:[ \t]*#[^\n]*\n|[ \t]*\n)+/);
  if (hashHeader) {
    const block = hashHeader[0].replace(/^#![^\n]*\n/, '');
    if (/@test\s+REQ-/.test(block)) return block;
  }

  return null;
}

/**
 * Extract a Python test function body: from the `def test_xxx():` line up to
 * (but not including) the next top-level `def ` line or end of file. This keeps
 * assertion counting scoped to the individual test.
 */
function extractPythonTestBody(content: string, defIndex: number): string {
  const nextDef = content.indexOf('\ndef ', defIndex);
  const endIdx = nextDef === -1 ? content.length : nextDef;
  return content.slice(defIndex, endIdx);
}

/**
 * Extract a Go test function body via brace matching starting at the opening
 * brace that follows `func Test_xxx()`. Returns the full `{ ... }` block.
 */
function extractGoTestBody(content: string, funcIndex: number): string {
  const braceIdx = content.indexOf('{', funcIndex);
  if (braceIdx === -1) return '';
  return extractCallbackBody(content, braceIdx);
}

/**
 * Body of a Java test method, from its opening brace (#702).
 *
 * Assertions are counted against the per-test body, not the whole file, for the
 * same reason as the Go/Python paths: a file-level count multiplies assertions
 * by the number of tests in the file (#392-#1).
 *
 * Java has no multi-line lambda-less ambiguity here — a method body is the
 * brace-delimited block that follows the parameter list — so the same brace
 * scan used for Go is sufficient.
 */
function extractJavaTestBody(content: string, methodIndex: number): string {
  const braceIdx = content.indexOf('{', methodIndex);
  if (braceIdx === -1) return '';
  return extractCallbackBody(content, braceIdx);
}

function pushTestWithCovers(
  tests: TestCase[],
  testPath: string,
  name: string,
  reqId: string,
  intent: string | undefined,
  fileContent: string,
  bodyContent: string,
  totalAssertionsRef: { value: number },
) {
  const coversRegex = /@covers\s+(.+)/g;
  const covers: string[] = [];
  let coversMatch: RegExpExecArray | null;
  while ((coversMatch = coversRegex.exec(fileContent)) !== null) {
    // Trailing lowercase letter is legal: the spec carries ids like
    // `AC-670-19b`, added when an AC was split without renumbering.
    covers.push(...expandAcCovers(coversMatch[1]!.split(',').map(s => s.trim())));
  }

  // Count assertions against the *per-test body*, not the whole file, so
  // totalAssertions is not inflated by fileCount x perFileCount (#392-#1).
  const assertions = countAssertions(bodyContent);
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
  const unsupportedFiles: string[] = [];

  for (const testPath of testPaths) {
    if (!fs.existsSync(testPath)) continue;

    // Normalise CRLF before parsing. This repo checks out with `core.autocrlf`
    // on Windows, so a `.bats` header ends its lines with `\r\n`; the `#`-block
    // matcher then stopped after the shebang and every such file parsed as
    // unannotated. Line-oriented regexes must see one line ending, not two.
    const content = fs.readFileSync(testPath, 'utf8').replace(/\r\n/g, '\n');
    const ext = path.extname(testPath);

    // `.cjs` / `.mjs` carry the same syntax as `.js` and are used by this
    // repo's own script tests (44 and 2 files). They were in neither the
    // supported nor the unsupported list, so those files were dropped without a
    // trace -- a test file the checker cannot see is indistinguishable from a
    // test that does not exist.
    const isJSLike = ['.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs'].includes(ext);
    if (isJSLike) {
      const matches = extractJSDocBeforeTest(content, testPath);

      for (const m of matches) {
        // Five files in this repo fold the rationale into the `@test` line as
        // `@test REQ-X intent: ...` instead of using a separate `@intent` tag.
        // Without this fallback they were reported as having no intent at all.
        const inlineIntent = m.jsdoc.match(/@test[^\n]*?\bintent:\s*([^\n]*(?:\n[ \t]*[^\n*@][^\n]*)*)/);
        const intentValue = extractAllTags(m.jsdoc, 'intent').join(' ').trim()
          || (inlineIntent ? inlineIntent[1]!.replace(/\s*\n\s*/g, ' ').trim() : '');
        const coversRaw = extractAllTags(m.jsdoc, 'covers');
        const covers = expandAcCovers(coversRaw);

        // A block may name several requirements (`@test REQ-705, REQ-707`).
        // Taking only the first left every other REQ in the list looking
        // untested even though the same code was covered by the same tests.
        const reqIds = Array.from(
          new Set((m.jsdoc.match(/@test\s+([^\n*]+)/)?.[1] || '').match(/REQ-[A-Z0-9]+(?:-[A-Z0-9]+)*/g) || []),
        );

        const assertions = countAssertions(m.testBody);
        totalAssertionsObj.value += assertions;

        for (const reqId of reqIds.length ? reqIds : [undefined]) {
          tests.push({
            name: m.testName,
            file: testPath,
            requirementId: reqId,
            intent: intentValue || undefined,
            covers,
            edgeCases: [],
            assertions,
          });
        }
      }
    } else if (ext === '.py') {
      const pyTestPattern = /(# @test\s+(REQ-[A-Z0-9]+(?:-[A-Z0-9]+)*)[\s\S]*?)(?:# @intent\s+(.+?)\n)?def\s+(test_\w+)/g;
      let m: RegExpExecArray | null;
      while ((m = pyTestPattern.exec(content)) !== null) {
        const body = extractPythonTestBody(content, m.index + m[0].lastIndexOf('def '));
        pushTestWithCovers(tests, testPath, m[4]!, m[2]!, m[3]?.trim(), content, body, totalAssertionsObj);
      }
    } else if (ext === '.go') {
      const goTestPattern = /(\/\/ @test\s+(REQ-[A-Z0-9]+(?:-[A-Z0-9]+)*))\s*[\s\S]*?func\s+(Test_\w+)/g;
      let m: RegExpExecArray | null;
      while ((m = goTestPattern.exec(content)) !== null) {
        const block = content.slice(Math.max(0, m.index - 500), m.index);
        const intentMatch = block.match(/\/\/ @intent\s+(.+)/);
        const funcStart = m.index + m[0].lastIndexOf('func ');
        const body = extractGoTestBody(content, funcStart);
        pushTestWithCovers(tests, testPath, m[3]!, m[2]!, intentMatch?.[1]?.trim(), content, body, totalAssertionsObj);
      }
    } else if (ext === '.java') {
      // #702: JUnit 5 annotations are matched against the Javadoc block that
      // precedes the method, because that is where this project's @test/@intent
      // contract lives.
      //
      // Two phases rather than one regex, because the Javadoc may sit above the
      // class declaration (`class Foo { @Test void a() {...} }`) or directly
      // above the method. Scanning forward from the end of each Javadoc for the
      // first `@Test` and then for the method name handles both without the
      // fragile "skip N tokens" shape that a single expression needs.
      const javaDocPattern = /\/\*\*([\s\S]*?)\*\//g;
      let docMatch: RegExpExecArray | null;
      while ((docMatch = javaDocPattern.exec(content)) !== null) {
        const docBlock = docMatch[1]!;
        const reqMatch = docBlock.match(/@test\s+(REQ-[A-Z0-9]+(?:-[A-Z0-9]+)*)/);
        // Without a requirement tag this is not an annotated test in this
        // project's sense; skip it rather than inventing a TestCase.
        if (!reqMatch) continue;

        const afterDoc = docMatch.index + docMatch[0].length;
        const rest = content.slice(afterDoc);
        const testAnnotation = rest.match(/@Test\b/);
        if (!testAnnotation) continue;

        // Method name = the identifier right before the first `(` after @Test.
        const afterAnnotation = rest.slice(testAnnotation.index! + '@Test'.length);
        const nameMatch = afterAnnotation.match(/\b(\w+)\s*\(/);
        if (!nameMatch) continue;

        const intentMatch = docBlock.match(/@intent\s+(.+)/);
        const methodStart = afterDoc + testAnnotation.index! + afterAnnotation.indexOf(nameMatch[1]!);
        const body = extractJavaTestBody(content, methodStart);
        pushTestWithCovers(
          tests, testPath, nameMatch[1]!, reqMatch[1]!, intentMatch?.[1]?.trim(),
          content, body, totalAssertionsObj,
        );
      }
    } else if (ext === '.bats' || ext === '.sh') {
      // BATS bodies are shell; the annotation contract is the same `# @test` /
      // `# @intent` / `# @covers` header used everywhere else in this repo.
      const batsDoc = extractFileLevelJsdoc(content);
      if (batsDoc) {
        const header = batsDoc;
        const reqMatch = header.match(/@test\s+(REQ-[A-Z0-9]+(?:-[A-Z0-9]+)*)/);
        const intentMatch = header.match(/@intent\s+([\s\S]*?)(?=\n[ \t]*#?[ \t]*@|$)/);
        // Same inline form as the JS branch: `# @test REQ-X intent: ...`.
        const inlineIntent = header.match(/@test[^\n]*?\bintent:\s*([\s\S]*?)(?=\n[ \t]*#?[ \t]*@|\n[ \t]*#\s*$|$)/);
        const intentValue = (intentMatch ? intentMatch[1]!.replace(/\n[ \t]*#?/g, ' ').trim() : '')
          || (inlineIntent ? inlineIntent[1]!.replace(/\n[ \t]*#?/g, ' ').trim() : '');
        const coversRaw = extractAllTags(header, 'covers');

        if (reqMatch) {
          const covers = expandAcCovers(coversRaw);
          const assertions = countBashAssertions(content);
          totalAssertionsObj.value += assertions;
          tests.push({
            name: testPath,
            file: testPath,
            requirementId: reqMatch[1],
            intent: intentValue || undefined,
            covers,
            edgeCases: [],
            assertions,
          });
        }
      }
    } else if (UNSUPPORTED_TEST_EXTENSIONS.includes(ext)) {
      // Recognised as a test file, but no parser exists. Recording it is the
      // whole point: previously this arm did not exist, so the file vanished
      // and the caller could not tell "no tests" from "tests I could not read".
      unsupportedFiles.push(testPath);
    }
  }

  return {
    tests,
    totalTests: tests.length,
    totalAssertions: totalAssertionsObj.value,
    unsupportedFiles,
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

  // The file-level intent, so per-group blocks can inherit it (see Rule 3).
  const intentByFile = new Map<string, string>();
  for (const test of testMap.tests) {
    if (test.intent && !intentByFile.has(test.file)) {
      intentByFile.set(test.file, test.intent);
    }
  }

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
  const totalEdgeCases = 0;

  for (const req of specMap.requirements) {
    allReqIds.add(req.id);
    for (const acId of req.acceptanceCriteria) {
      allAcIds.add(acId);
    }
  }

  // Rule 1: Each REQ must have a test (Critical)
  //
  // "Has a test" is satisfied either by naming the REQ in `@test` OR by covering
  // one of its acceptance criteria. A file that pins AC-718-01..03 under a
  // broader `@test REQ-439` really does test REQ-718; reporting the requirement
  // as untested while its criteria are covered is contradictory, and it punished
  // exactly the annotation style this repo uses for follow-up issues.
  const reqsWithCoveredAc = new Set<string>();
  for (const req of specMap.requirements) {
    if (req.acceptanceCriteria.some(ac => coveredAcIds.has(ac))) {
      reqsWithCoveredAc.add(req.id);
    }
  }
  for (const reqId of allReqIds) {
    if (!coveredReqIds.has(reqId) && !reqsWithCoveredAc.has(reqId)) {
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
  //
  // A per-group `@test` / `@covers` block inside a file whose HEADER already
  // states the intent is not a missing annotation: the header annotates the
  // file, and the inner blocks only narrow the AC. Reporting those cases
  // demanded the same sentence be repeated on every `describe`.
  for (const test of testMap.tests) {
    if (!test.intent || test.intent.trim().length === 0) {
      const inherited = intentByFile.get(test.file);
      if (inherited && inherited.trim().length > 0) continue;
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

/**
 * Write the alignment report, recording (not throwing) a write failure.
 *
 * This is the LAST step of runFullAlignment — after the spec is parsed and every
 * test file is scanned. Letting a write error escape discards all of that work
 * and turns a reportable condition (disk full, read-only mount, permission
 * denied) into a crashed command with no report at all. The report schema
 * already carries an `errors` array for exactly this kind of condition.
 *
 * @returns true when the file was written, false when the failure was recorded.
 */
export function writeReport(report: TestAlignmentReportFile, outputPath: string): boolean {
  try {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    report.errors.push(`Failed to write report to ${outputPath}: ${reason}`);
    process.stderr.write(`⚠️  Failed to write alignment report to ${outputPath}: ${reason}
`);
    return false;
  }
}

// ============================================================================
// Orchestrator: runFullAlignment()
// ============================================================================

/**
 * Whether a file name looks like a test file (#702).
 *
 * There were TWO silent gates, and fixing only the parser would have left the
 * outer one closed: this walker previously matched only
 * `\.(test|spec)\.(ts|tsx|js|jsx|py|go)$`. A JUnit file is conventionally
 * `ProbeTest.java` — no `.test.` infix at all — so it was excluded before
 * parseTestFiles ever saw it, and no amount of parser work could help.
 *
 * Two accepted shapes:
 *  - the JS/Python convention:  `<name>.test.<ext>` / `<name>.spec.<ext>`
 *  - the Java/C#/Kotlin convention: `*Test.<ext>` / `*Tests.<ext>` / `*Spec.<ext>`
 *
 * Both are matched against the same extension lists as the parser, so a file
 * can never be collected but unparseable, or parseable but never collected.
 */
function isTestFileName(name: string): boolean {
  const ext = path.extname(name);
  // `.bats` files ARE tests by definition -- BATS only runs test suites. Many in
  // this repo use a descriptive name (`issue-602-gate6-java-architecture.bats`)
  // with no `.test.` infix, and requiring the infix silently excluded them.
  if (ext === '.bats') return true;
  const knownExt = SUPPORTED_TEST_EXTENSIONS.includes(ext) || UNSUPPORTED_TEST_EXTENSIONS.includes(ext);
  if (!knownExt) return false;
  if (/\.(test|spec)\.[^.]+$/.test(name)) return true;
  // Java convention: the class name carries the marker, not the file name infix.
  return /(?:Test|Tests|Spec)\.[^.]+$/.test(name);
}

export interface AlignmentOptions {
  specPath: string;
  testDirs?: string[];
  headCommit?: string;
  outputPath?: string;
}

export function runFullAlignment(options: AlignmentOptions): TestAlignmentReportFile {
  // Default to the repo root rather than a hard-coded list of top-level test
  // directories. The old list (`tests`, `test`, `__tests__`, `src/__tests__`)
  // matched NONE of this repo's test files -- they live in per-module
  // `__tests__` folders such as `src/principles/__tests__/` and
  // `src/npm-package/lib/__tests__/`. With no test files discovered, every REQ
  // and AC was reported as uncovered (854 findings), which read as 854 missing
  // tests but was really one wrong default.
  const { specPath, testDirs = ['.'], headCommit, outputPath } = options;

  // Step 1: Parse spec
  let spec: SpecificationMap;
  try {
    spec = parseSpecification(specPath);
  } catch (e) {
    return {
      alignment_status: 'BLOCKED',
      phase: 0,
      score: 0,
      head_commit: headCommit || 'unknown',
      spec_hash: '',
      timestamp: new Date().toISOString(),
      misaligned_tests: [],
      anti_pattern_detected: false,
      errors: [`Failed to parse specification: ${e instanceof Error ? e.message : String(e)}`],
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
          if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
            walkDir(fullPath);
          } else if (entry.isFile() && isTestFileName(entry.name)) {
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

  // #702: files that were recognised as tests but could not be parsed must not
  // leave the report looking complete. Without this, `totalTests: 0` from a
  // pure-Java project is indistinguishable from "this project has no tests",
  // and the score is computed over an empty set while the status reads "ran".
  const unsupportedErrors = testMap.unsupportedFiles.map(
    file => `Test file not parsed (no parser for ${path.extname(file)}): ${file}`,
  );
  // A project whose ONLY test files are unparsed is the worst case: the report
  // would otherwise be a confident verdict about nothing at all.
  const noParsedTestsAtAll = testMap.totalTests === 0 && testMap.unsupportedFiles.length > 0;
  // Unparsed files make the score untrustworthy even when it happens to be
  // high, so they block PASS rather than merely being annotated.
  const canPass = score >= 80 && testMap.unsupportedFiles.length === 0;

  const report: TestAlignmentReportFile = {
    alignment_status: canPass ? 'PASS' : 'FAIL',
    phase: canPass ? 2 : 1,
    score,
    head_commit: headCommit || 'unknown',
    spec_hash: specHash,
    timestamp: new Date().toISOString(),
    misaligned_tests: alignmentReport.issues.map(issue => ({
      test_name: issue.testId || 'unknown',
      spec_requirement: issue.requirementId || 'unknown',
      gap: issue.message,
    })),
    anti_pattern_detected: noParsedTestsAtAll,
    errors: unsupportedErrors,
  };

  // Step 5: Write output. A failure is recorded on `report.errors` by writeReport
  // rather than thrown — the caller still gets the analysis it just paid for.
  if (outputPath) {
    writeReport(report, outputPath);
  }

  return report;
}
