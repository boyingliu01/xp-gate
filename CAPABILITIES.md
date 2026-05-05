# XGate Capability Matrix

**XGate** 是一套 AI 驱动的开发工作流工具集，提供 6 道质量门禁和多专家评审机制，确保代码提交前的自动化验证和设计决策的共识达成。

---

## 1. Overview

XGate 整合质量门禁、AI 多专家评审和 Sprint 流程编排三大核心模块。质量门禁在每次 `git commit` 时自动运行 6 项检查，任何失败都会阻止提交。Delphi Review 采用多轮匿名评审机制，直到所有专家达成共识（≥91%）。Sprint Flow 提供一键式完整开发流程编排，从需求探索到发布部署全程自动化。

---

## 2. Capability Matrix

| 维度 | 能力 | 状态 | 详情 |
|------|------|------|------|
| **质量门禁** | 静态分析 | ✅ 完全支持 | Gate 1: tsc/ESLint/Ruff/golangci-lint 等 |
| | Lint 检查 | ✅ 完全支持 | 支持 TypeScript/Python/Go/Shell 等 9 种语言 |
| | 重复代码检测 | ✅ 完全支持 | Gate 2: jscpd/pylint 集成，阈值 ≤5% |
| | 圈复杂度 | ✅ 完全支持 | Gate 3: lizard，CCN >5 警告，>10 阻断 |
| | Clean Code | ✅ 完全支持 | Gate 4: 9 条 Clean Code 规则检查 |
| | SOLID 原则 | ✅ 完全支持 | Gate 4: 5 条 SOLID 原则验证 |
| | 单元测试 | ✅ 完全支持 | Gate 5: 自动检测并运行测试套件 |
| | 代码覆盖率 | ✅ 完全支持 | Gate 5: ≥80% 阈值强制检查 |
| | 架构验证 | ✅ 完全支持 | Gate 6: archlint/import-linter/arch-go 层边界检查 |
| | 童子军规则 | ✅ 完全支持 | Gate 6: 差异化警告管理，新文件零容忍 |
| **AI 评审** | Delphi 设计评审 | ✅ 完全支持 | 多轮匿名评审，共识阈值 ≥91% |
| | Code Walkthrough | ✅ 完全支持 | git push 前代码走查验证 |
| | 测试规范对齐 | ✅ 完全支持 | 两阶段验证，Phase 2 freeze 保护 |
| **Sprint Flow** | Phase 0 Think | ✅ 完全支持 | brainstorming 需求探索 |
| | Phase 1 Plan | ✅ 完全支持 | autoplan + delphi-review 生成 specification.yaml |
| | Phase 2 Build | ✅ 完全支持 | TDD + freeze/unfreeze + requesting-code-review |
| | Phase 3 Review | ✅ 完全支持 | code-walkthrough + test-spec-alignment + browse |
| | Phase 4 Accept | ✅ 完全支持 | 人工验收环节（必须人工确认） |
| | Phase 5 Feedback | ✅ 完全支持 | learn + retro + systematic-debugging |
| | Phase 6 Ship | ✅ 完全支持 | finishing-a-development-branch + ship + land-and-deploy + canary |
| **Web 支持** | QA 测试 | ✅ 完全支持 | browse 浏览器自动化测试 |
| | 设计评审 | ✅ 完全支持 | design-review 视觉一致性检查 |
| | 性能基准 | ✅ 完全支持 | benchmark Core Web Vitals 追踪 |
| | 浏览器自动化 | ✅ 完全支持 | browse headless 浏览器操作 |
| **安全审计** | 密钥考古 | ✅ 完全支持 | CSO 扫描敏感信息泄露 |
| | 依赖供应链 | ✅ 完全支持 | 第三方依赖安全分析 |
| | CI/CD 安全 | ✅ 完全支持 | 流水线配置安全检查 |
| | LLM/AI 安全 | ✅ 完全支持 | AI 相关代码安全扫描 |
| | OWASP Top 10 | ✅ 完全支持 | Web 安全漏洞检测 |
| | STRIDE 威胁建模 | ✅ 完全支持 | 系统性威胁分析 |
| **并行执行** | 任务分发 | ✅ 完全支持 | dispatching-parallel-agents 并行子任务 |
| | 独立执行 | ✅ 完全支持 | 无共享状态的任务并行化 |
| **工程回顾** | 周回顾 | ✅ 完全支持 | retro 提交历史和工作模式分析 |
| | 系统调试 | ✅ 完全支持 | systematic-debugging 根因分析四阶段 |
| **发布决策** | Merge | ✅ 完全支持 | finishing-a-development-branch 4 选项之一 |
| | PR | ✅ 完全支持 | ship 自动创建 PR |
| | Discard | ✅ 完全支持 | 废弃分支清理 |
| | Keep | ✅ 完全支持 | 保留分支待后续处理 |

---

## 3. Language Support Matrix

XGate 支持 12 种编程语言的质量门禁和静态分析：

