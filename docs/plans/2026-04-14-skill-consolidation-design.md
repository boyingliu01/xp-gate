# Skill 精简方案：整合 superpowers/gstack 成熟 Skill 体系

**版本**: V1.0  
**日期**: 2026-04-14  
**状态**: ✅ APPROVED by Delphi Consensus  
**评审日期**: 2026-04-14  
**评审模式**: 2-Expert Delphi, Round 1 → Round 2 (fix) → Round 3 (final)  
**共识比例**: 100% (2/2 experts both 9/10 APPROVED)  

---

## 1. 背景与问题

### 1.1 现状

项目当前自研 7 个 skills：

| Skill | 核心职责 | 代码量 | 依赖关系 |
|-------|---------|--------|----------|
| `delphi-review` | 多轮匿名专家评审直到共识 | ~684 行 | 无（基础方法论） |
| `xp-consensus` | Driver+Navigator+Arbiter TDD 共识 | ~426 行 | delphi-review, specification.yaml, freeze |
| `code-walkthrough` | git push 前多专家代码走查 | ~474 行 | delphi-review, principles |
| `code-reviewer` | Clean Code + SOLID 静态分析 | ~317 行 + `src/principles/` | 无（独立工具） |
| `specification-generator` | specification.yaml 生命周期管理 | ~919 行 | delphi-review |
| `test-specification-alignment` | 测试与 spec 两阶段对齐验证 | ~552 行 | specification.yaml, freeze |
| `sprint-flow` | One-Shot 流水线编排器 | ~287 行 | 以上所有 skills |

### 1.2 问题

1. **重复造轮子**: xp-consensus 的 TDD 流程与 superpowers 的 `test-driven-development` 高度重叠
2. **过度复杂化**: xp-consensus 17 状态机 + 熔断 + 成本控制 vs superpowers 的 TDD 铁律（简单有效）
3. **包装而非创新**: code-walkthrough 本质是 delphi-review 的触发场景适配器
4. **体系耦合过重**: specification.yaml → xp-consensus → test-specification-alignment 形成强依赖链
5. **维护成本高**: 每个 skill 需要维护 prompt templates、状态机、配置文件

### 1.3 目标

- **精简**: 减少自研 skill 数量，用经过验证的成熟 skill 替代
- **解耦**: 降低 skill 之间的强依赖关系
- **保留核心价值**: delphi-review 方法论 + principles checker 不可替换
- **统一入口**: sprint-flow 作为单一编排器保留

---

## 2. 逐项分析与对比

### 2.1 delphi-review → ✅ 保留

| 维度 | 分析 |
|------|------|
| 独特性 | 多轮匿名评审 + >=91% 共识 + 迭代直到 APPROVED + 修复回炉重评 |
| gstack/superpowers 等价物 | 无。`cross-model-review` 是对抗式评审（找茬），不是共识驱动 |
| 下游依赖 | xp-consensus、code-walkthrough、sprint-flow 都依赖它 |
| 结论 | **不可替代，必须保留** |

### 2.2 xp-consensus → 🔀 替代（superpowers 组合 + 关键机制保留）

| 维度 | xp-consensus 实现 | superpowers 替代 | 差异分析 |
|------|------------------|-----------------|----------|
| **Driver TDD** | 内建 RED-GREEN-REFACTOR（~150 行 prompt） | `test-driven-development`（已验证成熟 skill） | **完全覆盖**，TDD 铁律更简洁 |
| **Navigator 盲评** | freeze skill 技术隔离 sealed.code | **保留 freeze skill**：Round 1 后调用 `freeze` 锁定业务代码，盲评 agent 只读测试 | **需保留 freeze**，不能仅靠"上下文控制" |
| **Arbiter 决策** | confidence ≥8 阈值裁决 | `receiving-code-review`（理性验证模式，禁止盲目同意） + confidence 阈值保留 | **部分覆盖**，阈值机制保留 |
| **Gate 1** | tsc/ESLint 自动修复 max 3 次 | `verification-before-completion`（证据优先） | **完全覆盖** |
| **状态机** | 17 states → 简化为 3 种关键行为 | superpowers 纪律流程 + 保留关键行为 | **简化但不完全删除**，见下方关键行为保留表 |
| **熔断/成本** | $0.15/任务限制 | sprint-flow 编排层添加成本监控 | **保留但简化** |
| **spec.yaml 绑定** | 强制依赖 | TDD 可从需求出发无需 YAML | **非独有** |

