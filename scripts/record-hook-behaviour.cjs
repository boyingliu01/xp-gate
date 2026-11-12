#!/usr/bin/env node
/**
 * Behaviour fingerprint recorder for githooks/pre-commit (#798).
 *
 * Why this exists: an earlier attempt reordered the hook's inline gate blocks
 * physically. `bash -n` passed, line counts were conserved, and five ordering
 * tests went green — while Gate 5a had silently stopped blocking. Syntax
 * checks and structural invariants do not prove a hook still does its job.
 *
 * This records what the hook DOES: for each fixture, the exit status plus the
 * full stdout/stderr with volatile fields (timestamps, durations, temp paths)
 * normalised away. Comparing a before/after pair of fingerprints is the only
 * evidence that a restructure preserved behaviour.
 *
 * Usage:
 *   node scripts/record-hook-behaviour.cjs <hook-path> <out.json>
 *   node scripts/compare-hook-behaviour.cjs <a.json> <b.json>
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SRC_GITHOOKS = path.join(__dirname, '..', 'githooks');

// Volatile output that differs run-to-run but carries no behavioural meaning.
function normalise(s) {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<TS>')
    .replace(/\d{4}-\d{2}-\d{2}-\d{6}\.json/g, '<REPORT>.json')
    .replace(/completed in \d+s/g, 'completed in <N>s')
    .replace(/\b\d+(\.\d+)?\s?ms\b/g, '<MS>ms')
    .replace(/\bduration_ms['"]?\s*[:=]\s*\d+/g, 'duration_ms=<MS>')
    .replace(/[A-Za-z]:\\[^\s'"]*Temp[^\s'"]*/gi, '<TMP>')
    .replace(/\/tmp\/[^\s'"]*/g, '<TMP>')
    .replace(/[A-Za-z]:\\[^\s'"]*\\Temp\\[^\s'"]*/gi, '<TMP>')
    .replace(/\b[0-9a-f]{40}\b/g, '<SHA>')
    .replace(/\b\d+\.\d+\.\d+\.\d+\b/g, '<VER>')
    .replace(/in \d+\.\d+s/g, 'in <N>s')
    .trim();
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

function sh(cwd, cmd, args, env) {
  try {
    const out = execFileSync(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      // stdin MUST be a pipe rather than 'ignore': the hook is a git hook and
      // reads pre-commit's stdin. On Windows, 'ignore' makes bash exit before
      // producing any output, which would fingerprint as an empty run.
      stdio: ['pipe', 'pipe', 'pipe'],
      input: '',
      maxBuffer: 64 * 1024 * 1024,
    });
    return { status: 0, out: out || '' };
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    if (!out && e.status == null) {
      // A spawn failure carries no status; surface it instead of silently
      // recording -1 with empty output, which reads like "hook printed nothing".
      return { status: -2, out: 'SPAWN FAILED: ' + e.message };
    }
    return { status: typeof e.status === 'number' ? e.status : -1, out };
  }
}

// Copy the complete installed hook set into <hooksDir>: the entry point, the
// ordered driver, the per-gate entry bodies, the startup modules and lib/*.sh.
// A fixture that copies only SOME of these runs a hook that cannot find its
// gates, which is exactly the failure this recorder exists to detect.
// Copy every .sh in <srcDir> into <destDir>, creating <destDir> first. Returns
// silently when the source directory does not exist, so a fixture built against
// a checkout that predates a directory is a no-op rather than a crash.
function copyShDir(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const f of fs.readdirSync(srcDir)) {
    if (f.endsWith('.sh')) fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
  }
}

// Copy the named files from <srcDir> into <destDir>, skipping any that are
// absent (a checkout may legitimately lack an optional module).
function copyNamed(srcDir, destDir, names) {
  for (const f of names) {
    const src = path.join(srcDir, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(destDir, f));
  }
}

// Copy the complete installed hook set into <hooksDir>: the entry point, the
// ordered driver, the per-gate entry bodies, the startup modules and lib/*.sh.
// A fixture that copies only SOME of these runs a hook that cannot find its
// gates, which is exactly the failure this recorder exists to detect.
function copyHookSet(hookPath, hooksDir) {
  copyNamed(SRC_GITHOOKS, hooksDir, [
    'adapter-common.sh',
    'hook-module-resolution.sh',
    'gate-registry.sh',
    'gate-driver.sh',
  ]);
  copyShDir(path.join(SRC_GITHOOKS, 'lib'), path.join(hooksDir, 'lib'));

  // gate-*.sh / sprint-gate*.sh scripts are sourced by path, so the fixture
  // needs them too.
  for (const f of fs.readdirSync(SRC_GITHOOKS)) {
    if (/^gate-\d+.*\.sh$/.test(f)) fs.copyFileSync(path.join(SRC_GITHOOKS, f), path.join(hooksDir, f));
  }
  copyNamed(SRC_GITHOOKS, hooksDir, ['sprint-gate.sh']);

  // #798: the gate bodies live in gate-entries/, one file per gate. Mirroring
  // the real installation layout is what keeps this fixture honest.
  copyShDir(path.join(SRC_GITHOOKS, 'gate-entries'), path.join(hooksDir, 'gate-entries'));

  fs.copyFileSync(hookPath, path.join(hooksDir, 'pre-commit'));
  fs.chmodSync(path.join(hooksDir, 'pre-commit'), 0o755);
}

// Tool stubs, so the fingerprint records the HOOK's behaviour rather than this
// machine's tool inventory.
const TOOL_STUBS = {
  jscpd: '#!/bin/bash\necho \'{"duplicates":[]}\'\nexit 0\n',
  pytest: '#!/bin/bash\necho "3 passed in 0.01s"\nexit 0\n',
  coverage: '#!/bin/bash\necho "90"\nexit 0\n',
};

function writeToolStubs(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  for (const [n, body] of Object.entries(TOOL_STUBS)) {
    const p = path.join(binDir, n);
    fs.writeFileSync(p, body);
    fs.chmodSync(p, 0o755);
  }
}

function writeProjectFiles(dir) {
  fs.writeFileSync(path.join(dir, 'README.md'), 'init\n');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'placeholder.ts'),
    '// @no-test-required: test infrastructure placeholder\nexport const placeholder = true;\n'
  );
  fs.writeFileSync(path.join(dir, '.archlint.yaml'), 'ignore: []\n');
  fs.mkdirSync(path.join(dir, 'coverage'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'coverage', 'coverage-summary.json'),
    JSON.stringify({
      total: {
        lines: { pct: 90 },
        statements: { pct: 90 },
        functions: { pct: 90 },
        branches: { pct: 90 },
      },
    })
  );
}

