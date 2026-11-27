import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { newerSkillDir } from '../scripts/lib/selfsync.mjs';

/**
 * Which tree install.mjs treats as the source of truth.
 *
 * MEASURED on the 2.0.1 release: the repo was at 2.0.1, the canonical copy
 * under ~/.local/share/xp-gate/skills/ was still 2.0.0, and `install.mjs`
 * reported "已写入 0 个副本". defaultSource() returns the canonical dir
 * whenever it exists, so a newer checkout can never update the copies it
 * installed -- the release does not propagate. The newer tree must win.
 */

function tree(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xgr-src-'));
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: reinstall-xp-gate\n---\n');
  if (version !== null) fs.writeFileSync(path.join(dir, 'VERSION'), `${version}\n`);
  return dir;
}

test('newerSkillDir picks the tree with the higher VERSION', () => {
  const older = tree('2.0.0');
  const newer = tree('2.0.1');
  try {
    assert.equal(newerSkillDir(older, newer), newer);
    assert.equal(newerSkillDir(newer, older), newer);
  } finally {
    fs.rmSync(older, { recursive: true, force: true });
    fs.rmSync(newer, { recursive: true, force: true });
  }
});

test('newerSkillDir keeps the first tree when the versions match', () => {
  const a = tree('2.0.1');
  const b = tree('2.0.1');
  try {
    assert.equal(newerSkillDir(a, b), a);
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});

test('newerSkillDir ignores a candidate that is not a skill tree', () => {
  const skill = tree('2.0.1');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'xgr-src-'));
  try {
    assert.equal(newerSkillDir(skill, empty), skill);
    assert.equal(newerSkillDir(empty, skill), skill);
  } finally {
    fs.rmSync(skill, { recursive: true, force: true });
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('newerSkillDir treats a missing VERSION as older than any real one', () => {
  const unversioned = tree(null);
  const versioned = tree('2.0.1');
  try {
    assert.equal(newerSkillDir(unversioned, versioned), versioned);
  } finally {
    fs.rmSync(unversioned, { recursive: true, force: true });
    fs.rmSync(versioned, { recursive: true, force: true });
  }
});