**关键行为保留表**（原 17 states 中编码的真实边缘情况）：

| 原状态 | 含义 | 新处理方案 | 必须保留？ |
|--------|------|-----------|-----------|
| `CIRCUIT_BREAKER_TRIGGERED` | 成本/资源超阈值 | sprint-flow 编排层监控成本，超阈值 BLOCK + 用户决策 | ✅ |
| `ROLLBACK_TO_ROUND1` | Gate 1 失败自动修复 → 回退 | `verification-before-competition` 失败 → 修复 max 3 次 → 仍失败则 BLOCK | ✅ |
| `GATE1_FAILED`/`GATE1_COMPLETE` | 区分可修复 vs 致命失败 | verification-before-completion 内置此区分 | ✅ |
| `GATE2_RUNNING` | Security Scan 集成 | gstack `security-scan` skill 替代 | ✅ |
| `SEALED_CODE_ISOLATION` | freeze 技术隔离 | **保留 freeze skill 调用** | ✅ |

**核心判断**: xp-consensus = TDD + 盲评(freeze) + 仲裁(阈值) + 关键行为(熔断/回退)。TDD 部分用 superpowers 替代，但 freeze 隔离、熔断、回退机制必须保留（简化实现，不维持 17 状态机）。

### 2.3 code-walkthrough → 🔀 合并到 delphi-review

| 维度 | 分析 |
|------|------|
| 核心流程 | git diff → delphi-review → 共识 → `.code-walkthrough-result.json` |
| 独有价值 | 触发场景（git push 前）+ 输出文件格式 |
| 本质 | delphi-review 的"代码走查模式"场景适配器 |
| pre-push hook | 应保留为脚本逻辑，不需要是独立 skill |
| **结论**: 作为 delphi-review 的一个 mode 存在，skill 文件删除 |

### 2.4 code-reviewer (Principles) → ✅ 保留

| 维度 | 分析 |
|------|------|
| 独特性 | **实际 TypeScript 可执行代码**（不是纯 markdown skill） |
| 核心能力 | Clean Code (9 rules) + SOLID (5 rules) + CCN (lizard) + AST 分析 |
| 输出 | SARIF 2.1.0 标准格式，IDE/GitHub Actions 集成 |
| 语言支持 | 9 种语言适配器 |
| githooks 依赖 | pre-commit 8-gate 系统的 Gate 6 |
| **结论**: 有实际代码实现的基础设施工具，必须保留 |

### 2.5 specification-generator → 🔄 轻量化（自动生成，不主动调用）

| 维度 | 当前（过重） | 轻量化后 | 说明 |
|------|-------------|---------|------|
| **生成方式** | 用户主动调用 `/specification-generator` | delphi-review APPROVED 后自动触发 | 不需要人工干预 |
| **CREATE/UPDATE** | 双模式，复杂状态管理 | 单模式：直接覆盖写入 | 不需要版本管理 |
| **冲突检测** | SHA-256 hash + CONFLICT 状态 | 移除 | 不需要人工处理冲突 |
| **版本管理** | semver | 移除 | 每次生成都覆盖 |
| **输出格式** | 复杂 YAML（模块前缀/ID/状态/deprecated） | 简单 YAML（需求描述 + AC 列表） | 只保留测试验证需要的内容 |
| **多文档来源** | 优先级系统 | 单一来源：APPROVED 的设计文档 | 不需要优先级 |
| **触发时机** | 手动 `/specification-generator` | 三个自动触发点：① delphi-review APPROVED 后 ② sprint-flow Phase 1 完成后 ③ test-spec-alignment 执行前（如过期则再生成） | 全程不需要人调用 |

