# SRC/MOCK-POLICY KNOWLEDGE BASE

**Generated:** 2026-07-22
**Commit:** e331f2c
**Branch:** main
**Version:** 0.14.24.0

## OVERVIEW
Mock layering policy enforcement — Gate M3 of pre-push hook. Ensures integration tests use real implementations for internal dependencies, mock external dependencies, and annotate pending mocks with removal plans. Combines project scope scanning, mock decision engine, and per-file validation into a single pipeline.

## STRUCTURE
```
src/mock-policy/
├── types.ts                    # Type definitions (MockStrategy, ProjectScope, MockDecision, etc.)
├── schema.ts                   # Zod schema for MockPolicyConfig validation
├── config.ts                   # loadMockPolicyConfig — loads from .mockpolicyrc / .xp-gate/mock-policy.yaml
├── scope-scanner.ts            # scanProjectScope — classifies imports as internal/external/pending
├── mock-decision-engine.ts     # MockDecisionEngine — decides mock vs real per import + test layer
├── gate-m3.ts                  # runGateM3 — orchestrator: filter test files → scan scope → validate
└── __tests__/
    ├── config.test.ts          # Config loader unit tests
    ├── scope-scanner.test.ts   # Scope scanner unit + tmpdir integration tests
    ├── mock-decision-engine.test.ts  # Decision engine unit tests
    └── integration.test.ts     # Full pipeline integration test
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Types/Interfaces | types.ts | MockStrategy, ProjectScope, MockPolicyConfig, MockPolicyResult |
| Config loading | config.ts | .mockpolicyrc (JSON) > .xp-gate/mock-policy.yaml (YAML) > DEFAULT_CONFIG |
| Schema validation | schema.ts | Zod schema for full config validation |
| Scope scanning | scope-scanner.ts | scanProjectScope, classifyDependency, isExternalImport, loadExternalDependencies |
| Mock decisions | mock-decision-engine.ts | MockDecisionEngine.decide() — decision matrix per test layer |
| Gate runner | gate-m3.ts | runGateM3, validateFile, collectImports, detectMockUsage |
| Integration tests | __tests__/integration.test.ts | End-to-end pipeline with temp project directories |

## CODE MAP
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| runGateM3 | Function | gate-m3.ts | Orchestrator: filter test files → scan scope → validate → return MockPolicyResult |
| validateFile | Function | gate-m3.ts | Per-file validation: read content → detect layer → check imports → compare decision vs usage |
| collectImports | Function | gate-m3.ts | Regex-based import extraction (static + dynamic) |
| detectMockUsage | Function | gate-m3.ts | Checks for vi.mock/jest.mock/vi.doMock calls matching an import |
| MockDecisionEngine | Class | mock-decision-engine.ts | decide(importPath, layer) → MockDecision with strategy/reason/pendingRemoval |
| scanProjectScope | Function | scope-scanner.ts | Classifies imports into implemented/unimplemented/external |
| classifyDependency | Function | scope-scanner.ts | Single dependency scope classification with optional existCache |
| isExternalImport | Function | scope-scanner.ts | Checks Node.js builtins, bare npm packages, boundary patterns |
| loadExternalDependencies | Function | scope-scanner.ts | Reads package.json dependencies (skips workspace:* protocol) |
| loadMockPolicyConfig | Function | config.ts | Config loader with fallback chain and Zod validation |
| detectTestLayer | Function | src/mutation/detect-ai-test.ts | Classifies test file path as unit/integration/e2e/unknown |

## CONVENTIONS
- Decision matrix: e2e=always real, unit(lenient)=always mock, unit(strict)=integration-like, integration=scope-based
- Pending dependencies in integration tests require `@mock-justified` annotation
- Default severity: `warning` (does NOT block push)
- Default boundary: `['src/**']`
- Default integration policy: strict, requireRealForImplemented=true, allowExternalMock=true, requirePendingRemoval=true
- Default e2e policy: strict, allowExternalMock=false, maxMockDensity=0
- Unit tests with lenient policy are not checked — all mocks allowed
- Config resolution: `.mockpolicyrc` (JSON) > `.xp-gate/mock-policy.yaml` (YAML) > `DEFAULT_CONFIG`
- Config validated via Zod schema before use

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT use `as any` or `@ts-ignore` in mock-policy code
- Do NOT set severity to `error` without verifying integration test suite
- Do NOT disable mock checks entirely by setting zero thresholds
- Do NOT import from `gate-m3.ts` private functions — they are deliberately not exported

## UNIQUE STYLES
- Gate M3 is the third pre-push gate (after Gate M mutation + Gate M2 AI test detection)
- Pipeline: filterTestFiles → loadConfig → collectAllImports → scanProjectScope → MockDecisionEngine → validateFile per file → aggregate violations
- Uses real filesystem for scope scanning (no virtual filesystem abstraction)
- Integration tests use tmpdir with real package.json + source files
- Test layer detection delegates to `src/mutation/detect-ai-test.ts`

## COMMANDS
```bash
# Run Gate M3 directly on changed files
npx tsx src/mock-policy/gate-m3.ts <test-file-1> <test-file-2> ...

# Run all mock-policy unit tests
npx vitest run src/mock-policy/__tests__/

# Run just the integration test
npx vitest run src/mock-policy/__tests__/integration.test.ts
```

## NOTES
- Gate M3 is invoked by pre-push hook after Gate M (mutation) and Gate M2 (AI test detection)
- push limits: max 20 files or 500 LOC per push — Gate M3 respects this via the changed files input
- Coverage exclude: src/mock-policy/ controlled by vitest config
- The integration test creates real temporary directories under os.tmpdir()
- Dependencies on: `src/mutation/detect-ai-test.ts` (detectTestLayer)
