import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { run } from './proc.mjs';
import { rmrf } from './util.mjs';
import { verdictOf } from './verdict.mjs';

/**
 * Gray-box gate verification: prove the gates actually block, not just that
 * they exit 0 on a clean tree.
 *
 * WHY THIS EXISTS
 * ---------------
 * `verify.mjs` up to 1.1.1 contained zero `run()` / `spawnSync` calls: every
 * check read a file and compared a hash. So the skill could report "12 skills
 * x 5 agents, all consistent" on a machine whose gates had silently stopped
 * inspecting anything. That is not hypothetical -- upstream xp-gate#732 makes
 * Gate 3/4 report PASS/SKIP for every `.mjs` file while checking none of them.
 *
 * File parity and gate effectiveness are different claims, and the second one
 * cannot be established by reading files. This module establishes it by
 * building a throwaway git repo, planting a defect the gate is responsible for
 * catching, and requiring the gate to say so. If the gate passes a dirty tree,
 * the gate is broken -- which is exactly what no amount of hash comparison in
 * verify.mjs would ever reveal.
 *
 * DESIGN NOTES
 * ------------
 * - Every case carries a `control`: the same gate on the same tree WITHOUT the
 *   planted defect. Without it, a gate that blocks everything (or is broken in
 *   the other direction) would score as perfect. Recall alone is not a verdict.
 * - The repo is created under os.tmpdir() and removed afterwards. A case that
 *   throws still cleans up via the caller's finally.
 * - Gates run through the real CLI (`xp-gate check <id>`), not by importing
 *   gate internals. The point is to test the artifact the user actually has.
 * - A CONTROL THAT BLOCKS IS AN ERROR, NOT A GAP. Gate 2's control tree blocked
 *   in the 1.2.2 audit because jscpd was not installed: the gate printed
 *   "Gate 2 FAILED: spawnSync npx ENOENT". The old `ok` expression
 *   (`dirty === expect && clean !== 'blocked'`) then reported the case as
 *   FAILED, and the summary said the audit did not pass -- which reads as "the
 *   gates are broken" when the truth is "a tool is missing". The two are now
 *   separated: only the dirty verdict can prove a gate is broken; a blocking
 *   control means the measurement itself is invalid.
 *
 * - WHY GATE 2 STAYS UNMEASURABLE EVEN WITH JSCPD INSTALLED (measured
 *   2026-02, jscpd 5.4.3, xp-gate 0.38.74, Windows). The control blocks on a
 *   machine where `/c/Users/<u>/AppData/Roaming/npm/jscpd` IS on PATH, so the
 *   case looks like a harness bug. It is upstream. `lib/gate-runner.js` probes
 *   `<root>/node_modules/jscpd/bin/jscpd` and then falls back to
 *   `['jscpd.cmd']`, `['jscpd']`, `['npx', ...]` through `execFileSync` with no
 *   shell. All three fail here, for three different reasons:
 *
 *     jscpd.cmd  -> EINVAL  (.cmd needs a shell; node refuses without one)
 *     jscpd      -> ENOENT  (the PATH entry is a shell script, not an exe)
 *     npx        -> ENOENT  (npx is npx.cmd + a shell script; same problem)
 *
 *   and the entry probe misses because jscpd 5.x moved its bin from `bin/jscpd`
 *   to `run-jscpd.js` (`"bin": {"jscpd": "./run-jscpd.js"}`), so the hardcoded
 *   path no longer exists. Verified: `node .../jscpd/run-jscpd.js --version`
 *   prints `jscpd 5.4.3` instantly, while every fallback above fails. Gate 2 is
 *   therefore advisory-but-unreachable on Windows with jscpd >= 5 -- it prints
 *   "Gate 2 FAILED: spawnSync npx ENOENT" no matter what the code looks like.
 *   Patching the audit to hide this would be lying; it is reported as
 *   UNMEASURABLE, which is what it is. Gate 2 does not block the build, so the
 *   only cost is the duplicate-code signal.
 */

/**
 * The defect planted for the Gate 8 case.
 *
 * The tokens are assembled at runtime rather than written as literals. They
 * have to LOOK real enough for gitleaks to flag them when this file is copied
 * into a fixture repo, but a literal here would be found by gitleaks in THIS
 * repository too -- and then every commit trips Gate 8 on our own test data,
 * which is how a real leak eventually gets waved through as "just the fixture
 * again". Concatenation keeps the scan target real and this file clean.
 */
