/**
 * @test REQ-416
 * @intent install-skill/update-skill 只从 GitHub main 下载单个 SKILL.md，导致 13 个技能里
 *         8 个的 references/templates/scripts 全部缺失、SKILL.md 内的路径引用悬空，而
 *         update 先删目录再只写回 SKILL.md 会把用户已有的完整目录清空（#416）
 * @covers AC-416-01, AC-416-02, AC-416-03, AC-416-04
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const BUNDLED_SKILLS = path.join(__dirname, '..', '..', 'skills');

function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

describe('install-skill full skill directory (#416)', () => {
  let tmpHome;
  let originalHome;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-full-'));
    process.env.HOME = tmpHome;
    vi.resetModules();
    for (const mod of ['../install-skill', '../update-skill', '../detect-deps', '../shared-paths', '../rollback']) {
      delete require.cache[require.resolve(mod)];
    }
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Dependency gate: superpowers + gstack must look installed.
    for (const name of ['superpowers', 'gstack']) {
      const dir = path.join(tmpHome, '.config', 'opencode', 'skills', name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.0.0' }));
    }
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    vi.restoreAllMocks();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('installs every file the bundled skill ships, not only SKILL.md', async () => {
    const { installSkill } = require('../install-skill');
    const result = await installSkill('ralph-loop');

    expect(result).toBe(0);
    const installed = path.join(tmpHome, '.config', 'opencode', 'skills', 'ralph-loop');
    expect(listFiles(installed)).toEqual(listFiles(path.join(BUNDLED_SKILLS, 'ralph-loop')));
    expect(fs.existsSync(path.join(installed, 'references'))).toBe(true);
  });

  it('installs from the package without touching the network', async () => {
    // The npm package already carries the content, so there is no `main`-branch
    // download left to drift against the installed CLI version.
    const https = require('https');
    const getSpy = vi.spyOn(https, 'get').mockImplementation(() => {
      throw new Error('install-skill must not reach the network');
    });

    const { installSkill } = require('../install-skill');
    const result = await installSkill('delphi-review');

    expect(result).toBe(0);
    expect(getSpy).not.toHaveBeenCalled();
    const installed = path.join(tmpHome, '.config', 'opencode', 'skills', 'delphi-review');
    expect(fs.readFileSync(path.join(installed, 'SKILL.md'), 'utf8'))
      .toBe(fs.readFileSync(path.join(BUNDLED_SKILLS, 'delphi-review', 'SKILL.md'), 'utf8'));
  });

  it('replaces a stale installed directory with the complete bundled one on update', async () => {
    const installed = path.join(tmpHome, '.config', 'opencode', 'skills', 'ralph-loop');
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(installed, 'SKILL.md'), '# old');
    fs.writeFileSync(path.join(installed, 'obsolete-reference.md'), '# deleted upstream');

    const { updateSkill } = require('../update-skill');
    const configDir = path.join(tmpHome, '.config', 'xp-gate');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'xp-gate.json'),
      JSON.stringify({ installedSkills: { 'ralph-loop': { version: '0.0.1' } } })
    );

    const result = await updateSkill('ralph-loop', {});
    expect(result).toBe(0);
    expect(listFiles(installed)).toEqual(listFiles(path.join(BUNDLED_SKILLS, 'ralph-loop')));
    expect(fs.existsSync(path.join(installed, 'obsolete-reference.md'))).toBe(false);
  });

  it('updates the skills directory of the platform actually in use', async () => {
    // update-skill used to hardcode the opencode path while install-skill wrote
    // to the platform dir, so on Qoder it deleted nothing (or the wrong copy).
    for (const name of ['superpowers', 'gstack']) {
      const dir = path.join(tmpHome, '.qoder', 'skills', name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.0.0' }));
    }
    const qoderSkills = path.join(tmpHome, '.qoder', 'skills', 'ralph-loop');
    fs.mkdirSync(qoderSkills, { recursive: true });
    fs.writeFileSync(path.join(qoderSkills, 'SKILL.md'), '# old qoder copy');
    fs.writeFileSync(path.join(qoderSkills, 'obsolete.md'), 'stale');
    const opencodeSkills = path.join(tmpHome, '.config', 'opencode', 'skills', 'ralph-loop');
    fs.mkdirSync(opencodeSkills, { recursive: true });
    fs.writeFileSync(path.join(opencodeSkills, 'SKILL.md'), 'untouched');

    const configDir = path.join(tmpHome, '.config', 'xp-gate');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'xp-gate.json'),
      JSON.stringify({ installedSkills: { 'ralph-loop': { version: '0.0.1' } } })
    );

    const { updateSkill } = require('../update-skill');
    expect(await updateSkill('ralph-loop', {})).toBe(0);

    expect(fs.existsSync(path.join(qoderSkills, 'obsolete.md'))).toBe(false);
    expect(listFiles(qoderSkills)).toEqual(listFiles(path.join(BUNDLED_SKILLS, 'ralph-loop')));
    expect(fs.readFileSync(path.join(opencodeSkills, 'SKILL.md'), 'utf8')).toBe('untouched');
  });

  it('keeps the installed directory when the package no longer bundles the skill', async () => {
    // update-skill used to rmSync the target before delegating to install, so a
    // skill the installed package does not carry was destroyed first and the
    // update failed afterwards — data loss with nothing to show for it.
    const installed = path.join(tmpHome, '.config', 'opencode', 'skills', 'removed-in-this-version');
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(installed, 'SKILL.md'), '# user copy');
    const configDir = path.join(tmpHome, '.config', 'xp-gate');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'xp-gate.json'),
      JSON.stringify({ installedSkills: { 'removed-in-this-version': { version: '0.0.1' } } })
    );

    const { updateSkill } = require('../update-skill');
    expect(await updateSkill('removed-in-this-version', {})).toBe(1);
    expect(fs.readFileSync(path.join(installed, 'SKILL.md'), 'utf8')).toBe('# user copy');
  });
});
