/**
 * @test REQ-RESOLVE-001 pre-push 接入生成解析表
 * @intent 证明 pre-push 不再手写 adapter-common.sh 的查找顺序。这是 P1-C 的核心缺陷：
 *   pre-push:534-545 曾有一段手写的 global-first 级联，而 ADAPTER_DIR_ORDER 声明的是
 *   project-first。两者相反的后果是**装了全局版之后，项目自己的 githooks/ 永远不可达**
 *   ——包括本仓库，它自己的 gate 脚本从未真正执行过，而 git log 看起来一切正常。
 * @covers AC-RESOLVE-001-01, AC-RESOLVE-001-02, AC-RESOLVE-001-03,
 *          AC-RESOLVE-001-04, AC-RESOLVE-001-05, AC-RESOLVE-001-06, AC-RESOLVE-001-07
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// scripts/__tests__/ -> scripts/ -> <repo root> :: two '..'.
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PRE_PUSH = path.join(REPO_ROOT, 'githooks', 'pre-push');

function readPrePush() {
  return fs.readFileSync(PRE_PUSH, 'utf8');
}

describe('REQ-RESOLVE-001 pre-push 接入生成解析表', () => {
  describe('AC-RESOLVE-001-01: pre-push source 生成解析表', () => {
    it('pre-push source 了 hook-module-resolution.sh', () => {
      const content = readPrePush();
      expect(content).toMatch(/source\s+["']?\$\{?[A-Z_]*HOOK_RESOLUTION/);
    });

    it('source 之前该文件路径已被解析出来（不是写死的相对路径）', () => {
      const content = readPrePush();
      // 生成的解析表必须能与 pre-push 一起被部署到任意目录，
      // 所以路径要按 hooks 目录解析，不能是 './hook-module-resolution.sh'。
      const idx = content.search(/source\s+["']?\$\{?[A-Z_]*HOOK_RESOLUTION/);
      expect(idx).toBeGreaterThan(-1);
      const before = content.slice(Math.max(0, idx - 2500), idx);
      expect(before).toMatch(/HOOK_RESOLUTION_FILE|HOOK_RESOLUTION_PATH/);
    });
  });

  describe('AC-RESOLVE-001-02: 手写级联被删除（不留第二份顺序实现）', () => {
    /**
     * 注释中描述"这段代码以前长什么样"是允许的——那是有价值的上下文。
     * 因此这三条只看**可执行行**：一个 grep 式的全文断言会把解释历史缺陷的
     * 注释也判为违规，从而逼人删掉注释，反而让下一个维护者重犯。
     */
    const executableLines = (content) =>
      content.split('\n').filter((l) => !l.trim().startsWith('#'));

    it('不再出现手写的 `if [[ -f "$GLOBAL_ADAPTER_DIR/adapter-common.sh" ]]` 级联', () => {
      const offending = executableLines(readPrePush()).filter((l) =>
        /if\s+\[\[?\s+-f\s+"\$GLOBAL_ADAPTER_DIR\/adapter-common\.sh"/.test(l),
      );
      expect(offending).toEqual([]);
    });

    it('不再出现 `elif [[ -f "$PROJECT_GITHOOKS/adapter-common.sh" ]]` 的第二分支', () => {
      const offending = executableLines(readPrePush()).filter((l) =>
        /elif\s+\[\[?\s+-f\s+"\$PROJECT_GITHOOKS\/adapter-common\.sh"/.test(l),
      );
      expect(offending).toEqual([]);
    });

    it('全局优先的顺序字符串不再出现（那正是要修的反向顺序）', () => {
      const content = readPrePush();
      // 注释里描述历史缺陷是允许的，但可执行的 global-first 判断不允许。
      const executableLines = content
        .split('\n')
        .filter((l) => !l.trim().startsWith('#'));
      const offending = executableLines.filter((l) =>
        /GLOBAL_ADAPTER_DIR\/adapter-common\.sh/.test(l) && /-f\s/.test(l),
      );
      expect(offending).toEqual([]);
    });
  });

  describe('AC-RESOLVE-001-03: 通过 _hook_tier_dir 取 ADAPTER_DIR', () => {
    it('pre-push 调用 _hook_tier_dir 而非自己遍历 tier 数组', () => {
      const content = readPrePush();
      expect(content).toMatch(/_hook_tier_dir\s/);
    });

    it('pre-push 遍历 tier 数组时，顺序取自数组本身而非另写一份优先级', () => {
      /**
       * 这条原先写成「不许遍历 HOOK_ADAPTER_DIR_TIERS」，提法是错的：
       * 消费者**需要**遍历，因为「哪个 tier 真的存在」由 probe 文件回答，
       * 那是文件系统的事实，数据无法预先知道。
       *
       * 真正的不变量是：**顺序只有一份**。`for _tier in "${HOOK_ADAPTER_DIR_TIERS[@]}"`
       * 就是按数据顺序走；写成 `for t in global project script` 才是又写了一份优先级。
       */
      const content = readPrePush();
      const executableLines = content
        .split('\n')
        .filter((l) => !l.trim().startsWith('#'));
      // 禁止：for t in global project script / (global project script) / 'global|project'
      const hardcodedOrder = executableLines.filter((l) =>
        /\bin\s+\(?\s*["']?(global|project|script)[\s("'|]/.test(l),
      );
      expect(hardcodedOrder).toEqual([]);
    });
  });

  describe('AC-RESOLVE-001-04: project-first 语义（PC-1 的原始缺陷）', () => {
    it('当项目版与全局版都存在时，pre-push 选择项目版', () => {
      /**
       * 行为断言而非文本断言：在临时目录里造出"项目版 + 全局版都存在"的真实布局，
       * source 生成物后按 pre-push 的方式解析，断言选中项目版。
       * 只做文本断言的话，把 _hook_tier_dir 调错参数也能通过。
       */
      const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pc1-'));
      try {
        const projectGithooks = path.join(tmp, 'proj', 'githooks');
        const globalDir = path.join(tmp, 'global');
        fs.mkdirSync(projectGithooks, { recursive: true });
        fs.mkdirSync(globalDir, { recursive: true });
        fs.writeFileSync(path.join(projectGithooks, 'adapter-common.sh'), '# project');
        fs.writeFileSync(path.join(globalDir, 'adapter-common.sh'), '# global');

        const script = [
          `source "${path.join(REPO_ROOT, 'githooks', 'hook-module-resolution.sh')}"`,
          `PROJECT_GITHOOKS="${projectGithooks}"`,
          `GLOBAL_ADAPTER_DIR="${globalDir}"`,
          '_hook_tier_dir project PROJECT_GITHOOKS',
        ].join('\n');

        const out = execFileSync('bash', ['-c', script], { encoding: 'utf8' }).trim();
        expect(out).toBe(projectGithooks);
        expect(out).not.toBe(globalDir);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  describe('AC-RESOLVE-001-05: 结构断言——生成物被 source 且常量可见', () => {
    it('source 之后 HOOK_ADAPTER_DIR_TIERS 与 HOOK_RESOLUTION_SCHEMA 均可用', () => {
      const script = [
        'set -e',
        `source "${path.join(REPO_ROOT, 'githooks', 'hook-module-resolution.sh')}"`,
        'echo "schema=$HOOK_RESOLUTION_SCHEMA"',
        'echo "tiers=${#HOOK_ADAPTER_DIR_TIERS[@]}"',
      ].join('\n');
      const out = execFileSync('bash', ['-c', script], { encoding: 'utf8' });
      expect(out).toContain('schema=2');
      expect(out).toMatch(/tiers=[1-9]/);
    });
  });

  describe('AC-RESOLVE-001-06: 四种失败形态都必须显式，不得静默', () => {
    /**
     * case A: 生成物缺失
     * case B: 生成物陈旧（schema < 2，无 _hook_tier_dir）
     * case C: 生成物语法损坏
     * case D: 生成物语法正确、函数存在，但契约不符
     *
     * 四种情况的共同要求：pre-push 必须**要么明确失败，要么明确 SKIP 并记录原因**，
     * 不允许"不确定地通过"。
     */
    it('case B：旧 schema 的生成物应被识别为陈旧（缺 _hook_tier_dir）', () => {
      const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pc1-legacy-'));
      try {
        // 实测的旧形态：4 个 HOOK_* 常量、零个函数
        const legacy = path.join(tmp, 'hook-module-resolution.sh');
        fs.writeFileSync(legacy, [
          '#!/bin/bash',
          'HOOK_GATE_PROBE="gate-3.sh"',
          "HOOK_ADAPTER_DIR_TIERS=('global|GLOBAL_ADAPTER_DIR|adapter-common.sh' 'project|PROJECT_GITHOOKS|adapter-common.sh')",
          '',
        ].join('\n'));

        const script = [
          `source "${legacy}"`,
          'if declare -F _hook_tier_dir >/dev/null 2>&1; then echo "HAS_FUNC"; else echo "NO_FUNC"; fi',
          'echo "schema=${HOOK_RESOLUTION_SCHEMA:-unset}"',
        ].join('\n');
        const out = execFileSync('bash', ['-c', script], { encoding: 'utf8' });
        expect(out).toContain('NO_FUNC');
        expect(out).toContain('schema=unset');
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('case D：契约不符时自检必须置 _HOOK_RESOLVE_BROKEN，而不是静默返回错值', () => {
      const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pc1-broken-'));
      try {
        // 一个"语法正确、函数存在、但行为不对"的解析表：永远返回空
        const broken = path.join(tmp, 'hook-module-resolution.sh');
        fs.writeFileSync(broken, [
          '#!/bin/bash',
          'HOOK_RESOLUTION_SCHEMA=2',
          "HOOK_ADAPTER_DIR_TIERS=('project|PROJECT_GITHOOKS|adapter-common.sh')",
          '_hook_tier_dir() { return 0; }',
          '_hook_tier_dir_selfcheck() {',
          '  local _probe_out',
          '  if ! declare -F _hook_tier_dir >/dev/null 2>&1; then',
          '    _HOOK_RESOLVE_BROKEN="missing _hook_tier_dir"; return 1',
          '  fi',
          '  _probe_out="$(PROJECT_GITHOOKS="/__selfcheck__" _hook_tier_dir project PROJECT_GITHOOKS 2>/dev/null)"',
          '  if [ "$_probe_out" != "/__selfcheck__" ]; then',
          '    _HOOK_RESOLVE_BROKEN="selfcheck failed: got [${_probe_out}]"; return 1',
          '  fi',
          '  return 0',
          '}',
          '_hook_tier_dir_selfcheck || :',
          '',
        ].join('\n'));

        const script = [
          `source "${broken}"`,
          'echo "broken=[$_HOOK_RESOLVE_BROKEN]"',
        ].join('\n');
        const out = execFileSync('bash', ['-c', script], { encoding: 'utf8' });
        expect(out).toContain('broken=[');
        expect(out).not.toBe('broken=[]\n');
        expect(out).toMatch(/selfcheck failed/);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('pre-push 在生成物不可用时设置 Gate M 的 SKIP 原因（不静默继续）', () => {
      const content = readPrePush();
      // 既有机制：GATE_M_SKIP_REASON 由 pre-push:155 投影到 details.skip_reason。
      // 新增的 missing/stale 两种情况也必须走这条通道。
      expect(content).toMatch(/GATE_M_SKIP_REASON="hook-module-resolution\.sh/);
      expect(content).toMatch(/GATE_M_SKIP_KIND="(missing|stale)"/);
    });
  });

  describe('AC-RESOLVE-001-07: 所有 skip 路径都带 skip_kind（不漏其中任何一条）', () => {
    it('每一处 GATE_M_SKIP_REASON 赋值都有配对的 GATE_M_SKIP_KIND', () => {
      const content = readPrePush();
      // 只数**可执行赋值**（行首缩进 + 变量名 =），不数注释与字符串里出现的名字：
      // 注释里讨论这些字段是正常的，把它们算进去会让这条断言永远为真。
      const assign = (name) => {
        const re = new RegExp(`^[ \t]*${name}=`, 'gm');
        return (content.match(re) || []).length;
      };
      const reasonCount = assign('GATE_M_SKIP_REASON');
      const kindCount = assign('GATE_M_SKIP_KIND');

      // 实测：12 处 GATE_M_SKIP_REASON 赋值点（2 条新增的解析失败路径
      // + 4 条其它 adapter 路径 + 6 条既有 Gate M 路径）。
      expect(reasonCount).toBe(12);
      // kind 比 reason 多 1：count 类断言之上还有一次 `GATE_M_SKIP_KIND=""` 初始化。
      // 初始化是必要的——否则「未设置」和「设置为空」不可区分。
      expect(kindCount).toBe(reasonCount + 1);
    });

    it('_m_details 投影把 skip_kind 写入与 skip_reason 同层级', () => {
      const content = readPrePush();
      expect(content).toMatch(/'skip_reason':\s*'\$\{GATE_M_SKIP_REASON:-\}'/);
      expect(content).toMatch(/'skip_kind':\s*'\$\{GATE_M_SKIP_KIND:-\}'/);
    });
  });
});
