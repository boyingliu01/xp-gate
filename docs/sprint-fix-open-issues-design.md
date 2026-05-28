# Sprint Design: 修复 Open Issues (#66, #68)

**Date:** 2026-05-28
**Sprint ID:** sprint-2026-05-28-01
**Issues:** #66, #68

---

## 1. 需求概述

### Issue #68: Karpathy 工程原则
引入两条全局 AI 编码纪律：
- **原则 3: Surgical Changes** — 只碰必须碰的代码，只清理自己制造的混乱
- **原则 4: Goal-Driven Execution** — 定义成功标准，循环直到验证

建议落地方式：全局 CLAUDE.md / AGENTS.md 模板（方案 D，推荐）

### Issue #66: 管理界面代码生成可维护性预设
解决 AI 生成管理界面代码的 6 类返工模式：
1. 路由文件膨胀 → 按模块拆分
2. 测试架构不一致 → 统一测试 helper
3. Nunjucks 运算符优先级陷阱 → 自动加括号
4. 数据转换逻辑重复 → View Model Mapper
5. Auth Middleware 设计盲区 → Cookie/Session 验证
6. HTMX + Alpine.js 混合架构混乱 → 清晰架构模板

---

## 2. 设计方案（Round 2 修订版）

### 2.1 Issue #68 落地方案（本次 Sprint 核心）

| 改动位置 | 内容 |
|---------|------|
| `AGENTS.md` | 新增 "AI CODING DISCIPLINE (Karpathy Principles)" 章节，注入原则 3+4 |
| `src/npm-package/lib/init.js` | `xp-gate init` 时自动注入原则到目标项目的 `AGENTS.md`/`CLAUDE.md` |
| `skills/sprint-flow/SKILL.md` | Phase 0 THINK 阶段引用这两条原则作为 AI 行为约束 |

**实现细节：**
- 在 AGENTS.md 的 `ANTI-PATTERNS` 章节后新增 `## AI CODING DISCIPLINE (Karpathy Principles)` 段
- 原则 3 作为 `ANTI-PATTERNS` 的补充规则
- 原则 4 作为 `CONVENTIONS` 的验证要求
- npm-package 的 `init.js` 新增 `inject_karpathy_principles()` 函数

**🔧 关键修复 #1: init.js 幂等性设计**
```javascript
function inject_karpathy_principles(agentsMdPath) {
  const content = fs.readFileSync(agentsMdPath, 'utf-8');
  // 使用完整 section header 进行幂等检测，避免误命中注释或引用
  if (content.includes('## AI CODING DISCIPLINE (Karpathy Principles)')) {
    console.log('  ✓ Karpathy principles already injected, skipping');
    return; // 幂等：已存在则跳过
  }
  // 追加逻辑...
}
```
- 多次 `xp-gate init` 不会重复追加相同段落
- 对现有 `inject_hooks()` 等函数无侵入，仅新增独立函数
- 检测关键词为完整 section header `## AI CODING DISCIPLINE (Karpathy Principles)`，避免误命中注释或参考文献链接

### 2.2 Issue #66 落地方案（本次 Sprint 部分实现 — 文档阶段）

> **🔧 修复 #3: 范围收缩** — 本次 Sprint 仅实现 #66 的文档产出，代码生成自动化留作 Phase 2 sprint。

**本次 Sprint 交付（Phase 1: 文档沉淀）：**

| 改动位置 | 内容 |
|---------|------|
| `skills/admin-template-guidelines/SKILL.md` | **新增** — 6 类管理界面可维护性规则的完整 SKILL.md |
| `docs/admin-template-guidelines.md` | **新增** — 管理界面架构指南文档，含代码示例 |

**SKILL.md 包含 6 类规则的具体约束：**
1. **路由拆分规则**：生成 admin 路由时按模块拆分（templates/plans/reports/analytics/tree），每模块独立文件
2. **测试 helper 规则**：统一 `createAdminTestApp()` 基础设施，所有路由测试 import 同一 helper
3. **Nunjucks 括号规则**：模板中比较运算符两侧强制加括号（`{{ (a <= b) | filter }}`）
4. **View Model Mapper 规则**：重复数据转换模式提取为独立函数
5. **Auth 规则**：admin 路由默认 cookie/session 验证，GET 路由也受保护
6. **HTMX+Alpine 规则**：清晰职责分离模板

