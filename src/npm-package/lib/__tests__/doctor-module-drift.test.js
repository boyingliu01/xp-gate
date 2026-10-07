/**
 * @test REQ-495 xp-gate doctor sees the gate modules that actually execute
 * @intent doctor 对全局目录只做存在性检查（checkAdapters），drift 检查只看
 *         pre-commit/pre-push/post-merge + lib/；而 pre-commit 把 GATE_DIR 解析到
 *         ~/.config/xp-gate/adapters（`if [ -f "$ADAPTER_DIR/gate-3.sh" ]`），
 *         门禁模块全部在那里执行。于是本仓库里 gate-4/gate-8/typescript.sh 与机器
 *         副本三份互异，doctor 却报全绿，#493 那类仓库侧修复在本地根本不会被执行
 *         （#495）。更糟的是任何单向同步都会销毁另一侧的机器独有加固，所以判定
 *         必须给出"双向发散"这一态并拒绝静默覆盖。
 * @covers AC-495-01, AC-495-02, AC-495-03, AC-495-04, AC-495-05, AC-495-06
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Build a repo + global-install pair. `spec` names each module's repo copy and
 * installed copy; null means "not present on that side".
 */
function fixture(spec) {
  const root = mkdtempSync(join(tmpdir(), 'xp-gate-drift-'));
  const repoHooks = join(root, 'githooks');
  const installedHooks = join(root, 'hooks');
  const installedAdapters = join(root, 'adapters');
  mkdirSync(join(repoHooks, 'adapters'), { recursive: true });
  mkdirSync(installedHooks, { recursive: true });
  mkdirSync(installedAdapters, { recursive: true });

  const write = (file, text) => {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
  };

  for (const [name, sides] of Object.entries(spec)) {
    if (sides.repo !== null) {
      // gate-*/adapter-common.sh live at the githooks root; language adapters
      // live under githooks/adapters/ -- the same split the installer uses.
      const rootLevel = name.startsWith('gate-') || name === 'adapter-common.sh' || name.startsWith('lib/');
      write(join(repoHooks, rootLevel ? name : join('adapters', name)), sides.repo);
    }
    if (sides.installed !== null) {
      write(join(installedAdapters, sides.nested ? join('adapters', name) : name), sides.installed);
    }
    if (sides.repoMtime) utimesSync(join(repoHooks, name), sides.repoMtime, sides.repoMtime);
  }

  // A canonical hook source is what makes the drift surface apply at all.
  write(join(repoHooks, 'pre-commit'), '#!/bin/bash\necho repo\n');
  write(join(installedHooks, 'pre-commit'), '#!/bin/bash\necho repo\n');

  return { repoHooks, installedHooks, installedAdapters, root, write };
}

function drift(ctx) {
  const { diagnoseModuleDrift } = require('../doctor');
  expect(typeof diagnoseModuleDrift).toBe('function');
  return diagnoseModuleDrift(ctx);
}

function checkOf(result, needle) {
  const hit = result.checks.find((c) => c.name.includes(needle));
  expect(hit, `no check named like ${needle} in ${JSON.stringify(result.checks)}`).toBeDefined();
  return hit;
}

