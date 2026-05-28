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

### ❌ 错误示例：单文件膨胀（800+ 行）

```typescript
// admin/routes/index.ts — 反模式
import { FastifyInstance } from 'fastify';

export async function adminRoutes(fastify: FastifyInstance) {
  // 模板列表 — 第 10 行
  fastify.get('/admin/templates', async (req, reply) => { ... });
  // 模板创建 — 第 45 行
  fastify.post('/admin/templates', async (req, reply) => { ... });
  // 模板编辑 — 第 80 行
  fastify.get('/admin/templates/:id/edit', async (req, reply) => { ... });
  // 模板删除 — 第 115 行
  fastify.delete('/admin/templates/:id', async (req, reply) => { ... });
  // 计划列表 — 第 150 行
  fastify.get('/admin/plans', async (req, reply) => { ... });
  // 计划创建 — 第 190 行
  fastify.post('/admin/plans', async (req, reply) => { ... });
  // ... 持续膨胀到 800+ 行 ...
}
```

### ✅ 正确示例：按模块拆分

```typescript
// admin/routes/admin-shared.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export function registerAdminShared(fastify: FastifyInstance) {
  // 共享中间件：认证
  fastify.addHook('onRequest', authenticateAdmin);

  // 共享 helper：渲染带布局的页面
  fastify.decorate('renderAdmin', async function (
    this: FastifyInstance,
    req: FastifyRequest,
    reply: FastifyReply,
    template: string,
    data: Record<string, unknown>
  ) {
    return reply.view(`admin/layouts/main.njk`, {
      ...data,
      _content: await reply.view(`admin/${template}.njk`, data),
    });
  });
}

// admin/routes/templates.ts
import { FastifyInstance } from 'fastify';

export async function registerTemplateRoutes(fastify: FastifyInstance) {
  fastify.get('/admin/templates', { onRequest: [authenticateAdmin] }, listTemplates);
  fastify.get('/admin/templates/new', { onRequest: [authenticateAdmin] }, showNewTemplate);
  fastify.post('/admin/templates', { onRequest: [authenticateAdmin] }, createTemplate);
  fastify.get('/admin/templates/:id/edit', { onRequest: [authenticateAdmin] }, showEditTemplate);
  fastify.put('/admin/templates/:id', { onRequest: [authenticateAdmin] }, updateTemplate);
  fastify.delete('/admin/templates/:id', { onRequest: [authenticateAdmin] }, deleteTemplate);
}

// admin/routes/plans.ts
import { FastifyInstance } from 'fastify';

export async function registerPlanRoutes(fastify: FastifyInstance) {
  fastify.get('/admin/plans', { onRequest: [authenticateAdmin] }, listPlans);
  fastify.post('/admin/plans', { onRequest: [authenticateAdmin] }, createPlan);
  fastify.post('/admin/plans/:id/start', { onRequest: [authenticateAdmin] }, startPlan);
  fastify.post('/admin/plans/:id/pause', { onRequest: [authenticateAdmin] }, pausePlan);
  fastify.post('/admin/plans/:id/complete', { onRequest: [authenticateAdmin] }, completePlan);
}

// admin/routes/index.ts — 仅负责聚合注册
import { FastifyInstance } from 'fastify';
import { registerAdminShared } from './admin-shared';
import { registerTemplateRoutes } from './templates';
import { registerPlanRoutes } from './plans';
import { registerReportRoutes } from './reports';
import { registerAnalyticsRoutes } from './analytics';
import { registerTreeRoutes } from './tree';

export async function registerAllAdminRoutes(fastify: FastifyInstance) {
  registerAdminShared(fastify);
  await registerTemplateRoutes(fastify);
  await registerPlanRoutes(fastify);
  await registerReportRoutes(fastify);
  await registerAnalyticsRoutes(fastify);
  await registerTreeRoutes(fastify);
}
```

---

## 规则 2: 测试一致性（Test Consistency）

**Constraint:** All admin route tests MUST use a shared `createAdminTestApp()` helper — never hand-roll mini Fastify instances per test file.

### ❌ 错误示例：每个测试文件自建实例

