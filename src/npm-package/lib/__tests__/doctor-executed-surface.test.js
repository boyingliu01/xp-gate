/**
 * @test REQ-495 Round 3: only the module the hook resolves may be reported as executed
 * @intent Round 2 的两位专家指向同一处缺陷：F5 把项目 tier 无条件标成"executed from the
 *         project tier"，而 pre-commit 的解析顺序是 ADAPTER_DIR 优先取全局目录
 *         （githooks/pre-commit:34-35），语言适配器在项目 tier 只经 nested 命中
 *         （:67-69），平铺副本在全局安装存在时根本不执行。于是 doctor 既会把不执行的
 *         文件判成 FAIL（R1-2 那一类"断言了假方向"的 FAIL），又因为修复面只走全局目录
 *         而让该 FAIL 永远清不掉（永久 exit 1）。本文件把"哪个路径被执行"收敛到
 *         resolveExecutedModuleDirs()+executedModulePath() 这一个模型上：执行的才计入
 *         issues 并可被 sync 清除，不执行的作为 residue 报告并给出绝对路径与手工处置，
 *         不计入 issues。AC-495-17 补上旧 tier 列表完全忽略的第 4 层（SCRIPT_DIR），
 *         AC-495-19 钉住"读不到就拒绝覆盖"的守卫缝隙。
 * @covers AC-495-14, AC-495-15, AC-495-16, AC-495-17, AC-495-18, AC-495-19
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ADAPTER = '#!/bin/bash\nfixed_count_guard\n';
const STALE_FLAT = '#!/bin/bash\nstale_echo_zero\n';
// One-way stale: every line it holds is also in the repo, so the copy guard lets
// the sync through. The divergence cases keep STALE_FLAT and must refuse.
const SUBSET_FLAT = '#!/bin/bash\n';

function write(file, text) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
}

function tempRoot(prefix) {
  return mkdtempSync(join(tmpdir(), `xp-gate-${prefix}-`));
}

/**
 * A tree carrying all the tiers the hook can resolve into, so precedence between
 * tiers is part of the fixture instead of an assumption.
 */
function tree(overrides = {}) {
  const root = tempRoot('tier');
  const repoDir = join(root, 'repo');
  const repoHooks = join(repoDir, 'githooks');
  const globalAdapters = join(root, 'global', 'adapters');
  const scriptDir = join(root, 'global', 'hooks');
  for (const dir of [join(repoHooks, 'adapters'), globalAdapters, join(globalAdapters, 'adapters'), scriptDir]) {
    mkdirSync(dir, { recursive: true });
  }

  // Canonical repo source of truth: nested language adapter, flat gate module.
  write(join(repoHooks, 'adapter-common.sh'), '#!/bin/bash\nshared\n');
  write(join(repoHooks, 'pre-commit'), '#!/bin/bash\necho repo\n');
  // The project tree owns adapter-common.sh, so precedence (AC-495-23) makes it
  // the ADAPTER_DIR -- this nested copy is what actually runs unless a test says
  // otherwise, which is why its content is overridable.
  write(join(repoHooks, 'adapters', 'iac.sh'), overrides.projectNestedIac || REPO_ADAPTER);
  write(join(repoHooks, 'gate-4.sh'), '#!/bin/bash\ngate_a\ngate_b\n');

  // Installed global tier: the installer's nested copy is current...
  write(join(globalAdapters, 'adapter-common.sh'), '#!/bin/bash\nshared\n');
  write(join(globalAdapters, 'adapters', 'iac.sh'), REPO_ADAPTER);
  if (overrides.globalFlatIac) write(join(globalAdapters, 'iac.sh'), overrides.globalFlatIac);
  if (overrides.globalGate4) write(join(globalAdapters, 'gate-4.sh'), overrides.globalGate4);

  // Project-tier flat copy (gitignored installer residue): stale by default.
  if (overrides.projectFlatIac !== null) {
    write(join(repoHooks, 'iac.sh'), overrides.projectFlatIac || STALE_FLAT);
  }

  return {
    root,
    repoDir,
    repoHooks,
    globalAdapters,
    scriptDir,
    projectFlatIac: join(repoHooks, 'iac.sh'),
  };
}

