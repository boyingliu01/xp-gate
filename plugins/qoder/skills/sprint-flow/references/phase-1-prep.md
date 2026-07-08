# Phase 1/6: PREP（准备工作 — worktree 隔离 + 规模评估）

**执行时机**: `/sprint-flow` 启动后、Phase 2/6 DESIGN 之前。**自动执行**。

**目的**: 默认在 git worktree 中隔离 sprint 工作，防止在保护分支上直接运行造成代码污染。随后自动评估需求规模，匹配适度流程，避免小需求走重量级流程造成资源浪费。

**对应旧模型**: Phase -1 ISOLATE + Phase -0.5 AUTO-ESTIMATE

**核心原则**:
- **隔离优先**: 默认 worktree 隔离，防止保护分支污染
- **客观指标 > 主观判断**: 依赖代码结构分析，不依赖人/AI 的主观直觉
- **显式告知**: 用户看到客观指标，不是 AI 主观结论
- **可纠偏**: 用户可接受/修改/取消
- **学习闭环**: 记录用户 override，优化阈值

---

## Part A: ISOLATE（git worktree 隔离）

**AI agent 直接执行 bash 命令**（不需要调用外部 skill），步骤如下：

| 步骤 | 动作 | 说明 |
|------|------|------|
| 0 | **检测当前环境** | 运行 `git rev-parse --git-dir` 和 `git rev-parse --git-common-dir`。如果 `GIT_DIR != GIT_COMMON`：已在 worktree 中 → 输出 "Already in isolated worktree" → 进入 Part B |
| 0.5 | **Sprint Lock 检测（Issue #144）** | 检查 `.sprint-state/sprint.lock` 是否存在: `[ -f .sprint-state/sprint.lock ]`。如果存在: 读取锁内容，检查是否 stale（超过 24 小时或 worktree 目录不存在）→ stale → 输出 `[WARN] 发现过期 sprint lock，将覆盖` → 更新锁。非 stale → 输出 `[BLOCK] 已有活跃 sprint (ID: {sprint_id}, started: {started_at})。请先完成当前 sprint 或手动删除 .sprint-state/sprint.lock` → 退出。锁不存在 → 创建锁: `echo '{"sprint_id":"sprint-YYYY-MM-DD-NN","started_at":"<ISO8601>"}' > .sprint-state/sprint.lock` |
| 1 | **检查保护分支** | 获取当前分支名 `git branch --show-current`。保护分支列表: `main, master, develop, trunk, mainline`。保护分支 → 强制创建 worktree。非保护分支 → 依然创建 worktree（推荐，不阻断） |
| 2 | **创建 worktree** | 创建目录: `mkdir -p .worktrees/sprint`。检测已有 NN 编号: `ls .worktrees/sprint/ 2>/dev/null \| grep -oE '[0-9]{2}$' \| sort -n \| tail -1`（取最后两位数字，数值排序，取最大），NN = 结果 + 1（无结果则从 01 开始）。运行 `git worktree add .worktrees/sprint/sprint-YYYY-MM-DD-NN -b sprint/YYYY-MM-DD-NN`。**注意**: `cd` 在 AI agent 单次工具调用中不保持状态，步骤 3-6 必须通过 `workdir` 参数或 `&&` 链式命令在新 worktree 目录下执行 |
| 3 | **项目 setup** | 在 worktree 目录下: 检测项目类型: `package.json` → `npm install`, `go.mod` → `go mod download`, `pyproject.toml` → `pip/poetry install` |
| 4 | **.gitignore 校验** | 在**仓库根目录**（非 worktree）执行: `git check-ignore -q .worktrees`。如果未忽略 → 将 `.worktrees/` 添加到 `.gitignore` → `git add .gitignore` → `git commit -m 'chore: ignore .worktrees directory'` |
| 5 | **Sprint State 记录** | `mkdir -p .sprint-state` 在 worktree 目录下。写入 `.sprint-state/sprint-state.json`（如已存在则合并，保留原有字段），新增/更新 `isolation` 对象，设置 `phase: 1`，`status: "running"` |
| 6 | **基线验证** | 在 worktree 目录下: 检测测试方式（package.json 有 "test" script → `npm test`, go.mod → `go test ./...`, pyproject.toml → `pytest`）。测试失败 → 输出失败信息 → 询问用户是否继续 |

