/**
 * @test REQ-495 Round 2: the drift surface must not lie in either direction
 * @intent 三位专家对 origin/main..HEAD 的走查给出三条同族判定：(1) 字节不同但行集
 *         相同（仅行尾/缩进差异）落入 moduleDriftDetail 兜底分支，报 FAIL 却写着
 *         "0 line(s) absent from the repo"，方向断言为伪且 --fix 清不掉；(2)
 *         diagnoseModuleDrift 认 XP_GATE_REPO_ROOT 而 syncModulesFromRepo 只认
 *         process.cwd()，在仓库外带 env 运行 --sync-hooks 时诊断报 FAIL、同步静默
 *         空转（#488/#416 已明令禁止的"被忽略的选项"缺陷类）；(3) drift 结果被
 *         Promise.race 的全局 10s 超时整份丢弃并返回 issues:0，doctor 随即打印
 *         "✓ All checks passed" —— 正是 #495 要消灭的"模块陈旧但 doctor 全绿"。
 *         外加 lib/ 通道：syncGlobalHooksFromRepo 对 githooks/lib/*.sh 无条件覆盖，
 *         而同一次发布里模块同步对同类风险显式拒绝，破坏性写入标准不对称。
 * @covers AC-495-07, AC-495-08, AC-495-09, AC-495-10, AC-495-13, AC-488-05
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function fixture(spec) {
  const root = mkdtempSync(join(tmpdir(), 'xp-gate-r2-'));
  const repoHooks = join(root, 'githooks');
  const installedHooks = join(root, 'hooks');
  const installedAdapters = join(root, 'adapters');
  mkdirSync(join(repoHooks, 'adapters'), { recursive: true });
  mkdirSync(join(repoHooks, 'lib'), { recursive: true });
  mkdirSync(installedHooks, { recursive: true });
  mkdirSync(installedHooks + '/lib', { recursive: true });
  mkdirSync(installedAdapters, { recursive: true });

  const write = (file, text) => {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, text);
  };

  for (const [name, sides] of Object.entries(spec)) {
    const rootLevel = name.startsWith('gate-') || name === 'adapter-common.sh' || name.startsWith('lib/');
    if (sides.repo !== null) {
      write(join(repoHooks, rootLevel ? name : join('adapters', name)), sides.repo);
    }
    if (sides.installed !== undefined && sides.installed !== null) {
      write(join(installedAdapters, name), sides.installed);
    }
    // lib/ lives under hooks/, not under the adapters dir, so it needs its own pair.
    if (sides.installedLib !== undefined) {
      write(join(installedHooks, name), sides.installedLib);
    }
  }

  write(join(repoHooks, 'pre-commit'), '#!/bin/bash\necho repo\n');
  write(join(installedHooks, 'pre-commit'), '#!/bin/bash\necho repo\n');

  // Resolution anchors: the installed dir only becomes ADAPTER_DIR / GATE_DIR if
  // adapter-common.sh (githooks/pre-commit:34) and gate-3.sh (:80) live in it.
  // Without them the fixture describes a tier the hook never resolves to, and the
  // comparison silently targets a directory outside the test (#495 Round 3).
  const ANCHOR = '#!/bin/bash\nanchor\n';
  for (const anchor of ['adapter-common.sh', 'gate-3.sh']) {
    if (spec[anchor]) continue;
    write(join(repoHooks, anchor), ANCHOR);
    write(join(installedAdapters, anchor), ANCHOR);
  }

  return { root, repoHooks, installedHooks, installedAdapters, write };
}

/**
 * Name every tier the hook can resolve into so no fixture can reach this
 * machine's real `~/.config/xp-gate`.
 */
function ctxFor(f, extra = {}) {
  return {
    repoRoot: f.root,
    repoHooks: f.repoHooks,
    installedAdapters: f.installedAdapters,
    scriptDir: f.installedHooks,
    ...extra,
  };
}

