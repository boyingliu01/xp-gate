import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['src/_wip/**', '**/node_modules/**', '.opencode/**', '.omo/**', '.worktrees/**', '.stryker-tmp/**', 'plugins/**', 'src/npm-package/plugins/**'],
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