**核心保留**: 从设计文档提取需求 + AC → 生成 YAML 文件的能力  
**核心移除**: 版本管理、冲突检测、模块推断、deprecated 归档、自动推断模块前缀等管理逻辑

### 2.6 test-specification-alignment → 🔄 精简（自动确保 spec 最新）

| 维度 | 原实现 | 精简方案 | 说明 |
|------|--------|---------|------|
| **Phase 1** | YAML spec + AST 解析 + @test/@covers 标签 | 简化为：解析轻量 YAML spec → 扫描测试名/描述 → 语义匹配 | AST 解析可保留用于提高精度 |
| **Phase 2** | freeze 锁定测试目录 | **保留 freeze**：防止修改测试让测试通过 | 核心保护机制 |
| **自动触发** | 需要先手动生成 spec | Phase 1 执行前自动检查 spec 是否最新，过期则自动重新生成 | 不需要人干预 |
| **对齐验证** | 80% 阈值 | 保留 80% 阈值 | 统一指标 |

**核心逻辑**: test-spec-alignment 执行时 → 先检查 spec.yaml 是否存在且时间戳晚于设计文档 → 如过期，自动调用 specification-generator 重新生成 → 然后执行两阶段验证

**核心保留**: freeze/unfreeze 两阶段保护，80% 对齐阈值  
**核心移除**: specification.yaml 体系的重逻辑移到 generator，test-spec-alignment 只做验证

### 2.7 sprint-flow → ✅ 保留（精简编排链）

| 维度 | 分析 |
|------|------|
| 独特价值 | 单一入口编排 Think→Plan→Build→Review→Ship |
| 自身实现 | 不重复实现任何功能，纯粹编排器 |
| 问题 | 编排了有冗余的 skills（xp-consensus, spec-generator, test-spec-alignment） |
| **结论**: 保留，但更新编排链以反映精简后的体系 |

---

## 3. 精简方案设计

### 3.1 精简前架构

```
sprint-flow (编排器)
  │
  ├── Phase 0: office-hours ✅ (gstack)
  ├── Phase 1: autoplan + delphi-review + specification-generator
  ├── Phase 2: xp-consensus ← 17 states, 熔断, 复杂
  ├── Phase 3: cross-model-review + test-specification-alignment
  ├── Phase 4: User Acceptance
  └── Phase 6: ship + land-and-deploy
  
  独立 skill:
  ├── code-walkthrough ← delphi 包装
  ├── code-reviewer ← 有实际代码，pre-commit 依赖
```

### 3.2 精简后架构

```
sprint-flow (编排器，精简编排链)
  │
  ├── Phase 0: office-hours ✅ (gstack, 不变)
  ├── Phase 1: autoplan (gstack) + delphi-review ✅ (不变)
  │              └─ delphi-review 新增 code-walkthrough mode
  ├── Phase 2: test-driven-development (superpowers)
  │              + freeze skill (盲评隔离)
  │              + requesting-code-review (superpowers)
  │              + verification-before-completion (superpowers)
  │              替代 xp-consensus，但保留 freeze + 熔断 + 回退
  ├── Phase 3: cross-model-review + test-spec-alignment-lite
  │              ├── cross-model-review → 对抗式评审（不变）
  │              └── test-alignment-lite → Phase 2 freeze + 测试执行
  │                  （保留 freeze 机制，移除 spec.yaml 依赖）
  ├── Phase 4: User Acceptance (不变)
  └── Phase 6: ship + land-and-deploy (不变)
  
  独立 skill:
  ├── delphi-review ✅ (合并 code-walkthrough 场景)
  ├── code-reviewer ✅ (不变, pre-commit 依赖)
  └── test-alignment-lite 🆕 (保留 freeze 机制的精简版 test-spec-alignment)
```