export const SECRET_FIXTURE = [
  '// planted by reinstall-xp-gate audit -- do not copy into real code',
  `const awsKey = "AKIA${'QWERTYUIOPASDFGH'}";`,
  `const ghToken = "ghp_${'16C7e42F292c6912E7710c838347Ae178B4a'}";`,
  'module.exports = { awsKey, ghToken };',
].join('\n');

/**
 * Resolve the xp-gate launcher for spawnSync.
 *
 * On Windows the global bin is a `.cmd` shim and spawnSync('xp-gate') fails
 * with ENOENT -- it does not apply PATHEXT the way a shell does. Routing
 * through `cmd.exe /d /c` is how the rest of this skill already handles that.
 * The arguments are a fixed internal list (`check <number>`), never user input,
 * so there is no concatenation risk despite what semgrep's
 * detect-child-process rule assumes.
 */
function launcher() {
  return process.platform === 'win32' ? 'xp-gate.cmd' : 'xp-gate';
}

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xgr-gate-'));
  run('git', ['init', '-q'], { cwd: dir });
  run('git', ['config', 'user.email', 'audit@localhost'], { cwd: dir });
  run('git', ['config', 'user.name', 'audit'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
  return dir;
}

/** Stage everything; gates that read the index rather than the tree need it. */
function stageAll(dir) {
  run('git', ['add', '-A'], { cwd: dir });
}

/**
 * Run one gate by id in `dir`; returns { status, output }.
 *
 * run() spawns with envWithPath(), which is how xp-gate resolves from Git Bash
 * where global npm bins are absent from the Windows PATH.
 */
function gateRun(dir, gateId) {
  const args = ['check', String(gateId)];
  const r = process.platform === 'win32'
    ? run('cmd.exe', ['/d', '/c', launcher(), ...args], { cwd: dir, timeout: 180000 })
    : run(launcher(), args, { cwd: dir, timeout: 180000 });
  return { status: r.status, output: `${r.stdout || ''}${r.stderr || ''}` };
}

/**
 * The planted-defect cases.
 *
 * `expect: 'blocked'` means the gate must reject the dirty tree. Cases where
 * the gate legitimately cannot see the defect are recorded with `knownGap: true`
 * and reported separately -- counting them as failures would make the audit
 * permanently red for a bug this repo cannot fix, and counting them as passes
 * would hide a real hole.
 */
export const CASES = [
  {
    id: 8,
    name: 'Gate 8 blocks a planted AWS key + GitHub token',
    plant: (dir) => {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'leaked.js'), SECRET_FIXTURE);
    },
    expect: 'blocked',
  },
  {
    id: 3,
    name: 'Gate 3 blocks a function above the CCN threshold',
    plant: (dir) => {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      // Ten mutually exclusive branches: CCN 11, above the default block
      // threshold of 10. Written as plain JS so Gate 1 would accept it too.
      const branches = Array.from({ length: 10 }, (_, i) => `  if (n === ${i}) return ${i};`).join('\n');
      fs.writeFileSync(
        path.join(dir, 'src', 'complex.js'),
        `function tangled(n) {\n${branches}\n  return -1;\n}\nmodule.exports = { tangled };\n`,
      );
    },
    expect: 'blocked',
    // .js is in Gate 3's extension regex, so this case is not affected by
    // xp-gate#732. A pass here therefore proves the harness works even if the
    // .mjs gap (covered by scripts/hp-gate.mjs) is still open.
  },
  {
    id: 2,
    name: 'Gate 2 detects a duplicated block (advisory: reports, does not block)',
    plant: (dir) => {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      // Two files with an identical 20-line body: above jscpd's default
      // min-tokens, so it is a genuine clone rather than boilerplate.
      const body = Array.from({ length: 20 }, (_, i) =>
        `function part${i}(x) { return x * ${i} + ${i}; }`).join('\n');
      fs.writeFileSync(path.join(dir, 'src', 'a.js'), `${body}\nmodule.exports = 1;\n`);
      fs.writeFileSync(path.join(dir, 'src', 'b.js'), `${body}\nmodule.exports = 2;\n`);
    },
    // Expectation updated for xp-gate 0.38.75. Until 0.38.74 Gate 2 forwarded
    // jscpd's exit code without `--threshold`, and jscpd returns 0 regardless of
    // how much it finds, so the gate passed unconditionally and this case could
    // only expect 'detected'. `buildJscpdArgs` (lib/gate-runner.js) now passes
    // `--threshold 15`, making duplication a blocking finding.
    //
    // Measured 2026-11-21 on 0.38.75 with this exact fixture: "Found 1 clones",
    // then "ERROR: jscpd found too many duplicates (50.0%) over threshold
    // (15.0%)" and the gate FAILED. A fixture below the threshold still passes,
    // so this is a real separation rather than a gate that now always fails.
    expect: 'blocked',
  },
];

