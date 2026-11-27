import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { labelFor, isOfficialSkillRoot, probeLiveness, agentInstalled, discoverSkillRoots, selfWrittenHome } from '../scripts/lib/agents.mjs';
import { HOME } from '../scripts/lib/proc.mjs';

// discoverSkillRoots() scans the real HOME, so its OUTPUT is not asserted here:
// that would encode this machine's agent layout into the suite. What IS pinned
// is that it runs at all. MEASURED: the split that moved looksLikeSkillRoot to
// agent-paths.mjs left the call in agents.mjs unresolved, and `install.mjs`
// crashed on every machine with "looksLikeSkillRoot is not defined" -- a
// function that exists only to decide whether a candidate path is a directory.
test('discoverSkillRoots runs without throwing', () => {
  const roots = discoverSkillRoots();
  assert.ok(Array.isArray(roots), 'it returns the list of skill roots');
});

const under = (...parts) => `${HOME}/${parts.join('/')}`;

test('labelFor maps known config dirs to their product names', () => {
  assert.equal(labelFor(under('.dsh', 'skills')), 'DSH');
  assert.equal(labelFor(under('.qoder', 'skills')), 'Qoder');
  assert.equal(labelFor(under('.qoder-cn', 'skills')), 'Qoder CN');
  assert.equal(labelFor(under('.config', 'opencode', 'skills')), 'OpenCode');
  assert.equal(labelFor(under('.workbuddy', 'skills')), 'WorkBuddy');
});

test('labelFor derives a readable name for unknown agents', () => {
  // New agents must not need a code change to be labelled sanely.
  assert.equal(labelFor(under('.some-new-agent', 'skills')), 'some new agent');
});

test('isOfficialSkillRoot only accepts the four roots xp-gate itself installs to', () => {
  assert.equal(isOfficialSkillRoot(under('.dsh', 'skills')), true);
  assert.equal(isOfficialSkillRoot(under('.qoder', 'skills')), true);
  assert.equal(isOfficialSkillRoot(under('.trae-cn', 'skills')), false);
  assert.equal(isOfficialSkillRoot(under('.agents', 'skills')), false);
});

test('probeLiveness treats the shared skill store as always live', () => {
  // ~/.agents/skills is a shared repo, not one agent's config; it must never be
  // demoted to "residue" or every symlinked agent loses its skills.
  const r = probeLiveness({ agent: 'Generic agents', dir: under('.agents', 'skills') });
  assert.equal(r.live, true);
  assert.equal(r.reason, 'shared skill store');
});

test('probeLiveness reports not-live with a reason for a nonexistent agent dir', () => {
  const r = probeLiveness({ agent: 'No Such Agent', dir: under('.no-such-agent-xyz', 'skills') });
  assert.equal(r.live, false);
  assert.match(r.reason, /no app\/cli|idle/);
});

test('probeLiveness always returns both fields, whatever the verdict', () => {
  // Callers destructure live/reason unconditionally; a missing key would print
  // "undefined" into the report table.
  for (const entry of [
    { agent: 'Generic agents', dir: under('.agents', 'skills') },
    { agent: 'No Such Agent', dir: under('.nope-xyz', 'skills') },
  ]) {
    const r = probeLiveness(entry);
    assert.equal(typeof r.live, 'boolean');
    assert.equal(typeof r.reason, 'string');
    assert.ok(r.reason.length > 0);
  }
});

test('probeLiveness honours the liveDays window argument', () => {
  // A dir that is neither app- nor CLI-backed falls through to the mtime rule.
  const entry = { agent: 'No Such Agent', dir: under('.nope-xyz', 'skills') };
  assert.equal(probeLiveness(entry, 0).live, false);
  // Missing dir -> Infinity days, past any finite window.
  assert.equal(probeLiveness(entry, 100000).live, false);
});

/**
 * Issue #4: an uninstalled OpenCode stays "live" because xp-gate writes
 * tui.json and skills/ into its config dir, which refreshes the mtime that
 * recency treats as "the user is still here".
 *
 * A home that contains NOTHING but what this toolchain writes is residue.
 * A home that also holds something the agent itself created is not.
 */
function home(layout) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xgr-home-'));
  for (const [name, kind] of Object.entries(layout)) {
    const target = path.join(dir, name);
    if (kind === 'dir') fs.mkdirSync(target);
    else fs.writeFileSync(target, kind);
  }
  return dir;
}

test('selfWrittenHome is true when the dir holds only xp-gate products', () => {
  const dir = home({ 'tui.json': '{}\n', skills: 'dir' });
  try {
    assert.equal(selfWrittenHome(dir), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('selfWrittenHome is false when the agent left something of its own', () => {
  const dir = home({ 'tui.json': '{}\n', skills: 'dir', 'opencode.json': '{}\n' });
  try {
    assert.equal(selfWrittenHome(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('selfWrittenHome is false for an empty dir, which is a fresh install', () => {
  // An agent that just created its config dir has no skills yet. Calling that
  // residue would skip the machine that most needs them.
  const dir = home({});
  try {
    assert.equal(selfWrittenHome(dir), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('probeLiveness does not call a self-written home active', () => {
  // The measured failure: no app, no CLI, and the only reason the agent looked
  // live was that xp-gate had just written tui.json. Recency must not count
  // that as the user coming back.
  const dir = home({ 'tui.json': '{}\n', skills: 'dir' });
  try {
    const r = probeLiveness(
      { agent: 'No Such Agent', dir: path.join(dir, 'skills') },
      30,
      () => dir,
    );
    assert.equal(r.live, false);
    assert.match(r.reason, /no app\/cli/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('probeLiveness still trusts a recent write the agent made itself', () => {
  const dir = home({ 'tui.json': '{}\n', skills: 'dir', 'opencode.json': '{}\n' });
  try {
    const r = probeLiveness(
      { agent: 'No Such Agent', dir: path.join(dir, 'skills') },
      30,
      () => dir,
    );
    assert.equal(r.live, true);
    assert.match(r.reason, /active 0d ago/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('agentInstalled reports a CLI that is not on PATH as absent', () => {
  // The one consumer is verify.mjs, deciding whether xp-gate's unconditional
  // "TUI registration" check is worth reporting. A CLI that cannot be resolved
  // is the signal that the agent is gone; a config directory alone is not
  // evidence, because leftovers survive an uninstall.
  assert.equal(typeof agentInstalled('OpenCode'), 'boolean');
  // A name with no CLI probe can never be "installed" by this measure.
  assert.equal(agentInstalled('Generic agents'), false);
  assert.equal(agentInstalled('No Such Agent'), false);
});
