# Phase 2: BUILD（One-Shot 执行）

## 目标

TDD 执行，Gate 1 验证通过。生成 MVP v1。

---

## 调用 Skills

- `xp-consensus` — Driver + Navigator + Arbiter（**内含 TDD 执行**）

⚠️ **关键澄清**: sprint-flow 不单独调用 TDD skill，TDD 由 xp-consensus 内部执行。

---

## xp-consensus 与 TDD 的关系

```
xp-consensus skill 内部流程:
  ├─ Round 1: Driver AI
  │   ├─ 内建调用 test-driven-development skill（RED → GREEN）
  │   ├─ Driver 先写测试（根据 specification.yaml 的 acceptance_criteria）
  │   ├─ Driver 再写最小实现代码
  │   └─ 输出: tests + code
  │
  ├─ Gate 1: Pre-Arbiter Static Analysis（xp-consensus 内建）
  │   ├─ TypeScript strict + ESLint + Test execution
  │   ├─ ⚠️ Gate 1 仅负责"编译/语法层面"验证
  │   └─ 失败: 自动修复 (max 3) → 回退 Round 1
  │
  └─ Round 2-3: Navigator + Arbiter 评审

sprint-flow 的职责边界:
  ├─ sprint-flow 仅调用 xp-consensus（一次调用）
  ├─ xp-consensus 内部会调用 test-driven-development skill
  ├─ sprint-flow 不会额外调用 TDD（避免重复）
  └─ 语言特定 TDD 通过 xp-consensus 的 language 参数选择
```

---

## 执行步骤

### Step 1: 读取 specification.yaml

从 `.sprint-state/phase-outputs/specification.yaml` 读取 specification。

### Step 2: 调用 xp-consensus skill

```bash
skill(name="xp-consensus", user_message="--spec specification.yaml --lang [springboot/django/golang]")
```

xp-consensus 执行流程：

#### Round 1: Driver AI (build agent)
- 内部调用 test-driven-development skill
- TDD: 先写测试 (RED) → 再写代码 (GREEN)
- 输入: specification.yaml
- 输出: sealed{code, decisions} + public{tests, results}

#### Gate 1: Pre-Arbiter Static Analysis
- TypeScript strict + ESLint + Test execution
- 失败: 自动修复 (max 3 次)
  - 每次失败后自动修复代码
  - 修复后重新运行 Gate 1
  - max 3 次失败 → ⚠️ 暂停等待用户决定
- 通过: 进入 Navigator 评审

#### Round 2 Phase 1: Navigator 盲评 (oracle agent)
- 输入: requirements + tests + results
- ⚠️ sealed.code 被 freeze 锁定
- 输出: checkList

#### Round 2 Phase 2: Navigator 验证 (oracle agent)
- 输入: code (解锁) + checkList
- 输出: verdict + confidence

#### Round 3: Arbiter AI (oracle agent)
- 输入: Driver output + Navigator verdict + Gate 1 result
- 置信度阈值: ≥8 APPROVE, <6 REQUEST_CHANGES
- 输出: APPROVED / REQUEST_CHANGES

**如果 REQUEST_CHANGES**:
- 自动回退 Round 1 重新执行
- 不暂停，自动迭代

**如果 APPROVED**:
- 进入 Phase 3

---

### Step 3: 保存 MVP v1

保存到 `<project-root>/.sprint-state/phase-outputs/mvp-v1/`

---

## 语言特定参数

| 语言 | xp-consensus 参数 | 内部调用的 TDD skill |
|------|-------------------|---------------------|
| Spring Boot | `--lang springboot` | springboot-tdd |
| Django | `--lang django` | django-tdd |
| Go | `--lang golang` | golang-testing |

---

## 暂停点

| 暂停点 | 触发条件 | 用户操作 |
|--------|---------|---------|
| Gate 1 max 3 失败 | Gate 1 失败超过 3 次 | 用户决定修复或放弃 |
| Arbiter REQUEST | 自动回退 Round 1（不暂停） | 自动迭代直到 APPROVED |

---

## 输出

- MVP v1 (`mvp-v1/` 目录)
- 进入 Phase 3 自动执行