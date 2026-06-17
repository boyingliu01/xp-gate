# TDD 强制执行设计文档 (v3 — 整合 3 位专家 Round 1 v2 反馈)

## 问题

当前 Gate 5 的 "Test-Source File Pairing Check" 和 Mock Density Advisory Scan 均仅为 **WARNING/ADVISORY**，不阻断提交/推送。TDD 铁律（"NO PRODUCTION CODE WITHOUT A FAILING TEST"）写在 `skills/test-driven-development/SKILL.md` 中，但没有任何 gate 级强制执行。

## 设计

3 层结构，增量推进。**关键决策**：升级现有 Gate 5a 和调整 Gate M2 阈值，保持编号体系稳定。

### Layer 1: Gate 5a 升级 — Test-First BLOCK (pre-commit)

**修改现有 Gate 5a**（`githooks/pre-commit` 第 948-1061 行），将 WARNING 升级为 BLOCK（仅对新增文件）。

**变更内容**：
- 对每个 staged 的新增 `.ts/.tsx` 源文件（`git diff --cached --name-status --diff-filter=A`），检查对应 `.test.ts/.test.tsx` 是否也在 staged 中
- 豁免文件：`index.ts`, `types.ts`, `interfaces.ts`, `constants.ts`, `__init__` 类文件, `.d.ts`, `.pyi`
- 豁免注解：`// @no-test-required: <reason>`（理由 ≥10 字符），同时支持 `// @no-test` 作为 deprecated alias（向后兼容，计划 v0.9.0 移除）
- 修改已有文件 → WARNING（不阻断，兼容存量项目）
- **逃生阀**：`SKIP_GATE_5A_BLOCK=1` 环境变量
  - 仅在非 main/master 分支生效
  - 每次使用记录到 `.xp-gate/reports/escape-valve-log.json`（包含时间戳、分支、用户、原因）
  - 使用后 24h 内必须提交 post-mortem issue

**多语言支持**：
- 当前 sprint 仅对 `.ts/.tsx` 文件执行 BLOCK
- 其他语言（Python/Go/Java/Kotlin/C++/Swift/Dart/Ruby/Rust）保持现有 WARNING 行为
- 后续根据 TS 实施效果逐步扩展到其他语言

**存量项目渐进式采纳**：
- 新增 `.tdd-adoption.yaml` 配置文件
- 支持 `gracePeriod: N`（前 N 次提交仅警告，不阻断）
- 童子军模式：只检查新增文件，修改已有文件仅 WARNING

**性能要求**：
- 100 个文件 < 500ms
- 增加性能基准测试

### Layer 2: Gate M2 阈值调整 — Mock 密度增强 (pre-push)

**修改现有 Gate M2**（`githooks/pre-push` 第 319-345 行），将 BLOCK 阈值从 50% 降至 30%。

**变更内容**：
- 阈值：mock 关键字密度 >30% 且无 `@mock-justified: <reason>` 注解（理由 ≥10 字符）时 BLOCK
- 保留现有检测逻辑（jest.mock, vi.mock, spyOn, fn(), MagicMock 等）
- **配置项**：读取 `.mockpolicyrc` 的 `layers.*.maxMockDensity` 按层应用阈值
  - unit 层：默认 100（不限制）
  - integration 层：默认 30
  - 项目可自定义
- Mock 密度公式：`mock 关键字匹配行数 / 测试文件总行数`

**分阶段实施**：
- **Phase 0**（本 sprint 前置）：运行全仓库 mock density 分布分析，建立 `.mock-density-baseline.json`
- **Phase 1**（本 sprint）：在 pre-push 以 WARNING 模式运行，收集误报数据
- **Phase 2**（2 周后）：根据误报率决定是否启用 BLOCK
  - 误报率 < 5% → 启用 BLOCK
  - 误报率 5-15% → 调整阈值或扩大豁免列表
  - 误报率 > 15% → 暂停实施，重新评估

### Layer 3: ralph-loop TDD 强化

**具体修改**：

1. **`skills/ralph-loop/SKILL.md`**：
   - 在 "每个 REQ 完成前" 检查清单中增加："验证 test-first 原则（新增源文件必须有对应测试文件）"
   - 在 "progress.log" 记录格式中增加字段：`test_first_compliant: true/false`
   - 增加 "TDD 合规检查" 步骤：在 REQ 完成前运行 `git diff --cached --name-status --diff-filter=A` 检查新增文件

