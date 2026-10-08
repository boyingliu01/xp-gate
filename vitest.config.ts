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
      'plugins/**', 'skills/**',
      'src/npm-package/plugins/**', 'src/npm-package/skills/**',
      'src/npm-package/principles/**', 'src/npm-package/mutation/**',
      'src/npm-package/mock-policy/**', 'src/npm-package/build-integrity/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: ['src/**/*.{ts,js}'],
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
        'plugins/**',
        'githooks/**',
        'skills/**',
        'scripts/**',
        'coverage/**',
        'compat/**',
      ],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
  },
});