| 语言 | 静态分析 | Lint | 测试 | 覆盖率 | 架构验证 | 适配器 |
|------|---------|------|------|--------|---------|--------|
| **TypeScript** | tsc | ESLint | Jest/Vitest | ✅ ≥80% | archlint | typescript.sh |
| **Python** | mypy | Ruff | pytest | ✅ ≥80% | import-linter | python.sh |
| **Go** | go vet | golangci-lint | go test | ✅ ≥80% | arch-go | go.sh |
| **Shell** | bash -n | shellcheck | — | N/A | — | shell.sh |
| **Dart** | dart analyze | dart analyze | — | N/A | — | dart.sh |
| **Flutter** | flutter analyze | flutter analyze | flutter test | ✅ ≥80% | — | flutter.sh |
| **Java** | javac | CheckStyle/PMD/SpotBugs | JUnit | ✅ ≥80% | ArchUnit | java.sh |
| **Kotlin** | kotlinc | detekt/ktlint | — | — | — | kotlin.sh |
| **C++** | clang-tidy | cppcheck | — | — | — | cpp.sh |
| **Swift** | swiftlint | swiftlint | — | — | — | swift.sh |
| **Objective-C** | scan-build | oclint | — | — | — | objectivec.sh |
| **PowerShell** | — | PSScriptAnalyzer | Pester | — | — | powershell.sh |

**语言适配器位置**: `githooks/adapters/*.sh`

**零容错策略**: 工具不可用时 SKIP 而非阻断（工具可用时必须通过）

---

## 4. Sprint Flow Capabilities Map

Sprint Flow 提供 7 个阶段的完整开发流程编排：

```
Phase 0: THINK ───────┐
  ├─ brainstorming    │
  └─ 设计文档         │
                      │
Phase 1: PLAN ────────┤
  ├─ autoplan         │
  ├─ delphi-review    │
  └─ specification    │
                      │
Phase 2: BUILD ───────┤
  ├─ dispatching      │
  ├─ TDD (RED/GREEN)  │
  ├─ freeze/unfreeze  │
  └─ verification     │
                      │
Phase 3: REVIEW ──────┤
  ├─ code-walkthrough │
  ├─ test-spec-align  │
  └─ browse QA        │
                      │
Phase 4: ACCEPT ──────┤ ⚠️ 必须人工
  ├─ 人工验收         │
  └─ Emergent Issues  │
                      │
Phase 5: FEEDBACK ────┤
  ├─ learn            │
  ├─ retro            │
  └─ debugging        │
                      │
Phase 6: SHIP ────────┘
  ├─ finishing-branch
  ├─ ship
  ├─ land-and-deploy
  └─ canary
```

**暂停点设计**:

| 阶段 | 暂停条件 | 用户操作 |
|------|---------|---------|
| Phase 0 | 设计未 APPROVED | 修改设计文档 |
| Phase 1 | autoplan taste_decisions | 确认设计决策 |
| Phase 1 | delphi-review 未通过 | 修复并重新评审 |
| Phase 2 | 验证失败超过 max 3 | 修复或放弃 |
| Phase 2 | 成本超阈值 | 继续或暂停 |
| Phase 4 | **必须人工验收** | 实际使用确认 |
| Phase 6 | finishing-branch | 选择 merge/PR/discard/keep |

---

## 5. Quality Gates Coverage

### 6-Gate 架构（重构自 9-Gate）

| Gate | 名称 | 覆盖内容 | 工具 |
|------|------|---------|------|
| Gate 1 | Code Quality | 静态分析 + Lint + Shell 检查 | tsc/ESLint/Ruff/shellcheck |
| Gate 2 | Duplicate Code | 重复代码检测 | jscpd/pylint |
| Gate 3 | Cyclomatic Complexity | 圈复杂度 | lizard (CCN >5 警告, >10 阻断) |
| Gate 4 | Principles | Clean Code + SOLID | 14 规则引擎 |
| Gate 5 | Tests & Coverage | 单元测试 + 覆盖率 | Jest/pytest/go test (≥80%) |
| Gate 6 | Architecture + Boy Scout | 架构验证 + 童子军规则 | archlint + boy-scout.ts |

### Clean Code 规则 (9 条)

1. 函数长度 ≤50 行
2. 类方法数 ≤15 个（God Class 检测）
3. 嵌套深度 ≤4 层
4. 参数数量 ≤4 个
5. 返回值数量 ≤1 个
6. 布尔参数禁止
7. 无副作用
8. 单一职责
9. 错误处理完整

### SOLID 原则 (5 条)

1. SRP: 单一职责原则
2. OCP: 开放封闭原则
3. LSP: 里氏替换原则
4. ISP: 接口隔离原则
5. DIP: 依赖倒置原则

### Boy Scout Rule

- **新文件**: 零容忍（任何警告阻断提交）
- **修改文件**: 警告数不能增加
- **≤5 警告文件**: 必须清零

---

## 6. AI Skills Integration Map

XGate 集成的 AI Skills 体系：

### 核心 AI Skills

