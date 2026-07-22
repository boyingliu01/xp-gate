# Rule 4: View Model Mapper — Examples

## ❌ 错误示例：路由内联转换

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

## ✅ 正确示例：提取 ViewModel 模块

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
