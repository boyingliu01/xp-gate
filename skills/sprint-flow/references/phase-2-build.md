# Phase 2: BUILD（TDD + 盲评 + 验证）

## 目标

TDD 执行，盲评验证，Gate 1 验证通过。生成 MVP v1。

---

## 调用 Skills

替代原 xp-consensus，使用 superpowers 成熟 skill 组合：

| 步骤 | Skill | 来源 | 说明 |
|------|-------|------|------|
| 1 | `test-driven-development` | superpowers | RED → GREEN → REFACTOR 铁律 |
| 2 | `freeze` | gstack | 锁定业务代码，盲评隔离 |
| 3 | `requesting-code-review` | superpowers | 独立 agent 盲评（隔离状态） |
| 4 | `unfreeze` | gstack | 解锁业务代码 |
| 5 | `verification-before-completion` | superpowers | 测试 + lint 证据优先 |
| 6 | 成本监控 | sprint-flow 编排层 | 超阈值 BLOCK + 用户决策 |

---

## 执行步骤

### Step 1: 读取 specification.yaml

从 `.sprint-state/phase-outputs/specification.yaml` 读取 specification（如存在）。
如不存在，从 Phase 1 输出的设计文档中提取需求。

### Step 2: TDD 执行（test-driven-development）

```bash
skill(name="test-driven-development", user_message="实现 [需求描述]，基于 specification.yaml")
```

**TDD 铁律**：
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

### Step 3: 盲评隔离（freeze）

```bash
skill(name="freeze", user_message="--target src/**/*.ts --exclude **/*.test.ts")
```

锁定所有业务代码文件，排除测试文件。
Navigator agent 在盲评阶段将无法访问业务代码。

### Step 4: 独立盲评（requesting-code-review）

```bash
skill(name="requesting-code-review", user_message="盲评需求: [需求] + 测试: [测试文件] + 测试结果: [结果]")
```

**关键**: 盲评 agent 只接收需求 + 测试 + 测试结果，**不传业务代码**（freeze 锁定中）。

**输出**: review findings（问题清单 + 建议）

### Step 5: 解锁业务代码（unfreeze）

```bash
skill(name="unfreeze", user_message="--target src/**/*.ts")
```

解锁业务代码文件，允许后续步骤访问。

### Step 6: 验证（verification-before-completion）

```bash
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
- max 3 次失败 → ⚠️ 暂停等待用户决定

### Step 7: 成本监控（sprint-flow 编排层）

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
| `GATE2_RUNNING` | Security Scan 集成 | gstack `security-scan` skill 替代 |
| `SEALED_CODE_ISOLATION` | freeze 技术隔离 | **保留 freeze skill 调用** |

---

## Skill 间数据流契约

| 步骤 | Skill | 输入 | 输出 | 失败回退 |
|------|-------|------|------|----------|
| 1 | test-driven-development | 需求描述 + 现有代码上下文 | 测试 + 代码 (RED→GREEN→REFACTOR) | 修复 max 3 次 → BLOCK |
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

---

## 输出

- MVP v1 (`mvp-v1/` 目录)
- 进入 Phase 3 自动执行
