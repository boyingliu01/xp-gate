#!/usr/bin/env node
/**
 * CI driver for the BATS hook-behaviour contracts.
 *
 * @test REQ-CI-BATS-01
 * @intent Run the SAME contracts Gate 5b used to run, in a fraction of the
 *         wall-clock, without weakening a single assertion.
 * @covers AC-CI-BATS-01-01 (every .bats file is assigned to exactly one shard)
 * @covers AC-CI-BATS-01-02 (shards are balanced by measured cost, not file count)
 * @covers AC-CI-BATS-01-03 (a shard that runs nothing is a FAILURE, not a pass)
 * @covers AC-CI-BATS-01-04 (the suite still runs as ONE blocking gate)
 *
 * WHY THIS EXISTS
 *   `npx bats githooks/__tests__/` was a single serial step: measured 18m47s of
 *   a 22m24s Gate Checks job on 2026-11-12 — 81% of the whole pipeline — and it
 *   had to be made non-blocking just to keep the pipeline usable.
 *
 *   Nothing about that cost was intrinsic to the assertions. Two levers, both
 *   measured rather than assumed:
 *
 *   1. THE FILES ARE INDEPENDENT PROCESSES, SO THEY CAN RUN SIDE BY SIDE.
 *      Every suite builds its own fixture in `mktemp -d` and runs the hook from
 *      there; the only cross-file resource is the checkout itself, which they
 *      read (and the hook cases run their own copy, never this one). Bats
 *      supports `-j N` natively, but each worker costs one npm-registry call
 *      because `npx <tool>` inside a fixture installs the tool, so the inside-
 *      the-runner parallelism is an AND with tool resolution, not a substitute
 *      for it (see the eslint/biome fix that ships with this driver).
 *
 *   2. THE RUNNERS ARE SEPARATE MACHINES. A matrix shard gets its own CPU, its
 *      own filesystem and its own npm cache. This is the lever that does not
 *      depend on any fixture damage being repaired first.
 *
 *   This driver owns (1) the shard split so it is testable and reviewable, and
 *   leaves (2) to the workflow matrix.
 *
 * THE SPLIT IS BY MEASURED COST, NOT BY FILE COUNT
 *   A plain round-robin split is a lie about cost: `gate-8-layers.test.bats` (8
 *   cases of pure grep) and `gate-8-architecture.test.bats` (20 cases that each
 *   run the real hook) are one file each. The table below is the per-file
 *   wall-clock measured on a 4-core Linux runner, and it ships WITH the split so
 *   the split cannot silently become "alphabetical". Unlisted files take the
 *   median weight, and the driver prints whenever that happens — a new suite no
 *   one weighed is visible in the CI log instead of quietly unbalancing a shard.
 *
 *   The weights were measured at N; they are a starting point, not a constant.
 *   `--print-shards` shows the resulting split and `--report-only` writes a
 *   machine-readable summary so an operator can re-measure from a real run
 *   instead of trusting this table forever.
 *
 * USAGE
 *   node scripts/run-bats-ci.cjs --shard 1/3
 *   node scripts/run-bats-ci.cjs --shard 1/3 --jobs 4 --print-only
 *   node scripts/run-bats-ci.cjs --all --print-shards
 *
 * EXIT CODES
 *   0  every assigned suite passed
 *   1  at least one suite failed (or the runner could not start)
 *   2  the shard was starved: zero files matched, or a file matched by no shard
 *      at all. "Ran nothing" must never read as "passed" (#636's rule, and the
 *      6ebbd5a failure mode #484 was created for).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const BATS_DIR = path.join(ROOT, 'githooks', '__tests__');

/**
 * Per-file wall-clock, milliseconds.
 *
 * MEASURED on a 4-core Linux box (WSL2, 2026-11-12) by running every suite on
 * its own with a 45 s budget. Do not re-invent these numbers by reading the
 * files: a suite's cost is the number of PROCESSES it spawns, which is
 * unrelated to its line count. Two facts decided the table:
 *
 *   1. Suites that never finished inside 45 s during the profile are recorded
 *      as 50000. Measured: 13 of them, all reaching a `npx <tool>` that tries to
 *      INSTALL the tool on a machine without the dependency (see
 *      docs/plans/2026-11-12-ci-bats-runtime-optimization.md §1). That install
 *      trap is now fixed for the Biome and ESLint arms, which took three of the
 *      thirteen from "killed at 45 s" to under a second each (gate-1-linter-
 *      missing 45 000 ms -> 863 ms, gate-1-biome-noop -> 438 ms, adapter-
 *      typescript-biome-exit -> 274 ms), but the remaining sites (`npx tsc`,
 *      real `mvn`) still pay it on a machine without those tools, so 50000 stays
 *      an honest over-estimate for them. Over-estimating errs toward spreading
 *      heavy suites across different shards — the safe direction.
 *   2. Everything under 3000 ms is not listed and takes DEFAULT_MS. Listing 175
 *      numbers of ±300 ms noise would make the table look precise without making
 *      the split better.
 *
 * Suites with no entry use DEFAULT_MS, which is the measured MEDIAN of this
 * table's entries — not a guess. The driver prints how many suites fall back, so
 * a large fallback population is visible in the CI log.
 */