function ctxFor(t, extra = {}) {
  return {
    repoRoot: t.repoDir,
    repoHooks: t.repoHooks,
    globalAdapterDir: t.globalAdapters,
    projectGithooks: t.repoHooks,
    scriptDir: t.scriptDir,
    ...extra,
  };
}

function drift(t, extra = {}) {
  const { diagnoseModuleDrift } = require('../doctor');
  return diagnoseModuleDrift(ctxFor(t, extra));
}

function checkOf(result, name) {
  return result.checks.find((c) => c.name === name);
}

describe('doctor executed surface (#495 Round 3)', () => {
  it('AC-495-14: this repo carries its own githooks/, so the PROJECT copy is executed and a stale global flat copy is only residue', () => {
    // Precedence is project-first (AC-495-23): the global install is the DEFAULT
    // for repos with no githooks/ of their own, not an override of one. This tree
    // has adapter-common.sh in the project tier, so it supplies ADAPTER_DIR and
    // the global flat copy is no longer what runs.
    const t = tree({ globalFlatIac: STALE_FLAT });
    const result = drift(t);
    expect(
      checkOf(result, 'Module drift: iac.sh'),
      'with the project tier winning, the stale global flat copy must not read as executed',
    ).toBeUndefined();
    const shadowed = result.checks.find((c) => /Non-executed copy: iac\.sh/.test(c.name));
    expect(shadowed, 'the shadowed global copy must still be surfaced').toBeDefined();
    expect(shadowed.status).not.toBe('FAIL');
  });

  it('AC-495-15: with the project tier winning, a flat copy in the project githooks/ DOES execute and is judged as drift', () => {
    // Corrected premise. This test used to assert that a flat project copy never
    // executes, on the reading that the hook only looks for
    // $PROJECT_GITHOOKS/adapters/<lang>.sh there. That is not what the hook does:
    // HOOK_ADAPTER_TIERS starts with 'adapter_flat|ADAPTER_DIR|{name}.sh', and
    // ADAPTER_DIR is now allowed to BE the project tier (AC-495-23), so the flat
    // path is $PROJECT_GITHOOKS/<name>.sh -- the project root. Driving the hook's
    // own _hook_resolve over this fixture returns exactly that file.
    //
    // So the flat project copy is the executed one, and a stale version of it is
    // real drift: a FAIL the developer must fix, not residue to be ignored.
    const t = tree({ projectFlatIac: undefined });
    const result = drift(t);
    const executed = result.checks.find((c) => /iac\.sh/.test(c.name) && !/Non-executed/.test(c.name));
    expect(executed, 'the executed project-tier flat copy must be diagnosed').toBeDefined();
    expect(executed.status).toBe('FAIL');
    expect(result.issues).toBeGreaterThanOrEqual(1);
  });

  it('AC-495-16: the same project-tier flat copy IS executed once ADAPTER_DIR resolves to the project tier, and then it FAILs', () => {
    const t = tree({ projectFlatIac: undefined });
    // No global install -> pre-commit:36-37 resolves ADAPTER_DIR to the repo.
    const result = drift(t, { globalAdapterDir: join(t.root, 'no-global-install') });
    const check = result.checks.find((c) => /iac\.sh$/.test(c.name));
    expect(check, 'the executed project-tier copy must be diagnosed').toBeDefined();
    expect(check.status).toBe('FAIL');
    expect(result.issues).toBe(1);
  });

  it('AC-495-17: gate modules follow GATE_DIR down to the hook\'s last tier ($SCRIPT_DIR)', () => {
    // The installed hooks dir is the only tier carrying adapter-common.sh and
    // gate-3.sh, so ADAPTER_DIR == GATE_DIR == $SCRIPT_DIR (pre-commit:39, 80-81)
    // and a stale gate module lives there -- invisible to the old two-tier walk.
    const root = tempRoot('scriptdir');
    const repoDir = join(root, 'repo');
    const repoHooks = join(repoDir, 'githooks');
    const scriptDir = join(root, 'installed', 'hooks');
    mkdirSync(join(repoHooks, 'adapters'), { recursive: true });
    write(join(repoHooks, 'pre-commit'), '#!/bin/bash\necho repo\n');
    write(join(repoHooks, 'gate-4.sh'), '#!/bin/bash\ngate_a\ngate_b\n');
    // A repo without adapter-common.sh/gate-3.sh installed alongside: the hook's
    // fallback chain ends at SCRIPT_DIR.
    write(join(scriptDir, 'adapter-common.sh'), '#!/bin/bash\nshared\n');
    write(join(scriptDir, 'gate-3.sh'), '#!/bin/bash\ngate3\n');
    // One-way stale, so this test judges reachability of the repair, not the
    // divergence guard (which AC-495-05 already pins).
    write(join(scriptDir, 'gate-4.sh'), '#!/bin/bash\ngate_a\n');

    const { diagnoseModuleDrift, syncModulesFromRepo } = require('../doctor');
    const ctx = {
      repoRoot: repoDir,
      repoHooks,
      globalAdapterDir: join(root, 'nothing', 'adapters'),
      projectGithooks: repoHooks,
      scriptDir,
    };
    const result = diagnoseModuleDrift(ctx);
    const check = result.checks.find((c) => /gate-4\.sh$/.test(c.name));
    expect(check, 'an executed copy under the installed hooks dir is invisible to doctor').toBeDefined();
    expect(check.status).toBe('FAIL');
    expect(result.issues).toBe(1);

    // And the repair reaches the same tier, so the FAIL is not permanent.
    const synced = syncModulesFromRepo(ctx);
    expect(synced.synced).toContain('gate-4.sh');
    expect(readFileSync(join(scriptDir, 'gate-4.sh'), 'utf8')).toContain('gate_b');
    expect(diagnoseModuleDrift(ctx).issues).toBe(0);
  });

  it('AC-495-18: every FAIL the resolution can produce, syncModulesFromRepo can clear', () => {
    // With the project tier owning ADAPTER_DIR, the executed copy is the project's
    // flat iac.sh (AC-495-15). A stale one there is drift against the repo's
    // nested source, and the repair must reach that same tier -- otherwise the
    // FAIL is permanent, which is exactly what this AC forbids.
    const { syncModulesFromRepo, diagnoseModuleDrift } = require('../doctor');
    const t = tree({ globalFlatIac: undefined, projectFlatIac: SUBSET_FLAT });
    const ctx = ctxFor(t);
    expect(diagnoseModuleDrift(ctx).issues).toBeGreaterThanOrEqual(1);

    const synced = syncModulesFromRepo(ctx);
    expect(synced.synced).toContain('iac.sh');
    expect(readFileSync(t.projectFlatIac, 'utf8')).toContain('fixed_count_guard');
    expect(diagnoseModuleDrift(ctx).issues).toBe(0);
  });

  it('AC-495-18b: the sync never deletes or rewrites non-executed residue on its own initiative', () => {
    // A flat project copy IS executed now (AC-495-15), so residue has to be a
    // copy in a tier that the resolution does not pick: the global flat one,
    // shadowed by the project tier that owns ADAPTER_DIR.
    const { syncModulesFromRepo } = require('../doctor');
    const t = tree({ globalFlatIac: SUBSET_FLAT, projectFlatIac: null });
    const before = readFileSync(join(t.globalAdapters, 'iac.sh'), 'utf8');
    const synced = syncModulesFromRepo(ctxFor(t));
    expect(synced.synced).not.toContain('iac.sh');
    expect(readFileSync(join(t.globalAdapters, 'iac.sh'), 'utf8')).toBe(before);
  });

  it('AC-495-19: an unreadable destination is refused, not overwritten', () => {
    const { copyGuardDecision } = require('../doctor');
    const root = tempRoot('guard');
    const source = join(root, 'source.sh');
    write(source, '#!/bin/bash\nrepo_line\n');
    // A directory where a file is expected: readFileSync throws, so the delta is unknown.
    const targetIsDir = join(root, 'target.sh');
    mkdirSync(targetIsDir, { recursive: true });

    expect(copyGuardDecision(source, targetIsDir, false).refuse, 'unknown content must never be overwritten silently').toBe(true);
    // Content known to be a subset still syncs; an explicit force still proceeds.
    const targetOk = join(root, 'stale.sh');
    write(targetOk, '#!/bin/bash\n');
    expect(copyGuardDecision(source, targetOk, false).refuse).toBe(false);
    expect(copyGuardDecision(source, targetIsDir, true).forced).toBe(true);
    expect(existsSync(targetIsDir)).toBe(true);
  });
});
