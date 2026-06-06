/**
 * @test ui-detector
 * @intent Verify detectUiSprint correctly identifies UI file changes
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

describe('ui-detector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectUiSprint', () => {
    it('should return false for empty diff', async () => {
      mockExecSync.mockReturnValue('');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(false);
      expect(result.matchedFiles).toEqual([]);
      expect(result.matchedRules).toEqual([]);
    });

    it('should return false for pure backend changes', async () => {
      mockExecSync.mockReturnValue('src/auth.ts\nsrc/db.ts\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint('main');
      expect(result.isUiSprint).toBe(false);
    });

    it('should return true for template files in view directories', async () => {
      mockExecSync.mockReturnValue('views/index.njk\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(true);
      expect(result.matchedFiles).toContain('views/index.njk');
      expect(result.matchedRules.some(r => r.includes('template'))).toBe(true);
    });

    it('should return true for component files in view directories', async () => {
      mockExecSync.mockReturnValue('src/components/Button.tsx\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(true);
      expect(result.matchedFiles).toContain('src/components/Button.tsx');
    });

    it('should return false for component files NOT in view directories', async () => {
      mockExecSync.mockReturnValue('src/hooks/useAuth.tsx\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(false);
    });

    it('should return true for style files in view directories', async () => {
      mockExecSync.mockReturnValue('views/styles/main.css\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(true);
    });

    it('should return false for style files NOT in view directories', async () => {
      mockExecSync.mockReturnValue('src/index.css\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(false);
    });

    it('should return true for mixed changes (backend + UI)', async () => {
      mockExecSync.mockReturnValue('src/auth.ts\nviews/login.html\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(true);
      expect(result.matchedFiles).toContain('views/login.html');
    });

    it('should return true for renamed UI files', async () => {
      mockExecSync.mockReturnValue('views/a.html → views/b.html\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(true);
      expect(result.matchedFiles).toContain('views/b.html');
    });

    it('should return false for pure documentation changes', async () => {
      mockExecSync.mockReturnValue('docs/README.md\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(false);
    });

    it('should use main as default base branch', async () => {
      mockExecSync.mockReturnValue('');
      const { detectUiSprint } = await import('../ui-detector');
      detectUiSprint();
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('git diff --name-only main..HEAD'),
        expect.any(Object)
      );
    });

    it('should handle git command failure gracefully', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('git not available');
      });
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(false);
    });

    it('should handle multiple UI files across different types', async () => {
      mockExecSync.mockReturnValue('views/index.njk\nsrc/components/Button.tsx\nsrc/auth.ts\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(true);
      expect(result.matchedFiles.length).toBe(2);
    });
  });

  describe('getChangedFiles', () => {
    it('parses git diff output into file array', async () => {
      mockExecSync.mockReturnValue('src/a.ts\nsrc/b.ts\n');
      const { getChangedFiles } = await import('../ui-detector');
      const files = getChangedFiles('main');
      expect(files).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('returns empty array for empty diff', async () => {
      mockExecSync.mockReturnValue('');
      const { getChangedFiles } = await import('../ui-detector');
      const files = getChangedFiles('main');
      expect(files).toEqual([]);
    });

    it('filters out empty lines', async () => {
      mockExecSync.mockReturnValue('src/a.ts\n\nsrc/b.ts\n');
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
});
