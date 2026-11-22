#!/usr/bin/env node
/**
 * gate-matrix.cjs — build the gate × language availability matrix from the code.
 *
 * WHY A SCRIPT AND NOT A DOCUMENT
 *
 * Three sources once disagreed about how many languages Gate 4 covers: a
 * hardcoded string in `gate-list` said 9, `src/principles/adapters/` held 14,
 * and a doc said 14. A hand-written matrix is a second source of truth and is
 * the stalest one. This reads the code and prints what it finds, so the numbers
 * cannot drift from the implementation.
 *
 * WHAT IT ANSWERS, PER LANGUAGE
 *
 *   - does Gate 1 have an adapter to lint it?
 *   - does Gate 4 have a principles adapter, and does that adapter DECLARE its
 *     rule coverage (`declaresRuleCoverage`)?  An adapter that does not declare
 *     is analysed but cannot report what it skipped -- the base class defaults
 *     the flag to false, so silence means "unknown", never "complete".
 *   - does the coverage step subsume the test run (`coverage_runs_tests`)?
 *     An adapter that does not declare gets the conservative double-run.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM
 *
 * "Has an adapter" is not "blocks a defect". That second claim belongs to
 * scripts/gate-language-probe.sh, which puts a real defect in front of a gate and
 * requires it to refuse. A matrix cell says a branch exists; the probe says the
 * branch works. Both are printed so the difference stays visible.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** Width of the report banners. Named once so it is not a repeated literal. */
const RULE_WIDTH = 78;
const LANG_ADAPTERS = path.join(ROOT, 'githooks', 'adapters');
const PRINCIPLES_ADAPTERS = path.join(ROOT, 'src', 'principles', 'adapters');

/**
 * Readdir that degrades to an empty list.
 *
 * Every reader in this file answers "what does the code declare", and a missing or
 * unreadable file means "nothing declared" -- which is a real and reportable state,
 * not a reason to abort the whole matrix.
 */
function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** Read a file, returning "" when it cannot be read. */
function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** Language adapters: `<lang>.sh` under githooks/adapters, excluding gate scripts. */
function listLanguageAdapters() {
  // A missing directory is a legitimate state (a trimmed checkout), not a crash.
  if (!fs.existsSync(LANG_ADAPTERS)) return [];
  return safeReaddir(LANG_ADAPTERS)
    .filter((f) => f.endsWith('.sh'))
    // gate-*.sh share this directory with language adapters; the name is what
    // tells them apart, not the location.
    .filter((f) => !/^gate-/.test(f))
    .map((f) => f.replace(/\.sh$/, ''))
    .sort();
}

/** Principles adapters: `<lang>.ts`, excluding the base class. */
function listPrinciplesAdapters() {
  if (!fs.existsSync(PRINCIPLES_ADAPTERS)) return [];
  return safeReaddir(PRINCIPLES_ADAPTERS)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => !/^base\.ts$/.test(f))
    .filter((f) => !/\.test\.ts$/.test(f))
    .map((f) => f.replace(/\.ts$/, ''))
    .sort();
}

/** Whether a shell adapter declares that its coverage step runs the tests. */
function declaresCoverageRunsTests(file) {
  const src = safeRead(file);
  return /^coverage_runs_tests\(\)/m.test(src);
}

/** Whether a shell adapter implements a coverage step at all. */
function hasCoverage(file) {
  const src = safeRead(file);
  return /^run_coverage\(\)/m.test(src);
}

/**
 * Whether the adapter coverage step invokes the test runner itself.
 *
 * This is the only situation in which coverage_runs_tests matters. An adapter
 * whose run_coverage merely reads an existing report does not double-run
 * anything, and showing it as "does not subsume" would overstate the problem --
 * measured on cpp, iac, objectivec, powershell and shell, none of which start a
 * test run.
 */
function coverageInvokesTests(file) {
  const src = safeRead(file);
  const m = src.match(/^run_coverage\(\)[\s\S]*?^\}/m);
  if (!m) return false;
  return /pytest|vitest|jest|go test|dotnet test|mvn[^\n]*test|gradle[^\n]*test|flutter test|phpunit|npm (run )?test/.test(m[0]);
}

/** Whether a principles adapter declares what rules it can actually apply. */
function declaresRuleCoverage(file) {
  const src = safeRead(file);
  return /declaresRuleCoverage\s*(:\s*boolean\s*)?=\s*true/.test(src);
}

function pad(s, n) {
  const str = String(s);
  return str.length >= n ? str : str + ' '.repeat(n - str.length);
}