```typescript
// test/admin/templates.test.ts — 反模式
import Fastify from 'fastify';
import { registerTemplateRoutes } from '../../admin/routes/templates';

describe('Template Routes', () => {
  let fastify: any;

  beforeEach(async () => {
    fastify = Fastify();
    await fastify.register(prismaPlugin, { datasource: {} }); // 每次自建
    await fastify.register(registerTemplateRoutes);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close(); // 每个文件重复 teardown 逻辑
  });

  it('should list templates', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/admin/templates' });
    expect(res.statusCode).toBe(200);
  });
});
```

```typescript
// test/admin/plans.test.ts — 同样重复，但细节不同
import Fastify from 'fastify';
import { registerPlanRoutes } from '../../admin/routes/plans';

describe('Plan Routes', () => {
  let app: any;

  beforeAll(async () => {
    app = Fastify({ logger: false }); // 不一致的配置
    await app.register(prismaPlugin, { datasource: {}, skipMigrate: true });
    await app.register(registerPlanRoutes);
    await app.listen({ port: 0 });
  });

  afterAll(async () => {
    await app.server.close(); // 与 templates.test.ts teardown 方式不同
  });
});
```

### ✅ 正确示例：共享 Helper

```typescript
// test/helpers/create-admin-test-app.ts
import Fastify, { FastifyInstance } from 'fastify';
import { prisma } from '@prisma/client';
import { registerAllAdminRoutes } from '../../admin/routes';

export interface AdminTestApp {
  fastify: FastifyInstance;
  inject: FastifyInstance['inject'];
  close: () => Promise<void>;
}

export async function createAdminTestApp(): Promise<AdminTestApp> {
  const fastify = Fastify({
    logger: false,
    trustProxy: true,
  });

  // 注册 Prisma 插件
  await fastify.register(async (instance) => {
    instance.decorate('prisma', prisma);
  });

  // 注册所有 Admin 路由
  await registerAllAdminRoutes(fastify);

  await fastify.ready();

  return {
    fastify,
    inject: fastify.inject.bind(fastify),
    close: async () => {
      await fastify.close();
    },
  };
}
```

```typescript
// test/admin/templates.test.ts
import { createAdminTestApp, AdminTestApp } from '../helpers/create-admin-test-app';

describe('Template Routes', () => {
  let app: AdminTestApp;

  beforeEach(async () => {
    app = await createAdminTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should list templates', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/templates',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.templates)).toBe(true);
  });

  it('should create a template', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/templates',
      payload: {
        name: 'New Template',
        content: '<h1>Hello</h1>',
      },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('/admin/templates');
  });
});
```

```typescript
// test/admin/plans.test.ts — 使用同一个 helper，零重复
import { createAdminTestApp, AdminTestApp } from '../helpers/create-admin-test-app';

describe('Plan Routes', () => {
  let app: AdminTestApp;

  beforeEach(async () => {
    app = await createAdminTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should list plans', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/plans',
    });
    expect(res.statusCode).toBe(200);
  });
});
```

---

## 规则 3: Nunjucks 括号陷阱（Nunjucks Parentheses）

**Constraint:** Comparison expressions in Nunjucks MUST be wrapped in parentheses when used with filters. The Nunjucks filter operator (`|`) has **higher precedence** than comparison operators, causing silent incorrect output.

### 优先级规则

```
表达式:     A <= B | lower
实际解析:   A <= (B | lower)  ← filter 先执行，比较的是 A 和 "lower" 后的 B
预期语义:   (A <= B) | lower  ← 先比较，结果再经 filter
```

### ❌ 错误示例

```nunjucks
{# admin/views/plans.njk — 反模式 #}

{# 比较在 filter 之后执行 → 逻辑错误 #}
{% if plan._interviews.length <= 15 | lower %}
  <span class="badge badge-small">Small Plan</span>
{% endif %}

{# 实际等价于: plan._interviews.length <= "lower" → 始终 true #}

{# 条件渲染中的陷阱 #}
{% if plan.status == 'completed' | title %}
  <span class="status-done">Done</span>
{% endif %}

{# 字符串格式化错误 #}
{{ plan.completionRate * 100 | round | default(0) }}
{# 当 completionRate 为 null 时，null * 100 = NaN → round(NaN) → 错误 #}
```

### ✅ 正确示例

