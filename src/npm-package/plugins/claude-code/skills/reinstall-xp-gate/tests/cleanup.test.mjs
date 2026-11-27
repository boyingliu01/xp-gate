import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { pruneBackups, BACKUP_KEEP } from '../scripts/lib/util.mjs';
import { classify } from '../scripts/lib/tools.mjs';
import { tmpDir } from './fixtures.mjs';

// pruneBackups bounds the backup directory every install grows. The bug it
// fixes was measured on this machine: 50 backups / 11 MB, dating back to v1.1.0,
// because nothing ever removed one. A pruner that deletes the WRONG entries is
// worse than no pruner, so the survivors are asserted, not just the count.

/** Create `<root>/<name>` directories, each holding a marker file. */
function seed(root, names) {
  for (const name of names) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, 'marker.txt'), name);
  }
}

test('pruneBackups keeps the newest stamps per agent and removes the rest', (t) => {
  const root = tmpDir(t);
  const names = [
    'DSH-20261110-174846',
    'DSH-20261117-192150',
    'DSH-20261120-225508',
    'DSH-20261120-234926',
    'DSH-20261121-072040',
  ];
  seed(root, names);

  const removed = pruneBackups(root, 3);

  assert.deepEqual(removed.sort(), ['DSH-20261110-174846', 'DSH-20261117-192150']);
  assert.deepEqual(fs.readdirSync(root).sort(), [
    'DSH-20261120-225508',
    'DSH-20261120-234926',
    'DSH-20261121-072040',
  ]);
});

test('the cap is per agent, so one install run keeps every agent recoverable', (t) => {
  // All nine agent copies are backed up with the same timestamp by a single
  // install. A global cap of 3 would delete six of the backups that run had
  // just written, so rolling one agent back would be impossible while its
  // siblings survived -- the cap would be spent on simultaneity, not history.
  const root = tmpDir(t);
  const agents = ['CodeBuddy', 'DSH', 'DWS', 'Generic-agents', 'OpenCode', 'Qoder', 'Qoder-CN', 'Trae-CN', 'WorkBuddy'];
  seed(root, agents.map((a) => `${a}-20261121-082907`));

  assert.deepEqual(pruneBackups(root, 3), []);
  assert.equal(fs.readdirSync(root).length, 9);
});

test('pruneBackups trims old runs of each agent independently', (t) => {
  const root = tmpDir(t);
  seed(root, [
    'DSH-20261110-174846', 'DSH-20261117-192150', 'DSH-20261120-234926',
    'WorkBuddy-20261111-101000', 'WorkBuddy-20261112-101000',
  ]);

  const removed = pruneBackups(root, 1);

  // Each label keeps its own newest entry; the busy label loses its older runs.
  assert.deepEqual(removed.sort(), ['DSH-20261110-174846', 'DSH-20261117-192150', 'WorkBuddy-20261111-101000']);
  assert.deepEqual(fs.readdirSync(root).sort(), ['DSH-20261120-234926', 'WorkBuddy-20261112-101000']);
});

test('pruneBackups sorts by the stamp in the name, not by mtime', (t) => {
  // A restored or copied directory carries an mtime that says nothing about
  // which backup is newer, so mtime ordering would delete the wrong one.
  const root = tmpDir(t);
  seed(root, ['WorkBuddy-20261120-234927', 'WorkBuddy-20261110-174846']);
  const old = path.join(root, 'WorkBuddy-20261110-174846');
  const now = new Date();
  fs.utimesSync(old, now, now); // newest mtime, oldest stamp

  assert.deepEqual(pruneBackups(root, 1), ['WorkBuddy-20261110-174846']);
  assert.deepEqual(fs.readdirSync(root), ['WorkBuddy-20261120-234927']);
});

test('pruneBackups never touches a directory it does not recognise', (t) => {
  // An operator's own directory under the same root must survive: this
  // function deletes without a prompt, so "unknown shape" has to mean "leave
  // alone", never "probably a backup".
  const root = tmpDir(t);
  seed(root, ['DSH-20261110-174846', 'DSH-20261111-174846', 'keep-me', 'notes', 'DSH-nodate']);

  pruneBackups(root, 1);

  const left = fs.readdirSync(root).sort();
  assert.deepEqual(left, ['DSH-20261111-174846', 'DSH-nodate', 'keep-me', 'notes']);
});

test('pruneBackups is a no-op below the keep count or on a missing root', (t) => {
  const root = tmpDir(t);
  seed(root, ['DSH-20261110-174846']);
  assert.deepEqual(pruneBackups(root, BACKUP_KEEP), []);
  assert.equal(fs.readdirSync(root).length, 1);

  assert.deepEqual(pruneBackups(path.join(root, 'does-not-exist')), []);
  // keep < 1 would mean "delete everything"; refusing is safer than obeying.
  seed(root, ['DSH-20261111-174846', 'DSH-20261112-174846', 'DSH-20261113-174846']);
  assert.deepEqual(pruneBackups(root, 0), []);
  assert.equal(fs.readdirSync(root).length, 4);
});

test('classify survives the (value, index, array) shape map passes', async () => {
  // Regression: `rows.map(classify)` hands classify (value, index, array), so
  // the index landed in the `lookup` parameter and every call threw
  // "lookup is not a function". This test drives classify through map with a
  // fake lookup instead of calling toolReport(), which would shell out to npm,
  // pip and the network for all 8 tools -- that probe is measured in seconds
  // and hung this suite once.
  const rows = [
    { present: true, kind: 'npm', version: '1.0.0', latest: '' },
    { present: true, kind: 'npm', version: '2.0.0', latest: '' },
  ];
  const looked = [];
  const lookup = async (row) => { looked.push(row.version); return '2.0.0'; };

  const out = await Promise.all(rows.map((row) => classify(row, lookup)));

  assert.deepEqual(out.map((r) => r.status), ['outdated', 'ok']);
  assert.deepEqual(looked, ['1.0.0', '2.0.0'], 'lookup must be the function, not the index');
});
