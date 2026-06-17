# Sprint-Flow Skill 瘦身设计方案 (v2)

**Date:** 2026-06-17
**Status:** REVISED (from Delphi review Round 1-2)
**Version:** 0.2.0

> 基于 3 位 Delphi 专家 REQUEST_CHANGES 建议的修改版本。关键修改：
> - §2 数字修正为实测值 (§6 预期效果相应调整)
> - 新增 §3.3 按需加载协议 (Expert A/B/C 共同 Critical)
> - 新增 §3.4 创建 references/phase-minus-1-isolate.md 计划 (Expert A+C Critical)
> - §4 增加 Phase 0 (预修复) 解决文档断裂问题
> - §5 重新评估风险并补充自动化验证
> - §7 新增 Alternatives Considered 章节
> - 全文去重和路径约束细化

## 1. 问题陈述

调用 `/sprint-flow` 时，初始上下文消耗超过 **100K tokens**。实测分析发现：

| 来源 | 大小 (bytes) | 大小 (tokens, ~4x) | 占比 |
|------|:-----------:|:-----------------:|:---:|
| SKILL.md | 77,039 | ~19,260 | 40% |
| AGENTS.md | 7,495 | ~1,874 | 4% |
| References (16 files, 含 components/) | 78,627 | ~19,657 | 41% |
| Templates (6 files) | 26,483 | ~6,621 | 14% |
| **总计** | ****190,632**** | **~47,658** | **100%** |

> ⚠️ **数据验证**：以上数字为 2026-06-17 17:00 实际 `wc -c` 测量值。AGENTS.md 和 Templates 数字与文档中引用一致；SKILL.md 实测 77,039 bytes；references/ 实测 78,627 bytes（含 components/ 子目录）。SKILL.md 的 frontmatter 内嵌参数曾使 `wc` 报告 76,108 bytes（排除 flow 中的 `description:` YAML block 的差异所致），实测确认全文件为 77,039 bytes。

**根因**: SKILL.md 包含了 11 个 Phase 的完整执行指令、内联 bash 脚本、验证 gate 脚本和大量重复内容。这些内容在一次调用中被全部加载到上下文中，而实际执行的只有 1 个 Phase。

## 2. 当前 SKILL.md 内容分布

```
SKILL.md (76KB) breakdown:
├── YAML frontmatter (1.9KB)
├── Triggers / Scope / Examples / Usage (2.5KB)  ← 与 YAML 重复
├── 核心原则 / 完整流程概览 (2.5KB)
├── 暂停点设计 / Workflow Steps (2.5KB)
├── Phase -1~8 各 Phase 独立指令 (22KB+)         ← 完整可执行的 Phase 指令
├── 编排层规则 (5KB+)                             ← Agent Dispatch + Transition Gate
├── 参数说明 (3.8KB)                               ← 与 frontmatter 重复
├── 状态管理 (1.3KB)
├── 使用示例 (2.5KB)                               ← 11 个 bash 示例
├── 重复段: Anti-Patterns ×3, Security Notes ×2, Output Format ×2 (~12KB)
├── References/Templates 索引 / 研究证据 / 尾部补充
```

**关键浪费点**：
- **重复内容** ~12KB：3 份 Anti-Patterns、2 份 Security Notes、2 份 Output Format
- **内联 bash 脚本** ~12KB：Phase Transition Gate (40行)、RESUME GATE (73行)、Phase -1 操作步骤 (56行) 等
- **YAML/正文重复** ~5KB：Triggers/Scope/Params/Examples 在 frontmatter 和正文中同时存在
- **Phase 详细指令** ~22KB：与 references/ 重度重叠

## 3. 瘦身策略

### 3.1 核心原则

1. **按需加载**: SKILL.md 只保留 orchestrator 启动下一 Phase 所需的概要内容，具体执行指令移入 `references/` 文件。每个 Phase 摘要末尾显式标注 `@see references/phase-N.md`。
2. **运行态逻辑不内联**: 去掉所有 >3 行的 bash 代码块，改为逻辑描述（WHAT/HOW/CHECKS/ERRORS 四字段结构）。详细命令序列移入 references/orchestration-rules.md。
3. **零重复**: YAML frontmatter、Anti-Patterns、Security Notes、Output Format 各保留一份。
4. **引用完整性**: 所有 `@references/phase-N.md` 引用指向必须存在的文件。Phase 1 实施前先补齐缺失文件。