2. **`skills/sprint-flow/references/phase-2-build.md`**：
   - 更新 Gate 引用表：将 "Gate 5a (WARNING)" 改为 "Gate 5a-BLOCK (新增文件 BLOCK, 修改文件 WARNING)"
   - 更新 Gate 引用表：将 "Gate M2 (50% BLOCK)" 改为 "Gate M2 (30% BLOCK, 可配置)"
   - 增加 "TDD 强制执行" 章节，说明 Gate 5a-BLOCK 和 Gate M2 的新行为

**验收标准**：
- ralph-loop 每个 REQ 完成前必须验证 test-first 原则
- progress.log 包含 `test_first_compliant` 字段
- AGENTS.md 中 Gate 表更新为 "Gate 5a-BLOCK" 和 "Gate M2 (30%)"
- README.md 门禁详解章节更新
- QUALITY-GATES-CODE-OF-CONDUCT.md 门禁表更新

## 不做

- spec-to-test alignment（已有 `test-specification-alignment` skill）
- coverage 阈值修改（已有 Gate 5 的 80%）
- CI workflow 修改
- 其他语言的 test-first BLOCK（本 sprint 仅 TS）

## 实现顺序

1. **BATS 测试先行**（TDD 方式）：
   - `githooks/__tests__/gate-5a-block.test.bats` — 覆盖新增文件 BLOCK、修改文件 WARNING、豁免文件、豁免注解、逃生阀
   - `githooks/__tests__/gate-m2-threshold.test.bats` — 覆盖阈值边界值（29%, 30%, 50%, 51%）、配置项、`@mock-justified` 注解

2. **Gate 5a 升级**：
   - 修改 `githooks/pre-commit` 第 948-1061 行
   - 增加逃生阀逻辑 + audit log
   - 统一注解为 `@no-test-required`（兼容 `@no-test`）

3. **Gate M2 阈值调整**：
   - 修改 `githooks/pre-push` 第 319-345 行
   - 增加 `.mockpolicyrc` 配置项支持
   - 本 sprint 以 WARNING 模式运行（Phase 1）

4. **文档更新**：
   - AGENTS.md（Gate 表）
   - README.md（门禁详解）
   - QUALITY-GATES-CODE-OF-CONDUCT.md（门禁表）
   - `skills/ralph-loop/SKILL.md`（REQ 完成检查清单）
   - `skills/sprint-flow/references/phase-2-build.md`（Gate 引用表）

5. **自动化检查**：
   - `scripts/prepack.cjs` 增加 `docs-drift-check` 步骤
   - 对比 AGENTS.md 中的 Gate 表与 pre-commit 脚本实际 Gate 数量，不一致则报错

## 存量迁移影响评估

**实施前统计**（需在 PR 描述中包含）：

### Test-Source Pairing 统计
```bash
# 统计当前仓库无测试的 .ts/.tsx 文件数量
find src -name "*.ts" -o -name "*.tsx" | grep -v ".test." | grep -v ".d.ts" | \
  while read f; do
    test_file="${f%.ts}.test.ts"
    [ ! -f "$test_file" ] && echo "$f"
  done | wc -l
```

### Mock Density 分布分析
```bash
# 统计当前仓库测试文件的 mock density 分布
find src -name "*.test.ts" -o -name "*.test.tsx" | \
  while read f; do
    total_lines=$(wc -l < "$f")
    mock_lines=$(grep -cE "(jest\.mock|vi\.mock|spyOn|fn\(\)|MagicMock)" "$f" || echo 0)
    if [ "$total_lines" -gt 0 ]; then
      density=$((mock_lines * 100 / total_lines))
      echo "$density"
    fi
  done | sort -n | uniq -c
```

**预期影响**：
- 新增文件：会被 Gate 5a-BLOCK 阻断（除非有豁免）
- 修改文件：仅 WARNING，不阻断
- 存量项目可通过 `.tdd-adoption.yaml` gracePeriod 逐步迁移
- Mock density 30-50% 区间的测试文件会被新阈值影响，需评估误报率

## 逃生阀治理机制

### 常规逃生阀

**使用条件**：
- 仅在非 main/master 分支生效
- 必须提供原因（通过环境变量 `SKIP_GATE_5A_BLOCK_REASON`）

