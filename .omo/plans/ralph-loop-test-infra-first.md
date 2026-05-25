# Ralph Loop: Test Infrastructure First + Dispatch Fix — Revised

## 背景

Issue #66 提出：AI 生成的管理界面代码缺少可维护性预设，导致每次迭代都触发结构性返工。根因是代码不是被测试驱动写出来的，也没有用真实基础设施验证就合入了。

ralph-loop SKILL.md 第 57 行 `category="build"` 不存在，`test-driven-development` skill 可能从未被正确加载。

## 改动范围

### 改动 1：修复 dispatch category + 强化 TDD 指令 + 显式覆盖 mock 策略

**文件**：`skills/ralph-loop/SKILL.md`

**当前**：
```
task(category="build", load_skills=["test-driven-development"], timeout=300)
```

**改为**：
```
task(category="unspecified-high", load_skills=["test-driven-development"], timeout=300)
```

同时将 TDD skill 的核心纪律 + mock 边界直接注入 subagent context（不依赖 skill 加载的软约束），**显式覆盖 TDD skill 默认的 mock-first 策略**：

```
【TDD 铁律】RED → GREEN → REFACTOR。任何模块必须先写测试再写实现。
【Mock 边界】（覆盖 TDD skill 默认策略）
  ✅ MOCK: 外部 HTTP API、LLM 调用、第三方平台（钉钉/微信）
  ✅ MOCK: 时间/随机数/UUID（注入依赖）
  ❌ NO MOCK: 数据库操作（用真实测试库或 sqlite-in-memory）
  ❌ NO MOCK: HTTP 路由（用 app.inject() 真实注入）
  ❌ NO MOCK: 模板引擎（用真实 Nunjucks/Jinja 渲染）
  ❌ NO MOCK: 纯业务逻辑（用真实输入输出）
【Mock 密度上限】测试中 mock/spy/fn 引用行数 > 总测试行数 30% 时，
  必须添加 // @mock-justified: <至少10字符理由> 注释说明为何无法用集成测试。
```

### 改动 2：增加「测试基础设施先行」步骤（含失败处理 + 版本检测）

**位置**：在 dispatch 业务代码 subagent 之前

**执行流程**（每个 REQ）：
1. 读取 REQ + AC
2. 加载 learnings
3. **新增：测试基础设施检查**
   - 检查 test-utils.ts（或项目等效文件）是否存在 **且** 导出必需的接口契约
   - **接口契约**（必须导出的函数）：`createTestApp()`、`withTestDb()`
   - 如果不存在或接口缺失 → dispatch "生成测试基础设施" subagent
   - **失败处理**：test-infra dispatch FAIL → retry (max 2) → 仍失败 → BLOCK 或 fallback 到 inline 生成（记录 warning）
   - 等待测试基础设施生成完成并 commit（与业务代码合并为同一个 commit，不影响 bisect）
4. **注入 test-utils API 摘要到业务代码 subagent context**：
   ```
   【已有测试基础设施】test-utils.ts 已存在，导出以下 API：
   - createTestApp(): 创建 Fastify 实例 + 真实 Prisma + Nunjucks 引擎
   - withTestDb(): 测试数据库生命周期（seed + cleanup）
   你必须 import 这些函数，禁止重新手搓同名 helper。
   ```
5. dispatch 业务代码 subagent（带 TDD 约束，见改动 1）
6. 三层验证（L1/L2/L3），**L1 新增**：测试文件新增行数 / (test + impl) 新增行数 ≥ 40%
7. git commit（合并 test-infra 变更和业务代码变更，保持原子性）
8. 记录 progress.log（包含 test infra 状态）

### 涉及文件清单

| 文件 | 改动内容 |
|------|---------|
| `skills/ralph-loop/SKILL.md` | 核心流程修改：dispatch category 修正 + 测试基础设施先行步骤 + 失败处理 + TDD context 注入 + L1 新增验证 + Anti-Patterns 表更新 |
| `skills/ralph-loop/references/components/tool-descriptions.md` | 工具链步骤表：在"load learnings"和"TDD"之间插入"test-infra check"步骤 |
| `skills/ralph-loop/references/components/middleware.md` | 状态机：新增 `test_infra_dispatch → FAIL → retry (max 2) → BLOCK/fallback` 路径 |
| `skills/ralph-loop/references/components/skill-invocations.md` | skill 调用链：插入 test-infra dispatch 节点 |
| `skills/ralph-loop/evals/evals.json` | 更新 ralph-015 + 新增 3 个 eval 用例 |
| `skills/ralph-loop/templates/progress-log.md` | 新增 `**Test infra**: generated / existing / skipped` 字段 |

### 状态机更新

```
PENDING → test_infra_check → [infra needed?] → test_infra_dispatch → FAIL → retry (max 2) → BLOCK
                                       │                              │
                                       │ infra ready                   │ pass
                                       ▼                              ▼
                                 in_progress ←────────────────── test_infra_ready
                                       │
                                       │ fail
                                       ▼
                                 RETRY (n≤3) → n≥3 → BLOCKED
```

### eval 用例设计

| ID | 场景 | 验证点 |
|----|------|--------|
| ralph-016 | 首次 REQ，无 test-utils.ts | dispatch test-infra 子任务，不 dispatch 业务代码 |
| ralph-017 | 后续 REQ，test-utils.ts 已存在且接口完整 | 跳过 test-infra，直接 dispatch 业务代码 |
| ralph-018 | test-utils.ts 存在但接口不完整 | dispatch test-infra 增量补充 |
| ralph-015 | dispatch category 修正 | 使用 `category="unspecified-high"` 而非 `category="build"` |

### Token 成本估算

| REQ 数量 | 旧流程 token | 新流程 token（首次 test-infra） | 新流程 token（后续 REQ） |
|----------|-------------|-------------------------------|------------------------|
| 3 | ~15k | ~20k (+33%) | ~17k (+13%) |
| 5 | ~25k | ~30k (+20%) | ~27k (+8%) |
| 10 | ~50k | ~55k (+10%) | ~52k (+4%) |

**首次 test-infra dispatch** 是一次性固定成本（约 5k token），后续 REQ 仅需 context 注入测试基础设施摘要（约 2k token 增量），实际增量随 REQ 数量增加而摊薄。

## 风险（已缓解）

| 风险 | 严重程度 | 缓解措施 |
|------|---------|---------|
| test-infra dispatch 失败阻塞 REQ | 高 | retry max 2 + fallback 到 inline 生成 |
| test-utils.ts 已存在但版本过旧 | 中 | 接口契约检测（必须导出 createTestApp + withTestDb） |
| 业务代码 subagent 忽略 test-utils | 中 | context 显式注入 API 摘要 + Anti-Patterns 表 + eval 验证 |
| token 成本增加 | 低 | 首次一次性成本，后续摊薄 |

## 预期效果

- 所有通过 ralph-loop 生成的代码，测试基础设施先于业务代码存在
- 所有业务代码 subagent 遵循 TDD 纪律（RED→GREEN→REFACTOR）
- Mock 使用符合 issue #66 定义的边界（真实 Prisma DB + 真实 Fastify inject + 真实 Nunjucks 渲染）
- TDD 执行可定量验证（L1 测试先行比率检查）
