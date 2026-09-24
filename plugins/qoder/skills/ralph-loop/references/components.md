# Ralph Loop 组件分解

## 1. System Prompt — 核心原则

| # | 原则 | 说明 |
|---|------|------|
| 1 | 逐 REQ 迭代 | 一次处理一个 REQ/切片，干净上下文，避免上下文线性膨胀 |
| 2 | Token 节约 | 比旧并行模式节约 40-67% token |
| 3 | 全量回归 | 每个 REQ 完成后跑全量测试 |
| 4 | 进度持久化 | progress.log 持久化 learnings/permanent/contextual |
| 5 | 可中断续传 | 中断后可从最后完成 REQ 继续 |

## 2. Memory — 状态与记忆结构

### Progress Log Schema (`progress.log` — YAML)

```yaml
req_progress:
  completed_count: 3
  total_count: 5
  current_req: REQ-XXX-004
  status: running|completed|blocked
  test_infra_status: generated|existing|skipped|fallback

learnings:
  permanent:
    - pattern: "描述持久模式"
      evidence: "来源证据"
  contextual:
    - pattern: "描述当前 REQ 有效模式"
      expires_on: "过期条件"

cost:
  req_number: 3
  tokens_used: 15000
  cumulative_tokens: 85000
  threshold: 200000
```

### Test Infra Status 字段

| 值 | 含义 |
|---|------|
| `generated` | 本 REQ 首次生成 test-utils.ts |
| `existing` | test-utils.ts 已存在且接口完整 |
| `skipped` | 非首次 REQ，跳过 test-infra 检查 |
| `fallback` | test-infra dispatch 失败，使用 inline 生成 |

### Learnings 分类

| 类型 | 生命周期 | 示例 |
|------|---------|------|
| `permanent` | 跨所有 REQ | "项目使用 ESLint strict 模式" |
| `contextual` | 当前 REQ 内 | "REQ 003 使用 Zod 验证 schema" |

## 3. Middleware — 迭代控制逻辑

### 状态机

```
REQ N → 加载 learnings → 测试基础设施检查 → [infra missing?] → test_infra_dispatch
     │                              │                             │
     │                              │ infra ready                 │ FAIL (max 2 retry)
     │                              ▼                             ▼
     │                         TDD → 回归测试 ←───────────── BLOCK/fallback
     │                              │
     │ PASS → REQ N+1
     │ FAIL → 重试 (max 3) → BLOCK → 用户决策
     │ ALL_REQS_COMPLETE → 结束，返回控制权给 sprint-flow orchestrator
```

### 熔断机制

| 触发条件 | 动作 |
|---------|------|
| TDD 失败 > 3 次 | BLOCK + 用户决策 |
| Token 使用超阈值 | BLOCK + 用户决策 |
| 回归测试失败 | 记录到 progress.log，通知 orchestrator |
| test-infra dispatch 失败 (max 2 retry) | BLOCK 或 fallback inline 生成 |

## 4. Skill Invocations — 技能调用链

| 步骤 | Skill | 参数 |
|------|-------|------|
| 0 | 测试基础设施检查 | 检查 test-utils.ts 存在性 + 接口契约 |
| 1 | `test-driven-development` | `--lang` 注入 + TDD 铁律 + Mock 边界 |
| 2 | `learn` (gstack) | classification: permanent/contextual |
| 3 | `requesting-code-review` | REQ 完成后评审 |

### test-infra dispatch 节点

当 test-utils.ts 不存在或接口缺失时：
```
task(category="unspecified-high", load_skills=["test-driven-development"],
     prompt="生成测试基础设施：createTestApp() + withTestDb()。TDD 铁律：先写测试再实现。")
```
- retry max 2 次
- 仍失败 → BLOCK 或 fallback inline 生成（记录 warning）
- 成功后与业务代码合并为同一 commit

## 5. Tool Descriptions — 构建步骤

| 步骤 | 动作 | 说明 |
|------|------|------|
| 1 | 加载当前 REQ | 从 specification.yaml 获取下一个 READY REQ |
| 2 | 加载 learnings | 从 progress.log 加载 permanent + contextual learnings |
| 3 | 测试基础设施检查 | 检查 test-utils.ts。不存在 → dispatch, retry max 2 |
| 4 | TDD (RED→GREEN→REFACTOR) | test-driven-development skill |
| 5 | 全量回归测试 | 运行全部现有测试 |
| 6 | 测试先行比率检查 (L1b) | 新增测试行数 / 总新增行数 ≥ 40% |
| 7 | 记录 progress.log | learnings 分类存储 |
| 8 | 成本检查 | token 使用量是否超阈值 |
| 9 | 完成/继续 | 所有 REQ 完成 → 结束；否则 → 下一个 |
