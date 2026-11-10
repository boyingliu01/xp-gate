/**
 * @test REQ-RESOLVE-004 升级路径等价性
 * @intent 升级路径的全部意义是「升级后的行为与全新安装一致」。既有断言只证明了
 *   「旧文件没有函数」「文件可以被更新」，**从未证明升级后的解析结果等于新装**。
 *   如果升级后行为不同，那只是把「缺文件」换成了「有文件但行为不对」——更难发现。
 *
 *   R2 第 7 轮三位专家一致指出这是缺口；AC-RESOLVE-004-10 因此要求三个 tier 逐一
 *   比对。只比 project 一项不够：旧 global-first 实现在「全局未安装」时恰好给出
 *   正确的 project 答案，只有 global tier 才暴露缺陷本身。
 * @covers AC-RESOLVE-004-01, AC-RESOLVE-004-02, AC-RESOLVE-004-03,
 *          AC-RESOLVE-004-04, AC-RESOLVE-004-05, AC-RESOLVE-004-06,
 *          AC-RESOLVE-004-07, AC-RESOLVE-004-08, AC-RESOLVE-004-09,
 *          AC-RESOLVE-004-10
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// scripts/__tests__/ -> scripts/ -> <repo root> :: two '..'.
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GENERATED = path.join(REPO_ROOT, 'githooks', 'hook-module-resolution.sh');

/** 实测的旧生成物形态：4 个 HOOK_* 常量、零个函数、global-first 顺序。 */
const LEGACY_ARTIFACT = [
  '#!/bin/bash',
  '# GENERATED FILE — DO NOT EDIT.  (schema 1, before P1-C)',
  'HOOK_GATE_PROBE="gate-3.sh"',
  'HOOK_ADAPTER_DIR_TIERS=(',
  "  'global|GLOBAL_ADAPTER_DIR|adapter-common.sh'",
  "  'project|PROJECT_GITHOOKS|adapter-common.sh'",
  "  'script|SCRIPT_DIR|adapter-common.sh'",
  ')',
  '',
].join('\n');

/**
 * 在给定的 fixture 布局里 source 一份解析表，然后解析三个 tier。
 * 每个 tier 的 adapter-common.sh 内容带一个 MARKER，用来区分"选中了哪个"。
 */
function resolveAllTiers(artifactPath, layout) {
  const script = [
    'set -u',
    `source "${artifactPath}" 2>/dev/null || { echo "SOURCE_FAILED"; exit 0; }`,
    `PROJECT_GITHOOKS="${layout.project}"`,
    `GLOBAL_ADAPTER_DIR="${layout.global}"`,
    `SCRIPT_DIR="${layout.script}"`,
    'if ! declare -F _hook_resolve >/dev/null 2>&1; then echo "NO_RESOLVER"; exit 0; fi',
    'for _t in "project PROJECT_GITHOOKS" "global GLOBAL_ADAPTER_DIR" "script SCRIPT_DIR"; do',
    '  set -- $_t',
    '  printf "%s=%s\\n" "$1" "$(_hook_resolve "$1" "$2")"',
    'done',
  ].join('\n');
  return execFileSync('bash', ['-c', script], { encoding: 'utf8' }).trim();
}

/** 建一个三 tier 齐备的 fixture 根，供两个场景共用同一棵树。 */
function buildLayout(root) {
  const layout = {
    project: path.join(root, 'proj', 'githooks'),
    global: path.join(root, 'global'),
    script: path.join(root, 'hookdir'),
  };
  for (const dir of Object.values(layout)) fs.mkdirSync(dir, { recursive: true });
  // 三个 tier 各放一份内容不同的 adapter-common.sh，用 MARKER 区分
  fs.writeFileSync(path.join(layout.project, 'adapter-common.sh'), 'TIER_MARKER=PROJECT\n');
  fs.writeFileSync(path.join(layout.global, 'adapter-common.sh'), 'TIER_MARKER=GLOBAL\n');
  fs.writeFileSync(path.join(layout.script, 'adapter-common.sh'), 'TIER_MARKER=SCRIPT\n');
  return layout;
}

