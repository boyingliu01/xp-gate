# Phase 4/6: VERIFY（验证 — 代码走查 + 测试对齐 + 反馈获取）

**执行时机**: Phase 3/6 BUILD 完成后、Phase 5/6 SHIP 之前。
**对应旧模型**: Phase 3 REVIEW + Phase 4 FEEDBACK

## 目标

多专家代码走查、测试对齐（#367 程序化 HARD-GATE）、浏览器验证（Layer 4 可选链）、反馈捕获。确保 MVP 符合 specification 并记录经验教训。

**执行者**: orchestrator 直接执行 Part A（非 subagent dispatch — Issue #249）。

Web 前端项目额外增加：原生 UI 审查 + 可选增强。

---

## Part A: REVIEW + TEST（代码走查 + 测试对齐）

### 调用 Skills

**所有项目（原生 HARD-GATE 链）**:
- `delphi-review --mode code-walkthrough` — 多专家匿名代码走查（2-3 domestic models, ≥90% consensus）
- `test-specification-alignment` — 测试与 Spec 对齐验证（#367 程序化 HARD-GATE）
- `xp-gate check --all` — 全量质量门禁（Gate 0–9，含安全审计）

**浏览器验证 — Layer 4 可选链**:
```
OPTIONAL: 若检测到 gstack browse 已安装 → 使用 gstack browse 进行浏览器自动化测试
ELSE IF 平台支持 browser-use MCP → 使用 browser-use MCP
ELSE → SKIP 并记录 "[sprint-flow] 浏览器验证 SKIP（无可用浏览器工具）"
```

**Web 前端项目额外注入** (`--type web-nextjs` / `web-react` / `web-vue`):
- `xp-gate ui-review`（原生）— UI 视觉审查（间距、层级、一致性）
- OPTIONAL: 若检测到 gstack `qa` 已安装 → 三层 QA 系统化测试；未安装则 SKIP
- OPTIONAL: 若检测到 gstack `design-review` 已安装 → 视觉审计增强；未安装则 SKIP
- OPTIONAL: 若检测到 gstack `benchmark` 已安装 → Core Web Vitals 基线；未安装则 SKIP

**Mobile 项目额外注入** (`--type mobile-flutter` / `mobile-react-native`):
- `flutter-test` — Flutter 单元测试 + widget 测试 (Flutter only)
- Detox E2E — React Native 端到端测试 (RN only)

**Backend 项目额外注入** (`--type backend-go` / `backend-springboot` / `backend-django`):
- API Testing — 后端 API 自动化测试

### 执行步骤

#### Step 1: 调用 delphi-review --mode code-walkthrough

```
skill(name="delphi-review", user_message="--mode code-walkthrough")
```

- 2-3 位国内模型专家匿名独立评审（DeepSeek-v4-pro + Kimi-K2.6 + Qwen3.6-Plus）
- Round 1: 匿名独立评审（防止 anchoring bias）
- Round 2: 交换意见，响应关切
- Round 3: 最终立场（如需）
- ≥90% 共识 + APPROVED 才通过

**如果 REQUEST_CHANGES**: 暂停等待用户处理 → 修复后重新评审。**如果 APPROVED**: 写入 `.code-walkthrough-result.json`（1 小时有效期）→ 进入 Step 2。

#### Step 2: 调用 test-specification-alignment（#367 程序化 HARD-GATE）

```
skill(name="test-specification-alignment", user_message="--spec specification.yaml --tests mvp-v1/tests")
```

Phase 1: 验证对齐（可修改测试） → Phase 2: 执行测试（禁止修改测试）

**#367 修复 — 程序化 HARD-GATE**:

test-specification-alignment 执行后**必须**输出 `.sprint-state/phase-outputs/test-alignment-report.json`：

```json
{
  "alignment_status": "PASS | FAIL",
  "head_commit": "<git rev-parse HEAD>",
  "spec_hash": "<SHA-256 of specification.yaml>",
  "req_test_mapping": {},
  "ac_assertion_mapping": {},
  "timestamp": "<ISO 8601>"
}
```

**`phase-transition 4 completed` 程序化校验**:
- 文件缺失 → BLOCK
- `alignment_status` 非 PASS → BLOCK
- `head_commit` 与当前 HEAD 不符 → BLOCK（防陈旧绑定）
- `spec_hash` 与当前 specification.yaml 不符 → BLOCK（防陈旧绑定）

