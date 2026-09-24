# Rule 2: Test Consistency — Examples

## ❌ 错误示例：每个测试文件自建实例

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

## ✅ 正确示例：共享 Helper

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