### 3.2 逻辑描述标准化规范 (响应 Expert B)

每个替换 bash 脚本的逻辑描述块必须包含 4 个字段：

```yaml
WHAT: 该步骤做什么的简短描述
HOW: 执行逻辑（不含具体 shell 命令，列出判断条件和序列）
CHECKS: 前置条件 + 后置条件 + 错误检测条件
ERRORS: 失败时的回退/降级行为
```

示例：
```yaml
# 替代之前 56 行 bash 脚本
WHAT: 检测并创建 git worktree 隔离
HOW: 判断是否已在 worktree 中 → 是则跳过 → 否则检测保护分支 → 创建 worktree → 安装依赖 → 校验 .gitignore
CHECKS:
  - pre: 非保护分支且 GIT_DIR == GIT_COMMON (不在 worktree 中)
  - post: 新 worktree 目录存在且包管理器 setup 成功
  - errors: worktree add 失败 → 警告后继续在 current dir 执行
ERRORS: bash 沙箱/权限问题 → WARN 降级；测试基线失败 → 询问用户是否继续
```

详细命令序列见 `@references/orchestration-rules.md`。

### 3.3 按需加载协议 (新增，响应 Expert A/B/C Critical)

Agent 在 `sprint-flow` 流程中如何按需读取 references/ 文件：

```
1. SKILL.md 加载 ← 运行时系统自动加载（不变）
2. Agent 读取 Phase N 摘要 ← 从 SKILL.md 中读取当前 Phase 的 3-5 行概要
3. Agent 检测 `@see references/phase-N.md` 标注 ← 在摘要末尾
4. Agent 使用 Read 工具读取 `references/phase-N.md` ← 获取详细指令
5. Agent 执行 Phase ← 按 references/ 内容操作
6. Phase 完成 → 转到下一 Phase 摘要 → 重复步骤 2-5
```

**关键规则**:
- **不预加载**: 不一次性读取所有 references/ 文件。只读取当前 Phase 对应的文件
- **路径解析**: 所有 `@references/` 引用解析为相对于 `$SKILL_DIR/` 的路径。SKILL_DIR 由运行时系统根据 skill 安装位置自动确定
- **失败降级**: 如果 references/phase-N.md 不存在或读取失败，用 SKILL.md 中的摘要 + 通用的 orchestrator 默认行为降级，不阻断流程

**部署场景**:

| 场景 | SKILL_DIR 路径 | @references/ 解析 |
|------|---------------|-------------------|
| OpenCode 插件自动加载 | `~/.config/opencode/skills/sprint-flow/` | 相对于该目录 |
| npm xp-gate install-skill | `<project>/.xp-gate/skills/sprint-flow/` | 相对于该目录 |
| Claude Code 插件 | `.claude/skills/sprint-flow/` | 相对于该目录 |

### 3.4 预修复：补齐缺失的 references/ 文件 (响应 Expert A+C Critical)

**当前状态**: SKILL.md 行 1306 引用了 `@references/phase-minus-1-isolate.md`，但硬盘上不存在。

**修复**: 在 Phase 1 去重之前，先创建缺失文件：

1. 从 SKILL.md 中 Phase -1 ISOLATE 段（行 ~274-345，包含 56 行操作指令 + 3 个错误处理表）提取内容
2. 创建 `references/phase-minus-1-isolate.md`
3. 确保该文件包含：操作步骤、参数交互表 (`--no-isolate`, `--branch-name`, `--force`)、错误处理和回退表、sprint-state.json isolation 对象 schema
4. 同样，检查并补齐 AGENTS.md 行 22 的 References 索引遗漏的 `phase-7-land.md`, `phase-8-cleanup.md`, `phase-minus-0-5-auto-estimate.md`, `force-levels.md`

### 3.5 具体操作

#### A. SKILL.md 瘦身 (76KB → 目标 ~28KB)