/** One row per language adapter: what exists, and what it declares. */
function buildRows(langAdapters, principles) {
  const principlesSet = new Set(principles);
  return langAdapters.map((lang) => {
    const file = path.join(LANG_ADAPTERS, `${lang}.sh`);
    const cov = hasCoverage(file);
    return {
      lang,
      gate1: true,
      gate4: principlesSet.has(lang),
      // A principles adapter that cannot be found is not "uncovered by choice";
      // it is a gap the matrix should show.
      gate4Declares: principlesSet.has(lang)
        ? declaresRuleCoverage(path.join(PRINCIPLES_ADAPTERS, `${lang}.ts`))
        : false,
      coverageStep: cov,
      // null = the coverage step does not run the suite, so the declaration is moot.
      coverageSubsumesTests: cov && coverageInvokesTests(file) ? declaresCoverageRunsTests(file) : null,
    };
  });
}

/** Render the table body for the sorted rows. */
/**
 * The scope column: does this language's principles adapter say what it covers?
 * Three states, not two -- "-" means there is no adapter at all, which is a
 * different fact from an adapter that stays silent.
 */
function scopeCell(row) {
  if (!row.gate4) return '-';
  return row.gate4Declares ? 'declared' : 'undeclared';
}

/**
 * The SUBSUMES column. null means the coverage step does not start a test run, so
 * the question does not arise -- shown as n/a, never as NO.
 */
function subsumeCell(row) {
  if (row.coverageSubsumesTests === null) return 'n/a';
  return row.coverageSubsumesTests ? 'yes' : 'NO';
}

function renderTable(rows) {
  return rows.map((r) =>
    `  ${pad(r.lang, 12)}${pad('yes', 8)}${pad(r.gate4 ? 'yes' : 'no', 8)}${pad(scopeCell(r), 11)}${pad(
      r.coverageStep ? 'yes' : 'no',
      10
    )}${subsumeCell(r)}`
  );
}

/** Print the table and the findings derived from it. */
function printReport(langAdapters, principles, rows) {
  console.log('');
  console.log('='.repeat(RULE_WIDTH));
  console.log('  GATE × LANGUAGE AVAILABILITY MATRIX');
  console.log('='.repeat(RULE_WIDTH));
  console.log('');
  console.log(`  ${langAdapters.length} language adapters, ${principles.length} principles adapters`);
  console.log('');
  console.log(
    `  ${pad('LANGUAGE', 12)}${pad('GATE1', 8)}${pad('GATE4', 8)}${pad('G4 SCOPE', 11)}${pad('COVERAGE', 10)}SUBSUMES`
  );
  console.log(`  ${'-'.repeat(11)} ${'-'.repeat(7)} ${'-'.repeat(7)} ${'-'.repeat(10)} ${'-'.repeat(9)} ${'-'.repeat(8)}`);

  for (const line of renderTable(rows)) console.log(line);

  const noPrinciples = rows.filter((r) => !r.gate4).map((r) => r.lang);
  const undeclared = rows.filter((r) => r.gate4 && !r.gate4Declares).map((r) => r.lang);
  const doubleRun = rows.filter((r) => r.coverageStep && r.coverageSubsumesTests === false).map((r) => r.lang);

  console.log('');
  console.log('-'.repeat(RULE_WIDTH));
  console.log('  WHAT THE MATRIX SHOWS');
  console.log('-'.repeat(RULE_WIDTH));
  console.log('');
  console.log(`  Gate 4 has no principles adapter for: ${noPrinciples.join(', ') || '(none)'}`);
  console.log(`  Gate 4 adapter does not declare rule scope: ${undeclared.join(', ') || '(none)'}`);
  console.log(`  Coverage step runs the suite but does not declare it (double run): ${doubleRun.join(', ') || '(none)'}`);
  console.log('');
  console.log('  "n/a" in SUBSUMES means the coverage step does not start a test run, so');
  console.log('  the declaration is irrelevant for that language -- not a finding.');
  console.log('');
  console.log('  "undeclared" means the adapter is analysed but cannot say which rules it');
  console.log('  applies -- base.ts defaults the flag to false, so silence is "unknown",');
  console.log('  not "complete". A green Gate 4 row over such a language is a partial');
  console.log('  verdict and must be read as one.');
  console.log('');
  console.log('  THIS MATRIX SAYS A BRANCH EXISTS, NOT THAT IT WORKS.');
  console.log('  For the second claim run: bash scripts/gate-language-probe.sh');
  console.log('');
}

function main() {
  const langAdapters = listLanguageAdapters();
  const principles = listPrinciplesAdapters();
  printReport(langAdapters, principles, buildRows(langAdapters, principles));
}

main();
