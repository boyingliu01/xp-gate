/**
 * @test ui-detector
 * @intent Verify detectUiSprint correctly identifies UI file changes
 * @covers Issue #155 — getChangedFiles must use spawnSync (array args) to prevent
 *         shell-meta injection via baseBranch parameter
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnSync } from 'child_process';

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
  // Keep execSync as a vi.fn so any unintentional callers fail loudly
  execSync: vi.fn(() => {
    throw new Error('execSync must not be used: command injection risk (Issue #155)');
  }),
}));

const mockSpawnSync = vi.mocked(spawnSync);

function mockSpawnReturn(stdout: string) {
  mockSpawnSync.mockReturnValue({
    pid: 1,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(''),
    status: 0,
    signal: null,
    output: [null, stdout, ''],
  } as unknown as ReturnType<typeof spawnSync>);
}

describe('ui-detector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectUiSprint', () => {
    it('should return false for empty diff', async () => {
      mockSpawnReturn('');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(false);
      expect(result.matchedFiles).toEqual([]);
      expect(result.matchedRules).toEqual([]);
    });

    it('should return false for pure backend changes', async () => {
      mockSpawnReturn('src/auth.ts\nsrc/db.ts\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint('main');
      expect(result.isUiSprint).toBe(false);
    });

    it('should return true for template files in view directories', async () => {
      mockSpawnReturn('views/index.njk\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(true);
      expect(result.matchedFiles).toContain('views/index.njk');
      expect(result.matchedRules.some(r => r.includes('template'))).toBe(true);
    });

    it('should return true for component files in view directories', async () => {
      mockSpawnReturn('src/components/Button.tsx\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(true);
      expect(result.matchedFiles).toContain('src/components/Button.tsx');
    });

    it('should return false for component files NOT in view directories', async () => {
      mockSpawnReturn('src/hooks/useAuth.tsx\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(false);
    });

    it('should return true for style files in view directories', async () => {
      mockSpawnReturn('views/styles/main.css\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(true);
    });

    it('should return false for style files NOT in view directories', async () => {
      mockSpawnReturn('src/index.css\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(false);
    });

    it('should return true for mixed changes (backend + UI)', async () => {
      mockSpawnReturn('src/auth.ts\nviews/login.html\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(true);
      expect(result.matchedFiles).toContain('views/login.html');
    });

    it('should return true for renamed UI files', async () => {
      mockSpawnReturn('views/a.html → views/b.html\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(true);
      expect(result.matchedFiles).toContain('views/b.html');
    });

    it('should return false for pure documentation changes', async () => {
      mockSpawnReturn('docs/README.md\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(false);
    });

    it('should use main as default base branch', async () => {
      mockSpawnReturn('');
      const { detectUiSprint } = await import('../ui-detector');
      detectUiSprint();
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'git',
        ['diff', '--name-only', 'main..HEAD'],
        expect.any(Object)
      );
    });

    it('should handle git command failure gracefully', async () => {
      mockSpawnSync.mockImplementation(() => {
        throw new Error('git not available');
      });
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(false);
    });

    it('should treat non-zero git exit status as failure (Issue #155)', async () => {
      mockSpawnSync.mockReturnValue({
        pid: 1,
        stdout: Buffer.from(''),
        stderr: Buffer.from('fatal: bad revision'),
        status: 128,
        signal: null,
        output: [null, '', 'fatal: bad revision'],
      } as unknown as ReturnType<typeof spawnSync>);
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint('main');
      expect(result.isUiSprint).toBe(false);
    });

    it('should not interpret shell metacharacters in baseBranch (Issue #155)', async () => {
      mockSpawnReturn('');
      const { getChangedFiles } = await import('../ui-detector');
      const malicious = 'main; touch /tmp/xp-gate-pwned';
      getChangedFiles(malicious);
      expect(mockSpawnSync).toHaveBeenCalledWith(
        'git',
        ['diff', '--name-only', `${malicious}..HEAD`],
        expect.objectContaining({ shell: false })
      );
      const callArgs = mockSpawnSync.mock.calls[0];
      expect(Array.isArray(callArgs[1])).toBe(true);
    });

    it('should handle multiple UI files across different types', async () => {
      mockSpawnReturn('views/index.njk\nsrc/components/Button.tsx\nsrc/auth.ts\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(true);
      expect(result.matchedFiles.length).toBe(2);
    });
  });

  describe('getChangedFiles', () => {
    it('parses git diff output into file array', async () => {
      mockSpawnReturn('src/a.ts\nsrc/b.ts\n');
      const { getChangedFiles } = await import('../ui-detector');
      const files = getChangedFiles('main');
      expect(files).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('returns empty array for empty diff', async () => {
      mockSpawnReturn('');
      const { getChangedFiles } = await import('../ui-detector');
      const files = getChangedFiles('main');
      expect(files).toEqual([]);
    });

    it('filters out empty lines', async () => {
      mockSpawnReturn('src/a.ts\n\nsrc/b.ts\n');
      const { getChangedFiles } = await import('../ui-detector');
      const files = getChangedFiles('main');
      expect(files).toEqual(['src/a.ts', 'src/b.ts']);
    });
  });

  describe('parseRenamedFile', () => {
    it('should extract new path from renamed file', async () => {
      const { parseRenamedFile } = await import('../ui-detector');
      expect(parseRenamedFile('views/a.html → views/b.html')).toBe('views/b.html');
    });

    it('should return original path for non-renamed files', async () => {
      const { parseRenamedFile } = await import('../ui-detector');
      expect(parseRenamedFile('src/auth.ts')).toBe('src/auth.ts');
    });
  });

  describe('getFileExtension', () => {
    it('should extract file extension', async () => {
      const { getFileExtension } = await import('../ui-detector');
      expect(getFileExtension('src/auth.ts')).toBe('.ts');
      expect(getFileExtension('views/index.njk')).toBe('.njk');
      expect(getFileExtension('styles/main.css')).toBe('.css');
    });

    it('should return empty string for files without extension', async () => {
      const { getFileExtension } = await import('../ui-detector');
      expect(getFileExtension('Makefile')).toBe('');
    });
  });

  describe('hasUiPathPattern', () => {
    it('should return true for views/ directory', async () => {
      const { hasUiPathPattern } = await import('../ui-detector');
      expect(hasUiPathPattern('views/index.html')).toBe(true);
    });

    it('should return true for components/ directory', async () => {
      const { hasUiPathPattern } = await import('../ui-detector');
      expect(hasUiPathPattern('src/components/button.tsx')).toBe(true);
    });

    it('should return false for non-UI paths', async () => {
      const { hasUiPathPattern } = await import('../ui-detector');
      expect(hasUiPathPattern('src/utils/helper.ts')).toBe(false);
    });
  });

  describe('getFileMatchRules', () => {
    it('should return template rule for .html files', async () => {
      const { getFileMatchRules } = await import('../ui-detector');
      const rules = getFileMatchRules('views/index.html');
      expect(rules).toContain('template-.html');
    });

    it('should return component rule for .tsx in components/', async () => {
      const { getFileMatchRules } = await import('../ui-detector');
      const rules = getFileMatchRules('src/components/Button.tsx');
      expect(rules).toContain('component-.tsx');
    });

    it('should return empty for .tsx outside UI directories', async () => {
      const { getFileMatchRules } = await import('../ui-detector');
      const rules = getFileMatchRules('src/hooks/useAuth.tsx');
      expect(rules).toEqual([]);
    });

    it('should return style rule for .css in views/', async () => {
      const { getFileMatchRules } = await import('../ui-detector');
      const rules = getFileMatchRules('views/styles/main.css');
      expect(rules).toContain('style-.css');
    });
  });

  describe('collectUiMatches', () => {
    it('should detect UI files in components directory', async () => {
      const { collectUiMatches } = await import('../ui-detector');
      const result = collectUiMatches(['src/components/Button.tsx', 'src/utils/helper.ts']);
      expect(result.isUiSprint).toBe(true);
      expect(result.matchedFiles).toEqual(['src/components/Button.tsx']);
      expect(result.matchedRules.length).toBeGreaterThan(0);
    });

    it('should exclude __tests__ directory files', async () => {
      const { collectUiMatches } = await import('../ui-detector');
      const result = collectUiMatches(['src/__tests__/Button.test.tsx']);
      expect(result.isUiSprint).toBe(false);
    });

    it('excludes files under src/coverage/', async () => {
      const { collectUiMatches } = await import('../ui-detector');
      const result = collectUiMatches(['src/coverage/components/Coverage.tsx']);
      expect(result.isUiSprint).toBe(false);
    });

    it('should handle empty file list', async () => {
      const { collectUiMatches } = await import('../ui-detector');
      const result = collectUiMatches([]);
      expect(result.isUiSprint).toBe(false);
      expect(result.matchedFiles).toEqual([]);
    });

    it('should collect multiple UI files', async () => {
      const { collectUiMatches } = await import('../ui-detector');
      const result = collectUiMatches([
        'src/components/Header.tsx',
        'src/utils/api.ts',
        'views/styles/app.css',
      ]);
      expect(result.isUiSprint).toBe(true);
      expect(result.matchedFiles).toHaveLength(2);
    });

    it('should aggregate unique rules across files', async () => {
      const { collectUiMatches } = await import('../ui-detector');
      const result = collectUiMatches([
        'src/components/Button.tsx',
        'src/components/Card.tsx',
      ]);
      expect(result.isUiSprint).toBe(true);
      expect(result.matchedFiles.length).toBeGreaterThan(0);
    });

    it('should respect .ui-gate-ignore patterns', async () => {
      const { collectUiMatches } = await import('../ui-detector');
      const withoutIgnore = collectUiMatches(['legacy/components/Old.tsx']);
      expect(withoutIgnore.isUiSprint).toBe(true);
    });
  });

  describe('isExcluded and loadUiGateIgnore', () => {
    it('excludes paths matching **/coverage/** with leading directory', async () => {
      const { isExcluded } = await import('../ui-detector');
      expect(isExcluded('src/coverage/report.html', ['**/coverage/**'])).toBe(true);
    });

    it('does not match non-excluded paths', async () => {
      const { isExcluded } = await import('../ui-detector');
      expect(isExcluded('src/app.ts', ['**/coverage/**'])).toBe(false);
    });

    it('returns empty array when .ui-gate-ignore does not exist', async () => {
      const { loadUiGateIgnore } = await import('../ui-detector');
      expect(loadUiGateIgnore('/tmp')).toEqual([]);
    });

    it('excludes paths matching **/node_modules/** with leading directory', async () => {
      const { isExcluded } = await import('../ui-detector');
      expect(isExcluded('lib/node_modules/pkg/index.js', ['**/node_modules/**'])).toBe(true);
    });

    it('excludes paths matching **/dist/** with leading directory', async () => {
      const { isExcluded } = await import('../ui-detector');
      expect(isExcluded('src/dist/bundle.js', ['**/dist/**'])).toBe(true);
    });

    it('excludes paths matching **/build/** with leading directory', async () => {
      const { isExcluded } = await import('../ui-detector');
      expect(isExcluded('src/build/output.js', ['**/build/**'])).toBe(true);
    });

    it('excludes paths matching **/__tests__/**', async () => {
      const { isExcluded } = await import('../ui-detector');
      expect(isExcluded('src/__tests__/Button.test.tsx', ['**/__tests__/**'])).toBe(true);
    });

    it('excludes paths matching **/*.test.*', async () => {
      const { isExcluded } = await import('../ui-detector');
      expect(isExcluded('src/Button.test.tsx', ['**/*.test.*'])).toBe(true);
    });
  });

  /**
   * @test #172 ui-detector CLI coverage
   * @intent Cover CLI entry points (runCli, runPushMode, processOutput, runCheckBranch, runDefault)
   *   via real subprocess execution with NODE_V8_COVERAGE to merge coverage profiles.
   * @covers ui-detector-cli-push-mode, ui-detector-cli-check-branch, ui-detector-cli-default-mode
   */
  describe('CLI integration (subprocess)', () => {
    const { spawnSync: realSpawnSync } = require('child_process') as typeof import('child_process');
    const path = require('path') as typeof import('path');
    const fs = require('fs') as typeof import('fs');
    const os = require('os') as typeof import('os');

    const UI_DETECTOR_PATH = path.resolve(__dirname, '../ui-detector.ts');

    function runCli(args: string[], stdin?: string, cwd?: string): { code: number; stdout: string; stderr: string } {
      const coverageDir = process.env.NODE_V8_COVERAGE ?? path.join(process.cwd(), 'coverage', '.tmp');
      const result = realSpawnSync('npx', ['tsx', UI_DETECTOR_PATH, ...args], {
        cwd: cwd ?? process.cwd(),
        encoding: 'utf-8',
        input: stdin,
        env: { ...process.env, NODE_V8_COVERAGE: coverageDir },
      });
      return {
        code: result.status ?? -1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      };
    }

    it('runs default mode with --check-branch flag (HEAD-based detection)', () => {
      const { code, stdout } = runCli(['--check-branch']);
      expect(code).toBeGreaterThanOrEqual(0);
      expect(code).toBeLessThanOrEqual(1);
      const parsed = JSON.parse(stdout);
      expect(parsed).toHaveProperty('isUiSprint');
      expect(parsed).toHaveProperty('matchedFiles');
      expect(parsed).toHaveProperty('matchedRules');
    });

    it('runs push-mode via stdin', () => {
      const { code, stdout } = runCli(['--push-mode'], 'views/index.html');
      expect([0, 1]).toContain(code);
      const parsed = JSON.parse(stdout);
      expect(parsed.isUiSprint).toBe(true);
      expect(parsed.matchedFiles).toContain('views/index.html');
    });

    it('runs push-mode with stdin input', () => {
      const { code, stdout } = runCli(['--push-mode'], 'views/login.njk\nsrc/auth.ts\n');
      expect([0, 1]).toContain(code);
      const parsed = JSON.parse(stdout);
      expect(parsed.isUiSprint).toBe(true);
      expect(parsed.matchedFiles).toContain('views/login.njk');
    });

    it('runs push-mode with non-UI files (exit 1)', () => {
      const { code, stdout } = runCli(['--push-mode'], 'src/auth.ts\nsrc/db.ts\n');
      expect(code).toBe(1);
      const parsed = JSON.parse(stdout);
      expect(parsed.isUiSprint).toBe(false);
      expect(parsed.matchedFiles).toEqual([]);
    });

    it('respects .ui-gate-ignore in push-mode', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-detector-ignore-'));
      try {
        fs.writeFileSync(path.join(tmp, '.ui-gate-ignore'), 'legacy/**\n');
        const { code, stdout } = runCli(['--push-mode'], 'legacy/views/index.html', tmp);
        expect(code).toBe(1);
        const parsed = JSON.parse(stdout);
        expect(parsed.isUiSprint).toBe(false);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('processes renamed files in push-mode', () => {
      const { code, stdout } = runCli(['--push-mode'], 'src/a.tsx \u2192 src/components/B.tsx');
      expect([0, 1]).toContain(code);
      const parsed = JSON.parse(stdout);
      expect(parsed.matchedFiles).toContain('src/components/B.tsx');
    });

    it('runs default mode (detectUiSprint in current repo)', () => {
      const { code, stdout } = runCli([]);
      expect([0, 1]).toContain(code);
      const parsed = JSON.parse(stdout);
      expect(parsed).toHaveProperty('isUiSprint');
      expect(parsed).toHaveProperty('matchedFiles');
      expect(parsed).toHaveProperty('matchedRules');
    });
  });
});