const MEASURED_MS = {
  'gate-1-tsc-test-files.test.bats': 50000,
  'gate-5a-block.test.bats': 50000,
  'gate9-architecture.bats': 50000,
  'gate-cjs-source-detection.test.bats': 50000,
  'gate-m2-threshold.test.bats': 50000,
  'issue-450-gate0-bypass-enforcement.test.bats': 50000,
  'issue-551-stale-sprint.test.bats': 50000,
  'issue-554c-gate5-no-source-skip.test.bats': 50000,
  'issue-776-adapter-verdicts-and-csharp.test.bats': 50000,
  'java-gate.test.bats': 50000,
  'multilang-subdir-gate5a.test.bats': 50000,
  'tag-push-gate-mw.test.bats': 50000,
  'typecheck-local-tsc.test.bats': 50000,
  'gate-13-slice-2.test.bats': 16100,
  'issue-649-changed-files-scan-scope.test.bats': 15300,
  'gate-13-slice-3.test.bats': 13000,
  'issue-706-kotlin-static-analysis.test.bats': 12000,
  'gate-mw-evidence.test.bats': 11800,
  'issue-577-prepush-score-majority.test.bats': 11500,
  'issue-550-staged-semantics.test.bats': 11300,
  'gate-13-walkthrough-round2.test.bats': 10800,
  'issue-599-install-hook-resolution.test.bats': 10500,
  'gate-13-compiler-strictness.test.bats': 9300,
  'issue-569-prepush-summary-counts.test.bats': 9000,
  'gate-3.test.bats': 8100,
  'gate-registry.test.bats': 6700,
  'gate-activation.test.bats': 6400,
  'gate-10-verdict.test.bats': 6000,
  'install-hooks-lib.test.bats': 5900,
  'issue-798-gate-order.bats': 5400,
  'gate-6-layers.test.bats': 5000,
  'issue-548-vendored-hook-modules-shellcheck.test.bats': 4600,
  'issue-404-gate-m-journal.test.bats': 4200,
  'issue-580-prepush-score.test.bats': 4100,
  'issue-634-pytest-test-path-exclusion.test.bats': 3900,
  'issue-604-model-input-safety.test.bats': 3800,
  'issue-668-pre-existing-assertions.test.bats': 3800,
  'powershell-stage2-coverage.test.bats': 3600,
  'adapter-common.test.bats': 3500,
  'cpp-gate.test.bats': 3400,
  'issue-523-python-coverage-parse.test.bats': 3300,
  'issue-564-score-denominator.test.bats': 3300,
  'issue-570-coverage-fail-closed.test.bats': 3300,
  'java-stage2-coverage.test.bats': 3300,
  'issue-399-python-test-selection.test.bats': 3200,
  'issue-511-gitleaks-migration.test.bats': 3000,
};

/**
 * Everything not in MEASURED_MS: the measured median of the listed suites.
 * Raising or lowering it changes only how optimistically unweighed suites are
 * treated; it cannot move a suite between shards, only their balance.
 */
