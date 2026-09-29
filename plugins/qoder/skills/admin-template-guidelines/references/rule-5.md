# Rule 5: Auth Protection — Examples

## ❌ 错误示例：GET 路由未认证

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

## ✅ 正确示例：所有路由统一认证

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
