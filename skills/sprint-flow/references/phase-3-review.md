# Phase 3: REVIEW + TEST（验证）

## 目标

对抗评审、测试对齐、浏览器测试。确保 MVP 符合 specification。

---

## 调用 Skills

- `cross-model-review` — Alternating 对抗评审
- `test-specification-alignment` — 测试与 Spec 对齐验证
- `browse` (gstack) — 浏览器自动化测试

---

## 执行步骤

### Step 1: 调用 cross-model-review

```bash
skill(name="cross-model-review", user_message="--plan mvp-v1 --mode alternating")
```

cross-model-review 执行：
- Alternating mode: 模型轮流 writer/reviewer
- 直到 APPROVED 或 max rounds

**执行顺序（串行）**:
1. cross-model-review 先执行
2. 输出 plan-final.md
3. test-specification-alignment 基于 plan-final 验证

**如果 max rounds 无 APPROVED**:
- ⚠️ 暂停等待用户 override 或手动修复

**如果 APPROVED**:
- 自动进入 Step 2

---

### Step 2: 调用 test-specification-alignment

```bash
skill(name="test-specification-alignment", user_message="--spec specification.yaml --tests mvp-v1/tests")
```

执行两阶段：
- Phase 1: 验证对齐（可修改测试）
- Phase 2: 执行测试（禁止修改测试）

**如果失败**:
- 回退 Phase 2 重新修复
- 不暂停，自动迭代

**如果通过**:
- 自动进入 Step 3

---

### Step 3: 调用 browse skill

```bash
skill(name="browse", user_message="--url localhost:3000 --test-ui")
```

browse 执行：
- 启动 Chromium (~100ms/command)
- 测试 UI/UX
- 截图验证

**如果发现问题**:
- 回退 Phase 2 修复
- 不暂停，自动迭代

**如果通过**:
- 输出 QA report
- 进入 Phase 4

---

### Step 4: 保存 Review Report

保存到 `<project-root>/.sprint-state/phase-outputs/review-report.md`

---

## 暂停点

| 暂停点 | 触发条件 | 用户操作 |
|--------|---------|---------|
| cross-model-review max rounds | 无 APPROVED | 用户 override 或手动修复 |
| test-alignment 失败 | 自动回退 Phase 2（不暂停） | 自动迭代 |
| browse 发现问题 | 自动回退 Phase 2（不暂停） | 自动迭代 |

---

## 输出

- Review Report (`review-report.md`)
- 验证通过的 MVP
- 进入 Phase 4 ⚠️ **必须人工验收**