/**
 * @test REQ-663
 * @intent `xp-gate uninstall` presents itself as the inverse of `init`, but it only
 *         removed `hooks/` + `adapters/` + `core.hooksPath`. After
 *         `setup-global` then `uninstall --global --force`, the tool printed
 *         "Uninstall complete" while leaving behind ~1000 files:
 *
 *           ~/.config/xp-gate/modules/         principles/ mutation/ mock-policy/
 *           ~/.config/xp-gate/node_modules/    js-yaml / zod / argparse ...
 *           ~/.config/xp-gate/package.json
 *           ~/.config/xp-gate/package-lock.json
 *           ~/.config/xp-gate/xp-gate.json     manifest + installedSkills record
 *           ~/.xp-gate/version-cache.json
 *
 *         And skills were never in scope at all: 12 skills stayed in
 *         ~/.qoder/skills/ and ~/.config/opencode/skills/, which the next `init`
 *         then treated as already-installed.
 *
 *         The residue is not cosmetic. A leftover `node_modules/` makes the NEXT
 *         `setup-global` skip its install ("module runtime deps → ... node_modules"
 *         reuses whatever is there), so a stale dependency tree survives an
 *         upgrade; and a leftover `xp-gate.json` carries the previous version's
 *         `manifest` and `lastInit`, which `doctor` then reports as the CURRENT
 *         installation.
 *
 *         Two rules the fix must respect, both from the issue:
 *           - a user config (`.delphi-config.json`) is user DATA, not residue --
 *             keep it, but SAY SO instead of leaving it silently;
 *           - never delete a skill directory the user has edited. Only remove one
 *             whose content still matches the bundled copy.
 * @covers AC-670-37, AC-670-38, AC-670-39
 */
'use strict';

// describe/it/expect/beforeEach/afterEach are vitest globals in this repo's config;
// requiring them from 'vitest' fails because these tests are CommonJS.
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Build a throwaway HOME so the plan is computed against a controlled tree. */
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xpg-uninst-'));
  return home;
}

/**
 * Reproduce the on-disk shape `xp-gate setup-global` leaves behind, including the
 * parts that were measured as residue in #663.
 */
function seedGlobalInstall() {
  const configDir = path.join(process.env.HOME, '.config', 'xp-gate');
  for (const rel of ['hooks', 'adapters', 'modules/principles', 'node_modules/js-yaml']) {
    fs.mkdirSync(path.join(configDir, rel), { recursive: true });
    fs.writeFileSync(path.join(configDir, rel, 'index.js'), 'module.exports = {};\n');
  }
  for (const file of ['package.json', 'package-lock.json', 'xp-gate.json']) {
    fs.writeFileSync(path.join(configDir, file), '{}\n');
  }
  // User data: must survive, and must be reported.
  fs.writeFileSync(path.join(configDir, '.delphi-config.json'), '{}\n');
}


describe('uninstall --global plans the whole installation, not just hooks (#663)', () => {
  let home;
  const savedEnv = {};

  beforeEach(() => {
    home = makeHome();
    savedEnv.HOME = process.env.HOME;
    savedEnv.USERPROFILE = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
  });

  afterEach(() => {
    process.env.HOME = savedEnv.HOME;
    process.env.USERPROFILE = savedEnv.USERPROFILE;
    fs.rmSync(home, { recursive: true, force: true });
  });

  /**
   * Load a module fresh so it re-reads HOME. Every lib reads os.homedir() at call
   * time, but a cached module still holds `GLOBAL_DIRS` values captured earlier.
   */
  function freshRequire(relPath) {
    for (const key of Object.keys(require.cache)) {
      if (key.includes(`${path.sep}npm-package${path.sep}lib${path.sep}`)) {
        delete require.cache[key];
      }
    }
    return require(relPath);
  }

  it('AC-670-37: modules, node_modules and the manifest files are all in scope', () => {
    const { buildPlan } = freshRequire('../uninstall');
    expect(typeof buildPlan).toBe('function');

    // buildPlan only schedules what actually exists, so the fixture has to look
    // like a real `setup-global` install -- otherwise this asserts nothing.
    seedGlobalInstall();

    const plan = buildPlan('global');
    const paths = plan.filter((step) => step.path).map((step) => step.path.split(path.sep).join('/'));

    // Each of these was measured residue. A plan that omits any of them reports
    // "complete" over an installation that is still there.
    for (const required of ['modules', 'node_modules', 'package.json', 'package-lock.json', 'xp-gate.json']) {
      expect(
        paths.some((p) => p.endsWith(required)),
        `${required} is missing from the uninstall plan (measured residue, #663)`,
      ).toBe(true);
    }
  });

  it('AC-670-38: user config is retained and reported, never silently kept', () => {
    const { buildPlan } = freshRequire('../uninstall');
    seedGlobalInstall();
    const plan = buildPlan('global');
    // Deletion steps only: a RETAIN step names the file precisely because it is
    // being kept, so including it here would assert the opposite of the intent.
    const deletedPaths = plan
      .filter((step) => step.path && step.retain !== true && step.type !== 'retain')
      .map((step) => step.path.split(path.sep).join('/'));

    // `.delphi-config.json` holds the user's expert/model choice -- it is data, so
    // it must appear in no deletion step. (The --purge branch is a separate,
    // explicitly destructive path and is not what this plan describes.)
    expect(deletedPaths.some((p) => p.endsWith('.delphi-config.json'))).toBe(false);
    // Not deleting it is only half the fix: the summary has to name it.
    const retained = plan.filter((step) => step.retain === true);
    expect(retained.length, 'no step declares a retention, so the summary cannot report one').toBeGreaterThan(0);
  });

  it('AC-670-39: an edited skill directory is never scheduled for deletion', () => {
    const { planSkillRemovals } = freshRequire('../uninstall');
    expect(typeof planSkillRemovals).toBe('function');

    const bundled = path.join(home, 'bundle', 'skills');
    const installedRoot = path.join(home, '.qoder', 'skills');
    for (const [dir, body] of [
      [path.join(bundled, 'clean-skill'), 'bundled body\n'],
      [path.join(installedRoot, 'clean-skill'), 'bundled body\n'],
      [path.join(bundled, 'edited-skill'), 'bundled body\n'],
      [path.join(installedRoot, 'edited-skill'), 'bundled body\n// user edit\n'],
    ]) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), body);
    }

    const removals = planSkillRemovals(['clean-skill', 'edited-skill'], installedRoot, bundled);
    const names = removals.map((r) => path.basename(r.path));

    // Untouched -> remove. This is the residue the issue is about.
    expect(names).toContain('clean-skill');
    // Edited -> keep. Deleting a user's modifications is worse than residue.
    expect(names).not.toContain('edited-skill');
  });
});
