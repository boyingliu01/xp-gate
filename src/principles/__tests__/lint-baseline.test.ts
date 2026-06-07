/**
 * @test REQ-152 Baseline-based lint checking
 * @intent Lint baseline engine: parse tool output, diff baselines, manage baseline lifecycle
 * @covers AC-152
 */
import { describe, it, expect } from 'vitest';
import {
  parseLintOutput,
  diffBaselines,
  formatBaselineSummary,
  computeLintDelta,
} from '../lint-baseline';

describe('parseLintOutput', () => {
  it('parses ESLint JSON output into BaselineEntry format', () => {
    const eslintJson = JSON.stringify([
      {
        filePath: '/project/src/app.ts',
        errorCount: 2,
        warningCount: 3,
        messages: [
          { ruleId: 'no-unused-vars', severity: 2 },
          { ruleId: 'no-console', severity: 1 },
        ],
      },
      {
        filePath: '/project/src/utils.ts',
        errorCount: 0,
        warningCount: 1,
        messages: [{ ruleId: 'no-var', severity: 1 }],
      },
    ]);

    const result = parseLintOutput('eslint', eslintJson, ['src/app.ts', 'src/utils.ts']);

    expect(result['src/app.ts']).toBeDefined();
    expect(result['src/app.ts'].eslint).toEqual({ warnings: 3, errors: 2 });
    expect(result['src/app.ts'].totalWarnings).toBe(3);
    expect(result['src/utils.ts'].eslint).toEqual({ warnings: 1, errors: 0 });
    expect(result['src/utils.ts'].totalWarnings).toBe(1);
  });

  it('parses ruff JSON output into BaselineEntry format', () => {
    const ruffJson = JSON.stringify([
      {
        file: 'src/app.py',
        noqa_count: 0,
        cells: [],
        messages: [
          { kind: 'E501', message: 'Line too long' },
          { kind: 'F401', message: 'Unused import' },
        ],
      },
    ]);

    const result = parseLintOutput('ruff', ruffJson, ['src/app.py']);

    expect(result['src/app.py']).toBeDefined();
    expect(result['src/app.py'].ruff).toEqual({ warnings: 2, errors: 0 });
    expect(result['src/app.py'].totalWarnings).toBe(2);
  });

  it('parses golangci-lint JSON output into BaselineEntry format', () => {
    const golangciJson = JSON.stringify({
      Issues: [
        { file: 'src/main.go', line: 10, severity: 'warning', text: 'unused variable' },
        { file: 'src/main.go', line: 20, severity: 'error', text: 'missing error check' },
      ],
    });

    const result = parseLintOutput('golangci', golangciJson, ['src/main.go']);

    expect(result['src/main.go']).toBeDefined();
    expect(result['src/main.go'].golangci).toEqual({ warnings: 1, errors: 1 });
    expect(result['src/main.go'].totalWarnings).toBe(1);
  });

  it('parses shellcheck JSON output into BaselineEntry format', () => {
    const shellcheckJson = JSON.stringify([
      {
        file: 'deploy.sh',
        line: 5,
        level: 'warning',
        message: 'Double quote to prevent globbing',
      },
      {
        file: 'deploy.sh',
        line: 12,
        level: 'error',
        message: 'Missing shebang',
      },
    ]);

    const result = parseLintOutput('shellcheck', shellcheckJson, ['deploy.sh']);

    expect(result['deploy.sh']).toBeDefined();
    expect(result['deploy.sh'].shellcheck).toEqual({ warnings: 1, errors: 1 });
    expect(result['deploy.sh'].totalWarnings).toBe(1);
  });

  it('returns empty baseline for empty tool output', () => {
    expect(parseLintOutput('eslint', '[]', ['a.ts'])).toEqual({});
  });

  it('ignores files not in the target file list', () => {
    const eslintJson = JSON.stringify([
      {
        filePath: '/project/src/ignored.ts',
        errorCount: 5,
        warningCount: 0,
        messages: [{ ruleId: 'no-console', severity: 2 }],
      },
    ]);

    const result = parseLintOutput('eslint', eslintJson, ['src/target.ts']);
    expect(result).toEqual({});
  });
});