| 操作 | 当前大小 | 目标大小 | 节省 |
|------|:-------:|:-------:|:----:|
| 删除 2/3 Anti-Patterns | ~5.5KB | ~1.8KB | ~3.7KB |
| 删除 1/2 Security Notes + Output Format | ~4KB | ~1KB | ~3KB |
| 合并 YAML frontmatter + 正文 Triggers/Scope/Params | ~8.2KB | ~3KB | ~5.2KB |
| Phase 执行指令移入 references/ 按需读取 | ~22KB | ~5KB | ~17KB |
| 内联 bash 脚本改用逻辑描述 (4字段规范) | ~12KB | ~3KB | ~9KB |
| 精简使用示例 (11→3) | ~2.5KB | ~0.6KB | ~1.9KB |
| 尾部重复段清理 | ~4KB | 0 | ~4KB |
| 新增：按需加载协议 | 0 | ~1KB | -1KB |
| **总计** | **~76KB** | **~28KB** | **~44KB** |

> **注意**: 节省预估基于实测数据（SKILL.md 76KB，内含 bash 脚本约12KB）。实际节省可能因 references/ 新增 2 个文件（~12KB）而抵消约 12KB，纯释放约 32KB。

#### B. references/ 结构调整

当前问题：references/ 内容覆盖完整（Phase -0.5 到 Phase 8 共 16 个文件），但 SKILL.md 行 1306 的索引段遗漏了 4 个文件且引用了不存在的 phase-minus-1-isolate.md。

**新增文件**:

| 文件 | 大小 (est.) | 内容来源 |
|------|:----------:|---------|
| `references/phase-minus-1-isolate.md` | ~5KB | 从 SKILL.md Phase -1 段提取 (行 ~274-345) |
| `references/orchestration-rules.md` | ~8KB | Agent Dispatch Matrix + Phase Transition Gate + RESUME GATE + 按需加载协议定义 |
| `references/phase-summary-format.md` | ~2KB | Phase Summary YAML frontmatter schema |

**不变文件** (11 个现有 references + 4 个 components)：

| 文件 | 大小 | 内容 |
|------|:---:|------|
| `phase-minus-0-5-auto-estimate.md` | 8.4KB | 规模评估 |
| `phase-0-think.md` | 3.9KB | 需求探索 |
| `phase-1-plan.md` | 5.6KB | 规划+评审 |
| `phase-2-build.md` | 7.4KB | 构建 |
| `phase-3-review.md` | 6.3KB | 评审+测试 |
| `phase-4-uat.md` | 2.6KB | 人工验收 |
| `phase-5-feedback.md` | 2.6KB | 反馈 |
| `phase-6-ship.md` | 4.7KB | 发布 |
| `phase-7-land.md` | 3.7KB | 部署 |
| `phase-8-cleanup.md` | 5.3KB | 清理 |
| `force-levels.md` | 8.2KB | 执行级别 |
| `components/memory.md` | 3.0KB | 内存组件 |
| `components/middleware.md` | 4.1KB | 中间件 |
| `components/skill-invocations.md` | 3.6KB | skill 调用 |
| `components/system-prompt.md` | 1.6KB | 系统提示 |
| `components/tool-descriptions.md` | 3.7KB | 工具描述 |

## 4. 执行计划

### Phase 0: 预修复 (新增，预计 0.5h)

修复文档断裂问题，为瘦身做准备：

1. 创建 `references/phase-minus-1-isolate.md`（从 SKILL.md 提取 Phase -1 内容）
2. 补全 AGENTS.md 的 References 索引遗漏条目（phase-7, phase-8, phase-minus-0-5, force-levels）
3. 补全 SKILL.md 的 References 索引遗漏条目（同上）
4. 确认 AGENTS.md 7 个镜像的同步机制 (`scripts/copy-skills.sh`)
5. 实测所有文件大小，更新设计文档 §1 表格为准确值

### Phase 1: 去重 + 重组 (预计减少 15KB)

1. 删除 2 个重复的 Anti-Patterns 表格（保留行 1222-1233 版本）
2. 删除 1 个重复的 Security Notes 段（保留行 144-151 版本）
3. 删除 1 个重复的 Output Format 段（保留行 1342-1382 版本）
4. 合并 YAML frontmatter 与正文 Triggers/Scope/Examples 段
5. 合并参数说明到 Triggers 段的参数表格
6. 精简使用示例从 11 到 3（保留最常用的 full-sprint、--stop-at、--resume-from）

### Phase 2: Phase 指令移出 (预计减少 17KB)

