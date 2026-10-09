/**
 * @test REQ-439
 * @intent doctor 判技能新鲜度必须行尾无关：frontmatter 正则只认 LF + 退化分支做
 *         字节比较，导致 autocrlf 工作树下 12/13 个技能被假报 Outdated，真差异
 *         反而被噪声淹没（#439）
 * @covers AC-439-01, AC-439-02, AC-439-03
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('doctor-tui skill freshness (#439)', () => {
  let tmpHome;
  let originalHome;
  // Same dir doctor-tui resolves as PKG_DIR (path.dirname of lib/).
  const bundledSkillsDir = path.join(__dirname, '..', '..', 'skills');

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-fresh-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../doctor-tui')];
    delete require.cache[require.resolve('../shared-paths')];
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  // HOME has no platform marker, so detectPlatform() resolves to opencode.
  function installSkill(name, content) {
    const dir = path.join(tmpHome, '.config', 'opencode', 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
  }

  function readBundled(name) {
    return fs.readFileSync(path.join(bundledSkillsDir, name, 'SKILL.md'), 'utf8');
  }

  /** Same bytes, opposite line endings — the only difference a fresh install can have. */
  function flipLineEndings(content) {
    const lf = content.replace(/\r\n/g, '\n');
    return lf === content ? lf.replace(/\n/g, '\r\n') : lf;
  }

  function runFreshness(name) {
    const { diagnoseInstalledSkills } = require('../doctor-tui');
    const checks = [];
    const issues = diagnoseInstalledSkills({ installedSkills: { [name]: {} } }, checks);
    const check = checks.find(c => c.name === `Skill: ${name}`);
    return { issues, check };
  }

  it('reads a version from CRLF frontmatter, not only LF', () => {
    const { extractSkillVersion } = require('../doctor-tui');
    expect(extractSkillVersion('---\r\nname: x\r\nversion: 2.1.0\r\n---\r\nbody\r\n')).toBe('2.1.0');
    // LF must keep working -- the fix is a widening, not a swap.
    expect(extractSkillVersion('---\nname: x\nversion: 2.1.0\n---\nbody\n')).toBe('2.1.0');
    // ... and so must a lone CR, the third convention the helper's name covers.
    expect(extractSkillVersion('---\rname: x\rversion: 2.1.0\r---\rbody\r')).toBe('2.1.0');
  });

  it('treats a versioned skill as up to date when only line endings differ', () => {
    const bundled = readBundled('sprint-flow');
    expect(bundled).toMatch(/^---/);
    installSkill('sprint-flow', flipLineEndings(bundled));
    const { check } = runFreshness('sprint-flow');
    expect(check, JSON.stringify(check)).toBeDefined();
    expect(check.status).toBe('PASS');
  });

  /**
   * AC-439-04: every bundled skill now carries a version, so the versionless
   * fallback branch is only reachable when the INSTALLED copy lacks one (e.g.
   * written by an older tool version). Strip the version line to simulate it.
   */
  function stripVersion(content) {
    return content.replace(/^version:[^\n]*\n/m, '');
  }

  it('treats an installed copy without version as up to date when only line endings differ', () => {
    const bundled = readBundled('grilling');
    // AC-439-04: grilling used to be one of the 11 skills without a version
    // field; all bundled skills now declare one.
    expect(bundled).toMatch(/^version:/m);
    installSkill('grilling', flipLineEndings(stripVersion(bundled)));
    const { check } = runFreshness('grilling');
    expect(check, JSON.stringify(check)).toBeDefined();
    expect(check.status).toBe('PASS');
  });

  // AC-439-02 promises "differences beyond line endings" still report WARN,
  // which means every line-ending convention has to be tolerated, not just CRLF
  // (Round 2 feasibility FC-05: the helper's name already says as much).
  it('treats a lone-CR skill file as up to date too', () => {
    const bundled = readBundled('grilling');
    installSkill(
      'grilling',
      stripVersion(bundled).replace(/\r\n/g, '\n').replace(/\n/g, '\r')
    );
    const { check } = runFreshness('grilling');
    expect(check, JSON.stringify(check)).toBeDefined();
    expect(check.status).toBe('PASS');
  });

  it('still reports WARN for a real content difference (anti-vacuity)', () => {
    const bundled = readBundled('grilling');
    installSkill('grilling', `${flipLineEndings(stripVersion(bundled))}\n## Diverged section\n`);
    const { issues, check } = runFreshness('grilling');
    expect(check.status).toBe('WARN');
    expect(issues).toBe(1);
  });

  // AC-439-03: without a version the doctor cannot claim "Outdated", and the
  // advice must NOT be the destructive `update-skill --all` -- it pulls from
  // main, which may be older than the installed copy (#439).
  it('versionless content diff advises manual comparison, never the destructive update', () => {
    const bundled = readBundled('grilling');
    installSkill('grilling', `${flipLineEndings(stripVersion(bundled))}\n## Diverged section\n`);
    const { check } = runFreshness('grilling');
    expect(check.status).toBe('WARN');
    expect(check.detail).toContain('Content differs');
    expect(check.detail).not.toMatch(/update-skill\s+--all/);
    expect(check.detail).toContain('update-skill'); // the caveat IS mentioned
  });

  // AC-439-04: the 11 skills that used to fall into the byte-comparison branch
  // now declare a version, making semver equality the primary freshness path.
  it('every bundled skill carries a version frontmatter', () => {
    const skills = fs
      .readdirSync(bundledSkillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(skills.length).toBeGreaterThanOrEqual(13);
    const missing = skills.filter((name) => {
      const md = path.join(bundledSkillsDir, name, 'SKILL.md');
      return !/^version:\s*\d+\.\d+\.\d+/m.test(fs.readFileSync(md, 'utf8'));
    });
    expect(missing, `skills missing version frontmatter: ${missing.join(', ')}`).toEqual([]);
  });
});