describe('diffBaselines', () => {
  it('detects increased lint debt', () => {
    const oldBaseline = {
      'src/app.ts': {
        eslint: { warnings: 2, errors: 0 },
        totalWarnings: 2,
        lastAnalyzed: '2026-01-01T00:00:00Z',
      },
    };
    const newBaseline = {
      'src/app.ts': {
        eslint: { warnings: 5, errors: 1 },
        totalWarnings: 5,
        lastAnalyzed: '2026-06-01T00:00:00Z',
      },
    };

    const diff = diffBaselines(oldBaseline, newBaseline);
    expect(diff.totalWarningsDelta).toBe(3);
    expect(diff.filesIncreased).toHaveLength(1);
    expect(diff.filesIncreased[0].file).toBe('src/app.ts');
    expect(diff.filesIncreased[0].warningsDelta).toBe(3);
    expect(diff.filesDecreased).toHaveLength(0);
    expect(diff.filesUnchanged).toHaveLength(0);
  });

  it('detects decreased lint debt', () => {
    const oldBaseline = {
      'src/app.ts': {
        eslint: { warnings: 5, errors: 0 },
        totalWarnings: 5,
        lastAnalyzed: '2026-01-01T00:00:00Z',
      },
    };
    const newBaseline = {
      'src/app.ts': {
        eslint: { warnings: 2, errors: 0 },
        totalWarnings: 2,
        lastAnalyzed: '2026-06-01T00:00:00Z',
      },
    };

    const diff = diffBaselines(oldBaseline, newBaseline);
    expect(diff.totalWarningsDelta).toBe(-3);
    expect(diff.filesDecreased).toHaveLength(1);
    expect(diff.filesDecreased[0].warningsDelta).toBe(-3);
  });

  it('detects new files added to baseline', () => {
    const oldBaseline = {};
    const newBaseline = {
      'src/new.ts': {
        eslint: { warnings: 1, errors: 0 },
        totalWarnings: 1,
        lastAnalyzed: '2026-06-01T00:00:00Z',
      },
    };

    const diff = diffBaselines(oldBaseline, newBaseline);
    expect(diff.filesAdded).toHaveLength(1);
    expect(diff.filesAdded[0].file).toBe('src/new.ts');
  });

  it('detects files removed from baseline (warnings cleared)', () => {
    const oldBaseline = {
      'src/gone.ts': {
        eslint: { warnings: 3, errors: 0 },
        totalWarnings: 3,
        lastAnalyzed: '2026-01-01T00:00:00Z',
      },
    };
    const newBaseline = {};

    const diff = diffBaselines(oldBaseline, newBaseline);
    expect(diff.filesRemoved).toHaveLength(1);
    expect(diff.filesRemoved[0].file).toBe('src/gone.ts');
  });

  it('reports unchanged files correctly', () => {
    const baseline = {
      'src/stable.ts': {
        eslint: { warnings: 2, errors: 0 },
        totalWarnings: 2,
        lastAnalyzed: '2026-01-01T00:00:00Z',
      },
    };

    const diff = diffBaselines(baseline, { ...baseline });
    expect(diff.filesUnchanged).toHaveLength(1);
    expect(diff.totalWarningsDelta).toBe(0);
  });

  it('computes diff across multiple lint tools', () => {
    const oldBaseline = {
      'src/app.py': {
        ruff: { warnings: 5, errors: 2 },
        totalWarnings: 5,
        lastAnalyzed: '2026-01-01T00:00:00Z',
      },
      'src/main.go': {
        golangci: { warnings: 3, errors: 0 },
        totalWarnings: 3,
        lastAnalyzed: '2026-01-01T00:00:00Z',
      },
    };
    const newBaseline = {
      'src/app.py': {
        ruff: { warnings: 2, errors: 1 },
        totalWarnings: 2,
        lastAnalyzed: '2026-06-01T00:00:00Z',
      },
      'src/main.go': {
        golangci: { warnings: 3, errors: 0 },
        totalWarnings: 3,
        lastAnalyzed: '2026-06-01T00:00:00Z',
      },
    };

    const diff = diffBaselines(oldBaseline, newBaseline);
    expect(diff.filesDecreased).toHaveLength(1);
    expect(diff.filesDecreased[0].file).toBe('src/app.py');
    expect(diff.filesUnchanged).toHaveLength(1);
    expect(diff.totalWarningsDelta).toBe(-3);
  });
});

