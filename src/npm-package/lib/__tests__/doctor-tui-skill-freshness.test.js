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
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
    } catch (err) {
      throw new Error(`failed to install test skill ${name}: ${err && err.message}`);
    }
  }

  function readBundled(name) {
    try {
      return fs.readFileSync(path.join(bundledSkillsDir, name, 'SKILL.md'), 'utf8');
    } catch (err) {
      throw new Error(`failed to read bundled skill ${name}: ${err && err.message}`);
    }
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
    // Sanity floor only: the substantive assertion below is that every bundled
    // skill declares a version. #522 removed clipboard-vision, dropping the
    // bundle from 13 to 12 skills, so the floor tracks the current bundle size
    // instead of a stale magic number (Delphi Round 1, finding A-Critical).
    expect(skills.length).toBeGreaterThanOrEqual(12);
    const missing = skills.filter((name) => {
      const md = path.join(bundledSkillsDir, name, 'SKILL.md');
      return !/^version:\s*\d+\.\d+\.\d+/m.test(fs.readFileSync(md, 'utf8'));
    });
    expect(missing, `skills missing version frontmatter: ${missing.join(', ')}`).toEqual([]);
  });
});

/**
 * @test REQ-635
 * @intent doctor 的 "Installed skills" 检查从 config.installedSkills 取清单，
 *         而 xp-gate init 从不写该字段，导致全新安装的机器（12/12 技能已部署）
 *         稳定报 "No skills installed" 并在读盘前就返回；同时只解析单一平台，
 *         init 实际部署的另外两个平台（含 .dsh）从不校验（#635）
 * @covers AC-635-01, AC-635-02, AC-635-03
 */
describe('doctor-tui installed skills enumerate the filesystem (#635)', () => {
  let tmpHome;
  let originalHome;

  // Same dir doctor-tui resolves as PKG_DIR (path.dirname of lib/). Re-declared
  // here because the outer describe's copy is scoped to that callback.
  const bundledSkillsDir = path.join(__dirname, '..', '..', 'skills');

  // Every directory init deploys to. `.dsh` is the one detectPlatform() cannot
  // report, and the one that went unverified entirely.
  const DEPLOY_DIRS = [
    ['opencode', ['.config', 'opencode', 'skills']],
    ['dsh', ['.dsh', 'skills']],
    ['qoder', ['.qoder', 'skills']],
  ];

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-635-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    delete require.cache[require.resolve('../doctor-tui')];
    delete require.cache[require.resolve('../shared-paths')];
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  /** Deploy a real bundled skill into one platform's skills dir. */
  function deploy(platformDirs, name) {
    const dir = path.join(tmpHome, ...platformDirs, name);
    fs.mkdirSync(dir, { recursive: true });
    const bundled = fs.readFileSync(path.join(bundledSkillsDir, name, 'SKILL.md'), 'utf8');
    fs.writeFileSync(path.join(dir, 'SKILL.md'), bundled);
  }

  // AC-635-01: a machine with skills deployed and NO installedSkills config key
  // must be verified, not reported as "No skills installed".
  it('verifies deployed skills even when config.installedSkills is absent', () => {
    deploy(['.config', 'opencode', 'skills'], 'grilling');
    const { diagnoseInstalledSkills } = require('../doctor-tui');
    const checks = [];
    // init writes exactly this shape: no installedSkills key at all.
    const issues = diagnoseInstalledSkills({ mode: 'global', templateDir: '/x' }, checks);

    expect(issues).toBe(0);
    const skills = checks.filter(c => c.name.startsWith('Skill '));
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.every(c => c.status === 'PASS')).toBe(true);
    // The old behaviour: a single SKIP row and zero skills examined.
    expect(checks.find(c => c.name === 'Installed skills')).toBeUndefined();
  });

  // AC-635-02: `.dsh` is a first-class deploy target and must be checked, even
  // though detectPlatform() never returns 'dsh'.
  it('checks the .dsh platform, which detectPlatform() cannot report', () => {
    deploy(['.dsh', 'skills'], 'grilling');
    const { diagnoseInstalledSkills } = require('../doctor-tui');
    const checks = [];
    diagnoseInstalledSkills({ mode: 'global' }, checks);

    const dshRows = checks.filter(c => c.name.startsWith('Skill [dsh]'));
    expect(dshRows.length).toBeGreaterThan(0);
    expect(dshRows[0].status).toBe('PASS');
  });

  // AC-635-03: all deployed platforms are verified in one run, not just the
  // one detectPlatform() happens to pick.
  it('verifies every deployed platform, not only the detected one', () => {
    for (const [, dirs] of DEPLOY_DIRS) deploy(dirs, 'grilling');
    const { diagnoseInstalledSkills } = require('../doctor-tui');
    const checks = [];
    diagnoseInstalledSkills({ mode: 'global' }, checks);

    for (const [platform] of DEPLOY_DIRS) {
      const rows = checks.filter(c => c.name.startsWith(`Skill [${platform}]`));
      expect(rows.length, `no checks emitted for platform ${platform}`).toBeGreaterThan(0);
    }
  });

  // Anti-vacuity: enumeration must still surface real drift. A stale copy in
  // .dsh specifically must WARN — proving the new rows are not decorative.
  it('reports drift found in a non-detected platform (anti-vacuity)', () => {
    deploy(['.config', 'opencode', 'skills'], 'grilling');
    const staleDir = path.join(tmpHome, '.dsh', 'skills', 'grilling');
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(
      path.join(staleDir, 'SKILL.md'),
      '---\nname: grilling\nversion: 0.0.1\n---\n\nstale body\n'
    );

    const { diagnoseInstalledSkills } = require('../doctor-tui');
    const checks = [];
    const issues = diagnoseInstalledSkills({ mode: 'global' }, checks);

    expect(issues).toBeGreaterThan(0);
    const stale = checks.find(c => c.name === 'Skill [dsh]: grilling');
    expect(stale).toBeDefined();
    expect(stale.status).toBe('WARN');
    expect(stale.detail).toContain('Outdated');
  });

  // Honest SKIP: nothing deployed anywhere must say so, and name the locations
  // it looked at — the old message could not be told apart from "not wired up".
  it('reports SKIP naming every searched location when nothing is deployed', () => {
    const { diagnoseInstalledSkills } = require('../doctor-tui');
    const checks = [];
    const issues = diagnoseInstalledSkills({ mode: 'global' }, checks);

    expect(issues).toBe(0);
    const row = checks.find(c => c.name === 'Installed skills');
    expect(row).toBeDefined();
    expect(row.status).toBe('SKIP');
    expect(row.detail).toContain('dsh');
  });

  // Backwards compatibility: an explicit list keeps the legacy single-target
  // contract and the unprefixed check names existing callers rely on.
  it('honours an explicit installedSkills list without the platform prefix', () => {
    deploy(['.config', 'opencode', 'skills'], 'grilling');
    const { diagnoseInstalledSkills } = require('../doctor-tui');
    const checks = [];
    diagnoseInstalledSkills({ installedSkills: { grilling: {} } }, checks);

    const row = checks.find(c => c.name === 'Skill: grilling');
    expect(row).toBeDefined();
    expect(row.status).toBe('PASS');
  });
});
