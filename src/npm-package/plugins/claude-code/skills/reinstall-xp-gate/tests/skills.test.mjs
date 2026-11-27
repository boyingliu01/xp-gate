import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { bundledSkills, planSkillCopies, summarizeRows, applySkillCopies } from '../scripts/lib/skills.mjs';
import { tmpDir, fakePkg, deploySkill, editSkill } from './fixtures.mjs';

test('bundledSkills lists only directories that actually contain SKILL.md', (t) => {
  const pkg = fakePkg(t, ['alpha', 'beta']);
  // A directory without SKILL.md is not a skill; counting it would make every
  // agent look "missing" that entry forever.
  fs.mkdirSync(path.join(pkg, 'skills', 'notaskill'), { recursive: true });

  assert.deepEqual(bundledSkills(pkg), ['alpha', 'beta']);
});

test('bundledSkills returns [] for a missing package dir instead of throwing', () => {
  assert.deepEqual(bundledSkills(''), []);
  assert.deepEqual(bundledSkills('/no/such/pkg'), []);
  assert.deepEqual(bundledSkills(null), []);
});

test('planSkillCopies classifies each agent root as ok / drift / missing', (t) => {
  const pkg = fakePkg(t, ['alpha']);
  const okRoot = tmpDir(t);
  const driftRoot = tmpDir(t);
  const emptyRoot = tmpDir(t);

  deploySkill(pkg, okRoot, 'alpha');
  editSkill(deploySkill(pkg, driftRoot, 'alpha'), '# edited by user\n');

  const { names, rows } = planSkillCopies(pkg, [
    { agent: 'OK', dir: okRoot },
    { agent: 'Drift', dir: driftRoot },
    { agent: 'Empty', dir: emptyRoot },
  ]);

  assert.deepEqual(names, ['alpha']);
  const byAgent = Object.fromEntries(rows.map((r) => [r.agent, r.state]));
  assert.equal(byAgent.OK, 'ok');
  assert.equal(byAgent.Drift, 'drift');
  assert.equal(byAgent.Empty, 'missing');
});

test('planSkillCopies reports extra local files separately from content drift', (t) => {
  // Measured on the real machine: ~/xp-gate/skills/sprint-flow carried its own
  // __tests__/ while the npm package does not ship them. All 26 shared files
  // matched byte for byte, yet the whole skill was reported as 'drift' and
  // `verify` failed. The distribution was correct; the verdict was not.
  //
  // 'extra' is not 'ok': a stray file can still shadow real content, so it stays
  // visible. It just must not be described as a damaged copy.
  const pkg = fakePkg(t, ['alpha']);
  const extraRoot = tmpDir(t);
  const deployed = deploySkill(pkg, extraRoot, 'alpha');
  fs.mkdirSync(path.join(deployed, '__tests__'), { recursive: true });
  fs.writeFileSync(path.join(deployed, '__tests__', 'local.test.cjs'), '// source repo only\n');

  const { rows } = planSkillCopies(pkg, [{ agent: 'Source', dir: extraRoot }]);
  assert.equal(rows[0].state, 'extra');
  assert.deepEqual(rows[0].extra, ['__tests__/local.test.cjs']);
});

