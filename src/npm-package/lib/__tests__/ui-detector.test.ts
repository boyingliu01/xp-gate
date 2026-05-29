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

    it('should return true for deleted UI files', async () => {
      mockExecSync.mockReturnValue('views/old.html\n');
      const { detectUiSprint } = await import('../ui-detector');
      const result = detectUiSprint();
      expect(result.isUiSprint).toBe(true);
    });

    it('should handle renamed files correctly', async () => {
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
});