// Build a throwaway repo that mirrors gate-5a-block.test.bats' fixture, since
// that suite is what caught the silent regression.
function makeFixture(hookPath, dir) {
  rmrf(dir);
  fs.mkdirSync(dir, { recursive: true });
  sh(dir, 'git', ['init', '-q', '-b', 'test-branch']);
  sh(dir, 'git', ['config', 'user.email', 'test@test.com']);
  sh(dir, 'git', ['config', 'user.name', 'Test']);
  sh(dir, 'git', ['config', 'core.hooksPath', '.git/hooks']);

  const hooksDir = path.join(dir, '.git', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  copyHookSet(hookPath, hooksDir);
  writeToolStubs(path.join(dir, 'bin'));
  writeProjectFiles(dir);

  sh(dir, 'git', ['add', '.']);
  sh(dir, 'git', ['commit', '--no-verify', '-q', '-m', 'init']);
}

// Each scenario stages something and runs the hook. The scenarios are chosen to
// reach DIFFERENT gates, so a restructure that orphans any of them shows up as a
// fingerprint mismatch rather than passing unnoticed.
const SCENARIOS = [
  {
    name: 'new-ts-without-test-blocks',
    // Gate 5a must BLOCK. This is the case the first reorder attempt broke.
    stage: (dir) => {
      fs.writeFileSync(path.join(dir, 'src', 'foo.ts'), 'export const x = 1;\n');
      sh(dir, 'git', ['add', 'src/foo.ts']);
    },
  },
  {
    name: 'new-ts-with-test-passes',
    stage: (dir) => {
      fs.writeFileSync(path.join(dir, 'src', 'bar.ts'), 'export const y = 2;\n');
      fs.writeFileSync(
        path.join(dir, 'src', 'bar.test.ts'),
        "import { y } from './bar';\nimport { describe, it, expect } from 'vitest';\ndescribe('y', () => { it('is 2', () => { expect(y).toBe(2); }); });\n"
      );
      sh(dir, 'git', ['add', 'src/bar.ts', 'src/bar.test.ts']);
    },
  },
  {
    name: 'docs-only-change',
    stage: (dir) => {
      fs.writeFileSync(path.join(dir, 'NOTES.md'), 'a note\n');
      sh(dir, 'git', ['add', 'NOTES.md']);
    },
  },
  {
    name: 'conflict-marker-blocks',
    stage: (dir) => {
      fs.writeFileSync(path.join(dir, 'ALSO.md'), 'line\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n');
      sh(dir, 'git', ['add', 'ALSO.md']);
    },
  },
  {
    name: 'staged-secret-blocks',
    // Gate 8 (secret scanning) is fail-closed, so a staged credential must BLOCK.
    // The .ts file is staged alongside because Gate 1/5 skip their analysis
    // phases when no code file changed, and the secret alone would leave the
    // scenario reaching only the early-exit path.
    //
    // The key is GENERATED, not AKIAIOSFODNN7EXAMPLE: gitleaks' ruleset skips
    // AWS's public documentation examples, so a fixture built on the canonical
    // example records "no secrets detected" and the scenario silently stops
    // testing the blocking path.
    stage: (dir) => {
      fs.writeFileSync(
        path.join(dir, 'config.js'),
        "const aws = 'AKIAZHMMK26VA5KBZOFJ';\nconst key = 'ZHMMK26VA5KBZOFJHIP222UBVBUVR575GVGK3PBF';\nmodule.exports = { aws, key };\n"
      );
      fs.writeFileSync(
        path.join(dir, 'src', 'cfg.ts'),
        '// @no-test-required: configuration surface exercised through the JS entrypoint\nexport const cfg = { region: "eu-west-1" };\n'
      );
      sh(dir, 'git', ['add', 'config.js', 'src/cfg.ts']);
    },
  },
  {
    name: 'gate-selector-single-gate',
    stage: (dir) => {
      fs.writeFileSync(path.join(dir, 'src', 'sel.ts'), 'export const z = 3;\n');
      sh(dir, 'git', ['add', 'src/sel.ts']);
    },
    env: { XP_GATE_ONLY_GATE: '2' },
  },
];

function record(hookPath) {
  const dir = path.join(os.tmpdir(), 'xp798-fp');
  makeFixture(hookPath, dir);
  const origHook = fs.readFileSync(hookPath);
  const results = {};

  for (const sc of SCENARIOS) {
    // Restore the fixture's committed state, then stage this scenario's change.
    sh(dir, 'git', ['reset', '--hard', '-q']);
    sh(dir, 'git', ['clean', '-fdq']);
    // Each scenario re-materialises the hook so a scenario cannot inherit state.
    fs.writeFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), origHook);
    fs.chmodSync(path.join(dir, '.git', 'hooks', 'pre-commit'), 0o755);
    rmrf(path.join(dir, '.quality-history.jsonl'));
    rmrf(path.join(dir, '.xp-gate'));
    try {
      sc.stage(dir);
    } catch (e) {
      results[sc.name] = { status: -1, out: 'STAGE FAILED: ' + e.message };
      continue;
    }
    // A scenario whose staging silently did nothing records "No files changed,
    // skipping gates" and then compares equal before and after a restructure —
    // a vacuous pass. Assert the index actually carries the change.
    const staged = sh(dir, 'git', ['diff', '--cached', '--name-only', '--diff-filter=ACM']);
    const stagedList = staged.out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (stagedList.length === 0) {
      results[sc.name] = { status: -1, out: 'FIXTURE ERROR: scenario staged nothing' };
      continue;
    }
    const env = {
      SKIP_VERSION_CHECK: '1',
      PATH: path.join(dir, 'bin') + path.delimiter + process.env.PATH,
      ...(sc.env || {}),
    };
    // Invoke through bash explicitly: on Windows a hook file is not executable
    // via its shebang, and execFileSync on it fails with no output at all —
    // which would fingerprint six identical "nothing happened" results.
    const r = sh(dir, 'bash', [path.join('.git', 'hooks', 'pre-commit')], env);
    results[sc.name] = { status: r.status, out: normalise(r.out) };
  }
  rmrf(dir);
  return results;
}

const [hookPath, outPath] = process.argv.slice(2);
if (!hookPath || !outPath) {
  console.error('usage: node scripts/record-hook-behaviour.cjs <hook-path> <out.json>');
  process.exit(2);
}
const res = record(path.resolve(hookPath));
fs.writeFileSync(outPath, JSON.stringify(res, null, 2));
console.log('recorded ' + Object.keys(res).length + ' scenarios -> ' + outPath);
for (const [k, v] of Object.entries(res)) {
  console.log('  ' + k.padEnd(34) + ' exit=' + v.status + '  outLen=' + v.out.length);
}
