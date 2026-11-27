import test from 'node:test';
import assert from 'node:assert/strict';

import { delphiSeats } from '../scripts/lib/delphi.mjs';

// ---------------------------------------------------------------------------
// Reading the Delphi seats out of .delphi-config.json.
//
// The check that reads them used to look only at a top-level `pinned_models`,
// but the shipped schema has no such key: seats live under
// profiles[active_profile].experts, each carrying provider + model, and that is
// how the product resolves them. A perfectly valid config therefore reported
// "pinned_models 只有 0 席" and failed every verify run -- which is how a check
// that is always red stops being read.
//
// These tests pin the shape the product actually uses, and keep the legacy
// top-level form working so an older file still verifies.
// ---------------------------------------------------------------------------

const profile = (experts) => ({
  active_profile: 'p',
  profiles: { p: { experts } },
  channels: ['external'],
});

test('delphiSeats reads seats from the active profile, which is the shipped shape', () => {
  const seats = delphiSeats(profile({
    architecture: { provider: 'whalecloud', model: 's-deepseek-v4.1-flash' },
    technical: { provider: 'whalecloud', model: 's-glm-5.3-flash' },
    feasibility: { provider: 'whalecloud', model: 's-qwen3.8-flash' },
  }));
  assert.equal(seats.length, 3);
  assert.deepEqual(seats.map(([role, s]) => [role, s.model]), [
    ['architecture', 's-deepseek-v4.1-flash'],
    ['technical', 's-glm-5.3-flash'],
    ['feasibility', 's-qwen3.8-flash'],
  ]);
});

test('delphiSeats still accepts the legacy top-level pinned_models form', () => {
  // An older file must keep verifying rather than be told to migrate.
  const seats = delphiSeats({
    active_profile: 'p',
    pinned_models: { a: 'm-a', b: 'm-b', c: 'm-c' },
    profiles: { p: { experts: { a: { model: 'ignored' } } } },
  });
  assert.deepEqual(seats.map(([, s]) => s.model), ['m-a', 'm-b', 'm-c']);
});

test('delphiSeats ignores a profile that is not the active one', () => {
  // Reading the wrong profile would report a stale roster as current.
  const cfg = {
    active_profile: 'live',
    profiles: {
      live: { experts: { a: { model: 'current' } } },
      old: { experts: { a: { model: 'stale' }, b: { model: 's' }, c: { model: 's' } } },
    },
  };
  assert.deepEqual(delphiSeats(cfg).map(([, s]) => s.model), ['current']);
});

test('delphiSeats returns empty for a missing config instead of throwing', () => {
  // verify must report "0 seats", not crash, when the file was purged.
  assert.deepEqual(delphiSeats(null), []);
  assert.deepEqual(delphiSeats({}), []);
  assert.deepEqual(delphiSeats({ active_profile: 'nope', profiles: {} }), []);
});

test('delphiSeats tolerates a seat with no model', () => {
  // A half-written config should surface as a missing model, not as "3 seats".
  const seats = delphiSeats(profile({
    a: { provider: 'x', model: 'm-a' },
    b: { provider: 'x' },
    c: null,
  }));
  assert.equal(seats.length, 3);
  assert.deepEqual(seats.map(([, s]) => s && s.model), ['m-a', undefined, undefined]);
});
