/**
 * @test REQ-616
 * @intent Gate 6 reported a **vacuous pass** on a Java project:
 *
 *           architecture_grade: { density: "0.00", level: "Excellent", score: "10.0" }
 *           files_analyzed: 1
 *           total_smells: 0
 *
 *         The project had 140 `.java` files. archlint's detectors are built on an
 *         import graph over a set of JS/TS extensions; `.java` is not among them, so it
 *         analysed 1 file (probably a root `pom.xml`), found no smells in it, and the
 *         grade arithmetic turned "no smells" into "10.0 / Excellent".
 *
 *         Every architecture problem Gate 6 exists to catch — cycles, god modules, dead
 *         code, shotgun surgery — is undetectable on Java, and the report said the
 *         architecture was excellent.
 *
 *         This is the same shape as #589 (Gate 3 permanently SKIP) and #594 (NaN
 *         coverage as PASS): **"did not look" and "looked and found nothing" must be
 *         distinguishable**, and the tool's own confidence must not be copied through
 *         when the tool never looked.
 *
 *         `architecture.yaml` is also never consumed — that part is out of scope here (it
 *         would be a new feature) and is documented as a gap instead of being silently
 *         repaired.
 * @covers AC-616-01, AC-616-02, AC-616-03
 */

const { __internals: arch } = require('../arch.js');

// The reporter's project: 140 .java files, of which archlint analysed exactly one.
const PROJECT_FILE_COUNT = 140;

// A scan that genuinely covered its project.
const COVERED_FILE_COUNT = 42;

// A scan that covered its project and found one high-severity cycle.
const CYCLE_FILE_COUNT = 30;

describe('REQ-616: a scan that analysed nothing must not report 10.0/Excellent', () => {
  /**
   * A scan payload shaped like archlint's: a grade on a tree it barely looked at.
   * `files_analyzed: 1` against a project with 140 `.java` files and no JS/TS.
   */
  function vacuousScanPayload() {
    return JSON.stringify({
      smells: [],
      summary: {
        files_analyzed: 1,
        total_smells: 0,
        architecture_grade: { density: '0.00', level: 'Excellent', score: '10.0' },
      },
    });
  }

  it('AC-616-01: a grade is withheld when the scan covered almost none of the project', () => {
    // The context carries the project's real source-file count: without it there is
    // nothing to compare against, and the case below pins that silence.
    const verdict = arch.verdictFromScanJson(vacuousScanPayload(), { projectFileCount: PROJECT_FILE_COUNT });
    // The parse itself succeeds -- the JSON is valid. What must not survive is the
    // claim that the architecture is excellent.
    expect(verdict.parseError).toBeNull();
    expect(verdict.coverageGap, 'the coverage gap was not detected').toBeTruthy();
    expect(verdict.summary, 'the false grade was copied through').toBeNull();
  });

  it('AC-616-01: with no project size known, the grade is left alone rather than guessed at', () => {
    // The cheap wrong fix is to withhold every grade whose files_analyzed looks small.
    // That would silently change what the tool reports for every caller that has not
    // supplied a count -- and a gate that stops reporting results is worse than one
    // that over-reports.
    const verdict = arch.verdictFromScanJson(vacuousScanPayload());
    expect(verdict.coverageGap).toBeFalsy();
    expect(verdict.summary).toBeTruthy();
  });

  it('AC-616-01: a grade IS reported when the scan covered the project', () => {
    // The control. Withholding every grade would make Gate 6 unable to report a real
    // result, which is a worse failure than the bug: a gate that never has an opinion
    // is a gate people delete.
    const covered = JSON.stringify({
      smells: [],
      summary: {
        files_analyzed: COVERED_FILE_COUNT,
        total_smells: 0,
        architecture_grade: { density: '0.00', level: 'Excellent', score: '10.0' },
      },
    });
    const verdict = arch.verdictFromScanJson(covered, { projectFileCount: COVERED_FILE_COUNT });
    expect(verdict.coverageGap).toBeFalsy();
    expect(verdict.summary).toBeTruthy();
    expect(verdict.summary.architecture_grade.score).toBe('10.0');
  });

  it('AC-616-02: the gap says which language was not analysed, not just that something is wrong', () => {
    // #590's request 2: list the unsupported languages so the score change is
    // traceable. "Something is off" is what the operator can already see.
    const verdict = arch.verdictFromScanJson(vacuousScanPayload(), {
      projectFileCount: PROJECT_FILE_COUNT,
      dominantLanguage: 'java',
    });
    expect(verdict.coverageGap).toBeTruthy();
    expect(String(verdict.coverageGap)).toContain('java');
  });

  it('AC-616-02: the withheld grade is explained, and the explanation names the numbers', () => {
    const verdict = arch.verdictFromScanJson(vacuousScanPayload(), {
      projectFileCount: PROJECT_FILE_COUNT,
      dominantLanguage: 'java',
    });
    const text = String(verdict.coverageGap);
    // The operator needs to see 1 versus 140 to believe it, not just "low coverage".
    expect(text).toMatch(/1/);
    expect(text).toContain(String(PROJECT_FILE_COUNT));
  });

  it('AC-616-03: a genuine grade on a JS/TS project is untouched', () => {
    // archlint works on the languages it has detectors for; nothing here may change
    // what it reports there. Verified by the shape the existing suite already covers.
    const ts = JSON.stringify({
      smells: [{ type: 'cycle', severity: 'high', files: ['a.ts', 'b.ts'] }],
      summary: {
        files_analyzed: CYCLE_FILE_COUNT,
        total_smells: 1,
        architecture_grade: { density: '0.03', level: 'Good', score: '7.5' },
      },
    });
    const verdict = arch.verdictFromScanJson(ts, { projectFileCount: CYCLE_FILE_COUNT, dominantLanguage: 'typescript' });
    expect(verdict.coverageGap).toBeFalsy();
    expect(verdict.blocking).toBe(1);
    expect(verdict.summary.architecture_grade.level).toBe('Good');
  });

  it('AC-616-03: an unparseable report still fails closed rather than becoming a grade question', () => {
    const verdict = arch.verdictFromScanJson('not json at all');
    expect(verdict.parseError).toBeTruthy();
  });
});
