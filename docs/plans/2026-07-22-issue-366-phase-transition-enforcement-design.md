# #366: Sprint Phase-Transition 程序化强制执行机制 (v2)

## 问题

`xp-gate phase-transition --render` CLI 功能正常，但编排器在实际 sprint 中从未调用。
#338 的修复将"渲染看板"的文本指令替换为"调用 CLI"的文本指令——本质仍是 **文本级 MUST**，
编排器需要"记住"在每个 Phase 完成后执行一个与主任务无关的额外步骤。

**连续 3 次 sprint 均未渲染看板**，证明文本级指令对 LLM 后置元信息行为无效。

## 根因分析

LLM 编排器优先级栈：
1. 用户请求/任务目标（最高）
2. 阶段性流程指令（做什么）
3. 输出格式指令（怎么渲染）
4. **后置元信息指令（做完后报告）** ← phase-transition 在此层，几乎被忽略

## 设计方案：三层强制机制 (v2 — 修订版)

### Layer 1: Sprint 初始化 CLI（`xp-gate sprint-init`）

**目标**：Phase 1 PREP 的第一步自动创建 sprint-state.json，不需要编排器"记住"。

```
Usage: xp-gate sprint-init "<task_description>" [--issues "<#123,#456>"] [--force] [--dry-run]
```

**非交互设计**（LLM 编排器无法处理 stdin 交互）：
- 默认行为：已有活跃 sprint 时 **报错退出**（exit 1），输出冲突信息
- `--force`：覆盖已有 sprint，自动备份旧 state 到 `.sprint-history/`
- `--dry-run`：预检冲突，不写入任何文件
- **幂等性**：若当前 sprint 的 task_description 和 branch 完全匹配，视为幂等调用，
  直接输出当前看板并 exit 0（防止上下文恢复时重复初始化）

**实现**：复用现有 `SprintStateManager` 的 `createInitialState()` + `write()` 方法，
不重新实现状态管理逻辑。