**--skip-evidence 逃生口护栏**:
- `--skip-evidence` 必须同时提供 `--reason "<text>"`
- 每次使用写入 audit.jsonl（`event: evidence_skipped, reason, phase`）
- `xp-gate retro` 报告设曝光区块
- 单 sprint 使用 >2 次 → 告警

#### Step 2.5: 质量门禁全量验证

```
npx xp-gate check --all
```

运行所有可用的质量门禁（Gate 0–9，含安全审计 Gate 7/8/9）并输出汇总报告。任何 BLOCK 状态 → 回退 Phase 3/6 修复。

> 此步骤自动调用各独立门禁（lint、复杂度、principles、架构、安全扫描等），无需手动逐个执行。替代原 `cso` 外部 skill 调用。

#### Step 2.5-2.10: 项目类型特定验证（Web/Mobile/Backend）

- **Web**: `xp-gate ui-review`（原生）→ OPTIONAL gstack qa/design-review/benchmark（如已安装）
- **Mobile**: flutter-test / detox E2E
- **Backend**: API automation tests

#### Step 3: 浏览器验证（Layer 4 可选链）

```
OPTIONAL: 若检测到 gstack browse 已安装:
  skill(name="browse", user_message="--url [URL] --test-ui")
ELSE IF 平台支持 browser-use MCP:
  使用 browser-use MCP 进行浏览器验证
ELSE:
  SKIP 并记录 "[sprint-flow] 浏览器验证 SKIP（无可用浏览器工具）"
```

默认 URL: `localhost:3000`。发现问题 → 回退 Phase 3/6 修复。

#### Step 4: 保存 Review Report

保存到 `<project-root>/.sprint-state/phase-outputs/review-report.md`

### 暂停点

| 暂停点 | 触发条件 | 用户操作 |
|--------|---------|---------|
| delphi code-walkthrough REQUEST_CHANGES | Critical Issues 未修复 | 用户修复 → 重新评审 |
| test-alignment 失败 | 自动回退 Phase 3/6（不暂停） | 自动迭代 |
| 浏览器验证发现问题 | 自动回退 Phase 3/6（不暂停） | 自动迭代 |

### 输出

- `.code-walkthrough-result.json`（pre-push hook 验证）
- `.sprint-state/phase-outputs/test-alignment-report.json`（#367 程序化 HARD-GATE 证据）
- Review Report (`review-report.md`)
- Web 前端附加: ui-review report + OPTIONAL QA/design-review/benchmark reports
- 验证通过的 MVP

---

## Part B: FEEDBACK CAPTURE（反馈获取）

### 调用 Skills

**原生**:
- `learnings.md` 写入 — 模式记录（替代原 gstack `learn`）
- `xp-gate retro` — 工程回顾：提交历史、工作模式、代码质量趋势、返工率区块

**可选（Layer 4）**:
- OPTIONAL: 若检测到 `systematic-debugging` skill 已安装 → 根因调试（保留"无根因不修复"纪律）；未安装则使用"根因分析后方可修复"文本纪律

### 执行步骤

#### Step 1: Learnings 写入（原生）

将 Sprint 中发现的模式/教训写入 `.sprint-history/learnings.md`：

```markdown
## [YYYY-MM-DD] Sprint <id> — VERIFY Learnings

### Pattern: <title>
- **Context**: <when this applies>
- **Insight**: <what was learned>
- **Action**: <how to apply in future>
```

#### Step 2: 工程回顾 — xp-gate retro（原生）

```
npx xp-gate retro
```

- 提交历史分析、代码质量趋势、改进建议
- 含 #369 返工率趋势区块
- 含 --skip-evidence 使用曝光区块

#### Step 3: 根因调试（可选 — Layer 4）

**IF Phase 6/6 CLOSE 发现 bug 或 Part A 验证失败**:

```
OPTIONAL: 若检测到 systematic-debugging skill 已安装:
  skill(name="systematic-debugging", user_message="[具体 bug 描述]")
ELSE:
  遵循"无根因不修复"文本纪律 — 先分析根因，确认后再修复
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
- Retro Report（`xp-gate retro` 输出）
- Sprint 2 Pain Document (`sprint2-pain.md`) — 如果有 emergent issues
- 进入 Phase 5/6 SHIP 自动执行
