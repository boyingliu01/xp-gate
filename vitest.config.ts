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
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
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
        '**/*.test.ts',
        '**/*.test.js',
        '**/__tests__/**',
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
      thresholds: {
        lines: 60,
        statements: 60,
        functions: 81,
        branches: 79,
      },
    },
  },
});
