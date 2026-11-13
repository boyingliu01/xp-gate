#!/usr/bin/env node
/**
 * @test REQ-CI-BATS-01 — the BATS CI driver splits the suite without losing any of it
 * @intent Gate 5b was 18m47s of a 22m24s pipeline, so it ran in ONE serial step
 *         and had to be made non-blocking to keep that pipeline usable. Moving
 *         it to a blocking matrix reintroduces a way to lose contracts instead
 *         of slowing the pipeline down: a shard that runs nothing, or a file
 *         that no shard runs, reads as green from every job's point of view.
 *
 *         These cases make each of those failures impossible to ship:
 *           1. every .bats file is assigned to exactly one shard (partition)
 *           2. the split balances WORST-CASE cost, not file count
 *           3. a starved shard exits non-zero (never "ran nothing, passed")
 *           4. the workflow still runs the suite as a blocking gate
 *
 *         Case 4 is the one that matters over time: the original regression was
 *         not a slow test, it was a `continue-on-error: true` added to keep CI
 *         usable. A guard that pins "blocking" as a property of the workflow is
 *         what stops that from being re-added quietly.
 * @covers AC-CI-BATS-01-01, AC-CI-BATS-01-02, AC-CI-BATS-01-03, AC-CI-BATS-01-04
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DRIVER = path.join(ROOT, 'scripts', 'run-bats-ci.cjs');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'quality-gates.yml');
const BATS_DIR = path.join(ROOT, 'githooks', '__tests__');

const { listSuites, planShards, parseShard, MEASURED_MS } = require(DRIVER);

describe('REQ-CI-BATS-01: the shard plan is a partition of the whole suite', () => {
  const suites = listSuites();

  it('sees the real suite directory (anti-vacuity)', () => {
    // If this ever reads 0 the remaining assertions would all pass by being
    // empty, which is exactly the shape of failure they exist to catch.
    expect(suites.length).toBeGreaterThan(100);
    expect(suites.every((f) => f.endsWith('.bats'))).toBe(true);
  });

  it('names suites by a path that RESOLVES from the repo root', () => {
    // The first real CI run (43345754064) failed all four shards in one second
    // with:
    //   ERROR: Test file ".../xp-gate/adapter-shell-scope.test.bats" does not exist.
    // The driver spawns bats with cwd=ROOT, so a bare basename resolves to the
    // repository ROOT, not to githooks/__tests__/. This suite missed it because
    // it only asserted the `.bats` suffix, which a bare name satisfies -- the
    // plan looked perfect and could not run. Assert resolvability, not spelling.
    const missing = suites.filter((f) => !fs.existsSync(path.join(ROOT, f)));
    expect(missing).toEqual([]);
  });

  it('assigns every suite to exactly one shard, for every shard count CI uses', () => {
    for (const total of [1, 2, 3, 4, 6, 8]) {
      const shards = planShards(suites, total);
      expect(shards).toHaveLength(total);
      const assigned = shards.flatMap((s) => s.files);
      expect(assigned.slice().sort()).toEqual(suites.slice().sort());
      expect(new Set(assigned).size).toBe(suites.length);
    }
  });

  it('is deterministic, so a shard can be reproduced from the driver alone', () => {
    const a = planShards(suites, 4);
    const b = planShards(suites, 4);
    expect(a.map((s) => s.files)).toEqual(b.map((s) => s.files));
  });

  it('never leaves a shard with no work at the shard counts CI uses', () => {
    for (const total of [2, 3, 4, 6]) {
      for (const shard of planShards(suites, total)) {
        expect(shard.files.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('REQ-CI-BATS-01: shard balance is by measured cost, not file count', () => {
  const suites = listSuites();

  it('keeps the cost spread under 10% at 4 shards', () => {
    const shards = planShards(suites, 4);
    const costs = shards.map((s) => s.cost);
    const max = Math.max(...costs);
    const min = Math.min(...costs);
    // File-count splitting would put the 17.5s archlint suite next to a dozen
    // 150ms grep suites and call that "balanced". Measured-cost LPT does not.
    expect((max - min) / max).toBeLessThan(0.1);
  });

  it('spreads the single most expensive suite across a shard boundary', () => {
    // The table is keyed by basename while the plan carries root-relative paths,
    // so the heaviest entry has to be matched back to its planned path. Looking
    // for the basename directly made this assertion vacuous once the plan moved
    // to paths: `holders` was empty for a reason unrelated to the placement it
    // claims to test.
    const heaviest = Object.entries(MEASURED_MS).sort((a, b) => b[1] - a[1])[0][0];
    const heaviestPath = suites.find((f) => path.basename(f) === heaviest);
    expect(heaviestPath).toBeDefined();
    const shards = planShards(suites, 4);
    const holders = shards.filter((s) => s.files.includes(heaviestPath));
    expect(holders).toHaveLength(1);
    // The heaviest file must not land next to the other heavy ones: its shard
    // may be the biggest but must not exceed it by the whole weight of a rival.
    const costs = shards.map((s) => s.cost).sort((a, b) => b - a);
    expect((costs[0] - costs[costs.length - 1]) / costs[0]).toBeLessThan(0.1);
  });
});

describe('REQ-CI-BATS-01: "ran nothing" is a failure, not a pass', () => {
  it('rejects a shard index/total that is out of range', () => {
    expect(() => parseShard('4/3', 246)).toThrow(/out of range/);
    expect(() => parseShard('0/3', 246)).toThrow(/out of range/);
    expect(() => parseShard('one/three', 246)).toThrow(/expects <index>\/<total>/);
  });

  it('exits non-zero when a shard is assigned no suites', () => {
    // 400 shards over 246 suites: most shards must be starved. A green exit
    // there would mean a matrix shard silently verified nothing.
    let status = 0;
    try {
      execFileSync('node', [DRIVER, '--shard', '400/400', '--print-only'], {
        cwd: ROOT,
        stdio: 'pipe',
      });
    } catch (error) {
      status = error.status;
    }
    expect(status).not.toBe(0);
  });

  it('prints a shard assignment without running anything when asked', () => {
    const out = execFileSync('node', [DRIVER, '--shard', '1/2', '--print-only'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(out).toMatch(/Shard 1\/2:/);
    expect(out).toMatch(/\.bats/);
  });
});

describe('REQ-CI-BATS-01: the suite is ONE blocking gate in the workflow', () => {
  const workflow = fs.readFileSync(WORKFLOW, 'utf8');

  it('runs the suite through the driver, not through a bare `npx bats` step', () => {
    expect(workflow).toContain('scripts/run-bats-ci.cjs');
  });

  it('mark is not suppressed by continue-on-error', () => {
    // The 2026-11-12 state this replaces: the step carried
    // `continue-on-error: true` because 18m47s of serial suite made the
    // pipeline unusable. Restoring speed is what allows restoring enforcement;
    // letting the suppression stay would keep the contracts advisory.
    //
    // Anchored on the YAML step (a line starting with `- name:`), not on the
    // first mention of the phrase: the job comment above explains the old
    // suppression and must be allowed to name it.
    const lines = workflow.split('\n');
    const stepStart = lines.findIndex(
      (l) => /^\s*- name:.*BATS hook behavior contracts/.test(l),
    );
    expect(stepStart).toBeGreaterThan(-1);
    // A step ends at the next step at the same or shallower indent.
    const indent = lines[stepStart].match(/^\s*/)[0].length;
    let stepEnd = lines.length;
    for (let i = stepStart + 1; i < lines.length; i += 1) {
      const stripped = lines[i].match(/^\s*/)[0].length;
      if (/^\s*- (name|uses|run):/.test(lines[i]) && stripped <= indent) {
        stepEnd = i;
        break;
      }
    }
    const step = lines.slice(stepStart, stepEnd).join('\n');
    expect(step).not.toMatch(/continue-on-error/);
    // ...and the job it belongs to must not be skipped either.
    expect(workflow).not.toMatch(/bats-contracts:\n(?:.*\n){0,6}?\s+continue-on-error/);
  });

  it('shards the suite across runners rather than running it once', () => {
    expect(workflow).toMatch(/bats-contracts/);
    expect(workflow).toMatch(/shard:\s*\[/);
    expect(workflow).toMatch(/--shard \$\{\{ matrix\.shard \}\}/);
  });

  it('does not leave a second, silently different copy of the suite in gate-check', () => {
    // Two execution paths for the same contracts is how one of them rots
    // unnoticed. Gate 5b must be referenced from the bat-contracts job only.
    const invocations = workflow.match(/run-bats-ci\.cjs/g) || [];
    const npxBats = workflow.match(/npx bats/g) || [];
    expect(npxBats).toHaveLength(0);
    expect(invocations.length).toBeGreaterThan(0);
  });

  it('is inside the needs chain, so a red BATS run cannot leave the pipeline green', () => {
    // A job that nothing `needs` can fail while the run still reports success.
    // That is precisely the state Gate 5b was in for 203 commits (#484 -> #591)
    // and again while it carried `continue-on-error`; the job existing is not
    // the same as the job mattering. Assert the chain, not the job comment.
    const yaml = require('js-yaml');
    const parsed = yaml.load(workflow);
    const jobs = parsed.jobs;
    expect(jobs['bats-contracts']).toBeTruthy();
    // quality-report and summary must both depend on it: the first to report on
    // it, the second to state the verdict a human reads.
    expect(jobs['quality-report'].needs).toContain('bats-contracts');
    expect(jobs['summary'].needs).toContain('bats-contracts');
    // And the summary must name it explicitly rather than inferring it.
    const summaryRun = (jobs['summary'].steps || []).map((s) => s.run || '').join('\n');
    expect(summaryRun).toMatch(/needs\.bats-contracts\.result/);
  });
});