**关键保留项**（不被精简）：
- freeze skill（盲评隔离 + 测试保护）
- 熔断机制（sprint-flow 编排层监控）
- Gate 1 自动修复回退（verification-before-completion）
- pre-push hook 验证逻辑（适配新输出格式）
sprint-flow (编排器，精简编排链)
  │
  ├── Phase 0: office-hours ✅ (gstack, 不变)
  ├── Phase 1: autoplan (gstack) + delphi-review ✅ (不变)
  │              └─ specification.yaml 体系移除
  ├── Phase 2: test-driven-development (superpowers)
  │              + requesting-code-review (superpowers)
  │              替代 xp-consensus 的全部功能
  ├── Phase 3: cross-model-review + verification-before-completion
  │              替代 test-specification-alignment
  ├── Phase 4: User Acceptance (不变)
  └── Phase 6: ship + land-and-deploy (不变)
  
  独立 skill:
  ├── delphi-review ✅ (合并 code-walkthrough 场景)
  ├── code-reviewer ✅ (不变, pre-commit 依赖)
```

### 3.3 删除/变更清单

| 操作 | Skill/文件 | 原因 | 影响范围 |
|------|-----------|------|----------|
| **删除** | `xp-consensus/SKILL.md` | TDD 部分被 superpowers 覆盖，状态机简化为关键行为 | sprint-flow Phase 2 编排更新 |
| **删除** | `specification-generator/SKILL.md` | specification.yaml 体系移除 | 无其他依赖 |
| **重写** | `test-specification-alignment/SKILL.md` | → `test-alignment-lite`：保留 freeze 机制，移除 spec 依赖 | sprint-flow Phase 3 编排更新 |
| **合并** | `code-walkthrough/` | 合并到 delphi-review 作为 code-walkthrough mode | pre-push hook 更新输出格式适配 |
| **新增** | `test-alignment-lite/SKILL.md` | 保留 freeze 保护机制的精简版 | sprint-flow Phase 3 |
| **保留** | `delphi-review/SKILL.md` | 新增 code-walkthrough mode，支持 2 模式 | 小幅修改 (Section 4) |
| **保留** | `code-reviewer/` | 有实际代码实现 | 无变化 |
| **保留** | `githooks/pre-push` | 质量门禁保留，适配新模式 | 小幅修改 JSON 适配 |
| **更新** | `sprint-flow/SKILL.md` | 精简编排链 + 成本监控 | Phase 2/3 调用更新 + 新增 Section |
| **保留** | `githooks/pre-commit` | 8-gate 系统不变 | 无变化 |

### 3.4 sprint-flow 编排链更新

**Phase 1 (PLAN) 变更:**

```
# Before
Phase 1: autoplan → delphi-review → specification-generator（手动调用）
  └─ specification-generator 生成 specification.yaml

# After
Phase 1: autoplan → delphi-review → 规格文件自动生成
  └─ delphi-review APPROVED 后自动提取需求 + AC → 生成 specification.yaml
  └─ 用户无需手动调用 specification-generator
```

**Phase 2 (BUILD) 变更:

```
# Before
Phase 2: xp-consensus (内含 TDD)
  ├─ Driver: TDD (RED→GREEN→REFACTOR)
  ├─ Navigator: 盲评 (freeze 隔离)
  ├─ Gate 1: tsc/ESLint 自动修复
  ├─ Arbiter: confidence ≥8
  └─ Output: APPROVED code

# After
Phase 2: test-driven-development + freeze + verification + review
  ├─ TDD → 按 superpowers 铁律执行 RED→GREEN→REFACTOR
  ├─ freeze → 锁定业务代码，Navigator agent 只能访问测试（盲评隔离）
  ├─ requesting-code-review → 调度独立 agent 盲评业务代码（隔离状态）
  ├─ unfreeze → 解锁业务代码
  ├─ verification-before-completion → 运行测试 + lint（证据优先）
  │   ├─ 全部通过 → 继续
  │   └─ 失败 → 修复 max 3 次 → 仍失败 BLOCK + 用户决策
  ├─ 成本监控（sprint-flow 编排层）→ 超阈值 BLOCK + 用户决策
  └─ Output: APPROVED code
```

**Phase 3 (REVIEW) 变更:**

```
# Before
Phase 3: cross-model-review + test-specification-alignment
  ├─ cross-model-review → 对抗式评审
  ├─ test-specification-alignment → spec 对齐验证
  │   ├─ Phase 1: YAML + AST alignment (可改测试)
  │   └─ Phase 2: freeze 执行 (不可改测试)
  └─ browse → UI 验证

