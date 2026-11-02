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
 * Load a module fresh so it re-reads HOME. Every lib reads os.homedir() at call
 * time, but a cached module still holds `GLOBAL_DIRS` values captured earlier.
 * Shared by every describe block here: three copies of this loop tripped the
 * clone detector, and they had to stay byte-identical to be correct.
 */
function freshRequire(relPath) {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}npm-package${path.sep}lib${path.sep}`)) {
      delete require.cache[key];
    }
  }
  return require(relPath);
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

// -- #714: the residue must be DELETED, not merely scheduled --------------------
// #663 taught `buildPlan()` to list modules/, node_modules/, package.json,
// package-lock.json and xp-gate.json, so AC-670-37 passed -- but it only ever
// asserted those paths appear in the plan. On Windows the run still printed
//
//   Warning: ~/.config/xp-gate/xp-gate.json does not contain xp-gate signature - skipping
//
// for all three files (the two directories were deleted, because a `dir` step
// recurses without an ownership check). The plan entries carried neither
// `signature` nor `manifestKey`, so removeFile() reached
// `content.includes(undefined)`, which is always false. Worst case: the
// uninstaller had just written `"mode": "uninstalled"` into xp-gate.json and
// then reported that file as "not xp-gate's".
//
// The lesson these tests encode: a residue test that only inspects the PLAN
// cannot see a broken DELETE. Every assertion below runs the real uninstall.
describe('uninstall --global actually removes the residue (#714)', () => {
  let home;
  const savedEnv = {};
  const realArgv = process.argv;

  beforeEach(() => {
    home = makeHome();
    savedEnv.HOME = process.env.HOME;
    savedEnv.USERPROFILE = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.argv = ['node', 'xp-gate', 'uninstall', '--global', '--force'];
  });

  afterEach(() => {
    process.argv = realArgv;
    process.env.HOME = savedEnv.HOME;
    process.env.USERPROFILE = savedEnv.USERPROFILE;
    fs.rmSync(home, { recursive: true, force: true });
  });

  function configDir() {
    return path.join(home, '.config', 'xp-gate');
  }

  /**
   * Seed a REAL setup-global layout: the three manifest-ish files carry the
   * content `setup-global` writes, so a signature check has to succeed or fail
   * on realistic input rather than on `{}`.
   */
  function seedRealisticInstall() {
    for (const rel of ['hooks', 'adapters', 'modules/principles', 'node_modules/js-yaml']) {
      fs.mkdirSync(path.join(configDir(), rel), { recursive: true });
      fs.writeFileSync(path.join(configDir(), rel, 'index.js'), 'module.exports = {};\n');
    }
    fs.writeFileSync(
      path.join(configDir(), 'package.json'),
      JSON.stringify({ dependencies: { 'js-yaml': '^5.2.2', zod: '^4.4.3' } }, null, 2)
    );
    fs.writeFileSync(
      path.join(configDir(), 'package-lock.json'),
      JSON.stringify({ name: 'xp-gate-global', lockfileVersion: 3, packages: {} }, null, 2)
    );
    // `mode: 'global'` is what uninstall() reads to decide there is anything to
    // do; without it the run exits "No xp-gate installation found" and the test
    // would pass while touching nothing.
    fs.writeFileSync(
      path.join(configDir(), 'xp-gate.json'),
      JSON.stringify(
        {
          lastInit: new Date().toISOString(),
          mode: 'global',
          manifest: { files: {} },
        },
        null,
        2
      )
    );
    fs.writeFileSync(path.join(configDir(), '.delphi-config.json'), '{ "active_profile": "default" }\n');
  }

  /**
   * @test REQ-714 Uninstall completeness
   * @intent A file step in the residue plan must be deleted, not skipped for lack of a signature
   * @covers AC-714-01
   */
  it('AC-714-01: package.json, package-lock.json and xp-gate.json are gone after uninstall', async () => {
    seedRealisticInstall();
    const { uninstall } = freshRequire('../uninstall');
    await uninstall(['--global', '--force']);

    for (const file of ['package.json', 'package-lock.json']) {
      expect(
        fs.existsSync(path.join(configDir(), file)),
        `${file} survived uninstall - it is xp-gate's own file, not user data`
      ).toBe(false);
    }

    // xp-gate.json is deliberately retained: the state machine rewrites it with
    // `mode: "uninstalled"` so a second `uninstall` is a clean no-op (AC-09).
    // What #714 broke was not the retention but the CLAIM about it -- the run
    // called this file "not xp-gate's" while rewriting it. AC-714-04 pins that.
    const manifestFile = path.join(configDir(), 'xp-gate.json');
    expect(fs.existsSync(manifestFile)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    expect(manifest.mode).toBe('uninstalled');
  });

  /**
   * @test REQ-714 Uninstall completeness
   * @intent The two residue directories must go too, so a later setup-global cannot reuse them
   * @covers AC-714-02
   */
  it('AC-714-02: modules/ and node_modules/ are gone after uninstall', async () => {
    seedRealisticInstall();
    const { uninstall } = freshRequire('../uninstall');
    await uninstall(['--global', '--force']);

    expect(fs.existsSync(path.join(configDir(), 'modules'))).toBe(false);
    expect(fs.existsSync(path.join(configDir(), 'node_modules'))).toBe(false);
    expect(fs.existsSync(path.join(configDir(), 'adapters'))).toBe(false);
  });

  /**
   * @test REQ-714 Uninstall completeness
   * @intent User data must still survive the now-working deletion path
   * @covers AC-714-03
   */
  it('AC-714-03: .delphi-config.json survives the completed uninstall', async () => {
    seedRealisticInstall();
    const { uninstall } = freshRequire('../uninstall');
    await uninstall(['--global', '--force']);

    expect(fs.existsSync(path.join(configDir(), '.delphi-config.json'))).toBe(true);
  });

  /**
   * @test REQ-714 Uninstall completeness
   * @intent The uninstall must not report success while leaving its own residue behind
   * @covers AC-714-04
   */
  it('AC-714-04: uninstall does not warn that its own residue files are foreign', async () => {
    seedRealisticInstall();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { uninstall } = freshRequire('../uninstall');
      await uninstall(['--global', '--force']);

      const said = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      for (const file of ['package.json', 'package-lock.json', 'xp-gate.json']) {
        expect(
          said.includes(`${file} does not contain xp-gate signature`),
          `uninstall disowned ${file}: ${said}`
        ).toBe(false);
      }
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});

