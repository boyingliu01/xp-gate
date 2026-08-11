/**
 * @test Issues #86 #87 #88 #90 npm package correctness
 * @intent Verify npm-package/package.json produces a valid, installable npm package
 * @covers #86 #87 #88 #90
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pkgDir = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));

// ---------- Issue #90: scoped package name ----------

describe('Issue #90: scoped package name for GitHub/npm compatibility', () => {
  it('package name should be @boyingliu01/xp-gate (scoped)', () => {
    expect(pkg.name).toBe('@boyingliu01/xp-gate');
  });

  it('package name should start with @', () => {
    expect(pkg.name).toMatch(/^@[\w-]+\/[\w-]+$/);
  });
});

// ---------- Issue #86: no broken prepare/postinstall ----------

describe('Issue #86: no broken prepare/postinstall scripts', () => {
  it('should NOT have postinstall script (causes npm global install failure)', () => {
    expect(pkg.scripts?.postinstall).toBeUndefined();
  });

  it('prepare script, if present, should use a path that exists in the published tarball', () => {
    // The prepare script runs during npm install from a git checkout.
    // It should NOT reference paths only available in the repo root (like scripts/ from root).
    // If it does reference scripts/, the script must exist inside the package.
    const prepare = pkg.scripts?.prepare;
    if (prepare) {
      // Extract the script path from the prepare command
      const scriptMatch = prepare.match(/scripts\/(\S+\.sh)/);
      if (scriptMatch) {
        const scriptFile = scriptMatch[1];
        const scriptPath = path.join(pkgDir, 'scripts', scriptFile);
        expect(fs.existsSync(scriptPath)).toBe(true);
      }
    }
  });
});

// ---------- Issue #87: skills in package ----------

describe('Issue #87: skills directory included in published tarball', () => {
  it('"files" should include skills/ or skills/**', () => {
    const files = pkg.files || [];
    const hasSkills = files.some(f => f.startsWith('skills/'));
    expect(hasSkills).toBe(true);
  });

  it('skills/ directory should exist in the package', () => {
    const skillsPath = path.join(pkgDir, 'skills');
    // skills/ may be a directory or a single file
    const exists = fs.existsSync(skillsPath);
    // OR check if sync-package-content.js bundles skills on prepack
    const hasPrepack = pkg.scripts?.prepack?.includes('sync-package-content');
    expect(exists || hasPrepack).toBe(true);
  });
});

// ---------- Issue #88: Claude Code plugin in package ----------

describe('Issue #88: Claude Code plugin included in published tarball', () => {
  it('"files" should include plugins/ or plugins/claude-code/', () => {
    const files = pkg.files || [];
    const hasPlugins = files.some(f => f.startsWith('plugins/') || f === 'plugins/');
    expect(hasPlugins).toBe(true);
  });

  it('plugins/claude-code/ directory should exist or be bundled by prepack', () => {
    const pluginsPath = path.join(pkgDir, 'plugins');
    const exists = fs.existsSync(pluginsPath);
    const hasPrepack = pkg.scripts?.prepack?.includes('sync-package-content');
    expect(exists || hasPrepack).toBe(true);
  });
});

// ---------- Cross-cutting: publishConfig ----------

describe('publishConfig for scoped packages', () => {
  it('scoped packages should have publishConfig.registry pointing to npmjs (not GitHub Packages)', () => {
    if (!pkg.name.startsWith('@')) return;
    const registry = pkg.publishConfig?.registry;
    expect(registry).toMatch(/registry\.npmjs\.org|registry\.npmjs.com/);
    expect(registry).not.toMatch(/github|npm\.pkg\.github/);
  });

  it('scoped packages should have publishConfig.access set to public', () => {
    if (!pkg.name.startsWith('@')) return;
    expect(pkg.publishConfig?.access).toBe('public');
  });
});

describe('published adapter-common.sh', () => {
  it('matches the canonical Git hook adapter helper', () => {
    const canonical = fs.readFileSync(
      path.join(pkgDir, '..', '..', 'githooks', 'adapter-common.sh'),
      'utf8'
    );
    const published = fs.readFileSync(path.join(pkgDir, 'adapter-common.sh'), 'utf8');

    expect(published).toBe(canonical);
    expect(published).toContain('run_without_git_context');
  });
});
