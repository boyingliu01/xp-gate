# #359: 分层测试防护网 (Test Layer Analytics)

## 问题

当前 Gate 5 只检查整体覆盖率 ≥80%，不区分测试层级。用户无法快速了解：
- 有多少源文件有对应测试？
- 集成测试/E2E 测试覆盖了多少模块？
- 测试分层分布是否健康？

## 设计方案（修订版 — 定位为报告/分析工具）

### 核心变更

1. **不创建新 gate**：作为 `xp-gate check test-layers` CLI 命令，输出分析报告
2. **不 BLOCK**：所有层级均为 INFO/WARNING，不阻断 commit/push
3. **渐进式**：先实现 Layer 1 统计，验证价值后再扩展

### 实现

#### Step 1: `src/gates/test-layers.ts`

```typescript
interface TestLayerReport {
  summary: { totalSources: number; totalTests: number; unitTests: number; integrationTests: number; e2eTests: number };
  layer1: { pairedSources: number; unpairedSources: string[]; pairRate: number };
  layer2: { integrationFiles: number; crossModuleCount: number };
  layer3: { e2eFiles: number; scenarioCount: number };
  verdict: 'INFO';
  messages: string[];
}
```

核心逻辑：
1. 扫描 `src/` 目录，排除 .d.ts、types.ts、index.ts、__tests__/
2. 对每个源文件检查是否存在配对测试（复用 Gate M 的命名约定）
3. 统计 integration/e2e 测试文件数
4. 输出分层统计报告

#### Step 2: CLI 路由

gate-runner.js 添加 `test-layers` 别名。

#### Step 3: 测试

验证源文件扫描、配对检测、排除规则。

### 不做的事

1. 不 BLOCK commit/push
2. 不修改 Gate 5/M2/M3
3. 不强制集成测试或 E2E 测试存在
4. 不做跨模块 import 分析（v2 考虑）
