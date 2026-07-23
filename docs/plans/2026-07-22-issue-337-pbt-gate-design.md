# #337: Property-Based Testing Gate

## 问题

当前 xp-gate 不检查项目是否使用了 property-based testing (PBT)。PBT 能发现传统示例测试无法覆盖的边界条件 bug，但许多项目完全没有采用。

## 设计方案

### 策略：检测 + 报告（不强制 BLOCK）

作为分析工具，检测项目中 PBT 的使用情况并输出报告。

#### Step 1: `src/gates/pbt-detect.ts`

检测 PBT 使用情况：

```typescript
interface PBTReport {
  detected: boolean;
  frameworks: string[];  // fast-check, jsverify, property-based, etc.
  testFiles: string[];   // files using PBT
  coverage: number;      // % of test files using PBT
  messages: string[];
}
```

检测逻辑：
1. 扫描测试文件中的 PBT 框架 import（`fast-check`、`jsverify`、`jsc`）
2. 统计使用 PBT 的测试文件占比
3. 输出报告

#### Step 2: CLI 路由

gate-runner.js 添加 `pbt` 别名。

#### Step 3: 测试

验证 PBT 框架检测、文件扫描、报告生成。

### 不做的事

1. 不强制 BLOCK（PBT 不是所有项目都适用）
2. 不自动生成 property 测试
3. 不修改现有测试框架