# After
Phase 3: cross-model-review + test-alignment-lite
  ├─ cross-model-review → 对抗式评审（不变）
  ├─ test-alignment-lite → Phase 2 freeze + 测试执行
  │   ├─ 保留 freeze 保护：锁定测试文件，防止修改测试让测试通过
  │   └─ 移除 specification.yaml 依赖：不再做 YAML alignment
  └─ browse → UI 验证（不变）

# test-alignment-lite (保留的核心):
  ├─ freeze 测试目录
  ├─ 运行全部测试
  │   ├─ 业务代码问题 → 修复
  │   ├─ 测试数据问题 → 修复测试数据
  │   └─ 环境问题 → BLOCK + 通知用户
  ├─ unfreeze 测试目录
  └─ 全部通过 → 继续
```

**Phase 1 (PLAN) 变更:**

```
# Before
Phase 1: autoplan → delphi-review → specification-generator
  └─ specification-generator 生成 specification.yaml

# After
Phase 1: autoplan → delphi-review
  └─ 评审通过后输出设计文档，不再生成 specification.yaml
  └─ 需求追踪改为测试命名规范（如 test_auth_login_succeeds）
```

---

## 4. delphi-review 合并 code-walkthrough 设计

### 4.1 两种评审模式

delphi-review 新增 `mode` 参数：

| 模式 | 输入 | 触发场景 | 输出 |
|------|------|---------|------|
| `design` (默认) | 需求文档/设计文档 | `/delphi-review` 手动调用 | APPROVED 设计文档 |
| `code-walkthrough` | git diff + 变更摘要 | pre-push hook 验证 | `.code-walkthrough-result.json` |

### 4.2 code-walkthrough mode 流程

```
/code-walkthrough (或 pre-push hook 触发)
    │
    ├─→ 提取 git diff main...HEAD
    ├─→ 生成变更摘要文件
    │
    ├─→ delphi-review (mode=code-walkthrough, experts=2)
    │     ├─ Expert A: 架构 + 设计视角
    │     ├─ Expert B: 实现 + 质量视角
    │     └─ 共识直到 APPROVED
    │
    └─→ 写入 .code-walkthrough-result.json
          └─ pre-push hook 验证文件
```

### 4.3 pre-push hook 适配方案 (CRITICAL)

**当前 pre-push hook 逻辑** (`githooks/pre-push`, Lines 67-83)：
- 调用 `/code-walkthrough` 命令
- 验证 `.code-walkthrough-result.json` 文件
- 检查字段：commit, branch, verdict, confidence, timestamp, expires

**变更清单**：
1. **hook 脚本**：将 skill 调用从 `/code-walkthrough` 改为 `/delphi-review --mode code-walkthrough`
2. **输出文件**：保持 `.code-walkthrough-result.json` 格式不变（向后兼容）
3. **验证逻辑**：不变（文件存在 + 格式有效 + commit 匹配 + verdict=APPROVED + 未过期）
4. **新增**：当 delphi-review 返回 REQUEST_CHANGES 时，hook 输出问题摘要到终端

```
# 变更后的 pre-push hook 调用:
# BEFORE:
opencode run /code-walkthrough
# AFTER:
opencode run /delphi-review --mode code-walkthrough

