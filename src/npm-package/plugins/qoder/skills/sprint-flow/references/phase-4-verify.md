# Phase 4/6: VERIFY（验证 — 代码走查 + QA + 反馈获取）

**执行时机**: Phase 3/6 BUILD 完成后、Phase 5/6 SHIP 之前。
**对应旧模型**: Phase 3 REVIEW + Phase 4 FEEDBACK

## 目标

多专家代码走查、测试对齐、浏览器测试、反馈捕获。确保 MVP 符合 specification 并记录经验教训。

**执行者**: orchestrator 直接执行 Part A（非 subagent dispatch — Issue #249）。

Web 前端项目额外增加：系统化 QA、视觉审计、性能基线。

---

## Part A: REVIEW + TEST（代码走查 + 测试对齐）

### 调用 Skills

**所有项目**:
- `delphi-review --mode code-walkthrough` — 三个 Qoder Custom Agent 匿名代码走查（模型不受 provider、vendor 或国籍限制，≥90% consensus）
- `test-specification-alignment` — 测试与 Spec 对齐验证
- `browse` (gstack) — 浏览器自动化测试

**Web 前端项目额外注入** (`--type web-nextjs` / `web-react` / `web-vue`):
- `qa` (gstack) — 三层 QA（Quick/Standard/Exhaustive）系统化测试
- `design-review` (gstack) — 线上 UI 视觉审计（间距、层级、AI slop 检测）
- `benchmark` (gstack) — Core Web Vitals 性能基线

**Mobile 项目额外注入** (`--type mobile-flutter` / `mobile-react-native`):
- `flutter-test` — Flutter 单元测试 + widget 测试 (Flutter only)
- Detox E2E — React Native 端到端测试 (RN only)
- `flutter-review` (user) — Flutter 代码审查 (Flutter only)

**Backend 项目额外注入** (`--type backend-go` / `backend-springboot` / `backend-django`):
- API Testing — 后端 API 自动化测试

### 执行步骤

#### Step 1: 调用 delphi-review --mode code-walkthrough

```
skill(name="delphi-review", user_message="--mode code-walkthrough")
```

- architecture、technical、feasibility 三个 Custom Agent 匿名独立评审
- Round 1 验证三份成功结果及三个 distinct trimmed `requested_model`
- 后续轮次保持三个 Agent，最多执行到 Round 5
- 三份结果聚合 ≥90% 共识 + APPROVED 才通过；任一执行失败都阻断

**如果 REQUEST_CHANGES**: 暂停等待用户处理 → 修复后重新评审。**如果 APPROVED**: 写入 `.code-walkthrough-result.json`（1 小时有效期）→ 进入 Step 2。

#### Step 2: 调用 test-specification-alignment

```
skill(name="test-specification-alignment", user_message="--spec specification.yaml --tests mvp-v1/tests")
```

Phase 1: 验证对齐（可修改测试） → Phase 2: 执行测试（禁止修改测试）

#### Step 2.5-2.10: 项目类型特定验证（Web/Mobile/Backend）

- **Web**: qa → design-review → benchmark
- **Mobile**: flutter-test / detox E2E
- **Backend**: API automation tests

#### Step 3: 调用 browse skill

```
skill(name="browse", user_message="--url [URL] --test-ui")
```
默认: `localhost:3000`。发现问题 → 回退 Phase 3/6 修复。

#### Step 4: 保存 Review Report

保存到 `<project-root>/.sprint-state/phase-outputs/review-report.md`

### 暂停点

| 暂停点 | 触发条件 | 用户操作 |
|--------|---------|---------|
| delphi code-walkthrough REQUEST_CHANGES | Critical Issues 未修复 | 用户修复 → 重新评审 |
| test-alignment 失败 | 自动回退 Phase 3/6（不暂停） | 自动迭代 |
| browse 发现问题 | 自动回退 Phase 3/6（不暂停） | 自动迭代 |

### 输出

- `.code-walkthrough-result.json`（pre-push hook 验证）
- Review Report (`review-report.md`)
- Web 前端附加: QA report + design-review report + benchmark baseline
- 验证通过的 MVP

---

## Part B: FEEDBACK CAPTURE（反馈获取）

### 调用 Skills

- `learn` (gstack) — 模式记录（个人级）
- `retro` (gstack) — 周工程回顾：提交历史、工作模式、代码质量趋势（团队级）
- `systematic-debugging` (superpowers) _(可选)_ — 根因调试：反馈中的 bug 做根因分析

### 执行步骤

#### Step 1: 调用 learn skill
```
skill(name="learn", user_message="[Emergent Issues 内容 + Sprint 总结]")
```

#### Step 2: 工程回顾 — 调用 retro
```
skill(name="retro")
```
- 提交历史分析、代码质量趋势、团队贡献分解、改进建议

#### Step 3: 根因调试（可选）
**IF Phase 6/6 CLOSE 发现 bug 或 Part A 验证失败**:
```
skill(name="systematic-debugging", user_message="[具体 bug 描述]")
```
Iron Law: 无调查 → 不修复

#### Step 4: 转化 Emergent Issues 为 Sprint 2 Pain Document

```markdown
# Sprint 2 Pain Document

## 来源：基于 Sprint 1 的 Emergent Issues

## Critical Issues (自动进入 Sprint 2)
## Major Issues (询问用户是否纳入)
## Minor Issues (可选纳入)
```

#### Step 5: 保存 Feedback Log

保存到：
- `<project-root>/.sprint-state/phase-outputs/feedback-log.md`
- `<project-root>/.sprint-state/phase-outputs/sprint2-pain.md` (如有 emergent issues)

### 暂停点

**无** — Part B 完成后自动进入 Phase 5/6 SHIP

**HARD-GATE**: feedback-log.md must exist before Phase 5/6 SHIP

### 输出

- Feedback Log (`feedback-log.md`)
- Retro Report（retro 输出）
- Sprint 2 Pain Document (`sprint2-pain.md`) — 如果有 emergent issues
- 进入 Phase 5/6 SHIP 自动执行