**Phase 2 交付（未来 Sprint，本次 Out of Scope）：**
- 代码生成自动化（sprint-flow BUILD 阶段通过 `load_skills` 加载 `admin-template-guidelines`）
- `init.js` 分发 admin 模板 helper 到目标项目
- Phase 2 技术依赖：sprint-flow SKILL.md 的 Phase 2 BUILD 阶段需动态加载 `admin-template-guidelines` skill（具体注入位置待设计）

---

## 3. 实施计划

| Phase | 任务 | 估算 |
|-------|------|------|
| 1 | AGENTS.md 新增 Karpathy 原则章节 | 15min |
| 2 | `init.js` 新增 `inject_karpathy_principles()`（含幂等逻辑） | 45min |
| 3 | 新增 `inject_karpathy_principles()` 的单元测试（覆盖率 ≥80%） | 30min |
| 4 | sprint-flow SKILL.md 更新，Phase 0 引用原则 | 15min |
| 5 | 创建 `skills/admin-template-guidelines/SKILL.md`（6 类规则） | 45min |
| 6 | 创建 `docs/admin-template-guidelines.md`（含代码示例） | 30min |
| 7 | 临时目录验证：执行 `xp-gate init` 检查注入结果 | 15min |
| 8 | 运行现有测试，确保无 regression | 15min |

**总估算**: ~3.5-4 小时（含幂等逻辑和测试，Phase 5-7 可能溢出需 +30min 缓冲）

---

## 4. 验收标准

### Issue #68 验收
- [ ] `AGENTS.md` 包含 `## AI CODING DISCIPLINE (Karpathy Principles)` 章节
- [ ] `init.js` 的 `inject_karpathy_principles()` 具有幂等性（多次 init 不重复追加）
- [ ] 新增代码的单元测试覆盖率 ≥ 80%
- [ ] `xp-gate init` 后目标项目 `AGENTS.md` 自动包含 Karpathy 原则
- [ ] sprint-flow 的 THINK 阶段引用这两条原则

### Issue #66 验收（本次 Sprint 范围）
- [ ] `skills/admin-template-guidelines/SKILL.md` 已创建，包含 6 类规则（遵循标准 frontmatter 格式：`name`, `description`, `maturity`）
- [ ] `docs/admin-template-guidelines.md` 已创建，包含代码示例
- [ ] 6 类规则的文档化已在 AGENTS.md 中引用

### 回归验证
- [ ] 所有现有测试通过
- [ ] 在临时目录执行 `xp-gate init`，检查生成的 AGENTS.md 包含 Karpathy 原则
- [ ] 在 same 临时目录再次执行 `xp-gate init`，确认不重复追加原则段落（幂等性验证）

---

## 5. Out of Scope（本次不实现）

- Issue #68 方案 B（Skill-Cert 评测维度 "surgical-change"）— 留作未来 Sprint
- Issue #66 代码生成自动化（sprint-flow BUILD 阶段 `load_skills` 加载 admin-template-guidelines）
- Issue #66 admin 模板 helper 分发（`init.js` 附带到目标项目）
- Issue #66 Pre-commit hook 扩展（改动行数 vs 任务描述相关性检查）

---

## 6. 风险与缓解

| 风险 | 缓解 |
|------|------|
| init.js 改动可能影响现有初始化流程 | 增量添加独立函数 `inject_karpathy_principles()`，不修改现有逻辑 |
| 管理界面规则较为抽象，需要具体示例 | 文档中包含完整代码示例（模板、helper 用法等） |
| 幂等检测逻辑遗漏边界情况（如注释掉的内容） | 检测关键词：`AI CODING DISCIPLINE` + `Karpathy Principles`，覆盖注释和活跃代码 |
| 临时目录验证可能受环境差异影响 | 使用 `mktemp -d` 创建干净临时目录，验证后清理 |

---

**请确认是否 APPROVED 此设计，或提供反馈需要调整的地方。**