逻辑：
1. 检测当前分支（sprint/* 或 main）
2. 生成 sprint ID（`sprint-<date>-<seq>`）
3. 调用 `SprintStateManager.createInitialState()` 创建状态
4. 自动调用 `renderDashboard()` 输出初始看板
5. 冲突处理：报错退出 / `--force` 覆盖 / 幂等匹配

### Layer 2: TodoWrite 嵌入式 Phase Transition

**目标**：将 phase-transition 调用嵌入 TodoWrite 的 phase 完成步骤中，使其成为"主任务"的一部分。

修改 SKILL.md 的 Required Output Format 部分：

**当前**（失效）：
```
5. Each phase completion MUST write Phase Summary
6. Each phase completion MUST call `xp-gate phase-transition <N> <status> --render`
```

**修改为**（嵌入式）：
```
每个 Phase 的 TodoWrite 必须包含以下原子步骤：
- Phase N: <主任务描述>
- Phase N: phase-transition <N> completed + transition <N+1> in_progress --render

phase-transition 步骤与主任务步骤合并为同一个 TodoWrite item，
不可拆分、不可跳过、不可延后。
```

**原理**：TodoWrite item 是 LLM 最一致执行的操作。将 phase-transition 嵌入 TodoWrite
使其从"后置元信息"（优先级 4）提升为"主任务步骤"（优先级 2）。

**有效性验证**：在接下来 3 次 sprint 中统计执行率。若仍低于 80%，
需升级为程序化钩子（如 phase-transition 作为 TodoWrite 工具的 post-hook 自动触发）。

### Layer 3: 扩展现有 Gate 11（Sprint Flow Enforcement）

**目标**：在 pre-commit 时验证 sprint-state.json 与实际 phase 进度一致。

**关键修订**：不新建 gate 脚本，而是 **扩展现有 `githooks/sprint-gate.sh`**，
增加 `--staleness-check` 模式。

```bash
# 扩展现有 sprint-gate.sh（不新建脚本，避免编号冲突）
# 新增 --staleness-check 模式：
# 1. 如果 sprint-state.json 存在
# 2. 检查 phase_history 中最新 phase 的 status
# 3. 如果 sprint-state.json 超过 stale_days 天未更新 → WARNING (stale sprint)
# 4. 如果检测到 phase 变更但未记录 transition → WARNING
# 注意：staleness-check 模式只输出 WARNING，不 exit 1（与现有硬阻断逻辑分离）
```

**stale 阈值**：默认 3 天，可通过 `.xp-gate-config.json` 的 `sprint.stale_days` 配置。

**与现有 Gate 11 的关系**：
- 现有 Gate 11（`sprint-gate.sh --pre-commit`）：硬阻断，检查 sprint 分支保护等
- 新增 `--staleness-check` 模式：软警告，检查状态一致性
- 两者独立运行，互不影响

### 不做的事

1. **不修改 LLM 行为**：无法从代码层面强制 LLM "记住"调用 CLI
2. **不自动推断 phase 变更**：phase-transition 必须由编排器显式调用
3. **不阻断 commit**：staleness-check 只输出 WARNING，不 BLOCK
4. **不新建 gate 脚本**：扩展现有 sprint-gate.sh，避免编号冲突

## SKILL.md 同步策略

SKILL.md 存在多个副本（single source of truth = `skills/sprint-flow/SKILL.md`）：
- `skills/sprint-flow/SKILL.md` — **唯一编辑点**
- `plugins/claude-code/skills/sprint-flow/SKILL.md` — 由 `scripts/copy-skills.mjs` 同步
- `plugins/opencode/skills/sprint-flow/SKILL.md` — 同上
- `plugins/qoder/skills/sprint-flow/SKILL.md` — 同上
- `src/npm-package/skills/sprint-flow/SKILL.md` — 由 prepack 同步

**策略**：只编辑 canonical 文件，通过 `node scripts/copy-skills.mjs` 同步所有副本。

## 回滚策略

1. **sprint-init 失败**：自动删除已创建的 sprint-state.json（事务性写入）
2. **SKILL.md 变更**：通过 `git revert` 回退 + 重新运行 copy-skills.mjs
3. **Gate 扩展**：删除 sprint-gate.sh 中新增的 staleness-check 代码块（影响范围 < 30 行）
4. **CLI 命令**：删除 xp-gate.js 中的 sprint-init 注册行（1 行）

## 影响范围

| 文件 | 变更 |
|------|------|
| `src/npm-package/lib/sprint-init.js` | **新建** — sprint 初始化 CLI（复用 SprintStateManager） |
| `src/npm-package/bin/xp-gate.js` | 添加 `sprint-init` 子命令（1 行注册） |
| `skills/sprint-flow/SKILL.md` | 修改 Required Output Format（嵌入式 TodoWrite） |
| `githooks/sprint-gate.sh` | 扩展 `--staleness-check` 模式（~30 行） |
| `src/npm-package/lib/__tests__/sprint-init.test.js` | **新建** — 测试 |

**不新建的文件**：
- ~~`githooks/gate-11-sprint-state.sh`~~ → 扩展现有 sprint-gate.sh
- ~~`skills/sprint-flow/references/phase-overview.md`~~ → 仅 SKILL.md 变更

## 验证标准

1. `xp-gate sprint-init "test sprint"` 创建 sprint-state.json + 渲染看板
2. `xp-gate sprint-init "test sprint"` 重复调用 → 幂等，exit 0
3. `xp-gate sprint-init "other" --force` → 备份旧 state + 创建新 sprint
4. `xp-gate sprint-init "other"` 无 --force → 报错 exit 1
5. SKILL.md 中 phase-transition 指令嵌入 TodoWrite 步骤
6. `sprint-gate.sh --staleness-check` 在 stale sprint 时输出 WARNING
7. 现有 `phase-transition` 命令不受影响（回归测试）
8. 下一次 sprint 执行时，看板正确渲染

## 测试矩阵

| 场景 | 预期 |
|------|------|
| 无 .sprint-state/ 目录 | 创建目录 + state + 渲染看板 |
| 已有活跃 sprint（无 --force） | 报错 exit 1 |
| 已有活跃 sprint（--force） | 备份 + 覆盖 + 渲染看板 |
| 幂等调用（相同 task+branch） | 输出看板 exit 0 |
| --dry-run | 预检冲突，不写入 |
| sprint-state.json 格式损坏 | 容错处理，不 crash |
| stale sprint（>3 天） | WARNING 输出 |

## Future Considerations

- **Layer 4**：IDE 插件级 hook（VS Code task runner 在文件保存时检测 phase 变更）
- **CI 集成**：GitHub Actions 在 PR 合并时验证 sprint-state 一致性
- **事件总线**：将 phase-transition 改为事件驱动，支持多订阅者（看板、审计、通知）
