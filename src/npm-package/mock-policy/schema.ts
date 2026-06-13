import { z } from 'zod';

export const MockPolicyLayerRulesSchema = z.object({
  mockPolicy: z.enum(['strict', 'lenient']),
  requireRealForImplemented: z.boolean(),
  allowExternalMock: z.boolean(),
  requirePendingRemoval: z.boolean(),
  maxMockDensity: z.number().min(0).max(100).optional(),
});

export const MockPolicyConfigSchema = z.object({
  version: z.literal(1),
  layers: z.object({
    unit: MockPolicyLayerRulesSchema,
    integration: MockPolicyLayerRulesSchema,
    e2e: MockPolicyLayerRulesSchema,
  }),
  projectBoundary: z.array(z.string()).min(1),
  severity: z.enum(['error', 'warning']),
});

export type MockPolicyConfig = z.infer<typeof MockPolicyConfigSchema>;
