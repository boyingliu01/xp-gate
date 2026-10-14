#!/usr/bin/env node
/**
 * test:bats wrapper — environmental gate, not a pass-faker (Sprint B
 * walkthrough FC-02 / MJ-02).
 *
 * `npm test` now chains the BATS suites. The suites need bash and the bats
 * runner; both are guaranteed on CI (ubuntu Gate 5b runs the same suites),
 * but a Windows dev box may lack a working multi-file bats (the npm wrapper
 * has an MSYS path bug in bats 1.13's gather phase). A hard failure there
 * would red npm test for environment reasons unrelated to the code under
 * review — the exact noise that trains people to ignore red.
 *
 * Behavior: when bash + the bats runner are present, run them for real and
 * propagate the exit code verbatim (CI never skips); when absent, print a
 * loud SKIP notice and exit 0. The notice is visible in the npm test output
 * — silence is never the fallback.
 *
 * Uses ASYNC spawn deliberately: synchronous spawning is unreliable inside
 * sandboxed dev sessions (observed spawnSync ETIMEDOUT), async spawn is not.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BATS_DIR = path.join(ROOT, 'githooks', '__tests__');
const BATS_BIN = path.join(ROOT, 'node_modules', '.bin', 'bats');

function bashAvailable() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(true);
    // Real probe (round-2 feasibility): MSYSTEM/SHELL heuristics miss
    // sessions that have bash but neither variable. `bash -c :` is cheap,
    // and an async spawn is the reliable channel in sandboxed sessions.
    const probe = spawn('bash', ['-c', ':'], { stdio: 'ignore' });
    probe.on('error', () => resolve(false));
    probe.on('exit', (code) => resolve(code === 0));
  });
}

(async () => {
  if (!fs.existsSync(BATS_BIN) || !fs.existsSync(BATS_DIR) || !(await bashAvailable())) {
    console.log('SKIP test:bats — bash or the bats runner is not available in this environment.');
    console.log('         The BATS hook contracts still run in CI (quality-gates.yml, Gate 5b).');
    process.exit(0);
  }

  const child = spawn(BATS_BIN, [BATS_DIR], { stdio: 'inherit', cwd: ROOT });
  child.on('exit', (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code || 0);
  });
  child.on('error', (err) => {
    console.error('test:bats could not spawn the runner:', err.message);
    process.exit(1);
  });
})();
