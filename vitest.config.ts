import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: ['src/_wip/**', 'node_modules/**', '.opencode/**', '.omo/**', '.worktrees/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      exclude: [
        'src/_wip/**',
        'node_modules/**',
        'src/mutation/**',
        'dashboard/**',
        'src/npm-package/bin/**',
        '**/*.test.ts',
        '**/*.test.js',
        '**/__tests__/**',
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