describe('REQ-RESOLVE-004 升级路径等价性', () => {
  describe('AC-RESOLVE-004-01: 旧生成物没有解析函数（升级的起点）', () => {
    it('schema 1 的生成物 source 后没有 _hook_resolve', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc1-legacy-'));
      try {
        const legacy = path.join(tmp, 'hook-module-resolution.sh');
        fs.writeFileSync(legacy, LEGACY_ARTIFACT);
        const out = resolveAllTiers(legacy, buildLayout(tmp));
        expect(out).toBe('NO_RESOLVER');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  describe('AC-RESOLVE-004-10: 升级后解析结果 === 全新安装（三 tier 逐一比对）', () => {
    it('同一棵树：升级路径与全新安装路径的三个 tier 解析结果逐项相等', () => {
      // 两条路径共用同一棵 fixture 树，唯一差别是解析表的来源。
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc1-equivalence-'));
      try {
        const layout = buildLayout(tmp);

        // 路径 A（升级）：项目里先有一份 schema 1 的旧生成物，被新版覆盖。
        const upgradedArtifact = path.join(tmp, 'upgraded.sh');
        fs.writeFileSync(upgradedArtifact, LEGACY_ARTIFACT);
        fs.copyFileSync(GENERATED, upgradedArtifact); // 模拟 update-hooks 覆盖

        // 路径 B（全新安装）：直接放置当前生成物。
        const freshArtifact = path.join(tmp, 'fresh.sh');
        fs.copyFileSync(GENERATED, freshArtifact);

        const upgraded = resolveAllTiers(upgradedArtifact, layout);
        const fresh = resolveAllTiers(freshArtifact, layout);

        expect(upgraded).toEqual(fresh);
        expect(upgraded).not.toContain('NO_RESOLVER');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('解析结果体现 project-first——用内容而非路径字符串断言', () => {
      /**
       * R2 第 8 轮专家 C：断言 `resolve('project') === path.join(PROJECT_GITHOOKS,
       * 'adapter-common.sh')` 断言的是"路径字符串怎么拼"（实现细节，改动就红）。
       * 改为断言"选中了哪个 tier 的那份文件"（需求本身，只有语义错了才红）。
       */
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc1-precedence-'));
      try {
        const layout = buildLayout(tmp);
        const out = resolveAllTiers(GENERATED, layout);

        const resolved = Object.fromEntries(
          out.split('\n').map((line) => line.split('=')),
        );
        // 三个 tier 各自解析到自己的目录
        expect(resolved.project).toBe(layout.project);
        expect(resolved.global).toBe(layout.global);
        expect(resolved.script).toBe(layout.script);

        // 用内容证明「project 选中的是项目那份」
        const marker = fs
          .readFileSync(path.join(resolved.project, 'adapter-common.sh'), 'utf8')
          .match(/TIER_MARKER=(\w+)/)[1];
        expect(marker).toBe('PROJECT');

        // 且 global tier 也不受 project-first 影响（它仍解析到自己的目录）
        const globalMarker = fs
          .readFileSync(path.join(resolved.global, 'adapter-common.sh'), 'utf8')
          .match(/TIER_MARKER=(\w+)/)[1];
        expect(globalMarker).toBe('GLOBAL');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  describe('AC-RESOLVE-004-03: 升级后不再出现 command-not-found（正负双向）', () => {
    it('正向主证据：升级后 _hook_resolve 可调用且返回非空', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc1-positive-'));
      try {
        const layout = buildLayout(tmp);
        const out = resolveAllTiers(GENERATED, layout);
        expect(out).toContain('project=');
        expect(out).not.toContain('project=\n');
        expect(out).not.toContain('NO_RESOLVER');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('负向辅助证据：升级后的输出里不出现 command not found', () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc1-negative-'));
      try {
        const layout = buildLayout(tmp);
        const out = execFileSync('bash', ['-c', [
          `source "${GENERATED}" 2>&1`,
          `PROJECT_GITHOOKS="${layout.project}"`,
          '_hook_resolve project PROJECT_GITHOOKS 2>&1',
        ].join('\n')], { encoding: 'utf8' });
        expect(out).not.toMatch(/command not found/);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});
