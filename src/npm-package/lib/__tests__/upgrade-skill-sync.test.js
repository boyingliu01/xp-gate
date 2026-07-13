/**
 * @test REQ-332 xp-gate upgrade --apply must update installed skills
 * @intent After upgrade --apply, all installed skills should be refreshed to match the new package version
 * @covers AC-332-01, AC-332-02, AC-332-03, AC-332-04
 */

const fs = require('fs');
const path = require('path');

describe('upgrade --apply skill sync — #332', () => {
  // AC-332-01: upgrade.js handleApplyMode calls updateSkill after successful upgrade
  it('AC-332-01: upgrade.js contains updateSkill call after plugin upgrade', () => {
    const source = fs.readFileSync(require.resolve('../upgrade.js'), 'utf8');
    expect(source).toContain("require('./update-skill.js')");
    expect(source).toContain('updateSkill(null, { all: true');
  });

  // AC-332-02: updateSkill call is inside try/catch (non-blocking)
  it('AC-332-02: updateSkill call is wrapped in try/catch for non-blocking behavior', () => {
    const source = fs.readFileSync(require.resolve('../upgrade.js'), 'utf8');
    const lines = source.split('\n');
    let foundRequire = false;
    let inTryBlock = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("require('./update-skill.js')")) {
        foundRequire = true;
        for (let j = i - 1; j >= 0; j--) {
          if (/^\s*try\s*\{/.test(lines[j])) {
            inTryBlock = true;
            break;
          }
          if (/^\s*(function|async function|=>)/.test(lines[j])) break;
        }
        break;
      }
    }
    expect(foundRequire).toBe(true);
    expect(inTryBlock).toBe(true);
  });

  // AC-332-03: updateSkill call is placed after upgradeOpenCodePlugin (correct ordering)
  it('AC-332-03: updateSkill is called after upgradeOpenCodePlugin in handleApplyMode', () => {
    const source = fs.readFileSync(require.resolve('../upgrade.js'), 'utf8');
    const pluginIdx = source.indexOf('upgradeOpenCodePlugin()');
    const skillIdx = source.indexOf("require('./update-skill.js')");
    expect(pluginIdx).toBeGreaterThan(-1);
    expect(skillIdx).toBeGreaterThan(pluginIdx);
  });
});

describe('doctor skill version check — #332', () => {
  // AC-332-04: doctor.js diagnose() includes skill version consistency check
  it('AC-332-04: doctor.js diagnose() contains diagnoseInstalledSkills call', () => {
    const source = fs.readFileSync(require.resolve('../doctor.js'), 'utf8');
    expect(source).toContain('diagnoseInstalledSkills');
  });

  // AC-332-05: diagnoseInstalledSkills compares installed skills against package-bundled skills
  it('AC-332-05: diagnoseInstalledSkills reads config installedSkills and package skills dir', () => {
    const source = fs.readFileSync(require.resolve('../doctor.js'), 'utf8');
    expect(source).toContain('installedSkills');
    expect(source).toContain('diagnoseInstalledSkills');
    expect(source).toContain('skills');
  });
});