1. 创建 `references/orchestration-rules.md`（编排层规则 + Transition Gate + RESUME GATE）
2. 创建 `references/phase-summary-format.md`（Phase Summary Schema）
3. 每个 Phase 的详尽操作步骤摘要为 3-5 行概要，末尾标注 `@see references/phase-N.md`
4. 保证 references/ 文件完整保留所有详细指令
5. 每移出一个 Phase 后，验证 `@references/` 指向的文件存在
6. 运行 `scripts/copy-skills.sh` 确保 7 个镜像同步

### Phase 3: 内联脚本清理 (预计减少 9KB)

1. 所有 >3 行的 bash 代码块替换为 4 字段逻辑描述（WHAT/HOW/CHECKS/ERRORS）
2. bash 脚本移入 `references/orchestration-rules.md`
3. 手动走查每个替换，确认逻辑描述覆盖原 bash 的所有分支

### Phase 4: 验证与效果评估

1. **自动化验证脚本**: 创建 `scripts/check-skill-size.sh`：
   - 计算 SKILL.md 行数 + bytes
   - 如果 SKILL.md > 30KB → WARN；> 35KB → ERROR
   - 验证所有 `@references/` 标注指向的文件存在
   - 验证所有 AGENTS.md 7 镜像字节相同
   - 验证 References 索引完整性（列出所有 references/ 文件，对比索引段）
2. **手动验证**:
   - 逐一走查每个 Phase 的 SKILL.md 摘要 vs references/ 内容，确保一致性
   - 量测瘦身后的 token 消耗（目标：≤ 7K tokens）
3. **集成测试**:
   - 运行 5 个核心场景：full-sprint、--stop-at plan、--resume-from build、--phase build-only、--status
   - 验证 Phase 过渡 Gate 行为
   - 验证按需加载：确认 references/ 文件被按顺序读取而非一次性加载

## 5. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|:----:|:----:|---------|
| Agent 未按需读取 references/ | 中 | 高 | SKILL.md 每个 Phase 摘要末显式标注 `@see references/phase-N.md`；运行时系统在检测到缺失文件时自动降级使用摘要 |
| references/ 文件路径漂移 | 低 | 中 | 使用相对于 `$SKILL_DIR` 的路径解析，不硬编码绝对路径。deploy 场景表在 §3.3 中定义 |
| 执行指令丢失 | 低 | 高 | Phase 2 每移出一个 Phase 后对比 SKILL.md 摘要 vs references/ 内容完整性 checklist；Phase 4 自动化脚本验证 `@references/` 目标存在 |
| 7 个 AGENTS.md 镜像不同步 | 中 | 中 | Phase 4 `scripts/check-skill-size.sh` 验证所有镜像 byte-identical；Phase 2 执行后运行 `scripts/copy-skills.sh` |
| 新用户学习曲线变陡 | 中 | 低 | SKILL.md 仍保留完整流程概览和关键决策点，每个 Phase 可读性不受影响 |
| 数字再次过时 | 低 | 低 | `scripts/check-skill-size.sh` CI 检查防止 SKILL.md 再次膨胀 |

## 6. 预期效果

| 指标 | 当前 (实测) | 目标 |
|------|:----------:|:----:|
| SKILL.md 大小 | **77KB (~19K tokens)** | **~28KB (~7K tokens)** |
| 初始加载消耗 | ~100K+ tokens | **~38K tokens** (降 ~62%) |
| 重复内容 | ~12KB (3x Anti-Patterns, 2x Notes, 2x Format) | **~0KB** |
| 内联 bash | ~12KB | **~3KB** (逻辑描述) |
| references/ 文件数 | 16 | 19 (+3 新增) |
| 自动化验证 | 无 | `scripts/check-skill-size.sh` CI 门禁 |

> **校正说明**: 基于 §1 实测 190,632 bytes / ~47,658 tokens 的基线，目标下调为 ~38K tokens (62% 降幅)。SKILL.md 瘦身目标维持 ~28KB 不变。

> **磁盘占用**: SKILL.md 从 77KB → ~28KB（节省 ~49KB）。references/ 新增 3 个文件 (+~15KB)。净磁盘节省 ~34KB。整个 skill 目录从 ~191KB → ~157KB。

## 7. Alternatives Considered

### 方案 A: 只去重，不迁移 (响应 Expert C 建议)

**做法**: 删除 Anti-Patterns/Security Notes/Output Format 副本，合并 YAML/正文重复。Phase 指令保留在 SKILL.md 中，不动 references/。

