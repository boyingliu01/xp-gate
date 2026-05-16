# Gate M — Mutation Testing Quality Gate (Pre-Push)

**Issue**: #21 后续改进 — 从 CI-only 升级为 pre-push 阻断
**Date**: 2026-05-16 (Revised after Delphi Round 1)
**Priority**: P0
**Status**: REVISED (待 Delphi Round 2)

---

## 1. 修订说明 (Round 1 → Round 2)

### Round 1 关键反馈及修复

| 反馈 | 严重度 | 修复方案 |
|------|--------|---------|
| Stryker 5-10s 假设不成立 | Critical | **移至 pre-push**（预算 2min），pre-commit 只保留轻量检查 |
| timeoutMS 是 per-test 不是 total | Critical | 使用外部 `timeout` 命令控制总执行时间 |
| dry-run 降级误解 | Critical | **移除 dry-run 降级**，超时直接 warning 允许 push |
| baseline 在 git 导致合并冲突 | Critical | baseline **不存 git**，改为 `.gitignore` + CI 生成 + 本地缓存 |
| pre-commit 30s 违反性能契约 | Critical | Gate M 仅在 **pre-push** 运行 |
| AI 检测 heuristic 不可靠 | Major | 简化：显式 `@mutation-threshold: XX` 注解替代 heuristic |
| 缺少 source-to-test 映射 | Major | 使用文件命名约定自动映射 |
| 三级 threshold 过度设计 | Major | 改为 **两级**：默认 60%，关键路径 80% |
| Gate 8 编号与现有架构冲突 | Major | 重命名为 **Gate M**（Mutation），避免编号冲突 |

---

## 2. 问题陈述

### 2.1 当前状态

XGate v0.1.0 已实现基于 Stryker 的变异测试（CI-only），但：
- **pre-commit/pre-push 不触发** — 开发者本地提交时无法感知测试有效性
- **Gate 5 只管覆盖率** — `coverage ≥ 80%` 但 mutation score 可能只有 20%
- **AI 生成测试过度 mock** — 覆盖率虚高，实际 bug 检测能力极低

### 2.2 核心痛点

> **覆盖率 98% + 测试全通过 ≠ 测试有效**

| 场景 | Gate 5 结果 | 实际 bug 检测率 | 用户体验 |
|------|------------|----------------|---------|
| AI 生成测试，大量 mock | ✅ PASS (coverage 98%) | ~20% (KeelCode 2026) | "质量门禁全过，但上线后 bug" |
| 人工编写，合理测试 | ✅ PASS (coverage 85%) | ~65% | 正常 |

### 2.3 目标

1. **pre-push 阻断低质量测试** — mutation score 不达标，不能 push
2. **区分关键路径 vs 普通代码** — 核心逻辑门槛更高
3. **验证测试意图** — 测试必须有 `@test/@intent/@covers` 注解
4. **渐进升级** — 不阻塞现有代码，只卡新增/修改

---

## 3. 设计总览

### 3.1 门禁架构（修订后）

```
Pre-commit（6 道，<10s 总计）:
Gate 1: Code Quality (Static + Lint)
Gate 2: Duplicate Code
Gate 3: Cyclomatic Complexity
Gate 4: Clean Code + SOLID
Gate 5: Tests + Coverage (≥80%)
Gate 6: Architecture + Boy Scout Rule

Pre-push（3 道，<3min 总计）:
Gate P1: Commit size check (20 files / 500 LOC)  ← 现有
Gate P2: Delphi code walkthrough  ← 现有
Gate M: Mutation Testing  ← 新增（2min 预算）
```

**为什么 pre-push 而非 pre-commit？**
- Pre-commit 预算 <10s（6 个 gate 分摊），Stryker 最少 30s-2min
- Pre-push 预算 2-3min，可以接受 Stryker 执行时间
- Push 频率远低于 commit（10:1 到 50:1），性能影响可控
- 仍能在代码进入远程前拦截，比 CI-only 更早

### 3.2 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| pre-commit vs pre-push | **pre-push** | Stryker 执行时间 30s-2min，超出 pre-commit 预算 |
| 全量 vs 增量 | **增量**（push 涉及的文件） | 只对即将 push 的文件跑，速度可控 |
| 实际变异 vs 近似 | **实际变异**（Stryker） | 近似算法不可靠，必须用真实变异 |
| baseline 存储 | **本地缓存 + CI 生成** | 不存 git，避免合并冲突 |
| 超时处理 | **warning，允许 push** | 不阻断，但提示开发者本地跑全量 |
| threshold 分级 | **两级**（默认 60%，关键 80%） | 简化，减少误判和博弈空间 |

