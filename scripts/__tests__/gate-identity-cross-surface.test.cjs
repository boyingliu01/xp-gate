#!/usr/bin/env node
/**
 * @test REQ-GATEID-002 — cross-surface consistency: one declaration, many verifications
 * @intent Guard the "copied fact" defect class. A gate's number is a positional
 *         label; its name is its identity. Four surfaces used to each declare
 *         "number -> name", three agreed, and `gate-coverage.js` alone was
 *         inverted. Deleting that one table is NOT enough: it removes today's
 *         copy without removing the act of copying. This test derives every
 *         surface from `githooks/gate-registry.sh` and compares them, so a new
 *         handwritten copy fails here instead of misleading the next reader.
 * @covers AC-GATEID-002-01, AC-GATEID-002-02, AC-GATEID-002-03
 * @covers AC-GATEID-002-04, AC-GATEID-002-05, AC-GATEID-002-06
 * @covers AC-GATEID-001-01, AC-GATEID-001-03, AC-GATEID-001-05
 *
 * Written before the implementation (TDD RED). At the time of writing it fails
 * for the real reason, not for a missing import:
 *
 *   9  registry says build-integrity, gate-coverage says SAST Security
 *   10 registry says sast,            gate-coverage says Build Integrity
 *
 * The real fix is to DERIVE gate-coverage's table from the registry, which is
 * why this file reads both and compares rather than asserting literals.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REGISTRY_PATH = path.join(REPO_ROOT, 'githooks', 'gate-registry.sh');

// The parser is imported, NOT re-implemented here. A test that carries its own
// second copy of the parsing rules is the same "copied fact" defect this file
// exists to catch — it would agree with itself while disagreeing with reality.
const identity = require(path.join(REPO_ROOT, 'src', 'npm-package', 'lib', 'gate-identity.js'));

const registryRows = identity.parseRegistry(fs.readFileSync(REGISTRY_PATH, 'utf8'));

test('AC-GATEID-002-01: registry parses to the gates the hooks actually run', () => {
  assert.ok(registryRows.length >= 14, `expected at least 14 registry rows, got ${registryRows.length}`);

  const byNumber = new Map(registryRows.map((row) => [row.number, row.name]));
  // These two are the entire #738 defect. Spelled out explicitly so a future
  // inversion fails with a message that explains itself.
  assert.strictEqual(byNumber.get('9'), 'build-integrity', 'gate 9 must be build-integrity');
  assert.strictEqual(byNumber.get('10'), 'sast', 'gate 10 must be sast');

  const numbers = registryRows.map((row) => row.number);
  assert.strictEqual(new Set(numbers).size, numbers.length, 'duplicate gate numbers in registry');
  const names = registryRows.map((row) => row.name);
  assert.strictEqual(new Set(names).size, names.length, 'duplicate gate names in registry');
});

test('AC-GATEID-002-02: every declared impl exists on disk', () => {
  const missing = [];
  for (const row of registryRows) {
    if (row.impl === 'inline') continue;
    const candidates = [
      path.join(REPO_ROOT, 'githooks', row.impl),
      path.join(REPO_ROOT, 'githooks', 'lib', row.impl),
    ];
    if (!candidates.some((candidate) => fs.existsSync(candidate))) missing.push(`${row.name} -> ${row.impl}`);
  }
  assert.deepStrictEqual(missing, [], `registry declares impls that do not exist: ${missing.join(', ')}`);
});

test('AC-GATEID-002-03 / AC-GATEID-001-01: gate-coverage no longer declares its own number->name table', () => {
  const coverageSource = fs.readFileSync(
    path.join(REPO_ROOT, 'src', 'npm-package', 'lib', 'gate-coverage.js'),
    'utf8',
  );

  // The literal table shape that carried the inversion.
  assert.ok(
    !/GATE_TABLE\s*=\s*\[\s*\{/.test(coverageSource),
    'gate-coverage.js must derive its gate table from the registry, not declare a literal array',
  );
  // The swap table and its false "the producer numbers them the other way round" claim.
  assert.ok(
    !/PRODUCER_KEYS\s*=/.test(coverageSource),
    'gate-coverage.js must not carry a handwritten producer-key table (the inverted mapping lived there)',
  );
  assert.ok(
    !/the producer numbers them the other way round/i.test(coverageSource),
    'the falsified comment justifying the swap table must not remain',
  );
});

test('AC-GATEID-001-05: no production code hardcodes a number->name gate mapping', () => {
  // Scan roots are PRODUCTION code only. Test fixtures legitimately carry
  // synthetic gate numbers — that is how a bad input is constructed — so they
  // are exempt. The exemption does not re-open the revert loop: restoring the
  // old mapping requires putting the literal back in production code.
  const roots = [
    path.join(REPO_ROOT, 'src', 'npm-package', 'lib'),
    path.join(REPO_ROOT, 'src', 'npm-package', 'bin'),
  ];

  const isExempt = (filePath) => {
    const segments = path.relative(REPO_ROOT, filePath).split(path.sep);
    return segments.some((segment) => segment === '__tests__' || segment.startsWith('fixture'));
  };

  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      if (isExempt(full)) continue;
      const source = fs.readFileSync(full, 'utf8');
      // { gate: 9, name: 'SAST Security' } and friends.
      const pattern = /\{\s*gate\s*:\s*\d+\s*,\s*name\s*:\s*['"`]/g;
      const hits = source.match(pattern);
      if (hits) offenders.push(`${path.relative(REPO_ROOT, full)} (${hits.length}x)`);
    }
  };
  roots.filter((root) => fs.existsSync(root)).forEach(walk);

  assert.deepStrictEqual(offenders, [], `handwritten gate number->name literals in production code: ${offenders.join(', ')}`);
});

test('AC-GATEID-002-04/05: cross-surface checker is injectable and reports the inverted row', () => {
  // The checker is required to be a PURE function so a corrupt row can be
  // injected. Modifying the real registry inside a test would pollute the
  // worktree and could not run under parallel CI.
  const identityPath = path.join(REPO_ROOT, 'src', 'npm-package', 'lib', 'gate-identity.js');
  assert.ok(fs.existsSync(identityPath), 'src/npm-package/lib/gate-identity.js must exist');
  const identity = require(identityPath);
  assert.strictEqual(typeof identity.checkCrossSurface, 'function', 'checkCrossSurface must be exported');

  // AC-002-05: the real registry must be clean.
  const coverage = require(path.join(REPO_ROOT, 'src', 'npm-package', 'lib', 'gate-coverage.js'));
  // gate-coverage renders the pre-commit gates; compare it against exactly the
  // pre-commit rows, not the whole registry (pre-push rows are registered for
  // identity lookup, not for this report).
  const preCommitRows = registryRows.filter((row) => row.hook === 'pre-commit');
  const derived = identity.deriveGateTable(preCommitRows);
  const violationsOfDerived = identity.checkCrossSurface(preCommitRows, {
    'gate-coverage': new Map(derived.map((row) => [String(row.gate), row.slug])),
  });
  assert.deepStrictEqual(violationsOfDerived, [], 'derived table must agree with the registry rows it came from');
  assert.ok(coverage.STATUS, 'gate-coverage should still export STATUS');

  // AC-002-04: an injected inversion MUST be reported. Two assertions in the
  // same test, so a checker that always returns [] cannot pass as green.
  const corrupted = preCommitRows.map((row) => ((row.number === '9' || row.number === '10')
    ? { ...row, name: row.number === '9' ? 'sast' : 'build-integrity' }
    : row));
  const violations = identity.checkCrossSurface(corrupted, {
    'gate-coverage': new Map(derived.map((row) => [String(row.gate), row.slug])),
  });
  assert.ok(violations.length >= 2, 'injecting the historical 9/10 inversion must produce violations');
  const reportedNumbers = violations.map((violation) => String(violation.number ?? violation.gate ?? ''));
  assert.ok(reportedNumbers.includes('9'), `violation must name gate 9, got ${JSON.stringify(violations)}`);
  assert.ok(reportedNumbers.includes('10'), `violation must name gate 10, got ${JSON.stringify(violations)}`);
});

// ---------------------------------------------------------------------------
// AC-GATEID-001-06: the report-key override set cannot drift away from the rows.
//
// The single override (code-quality -> gate1_static_analysis) lives beside the
// rows rather than in a JS map, because a JS copy is the exact defect this
// sprint removes. But living beside them is not the same as being BOUND to them:
// rename or delete the code-quality row and the override silently points at
// nothing, so its correction stops applying while the file still looks
// consistent. Nothing about the file's shape would reveal it.
// ---------------------------------------------------------------------------
test('AC-GATEID-001-06: every report-key override names a gate the registry declares', () => {
  const registry = identity.loadRegistry();
  const rows = identity.parseRegistry(registry.text);
  const overrides = identity.parseReportKeyOverrides(registry.text);
  const slugs = new Set(rows.map((row) => row.name));

  const orphans = [...overrides.keys()].filter((key) => !slugs.has(key));
  assert.deepStrictEqual(
    orphans,
    [],
    'these overrides point at gates the registry does not declare, so their '
      + 'correction is dead code:' + JSON.stringify(orphans),
  );

  // An override equal to the default derivation is a no-op dressed as a
  // deviation: it advertises an exception that does not exist, and it makes a
  // genuine future override indistinguishable from this one.
  for (const [slug, key] of overrides.entries()) {
    const row = rows.find((candidate) => candidate.name === slug);
    assert.notStrictEqual(
      key,
      identity.reportKey(row, identity.EMPTY_OVERRIDES),
      `override for ${slug} matches the default derivation, so it declares a `
        + 'deviation that does not exist',
    );
  }
});

// ---------------------------------------------------------------------------
// AC-GATEID-001-07: the override is READ, not restated.
//
// During this sprint the override was briefly disabled by a one-word edit: the
// shell side began marking the array `export GATE_REPORT_KEY_OVERRIDES=(`, and a
// parser anchored on the bare assignment stopped matching. The set came back
// EMPTY -- no error, no warning -- and code-quality would have emitted the wrong
// report key. That is the same silent-mismatch shape as #738, so it gets a test.
// ---------------------------------------------------------------------------
test('AC-GATEID-001-07: the override block parses with and without the export keyword', () => {
  const body = '"code-quality|gate1_static_analysis"';
  const plain = 'GATE_REPORT_KEY_OVERRIDES=(\n  ' + body + '\n)\n';
  const exported = 'export GATE_REPORT_KEY_OVERRIDES=(\n  ' + body + '\n)\n';

  for (const [label, text] of [['plain', plain], ['export', exported]]) {
    const parsed = identity.parseReportKeyOverrides(text);
    assert.strictEqual(parsed.get('code-quality'), 'gate1_static_analysis',
      `the ${label} form must parse; an unmatched form returns an EMPTY map, `
        + 'which silently disables the correction instead of failing');
  }

  // The real registry must actually declare it, or the override silently stops
  // existing the day someone deletes the block.
  const live = identity.parseReportKeyOverrides(identity.loadRegistry().text);
  assert.strictEqual(live.get('code-quality'), 'gate1_static_analysis',
    'the shipped registry must still declare the one known deviation');
});

