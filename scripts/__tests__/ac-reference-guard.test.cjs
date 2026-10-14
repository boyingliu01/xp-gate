/**
 * AC-483-01 (issue #483): spec↔test reference integrity guard.
 *
 * Full-repo measurement during R3/R4: 97 AC references across test files
 * were NOT in specification.yaml, spread over 22 REQs. The R4 architecture
 * seat warned (MJ-02): opening the issue WITHOUT a guard in the same
 * change would repeat the 6ebbd5a incident — a guard that exists but
 * never runs, while the gap silently rots.
 *
 * This guard IS the first deliverable: it freezes the existing debt in a
 * baseline (which may only shrink) and fails the moment any NEW AC
 * reference appears in a test without a matching acceptance_criteria id
 * in specification.yaml. Runs on the `npm test` (vitest) path.
 *
 * Baseline policy (AC-483-02): entries are removed by follow-up batches
 * that either add the AC to the spec or fix the reference. The guard
 * passes when observed ⊆ baseline — new debt is always red, paying down
 * debt is green (then the baseline file is shrunk in the same commit).
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..', '..');
const SPEC = path.join(ROOT, 'specification.yaml');
const BASELINE = path.join(__dirname, 'ac-reference-baseline.json');

// Test corpus: every directory where AC references are written as code.
const TEST_GLOBS = [
  'scripts/__tests__',
  'src/npm-package/lib/__tests__',
  'src/__tests__',
  'githooks/__tests__',
];
const EXTS = new Set(['.ts', '.js', '.cjs', '.mjs', '.bats']);
const AC_PATTERN = /\bAC-[A-Za-z0-9]+-\d{2}\b/g;

function walkTests(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkTests(p, out);
    else if (EXTS.has(path.extname(e.name))) out.push(p);
  }
  return out;
}

function specAcIds() {
  const doc = yaml.load(fs.readFileSync(SPEC, 'utf8'));
  const ids = new Set();
  for (const req of doc.specification.requirements || []) {
    for (const ac of req.acceptance_criteria || []) {
      if (ac && ac.id) ids.add(ac.id);
    }
  }
  return ids;
}

describe('AC-483: spec↔test reference integrity (#483)', () => {
  let specIds;
  let observed; // Map file -> [ac refs not in spec]
  let baseline;

  beforeAll(() => {
    specIds = specAcIds();
    observed = new Map();
    for (const dir of TEST_GLOBS) {
      for (const file of walkTests(path.join(ROOT, dir), [])) {
        const text = fs.readFileSync(file, 'utf8');
        const refs = [...new Set([...text.matchAll(AC_PATTERN)].map((m) => m[0]))]
          .filter((ref) => !specIds.has(ref))
          .sort();
        if (refs.length > 0) {
          observed.set(path.relative(ROOT, file).split(path.sep).join('/'), refs);
        }
      }
    }
    baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  });

  it('the corpus actually scanned (anti-vacuity)', () => {
    expect(specIds.size).toBeGreaterThan(10);
  });

  it('no NEW AC reference outside the frozen baseline (incremental guard)', () => {
    const newDebt = [];
    for (const [file, refs] of observed) {
      const known = new Set(baseline.files[file] || []);
      for (const ref of refs) {
        if (!known.has(ref)) newDebt.push(`${file}: ${ref}`);
      }
    }
    expect(newDebt).toEqual([]);
  });

  it('the baseline file only names references that still exist (no ghost debt)', () => {
    // Baseline entries pointing at references that have disappeared (fixed
    // in a pay-down batch) must be REMOVED from the baseline in the same
    // commit — stale baseline entries would make the incremental guard
    // accept regressions into already-fixed files.
    const ghost = [];
    for (const [file, refs] of Object.entries(baseline.files)) {
      const now = new Set(observed.get(file) || []);
      for (const ref of refs) {
        if (!now.has(ref)) ghost.push(`${file}: ${ref}`);
      }
    }
    expect(ghost).toEqual([]);
  });
});