---

## 4. 详细设计

### 4.1 Gate M 执行流程

```
pre-push 触发 Gate M:

1. 收集即将 push 的 .ts 文件（排除 *.test.ts, *.d.ts, adapters/）
   └─ 如果没有变更源文件 → SKIP

2. 测试意图检查（轻量，<1s）
   └─ 检查对应测试文件是否有 @test + @intent + @covers
   └─ 缺少注解 → warning（不阻断 push）

3. 判断 threshold 级别
   └─ 检查文件路径是否匹配 .mutation-critical-paths
   └─ 匹配 → 80%，否则 → 60%
   └─ 测试文件可显式声明：@mutation-threshold: 75

4. 获取 baseline（本地缓存）
   └─ 读取 .mutation-baseline.json（.gitignore，本地生成）
   └─ 如果不存在 → 使用绝对 threshold（不对比 baseline）

5. 运行增量变异测试（带总超时）
   └─ timeout 120s npx stryker run --mutate <changed-files>
   └─ 使用独立配置：stryker.prepush.conf.json

6. 对比结果
   └─ 新文件：score ≥ threshold
   └─ 修改文件：score ≥ baseline（不能下降）
   └─ 低于 threshold → BLOCK push

7. 超时处理（>120s）
   └─ 中断 Stryker，输出 warning
   └─ ⚠️ Mutation testing timed out (>120s). Push allowed.
      Run `npm run test:mutation` locally for full report.
   └─ 不阻断 push
```

### 4.2 Threshold 设计

| 级别 | Threshold | 适用场景 |
|------|-----------|---------|
| 默认 | **≥ 60%** | 普通业务代码 |
| 关键路径 | **≥ 80%** | 核心逻辑（auth, payment, encryption 等） |
| 显式声明 | **按注解** | 测试文件写 `@mutation-threshold: 75` |

**渐进升级计划：**

| Phase | 时间 | 默认 Threshold | 关键路径 |
|-------|------|---------------|---------|
| Phase 1 | Week 1-2 | 50% | 70% |
| Phase 2 | Week 3-4 | 60% | 80% |
| Phase 3 | Month 2+ | 70% | 85% |

### 4.3 Baseline 机制（修订后）

**文件**：`.mutation-baseline.json`（**`.gitignore`**，不提交到版本控制）

```json
{
  "version": "1.0",
  "generatedAt": "2026-05-16T10:00:00Z",
  "source": "local|ci",
  "scores": {
    "src/principles/analyzer.ts": {
      "score": 65.2,
      "mutants": 120,
      "killed": 78,
      "survived": 42
    }
  }
}
```

**初始化方式（三选一，项目自选）：**

| 方式 | 命令 | 适用场景 |
|------|------|---------|
| 本地初始化 | `npm run mutation:baseline:init` | 小型项目（<50 文件） |
| 从 CI 下载 | `npm run mutation:baseline:download` | 中大型项目，CI 已跑过全量 |
| 跳过 baseline | 不运行初始化 | 仅对新文件检查 threshold |

**更新规则：**
- 修改文件：score 不能低于 baseline（只能持平或上升）
- 新文件：按 threshold 要求
- 删除文件：从 baseline 移除
- 每次成功 push 后自动更新本地 baseline

**CI 集成：**
- CI 跑完全量 mutation testing 后，上传 baseline 作为 artifact
- 开发者可下载最新 baseline：`npm run mutation:baseline:download`

### 4.4 Source-to-Test 映射

```typescript
function findTestFile(sourceFile: string): string | null {
  // 约定 1: 同级目录 *.test.ts
  const testFile1 = sourceFile.replace(/\.ts$/, '.test.ts');
  if (exists(testFile1)) return testFile1;
  
  // 约定 2: __tests__ 目录
  const dir = dirname(sourceFile);
  const basename = sourceFile.replace(dir + '/', '').replace(/\.ts$/, '');
  const testFile2 = `${dir}/__tests__/${basename}.test.ts`;
  if (exists(testFile2)) return testFile2;
  
  // 约定 3: 通过 @covers 注解反向查找
  // 扫描所有 test 文件的 @covers 注解
  
  return null;
}
```

### 4.5 关键路径配置

文件：`.mutation-critical-paths`（项目根目录，可选）

```
# 每行一个 glob 模式（minimatch 语法）
src/auth/**/*.ts
src/payment/**/*.ts
src/encryption/**/*.ts
```