### 参数处理

- `--no-isolate`: 跳过自动创建，输出 ⚠️ 警告 `'[WARN] 未创建 worktree 隔离，在 {branch} 分支上直接运行 sprint 有污染风险'` → 进入 Part B
- `--branch-name <name>`: 使用自定义分支名（默认自动生成 `sprint/YYYY-MM-DD-NN`），分支名中的 `/` 在 worktree 路径中自动替换为 `-`（如 `feat/user-login` → 分支名 `feat/user-login`，路径 `.worktrees/sprint/feat-user-login`）
- `--force`: 强制在当前分支继续（即使已是保护分支），**要求用户显式确认**: 输出 ⚠️ 警告 `'[WARN] 使用 --force 在 {branch} 分支上直接运行 sprint。此操作绕过隔离保护，请确认风险。'` → 等待用户确认（"继续" / "取消"） → 确认后进入 Part B

### 参数交互规则

| 参数组合 | 行为 |
|---------|------|
| `--no-isolate` 单独 | 跳过隔离，输出警告 → Part B |
| `--force` 单独 | 跳过隔离，要求确认 → Part B |
| `--no-isolate` + `--branch-name` | `--branch-name` 忽略，仅 `--no-isolate` 生效 |
| `--force` + `--branch-name` | `--branch-name` 忽略，仅 `--force` 生效 |
| `--no-isolate` + `--force` | 等效，输出 `--no-isolate` 警告 → Part B |
| `--resume-from build` + `--no-isolate` | `--resume-from` 优先，直接跳过 PREP |

### 错误处理和回退

| 错误场景 | 回退行为 |
|---------|---------|
| `git worktree add` 失败（沙箱/权限问题） | 输出 `[ERROR] git worktree add 失败: {error}` → `[WARN] 无法创建 worktree 隔离，将在当前目录继续。请手动设置隔离分支。` → 在当前目录继续 |
| `.gitignore` 自动添加失败 | 输出 `[WARN] 无法自动添加 .gitignore，请手动将 .worktrees/ 添加到 .gitignore` → 继续 |
| 基线测试失败 | 输出 `[FAIL] 基线测试未通过:` + 失败详情 → 询问用户 `'基线测试失败，是否继续 sprint？(y/N)'` |

### sprint-state.json isolation 对象格式

```json
{
  "isolation": {
    "worktree_path": ".worktrees/sprint/sprint-2026-05-24-01",
    "branch": "sprint/2026-05-24-01",
    "created_from": "main",
    "created_from_commit": "abc123def..."
  }
}
```

---

## Part B: AUTO-ESTIMATE（自动化规模评估与流程路由）

### 步骤 1: 识别需求类型

分析用户输入的需求描述，判定变更类型：

| 关键词模式 | 变更类型 | AUTO-ESTIMATE 时机 |
|-----------|---------|-------------------|
| 删除、移除、去掉、砍掉、清理 + 已有模块名 | 删除已存在代码 | 立即执行 |
| 修改、改、调整、重构、优化 + 已有模块名 | 修改已存在代码 | 立即执行 |
| 新增、添加、开发、实现、创建 + 新模块名 | 新增功能 | brainstorming 后执行 |
| 修复、fix、bug | Bug 修复 | 立即执行 |
| 无法判断 | 询问用户 | — |

**IF 新增功能**: 跳过当前 AUTO-ESTIMATE，先执行 Phase 2/6 DESIGN brainstorming，brainstorming 完成后以设计文档为输入重新执行 AUTO-ESTIMATE。

**IF 删除/修改/Bug 修复**: 继续执行以下步骤。

### 步骤 2: 收集指标