# 输出文件格式不变 (向后兼容):
{
  "commit": "abc123",
  "branch": "feature/x",
  "timestamp": "...",
  "expires": "...",
  "verdict": "APPROVED",
  "confidence": 9,
  "experts": [ ... ],
  "issues": [ ... ],
  "consensus_ratio": 1.0
}
```

---

## 5. 风险评估与缓解

### 5.1 风险矩阵

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| `verification-before-completion` 不替代 freeze 机制 | **已识别** | 高 | **保留 freeze 机制**，test-alignment-lite 继续使用 |
| 盲评无法仅靠"上下文控制"实现 | **已识别** | 高 | **保留 freeze skill 技术隔离**，Navigator agent 执行时 freeze 锁定业务代码 |
| pre-push hook 适配失败 | 低 | 高 | 保持输出文件格式不变，仅更改 skill 调用路径 |
| superpowers TDD 与现有项目规范冲突 | 中 | 低 | 灰度迁移阶段验证，保留回退路径 |
| sprint-flow 编排链断裂 | 低 | 中 | 逐一验证新编排链中每个 skill 的可用性和数据流 |
| 17 状态机中的关键行为丢失 | **已识别** | 中 | **保留关键行为**（熔断、回退、安全扫描）作为 sprint-flow 编排层逻辑 |
| githooks 8-gate 系统受影 | 无 | 无 | code-reviewer 不变，8-gate 不受影响 |
| specification.yaml 迁移成本 | 中 | 低 | 现有项目可手动迁移或保留旧 spec 作为参考 |
| superpowers skills 版本不稳定 | 低 | 中 | 在 sprint-flow 中 pin skill 版本，定期检查更新 |

### 5.2 保留方案：灰度迁移

如果不愿一次性删除，可以：

1. **阶段 1**: 在 sprint-flow 中切换编排链到 superpowers（旧 skills 保留不用）
2. **阶段 2**: 运行 1-2 周验证新流程稳定性
3. **阶段 3**: 确认稳定后删除旧 skill 文件

---

## 6. 预期收益

### 6.1 定量

| 指标 | 精简前 | 精简后 | 变化 |
|------|--------|--------|------|
| 自研 SKILL.md 数量 | 7 | 3 核心 + 1 精简 (test-alignment-lite) | -43% |
| Skill 总行数 (markdown) | ~3,659 | delphi ~1,000 + code-reviewer ~317 + sprint-flow ~350 + test-alignment-lite ~200 | -48% |
| 状态机复杂度 | 17 states (xp-consensus) + 26 states (spec-gen) | 0 (保留为编排层逻辑) | 大幅降低 |
| 外部依赖复杂度 | 高 (spec 体系强依赖) | 中 (superpowers + freeze) | 降低 |

### 6.2 定性

1. **可维护性**: 减少自研 skill 数量，更多依赖经过社区验证的成熟 skill
2. **可理解性**: 从 7 个复杂 skill 降低到 3 个核心 + superpowers 组合
3. **灵活性**: 不再被 specification.yaml 体系锁定，可根据项目需要选择最佳工具
4. **一致性**: TDD 使用 superpowers 的统一铁律，不在不同 skill 中有不同实现

---

## 8. 实施计划

### Phase 1: 方案评审 (当前阶段)
- [ ] delphi-review 评审本方案
- [ ] 获得 APPROVED 裁决

### Phase 2: 更新 delphi-review
- [ ] 新增 `mode` 参数 (design/code-walkthrough)
- [ ] 合并 code-walkthrough 的评审逻辑

### Phase 3: 更新 sprint-flow
- [ ] Phase 1: 移除 specification-generator 调用
- [ ] Phase 2: 将 xp-consensus 替换为 TDD + review 组合
- [ ] Phase 3: 将 test-specification-alignment 替换为 test-alignment-lite
- [ ] 新增：sprint-flow 编排层成本监控（替代 xp-consensus 熔断）
- [ ] 新增：明确 skill 间数据流契约（见 Section 9.1）

### Phase 4: 新增 test-alignment-lite
- [ ] 保留 freeze/unfreeze 两阶段机制
- [ ] 移除 specification.yaml 依赖
- [ ] 新增测试命名约定验证器（见 Section 9.2）
- [ ] 明确 freeze 双重用途边界（见 Section 9.3）

### Phase 5: 适配 pre-push hook
- [ ] 将 skill 调用从 `/code-walkthrough` 改为 `/delphi-review --mode code-walkthrough`
- [ ] 验证输出格式兼容性（`.code-walkthrough-result.json` 不变）
- [ ] 新增：REQUEST_CHANGES 时终端输出问题摘要

### Phase 6: 灰度验证
- [ ] 在新功能开发中验证完整编排链
- [ ] 确认 freeze 机制正确工作（盲评隔离 + 测试保护）
- [ ] 确认 pre-push hook 正常触发

### Phase 7: 删除冗余 skill (灰度验证后执行)
- [ ] 删除 xp-consensus/SKILL.md
- [ ] 删除 specification-generator/SKILL.md
- [ ] 删除 test-specification-alignment/SKILL.md（替换为 test-alignment-lite）
- [ ] 删除 code-walkthrough/ 目录

### Phase 8: 更新文档
- [ ] 更新 README.md 中的 Skills Architecture
- [ ] 更新 CONTRIBUTING.md 中的开发流程
- [ ] 更新 AGENTS.md 中的 CODE MAP
- [ ] 编写 specification.yaml 迁移指南（存量项目参考）

---

## 9. 已识别实施细节（需 Phase 3/4 补充）

### 9.1 Skill 间数据流契约

sprint-flow Phase 2 的编排链需要明确各 skill 的输入/输出：

| 步骤 | Skill | 输入 | 输出 | 失败回退 |
|------|-------|------|------|----------|
| 1 | test-driven-development | 需求描述 + 现有代码上下文 | 测试 + 代码 (RED→GREEN→REFACTOR) | 修复 max 3 次 → BLOCK |
| 2 | freeze | 业务代码文件路径 | 锁定状态确认 | ❌ BLOCK |
| 3 | requesting-code-review | 需求 + 测试 + 测试结果（**不传业务代码**） | review findings | 继续（记录 findings） |
| 4 | unfreeze | 业务代码文件路径 | 解锁状态确认 | ❌ BLOCK |
| 5 | verification-before-completion | 测试执行结果 | pass/fail 证据 | 修复 max 3 次 → BLOCK |

### 9.2 测试命名约定验证器

替代 specification.yaml 的需求追溯，采用结构化测试命名：

```
命名格式: test_{module}_{feature}_{expected_behavior}
示例:
  test_auth_login_succeeds_with_valid_credentials
  test_auth_login_rejects_empty_password
  test_user_profile_updates_email
