# 分层自动化测试防护网设计文档

**Issue**: #359
**日期**: 2026-07-21
**状态**: APPROVED (Delphi consensus 3/3)

---

## 1. 问题陈述

当前 Gate 5 对测试覆盖率有统一要求（≥80%），但不区分测试层级。LLM 生成测试时为达覆盖率大量使用 mock，导致：
- 覆盖率数字高但端到端流程未打通
- 集成/端到端场景频繁卡壳、返工
- "高覆盖率 ≠ 高质量" 的假象

**核心目标**: 快速达成高质量结果。测试覆盖率是附带结果，不是目标。

## 2. 设计原则

> 单元测试和接口测试关注**零件和组件的质量**，端到端测试关注**整机的质量**。

| 层级 | 关注点 | Mock 策略 | 核心指标 |
|------|--------|----------|---------|
| Unit | 函数级实现质量 | 允许 mock 外部依赖 | 运行效率 + 逻辑正确性 |
| Integration | 接口级实现质量 | 接口外可 mock，接口内禁 mock | 接口契约 + 数据流转 |
| E2E | 系统流程贯通 | 系统内禁 mock，系统外可 mock | 流程能否跑通 |

## 3. 现有基础设施（已具备）

| 组件 | 位置 | 已有能力 |
|------|------|---------|
| TestLayer 类型 | `src/mock-policy/types.ts` | `'unit' \| 'integration' \| 'e2e' \| 'unknown'` |
| detectTestLayer() | `src/mutation/detect-ai-test.ts` | 基于文件路径模式检测 |
| MockPolicyConfig | `src/mock-policy/config.ts` | 三层独立规则 |
| Gate M3 | `src/mock-policy/gate-m3.ts` | 分层 mock 策略验证 |
| Mock 密度检测 | `src/mutation/detect-ai-test.ts` | mockCount/testLines 比率 |

## 4. 需要新增的能力

### 4.1 `@test-type` 注解规范（注解优先，路径回退）

**变更**: 扩展 `detectTestLayer()` 支持显式注解检测，注解优先级高于路径推断。

```typescript
// 新增: JSDoc/行注释注解检测
const TEST_TYPE_ANNOTATION = /@test-type\s+(unit|integration|e2e)/i;

// 检测优先级:
// 1. @test-type 注解（显式声明）
// 2. 文件路径模式（现有逻辑，作为回退）
// 3. 'unknown'（无法判定）
```

**强制规则**: 新测试文件（pre-commit staged）必须有 `@test-type` 注解 → BLOCK。旧文件不追溯。

**影响文件**: `src/mutation/detect-ai-test.ts`

### 4.2 分层测试统计报告器

**变更**: 新增 `src/test-layers/layered-test-reporter.ts`，按层统计测试文件分布。

```typescript
interface LayeredTestReport {
  unit: { testFiles: number; mockDensity: number };
  integration: { testFiles: number; mockDensity: number };
  e2e: { testFiles: number; mockDensity: number };
  unknown: { testFiles: number };
  total: { testFiles: number; layerDistribution: Record<TestLayer, number> };
}
```

**功能**:
- 扫描测试文件，按 `@test-type` 注解或路径模式分类
- 统计每层的测试文件数量和 mock 密度
- 输出分层统计报告（可观测性，不作为 BLOCK 条件）

**注意**: 不做源代码覆盖率分层聚合（实现复杂度高，覆盖率数据源不含测试→源文件映射）。

### 4.3 E2E 流程贯通验证

**变更**: 新增 `src/mock-policy/e2e-flow-validator.ts`。

```typescript
interface E2EFlowResult {
  status: 'pass' | 'fail' | 'skip';
  totalE2EFiles: number;
  filesWithInternalMocks: string[];  // 违规文件
}
```

**逻辑**: 对 E2E 层测试文件，检查是否存在对系统内模块的 mock（使用 `scope-scanner.ts` 的 `isExternalImport` 判断），存在则 FAIL。无 E2E 测试文件时 → skip（不产生噪音）。

### 4.4 Gate 分层集成

**职责划分**:
| Gate | 职责 | 阶段 |
|------|------|------|
| Gate 5 | `@test-type` 注解校验（新文件 BLOCK）+ E2E mock 检查 | pre-commit |
| Gate M2/M3 | mock 密度分层管控（已有能力） | pre-push |
| 分层统计报告 | 测试层级分布可观测性 | pre-push |

**Gate 5 增强**:
- 5a. 现有: 新 .ts/.tsx 文件必须有测试 (BLOCK)
- 5b. 新增: 新测试文件必须有 `@test-type` 注解 (BLOCK)
- 5c. 新增: E2E 测试中系统内依赖不可 mock (WARNING, Phase 1)

### 4.5 测试分层标注规范文档

**变更**: 新增 `docs/test-layer-annotation-guide.md`，定义标注规范。

## 5. 实现策略：渐进式落地

### Phase 1: 框架建立（本次 Sprint）
- 扩展 `detectTestLayer()` 支持 `@test-type` 注解
- 新增分层测试统计报告器（`src/test-layers/layered-test-reporter.ts`）
- 新增 E2E 流程贯通验证器（`src/mock-policy/e2e-flow-validator.ts`）
- Gate 5 集成注解校验（pre-commit, BLOCK）+ E2E mock 检查（pre-commit, WARNING）
- 分层统计报告（pre-push, 可观测性）
- 标注规范文档

### Phase 2: 阈值强化（后续 Sprint）
- E2E mock 检查从 WARNING 升级为 BLOCK
- 与 Gate M2/M3 联动增强
- 配置化分层阈值

## 6. REQ 拆分

| REQ | 描述 | 优先级 | 依赖 |
|-----|------|--------|------|
| REQ-001 | `@test-type` 注解检测 | critical | 无 |
| REQ-002 | 分层测试统计报告器 | critical | REQ-001 |
| REQ-003 | E2E 流程贯通验证器 | high | REQ-001 |
| REQ-004 | Gate 5 分层集成 | high | REQ-001, REQ-003 |
| REQ-005 | 分层标注规范文档 | low | 无 |

## 7. 测试策略

- **单元测试**: 每个新模块的函数级测试，允许 mock
- **接口测试**: 模块间集成测试（如 detectTestLayer → reporter），接口内不 mock
- **端到端测试**: 完整 Gate 5 流程测试，系统内不 mock

## 8. 验收标准

- [ ] `detectTestLayer()` 识别 `@test-type` 注解，优先级高于路径推断
- [ ] 新测试文件无 `@test-type` 注解 → pre-commit BLOCK
- [ ] 分层测试统计报告器输出 unit/integration/e2e 分布
- [ ] E2E 流程贯通验证器检测系统内 mock 违规（Phase 1 WARNING）
- [ ] Gate 5 集成注解校验
- [ ] 标注规范文档完成
