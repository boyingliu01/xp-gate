import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  isFile, isDir, listFiles, hashTree, sameTree, rmrf, copyTree,
  readJson, writeJson, stamp, stripNul,
} from '../scripts/lib/util.mjs';
import { tmpDir } from './fixtures.mjs';

const BACKSLASH = String.fromCharCode(92);

test('isFile / isDir return false for a nonexistent path instead of throwing', () => {
  // Both are guards used everywhere; throwing would turn a missing agent
  // directory into a crashed reinstall.
  assert.equal(isFile('/no/such/file/anywhere'), false);
  assert.equal(isDir('/no/such/dir/anywhere'), false);
});

test('isFile and isDir distinguish the two kinds', (t) => {
  const dir = tmpDir(t);
  const file = path.join(dir, 'a.txt');
  fs.writeFileSync(file, 'x');

  assert.equal(isFile(file), true);
  assert.equal(isDir(file), false);
  assert.equal(isFile(dir), false);
  assert.equal(isDir(dir), true);
});

test('listFiles returns forward-slash relative paths sorted, walking nested dirs', (t) => {
  const dir = tmpDir(t);
  fs.mkdirSync(path.join(dir, 'sub', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'z.txt'), 'z');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
  fs.writeFileSync(path.join(dir, 'sub', 'deep', 'n.txt'), 'n');

  const files = listFiles(dir);

  assert.deepEqual(files, ['a.txt', 'sub/deep/n.txt', 'z.txt']);
  // A Windows backslash here would make two identical trees compare unequal.
  assert.ok(files.every((f) => !f.includes(BACKSLASH)));
});

test('listFiles skips node_modules, .git and other noise directories', (t) => {
  const dir = tmpDir(t);
  for (const skip of ['node_modules', '.git', '__pycache__', '.svn']) {
    fs.mkdirSync(path.join(dir, skip), { recursive: true });
    fs.writeFileSync(path.join(dir, skip, 'junk.txt'), 'junk');
  }
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'keep');

  assert.deepEqual(listFiles(dir), ['keep.txt']);
});

test('listFiles returns an empty listing rather than throwing on an unreadable root', () => {
  assert.deepEqual(listFiles('/definitely/not/here'), []);
});

test('hashTree is order-independent and content-sensitive', (t) => {
  const a = tmpDir(t);
  const b = tmpDir(t);
  // Creation order must not leak into the hash, or sameTree reports permanent
  // drift and every reinstall rewrites a tree that was already correct.
  for (const name of ['one.txt', 'two.txt', 'three.txt']) fs.writeFileSync(path.join(b, name), name);
  for (const name of ['three.txt', 'two.txt', 'one.txt']) fs.writeFileSync(path.join(a, name), name);

  assert.equal(hashTree(a), hashTree(b));

  fs.writeFileSync(path.join(b, 'two.txt'), 'changed');
  assert.notEqual(hashTree(a), hashTree(b));
});

test('hashTree distinguishes a renamed file from an identical one', (t) => {
  const a = tmpDir(t);
  const b = tmpDir(t);
  fs.writeFileSync(path.join(a, 'x.txt'), 'same');
  fs.writeFileSync(path.join(b, 'y.txt'), 'same');

  // If names were ignored, a copy could report "ok" while missing a file.
  assert.notEqual(hashTree(a), hashTree(b));
});

test('sameTree compares contents, not just existence', (t) => {
  const a = tmpDir(t);
  const b = tmpDir(t);
  fs.writeFileSync(path.join(a, 'f.txt'), 'v1');
  fs.writeFileSync(path.join(b, 'f.txt'), 'v1');
  assert.equal(sameTree(a, b), true);

  fs.writeFileSync(path.join(b, 'f.txt'), 'v2');
  assert.equal(sameTree(a, b), false);
});

test('sameTree returns false when either side is missing or is a file', (t) => {
  const a = tmpDir(t);
  fs.writeFileSync(path.join(a, 'f.txt'), 'x');

  assert.equal(sameTree(a, '/no/such/dir'), false);
  assert.equal(sameTree('/no/such/dir', a), false);
  assert.equal(sameTree(path.join(a, 'f.txt'), a), false);
});

test('copyTree replaces the destination so stale files cannot survive', (t) => {
  const src = tmpDir(t);
  const dest = path.join(tmpDir(t), 'copy');
  fs.writeFileSync(path.join(src, 'new.txt'), 'new');
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'stale.txt'), 'stale');

  copyTree(src, dest);

  assert.equal(isFile(path.join(dest, 'new.txt')), true);
  // A leftover file would make the copy drift from its source forever.
  assert.equal(isFile(path.join(dest, 'stale.txt')), false);
});

test('rmrf on a missing path is a no-op', () => {
  assert.doesNotThrow(() => rmrf('/no/such/path/to/remove'));
});

test('readJson returns null for missing and malformed files', (t) => {
  const dir = tmpDir(t);
  const broken = path.join(dir, 'broken.json');
  fs.writeFileSync(broken, '{ not json');

  assert.equal(readJson('/no/such/file.json'), null);
  assert.equal(readJson(broken), null);
});

test('readJson round-trips through writeJson', (t) => {
  const dir = tmpDir(t);
  const p = path.join(dir, 'nested', 'deep', 'v.json');
  writeJson(p, { a: 1, b: ['x'] });

  assert.deepEqual(readJson(p), { a: 1, b: ['x'] });
  assert.ok(fs.readFileSync(p, 'utf8').endsWith('\n'));
});

test('stamp produces a fixed-width, sortable timestamp', () => {
  assert.equal(stamp(new Date(2026, 0, 5, 7, 8, 9)), '20260105-070809');
  // Sorting run directories depends on zero padding.
  assert.match(stamp(new Date(2026, 0, 5, 7, 8, 9)), /^\d{8}-\d{6}$/);
});

test('stripNul removes NUL bytes that Windows console output introduces', () => {
  // reg.exe output is UTF-16 and arrives NUL-interleaved; leaving them in
  // breaks every downstream regex.
  assert.equal(stripNul('a\0b\0c'), 'abc');
  assert.equal(stripNul(null), '');
  assert.equal(stripNul(undefined), '');
  assert.equal(stripNul(0), '0');
});