匹配的文件使用 **80%** threshold。

### 4.6 超时处理（修订后）

```bash
# 使用 Linux/Unix timeout 命令控制总执行时间
timeout 120s npx stryker run --config stryker.prepush.conf.json

EXIT_CODE=$?

if [ $EXIT_CODE -eq 124 ]; then
  # timeout 命令退出码 124 = 超时
  echo "⚠️ Mutation testing timed out (>120s). Push allowed."
  echo "   Run 'npm run test:mutation' locally for full report."
  exit 0  # 不阻断 push
fi
```

**为什么 120s：**
- 小型 commit（1-3 文件）：30-60s
- 中型 commit（5-10 文件）：60-90s
- 大型 commit（10+ 文件）：可能超时 → warning

### 4.7 Stryker 配置分离

**CI 全量配置**：`stryker.conf.json`（已有）
**Pre-push 增量配置**：`stryker.prepush.conf.json`（新增）

```json
// stryker.prepush.conf.json
{
  "extends": "./stryker.conf.json",
  "timeoutMS": 10000,
  "timeoutFactor": 2.0,
  "reporters": ["clear-text", "json"],
  "jsonReporter": {
    "fileName": ".stryker-report.json"
  }
}
```

**关键区别：**
- `timeoutMS: 10000`（per-test 10s，比 CI 更宽松）
- `reporters` 只有 clear-text + json（无 HTML，减少 IO）
- 输出到临时文件 `.stryker-report.json`（不污染项目目录）

### 4.8 与现有系统的集成

**与 Gate 5 的关系：**
- Gate 5（pre-commit）：管 `coverage ≥ 80%` + 测试全通过
- Gate M（pre-push）：管 `mutation score ≥ threshold`
- 两者独立，互补

**与 test-specification-alignment skill 的关系：**
- Gate M 的"测试意图检查"复用该 skill 的注解规范
- 完整的 test-spec-alignment 仍在 Phase 3 运行

**与 CI mutation testing 的关系：**
- Pre-push Gate M：增量、快速、阻断 push
- CI mutation testing：全量、完整报告、历史趋势
- 两者互补

---

## 5. 文件清单

### 5.1 新增文件

| 文件 | 说明 |
|------|------|
| `src/mutation/gate-m.ts` | Gate M 主逻辑（增量变异 + baseline 对比 + 阈值检查） |
| `src/mutation/init-baseline.ts` | 本地初始化 baseline 脚本 |
| `src/mutation/update-baseline.ts` | push 成功后更新本地 baseline |
| `src/mutation/types.ts` | 类型定义 |
| `stryker.prepush.conf.json` | Pre-push 专用 Stryker 配置 |
| `.mutation-critical-paths` | 关键路径配置（可选） |

### 5.2 修改文件

| 文件 | 修改内容 |
|------|---------|
| `githooks/pre-push` | 在 Delphi code walkthrough 后增加 Gate M 调用 |
| `githooks/adapter-common.sh` | 增加 `detect_mutation_testable` 函数 |
| `package.json` | 增加 `mutation:baseline:init` / `mutation:baseline:download` 脚本 |
| `.gitignore` | 增加 `.mutation-baseline.json` |
| `README.md` | 更新门禁表格，加入 Gate M |
| `docs/plans/2026-05-04-mutation-testing-gate10.md` | 标记为 superseded |

---

## 6. Acceptance Criteria

| ID | Given | When | Then |
|----|-------|------|------|
| AC-01 | 新文件 mutation score = 65% | pre-push Gate M 运行 | ✅ PASS（≥60%） |
| AC-02 | 新文件 mutation score = 55% | pre-push Gate M 运行 | ❌ BLOCK push（<60%） |
| AC-03 | 关键路径文件 score = 75% | pre-push Gate M 运行 | ❌ BLOCK push（<80%） |
| AC-04 | 修改文件，baseline score = 60%，新 score = 58% | pre-push Gate M 运行 | ❌ BLOCK push（低于 baseline） |
| AC-05 | 修改文件，baseline score = 60%，新 score = 62% | pre-push Gate M 运行 | ✅ PASS |
| AC-06 | 大 commit（>10 文件），Stryker 超时 | pre-push Gate M 运行 | ⚠️ Warning，允许 push |
| AC-07 | 测试文件缺少 @intent 注解 | pre-push Gate M 运行 | ⚠️ Warning，不阻断 |
| AC-08 | 没有变更源文件 | pre-push Gate M 运行 | ✅ SKIP |
| AC-09 | 首次启用，无 baseline | 运行 `npm run mutation:baseline:init` | 生成 `.mutation-baseline.json`（gitignored） |
| AC-10 | 显式声明 threshold | 测试文件写 `@mutation-threshold: 75`，score = 70% | ❌ BLOCK push（<75%） |