```

**验证规则**（在 test-alignment-lite Phase 0 执行）：
1. 测试名包含模块前缀（从文件路径推断）
2. 测试名包含行为动词（succeeds, fails, rejects, updates, preserves 等）
3. 关键路径测试存在（创建、读取、更新、删除、边界、错误）
4. 测试覆盖率 ≥ 80%（沿用已有要求）

**失败处理**:
- 命名不规范 → warning（不阻塞，但报告）
- 覆盖率 < 80% → error（阻塞）

### 9.3 Freeze 双重用途边界

| 场景 | 时机 | 锁定范围 | 解锁时机 | 目的 |
|------|------|---------|---------|------|
| **盲评隔离** | Phase 2 TDD 完成 → Navigator review 前 | 业务代码文件（`src/**/*.ts` 等） | Navigator 盲评完成 | Navigator 只能看到测试和测试结构 |
| **测试保护** | Phase 3 test-alignment-lite Phase 2 | 测试文件（`**/*.test.ts` 等） | 测试执行完成（全部通过） | 防止修改测试让测试通过 |

**两个场景的 freeze 调用是分开的**：
```
# 场景 1: 盲评隔离（Phase 2）
freeze --target="src/**/*.ts" --exclude="**/*.test.ts, **/*.test.tsx"
# Navigator review...
unfreeze --target="src/**/*.ts"

# 场景 2: 测试保护（Phase 3）
freeze --target="**/*.test.ts, **/*.test.tsx"
# Run tests, analyze failures, fix business code only
unfreeze --target="**/*.test.ts, **/*.test.tsx"
```

---

## 10. 决策点

以下事项需要在评审中达成共识：

| # | 决策 | 选项 A | 选项 B |
|---|------|--------|--------|
| 1 | specification.yaml 体系 | **删除**（推荐） | 保留 |
| 2 | xp-consensus 替代方案 | **superpowers 组合**（推荐） | 保留 |
| 3 | code-walkthrough 处理 | **合并到 delphi-review**（推荐） | 保留独立 |
| 4 | 删除时机 | **灰度迁移**（推荐） | 一次性删除 |
