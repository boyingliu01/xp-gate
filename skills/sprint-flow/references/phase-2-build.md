# Phase 2: BUILD（TDD + 并行执行 + 盲评 + 验证）

## 目标

TDD 执行，多 Agent 并行加速，盲评验证，Gate 1 验证通过。生成 MVP v1。

---

## 调用 Skills

| 步骤 | Skill | 来源 | 说明 |
|------|-------|------|------|
| 0 | **`dispatching-parallel-agents`** _(新增)_ | superpowers | 检测可并行任务，并行分发独立子任务 |
| 0 | **`executing-plans`** _(新增)_ | superpowers | 在隔离 session 中执行计划，有 review checkpoint |
| 1 | `test-driven-development` | superpowers | RED → GREEN → REFACTOR 铁律 |
| 1.5 | `vercel-react-native-skills` | gstack | React Native 特定测试框架引用（如适用） |
| 2 | `freeze` | gstack | 锁定业务代码，盲评隔离 |
| 3 | `requesting-code-review` | superpowers | 独立 agent 盲评（隔离状态） |
| 4 | `unfreeze` | gstack | 解锁业务代码 |
| 5 | `verification-before-completion` | superpowers | 测试 + lint 证据优先 |
| 6 | 成本监控 | sprint-flow 编排层 | 超阈值 BLOCK + 用户决策 |

---

## 执行步骤

### Step 0: 并行检测与任务分发（新增 — ISSUE29）

**检测可并行任务**:
从 specification.yaml 或 Phase 1 输出中提取独立任务。并行条件:
- 无共享状态依赖（不读写同一文件）
- 无文件冲突风险（不同模块/组件）
- 2+ 独立任务存在

**IF 检测到可并行任务 → dispatching-parallel-agents 模式**:

```
Phase 2: 
  ├── task: [独立A] ──┐
  ├── task: [独立B] ──┼── dispatching-parallel-agents (并行)
  ├── task: [独立C] ──┘
  └── merge → freeze → review → verification
```

每个独立任务调用:
```
skill(name="executing-plans", user_message="[计划内容] + review checkpoint")
```

**IF 无并行机会 → 串行模式**（保持现有行为）:
```
Phase 2: test-driven-development → freeze → review → verification
```

### Step 1: TDD 执行（test-driven-development）

```
skill(name="test-driven-development", user_message="[需求描述]，基于 specification.yaml")
```

**TDD 铁律**:
1. 🔴 **RED**: 先写测试（根据 specification.yaml 的 acceptance_criteria）
2. 🟢 **GREEN**: 写最小实现代码让测试通过
3. 🔵 **REFACTOR**: 重构代码，保持测试通过

**语言特定 TDD**（通过 `--lang` 参数选择）：

| 语言 | 调用的 TDD skill |
|------|-----------------|
| Spring Boot | `springboot-tdd` |
| Django | `django-tdd` |
| Go | `golang-testing` |

**输出**: tests + code

### Step 1.5: React Native 特定 TDD（如适用）

**移动端项目特定测试策略**：

对于 mobile-react-native 项目:
- 检测 `--type mobile-react-native` 或 `package.json` 中包含 react-native 依赖
- 使用 Jest 进行单元测试 (RN 默认)
- 使用 Detox 进行端到端测试
- 使用 React Native Testing Library 进行组件测试
- TDD 流程: 先写组件测试 → 极简组件实现 → 通过测试 → 重构

配置文件:
- `jest.config.js` 用于测试环境设置
- `.detoxrc.js` 包含 Detox 配置
- iOS/Android 模拟器/真机测试支持

**执行顺序**:
- `npx jest` 运行单元测试
- `npx detox build && npx detox test` 运行 E2E 测试
- `npx jest --coverage` 检查测试覆盖率

**Flutter 项目**（作为补充）:
- 对于 mobile-flutter 项目: `flutter test --coverage` 运行单元和 widget 测试

### Step 2: 盲评隔离（freeze）

```
skill(name="freeze", user_message="[业务代码文件路径]")
```

锁定所有业务代码文件，排除测试文件。
Navigator agent 在盲评阶段将无法访问业务代码。

### Step 3: 独立盲评（requesting-code-review）

```
skill(name="requesting-code-review", user_message="[需求] + 测试文件 + 测试结果")
```