describe('doctor module drift (#495)', () => {
  it('AC-495-01: a stale executed gate module is reported, not waved through on presence', () => {
    const f = fixture({
      'gate-8.sh': { repo: '#!/bin/bash\n# repo version\n', installed: '#!/bin/bash\n# installed version\n' },
    });
    const result = drift({ repoHooks: f.repoHooks, installedAdapters: f.installedAdapters });
    expect(result.issues).toBeGreaterThanOrEqual(1);
    expect(checkOf(result, 'gate-8.sh').status).toBe('FAIL');
  });

  it('AC-495-02: language adapters are compared through the hook\'s own lookup order', () => {
    // Flat installed copy wins at runtime, so the repo's nested source is the
    // right counterpart for it.
    const flat = fixture({
      'typescript.sh': { repo: 'run_tests() { echo repo; }\n', installed: 'run_tests() { echo stale; }\n' },
    });
    const flatResult = drift({ repoHooks: flat.repoHooks, installedAdapters: flat.installedAdapters });
    expect(checkOf(flatResult, 'typescript.sh').status).toBe('FAIL');

    // When the flat copy is absent the hook falls back to adapters/<name>.sh,
    // and that nested file is the one that executes -- it must be checked too.
    const nested = fixture({
      'python.sh': { repo: 'run_tests() { echo repo; }\n', installed: 'run_tests() { echo stale; }\n', nested: true },
    });
    expect(checkOf(drift({ repoHooks: nested.repoHooks, installedAdapters: nested.installedAdapters }), 'python.sh').status).toBe('FAIL');
  });

  it('AC-495-03: equal content passes and a module missing on either side stays silent', () => {
    const same = 'run_tests() { echo same; }\n';
    const f = fixture({
      'python.sh': { repo: same, installed: same },
      'gate-3.sh': { repo: '#!/bin/bash\nv1\n', installed: '#!/bin/bash\nv1\n' },
      // Repo-only and install-only modules have no counterpart to compare with.
      'go.sh': { repo: 'echo repo only\n', installed: null },
      'swift.sh': { repo: null, installed: 'echo installed only\n' },
    });
    const result = drift({ repoHooks: f.repoHooks, installedAdapters: f.installedAdapters });
    expect(result.issues).toBe(0);
    expect(checkOf(result, 'python.sh').status).toBe('PASS');
    expect(result.checks.filter((c) => c.name.includes('go.sh'))).toHaveLength(0);
    expect(result.checks.filter((c) => c.name.includes('swift.sh'))).toHaveLength(0);

    // A consumer project has no githooks/ at all -- the whole surface must stay
    // completely quiet there, exactly like the hook drift check does.
    const absent = drift({ repoHooks: join(f.root, 'nope'), installedAdapters: f.installedAdapters });
    expect(absent.checks).toHaveLength(0);
    expect(absent.issues).toBe(0);
  });

  it('AC-495-04: bidirectional divergence is a distinct verdict from one-way staleness', () => {
    // Installed carries lines the repo lacks (the machine-only detect-secrets
    // hardening) AND the repo carries lines the install lacks (#449 verdict).
    const f = fixture({
      'gate-8.sh': {
        repo: '#!/bin/bash\nrepo_has_report_artifact_verdict\n',
        installed: '#!/bin/bash\ninstalled_has_detect_secrets_fallback\n',
      },
      'gate-4.sh': { repo: '#!/bin/bash\nline_a\nline_b\n', installed: '#!/bin/bash\nline_a\n' },
    });
    const result = drift({ repoHooks: f.repoHooks, installedAdapters: f.installedAdapters });

    const diverged = checkOf(result, 'gate-8.sh');
    expect(diverged.status).toBe('FAIL');
    expect(diverged.detail).toMatch(/both sides|diverged/i);

    // One-way staleness must NOT be described as divergence, or the guard fires
    // on every routine upgrade and the real case stops standing out.
    const stale = checkOf(result, 'gate-4.sh');
    expect(stale.status).toBe('FAIL');
    expect(stale.detail).not.toMatch(/both sides|diverged/i);
  });

  it('AC-495-05: sync copies stale modules and refuses to overwrite diverged ones', () => {
    const { syncModulesFromRepo } = require('../doctor');
    expect(typeof syncModulesFromRepo).toBe('function');

    const f = fixture({
      'gate-8.sh': {
        repo: '#!/bin/bash\nrepo_has_report_artifact_verdict\n',
        installed: '#!/bin/bash\ninstalled_has_detect_secrets_fallback\n',
      },
      'gate-4.sh': { repo: '#!/bin/bash\nline_a\nline_b\n', installed: '#!/bin/bash\nline_a\n' },
    });

    const first = syncModulesFromRepo({ repoHooks: f.repoHooks, installedAdapters: f.installedAdapters });
    expect(first.synced).toContain('gate-4.sh');
    expect(readFileSync(join(f.installedAdapters, 'gate-4.sh'), 'utf8')).toContain('line_b');
    // The guard is the point: the machine-only hardening survives untouched.
    expect(first.refused.map((r) => r.name)).toContain('gate-8.sh');
    expect(readFileSync(join(f.installedAdapters, 'gate-8.sh'), 'utf8')).toContain('detect_secrets');

    // An explicit decision still wins, because the developer may have judged the
    // repo copy to be the correct one.
    const forced = syncModulesFromRepo({
      repoHooks: f.repoHooks,
      installedAdapters: f.installedAdapters,
      force: true,
    });
    expect(forced.synced).toContain('gate-8.sh');
    expect(readFileSync(join(f.installedAdapters, 'gate-8.sh'), 'utf8')).toContain('report_artifact_verdict');
    expect(existsSync(join(f.installedAdapters, 'gate-8.sh'))).toBe(true);
  });

  it('AC-495-06: anti-vacuity -- the surface is wired into the report and the repair', () => {
    const source = readFileSync(join(__dirname, '..', 'doctor.js'), 'utf8');

    // Detection must run in the real diagnosis, not only in the exported helper.
    expect(/diagnoseModuleDrift\(/.test(source)).toBe(true);
    expect(/diagnoseModuleDrift\(\)/.test(source)).toBe(true);
    // Repair must be reachable from the doctor command surface.
    expect(/syncModulesFromRepo\(/.test(source)).toBe(true);
    // The developer has to be able to see WHICH directory executes (#495's
    // "print the resolved GATE_DIR/ADAPTER_DIR" requirement).
    expect(source).toMatch(/printEffectiveModules|Effective (hooks|modules)/);
    // The presence-only verdict that hid this is gone for gate scripts.
    expect(source).not.toMatch(/status: 'PASS', detail: `\$\{EXPECTED_GATE_SCRIPTS\.length\} gate script\(s\)`/);
  });
});
