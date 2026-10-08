/**
 * @test REQ-423
 * @intent Gate MW accepted any evidence that merely LOOKED like three experts.
 *         Nothing tied a record to a real model call, so three copies of one
 *         object -- or three experts all resolving to the same model -- passed.
 *         `channel` makes the provenance explicit and is now REQUIRED.
 * @covers AC-423-01, AC-423-02, AC-423-03, AC-423-04, AC-423-05, AC-423-06, AC-423-08
 *
 * DESIGN NOTE (why a missing `channel` must FAIL rather than default to local):
 * treating an absent field as `local` would be a zero-cost bypass -- omitting
 * one key would let forged external evidence through, which is precisely the
 * defect being fixed. The field is therefore an explicit whitelist: only
 * 'external' or 'local' are accepted, and anything else (missing, typo,
 * capitalised, or unknown) is rejected.
 */

// vitest globals: true — no import needed
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

// Resolved from cwd rather than __dirname: vitest's CJS transform does not
// guarantee __dirname matches the file's real directory, and a wrong value here
// made every assertion report "module not found" instead of a verdict.
const VALIDATOR = join(process.cwd(), 'githooks', 'lib', 'validate-code-walkthrough.cjs');

/**
 * Fixed clock. Must be BEFORE `expires` (the validator rejects `expires <= now`)
 * and AFTER `timestamp`.
 */
const NOW = '2026-10-03T11:30:00.000Z';
const COMMIT = 'a'.repeat(40);
const BRANCH = 'sprint/2026-10-03-p0-p1-gates';

const tempDirs = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'xpgate-423-'));
  tempDirs.push(dir);
  return dir;
}

/** Build one expert record, with `channel: 'external'` unless overridden. */
function expert(overrides = {}) {
  const record = {
    role: overrides.role ?? 'architecture',
    verdict: overrides.verdict ?? 'APPROVED',
    result_type: 'delphi_expert_result',
    requested_model: 'requested_model' in overrides ? overrides.requested_model : 'g-glm-5.3-flash',
    resolved_model: 'resolved_model' in overrides ? overrides.resolved_model : 'glm-5-3-flash-260826',
    channel: 'channel' in overrides ? overrides.channel : 'external',
  };
  return record;
}

/** Three experts with distinct models, by default on the external channel. */
function threeExperts() {
  return [
    expert({ role: 'architecture', requested_model: 'g-glm-5.3-flash', resolved_model: 'glm-5-3-flash-260826' }),
    expert({ role: 'technical', requested_model: 'g-qwen3.8-flash', resolved_model: 'qwen3.8-flash' }),
    expert({ role: 'feasibility', requested_model: 'g-deepseek-flash', resolved_model: 'deepseek-flash' }),
  ];
}

/** Full evidence document; `experts` defaults to three distinct external models. */
function evidence(experts) {
  return {
    commit: COMMIT,
    branch: BRANCH,
    verdict: 'APPROVED',
    timestamp: '2026-10-03T11:00:00.000Z',
    expires: '2026-10-03T12:00:00.000Z',
    consensus_ratio: 1.0,
    experts: experts ?? threeExperts(),
  };
}