```nunjucks
{# admin/views/plans.njk #}

{# 括号确保比较先执行 #}
{% if (plan._interviews.length <= 15) | lower %}
  <span class="badge badge-small">Small Plan</span>
{% endif %}

{# 条件判断中的正确使用 #}
{% if (plan.status == 'completed') | title %}
  <span class="status-done">Done</span>
{% endif %}

{# 数值计算中先处理 null #}
{{ (plan.completionRate ?? 0) * 100 | round(1) | default('0.0') }}%

{# 多层比较与 filter 组合 #}
{% if (plan._interviews.length >= 15 and plan._interviews.length <= 60) | bool %}
  <span class="badge badge-medium">Medium Plan</span>
{% elif (plan._interviews.length > 60) | bool %}
  <span class="badge badge-large">Large Plan</span>
{% endif %}

{# 安全渲染可选字段 #}
{% if (plan.description | length) > 0 %}
  <p class="description">{{ plan.description | truncate(120) }}</p>
{% else %}
  <p class="description text-muted">No description provided.</p>
{% endif %}
```

### 验证清单

- [ ] 所有 `{{ A <= B | filter }}` 改为 `{{ (A <= B) | filter }}`
- [ ] 所有 `{% if A == B | filter %}` 改为 `{% if (A == B) | filter %}`
- [ ] 使用 `| bool` 而非裸布尔表达式配合逻辑运算符

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

### ❌ 错误示例：路由内联转换

```typescript
// admin/routes/plans.ts — 反模式
fastify.get('/admin/plans', async (req, reply) => {
  const plans = await prisma.plan.findMany({
    include: { _count: { select: { interviews: true } } },
  });

  // 每个路由都在做同样的转换
  const viewModels = plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    status: plan.status,
    interviewCount: plan._count?.interviews ?? 0,
    completedCount: plan.interviews?.filter((i) => i.status === 'COMPLETED').length ?? 0,
    completionRate: plan.interviews?.filter((i) => i.status === 'COMPLETED').length ?? 0
      / (plan._count?.interviews ?? 1) * 100,
    createdAt: plan.createdAt.toISOString().split('T')[0],
  }));

  return reply.view('admin/plans/list.njk', { plans: viewModels });
});
```

### ✅ 正确示例：提取 ViewModel 模块

```typescript
// admin/view-models.ts
import { Plan, Interview, Template } from '@prisma/client';

export interface PlanViewModel {
  id: string;
  name: string;
  status: string;
  interviewCount: number;
  completedCount: number;
  completionRate: number;
  createdAt: string;
}

export interface TemplateViewModel {
  id: string;
  name: string;
  content: string;
  interviewCount: number;
  lastUsed: string | null;
}

/**
 * 将 Prisma Plan 记录转换为视图模型
 */
export function mapPlanToViewModel(
  plan: Plan & { _count?: { interviews: number } },
  interviews?: Interview[]
): PlanViewModel {
  const completedCount = interviews?.filter((i) => i.status === 'COMPLETED').length ?? 0;
  const interviewCount = plan._count?.interviews ?? interviews?.length ?? 0;

  return {
    id: plan.id,
    name: plan.name,
    status: plan.status,
    interviewCount,
    completedCount,
    completionRate: interviewCount > 0 ? (completedCount / interviewCount) * 100 : 0,
    createdAt: plan.createdAt.toISOString().split('T')[0],
  };
}

/**
 * 批量转换 Plan 列表
 */
export function mapPlansToViewModels(
  plans: (Plan & { _count?: { interviews: number } })[],
  interviewsMap?: Map<string, Interview[]>
): PlanViewModel[] {
  return plans.map((plan) =>
    mapPlanToViewModel(plan, interviewsMap?.get(plan.id))
  );
}

/**
 * 将 Prisma Template 记录转换为视图模型
 */
export function mapTemplateToViewModel(
  template: Template & { _count?: { interviews: number }; interviews?: Interview[] }
): TemplateViewModel {
  const interviewCount = template._count?.interviews ?? template.interviews?.length ?? 0;
  const lastUsed = template.interviews?.length
    ? Math.max(...template.interviews.map((i) => i.createdAt.getTime()))
    : null;

  return {
    id: template.id,
    name: template.name,
    content: template.content,
    interviewCount,
    lastUsed: lastUsed ? new Date(lastUsed).toISOString().split('T')[0] : null,
  };
}

/**
 * 过滤出已完成的计划
 */
export function filterCompletedPlans(plans: PlanViewModel[]): PlanViewModel[] {
  return plans.filter((p) => p.status === 'COMPLETED');
}

/**
 * 计算统计摘要
 */
export function calculatePlanStats(plans: PlanViewModel[]) {
  const total = plans.length;
  const completed = plans.filter((p) => p.status === 'COMPLETED').length;
  const inProgress = plans.filter((p) => p.status === 'IN_PROGRESS').length;
  const avgCompletionRate =
    total > 0 ? plans.reduce((sum, p) => sum + p.completionRate, 0) / total : 0;

  return { total, completed, inProgress, avgCompletionRate: Math.round(avgCompletionRate) };
}
```

