# Rule 1: Route Splitting — Examples

## ❌ 错误示例：单文件膨胀（800+ 行）

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

## ✅ 正确示例：按模块拆分

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
