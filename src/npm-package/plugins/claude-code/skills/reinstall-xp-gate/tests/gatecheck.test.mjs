import test from 'node:test';
import assert from 'node:assert/strict';

import { verdictOf } from '../scripts/lib/verdict.mjs';

// verdictOf is the only thing standing between a gate's output and the audit's
// verdict. Two failure modes matter:
//   - reading a clean run as broken  -> the audit cries wolf and gets ignored
//   - reading a broken run as clean  -> the audit certifies a dead gate
// Every case below pins one of those.

test('verdictOf reads the explicit block marker', () => {
  assert.equal(verdictOf('❌ BLOCKED - Secrets detected in staged files.'), 'blocked');
  assert.equal(verdictOf('Gate 8 FAILED: command failed'), 'blocked');
});

test('verdictOf reads the explicit pass marker', () => {
  assert.equal(verdictOf('     ✅ PASSED - No secrets detected.'), 'passed');
});

test('verdictOf reads a skip, including the emoji xp-gate actually prints', () => {
  assert.equal(verdictOf('⏭️  SKIPPED - Complexity (no source files to check).'), 'skipped');
  assert.equal(verdictOf('SKIPPED - no supported language files changed'), 'skipped');
});

test('verdictOf treats "Found 0 clones" as passed, not unknown', () => {
  // Gate 2 prints no ✅ marker at all. Without this branch a clean Gate 2 run
  // reads as 'unknown', which is indistinguishable from a broken parser -- the
  // audit would then be unable to tell "gate is fine" from "gate is unreadable".
  assert.equal(verdictOf('Found 0 clones.\ntime: 14.541ms'), 'passed');
});

test('verdictOf reports duplication as detected, not blocked', () => {
  // Measured: `xp-gate check 2` exits 0 with and without clones. Calling this
  // 'blocked' would be a lie about the gate's severity policy.
  assert.equal(verdictOf('Clone found (javascript)\nFound 1 clones.'), 'detected');
  assert.equal(verdictOf('Found 3 clones.'), 'detected');
});

test('verdictOf prefers blocked over detected when both appear', () => {
  // A gate that reports clones AND fails must be read as a failure; the
  // ordering of the regex checks is what guarantees that.
  assert.equal(verdictOf('Found 3 clones.\n❌ BLOCKED'), 'blocked');
});

test('verdictOf returns unknown for output it does not recognise', () => {
  // Silence must never be mistaken for success.
  assert.equal(verdictOf(''), 'unknown');
  assert.equal(verdictOf('npm warn something unrelated'), 'unknown');
});

test('verdictOf does not treat the word FAILED in a path as a failure', () => {
  // A conservative check: "FAILED" appearing as part of a filename is a real
  // possibility in test fixtures, and a false 'blocked' is the safer error, but
  // documenting the current behaviour stops someone "fixing" it blind.
  assert.equal(verdictOf('PASSED - scanned ./failed-tests.js'), 'passed');
});