const DEFAULT_MS = 3000;

/**
 * Suite names, WITH the directory they live in.
 *
 * Returning bare names broke CI on the first real run: bats is spawned with
 * `cwd: ROOT`, so `adapter-shell-scope.test.bats` resolved to the repository
 * root and every shard died on
 *   ERROR: Test file ".../xp-gate/adapter-shell-scope.test.bats" does not exist.
 * shard 1..4, all four, in one second. The shard unit tests did not catch it
 * because they only asserted the `.bats` suffix, which a bare name satisfies.
 *
 * The name stays relative to ROOT rather than absolute so the printed plan reads
 * the same on a developer's machine and on a runner, and so it can be pasted
 * into a local command unchanged.
 */
function listSuites(dir = BATS_DIR) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.bats'))
    .sort()
    .map((f) => path.relative(ROOT, path.join(dir, f)).split(path.sep).join('/'));
}

/**
 * Measured cost of one suite.
 *
 * The table is keyed by BASENAME (`gate-5a-block.test.bats`) because that is how
 * the timings were recorded, and a whole directory rename should not silently
 * throw away every measurement. The planner, meanwhile, has to hand bats paths
 * that resolve from ROOT. Looking up by basename bridges the two, and using the
 * `in` check rather than `||` keeps a legitimate 0 out of the fallback.
 */
function suiteCost(file) {
  const base = path.basename(file);
  return base in MEASURED_MS ? MEASURED_MS[base] : DEFAULT_MS;
}

/** Sum of the measured cost of the files in `files`. */
function shardCost(files) {
  return files.reduce((sum, f) => sum + suiteCost(f), 0);
}

/** True when this suite carries a real measurement rather than the fallback. */
function isWeighed(file) {
  return path.basename(file) in MEASURED_MS;
}

/**
 * Longest-processing-time-first split over measured cost.
 *
 * Assigning the most expensive remaining file to the currently-cheapest shard
 * is the standard greedy for this problem, and it beats round-robin by a wide
 * margin on a list with a 30x spread — which this one has (17500 vs ~150).
 *
 * Deterministic by construction: files are sorted by weight then name, so two
 * runs with the same table produce the same split, and a shard's contents can
 * be reproduced from this file alone.
 */
function planShards(files, shardCount) {
  if (!Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error(`shardCount must be a positive integer, got ${shardCount}`);
  }
  const shards = Array.from({ length: shardCount }, () => ({ files: [], cost: 0 }));
  const ordered = [...files].sort((a, b) => {
    const d = suiteCost(b) - suiteCost(a);
    return d !== 0 ? d : a.localeCompare(b);
  });
  for (const file of ordered) {
    // Cheapest shard wins; ties go to the lowest index so the plan is stable.
    let target = shards[0];
    for (const shard of shards) {
      if (shard.cost < target.cost) target = shard;
    }
    target.files.push(file);
    target.cost += suiteCost(file);
  }
  for (const shard of shards) shard.files.sort();
  return shards;
}

/** Parse `--shard <index>/<total>` (1-based index, as GitHub matrix reads it). */
function parseShard(spec, suiteCount) {
  const match = /^(\d+)\/(\d+)$/.exec(String(spec));
  if (!match) {
    throw new Error(`--shard expects <index>/<total> (e.g. 1/3), got "${spec}"`);
  }
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (total < 1 || index < 1 || index > total) {
    throw new Error(`--shard ${spec} is out of range: index must be 1..${total}`);
  }
  return { index, total, suiteCount };
}

function findBatsBin() {
  // The repo-local runner is the pinned devDependency. `npx bats` is NOT used:
  // npx installs bats when it is missing, so a broken install would answer
  // "yes, I have a runner" by downloading one — the exact probe-vs-install
  // confusion AGENTS.md forbids.
  const bin = path.join(ROOT, 'node_modules', 'bats', 'bin', 'bats');
  if (!fs.existsSync(bin)) {
    return null;
  }
  return bin;
}

/**
 * Can `bats --jobs N` actually parallelize here?
 *
 * bats delegates intra-file parallelism to an external helper and aborts the
 * whole run (not just the parallel part) when none is found. The four names
 * below are the ones bats 1.x will use. Windows has none of them by default,
 * which is why this check exists rather than trusting the `--jobs` request.
 */