test('planSkillCopies still calls a changed shared file drift, even with extras present', (t) => {
  // Extras must not mask real damage: an edited SKILL.md is still drift.
  const pkg = fakePkg(t, ['alpha']);
  const root = tmpDir(t);
  const deployed = deploySkill(pkg, root, 'alpha');
  fs.mkdirSync(path.join(deployed, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(deployed, 'logs', 'run.txt'), 'x\n');
  editSkill(deployed, '# user edited the real file\n');

  const { rows } = planSkillCopies(pkg, [{ agent: 'Mixed', dir: root }]);
  assert.equal(rows[0].state, 'drift');
});

test('planSkillCopies is read-only', (t) => {
  const pkg = fakePkg(t, ['alpha']);
  const root = tmpDir(t);

  planSkillCopies(pkg, [{ agent: 'A', dir: root }]);

  // Planning must not create the destination; that is apply's job.
  assert.equal(fs.existsSync(path.join(root, 'alpha')), false);
});

test('summarizeRows tallies per-agent totals by state', () => {
  const summary = summarizeRows([
    { agent: 'A', state: 'ok' },
    { agent: 'A', state: 'drift' },
    { agent: 'B', state: 'missing' },
  ]);

  assert.deepEqual(summary.get('A'), { total: 2, ok: 1, drift: 1, missing: 0, extra: 0 });
  assert.deepEqual(summary.get('B'), { total: 1, ok: 0, drift: 0, missing: 1, extra: 0 });
});

test('summarizeRows counts the extra state instead of producing null', (t) => {
  // `entry[row.state] += 1` on a counter that was never initialised yields
  // NaN/null rather than throwing, so a new state silently breaks the tally
  // that `verify` reports on. Caught here rather than in production.
  const rows = [
    { agent: 'A', state: 'ok' },
    { agent: 'A', state: 'extra' },
    { agent: 'A', state: 'extra' },
  ];
  const summary = summarizeRows(rows);
  assert.deepEqual(summary.get('A'), { total: 3, ok: 1, drift: 0, missing: 0, extra: 2 });
});

test('summarizeRows returns an empty map for no rows', () => {
  assert.equal(summarizeRows([]).size, 0);
});

test('applySkillCopies with dryRun touches rows but writes nothing', (t) => {
  const pkg = fakePkg(t, ['alpha']);
  const root = tmpDir(t);
  const { rows } = planSkillCopies(pkg, [{ agent: 'A', dir: root }]);

  const touched = applySkillCopies(rows, { dryRun: true });

  assert.equal(touched.length, 1);
  assert.equal(fs.existsSync(path.join(root, 'alpha')), false);
});

test('applySkillCopies backs up a drifted copy before overwriting it', (t) => {
  const pkg = fakePkg(t, ['alpha']);
  const root = tmpDir(t);
  const backupRoot = tmpDir(t);
  const userEdit = '# local changes I do not want to lose\n';
  editSkill(deploySkill(pkg, root, 'alpha'), userEdit);

  const { rows } = planSkillCopies(pkg, [{ agent: 'My Agent', dir: root }]);
  const touched = applySkillCopies(rows, { backupRoot });

  // The edit must survive in the backup even though the live copy is
  // overwritten -- this is the difference between "update" and "data loss".
  const backupDir = path.join(backupRoot, 'My-Agent', 'alpha');
  assert.equal(fs.readFileSync(path.join(backupDir, 'SKILL.md'), 'utf8'), userEdit);
  assert.match(fs.readFileSync(path.join(root, 'alpha', 'SKILL.md'), 'utf8'), /# alpha/);
  assert.equal(touched[0].applied, true);
});

test('applySkillCopies sanitises agent names used as backup path segments', (t) => {
  const pkg = fakePkg(t, ['alpha']);
  const root = tmpDir(t);
  const backupRoot = tmpDir(t);
  editSkill(deploySkill(pkg, root, 'alpha'), 'edited');

  // A slash or dot-dot in an agent label must not escape the backup root.
  const { rows } = planSkillCopies(pkg, [{ agent: '../../evil name!', dir: root }]);
  applySkillCopies(rows, { backupRoot });

  const entries = fs.readdirSync(backupRoot);
  assert.equal(entries.length, 1);
  assert.ok(!entries[0].includes('/'));
  assert.ok(!entries[0].includes('..'));
  assert.match(entries[0], /^[a-z0-9-]+$/i);
});

test('applySkillCopies leaves "ok" rows alone', (t) => {
  const pkg = fakePkg(t, ['alpha']);
  const root = tmpDir(t);
  deploySkill(pkg, root, 'alpha');

  const { rows } = planSkillCopies(pkg, [{ agent: 'A', dir: root }]);
  const touched = applySkillCopies(rows, { backupRoot: tmpDir(t) });

  assert.deepEqual(touched, []);
});