```typescript
// admin/routes/plans.ts — 使用 ViewModel
import { mapPlansToViewModels, filterCompletedPlans, calculatePlanStats } from '../view-models';

fastify.get('/admin/plans', async (req, reply) => {
  const plans = await prisma.plan.findMany({
    include: { _count: { select: { interviews: true } } },
  });

  const viewModels = mapPlansToViewModels(plans);

  return reply.view('admin/plans/list.njk', {
    plans: viewModels,
    stats: calculatePlanStats(viewModels),
  });
});

fastify.get('/admin/plans/completed', async (req, reply) => {
  const plans = await prisma.plan.findMany({
    where: { status: 'COMPLETED' },
    include: { _count: { select: { interviews: true } } },
  });

  const viewModels = mapPlansToViewModels(plans);
  const completed = filterCompletedPlans(viewModels);

  return reply.view('admin/plans/completed.njk', { plans: completed });
});
```

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

### ❌ 错误示例：GET 路由未认证

```typescript
// admin/routes/plans.ts — 反模式
import { FastifyInstance } from 'fastify';

export async function registerPlanRoutes(fastify: FastifyInstance) {
  // GET 路由缺少认证 — 任何人都可查看所有计划
  fastify.get('/admin/plans', async (req, reply) => {
    const plans = await prisma.plan.findMany();
    return reply.view('admin/plans/list.njk', { plans });
  });

  // 只有 POST 有认证
  fastify.post('/admin/plans', { onRequest: [authenticateAdmin] }, async (req, reply) => {
    // ...
  });
}
```

```typescript
// admin/routes/analytics.ts — 使用不安全的 API Key
import { FastifyInstance } from 'fastify';

export async function registerAnalyticsRoutes(fastify: FastifyInstance) {
  fastify.get('/admin/analytics', {
    onRequest: [
      // 通过 Header 传递 API Key — 易泄露、不安全
      async (req: FastifyRequest, reply: FastifyReply) => {
        const apiKey = req.headers['x-api-key'];
        if (apiKey !== process.env.ADMIN_API_KEY) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
      },
    ],
  }, async (req, reply) => {
    // ...
  });
}
```

### ✅ 正确示例：所有路由统一认证

```typescript
// admin/middleware/authenticate-admin.ts
import { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';

export async function authenticateAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
) {
  const session = req.session;

  if (!session?.userId) {
    return reply
      .code(302)
      .header('Location', '/login?redirect=' + encodeURIComponent(req.url))
      .send();
  }

  // 验证用户具有 Admin 角色
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { role: true },
  });

  if (user?.role !== 'ADMIN') {
    return reply.code(403).view('admin/errors/forbidden.njk', {
      message: 'You do not have permission to access the admin panel.',
    });
  }

  // 将用户信息附加到请求
  req.user = user;
  done();
}
```

```typescript
// admin/routes/admin-shared.ts — 全局注册认证中间件
import { FastifyInstance } from 'fastify';
import { authenticateAdmin } from '../middleware/authenticate-admin';

export function registerAdminShared(fastify: FastifyInstance) {
  // 为所有 /admin/* 路由注册认证 hook
  fastify.addHook('onRequest', authenticateAdmin);
}
```