**审计日志**：
- 记录到 `.xp-gate/reports/escape-valve-log.json`
- 字段：`timestamp`, `branch`, `user`, `reason`, `gate`

**事后复盘**：
- 使用后 24h 内必须提交 post-mortem issue
- Issue 模板：`docs/templates/escape-valve-postmortem.md`

### 紧急逃生机制

**使用条件**：
- 生产环境紧急修复（hotfix）
- 需要 senior engineer 审批

**配置文件**：
- `.xp-gate/emergency.yaml`
- 字段：`enabled`, `approved_by`, `reason`, `expires_at`

**审批流程**：
1. 创建 `.xp-gate/emergency.yaml` 文件
2. 提交 PR 并标记为 "emergency"
3. senior engineer 审批合并
4. 紧急逃生在 `expires_at` 后自动失效

## 配置项说明

### .mockpolicyrc

```json
{
  "mock-threshold": 30,
  "mock-justified-min-length": 10,
  "layers": {
    "unit": {
      "maxMockDensity": 100
    },
    "integration": {
      "maxMockDensity": 30
    }
  }
}
```

- `mock-threshold`: 全局 Mock 密度阈值（默认 30），超过此值且无 `@mock-justified` 注解时阻断
- `mock-justified-min-length`: `@mock-justified` 注解理由最小长度（默认 10）
- `layers.*.maxMockDensity`: 按测试层差异化阈值

### .tdd-adoption.yaml

```yaml
# TDD 渐进式采纳配置
gracePeriod: 10  # 前 10 次提交仅警告，不阻断
enabled: true
```

- `gracePeriod`: 宽限期提交次数（默认 0，立即启用 BLOCK）
- `enabled`: 是否启用渐进式采纳（默认 true）

### .xp-gate/emergency.yaml

```yaml
enabled: false
approved_by: ""
reason: ""
expires_at: "2026-06-20T00:00:00Z"
```

- `enabled`: 是否启用紧急逃生
- `approved_by`: 审批人
- `reason`: 紧急原因
- `expires_at`: 过期时间（ISO 8601 格式）

## 文档更新清单

| 文件 | 更新内容 |
|------|---------|
| `AGENTS.md` | Gate 表：Gate 5a → Gate 5a-BLOCK，Gate M2 阈值 50% → 30% |
| `README.md` | 门禁详解章节：Gate 5a 和 Gate M2 描述更新 |
| `CHANGELOG.md` | 破坏性变更说明：Gate 5a 升级为 BLOCK，Gate M2 阈值调整 |
| `githooks/pre-commit` 头部注释 | 新增 Gate 5a-BLOCK 描述 |
| `githooks/pre-push` 头部注释 | 更新 Gate M2 阈值说明 |
| `githooks/QUALITY-GATES-CODE-OF-CONDUCT.md` | 门禁表更新 |
| `skills/ralph-loop/SKILL.md` | REQ 完成检查清单增加 test-first 验证 |
| `skills/sprint-flow/references/phase-2-build.md` | Gate 引用表更新 |

## 测试覆盖矩阵

### gate-5a-block.test.bats

| 场景 | 预期结果 |
|------|---------|
| 新增 .ts 文件无对应 .test.ts | BLOCK |
| 新增 .ts 文件有对应 .test.ts | PASS |
| 新增 .tsx 文件无对应 .test.tsx | BLOCK |
| 修改已有 .ts 文件无对应 .test.ts | WARNING |
| 豁免文件（index.ts, types.ts, interfaces.ts, constants.ts） | PASS |
| 豁免文件（.d.ts, .pyi） | PASS |
| `@no-test-required: <reason>` 注解（理由 ≥10 字符） | PASS |
| `@no-test-required: short` 注解（理由 <10 字符） | BLOCK |
| `@no-test` 注解（deprecated） | PASS |
| `SKIP_GATE_5A_BLOCK=1` 环境变量（非 main 分支） | PASS + audit log |
| `SKIP_GATE_5A_BLOCK=1` 环境变量（main/master 分支） | BLOCK（逃生阀不生效） |
| `.tdd-adoption.yaml` gracePeriod 内 | WARNING（不阻断） |
| `.tdd-adoption.yaml` gracePeriod 外 | BLOCK |
| 性能测试：100 个文件 | < 500ms |