function hasParallelRunner() {
  for (const tool of ['parallel', 'rush', 'semaphore', 'shlock', 'flock']) {
    const probe = spawnSync(process.platform === 'win32' ? 'where' : 'command', 
      process.platform === 'win32' ? [tool] : ['-v', tool],
      { cwd: ROOT, stdio: 'ignore', shell: process.platform !== 'win32' });
    if (probe.status === 0) {
      return true;
    }
  }
  return false;
}

function runShard(files, jobs) {
  const bin = findBatsBin();
  if (!bin) {
    console.error('❌ node_modules/bats/bin/bats is missing.');
    console.error('   The suite must run on the pinned devDependency; run `npm ci` first.');
    return 1;
  }
  const args = [bin];
  // -j needs GNU parallel or rush INSIDE the runner. When neither is present
  // bats errors out, so the flag is only added when the operator asks AND the
  // runner exists; otherwise the shard still runs, serially, which is correct
  // if slower. `--print-output-on-failure` is kept from the original step: it
  // is what made a red build diagnosable (#591).
  //
  // The "runner exists" half of that sentence was documented but never coded:
  // `--jobs N` was passed on the operator's word alone, so on Windows --
  // where none of the four (parallel/rush/semaphore/shlock) is installed --
  // bats aborted the whole shard with
  //     ERROR: flock/shlock is required for parallelization within files!
  // and printed no test results at all. Asking for parallelism is a request,
  // not a guarantee; falling back to serial is the documented behaviour, and
  // now it is the actual one.
  const effectiveJobs = jobs > 1 && hasParallelRunner() ? jobs : 1;
  if (jobs > 1 && effectiveJobs === 1) {
    console.warn(
      `⚠️  --jobs ${jobs} ignored: no parallel runner (GNU parallel / rush / ` +
        `semaphore / shlock) on PATH. Running serially.`
    );
  }
  if (effectiveJobs > 1) {
    args.push('--jobs', String(effectiveJobs));
  }
  args.push('--print-output-on-failure', ...files);

  console.log(
    `Running ${files.length} suite(s)` +
      `${effectiveJobs > 1 ? ` with --jobs ${effectiveJobs}` : ' serially'}:`
  );
  for (const f of files) console.log(`  - ${f}`);

  const result = spawnSync('bash', args, { cwd: ROOT, stdio: 'inherit' });
  if (result.error) {
    console.error(`❌ could not start the bats runner: ${result.error.message}`);
    return 1;
  }
  return result.status === 0 ? 0 : 1;
}

/**
 * Parse argv into an options object.
 *
 * Split out of main() because the flag loop alone pushed main's cyclomatic
 * complexity to 27 against a block threshold of 10 -- Gate 3 caught it on CI
 * with "BLOCK scripts/run-bats-ci.cjs:290 main CCN=27". Each branch here is an
 * independent decision, which is exactly what the metric is counting; keeping
 * them in one dispatcher conflated parsing, planning and execution.
 *
 * Returns { opts } or { error } -- never throws, so the caller keeps one exit path.
 */
function parseArgs(argv) {
  const opts = { shard: null, jobs: 1, printOnly: false, printShards: false, all: false, help: false };
  // Table-driven on purpose. Every flag is an independent decision, and written
  // as a chain of `else if` each one adds a branch to the same function: the
  // gate blocked the previous version at CCN=15. A lookup table states the same
  // mapping without turning "how many flags exist" into "how complex is the
  // parser". `takesValue` says whether the next argv element is its argument.
  const FLAGS = {
    '--shard': { key: 'shard', takesValue: true },
    '--jobs': { key: 'jobs', takesValue: true, coerce: Number },
    '--print-only': { key: 'printOnly', value: true },
    '--print-shards': { key: 'printShards', value: true },
    '--all': { key: 'all', value: true },
    '--help': { key: 'help', value: true },
    '-h': { key: 'help', value: true },
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const flag = FLAGS[arg];
    if (!flag) return { error: `Unknown argument: ${arg}` };
    if (!flag.takesValue) {
      opts[flag.key] = flag.value;
      continue;
    }
    const raw = argv[++i];
    opts[flag.key] = flag.coerce ? flag.coerce(raw) : raw;
  }
  return { opts };
}