/** Run the validator and return {exitCode, output}. */
function runValidator(document) {
  const path = join(makeTempDir(), 'evidence.json');
  try {
    writeFileSync(path, JSON.stringify(document), 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`could not write evidence fixture: ${detail}`);
  }
  try {
    const out = execFileSync('node', [VALIDATOR, path, COMMIT, BRANCH, NOW], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: out };
  } catch (error) {
    const failure = error;
    return { exitCode: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
});

describe('#423 Gate MW requires explicit provenance', () => {
  it('AC-423-01: valid evidence with three distinct external models PASSES', () => {
    const result = runValidator(evidence());
    expect(result.exitCode).toBe(0);
  });

  it('AC-423-02: a MISSING channel is rejected (never defaulted to local)', () => {
    const experts = threeExperts();
    delete experts[0].channel;

    const result = runValidator(evidence(experts));

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/channel/);
  });

  it('AC-423-02: an UNKNOWN channel is rejected', () => {
    const experts = threeExperts();
    experts[0].channel = 'probably-real';

    const result = runValidator(evidence(experts));

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/channel/);
  });

  it('AC-423-02: a MIS-CASED channel is rejected (whitelist is exact)', () => {
    const experts = threeExperts();
    experts[0].channel = 'External';

    const result = runValidator(evidence(experts));

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/channel/);
  });

  it("AC-423-01: channel 'local' is accepted as an explicit value", () => {
    const experts = threeExperts();
    experts[0].channel = 'local';

    const result = runValidator(evidence(experts));

    expect(result.exitCode).toBe(0);
  });

  it('AC-423-03: three experts resolving to the SAME model are rejected', () => {
    // The defect the issue reported: distinct requested_model satisfied the old
    // check while all three actually ran on one model.
    const experts = [
      expert({ role: 'architecture', requested_model: 'a', resolved_model: 'deepseek-flash' }),
      expert({ role: 'technical', requested_model: 'b', resolved_model: 'deepseek-flash' }),
      expert({ role: 'feasibility', requested_model: 'c', resolved_model: 'deepseek-flash' }),
    ];

    const result = runValidator(evidence(experts));

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/resolved_model/);
  });

  it('AC-423-03: two experts sharing a resolved model are rejected', () => {
    const experts = threeExperts();
    experts[0].resolved_model = 'qwen3.8-flash';

    const result = runValidator(evidence(experts));

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/resolved_model/);
  });

  it('AC-423-03: a null resolved_model is rejected', () => {
    // Previously null was explicitly allowed, so a run that never resolved a
    // model still counted as a successful expert.
    const experts = threeExperts();
    experts[0].resolved_model = null;

    const result = runValidator(evidence(experts));

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/resolved_model/);
  });

  it('AC-423-04: resolved models are compared case-insensitively after trimming', () => {
    const experts = threeExperts();
    experts[0].resolved_model = '  QWEN3.8-FLASH  ';

    const result = runValidator(evidence(experts));

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/resolved_model/);
  });

  it('AC-423-05: a non-string channel is rejected', () => {
    const experts = threeExperts();
    experts[0].channel = 42;

    const result = runValidator(evidence(experts));

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/channel/);
  });

  it('AC-423-06: requested_model must still be distinct', () => {
    const experts = threeExperts();
    // Duplicate expert[0]'s requested_model onto expert[1], while leaving both
    // resolved_model values distinct, so only the requested_model check fires.
    experts[1].requested_model = experts[0].requested_model;

    const result = runValidator(evidence(experts));

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/requested_model/);
  });

  it('AC-423-03: every expert needs a channel, not just the first', () => {
    const experts = threeExperts();
    delete experts[0].channel;

    const result = runValidator(evidence(experts));

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/channel/);
  });

  it('AC-423-08: requested_model is deduped case-SENSITIVELY while resolved_model is not', () => {
    // The asymmetry is deliberate and this test is what makes it a contract rather
    // than a typo two fields disagree on:
    //   - `requested_model` is the identifier the gateway was ASKED for. AGENTS.md
    //     requires "three distinct trimmed requested model IDs", and model IDs are
    //     case-sensitive strings at the gateway, so `g-GLM-x` and `g-glm-x` are two
    //     different requests and must not be collapsed.
    //   - `resolved_model` is the answer to "did these actually run on the same
    //     model?" Some gateways report the same model with different casing per
    //     call, so the comparison folds case -- otherwise one model wearing two
    //     casings would satisfy the three-model policy (#423 is exactly that bug).
    // Trimming is common to both: whitespace is not part of either identity.
    const experts = threeExperts();
    experts[1].requested_model = experts[0].requested_model.toUpperCase();
    expect(experts[1].requested_model).not.toBe(experts[0].requested_model);
    expect(experts[1].resolved_model).not.toBe(experts[0].resolved_model);

    const result = runValidator(evidence(experts));

    expect(result.exitCode).toBe(0);

    // And the same shape on the resolved side is still a duplicate.
    const folded = threeExperts();
    folded[1].resolved_model = folded[0].resolved_model.toUpperCase();

    const rejected = runValidator(evidence(folded));

    expect(rejected.exitCode).toBe(1);
    expect(rejected.output).toMatch(/resolved_model/);
  });
});
