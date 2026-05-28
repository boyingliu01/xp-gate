# Admin Template Guidelines

> **Source:** Distilled from real rework patterns during interview-bot admin interface development (Issue #66).
>
> These rules are also enforced via `skills/admin-template-guidelines/SKILL.md` during sprint-flow BUILD phase.

## Why These Guidelines Exist

During the initial development of the interview-bot admin panel, six recurring maintainability problems caused significant rework:

1. **Route bloat** — A single 800+ line route file that became impossible to navigate
2. **Test inconsistency** — Each test file hand-rolled its own Fastify instance with slightly different setup/teardown
3. **Nunjucks precedence traps** — Silent logic errors when filters and comparisons were mixed without parentheses
4. **Repeated data transformations** — The same `.map()` code copied across 5+ route handlers
5. **Auth blind spots** — GET routes left unprotected under the assumption "it's just reading data"
6. **HTMX/Alpine confusion** — Alpine used for server requests, HTMX used for DOM state manipulation

Each of these problems was discovered late, required careful diffing to understand, and took hours to fix. These guidelines codify the lessons learned so future admin routes are generated correctly the first time.

---

## Table of Contents

| # | Rule | Description |
|---|------|-------------|
| 1 | [Route Splitting](#rule-1-route-splitting) | Admin routes MUST be split by module |
| 2 | [Test Consistency](#rule-2-test-consistency) | All tests MUST use shared `createAdminTestApp()` helper |
| 3 | [Nunjucks Parentheses](#rule-3-nunjucks-parentheses) | Comparisons with filters MUST be parenthesized |
| 4 | [View Model Mapper](#rule-4-view-model-mapper) | Repeated data transformations MUST be extracted |
| 5 | [Auth Protection](#rule-5-auth-protection) | ALL admin routes (including GET) MUST be authenticated |
| 6 | [HTMX + Alpine Separation](#rule-6-htmx--alpine-separation) | HTMX handles server interaction; Alpine handles client state |

---

## Rule 1: Route Splitting

### Problem

Admin routes tend to grow rapidly. When all endpoints live in a single file, that file quickly becomes a monolith that is hard to navigate, hard to review, and hard to test in isolation.

### Module Structure

Each module lives in its own file under `admin/routes/`:

| File | Responsibility |
|------|----------------|
| `admin/routes/templates.ts` | Template CRUD (list/create/edit/delete) |
| `admin/routes/plans.ts` | Interview plan management (create/start/pause/complete) |
| `admin/routes/reports.ts` | Report generation and export |
| `admin/routes/analytics.ts` | Statistics and dashboards |
| `admin/routes/tree.ts` | Skill tree / directory management |
| `admin/routes/admin-shared.ts` | Shared middleware, common helpers, layout rendering |

### Wrong: Single File Bloat (800+ lines)

```typescript
// admin/routes/index.ts — ANTI-PATTERN
import { FastifyInstance } from 'fastify';

export async function adminRoutes(fastify: FastifyInstance) {
  // Template list — line 10
  fastify.get('/admin/templates', async (req, reply) => {
    const templates = await prisma.template.findMany();
    return reply.view('admin/templates/list.njk', { templates });
  });

  // Template create — line 45
  fastify.post('/admin/templates', async (req, reply) => {
    const { name, content } = req.body as { name: string; content: string };
    await prisma.template.create({ data: { name, content } });
    return reply.redirect('/admin/templates');
  });

  // Template edit — line 80
  fastify.get('/admin/templates/:id/edit', async (req, reply) => {
    const template = await prisma.template.findUnique({
      where: { id: req.params.id },
    });
    return reply.view('admin/templates/edit.njk', { template });
  });

  // Template delete — line 115
  fastify.delete('/admin/templates/:id', async (req, reply) => {
    await prisma.template.delete({ where: { id: req.params.id } });
    return reply.redirect('/admin/templates');
  });

  // Plan list — line 150
  fastify.get('/admin/plans', async (req, reply) => {
    const plans = await prisma.plan.findMany();
    return reply.view('admin/plans/list.njk', { plans });
  });

  // Plan create — line 190
  fastify.post('/admin/plans', async (req, reply) => {
    const { name, templateId } = req.body as { name: string; templateId: string };
    await prisma.plan.create({ data: { name, templateId } });
    return reply.redirect('/admin/plans');
  });

  // ... continues to 800+ lines with reports, analytics, tree routes ...
}
```

**Why this fails:**
- Scroll fatigue — finding a specific route requires scanning hundreds of lines
- Merge conflicts — every developer editing admin routes touches the same file
- No isolation — cannot test or register a single module independently
- Violates Single Responsibility — one file owns templates, plans, reports, analytics, and tree

### Correct: Module-Split Structure

```typescript
// admin/routes/admin-shared.ts
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export function registerAdminShared(fastify: FastifyInstance) {
  // Shared middleware: authentication hook applied globally
  fastify.addHook('onRequest', authenticateAdmin);

  // Shared helper: render a page with the admin layout
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
```

```typescript
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
```

```typescript
// admin/routes/plans.ts
import { FastifyInstance } from 'fastify';

export async function registerPlanRoutes(fastify: FastifyInstance) {
  fastify.get('/admin/plans', { onRequest: [authenticateAdmin] }, listPlans);
  fastify.post('/admin/plans', { onRequest: [authenticateAdmin] }, createPlan);
  fastify.post('/admin/plans/:id/start', { onRequest: [authenticateAdmin] }, startPlan);
  fastify.post('/admin/plans/:id/pause', { onRequest: [authenticateAdmin] }, pausePlan);
  fastify.post('/admin/plans/:id/complete', { onRequest: [authenticateAdmin] }, completePlan);
}
```

```typescript
// admin/routes/index.ts — ONLY responsible for aggregating registrations
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

**Why this works:**
- Each module file stays under ~150 lines
- Handler functions (`listTemplates`, `createPlan`, etc.) live in separate files and can be unit-tested individually
- The aggregator (`index.ts`) is a thin registration layer with zero business logic
- New modules (e.g., `settings.ts`) add one import + one registration line — no existing file grows

### Best Practice

- **Never** let a route file exceed 200 lines. If it does, split handlers into a `handlers/` subdirectory.
- The `index.ts` aggregator should contain **only** imports and `register*()` calls.
- Shared middleware and decorators belong in `admin-shared.ts`, not duplicated in each module.

---

## Rule 2: Test Consistency

### Problem

When each test file creates its own Fastify instance, subtle differences in configuration, plugin registration, and teardown logic cause flaky tests and wasted debugging time.

### Wrong: Per-File Instance Creation

```typescript
// test/admin/templates.test.ts — ANTI-PATTERN
import Fastify from 'fastify';
import { registerTemplateRoutes } from '../../admin/routes/templates';

describe('Template Routes', () => {
  let fastify: any;

  beforeEach(async () => {
    fastify = Fastify();
    await fastify.register(prismaPlugin, { datasource: {} });
    await fastify.register(registerTemplateRoutes);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it('should list templates', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/admin/templates' });
    expect(res.statusCode).toBe(200);
  });
});
```

```typescript
// test/admin/plans.test.ts — SAME pattern repeated, but DIFFERENT details
import Fastify from 'fastify';
import { registerPlanRoutes } from '../../admin/routes/plans';

describe('Plan Routes', () => {
  let app: any;

  beforeAll(async () => {
    app = Fastify({ logger: false });              // ← inconsistent config
    await app.register(prismaPlugin, { datasource: {}, skipMigrate: true });  // ← different options
    await app.register(registerPlanRoutes);
    await app.listen({ port: 0 });                 // ← listen instead of ready
  });

  afterAll(async () => {
    await app.server.close();                      // ← different teardown
  });
});
```

**Inconsistencies introduced:**
- `beforeEach` vs `beforeAll` — affects test isolation
- `{ logger: false }` vs default — affects test output noise
- `datasource: {}` vs `datasource: {}, skipMigrate: true` — different database states
- `fastify.ready()` vs `app.listen({ port: 0 })` — different readiness semantics
- `fastify.close()` vs `app.server.close()` — different cleanup paths

### Correct: Shared `createAdminTestApp()` Helper

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

  // Register Prisma plugin consistently
  await fastify.register(async (instance) => {
    instance.decorate('prisma', prisma);
  });

  // Register ALL admin routes — tests can target any endpoint
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
// test/admin/plans.test.ts — ZERO duplication, identical pattern
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

### Best Practice

- **All** admin route tests import `createAdminTestApp` from `test/helpers/`
- **Never** call `Fastify()` directly inside a test file
- The helper registers **all** admin routes — this ensures routes work correctly in the full registration context, not just in isolation
- When auth middleware is added to `admin-shared.ts`, tests automatically inherit it

---

## Rule 3: Nunjucks Parentheses

### Problem

In Nunjucks, the filter operator (`|`) has **higher precedence** than comparison operators. This means `A <= B | lower` parses as `A <= (B | lower)`, not `(A <= B) | lower`. This causes silent logic errors that are extremely difficult to spot in templates.

### Precedence Trap

```
Expression:     A <= B | lower
Actual parse:   A <= (B | lower)   ← filter executes first, comparison is between A and "lower" result
Intended语义:   (A <= B) | lower   ← comparison first, then filter applied to the boolean result
```

When `B | lower` produces a string like `"true"` or `"false"`, the comparison `A <= "lower"` will coerce types in unpredictable ways, often producing `true` regardless of the actual value.

### Wrong: Unparenthesized Comparisons

```nunjucks
{# admin/views/plans.njk — ANTI-PATTERN #}

{# Comparison after filter → logic error #}
{% if plan._interviews.length <= 15 | lower %}
  <span class="badge badge-small">Small Plan</span>
{% endif %}

{# Actually evaluates as: plan._interviews.length <= "lower" → always true #}

{# Conditional rendering trap #}
{% if plan.status == 'completed' | title %}
  <span class="status-done">Done</span>
{% endif %}

{# Actually: plan.status == "Completed" — only matches when status is already title-cased #}

{# Numeric calculation without null guard #}
{{ plan.completionRate * 100 | round | default(0) }}
{# When completionRate is null: null * 100 = NaN → round(NaN) → template error #}
```

### Correct: Parenthesized Comparisons

```nunjucks
{# admin/views/plans.njk #}

{# Parentheses ensure comparison executes first #}
{% if (plan._interviews.length <= 15) | lower %}
  <span class="badge badge-small">Small Plan</span>
{% endif %}

{# Conditional judgment — parentheses around the comparison #}
{% if (plan.status == 'completed') | title %}
  <span class="status-done">Done</span>
{% endif %}

{# Numeric calculation — null coalescing BEFORE multiplication #}
{{ (plan.completionRate ?? 0) * 100 | round(1) | default('0.0') }}%

{# Multi-level comparison with filter combination #}
{% if (plan._interviews.length >= 15 and plan._interviews.length <= 60) | bool %}
  <span class="badge badge-medium">Medium Plan</span>
{% elif (plan._interviews.length > 60) | bool %}
  <span class="badge badge-large">Large Plan</span>
{% endif %}

{# Safe rendering of optional fields #}
{% if (plan.description | length) > 0 %}
  <p class="description">{{ plan.description | truncate(120) }}</p>
{% else %}
  <p class="description text-muted">No description provided.</p>
{% endif %}
```

### Key Patterns

| Scenario | Wrong | Correct |
|----------|-------|---------|
| Number comparison + filter | `{{ count > 5 | bool }}` | `{{ (count > 5) | bool }}` |
| String comparison + filter | `{% if status == 'done' | title %}` | `{% if (status == 'done') | title %}` |
| Null-safe calculation | `{{ val * 100 | round }}` | `{{ (val ?? 0) * 100 | round }}` |
| Compound condition | `{% if a > 0 and b < 10 | bool %}` | `{% if (a > 0 and b < 10) | bool %}` |

### Verification Checklist

Before committing any `.njk` file, verify:

- [ ] All `{{ A <= B | filter }}` changed to `{{ (A <= B) | filter }}`
- [ ] All `{% if A == B | filter %}` changed to `{% if (A == B) | filter %}`
- [ ] Boolean expressions use `| bool` rather than bare comparisons with logical operators
- [ ] Any arithmetic on nullable values uses `?? 0` or equivalent before the operation

### Best Practice

- **Always** parenthesize comparisons before applying a filter, even when the filter seems harmless
- Use `| bool` for boolean coercion of compound conditions — it is explicit and avoids precedence ambiguity
- When in doubt, add parentheses. Extra parentheses cost nothing; missing parentheses cause production bugs

---

## Rule 4: View Model Mapper

### Problem

Route handlers frequently contain inline data transformation code — mapping `_count` fields, calculating completion rates, formatting dates. When the same transformation appears in 3+ handlers, any change must be replicated across all of them, inevitably leading to drift and inconsistency.

### Common Repeated Patterns

| Pattern | Appears In | Extracted Function |
|---------|------------|-------------------|
| `_count` → `totalCount` mapping | templates.ts, plans.ts, reports.ts | `mapCountFields()` |
| COMPLETED status filtering | plans.ts, reports.ts, analytics.ts | `filterCompletedPlans()` |
| Completion rate calculation | plans.ts, analytics.ts, tree.ts | `calculateCompletionRate()` |
| Full ViewModel conversion | all list-page routes | `mapTemplateToViewModel()` |

### Wrong: Inline Transformation in Routes

```typescript
// admin/routes/plans.ts — ANTI-PATTERN
fastify.get('/admin/plans', async (req, reply) => {
  const plans = await prisma.plan.findMany({
    include: { _count: { select: { interviews: true } } },
  });

  // Every route repeats the SAME transformation logic
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

```typescript
// admin/routes/analytics.ts — SAME inline logic, slightly different
fastify.get('/admin/analytics', async (req, reply) => {
  const plans = await prisma.plan.findMany({
    include: { _count: { select: { interviews: true } } },
  });

  // Duplicated from plans.ts — already diverged (divisor is ?? 0 instead of ?? 1)
  const stats = plans.map((plan) => ({
    interviewCount: plan._count?.interviews ?? 0,
    completionRate: plan.interviews?.filter((i) => i.status === 'COMPLETED').length ?? 0
      / (plan._count?.interviews ?? 0) * 100,  // ← subtle bug: division by zero
  }));

  return reply.view('admin/analytics/dashboard.njk', { stats });
});
```

**Problems:**
- `?? 1` vs `?? 0` divisor inconsistency creates silent calculation differences
- Completion rate formula duplicated 3 times — fixing one means fixing all
- No type safety — inline objects have no interface definition
- Route handlers are longer than necessary, mixing data access with presentation logic

### Correct: Extracted ViewModel Module

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
 * Convert a single Prisma Plan record to a ViewModel
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
 * Batch-convert a list of Plan records to ViewModels
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
 * Convert a single Prisma Template record to a ViewModel
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
 * Filter to only completed plans
 */
export function filterCompletedPlans(plans: PlanViewModel[]): PlanViewModel[] {
  return plans.filter((p) => p.status === 'COMPLETED');
}

/**
 * Calculate aggregate statistics for a set of plans
 */
export function calculatePlanStats(plans: PlanViewModel[]) {
  const total = plans.length;
  const completed = plans.filter((p) => p.status === 'COMPLETED').length;
  const inProgress = plans.filter((p) => p.status === 'IN_PROGRESS').length;
  const avgCompletionRate =
    total > 0 ? plans.reduce((sum, p) => sum + p.completionRate, 0) / total : 0;

  return { total, completed, inProgress, avgCompletionRate: Math.round(avgCompletionRate) };
}

/**
 * Calculate completion rate safely (handles zero denominator)
 */
export function calculateCompletionRate(completed: number, total: number): number {
  if (total === 0) return 0;
  return (completed / total) * 100;
}

/**
 * Normalize _count fields from Prisma includes into top-level counts
 */
export function mapCountFields<T extends { _count?: Record<string, number> }>(
  record: T,
  fields: (keyof NonNullable<T['_count']>)[]
): Omit<T, '_count'> & Record<string, number> {
  const result = { ...record } as any;
  for (const field of fields) {
    result[field + 'Count'] = record._count?.[field as string] ?? 0;
  }
  delete result._count;
  return result;
}
```

```typescript
// admin/routes/plans.ts — consumes ViewModel module
import { FastifyInstance } from 'fastify';
import { mapPlansToViewModels, filterCompletedPlans, calculatePlanStats } from '../view-models';

export async function registerPlanRoutes(fastify: FastifyInstance) {
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
}
```

### Best Practice

- **Any data transformation** appearing in 3+ routes belongs in `admin/view-models.ts`
- ViewModel interfaces serve as the contract between routes and templates — if a template needs a field, the interface documents it
- Mapper functions are pure functions — no side effects, no I/O — making them trivially unit-testable
- Route handlers become thin: query data → map to ViewModel → render template

---

## Rule 5: Auth Protection

### Problem

It is tempting to assume "GET routes are safe, only POST/PUT/DELETE need auth." This assumption is wrong. Admin GET routes expose sensitive data: user lists, interview transcripts, configuration details, analytics dashboards. Any unauthenticated admin endpoint is a data leak.

### Route Auth Requirements

| Route Type | Requires Auth | Rationale |
|------------|---------------|-----------|
| Admin GET | Yes | Management pages contain sensitive data |
| Admin POST/PUT/DELETE | Yes | Data modification operations |
| Admin API (HTMX endpoints) | Yes | Partial update interfaces |
| Public GET | No | User-facing public pages |

### Wrong: Unprotected GET Routes

```typescript
// admin/routes/plans.ts — ANTI-PATTERN
import { FastifyInstance } from 'fastify';

export async function registerPlanRoutes(fastify: FastifyInstance) {
  // GET route has NO authentication — anyone can view all plans
  fastify.get('/admin/plans', async (req, reply) => {
    const plans = await prisma.plan.findMany();
    return reply.view('admin/plans/list.njk', { plans });
  });

  // Only POST has authentication
  fastify.post('/admin/plans', { onRequest: [authenticateAdmin] }, async (req, reply) => {
    const { name } = req.body as { name: string };
    await prisma.plan.create({ data: { name } });
    return reply.redirect('/admin/plans');
  });
}
```

```typescript
// admin/routes/analytics.ts — insecure API key approach
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function registerAnalyticsRoutes(fastify: FastifyInstance) {
  fastify.get('/admin/analytics', {
    onRequest: [
      // API key in header — prone to leakage, no session context
      async (req: FastifyRequest, reply: FastifyReply) => {
        const apiKey = req.headers['x-api-key'];
        if (apiKey !== process.env.ADMIN_API_KEY) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
      },
    ],
  }, async (req, reply) => {
    const stats = await prisma.plan.aggregate({
      _count: { id: true },
    });
    return reply.view('admin/analytics/dashboard.njk', { stats });
  });
}
```

**Problems:**
- Unauthenticated GET exposes all plan data to anyone who knows the URL
- API key approach lacks audit trail — cannot identify which admin performed an action
- API key in headers is vulnerable to CSRF and man-in-the-middle if not over HTTPS
- Inconsistent auth patterns across routes make security review difficult

### Correct: Unified Cookie/Session Authentication

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

  // Verify the user has Admin role
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { role: true },
  });

  if (user?.role !== 'ADMIN') {
    return reply.code(403).view('admin/errors/forbidden.njk', {
      message: 'You do not have permission to access the admin panel.',
    });
  }

  // Attach user information to the request for downstream use
  req.user = user;
  done();
}
```

```typescript
// admin/routes/admin-shared.ts — register auth globally
import { FastifyInstance } from 'fastify';
import { authenticateAdmin } from '../middleware/authenticate-admin';

export function registerAdminShared(fastify: FastifyInstance) {
  // Apply authentication hook to ALL /admin/* routes
  fastify.addHook('onRequest', authenticateAdmin);
}
```

```typescript
// admin/routes/plans.ts — inherits global auth, NO per-route declaration needed
import { FastifyInstance } from 'fastify';

export async function registerPlanRoutes(fastify: FastifyInstance) {
  // All routes automatically inherit authenticateAdmin from admin-shared.ts
  // No need to repeat { onRequest: [authenticateAdmin] } on every route
  fastify.get('/admin/plans', async (req, reply) => {
    const plans = await prisma.plan.findMany();
    return reply.view('admin/plans/list.njk', { plans });
  });

  fastify.post('/admin/plans', async (req, reply) => {
    const { name } = req.body as { name: string };
    await prisma.plan.create({ data: { name } });
    return reply.redirect('/admin/plans');
  });
}
```

```typescript
// admin/routes/analytics.ts — also protected by global hook
import { FastifyInstance } from 'fastify';

export async function registerAnalyticsRoutes(fastify: FastifyInstance) {
  // GET route is protected by the global authenticateAdmin hook
  fastify.get('/admin/analytics', async (req, reply) => {
    const stats = await prisma.plan.aggregate({
      _count: { id: true },
      _avg: { completionRate: true },
    });
    return reply.view('admin/analytics/dashboard.njk', { stats });
  });
}
```

### Key Design Decisions

1. **Global hook, not per-route** — `admin-shared.ts` registers `authenticateAdmin` as an `onRequest` hook. All routes registered after this point inherit it automatically.
2. **Session-based, not API key** — cookie sessions provide audit trails, automatic expiration, and CSRF protection when configured correctly.
3. **Redirect on unauthenticated, 403 on unauthorized** — users without a session are sent to login; authenticated users without the ADMIN role see a forbidden page.
4. **No exceptions** — every admin route, including GET, passes through the same gate.

### Best Practice

- **Always** register the auth hook in `admin-shared.ts` before any route modules
- **Never** add per-route auth declarations — rely on the global hook
- **Never** use API keys for admin UI authentication — use session cookies
- For HTMX API endpoints under `/admin/api/*`, the same global hook applies — no separate auth needed

---

## Rule 6: HTMX + Alpine Separation

### Problem

HTMX and Alpine.js solve fundamentally different problems. HTMX replaces DOM fragments with server-rendered HTML in response to user actions. Alpine.js manages client-side UI state. When these responsibilities are conflated — Alpine making server requests, HTMX manipulating DOM state directly — the result is code that is hard to reason about, hard to debug, and loses the benefits of server-side rendering.

### Responsibility Matrix

| Functionality | HTMX | Alpine.js |
|---------------|------|-----------|
| Page navigation / URL changes | Yes | No |
| Form submission to server | Yes | No |
| List pagination / search / sort | Yes | No |
| Partial content replacement (`hx-target`) | Yes | No |
| Dropdown toggle | No | Yes |
| Modal show/hide | No | Yes |
| Real-time field validation | No | Yes |
| Toast notification state | No | Yes |
| Button loading state toggle | No | Yes |

### Wrong: Blurred Responsibilities

```nunjucks
{# admin/views/plans.njk — ANTI-PATTERN #}

{# Using Alpine to make server requests — wrong responsibility #}
<div x-data="{ plans: [], loading: false }"
     x-init="loading = true; fetch('/admin/api/plans').then(r => r.json()).then(d => plans = d); loading = false">
  <template x-for="plan in plans" :key="plan.id">
    <div>
      <span x-text="plan.name"></span>
      {# Delete uses Alpine fetch instead of HTMX — loses server rendering #}
      <button @click="fetch('/admin/plans/' + plan.id, { method: 'DELETE' })
        .then(() => plans = plans.filter(p => p.id !== plan.id))">
        Delete
      </button>
    </div>
  </template>
</div>

{# HTMX driving dropdown state — wrong responsibility #}
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

**Problems:**
- `fetch()` in Alpine bypasses the server-rendered template pipeline — responses are raw JSON, not HTML
- Manual DOM manipulation (`element.style.display`) in `hx-on` callbacks bypasses Alpine's reactivity
- No server-side rendering for the plan list — SEO and initial load suffer
- HTMX `hx-on::after-request` manipulating DOM directly defeats the purpose of declarative state management

### Correct: Clean Separation

```nunjucks
{# admin/views/plans.njk #}

{# Full page layout and content list driven by HTMX #}
<div id="plans-content" hx-boost="true">
  <div class="header-bar" x-data="{ showFilters: false }">
    <h1>Interview Plans</h1>

    {# Dropdown toggle managed by Alpine — purely local state #}
    <button type="button" @click="showFilters = !showFilters"
            :class="{ 'active': showFilters }">
      Filters
    </button>

    {# Alpine controls local show/hide #}
    <div x-show="showFilters" x-transition class="filter-panel">
      {# Search input triggers server request via HTMX #}
      <input type="text" name="search" placeholder="Search plans..."
             hx-get="/admin/plans"
             hx-target="#plans-list"
             hx-trigger="keyup changed delay:300ms"
             hx-indicator=".search-spinner" />
    </div>
  </div>

  {# List content fully server-rendered by HTMX #}
  <div id="plans-list">
    {% for plan in plans %}
    <div class="plan-card" id="plan-{{ plan.id }}">
      <h3>{{ plan.name }}</h3>
      <p>Status: {{ plan.status | upper }}</p>
      <p>Completion: {{ plan.completionRate | round(1) }}%</p>

      <div class="actions">
        {# Delete submitted via HTMX, server responds with updated DOM #}
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
{# admin/views/modals/confirm-delete.njk — Modal state managed by Alpine #}

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

      {# Actual delete submitted via HTMX #}
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
{# admin/views/templates/edit.njk — Field-level validation by Alpine #}

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

{# HTMX response result area #}
<div id="form-result"></div>
```

### Cooperation Pattern: HTMX Events + Alpine State

The cleanest integration uses HTMX lifecycle events to set Alpine state, and Alpine state to control what the user sees:

```nunjucks
<button hx-post="/admin/plans/{{ plan.id }}/pause"
        hx-target="#plan-{{ plan.id }}"
        x-data="{ pausing: false }"
        hx-on::before-request="pausing = true"
        hx-on::after-request="pausing = false"
        :disabled="pausing">
  <span x-show="!pausing">Pause</span>
  <span x-show="pausing" class="spinner"></span>
</button>
```

- `x-data` initializes a **local** boolean state
- `hx-on::before-request` sets it to `true` when the server request starts
- `hx-on::after-request` resets it to `false` when the response arrives
- `x-show` toggles between the label and spinner based on Alpine state
- HTMX handles the actual form submission and DOM replacement

### Separation Principles

1. **HTMX is the bridge between server and DOM** — all data changes, navigation, and content updates flow through HTMX attributes (`hx-get`, `hx-post`, `hx-target`, `hx-swap`)
2. **Alpine manages component-local UI state** — toggles, visibility, form validation, loading indicators
3. **HTMX event handlers must not manipulate DOM state** — `hx-on::after-request` should never contain `element.style.display = 'block'`
4. **Alpine methods must not call `fetch()`** — `@click="fetch('/api/...')"` is an anti-pattern; use `hx-get`/`hx-post` instead

### Best Practice

- Start by asking: "Does this need server data?" If yes, use HTMX. If no, use Alpine.
- Alpine `x-data` should never contain `fetch`, `axios`, or any HTTP client
- HTMX `hx-on` handlers should only set Alpine state, never read/write DOM directly
- When in doubt, put the interaction in HTMX and the presentation in Alpine

---

## Summary

These six rules emerged from concrete rework incidents during the interview-bot admin interface development. They are not theoretical best practices — they are hard-won lessons about what goes wrong when admin interfaces are generated without constraints.

| Rule | One-Sentence Principle |
|------|-----------------------|
| 1. Route Splitting | No admin route file exceeds 200 lines |
| 2. Test Consistency | One `createAdminTestApp()` for all admin tests |
| 3. Nunjucks Parentheses | Always parenthesize comparisons before filters |
| 4. View Model Mapper | Extract data transformation at 3+ occurrences |
| 5. Auth Protection | Every admin route inherits global authentication |
| 6. HTMX + Alpine Separation | HTMX talks to server; Alpine manages local state |

These rules are enforced via `skills/admin-template-guidelines/SKILL.md` during the sprint-flow BUILD phase. When generating admin routes, views, or tests, the loaded skill validates each rule and produces an output contract confirming compliance.