#### 2.1 引用计数

```bash
grep -rn "{target_pattern}" --include="*.{ext}" . | grep -v node_modules | grep -v .git | wc -l
```

**阈值**: ≤3: 轻量 | 4-10: 标准 | >10: 复杂

#### 2.2 跨模块依赖

```bash
grep -rn "{target_pattern}" --include="*.{ext}" . | grep -v node_modules | grep -v .git | \
  awk -F: '{print $1}' | sed 's|/[^/]*$||' | sort -u
```

**阈值**: 1 个目录: 轻量 | 2 个目录: 标准 | 3+ 个目录: 复杂

#### 2.3 循环依赖检测

简单检查：如果 A 引用 B 且 B 引用 A，则存在循环依赖。

```bash
grep -rn "import.*{target}" --include="*.ts" --include="*.tsx" .
grep -rn "import.*{caller}" --include="*.ts" --include="*.tsx" {target_dir}/
```

**阈值**: 无: 正常 | 存在: 高风险 → 无论如何输出风险警告

#### 2.4 Public API 暴露

```bash
grep -rn "^export " {target_dir}/ --include="*.ts" | wc -l
```

**阈值**: ≤2: 低影响 | 3-5: 中影响 | >5: 高影响 → 输出风险警告

#### 2.5 相关测试文件

```bash
find . -name "*{target}*.test.*" -o -name "*{target}*.spec.*" | grep -v node_modules | wc -l
```

**阈值**: 0: 无测试覆盖（风险提示） | 1-2: 正常 | >3: 重构工作量大 → 提示

### 步骤 3: 汇总评估

```
总分计算：
- 引用计数：轻量=1, 标准=2, 复杂=3
- 跨模块：轻量=1, 标准=2, 复杂=3
- 循环依赖：无=0, 存在=5（强制复杂）
- Public API：低=0, 中=1, 高=2
- 测试文件：正常=0, 多=1

总分：1-3 = 轻量 | 4-6 = 标准 | 7+ 或 循环依赖存在 = 复杂
```

### 步骤 4: 输出评估结果

使用 `templates/auto-estimate-output-template.md` 的标准格式向用户展示评估结果。

**MUST** 遵循模板格式，包含：
- 需求描述 + 变更类型
- 影响级别标识
- 各项指标的具体数值
- 建议流程
- 风险警告（如有）
- 用户操作选项

### 步骤 5: 处理用户选择

#### 用户选择「接受建议」
按推荐流程执行。保存评估结果到 sprint-state.json。

```json
{
  "auto_estimate": {
    "change_type": "删除已存在代码",
    "metrics": {
      "ref_count": 12,
      "cross_module_count": 3,
      "modules": ["auth", "user", "admin"],
      "circular_dep": true,
      "public_api_count": 5,
      "test_file_count": 4
    },
    "estimated_level": "复杂",
    "recommended_flow": "完整 Sprint Flow (6 phases)",
    "risk_warnings": ["循环依赖: user ↔ plane"],
    "user_decision": "accepted"
  }
}
```

#### 用户选择「修改流程」
展示修改流程子菜单（3 个选项：轻量/标准/完整）。要求用户输入修改原因（必填）。

记录到学习日志：
```json
{
  "sprint_id": "{sprint_id}",
  "task_description": "{需求描述}",
  "estimated_level": "标准",
  "user_override_level": "轻量",
  "override_reason": "{用户输入原因}",
  "timestamp": "{当前时间}"
}
```

数据写入 `.sprint-state/auto-estimate-learning.json`（追加模式）。

#### 用户选择「取消」
停止本次 sprint。输出：`[CANCELLED] 用户取消 Sprint，AUTO-ESTIMATE 评估结果为 {estimated_level}`。

### 步骤 6: 路由执行

根据最终确定的流程级别，进入对应 Phase：

