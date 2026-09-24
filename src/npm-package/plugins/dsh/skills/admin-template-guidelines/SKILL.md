---
name: admin-template-guidelines
description: "6 maintainability rules for AI-generated admin interfaces (Fastify + Nunjucks + HTMX + Alpine.js). Prevents route bloat, test inconsistency, Nunjucks traps, repeated data logic, auth blind spots, and HTMX/Alpine confusion."
maturity: alpha
---

# Admin Template Guidelines

6 maintainability rules distilled from real rework patterns in interview-bot admin interface development. These constraints MUST be enforced during sprint-flow BUILD phase when generating admin routes, views, or tests.

## 核心原则

| 原则 | 说明 |
|------|------|
| **路由拆分** | Admin routes 按模块拆分，禁止单文件膨胀 |
| **测试一致性** | 所有测试使用共享 `createAdminTestApp()` helper |
| **Nunjucks 括号** | 比较表达式与 filter 混用时必须加括号 |
| **View Model Mapper** | 重复数据转换提取为独立函数 |
| **Auth 保护** | 所有 Admin 路由（含 GET）必须认证 |
| **HTMX+Alpine 分离** | HTMX 管服务端交互，Alpine 管客户端状态 |

---

## 规则 1: 路由拆分（Route Splitting）

**Constraint:** Admin routes MUST be split by module — never a single monolithic file.

### 模块划分

| 文件 | 职责 |
|------|------|
| `admin/routes/templates.ts` | 模板 CRUD（列表/创建/编辑/删除） |
| `admin/routes/plans.ts` | 访谈计划管理（创建/启动/暂停/完结） |
| `admin/routes/reports.ts` | 报告生成与导出 |
| `admin/routes/analytics.ts` | 数据统计与看板 |
| `admin/routes/tree.ts` | 技能树/目录管理 |
| `admin/routes/admin-shared.ts` | 共享中间件、通用 helper、布局渲染 |

**Examples:** → see `references/rule-1.md`

---

## 规则 2: 测试一致性（Test Consistency）

**Constraint:** All admin route tests MUST use a shared `createAdminTestApp()` helper — never hand-roll mini Fastify instances per test file.

**Examples:** → see `references/rule-2.md`

---

## 规则 3: Nunjucks 括号陷阱（Nunjucks Parentheses）

**Constraint:** Comparison expressions in Nunjucks MUST be wrapped in parentheses when used with filters. The Nunjucks filter operator (`|`) has **higher precedence** than comparison operators, causing silent incorrect output.

**Examples & Checklist:** → see `references/rule-3.md`

---

## 规则 4: View Model Mapper

**Constraint:** Repeated data transformation patterns MUST be extracted into dedicated functions. Any data mapping, filtering, or calculation that appears in 3+ route handlers must live in a shared `view-models.ts` module.

### 常见重复模式

| 模式 | 出现位置 | 提取函数 |
|------|----------|----------|
| `_count` → `totalCount` 映射 | templates.ts, plans.ts, reports.ts | `mapCountFields()` |
| COMPLETED 状态过滤 | plans.ts, reports.ts, analytics.ts | `filterCompletedPlans()` |
| 完成率计算 | plans.ts, analytics.ts, tree.ts | `calculateCompletionRate()` |
| 完整 ViewModel 转换 | 所有列表页路由 | `mapTemplateToViewModel()` |

**Examples:** → see `references/rule-4.md`

---

## 规则 5: Auth 保护（Auth Protection）

**Constraint:** ALL Admin routes MUST be protected by authentication — including GET routes. No admin endpoint is exempt. Prefer cookie/session validation over API key headers.

### 路由豁免规则

| 路由类型 | 需要 Auth | 说明 |
|----------|-----------|------|
| Admin GET | ✅ 必须 | 管理页面包含敏感数据 |
| Admin POST/PUT/DELETE | ✅ 必须 | 数据变更操作 |
| Admin API (HTMX endpoints) | ✅ 必须 | 部分更新接口 |
| Public GET | ❌ 不需要 | 面向用户的公开页面 |

**Examples:** → see `references/rule-5.md`

---

## 规则 6: HTMX + Alpine 分离

**Constraint:** Clear separation of concerns between HTMX (server-driven content replacement) and Alpine.js (client-side UI state). HTMX handles server interactions; Alpine handles local component state.

### 职责矩阵

| 功能 | HTMX | Alpine.js |
|------|------|-----------|
| 页面导航 / URL 变更 | ✅ | ❌ |
| 表单提交到服务端 | ✅ | ❌ |
| 列表分页/搜索/排序 | ✅ | ❌ |
| 局部内容替换（`hx-target`） | ✅ | ❌ |
| 下拉菜单开关 | ❌ | ✅ |
| Modal 显示/隐藏 | ❌ | ✅ |
| 表单字段即时验证 | ❌ | ✅ |
| Toast 通知本地状态 | ❌ | ✅ |
| 按钮 loading 状态切换 | ❌ | ✅ |

**Examples & Principles:** → see `references/rule-6.md`