/**
 * Run one case: control tree first, then the same tree with the defect.
 *
 * `measurementValid` is false when the CONTROL blocked, because then nothing
 * can be concluded about the planted defect from this run.
 *
 * @param {object} tc case descriptor from CASES
 * @param {{control:boolean}} [opts] set control:false to skip the clean run
 */
export function runCase(tc, { control = true } = {}) {
  const dirs = { clean: tmpRepo(), dirty: tmpRepo() };
  try {
    return evaluateCase(tc, measure(tc, dirs, control), control);
  } catch (error) {
    return erroredCase(tc, error);
  } finally {
    rmrf(dirs.clean);
    rmrf(dirs.dirty);
  }
}

/**
 * Produce the two verdicts for one case.
 *
 * Split out so `runCase` is a try/finally over this call and nothing else: the
 * cleanup is what protects the next case, so it must not sit behind four
 * branches that could throw first.
 */
function measure(tc, dirs, control) {
  if (control) stageAll(dirs.clean);
  tc.plant(dirs.dirty);
  stageAll(dirs.dirty);
  return {
    cleanVerdict: control ? verdictOf(gateRun(dirs.clean, tc.id).output) : 'skipped',
    dirtyVerdict: verdictOf(gateRun(dirs.dirty, tc.id).output),
  };
}

/** A case that threw proves nothing, so it is recorded as unmeasurable. */
function erroredCase(tc, error) {
  return {
    id: tc.id,
    name: tc.name,
    cleanVerdict: 'unknown',
    dirtyVerdict: 'unknown',
    knownGap: Boolean(tc.knownGap),
    expected: tc.expect,
    ok: false,
    measurementValid: false,
    error: String(error && error.message ? error.message : error),
  };
}

/**
 * Decide what a pair of verdicts means.
 *
 * Three outcomes, kept apart on purpose:
 *   ok               the gate separated the clean tree from the dirty one
 *   measurementValid false -> the control blocked; no conclusion is available
 *   ok:false + valid  the gate passed a tree with a known defect in it
 */
function evaluateCase(tc, { cleanVerdict, dirtyVerdict }, control) {
  const controlBlocked = control && cleanVerdict === 'blocked';
  return {
    id: tc.id,
    name: tc.name,
    cleanVerdict,
    dirtyVerdict,
    knownGap: Boolean(tc.knownGap),
    expected: tc.expect,
    measurementValid: !controlBlocked,
    ok: !controlBlocked && dirtyVerdict === tc.expect,
  };
}

/** Collapse case results into the counters the report prints. */
export function summarize(cases) {
  const effective = cases.filter((r) => !r.knownGap);
  const invalid = effective.filter((r) => r.measurementValid === false);
  const judged = effective.filter((r) => r.measurementValid !== false);
  return {
    total: cases.length,
    ok: judged.filter((r) => r.ok).length,
    failed: judged.filter((r) => !r.ok).length,
    invalid: invalid.length,
    knownGaps: cases.filter((r) => r.knownGap).length,
    // The audit passes only when the cases that could be measured separated
    // clean from dirty, and nothing was left unmeasurable.
    pass: invalid.length === 0 && judged.every((r) => r.ok),
  };
}

/**
 * Run every case twice -- once clean (control), once with the defect planted.
 * @returns {Promise<{cases: object[], summary: object}>}
 */
export async function auditGates({ cases = CASES } = {}) {
  const results = cases.map((tc) => runCase(tc));
  return { cases: results, summary: summarize(results) };
}