| Skill | 用途 | 触发条件 |
|-------|------|---------|
| **delphi-review** | 多专家共识评审 | `/delphi-review` |
| **test-specification-alignment** | 测试规范对齐 | `/test-specification-alignment` |
| **sprint-flow** | Sprint 流程编排 | `/sprint-flow "需求"` |
| **brainstorming** | 需求探索 | Phase 0 自动调用 |
| **autoplan** | 自动计划生成 | Phase 1 自动调用 |
| **requesting-code-review** | 代码评审请求 | Phase 2 freeze 后 |
| **verification-before-completion** | 完成前验证 | Phase 2 末尾 |
| **finishing-a-development-branch** | 分支完成处理 | Phase 6 |
| **ship** | 发布流程 | Phase 6 |
| **land-and-deploy** | 部署上线 | Phase 6 |
| **canary** | 金丝雀监控 | Phase 6 发布后 |
| **learn** | 模式学习 | Phase 5 |
| **retro** | 工程回顾 | Phase 5 |
| **systematic-debugging** | 系统调试 | Phase 5 |
| **browse** | 浏览器测试 | Phase 3 |
| **benchmark** | 性能基准 | Phase 3 |
| **design-review** | 设计评审 | Phase 3 |
| **cso** | 安全审计 | Phase 1-6 |
| **freeze/unfreeze** | 目录锁定 | Phase 2 |

### Delphi Review 专家配置

| Expert | 角色 | 推荐模型 | 备选模型 |
|--------|------|---------|---------|
| Expert A | 架构 | deepseek-v4-pro | qwen3.6-plus, glm-5.1 |
| Expert B | 技术 | kimi-k2.6 | deepseek-v4-pro, minimax-m2.7 |
| Expert C | 可行性 | qwen3.6-plus | kimi-k2.6, glm-5.1 |

**强制要求**:
- 至少 2 家不同厂商模型
- 禁止使用 Anthropic/OpenAI/Google 国外模型
- 共识阈值 ≥91%

---

## 7. Known Gaps / Roadmap

### 当前局限（诚实披露）

| 局限 | 说明 | 计划 |
|------|------|------|
| **CI/CD 集成** | 仅本地 git hooks，无 Jenkins/GitHub Actions 等 CI 集成 | 未来版本提供 CI 插件 |
| **API/REST 测试** | 无专门的 REST API 自动化测试框架 | 考虑集成 REST Assured/Postman CLI |
| **负载测试** | 无负载/压力测试能力 | 考虑集成 k6/Artillery |
| **RN TDD 集成** | React Native TDD 未完全集成到 Phase 2 | 需要完善 vercel-react-native-skills 与 TDD 流程 |

### 技术债务

| 项目 | 状态 | 优先级 |
|------|------|--------|
| Skill-Cert 外部化 | Python 子项目，需单独安装 | 中 |
| Promptfoo 基础设施 | 测试基础设施，非核心功能 | 低 |
| 文档项目特殊处理 | 纯文档项目跳过代码检查 | 已支持 |

---

## 8. Comparison: XGate vs Standard CI/CD

| 维度 | XGate | 标准 CI/CD |
|------|-------|-----------|
| **集成层级** | 本地 git hooks + AI Skills | 远程 CI 服务器 |
| **反馈延迟** | 提交前即时反馈（<30s） | 推送到 CI 后（分钟级） |
| **AI 评审** | Delphi 多专家共识评审 | 通常无 |
| **设计对齐** | specification.yaml 驱动 | 通常无 |
| **童子军规则** | 差异化警告管理 | 通常无 |
| **覆盖率阈值** | 提交前强制 ≥80% | 合并前检查 |
| **架构验证** | 层边界检查（archlint） | 通常无 |
| **测试冻结** | Phase 2 freeze 机制 | 通常无 |
| **Sprint 编排** | 7 阶段完整流程 | 通常无 |
| **并行执行** | dispatching-parallel-agents | 通常无 |
| **安全审计** | CSO 15 阶段深度扫描 | 基础安全扫描 |
| **成本** | 本地运行，AI 调用按需 | CI 服务器持续运行 |
| **适用场景** | 个人/小团队质量门禁 | 大规模团队 CI/CD |

### 组合建议

XGate 专注于**提交前质量门禁**和**AI 辅助评审**，可与标准 CI/CD **互补使用**:

```
本地开发 ──→ git commit ──→ XGate 6 Gates ──→ ✅ 通过
                                            └──→ ❌ 阻断修复
                                                  │
                                                  ▼
git push ──→ CI/CD Pipeline ──→ Build/Test/Deploy
```

**最佳实践**: XGate 保证提交质量，CI/CD 处理构建和部署。

---

## 附录

### 配置文件

| 文件 | 用途 |
|------|------|
| `.principlesrc` | 自定义检查阈值 |
| `architecture.yaml` | 架构层边界规则 |
| `specification.yaml` | 需求规范（自动生成） |
| `.delphi-config.json` | Delphi 专家配置 |
| `.warnings-baseline.json` | 童子军规则基线 |

### 输出格式

| 输出 | 格式 | 用途 |
|------|------|------|
| Quality Report | JSON | commit 质量报告 |
| SARIF | 2.1.0 | IDE/CI 集成 |
| Delphi Consensus | JSON | 评审结果 |
| Alignment Report | JSON | 测试规范对齐 |

---

*Generated: 2026-05-05 | Version: 1.0.0*