describe('uninstall hooks directory ownership (#714)', () => {
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
   * @test REQ-714 Hook ownership
   * @intent post-commit is installed by copyHooks(), so it must count as xp-gate's own
   * @covers AC-714-05
   */
  it('AC-714-05: post-commit is classified as xp-gate-owned, not foreign', () => {
    const { planHooksDirRemoval } = freshRequire('../uninstall');
    const hooksDir = path.join(process.env.HOME, '.config', 'xp-gate', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    // copyHooks() installs exactly these; post-commit was the one it forgot.
    for (const f of ['pre-commit', 'pre-push', 'post-merge', 'post-commit', 'hook-module-resolution.sh']) {
      fs.writeFileSync(path.join(hooksDir, f), '#!/bin/sh\n');
    }

    const result = planHooksDirRemoval(hooksDir);
    const foreignNames = (result.foreign || []).map((f) => f.name);
    expect(foreignNames).not.toContain('post-commit');
  });

  /**
   * @test REQ-714 Hook ownership
   * @intent A genuinely foreign hook (git-lfs) must still be protected
   * @covers AC-714-06
   */
  it('AC-714-06: a third-party hook is still classified as foreign and kept', () => {
    const { planHooksDirRemoval } = freshRequire('../uninstall');
    const hooksDir = path.join(process.env.HOME, '.config', 'xp-gate', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, 'pre-commit'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(hooksDir, 'post-checkout'), '#!/bin/sh\n# git-lfs\n');

    const result = planHooksDirRemoval(hooksDir);
    const foreignNames = (result.foreign || []).map((f) => f.name);
    expect(foreignNames).toContain('post-checkout');
    expect(result.action).toBe('remove-owned-only');
  });
});
