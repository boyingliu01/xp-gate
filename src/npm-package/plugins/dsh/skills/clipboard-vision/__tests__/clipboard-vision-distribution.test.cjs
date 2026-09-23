/**
 * @test REQ-379 clipboard vision distribution
 * @intent Verify every registry, mirror, and packed artifact includes the canonical skill
 * @covers AC-379-07
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let repoRoot = path.resolve(__dirname, '..');
while (!fs.existsSync(path.join(repoRoot, 'src', 'npm-package', 'lib', 'install-skill.js'))) {
  const parent = path.dirname(repoRoot);
  if (parent === repoRoot) throw new Error('Unable to locate xp-gate repository root');
  repoRoot = parent;
}

describe('clipboard-vision distribution', () => {
  it.each([
    'scripts/build-plugin.mjs',
    'scripts/build-plugin.sh',
    'scripts/test-plugins.mjs',
    'scripts/test-plugins.sh',
    'src/npm-package/scripts/sync-package-content.js',
    'plugins/opencode/scripts/prepack.cjs',
    'src/npm-package/plugins/opencode/scripts/prepack.cjs',
    'src/npm-package/lib/install-skill.js',
  ])('registers clipboard-vision in %s', (relativePath) => {
    expect(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')).toContain('clipboard-vision');
  });

  it.each([
    'src/npm-package/skills/clipboard-vision',
    'plugins/claude-code/skills/clipboard-vision',
    'plugins/opencode/skills/clipboard-vision',
    'plugins/qoder/skills/clipboard-vision',
    'src/npm-package/plugins/claude-code/skills/clipboard-vision',
    'src/npm-package/plugins/opencode/skills/clipboard-vision',
    'src/npm-package/plugins/qoder/skills/clipboard-vision',
  ])('matches canonical files in %s', (relativePath) => {
    for (const file of ['SKILL.md', 'scripts/clipboard-vision.sh', 'scripts/clipboard-vision.ps1']) {
      const canonical = fs.readFileSync(path.join(repoRoot, 'skills', 'clipboard-vision', file));
      expect(fs.readFileSync(path.join(repoRoot, relativePath, file)).equals(canonical)).toBe(true);
    }
  });

  it('includes canonical and plugin paths in the npm tarball', () => {
    const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: path.join(repoRoot, 'src', 'npm-package'), encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    const files = JSON.parse(result.stdout)[0].files.map((entry) => entry.path);
    for (const file of [
      'skills/clipboard-vision/SKILL.md',
      'plugins/claude-code/skills/clipboard-vision/SKILL.md',
      'plugins/opencode/skills/clipboard-vision/SKILL.md',
      'plugins/qoder/skills/clipboard-vision/SKILL.md',
    ]) expect(files).toContain(file);
  });

  it('requires clipboard-vision in the independent sync test registry', () => {
    const content = fs.readFileSync(path.join(repoRoot, 'src/npm-package/scripts/__tests__/sync-package-content.test.js'), 'utf8');
    const start = content.indexOf('const CORE_SKILLS = [');
    expect(content.slice(start, content.indexOf('];', start))).toContain("'clipboard-vision'");
  });
});
