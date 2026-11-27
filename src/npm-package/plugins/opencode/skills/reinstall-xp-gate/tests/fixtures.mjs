import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Shared fixtures for the test suite.
 *
 * The four helpers below were copy-pasted into each test file. That is cheap to
 * write and expensive to keep correct: package layout, temp-dir cleanup and the
 * drift simulation all have to change together, and a stale copy silently tests
 * a layout the production code no longer produces.
 *
 * Each helper takes the `node:test` context so teardown is registered exactly
 * once, by the test that owns the resource -- a helper that swallowed the
 * context would leave every assertion after it running on a leaked tree.
 */

/** Register `fn` for teardown on the test context, tolerating a bare object. */
function after(t, fn) {
  if (t && typeof t.after === 'function') t.after(fn);
  return fn;
}

/** A temp dir registered for teardown, so a failing assertion still cleans up. */
export function tmpDir(t, prefix = 'xgr-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  after(t, () => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Build a fake xp-gate package dir with `<pkg>/skills/<name>/SKILL.md`.
 *
 * Mirrors the only layout the production code recognises; anything else is not
 * a skill, and the tests assert that directories without SKILL.md are ignored.
 */
export function fakePkg(t, names, prefix = 'xgr-pkg-') {
  const pkg = tmpDir(t, prefix);
  for (const name of names) {
    const dir = path.join(pkg, 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `# ${name}\n`);
  }
  return pkg;
}

/**
 * Copy a bundled skill from the fake package into an agent root.
 * @returns {string} absolute path of the copy
 */
export function deploySkill(pkg, root, name, as = name) {
  const src = path.join(pkg, 'skills', name);
  const dest = path.join(root, as);
  fs.cpSync(src, dest, { recursive: true });
  return dest;
}

/** Overwrite a deployed skill's SKILL.md to simulate a user-edited copy. */
export function editSkill(dir, content) {
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
}
