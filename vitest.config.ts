import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Fails the run if the suite itself writes into the work tree (#428 symptom B).
    // Paths already dirty when the run started are excluded, so this never blames a
    // developer's uncommitted work for what a test did.
    globalSetup: ['./scripts/vitest-worktree-guard.cjs'],
    // The `src/npm-package/` tree is a byte-identical MIRROR of canonical
    // sources, and 58 of its test files are byte-identical to their siblings in
    // `src/`. Collecting both ran every mirrored test twice, which is the bulk
    // of the pre-commit runtime regression (#418) and the direct cause of the
    // Stryker dry run failing (a symlinked-context test inside the mirror cannot
    // run on Windows). Only the mirrored subdirectories are excluded -- `lib/`
    // and `plugins/` hold tests that exist NOWHERE else, so excluding the whole
    // tree would silently delete real coverage.
    exclude: [
      'src/_wip/**', '**/node_modules/**', '.opencode/**', '.omo/**', '.worktrees/**',
      '.stryker-tmp/**', '.xp-gate/**', 'dist/**', 'coverage/**',
      // Mirrors of `plugins/`, `skills/`, and the four src subtrees.
      // `plugins/dsh/` is deliberately absent from this list (#569). It is the
      // canonical source of the DSH plugin, and its 10 test files are
      // byte-identical to the `src/npm-package/plugins/dsh/` mirror — which IS
      // excluded. Excluding both sides left 88 tests collected by nobody:
      // measured, the full suite collected 0 files under `plugins/dsh/`, while
      // those same files run in isolation are 10/10 files, 88/88 tests green in
      // 2.6s. A plugin with no test protection is the same shape as a coverage
      // threshold that was never applied (#562): the safety net exists, wired to
      // nothing. Only `plugins/dsh` is kept, so `plugins/opencode/node_modules`
      // and the other vendored trees stay out.
      'plugins/*/node_modules/**',
      'skills/**',
      'src/npm-package/plugins/**', 'src/npm-package/skills/**',
      'src/npm-package/principles/**', 'src/npm-package/mutation/**',
      'src/npm-package/mock-policy/**', 'src/npm-package/build-integrity/**',
      // Written for `node --test`, and already run by `npm run test:design-evidence`.
      // Under vitest it collects zero tests ("No test suite found in file") and
      // fails the run -- a red build caused by a test that never ran, which is the
      // exact confusion this file's own suite is built to prevent. The other
      // node:test files here (execution-surface-contract, gate-identity-*,
      // generated-mirror-reproducibility) DO run correctly under vitest, so they
      // stay collected; excluding them by pattern would silently drop real
      // coverage. Only this one is runner-specific.
      'scripts/__tests__/check-design-evidence.test.cjs',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      // TWO MEASUREMENT HAZARDS, both cost real time here.
      //
      // 1. A single-file run (`vitest run path/x.test.js --coverage`) OVERWRITES
      //    coverage/ with a report naming only the files that test loaded. Always
      //    regenerate with a full run before quoting a number.
      //
      // 2. At least one large file reports code its tests demonstrably execute as
      //    uncovered. Measured 2026-11-24 on language-tools.js: a stderr write
      //    compiled into planToolRepairs fired in 3 workers of a full run, while
      //    coverage-final.json reported 0 of its 77 statements. The cause was not
      //    found; what was ruled out: duplicate module instances (one entry
      //    path), stale data (regenerated from an empty directory), and unloaded
      //    files (every file has non-zero coverage).
      //
      //    CAUSE FOUND 2026-11-24 (round 49): a full run reports language-tools.js
      //    at 50.0% (527/1054), while the same file measured with the 21 test files
      //    that load it reports 97.24% (1025/1054). The gap is the whole file size,
      //    not a rounding artefact -- the full run appears to record the file
      //    without merging the worker coverage that actually exercised it. Checked
      //    and NOT causative: duplicate module entry points (only one file exists),
      //    `delete require.cache` in tests (those tests alone still measure 97.24%),
      //    fs mocks (none), and the same treatment for rework.js and
      //    gate-coverage.js (both match their full-run numbers exactly).
      //
      //    VERIFIED ACROSS THE TREE 2026-11-24 (round 50): every file of 300+ lines
      //    (47 of them) was re-measured with the tests that reference it. Exactly TWO
      //    disagree with the full run:
      //
      //      language-tools.js   50.0% reported  ->  97.24% measured  (+47.2)
      //      gate-runner.js      87.8% reported  ->  97.9%  measured  (+10.1)
      //
      //    The other 45 match to within 5 points, so this is NOT a general provider
      //    flaw and the per-file numbers are usable elsewhere.
      //
      //    CONSEQUENCE: the aggregate UNDER-reports. Corrected for those two files:
      //
      //      reported  43648 / 48793 = 89.46%
      //      corrected 44292 / 48793 = 90.78%   (the 90% line is 43,914 lines)
      //
      //    Re-run the same check before quoting the corrected figure; the correction
      //    is only as good as the re-measurement behind it.
      //
      //    So do not read a per-file number on a large file as evidence about its
      //    tests. Check whether tests exist, and instrument if it matters. The
      //    aggregate moves in the right direction; individual large files are not
      //    trustworthy.
      //
      // NOTE for anyone reading coverage numbers: a single-file run
      // (`vitest run path/to/x.test.js --coverage`) OVERWRITES
      // coverage/coverage-summary.json with a report that only mentions the
      // files that one test loaded. Measured 2026-11-24: a one-test probe turned
      // the reported total from 87.28% into 3.74%, and reading that file
      // afterwards looks exactly like the repo lost its coverage. Always
      // regenerate with a full run before quoting a number.
      // #562: `plugins/` was inside `include`'s complement, so 4340 lines of
      // canonical plugin source were never measured -- while 28 test files and 225
      // tests already exercise them and pass. Measured in isolation those sources
      // sit at 83.8% lines, far ABOVE the repo's 60% floor. Excluding a
      // well-covered tree from the average is how a coverage number stops
      // describing the codebase and starts describing the config.
      include: ['src/**/*.{ts,js}', 'plugins/**/*.ts'],
      exclude: [
        'src/_wip/**',
        'src/mutation/**',
        'src/npm-package/bin/**',
        'src/npm-package/plugins/**',
        'src/npm-package/scripts/**',
        'src/npm-package/adapters/**',
        'src/npm-package/hooks/**',
        // #562 (follow-up): the mirror subtrees the TEST exclude above already names.
        // `src/npm-package/<sub>/` is a byte-identical copy of `src/<sub>/`, and the
        // COPY can never be covered: the tests import the canonical path, so v8 sees
        // the mirror as 0%. Measured, those copies are 11688 lines at 0.00% -- they
        // dragged the reported total from 82.77% down to 62.19%. That is not a
        // coverage problem to be fixed by writing tests; no test can ever touch these
        // files. Two lists describing the same mirror must not drift.
        'src/npm-package/principles/**',
        // Listed in test.exclude above but missing here -- the exact drift the
        // comment warns about. Measured 2026-11-24: 12 mirror files at 0.00%,
        // 2,813 statements, pulling the reported total from 87.23% to 82.30%.
        'src/npm-package/mutation/**',
        // Currently holds no .ts/.js, so it moves no number today; listed anyway
        // because these two lists must not drift, and the next file added there
        // would otherwise be measured at 0% without anyone noticing.
        'src/npm-package/skills/**',
        'src/npm-package/gates/**',
        'src/npm-package/build-integrity/**',
        'src/npm-package/architecture/**',
        'src/npm-package/mock-policy/**',
        '**/*.test.ts',
        '**/*.test.js',
        '**/__tests__/**',
        // `.spec.` was recognised as a test everywhere EXCEPT here: gate 5a's own
        // detection regex is \.(test|spec)\.(ts|tsx|js|...)$, so a `foo.spec.ts`
        // satisfied the "this source file has a test" rule while its own lines
        // were measured as production code. The repo contains zero `.spec.` files
        // today, which is exactly why nothing has gone wrong yet -- and why the
        // first person to use that naming would have deflated the coverage figure
        // with lines no source change could ever cover. Same shape as #562, where
        // 11688 mirror lines at 0% dragged the total from 82.77% to 62.19%.
        // Pinned by githooks/__tests__/coverage-test-exclusion.test.bats, which
        // asserts these two lists agree rather than restating one of them.
        '**/*.spec.ts',
        '**/*.spec.js',
        '**/*.d.ts',
        'node_modules/**',
        '.worktrees/**',
        '.stryker-tmp/**',
        'dashboard/**',
        'plugins/*/skills/**',
        'plugins/*/node_modules/**',
        'githooks/**',
        'skills/**',
        'scripts/**',
        'coverage/**',
        'compat/**',
      ],
      // FLAT, not nested (#561). vitest 1.6.1 types this field as
      // `Partial<Record<Threshold, number>>` — the `thresholds: { global: {...} }`
      // shape is vitest 2.x. An unknown nested key is dropped WITHOUT a warning,
      // so the previous shape turned this whole gate into a no-op: the repo sat
      // at 60.08% lines against a declared 80% and every commit exited 0.
      //
      // The numbers are the measured floor, not the 80% target. Flipping the
      // shape while still at 60% would have blocked every commit outright, which
      // is why the enforcement was restored in this order: pin the behaviour
      // (AC-COV-01/02), set a floor the tree actually clears, then ratchet up.
      // Raise these — never lower them — as REQ-COV work lands. Values are
      // whole numbers below the measured figure so ordinary fluctuation in a
      // single run cannot produce a spurious block.
      //
      // #589: `functions` was declared 83, which broke that rule in the one way
      // that matters — it sat ABOVE the real figure, so it blocked. The number was
      // never verified in CI: at the time #561 landed, Gate 1 was red on every
      // build, so Gate 5 had not executed once since the ratchet was written.
      // Measured on two consecutive CI runs (f722a441, 51931824): functions
      // 81.19%, identical both times — a stable figure, not run-to-run noise.
      // There was no regression: this session added no untested source file.
      // 81 is the floor the tree actually clears. Closing the 2pp gap to 83 is
      // tracked as coverage debt (#589); raise this only together with real tests.
      // #605: these numbers DISAGREE with the pre-commit gate, and the ordering is
      // the bad one -- pre-commit blocks below 80% lines (COVERAGE_THRESHOLD in
      // githooks/pre-commit), while this block passes at 60%. So `npx vitest run`
      // goes green and the commit is then rejected. Until the two are reconciled,
      // `xp-gate gate-coverage` prints the conflict rather than leaving it to be
      // discovered at commit time.
      // #562 (ratchet): lines/statements 60 -> 70 -> 78, functions 83 -> 84,
      // branches 81 -> 81. Each step is a MEASUREMENT, not a target: the number
      // below is what this tree actually reports, rounded down.
      //
      // The old 62% was never the tree's real coverage: 11688 lines of
      // byte-identical mirror copies were counted at 0.00% because the tests import
      // the canonical path and can never touch the copies. Excluding them moved the
      // figure to 82.77%; with the 0.35.15.0 additions it measured 78.80%.
      //
      // Measured on afed8b63 (`--coverage.enabled`, full suite):
      //   lines 78.78% (29637/37619)  statements 78.78% (29637/37619)
      //   functions 84.47% (1126/1333)  branches 81.86% (5453/6661)
      //
      // The 70s left ~8.8pp of headroom, which absorbed exactly the regression
      // this ratchet exists to catch: coverage could fall ten points and still
      // pass. 78 keeps ~0.8pp -- enough that run-to-run fluctuation cannot produce
      // a spurious block, small enough that dropping a mirror subtree (or losing a
      // suite) fails immediately. functions/branches ratchet by the same rule.
      //
      // Still 1.2pp short of the documented 80% target; that remainder is real
      // coverage debt, not a threshold to lower, and stays tracked in #562.
      thresholds: {
        lines: 78,
        statements: 78,
        functions: 84,
        branches: 81,
      },
    },
  },
});