---

## 7. 性能预估

| 场景 | 文件数 | 预估 mutants | 预估时间 | 结果 |
|------|--------|-------------|---------|------|
| 单文件修改 | 1 | ~50 | 15-30s | ✅ 正常通过 |
| 小功能（3-5 文件） | 4 | ~200 | 45-90s | ✅ 正常通过 |
| 中等 commit（10 文件） | 10 | ~500 | 90-120s | ⚠️ 可能超时 |
| 大 commit（20+ 文件） | 20 | ~1000 | >120s | ⚠️ 超时 warning |

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 大 commit 频繁超时 | 开发者忽略 warning | 超时只 warning 不阻断；CI 仍跑全量 |
| baseline 本地缺失 | 无法对比 regression | 首次使用时提示运行 init；支持从 CI 下载 |
| Stryker 配置错误 | Gate M 完全失效 | 独立 stryker.prepush.conf.json，与 CI 配置分离 |
| 旧项目首次启用 | 大量文件低于 threshold | baseline 初始化时记录当前分数，只卡不下降 |
| pre-push 时间变长 | 开发者体验下降 | Push 频率低（vs commit），2min 预算可接受 |

---

## 9. 依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| `@stryker-mutator/core` | ^8.7.1 | 变异测试引擎 |
| `@stryker-mutator/typescript-checker` | ^8.7.1 | TypeScript 类型检查 |
| `@stryker-mutator/vitest-runner` | ^8.7.1 | Vitest 测试运行器 |
| `minimatch` | ^9.x | glob 模式匹配（关键路径） |

---

## 10. 评审历史

| Round | Expert A | Expert B | 结果 |
|-------|----------|----------|------|
| 1 | REQUEST_CHANGES | REQUEST_CHANGES | 关键问题：pre-commit 性能、baseline 合并冲突、timeout 误解、dry-run 误解 |
| 2 | **APPROVED** (confidence: 7) | **APPROVED** (confidence: 7) | 所有 Critical Issues 已解决，遗留 minor/major concerns 可在实现期处理 |

### Round 1 → Round 2 修复清单

| 反馈 | 修复 |
|------|------|
| Stryker 太慢不适合 pre-commit | **移至 pre-push** |
| timeoutMS 是 per-test 不是 total | 使用外部 `timeout` 命令 |
| dry-run 降级误解 | **移除 dry-run 降级**，超时直接 warning |
| baseline 在 git 导致合并冲突 | **baseline 不存 git**，本地缓存 + CI 生成 |
| AI 检测 heuristic 不可靠 | 替换为显式 `@mutation-threshold` 注解 |
| 三级 threshold 过度设计 | 简化为**两级**（默认 60%，关键 80%） |
| Gate 8 编号冲突 | 重命名为 **Gate M** |
| 缺少 source-to-test 映射 | 添加文件命名约定映射逻辑 |

### Round 2 遗留问题（实现期解决）

| 来源 | 问题 | 严重程度 | 建议 |
|------|------|---------|------|
| Expert B | 本地 baseline 跨开发者发散 | Major | CI 发布 canonical baseline，本地作为缓存 |
| Expert B | Source-to-test 映射未集成到 Stryker config | Major | 在 `stryker.prepush.conf.json` 中配置 `coverageAnalysis: "perTest"` |
| Expert B | "成功 push 后更新 baseline" 无对应 git hook | Major | 改为 pre-push 末尾更新（测试通过后、push 执行前） |
| Expert A | Source-to-test 映射文档未指定 | Minor | 明确约定：`foo.ts` → `foo.test.ts` 或 `__tests__/foo.test.ts` |
| Expert A | Stryker config "extends" 机制未定义 | Minor | 使用 JS 配置文件或自定义 merge 脚本 |
| Expert A | 关键路径匹配规则未定义 | Minor | 明确为 minimatch glob 模式，一行一个 |
| Expert A | 120s 超时可能导致 warn 疲劳 | Minor | 监控超时率，必要时调大到 180s |
| Expert B | 测试意图检查与 Gate M 职责重叠 | Minor | 保留但降低优先级，后续可考虑移至 Gate 5 |

---

**Delphi 评审状态**: ✅ **APPROVED** (Round 2 共识)

**Next Step**: 生成 specification.yaml → 实施 → test-specification-alignment 验证
