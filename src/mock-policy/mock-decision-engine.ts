import { ProjectScope, MockDecision, MockPolicyConfig, TestLayer, MockPolicyLayerRules } from './types';
import { classifyDependency } from './scope-scanner';

type DecisionFn = (importPath: string, layer: TestLayer, layerRules: MockPolicyLayerRules, scope: ProjectScope) => MockDecision;

function internalDecision(
  importPath: string,
  layer: TestLayer,
  layerRules: MockPolicyLayerRules,
  scope: ProjectScope,
): MockDecision {
  const isImplemented = scope.implementedModules.some(
    mod => importPath === mod || importPath.endsWith('/' + mod) || importPath.startsWith(mod),
  );
  if (isImplemented && layerRules.requireRealForImplemented) {
    return {
      strategy: 'real',
      reason: `Internal and implemented dependency '${importPath}' should use real implementation`,
      layer,
    };
  }
  return {
    strategy: 'mock',
    reason: `Internal dependency '${importPath}' should be mocked for isolation`,
    layer,
  };
}

function externalDecision(
  importPath: string,
  layer: TestLayer,
  layerRules: MockPolicyLayerRules,
): MockDecision {
  if (layerRules.allowExternalMock) {
    return {
      strategy: 'mock',
      reason: `External dependency '${importPath}' should be mocked per policy`,
      layer,
    };
  }
  return {
    strategy: 'real',
    reason: `External dependency '${importPath}' allowed as real (allowExternalMock is disabled)`,
    layer,
  };
}

function pendingDecision(
  importPath: string,
  layer: TestLayer,
  layerRules: MockPolicyLayerRules,
  scope: ProjectScope,
): MockDecision {
  const pendingTicket = scope.unimplementedModules.find(
    mod => importPath === mod || importPath.endsWith('/' + mod) || importPath.startsWith(mod),
  );
  if (layerRules.requirePendingRemoval && pendingTicket) {
    return {
      strategy: 'mock',
      reason: `Pending dependency '${importPath}' must be mocked until implemented`,
      layer,
      pendingRemoval: {
        ticket: pendingTicket,
        reason: `Pending dependency '${importPath}' is not yet implemented; mock will be removed once the real implementation is available`,
      },
    };
  }
  return {
    strategy: 'mock',
    reason: `Pending dependency '${importPath}' should be mocked (not yet implemented)`,
    layer,
  };
}

function unknownDecision(importPath: string, layer: TestLayer): MockDecision {
  return {
    strategy: 'mock',
    reason: `Unknown dependency '${importPath}' should be mocked for safety`,
    layer,
  };
}

/**
 * Determines whether a given dependency should be mocked or used as-is
 * for a specific test layer, based on the project scope and policy configuration.
 *
 * Decision matrix:
 * - **e2e**: Always returns `real` — no mocks in end-to-end tests.
 * - **unit** with `lenient` policy: Always returns `mock` for all dependencies.
 * - **unit** with `strict` policy: Applies integration-like rules.
 * - **integration**: Applies rules based on dependency scope and policy flags.
 */
/** Whether a unit layer is configured to mock everything. */
function isLenientUnit(layer: TestLayer, layerRules: MockPolicyLayerRules): boolean {
  return layer === 'unit' && layerRules.mockPolicy === 'lenient';
}

/**
 * The decision a lenient unit layer settles by itself.
 *
 * Policy, not a property of the import: in a lenient layer EVERY dependency should be
 * mocked, so the import never needs classifying.
 */
function lenientDecision(layer: TestLayer): MockDecision {
  return {
    strategy: 'mock',
    reason: 'Unit tests with lenient policy: all dependencies should be mocked',
    layer,
  };
}


class MockDecisionEngine {
  private readonly scope: ProjectScope;
  private readonly config: MockPolicyConfig;
  private readonly projectRoot: string;

  constructor(scope: ProjectScope, config: MockPolicyConfig, projectRoot?: string) {
    this.scope = scope;
    this.config = config;
    this.projectRoot = projectRoot || process.cwd();
  }

  /**
   * Decide the mock strategy for a given import path in the specified test layer.
   *
   * @param importPath - The dependency import path to evaluate
   * @param layer - The test layer (unit, integration, or e2e)
   * @returns A MockDecision with strategy, reason, and optional pending removal info
   */
  decide(importPath: string, layer: TestLayer): MockDecision {
    if (layer === 'e2e') {
      return {
        strategy: 'real',
        reason: `E2E tests must use real dependencies; no mocks allowed in ${layer} layer`,
        layer,
      };
    }

    const layerRules = this.config.layers[layer === 'unknown' ? 'unit' : layer];

    if (isLenientUnit(layer, layerRules)) return lenientDecision(layer);

    const depScope = classifyDependency(
      importPath,
      this.scope,
      {
        projectRoot: this.projectRoot,
        imports: [importPath],
        boundary: this.config.projectBoundary,
      },
    );

    const decider: Record<string, DecisionFn> = {
      internal: internalDecision,
      external: externalDecision,
      pending: pendingDecision,
    };

    const handler = decider[depScope];
    if (handler) {
      return handler(importPath, layer, layerRules, this.scope);
    }

    return unknownDecision(importPath, layer);
  }
}

export default MockDecisionEngine;
