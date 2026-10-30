/**
 * @test REQ-664
 * @intent `setup-global` points `core.hooksPath` at `~/.config/xp-gate/hooks`, and
 *         that setting is GLOBAL — it governs every repository on the machine. So
 *         any third-party tool that writes hooks into `core.hooksPath` writes into
 *         a directory xp-gate owns. `git lfs install` does exactly this, and the
 *         measured result was four hooks xp-gate never installs appearing there:
 *
 *           hook-module-resolution.sh  lib/  post-checkout  post-commit
 *           post-merge  pre-commit  pre-push
 *
 *         Two failures followed:
 *
 *           1. `doctor` only checked pre-commit / pre-push / post-merge. The extra
 *              files were neither reported nor explained, so the user had no way to
 *              learn that a global install had acquired foreign hooks.
 *           2. `uninstall` did `rmSync(GLOBAL_HOOKS_DIR, {recursive: true})` — the
 *              whole tree, including the lfs hooks someone else put there. The
 *              file already had `verifyFileOwnership()`; the `type: 'dir'` branch
 *              simply did not use it.
 *
 *         Deleting another tool's files is the more serious of the two: the user
 *         loses a working git-lfs setup and has no idea which command did it. So
 *         uninstall must classify before it removes, and SAY what it found.
 * @covers AC-670-40, AC-670-41, AC-670-42
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/** Hooks xp-gate itself installs; anything else in the dir is foreign. */
const XP_GATE_HOOKS = ['pre-commit', 'pre-push', 'post-merge'];

function freshRequire(relPath) {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}npm-package${path.sep}lib${path.sep}`)) {
      delete require.cache[key];
    }
  }
  return require(relPath);
}

/** A hooks directory shaped like the measured post-`git lfs install` state. */
function makeHooksDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xpg-hooks-'));
  for (const hook of XP_GATE_HOOKS) {
    fs.writeFileSync(path.join(dir, hook), '#!/bin/sh\n# xp-gate\n');
  }
  // Foreign: two hooks git-lfs installs, plus its support file.
  fs.writeFileSync(path.join(dir, 'post-checkout'), '#!/bin/sh\ngit lfs post-checkout "$@"\n');
  fs.writeFileSync(path.join(dir, 'post-commit'), '#!/bin/sh\ngit lfs post-commit "$@"\n');
  fs.writeFileSync(path.join(dir, 'hook-module-resolution.sh'), '#!/bin/sh\n');
  return dir;
}

describe('foreign hooks in the global hooksPath (#664)', () => {
  it('AC-670-40: the classifier names xp-gate hooks and flags everything else', () => {
    const { classifyHooksDir } = freshRequire('../doctor');
    expect(typeof classifyHooksDir).toBe('function');

    const dir = makeHooksDir();
    try {
      const result = classifyHooksDir(dir);
      expect(result.owned.sort()).toEqual([...XP_GATE_HOOKS].sort());
      // Every foreign entry is reported, not silently dropped. `foreign` holds
      // { name, source } records, so compare names.
      const foreignNames = result.foreign.map((f) => f.name);
      expect(foreignNames).toContain('post-checkout');
      expect(foreignNames).toContain('post-commit');
      // lib/ is xp-gate's own shared-library directory, not foreign.
      expect(foreignNames).not.toContain('lib');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AC-670-41: git-lfs hooks are identified by source, unknown files stay generic', () => {
    const { classifyHooksDir } = freshRequire('../doctor');
    const dir = makeHooksDir();
    try {
      const result = classifyHooksDir(dir);
      // Naming the likely source is what turns a confusing listing into an
      // actionable message: "git lfs" tells the user which tool to look at.
      const lfs = result.foreign.filter((f) => f.source === 'git-lfs').map((f) => f.name);
      expect(lfs).toContain('post-checkout');
      expect(lfs).toContain('post-commit');

      // A file with no recognizable signature must still be reported, but without
      // guessing a source it cannot prove.
      fs.writeFileSync(path.join(dir, 'post-rebase'), '#!/bin/sh\necho mine\n');
      const again = classifyHooksDir(dir);
      const unknown = again.foreign.find((f) => f.name === 'post-rebase');
      expect(unknown).toBeDefined();
      expect(unknown.source).not.toBe('git-lfs');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AC-670-42: uninstall refuses to delete a hooks dir holding foreign files', () => {
    const { planHooksDirRemoval } = freshRequire('../uninstall');
    expect(typeof planHooksDirRemoval).toBe('function');

    const dir = makeHooksDir();
    try {
      const plan = planHooksDirRemoval(dir);
      // Recursive removal would take git-lfs's files with it, so it must not be
      // the chosen action while foreign content is present.
      expect(plan.action).not.toBe('remove-all');
      expect(plan.foreign.length).toBeGreaterThan(0);

      // A directory holding ONLY xp-gate files is safe to remove wholesale.
      const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'xpg-hooks-clean-'));
      for (const hook of XP_GATE_HOOKS) {
        fs.writeFileSync(path.join(clean, hook), '#!/bin/sh\n# xp-gate\n');
      }
      expect(planHooksDirRemoval(clean).action).toBe('remove-all');
      fs.rmSync(clean, { recursive: true, force: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