| 流程级别 | 路由 |
|---------|------|
| **轻量** | → Phase 2/6 DESIGN（reduced-intensity 流程，见 references/force-levels.md） |
| **标准** | → Phase 2/6 DESIGN（正常流程） |
| **复杂** | → Phase 2/6 DESIGN（完整流程 + 风险警告提示） |

**DELPHI-GATE invariant**: 所有流程级别（轻量/标准/复杂）的 Phase 3/6 BUILD 启动前，**必须**检查 `.sprint-state/delphi-reviewed.json` 的 verdict 为 `APPROVED`。未通过 delphi-review 直接路由到 BUILD 属于严重违规。

**轻量级的正确理解**: 轻量级意味着 reduced-intensity 的 delphi-review（**2 专家、1 轮、2/2 APPROVED、较短上下文**），**不是**跳过 delphi-review，**不是** 1 专家评审。见 references/force-levels.md 的轻量级流程定义。

**自动 escalation 规则**（检测到以下情况时，自动提升流程级别）:

| 触发条件 | 原级别 | 提升级别 | 理由 |
|---------|--------|---------|------|
| 风险警告（循环依赖、Public API > 5） | 轻量 | 标准 | 技术风险需要标准流程 |
| 多位专家 disagreement 或 REQUEST_CHANGES | 轻量/标准 | 复杂 | 意见分歧需要更全面评审 |
| 涉及文件数 > 10 或 LOC > 500 | 轻量 | 标准 | 超出轻量级预算 |
| 修改公共 API（export 接口） | 轻量/标准 | 复杂 | API 变更影响范围广 |
| 检测到循环依赖 | 任何级别 | 复杂 | 架构风险强制复杂流程 |
| 相关测试文件缺失或覆盖率 < 80% | 轻量/标准 | 标准 | 需要补充测试 |

**跨参考**: 详见 references/force-levels.md 的各级别流程定义和强制规则。

---

## 特殊场景处理

### 场景 1: 小改动（总计 < 20 行新增/删除代码）

```bash
git diff --stat HEAD 2>/dev/null
```

**处理**: 如果预估改动 < 20 行且涉及 ≤ 2 个文件，自动判定为「轻量」并告知用户，不强制展示完整 AUTO-ESTIMATE 面板。

**注意**: 轻量级仍需要完整的 Sprint Flow 流程（包括 delphi-review），只是 reduced-intensity。**不会**绕过 DELPHI-GATE 直接路由到 BUILD。

### 场景 2: 无法提取目标关键词

**处理**: 询问用户「无法自动识别目标模块，请指定要分析的关键词（函数名/类名/模块名）：」

### 场景 3: 用户输入包含多个独立需求

**处理**: 提示用户「检测到多个独立需求，建议分别执行 sprint。是否拆分？」→ 等待确认

---

## 编排注意事项

PREP 经常使用并行 background explore agents 评估代码影响范围。Agent dispatch 后必须遵循 **Background Task Resume Protocol**（参见 `orchestration-rules.md`），在所有 background task 返回后自动恢复继续，不得等待人工消息（Issue #248）。

---

## 与学习循环的集成

### 数据收集

每次 sprint 完成（Phase 6/6 CLOSE）后，将以下数据记录到 `.sprint-state/auto-estimate-learning.json`：

```json
{
  "entries": [
    {
      "sprint_id": "sprint-YYYY-MM-DD-NN",
      "estimated_level": "标准",
      "user_decision": "accepted",
      "actual_effort_phase_count": 5,
      "actual_duration_minutes": 45,
      "was_accurate": true
    }
  ]
}
```

### 阈值优化

当积累 ≥ 20 条记录后，提示用户可以运行阈值分析：

> 已积累 {n} 条 AUTO-ESTIMATE 记录。是否运行阈值优化分析？
> 分析会检查：过度估计（建议标准但实际轻量）、低估（建议轻量但实际复杂），并推荐阈值调整。

---

> **清理提示**: Sprint 完成后，Phase 6/6 CLOSE 执行 `git worktree remove <worktree_path>` 清理 worktree 目录，同时保留 `.sprint-state/` 中的历史记录。