describe('doctor drift Round 2 (#495)', () => {
  it('AC-495-07: a line-ending-only difference is not reported as drift, and never claims zero unique lines', () => {
    const { diagnoseModuleDrift } = require('../doctor');
    const repo = '#!/bin/bash\ngate_line_one\ngate_line_two\n';
    const f = fixture({
      'gate-4.sh': { repo, installed: repo.replace(/\n/g, '\r\n') },
    });

    const result = diagnoseModuleDrift(ctxFor(f));
    const check = result.checks.find((c) => c.name === 'Module drift: gate-4.sh');
    expect(check).toBeDefined();
    expect(check.status).not.toBe('FAIL');
    expect(result.issues).toBe(0);
    // The self-contradicting verdict ("newer ... 0 line(s) absent") must be gone.
    expect(check.detail).not.toMatch(/0 line\(s\)/);
  });

  it('AC-495-08: sync resolves the repo root the same way the diagnosis does', () => {
    const { syncModulesFromRepo, diagnoseModuleDrift } = require('../doctor');
    const f = fixture({
      'gate-4.sh': { repo: '#!/bin/bash\nline_a\nline_b\n', installed: '#!/bin/bash\nline_a\n' },
    });

    // Run from OUTSIDE the repository with the repo located by env only.
    const previous = process.env.XP_GATE_REPO_ROOT;
    process.env.XP_GATE_REPO_ROOT = f.root;
    try {
      const diagnosis = diagnoseModuleDrift(ctxFor(f));
      expect(diagnosis.issues).toBe(1);

      // Only the install target is named: the repo must come from the same env
      // the diagnosis used, or the FAIL this produces can never be cleared.
      const synced = syncModulesFromRepo({ installedAdapters: f.installedAdapters, scriptDir: f.installedHooks });
      expect(synced.synced).toContain('gate-4.sh');
      expect(readFileSync(join(f.installedAdapters, 'gate-4.sh'), 'utf8')).toContain('line_b');
      expect(diagnoseModuleDrift(ctxFor(f)).issues).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.XP_GATE_REPO_ROOT;
      else process.env.XP_GATE_REPO_ROOT = previous;
    }
  });

  it('AC-495-09: sync with no canonical repo source says so instead of returning an empty success', () => {
    const { syncModulesFromRepo } = require('../doctor');
    const root = mkdtempSync(join(tmpdir(), 'xp-gate-r2-nosource-'));
    const installedAdapters = join(root, 'adapters');
    mkdirSync(installedAdapters, { recursive: true });
    writeFileSync(join(installedAdapters, 'gate-4.sh'), '#!/bin/bash\ninstalled\n');

    const previous = process.env.XP_GATE_REPO_ROOT;
    process.env.XP_GATE_REPO_ROOT = root; // no githooks/ under here at all
    try {
      const result = syncModulesFromRepo({ repoRoot: root, installedAdapters });
      expect(result.sourceMissing).toBe(true);
      expect(result.errors.join('\n')).toMatch(/no (canonical )?githooks/i);
    } finally {
      if (previous === undefined) delete process.env.XP_GATE_REPO_ROOT;
      else process.env.XP_GATE_REPO_ROOT = previous;
    }
  });

  it('AC-495-10: a timed-out diagnosis can never print "All checks passed"', () => {
    const source = readFileSync(join(__dirname, '..', 'doctor.js'), 'utf8');

    // The race outcome must carry timedOut out of the destructuring...
    expect(source).toMatch(/const \{[^}]*timedOut[^}]*\} = await Promise\.race/);
    // ...and branch on it, because a timeout discards every computed FAIL.
    expect(source).toMatch(/if \(timedOut\)[\s\S]{0,200}issues\s*(\+\+|\+=|= Math\.max)/);
  });

  it('AC-495-13: a flat copy inside the project githooks/ is diagnosed when the project tier is what executes', () => {
    const { diagnoseModuleDrift } = require('../doctor');
    // Project mode (no global install): pre-commit:36-37 resolves ADAPTER_DIR to
    // <repo>/githooks, and resolve_adapter_path() then tries $ADAPTER_DIR/<lang>.sh
    // before the nested source. The installer wrote those flat copies once and
    // .gitignore:42 keeps them out of the repo, so a later repo fix that only
    // touches adapters/<lang>.sh leaves the stale flat copy executing -- a
    // #493-class repair inert in the very repository that shipped it.
    const root = mkdtempSync(join(tmpdir(), 'xp-gate-project-tier-'));
    const repoHooks = join(root, 'githooks');
    mkdirSync(join(repoHooks, 'adapters'), { recursive: true });
    writeFileSync(join(repoHooks, 'pre-commit'), '#!/bin/bash\necho repo\n');
    writeFileSync(join(repoHooks, 'adapter-common.sh'), '#!/bin/bash\nshared\n');
    writeFileSync(join(repoHooks, 'gate-3.sh'), '#!/bin/bash\ngate3\n');
    writeFileSync(join(repoHooks, 'adapters', 'iac.sh'), '#!/bin/bash\nfixed_count_guard\n');
    writeFileSync(join(repoHooks, 'iac.sh'), '#!/bin/bash\nstale_echo_zero\n');

    const result = diagnoseModuleDrift({
      repoRoot: root,
      installedAdapters: join(root, 'nothing-installed-globally'),
      scriptDir: join(root, 'nothing-installed-hooks'),
    });

    const projectCheck = result.checks.find((c) => /Module drift \(project\): iac\.sh/.test(c.name));
    expect(projectCheck, 'the executed project-tier flat copy is invisible to doctor').toBeDefined();
    expect(projectCheck.status).toBe('FAIL');
    // The verdict has to say what to do with a gitignored installer residue.
    expect(projectCheck.detail).toMatch(/flat|shadow/i);
    expect(result.issues).toBe(1);
  });

  it('AC-488-05: lib/ sync refuses an installed library the repo does not have lines for', () => {
    const { syncGlobalHooksFromRepo } = require('../doctor');
    const f = fixture({
      'lib/test-failure.sh': {
        repo: '#!/bin/bash\nrepo_shared_helper\n',
        installedLib: '#!/bin/bash\ninstalled_machine_hardening\n',
      },
    });

    const result = syncGlobalHooksFromRepo({
      repoHooks: f.repoHooks,
      installedHooks: f.installedHooks,
    });

    expect(result.refused.map((r) => r.name)).toContain('lib/test-failure.sh');
    expect(readFileSync(join(f.installedHooks, 'lib', 'test-failure.sh'), 'utf8'))
      .toContain('installed_machine_hardening');
    expect(existsSync(join(f.installedHooks, 'lib', 'test-failure.sh'))).toBe(true);

    // A one-way-stale library still syncs: the guard is for divergence, not staleness.
    const stale = fixture({
      'lib/test-failure.sh': {
        repo: '#!/bin/bash\nshared_a\nshared_b\n',
        installedLib: '#!/bin/bash\nshared_a\n',
      },
    });
    const second = syncGlobalHooksFromRepo({ repoHooks: stale.repoHooks, installedHooks: stale.installedHooks });
    expect(second.synced).toContain('lib/test-failure.sh');
    expect(readFileSync(join(stale.installedHooks, 'lib', 'test-failure.sh'), 'utf8')).toContain('shared_b');
  });
});