### gate-m2-threshold.test.bats

| 场景 | 预期结果 |
|------|---------|
| Mock 密度 29% | PASS |
| Mock 密度 30% 无 `@mock-justified` | WARNING（Phase 1）/ BLOCK（Phase 2） |
| Mock 密度 30% 有 `@mock-justified: <reason>`（理由 ≥10 字符） | PASS |
| Mock 密度 30% 有 `@mock-justified: short`（理由 <10 字符） | WARNING/BLOCK |
| Mock 密度 50% 无 `@mock-justified` | WARNING（Phase 1）/ BLOCK（Phase 2） |
| `.mockpolicyrc` 配置 `layers.unit.maxMockDensity: 100` | unit 层不限制 |
| `.mockpolicyrc` 配置 `layers.integration.maxMockDensity: 30` | integration 层 30% |
| `.mockpolicyrc` 配置 `mock-threshold: 40` | 全局阈值 40% |
| 跨语言测试：Python `MagicMock` | 正确检测 |
| 跨语言测试：Java `Mockito.mock` | 正确检测（后续扩展） |

## Delphi 评审历史

### Round 1 (2026-06-17)
- Expert A (架构): REQUEST_CHANGES (Critical: Gate M4/M2 重复, Gate 11/5a 关系未定义)
- Expert B (实现): REQUEST_CHANGES (Critical: Gate 编号冲突, Mock 阈值歧义, 注解不一致)
- Expert C (可行性): REQUEST_CHANGES (Major: 存量迁移成本未量化, 逃生阀缺失, Layer 3 模糊)

### Round 2 (2026-06-17)
- Expert A: APPROVED (所有 Critical/Major 已解决)
- Expert B: REQUEST_CHANGES (新增: Mock threshold 误报风险, 逃生阀治理机制)
- Expert C: APPROVED (所有 Critical/Major 已解决)

### Round 3 (2026-06-17)
- Expert A: APPROVED (无新问题)
- Expert B: APPROVED (修复答复被接受，置信度 9/10)
- Expert C: APPROVED (无新问题)

**共识**: 100% (3/3 APPROVED)

### Round 1 v2 (2026-06-17) — 修订后文档重新评审
- Expert A (架构): REQUEST_CHANGES (9/10)
  - Critical: Gate 11 与 Gate 5a 功能重复且编号冲突；Gate M4 与 Gate M2 功能完全重叠；逃生阀治理机制完全缺失
  - Major: 阈值从 50% 降至 30% 的迁移影响未评估；文档更新清单完全缺失；仅覆盖 TypeScript 但豁免列表混合多语言；Layer 3 描述过于模糊
- Expert B (实现): REQUEST_CHANGES (8/10)
  - Critical: 命名严重混乱（Gate 11 vs Gate 5a，Gate M4 vs Gate M2）；Gate M2 已是 BLOCK 检查；零测试覆盖
  - Major: 实施顺序风险；逃生阀治理复杂性；ralph-loop TDD 强化机制未明确；bash 实现复杂度可控但需重构；阈值调整影响评估缺失
- Expert C (可行性): REQUEST_CHANGES (7/10)
  - Critical: Gate 11 与 Gate 5 的关系不明确；缺少存量项目渐进式采纳路径；Gate M4 阈值从 30% 直接 BLOCK 过于激进
  - Major: 缺少紧急逃生快速回滚机制；文档更新清单不完整；Gate 11 性能影响未评估

### Round 2 v2 (2026-06-17) — 整合 v2 反馈后修订
- 实际修改设计文档，落实所有修复：
  - 删除 "Gate 11" 和 "Gate M4"，统一使用 "Gate 5a 升级" 和 "Gate M2 阈值调整"
  - 增加逃生阀治理机制（常规 + 紧急）
  - 增加文档更新清单（8 个文件）
  - 增加存量迁移影响评估（test-source pairing + mock density 分布）
  - 增加配置项说明（.mockpolicyrc + .tdd-adoption.yaml + .xp-gate/emergency.yaml）
  - 增加测试覆盖矩阵（14 + 10 场景）
  - 增加性能要求（100 文件 < 500ms）
  - 增加分阶段实施策略（Phase 0-2）
  - 增加紧急逃生机制（.xp-gate/emergency.yaml）
- 待重新评审