**关键**: 盲评 agent 只接收需求 + 测试 + 测试结果，**不传业务代码**（freeze 锁定中）。

**输出**: review findings（问题清单 + 建议）

### Step 4: 解锁业务代码（unfreeze）

```
skill(name="unfreeze", user_message="[业务代码文件路径]")
```

解锁业务代码文件，允许后续步骤访问。

### Step 5: 验证（verification-before-completion）

```
skill(name="verification-before-completion", user_message="验证实现完整性")
```

**验证内容**：
- 测试全部通过
- Lint 无错误
- 覆盖率 ≥ 80%
- 证据优先：必须运行命令并确认输出

**失败处理**：
- 自动修复 max 3 次
- 每次失败后修复代码，重新运行验证
- max 3 次失败 → ⚠️ BLOCK，暂停等待用户决定

### Step 6: 成本监控（sprint-flow 编排层）

sprint-flow 编排层监控本次 Phase 2 的成本：

| 阈值 | 值 | 处理 |
|------|-----|------|
| 单任务阈值 | $0.15 | BLOCK + 提示用户决定 |
| 日阈值 | $1.00 | BLOCK + 提示用户决定 |

**零降级原则**: 成本超阈值时，必须 BLOCK 并通知用户，由用户决定是否继续。AI 不能自动跳过验证步骤。

---

## 关键行为保留（原 xp-consensus 17 状态机）

| 原状态 | 含义 | 新处理方案 |
|--------|------|-----------|
| `CIRCUIT_BREAKER_TRIGGERED` | 成本/资源超阈值 | sprint-flow 编排层监控成本，超阈值 BLOCK + 用户决策 |
| `ROLLBACK_TO_ROUND1` | Gate 1 失败自动修复 → 回退 | verification-before-completion 失败 → 修复 max 3 次 → 仍失败 BLOCK |
| `GATE1_FAILED`/`GATE1_COMPLETE` | 区分可修复 vs 致命失败 | verification-before-completion 内置此区分 |
| `GATE2_RUNNING` | Security Scan 集成 | `cso` (gstack) Phase 1-6 安全审计替代 |
| `SEALED_CODE_ISOLATION` | freeze 技术隔离 | **保留 freeze skill 调用** |
| `MOBILE_TDD_EXECUTION` | React Native/Flutter 特定 TDD 执行 | 根据 `--type` 参数选择: mobile-react-native → RN TDD, mobile-flutter → Flutter TDD |

---

## Skill 间数据流契约

| 步骤 | Skill | 输入 | 输出 | 失败回退 |
|------|-------|------|------|----------|
| 0a | dispatching-parallel-agents | specification.yaml + 任务分解 | 并行子任务分发 | 降级为串行 |
| 0b | executing-plans | 子任务计划 | 实现 + review checkpoint | BLOCK |
| 1 | test-driven-development | 需求描述 + 现有代码上下文 | 测试 + 代码 (RED→GREEN→REFACTOR) | 修复 max 3 次 → BLOCK |
| 1.5 | vercel-react-native-skills | 项目类型 (mobile-react-native 或 mobile-flutter), package.json | RN/Flutter 测试执行结果 | RN/Flutter 测试失败 → 修复 max 3 次 → BLOCK |
| 2 | freeze | 业务代码文件路径 | 锁定状态确认 | ❌ BLOCK |
| 3 | requesting-code-review | 需求 + 测试 + 测试结果（**不传业务代码**） | review findings | 继续（记录 findings） |
| 4 | unfreeze | 业务代码文件路径 | 解锁状态确认 | ❌ BLOCK |
| 5 | verification-before-completion | 测试执行结果 | pass/fail 证据 | 修复 max 3 次 → BLOCK |

---

## 暂停点

| 暂停点 | 触发条件 | 用户操作 |
|--------|---------|---------|
| 验证 max 3 失败 | verification-before-completion 失败超过 3 次 | 用户决定修复或放弃 |
| 成本超阈值 | 单任务 >$0.15 或日 >$1.00 | 用户决定继续或暂停 |
| RN/Flutter 测试失败 | mobile-react-native 或 mobile-flutter 项目的测试执行失败且自动修复 max 3 次后仍未通过 | 用户决定继续修复或调整方案 |

---

## 输出

- MVP v1 (`mvp-v1/` 目录)
- 进入 Phase 3 自动执行