/**
 * The shard this invocation is responsible for, validated against the whole
 * suite. Returns { files, index, total, cost } or { error, code }.
 *
 * Every rejection here is the same principle from a different angle: something
 * that did not run must not read as passed (#636 / 6ebbd5a). A starved shard, a
 * plan that omits a suite or repeats one, and an out-of-range index are all
 * "this matrix entry verified nothing", and each exits 2 rather than 0.
 */
function resolveShard(suites, spec) {
  let spec_ = null;
  try {
    spec_ = parseShard(spec, suites.length);
  } catch (error) {
    return { error: error.message, code: 1 };
  }
  const { index, total } = spec_;
  const shards = planShards(suites, total);
  const mine = shards[index - 1];

  if (mine.files.length === 0) {
    return {
      error:
        `shard ${index}/${total} was assigned zero suites. ` +
        'The split is starved -- fix --shard/suite count, do not merge a green shard.',
      code: 2,
    };
  }

  const assigned = shards.flatMap((s) => s.files);
  const missing = suites.filter((f) => !assigned.includes(f));
  const duped = assigned.filter((f, i) => assigned.indexOf(f) !== i);
  if (missing.length || duped.length) {
    return {
      error:
        `shard plan is not a partition (missing: ${missing.join(', ') || 'none'})
` +
        `   duplicated: ${duped.join(', ') || 'none'}`,
      code: 2,
    };
  }

  return { files: mine.files, index, total, cost: mine.cost };
}

/** Report the unweighed-suite count. Silence here would hide a partial measurement. */
function reportUnweighed(suites) {
  const unweighed = suites.filter((f) => !isWeighed(f));
  if (!unweighed.length) return;
  console.log(
    `ℹ️ ${unweighed.length}/${suites.length} suite(s) have no measured weight and use ${DEFAULT_MS} ms; shard balance is approximate until they are weighed.`,
  );
}

function printShards(suites, shardSpec) {
  const total = shardSpec ? parseShard(shardSpec, suites.length).total : 1;
  const shards = planShards(suites, total);
  shards.forEach((s, i) => {
    console.log(`
Shard ${i + 1}/${total} — ${s.files.length} file(s), ~${s.cost} ms`);
    for (const f of s.files) console.log(`  ${f}`);
  });
  return 0;
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    console.error(parsed.error);
    return 1;
  }
  const opts = parsed.opts;
  if (opts.help) {
    console.log('usage: node scripts/run-bats-ci.cjs --shard 1/3 [--jobs N] [--print-only]');
    return 0;
  }

  if (!fs.existsSync(BATS_DIR)) {
    console.error(`❌ no suite directory at ${BATS_DIR}`);
    return 1;
  }
  const suites = listSuites();
  if (suites.length === 0) {
    // A green run over zero suites is the 6ebbd5a failure mode. Fail loudly.
    console.error(`❌ no .bats suites in ${BATS_DIR} — refusing to report PASS`);
    return 2;
  }

  reportUnweighed(suites);

  if (opts.printShards) return printShards(suites, opts.shard);
  if (opts.all) return runShard(suites, opts.jobs);

  if (!opts.shard) {
    console.error('Pass --shard <index>/<total>, or --all to run every suite serially.');
    return 1;
  }

  const shard = resolveShard(suites, opts.shard);
  if (shard.error) {
    console.error(`❌ ${shard.error}`);
    return shard.code;
  }

  if (opts.printOnly) {
    console.log(`Shard ${shard.index}/${shard.total}: ${shard.files.join(' ')}`);
    return 0;
  }

  console.log(`
=== BATS shard ${shard.index}/${shard.total} (~${shard.cost} ms of measured cost) ===`);
  return runShard(shard.files, opts.jobs);
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}

module.exports = { listSuites, planShards, shardCost, parseShard, MEASURED_MS, DEFAULT_MS };