describe('computeLintDelta', () => {
  it('returns BLOCK if new warnings > baseline warnings', () => {
    const baseline = { eslint: { warnings: 2, errors: 0 }, totalWarnings: 2, lastAnalyzed: '' };
    const current = { eslint: { warnings: 5, errors: 0 }, totalWarnings: 5, lastAnalyzed: '' };
    const result = computeLintDelta(baseline, current);
    expect(result.enforcement).toBe('BLOCK');
    expect(result.newWarnings).toBe(3);
    expect(result.newErrors).toBe(0);
  });

  it('returns PASS if current warnings <= baseline warnings', () => {
    const baseline = { eslint: { warnings: 5, errors: 1 }, totalWarnings: 5, lastAnalyzed: '' };
    const current = { eslint: { warnings: 3, errors: 0 }, totalWarnings: 3, lastAnalyzed: '' };
    const result = computeLintDelta(baseline, current);
    expect(result.enforcement).toBe('PASS');
    expect(result.newWarnings).toBe(0);
    expect(result.reduction).toBe(2);
  });

  it('returns PASS with reduction message when debt decreases', () => {
    const baseline = { eslint: { warnings: 10, errors: 0 }, totalWarnings: 10, lastAnalyzed: '' };
    const current = { eslint: { warnings: 4, errors: 0 }, totalWarnings: 4, lastAnalyzed: '' };
    const result = computeLintDelta(baseline, current);
    expect(result.enforcement).toBe('PASS');
    expect(result.reduction).toBe(6);
  });

  it('handles no baseline (first scan) - always PASS', () => {
    const current = { eslint: { warnings: 10, errors: 2 }, totalWarnings: 10, lastAnalyzed: '' };
    const result = computeLintDelta(null, current);
    expect(result.enforcement).toBe('PASS');
    expect(result.message).toContain('baseline created');
  });

  it('handles empty tool fields gracefully', () => {
    const baseline = { eslint: { warnings: 0, errors: 0 }, totalWarnings: 0, lastAnalyzed: '' };
    const current = { eslint: { warnings: 0, errors: 0 }, totalWarnings: 0, lastAnalyzed: '' };
    const result = computeLintDelta(baseline, current);
    expect(result.enforcement).toBe('PASS');
  });
});

describe('formatBaselineSummary', () => {
  it('returns summary string with file count and warning totals', () => {
    const baseline = {
      'src/a.ts': {
        eslint: { warnings: 3, errors: 1 },
        totalWarnings: 3,
        lastAnalyzed: '2026-06-01T00:00:00Z',
      },
      'src/b.py': {
        ruff: { warnings: 5, errors: 0 },
        totalWarnings: 5,
        lastAnalyzed: '2026-06-01T00:00:00Z',
      },
    };

    const summary = formatBaselineSummary(baseline);
    expect(summary).toContain('2');
    expect(summary).toContain('8');
    expect(summary).toContain('ESLint');
    expect(summary).toContain('Ruff');
  });

  it('returns empty message for empty baseline', () => {
    const summary = formatBaselineSummary({});
    expect(summary).toContain('No baseline');
  });
});