```typescript
// admin/routes/plans.ts — 继承全局认证
import { FastifyInstance } from 'fastify';

export async function registerPlanRoutes(fastify: FastifyInstance) {
  // 所有路由自动继承 authenticateAdmin
  // 无需在每个 route 上重复声明
  fastify.get('/admin/plans', async (req, reply) => {
    const plans = await prisma.plan.findMany();
    return reply.view('admin/plans/list.njk', { plans });
  });

  fastify.post('/admin/plans', async (req, reply) => {
    await prisma.plan.create({ data: req.body as any });
    return reply.redirect('/admin/plans');
  });
}
```

```typescript
// admin/routes/analytics.ts — 同样保护
import { FastifyInstance } from 'fastify';

export async function registerAnalyticsRoutes(fastify: FastifyInstance) {
  // GET 路由同样受认证保护
  fastify.get('/admin/analytics', async (req, reply) => {
    const stats = await prisma.plan.aggregate({
      _count: { id: true },
      _avg: { completionRate: true },
    });
    return reply.view('admin/analytics/dashboard.njk', { stats });
  });
}
```

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

### ❌ 错误示例：HTMX 与 Alpine 混用

```nunjucks
{# admin/views/plans.njk — 反模式 #}

{# 使用 Alpine 做服务端请求 — 职责错误 #}
<div x-data="{ plans: [], loading: false }"
     x-init="loading = true; fetch('/admin/api/plans').then(r => r.json()).then(d => plans = d); loading = false">
  <template x-for="plan in plans" :key="plan.id">
    <div>
      <span x-text="plan.name"></span>
      {# 删除操作使用 Alpine 而非 HTMX — 失去服务端渲染优势 #}
      <button @click="fetch('/admin/plans/' + plan.id, { method: 'DELETE' })
        .then(() => plans = plans.filter(p => p.id !== plan.id))">
        Delete
      </button>
    </div>
  </template>
</div>

{# HTMX 驱动下拉菜单状态 — 职责错误 #}
<div hx-get="/admin/plans" hx-swap="innerHTML">
  <button hx-on::after-request="this.nextElementSibling.style.display = 'block'">
    Show Filters
  </button>
  <div style="display: none">
    <input type="text" name="search" placeholder="Search..."
           hx-get="/admin/plans" hx-trigger="keyup changed delay:300ms" />
  </div>
</div>
```

### ✅ 正确示例：职责分离

```nunjucks
{# admin/views/plans.njk #}

{# 整体布局与内容列表由 HTMX 驱动 #}
<div id="plans-content" hx-boost="true">
  <div class="header-bar" x-data="{ showFilters: false }">
    <h1>Interview Plans</h1>

    {# 下拉菜单状态由 Alpine 管理 #}
    <button type="button" @click="showFilters = !showFilters"
            :class="{ 'active': showFilters }">
      Filters
    </button>

    {# Alpine 控制本地显示/隐藏 #}
    <div x-show="showFilters" x-transition class="filter-panel">
      {# 搜索输入通过 HTMX 触发服务端请求 #}
      <input type="text" name="search" placeholder="Search plans..."
             hx-get="/admin/plans"
             hx-target="#plans-list"
             hx-trigger="keyup changed delay:300ms"
             hx-indicator=".search-spinner" />
    </div>
  </div>

  {# 列表内容完全由 HTMX 服务端渲染 #}
  <div id="plans-list">
    {% for plan in plans %}
    <div class="plan-card" id="plan-{{ plan.id }}">
      <h3>{{ plan.name }}</h3>
      <p>Status: {{ plan.status | upper }}</p>
      <p>Completion: {{ plan.completionRate | round(1) }}%</p>

      <div class="actions">
        {# 删除操作通过 HTMX 提交，服务端响应更新 DOM #}
        <button class="btn-danger"
                hx-delete="/admin/plans/{{ plan.id }}"
                hx-target="#plan-{{ plan.id }}"
                hx-swap="outerHTML"
                hx-confirm="Are you sure you want to delete this plan?"
                x-data="{ deleting: false }"
                hx-on::before-request="deleting = true"
                hx-on::after-request="deleting = false">
          <span x-show="!deleting">Delete</span>
          <span x-show="deleting" class="spinner">Deleting...</span>
        </button>
      </div>
    </div>
    {% endfor %}
  </div>
</div>
```

