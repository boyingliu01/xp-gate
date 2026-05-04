# Phase 3: REVIEW + TEST（验证）

## 目标

多专家代码走查、测试对齐、浏览器测试。确保 MVP 符合 specification。

Web 前端项目额外增加：系统化 QA、视觉审计、性能基线。

---

## 调用 Skills

**所有项目**:
- `delphi-review --mode code-walkthrough` — 多专家匿名代码走查（2-3 domestic models, >=91% consensus）
- `test-specification-alignment` — 测试与 Spec 对齐验证
- `browse` (gstack) — 浏览器自动化测试

**Web 前端项目额外注入** (`--type web-nextjs` / `web-react` / `web-vue`):
- `qa` (gstack) — 三层 QA（Quick/Standard/Exhaustive）系统化测试
- `design-review` (gstack) — 线上 UI 视觉审计（间距、层级、AI slop 检测）
- `benchmark` (gstack) — Core Web Vitals 性能基线

---

## 执行步骤

### Step 1: 调用 delphi-review --mode code-walkthrough

```
skill(name="delphi-review", user_message="--mode code-walkthrough")
```

delphi code-walkthrough 执行：
- 2-3 位国内模型专家匿名独立评审（DeepSeek-v4-pro + Kimi-K2.6 + Qwen3.6-Plus）
- Round 1: 匿名独立评审（防止 anchoring bias）
- Round 2: 交换意见，响应关切
- Round 3: 最终立场（如需）
- >=91% 共识 + APPROVED 才通过

**如果 REQUEST_CHANGES**:
- ⚠️ 暂停等待用户修复 Critical Issues + 处理 Major Concerns
- 修复后回到 Round 2 重新评审

**如果 APPROVED**:
- 写入 `.code-walkthrough-result.json`（1 小时有效期）
- 进入 Step 2

### Step 2: 调用 test-specification-alignment

```
skill(name="test-specification-alignment", user_message="--spec specification.yaml --tests mvp-v1/tests")
```

Phase 1: 验证对齐（可修改测试） → Phase 2: 执行测试（禁止修改测试）

失败 → 回退 Phase 2 自动修复。通过 → 进入 Step 3。

### Step 2.5: Web 前端 — 调用 qa（如适用）

**IF project_type is web-nextjs / web-react / web-vue:**

```
skill(name="qa", user_message="Standard: [部署 URL 或 localhost:3000]")
```

qa 三层可选：
- Quick: 只测 critical + high 问题
- Standard (推荐): critical + high + medium
- Exhaustive: 包括 cosmetic

输出: before/after health scores + fix evidence + ship-readiness summary

### Step 2.6: Web 前端 — 调用 design-review（如适用）

**IF project_type is web-nextjs / web-react / web-vue:**

```
skill(name="design-review", user_message="审计 [部署 URL] 的视觉设计")
```

design-review 检查：
- 视觉一致性（间距、颜色、字体）
- 层级问题（信息架构、布局）
- AI slop 模式（重复布局、过度设计）
- 交互响应（动画、加载状态）

迭代修复，每次提交原子化。

### Step 2.7: Web 前端 — 调用 benchmark（如适用）

**IF project_type is web-nextjs / web-react / web-vue:**

```
skill(name="benchmark", user_message="建立 [部署 URL] 的性能基线")
```

benchmark 测量：
- 页面加载时间
- Core Web Vitals (LCP, FID, CLS)
- 资源大小
- 与上次部署对比

### Step 3: 调用 browse skill

```
skill(name="browse", user_message="--url [URL] --test-ui")
```

**默认**: `localhost:3000`

**Web 前端扩展支持**:
- 部署环境 URL 测试（如 Vercel/Render/Netlify）
- 响应式布局测试（mobile/tablet/desktop）
- 表单交互测试（提交、验证）
- 认证页面测试（login/register）

browse 执行：
- 启动 Chromium
- 测试 UI/UX
- 截图验证

发现问题 → 回退 Phase 2 修复。通过 → 进入 Step 4。

### Step 4: 保存 Review Report

保存到 `<project-root>/.sprint-state/phase-outputs/review-report.md`

包含：
- delphi code-walkthrough result
- test-specification-alignment result
- qa report (web only)
- design-review report (web only)
- benchmark baseline (web only)
- browse screenshots

---

## 暂停点

| 暂停点 | 触发条件 | 用户操作 |
|--------|---------|---------|
| delphi code-walkthrough REQUEST_CHANGES | Critical Issues 未修复 | 用户修复 → 重新评审 → APPROVED → 继续 |
| test-alignment 失败 | 自动回退 Phase 2（不暂停） | 自动迭代 |
| qa 发现问题 (web) | 自动回退修复（不暂停） | 自动迭代 |
| design-review 发现问题 (web) | 自动回退修复（不暂停） | 自动迭代 |
| browse 发现问题 | 自动回退 Phase 2（不暂停） | 自动迭代 |

---

## 输出

- `.code-walkthrough-result.json`（pre-push hook 验证）
- Review Report (`review-report.md`)
- Web 前端附加: QA report + design-review report + benchmark baseline
- 验证通过的 MVP
- 进入 Phase 4 ⚠️ **必须人工验收**
