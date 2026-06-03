/**
 * @test detect-deps
 * @intent Verify checkDeps() correctly detects missing/present/outdated dependencies
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('detect-deps', () => {
  let tmpHome;
  let originalHome;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-detect-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../detect-deps')];
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function makeSkillDir(skillName, contents = {}) {
    const dir = path.join(tmpHome, '.config', 'opencode', 'skills', skillName);
    fs.mkdirSync(dir, { recursive: true });
    if (contents.packageJson) {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(contents.packageJson));
    }
    if (contents.skillMd) {
      fs.writeFileSync(path.join(dir, 'SKILL.md'), contents.skillMd);
    }
    return dir;
  }

  function makeOpencodeDir(skillName, contents = {}) {
    const dir = path.join(tmpHome, '.config', 'opencode', skillName);
    fs.mkdirSync(dir, { recursive: true });
    if (contents.packageJson) {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(contents.packageJson));
    }
    if (contents.skillMd) {
      fs.writeFileSync(path.join(dir, 'SKILL.md'), contents.skillMd);
    }
    return dir;
  }

  it('returns ok:false missing:superpowers when no deps exist', async () => {
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(false);
    expect(result.missing).toBe('superpowers');
  });

  it('returns ok:false missing:gstack when superpowers exists but gstack missing', async () => {
    makeSkillDir('superpowers', { packageJson: { version: '2.0.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(false);
    expect(result.missing).toBe('gstack');
  });

  it('returns ok:true when both deps exist via package.json with adequate version', async () => {
    makeSkillDir('superpowers', { packageJson: { version: '2.0.0' } });
    makeSkillDir('gstack', { packageJson: { version: '1.5.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(true);
  });

  it('returns ok:true when deps exist in fallback OPENCODE_DIR path', async () => {
    makeOpencodeDir('superpowers', { packageJson: { version: '1.0.0' } });
    makeOpencodeDir('gstack', { packageJson: { version: '1.0.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(true);
  });

  it('returns ok:true when version read from SKILL.md frontmatter', async () => {
    makeSkillDir('superpowers', { skillMd: 'version: "2.1.0"\n---\nSkill content' });
    makeSkillDir('gstack', { skillMd: 'version: "1.2.3"\n---\nSkill content' });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(true);
  });

  it('reads version from SKILL.md without quotes', async () => {
    makeSkillDir('superpowers', { skillMd: 'version: 2.1.0\n' });
    makeSkillDir('gstack', { skillMd: 'version: 1.0.0\n' });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(true);
  });

  it('returns versionMismatch when superpowers version < minVersion', async () => {
    makeSkillDir('superpowers', { packageJson: { version: '0.0.1' } });
    makeSkillDir('gstack', { packageJson: { version: '2.0.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(false);
    expect(result.versionMismatch).toEqual({
      name: 'superpowers',
      required: '1.0.0',
      found: '0.0.1',
    });
  });

  it('returns versionMismatch when gstack version < minVersion', async () => {
    makeSkillDir('superpowers', { packageJson: { version: '2.0.0' } });
    makeSkillDir('gstack', { packageJson: { version: '0.5.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(false);
    expect(result.versionMismatch.name).toBe('gstack');
    expect(result.versionMismatch.found).toBe('0.5.0');
  });

  it('passes when version is exactly equal to minVersion', async () => {
    makeSkillDir('superpowers', { packageJson: { version: '1.0.0' } });
    makeSkillDir('gstack', { packageJson: { version: '1.0.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(true);
  });

  it('returns ok:true (no version check) when package.json has no version and no SKILL.md', async () => {
    // getSkillVersion returns null → skips version check → ok
    makeSkillDir('superpowers', { packageJson: {} });
    makeSkillDir('gstack', { packageJson: {} });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(true);
  });

  it('handles malformed package.json gracefully (falls through to SKILL.md or null)', async () => {
    const supDir = path.join(tmpHome, '.config', 'opencode', 'skills', 'superpowers');
    fs.mkdirSync(supDir, { recursive: true });
    fs.writeFileSync(path.join(supDir, 'package.json'), '{invalid json');
    fs.writeFileSync(path.join(supDir, 'SKILL.md'), 'version: "2.0.0"\n');
    makeSkillDir('gstack', { packageJson: { version: '1.0.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(true);
  });

  it('returns null version when neither package.json nor SKILL.md exist (skips version check)', async () => {
    // Create empty dirs (no metadata files)
    fs.mkdirSync(path.join(tmpHome, '.config', 'opencode', 'skills', 'superpowers'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tmpHome, '.config', 'opencode', 'skills', 'gstack'), {
      recursive: true,
    });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(true);
  });

  it('returns null when SKILL.md exists but has no version line', async () => {
    makeSkillDir('superpowers', { skillMd: 'no version here\n' });
    makeSkillDir('gstack', { packageJson: { version: '1.0.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    // superpowers version=null → skips version check → ok
    expect(result.ok).toBe(true);
  });

  it('compareVersions handles partial versions (e.g. 1.0 treated as 1.0.0)', async () => {
    // version "1.0" in SKILL.md regex requires X.Y.Z so won't match; use package.json
    makeSkillDir('superpowers', { packageJson: { version: '1' } });
    makeSkillDir('gstack', { packageJson: { version: '1.0.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    // '1' parsed as [1] vs [1,0,0] → equal at index 0; index 1: 0 vs 0; index 2: 0 vs 0 → equal → passes
    expect(result.ok).toBe(true);
  });

  it('compareVersions: greater version passes', async () => {
    makeSkillDir('superpowers', { packageJson: { version: '10.0.0' } });
    makeSkillDir('gstack', { packageJson: { version: '5.5.5' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(true);
  });

  it('compareVersions: minor version less fails', async () => {
    makeSkillDir('superpowers', { packageJson: { version: '0.9.99' } });
    makeSkillDir('gstack', { packageJson: { version: '1.0.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    expect(result.ok).toBe(false);
    expect(result.versionMismatch.found).toBe('0.9.99');
  });

  it('prefers SKILLS_DIR over OPENCODE_DIR when both exist', async () => {
    // Put low version in SKILLS_DIR, high in OPENCODE_DIR
    makeSkillDir('superpowers', { packageJson: { version: '0.0.1' } });
    makeOpencodeDir('superpowers', { packageJson: { version: '2.0.0' } });
    makeSkillDir('gstack', { packageJson: { version: '1.0.0' } });
    const { checkDeps } = require('../detect-deps');
    const result = await checkDeps();
    // Should use SKILLS_DIR (first in possiblePaths) → 0.0.1 fails
    expect(result.ok).toBe(false);
    expect(result.versionMismatch.found).toBe('0.0.1');
  });
});