| 维度 | 评估 |
|------|------|
| 节省 | ~15KB, SKILL.md 从 76KB → ~61KB |
| 风险 | 最低 — 无文件迁移，无引用断裂 |
| 按需加载 | 不实现 — 所有 Phase 指令仍在 SKILL.md 中 |
| 长期维护 | 不高 — 不解决"一次加载所有"的结构性问题 |

**裁决**: 可作为 v0.8.x 短期修复。但三位专家在 Round 2 中一致同意指令移出方向正确，长期需要本方案的完整实施。

### 方案 B: 分批迁移，每批 2 个 Phase

**做法**: Phase 1 只去重。Phase 2-4 每批只迁移 2 个 Phase 到 references/，每批验证+测试后继续下一批。

**优点**: 每批有明确的回退点，风险分散。

**缺点**: 执行周期拉长 3-4 倍；SKILL.md 在过渡期处于"部分指令内联、部分引用"的不一致状态。

**裁决**: 不推荐。不连续的状态增加认知负担且容易出错。

### 方案 C: 本方案 (v2) — 去重 + 全量迁移 + 按需加载

三位专家 Round 2 确认方向正确。在已修复所有 Critical 问题的前提下，推荐实施。

## 8. 附录

### A. 文件完整性 Checklist

每个 Phase 迁移后的验证清单：

```
Phase -1: □ 摘要 3-5 行已写入 SKILL.md
          □ @see references/phase-minus-1-isolate.md 标注存在
          □ references/phase-minus-1-isolate.md 文件存在
          □ 完整指令与 SKILL.md 原内容逐项对比一致

Phase 0:  □ ... (同上格式)
...
Orchestration: □ references/orchestration-rules.md 文件存在
               □ bash 脚本已从 SKILL.md 移除
               □ 逻辑描述使用 4 字段规范
```

### B. AGENTS.md 7 镜像同步验证

运行 `scripts/copy-skills.sh` 后确认以下路径字节相同：

```
skills/sprint-flow/AGENTS.md
plugins/claude-code/skills/sprint-flow/AGENTS.md
plugins/opencode/skills/sprint-flow/AGENTS.md
plugins/qoder/skills/sprint-flow/AGENTS.md
src/npm-package/skills/sprint-flow/AGENTS.md
src/npm-package/plugins/claude-code/skills/sprint-flow/AGENTS.md
src/npm-package/plugins/opencode/skills/sprint-flow/AGENTS.md
src/npm-package/plugins/qoder/skills/sprint-flow/AGENTS.md
```

### C. 逻辑描述转换示例 (完整版)

**原内容** (Phase -1 部分, ~56行 bash):
```bash
# 检测当前环境: GIT_DIR vs GIT_COMMON
# 保护分支检测: main/master/develop/trunk/mainline
# 创建 worktree: git worktree add ... -b ...
# 项目 setup: npm install / go mod download / pip install
# .gitignore 校验 + 自动添加
# Sprint Lock 检测 (Issue #144)
# Sprint State 记录 (.sprint-state/sprint-state.json)
# 基线验证 (npm test / go test / pytest)
```

**转换后逻辑描述**:
```yaml
WHAT: 检测并创建 git worktree 隔离
HOW: 判断 GIT_DIR != GIT_COMMON → 已在 worktree → 跳过. 
     否则: 检测分支 → 如果是 main/master/develop/trunk/mainline 则强制创建 worktree
     创建: mkdir -p .worktrees/sprint/ + git worktree add
     Setup: 根据项目文件 (package.json/go.mod/pyproject.toml) 安装依赖
     .gitignore: 检测 .worktrees/ 是否已被 ignore, 否则自动添加并提交
     锁: 创建 .sprint-state/sprint.lock, 如果已存在且非 stale 则 BLOCK
     基线: 运行测试命令, 失败则询问用户是否继续
CHECKS:
  - pre: 当前目录是 git 仓库, 非 detached HEAD
  - post: worktree 目录存在, .gitignore 已包含 .worktrees/, lock 文件存在
  - errors: worktree add 失败 → WARN + 在当前目录继续; lock stale → 覆盖; 测试失败 → 问用户
ERRORS: 沙箱/权限 → WARN 降级; 锁冲突 → BLOCK; 测试失败 → 用户决策
详细命令序列见 @references/phase-minus-1-isolate.md
```