```nunjucks
{# admin/views/modals/confirm-delete.njk — Modal 由 Alpine 管理 #}

<div x-data="{ open: false, targetId: null, targetName: '' }"
     @open-modal.window="open = true; targetId = $event.detail.id; targetName = $event.detail.name"
     x-show="open"
     x-cloak
     class="modal-backdrop"
     @click.self="open = false">

  <div class="modal-content" x-transition>
    <h2>Confirm Delete</h2>
    <p>Are you sure you want to delete "<span x-text="targetName"></span>"?</p>

    <div class="modal-actions">
      <button @click="open = false">Cancel</button>

      {# 真正的删除操作通过 HTMX 提交 #}
      <button class="btn-danger"
              hx-delete="/admin/plans/"
              hx-vals='js:{ id: targetId }'
              hx-target="#plans-list"
              @click="open = false">
        Confirm Delete
      </button>
    </div>
  </div>
</div>
```

```nunjucks
{# admin/views/templates/edit.njk — 表单字段本地验证由 Alpine 管理 #}

<form x-data="{
  name: '',
  nameError: '',
  content: '',
  contentError: '',
  get isValid() {
    return this.name.length > 0 && this.content.length > 0 && !this.nameError && !this.contentError;
  },
  validateName(value) {
    this.name = value;
    this.nameError = value.length < 3 ? 'Name must be at least 3 characters.' : '';
  },
  validateContent(value) {
    this.content = value;
    this.contentError = value.trim().length === 0 ? 'Content cannot be empty.' : '';
  }
}" hx-post="/admin/templates/{{ template.id }}"
   hx-target="#form-result"
   hx-swap="innerHTML"
   hx-on::before-request="if (!isValid) { $event.preventDefault(); }">

  <div class="form-group">
    <label for="name">Template Name</label>
    <input type="text" id="name" name="name"
           x-model="name"
           @input="validateName(name)"
           :class="{ 'error': nameError }"
           value="{{ template.name }}" />
    <span x-show="nameError" x-text="nameError" class="field-error"></span>
  </div>

  <div class="form-group">
    <label for="content">Template Content</label>
    <textarea id="content" name="content" rows="20"
              x-model="content"
              @input="validateContent(content)"
              :class="{ 'error': contentError }">{{ template.content }}</textarea>
    <span x-show="contentError" x-text="contentError" class="field-error"></span>
  </div>

  <div class="form-actions">
    <button type="submit" :disabled="!isValid" class="btn-primary">
      Save Template
    </button>
    <a href="/admin/templates" class="btn-secondary">Cancel</a>
  </div>
</form>

{# HTMX 响应结果区域 #}
<div id="form-result"></div>
```

### 分离原则

1. **HTMX 是服务端与 DOM 之间的桥梁** — 所有数据变更、页面导航、内容更新必须通过 HTMX
2. **Alpine 是组件状态的管理者** — 只管理不需要服务端参与的 UI 状态（开关、显隐、验证）
3. **HTMX 属性不应操作 DOM 状态** — `hx-on::after-request` 里不应出现 `element.style.display`
4. **Alpine 方法不应发起 fetch** — `@click="fetch('/api/...')"` 是反模式，应用 `hx-get/hx-post`

---

## 输出契约

当 sprint-flow BUILD phase 加载此 skill 时，生成的 admin 代码必须满足：

```json
{
  "rule_1_route_splitting": {
    "status": "pass",
    "evidence": "admin/routes/ 目录下存在 templates.ts, plans.ts 等分模块文件，无单文件 >200 行"
  },
  "rule_2_test_consistency": {
    "status": "pass",
    "evidence": "所有 admin 测试文件 import createAdminTestApp()，无自建 Fastify 实例"
  },
  "rule_3_nunjucks_parens": {
    "status": "pass",
    "evidence": "所有 .*njk 文件中 filter 前的比较表达式均有括号包裹"
  },
  "rule_4_view_model_mapper": {
    "status": "pass",
    "evidence": "存在 admin/view-models.ts，路由文件中无重复的 .map() 数据转换"
  },
  "rule_5_auth_protection": {
    "status": "pass",
    "evidence": "所有 admin 路由继承全局 authenticateAdmin hook，无 GET 豁免"
  },
  "rule_6_htmx_alpine_separation": {
    "status": "pass",
    "evidence": ".njk 文件中无 Alpine fetch() 调用，无 HTMX 直接操作 DOM 状态"
  }
}
```
