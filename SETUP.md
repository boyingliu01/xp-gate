# 使用手册 Setup Guide

## 快速开始

每个组件都可以**独立安装和使用**，不需要安装整个项目。

---

## 可用组件

### 独立组件（按需选装）

| 组件 | 一句话 | 安装命令 |
|------|--------|---------|
| **Pre-Commit 门禁** | git commit 自动检查：类型检查、lint、测试、覆盖率、代码规范、复杂度 | `bash scripts/install-pre-commit.sh` |
| **Pre-Push 门禁** | git push 前验证代码走查结果 | `bash scripts/install-pre-push.sh` |
| **Principles Checker** | 静态代码分析工具：Clean Code + SOLID 检查 | `bash scripts/install-principles-cli.sh` |
| **Delphi Review** | 多专家评审设计文档和代码 | `bash scripts/install-delphi-review.sh` |
| **Test-Spec Alignment** | 测试与需求对齐验证 | `bash scripts/install-test-spec-alignment.sh` |
| **Sprint Flow** | 一键 Sprint 编排器（组合以上所有） | `bash scripts/install-sprint-flow.sh` |

### 组合包

| 组合包 | 包含 | 安装命令 |
|--------|------|---------|
| **质量门禁包** | Pre-Commit + Pre-Push + Principles Checker + 行为准则 | `bash scripts/install-all.sh` |
| **AI 评审包** | Delphi Review + Test-Spec Alignment | 分别安装两个 |
| **完整工作流** | 所有组件 | 分别安装所有 |

---

## 组件详细说明

### 1. Pre-Commit 门禁（9 道质量关卡）

**做什么**：每次 `git commit` 时自动运行 9 项检查，任何一项失败都会阻止提交。

```
Gate 1: TypeScript 严格模式检查
Gate 2: ESLint 代码风格检查
Gate 3: 单元测试
Gate 4: 测试覆盖率≥80%
Gate 5: Shell 脚本语法检查
Gate 6: Clean Code + SOLID 规范检查（Principles Checker）
Gate 7: 圈复杂度检查
Gate 8: 童子军规则（代码质量不降级）
Gate 9: 架构质量检查
```

**安装**：
```bash
bash scripts/install-pre-commit.sh
```

**依赖**：
- Node.js ≥20
- 可选：lizard（圈复杂度分析）、archlint（架构检查）

**不需要**：任何 AI 工具或 Prompt。纯命令行脚本，100% 确定性执行。

---

### 2. Pre-Push 门禁（代码走查验证）

**做什么**：每次 `git push` 前，验证 `.code-walkthrough-result.json` 文件是否存在且通过评审。

**安装**：
```bash
bash scripts/install-pre-push.sh
```

**依赖**：无（脚本本身不需要外部依赖）

**配合使用**：
- 配合 Delphi Review skill：执行 `/delphi-review --mode code-walkthrough` 生成结果文件
- 纯文档变更自动跳过（纯 .md 文件改动不需要代码走查）

**不需要**：AI 工具本身不在此脚本中运行。脚本只验证结果文件是否存在。

---

### 3. Principles Checker CLI

**做什么**：独立命令行工具，检查代码是否符合 Clean Code 和 SOLID 原则。

**安装**：
```bash
bash scripts/install-principles-cli.sh
```

**使用**：
```bash
# 检查所有 TypeScript 文件
npx tsx src/principles/index.ts --files "src/**/*.ts"

# 输出 SARIF 格式（IDE/CI 集成）
npx tsx src/principles/index.ts --files "src/**/*.ts" --format sarif

# 历史项目初始化
npx tsx src/principles/boy-scout.ts --init-baseline
```

**依赖**：Node.js ≥20

---

### 4. Delphi Review Skill

**做什么**：多专家匿名评审，直到所有专家达成共识（≥91%）。

- **Design 模式**：评审需求文档、设计文档、架构决策
- **Code Walkthrough 模式**：评审 git 代码变更

**安装**：
```bash
bash scripts/install-delphi-review.sh
```

**使用**：
```
/delphi-review                              # 设计评审（默认模式）
/delphi-review --mode code-walkthrough      # 代码走查
```

**依赖**：
- OpenCode 或 Claude Code
- 至少 2 个不同厂商的 LLM API 访问权限
- 配置文件：复制 `.delphi-config.json.example` 为 `.delphi-config.json` 并填入 API key

---

### 5. Test-Specification Alignment Skill

**做什么**：确保测试用例和原始需求准确对齐。两阶段验证：
- Phase 1：验证测试是否覆盖所有需求 AC
- Phase 2：锁定测试文件执行，防止"改测试让测试通过"

**安装**：
```bash
bash scripts/install-test-spec-alignment.sh
```

**使用**：
```
/test-specification-alignment
```

**依赖**：无（独立验证）

**推荐配合**：Delphi Review（生成 specification.yaml 后使用效果最佳）

---

### 6. Sprint Flow（编排器）

**做什么**：一键运行完整 Sprint 流程，自动串联所有组件。

```
Think → Plan → Build → Review → Ship
```

**安装**：
```bash
bash scripts/install-sprint-flow.sh
```

**使用**：
```
/sprint-flow "开发用户登录功能"
```

**依赖**：无。**推荐配合**：Delphi Review、Test-Spec Alignment。如果这些没安装，Sprint Flow 仍然工作，但功能受限。

---

## 独立使用 vs 组合使用

### 场景 A：只想用质量门禁

```bash
# 只安装门禁，不需要任何 AI skill
bash scripts/install-pre-commit.sh
bash scripts/install-pre-push.sh
```

commit 和 push 时自动运行质量检查。不用 AI，不用 Prompt。

### 场景 B：只想用 AI 评审

```bash
# 只安装评审 skill
bash scripts/install-delphi-review.sh
```

设计决策前运行 Delphi 评审，push 前运行代码走查。

### 场景 C：完整工作流

```bash
# 安装所有
bash scripts/install-all.sh
bash scripts/install-delphi-review.sh
bash scripts/install-test-spec-alignment.sh
bash scripts/install-sprint-flow.sh
```

然后用 `/sprint-flow "功能描述"` 一键执行。

---

## 共享给团队

如果想让团队成员使用，有两种方式：

### 方式 1：复制安装脚本

分享这个仓库的 URL，让团队成员运行：

```bash
# 克隆仓库
git clone https://github.com/boyingliu01/xp-workflow-automation.git
cd xp-workflow-automation

# 选择需要的组件安装
bash scripts/install-pre-commit.sh
bash scripts/install-delphi-review.sh
# ...
```

### 方式 2：单独分发脚本

每个安装脚本都是独立的 bash 脚本，可以单独复制给同事使用，不需要整个仓库。

---

## 零容忍政策

质量门禁是刚性的，不允许绕过。详见 `githooks/QUALITY-GATES-CODE-OF-CONDUCT.md`。

- ❌ 禁止使用 `git commit --no-verify` 绕过预提交检查
- ❌ 禁止使用 `git push --no-verify` 绕过推送检查
- ❌ 禁止伪造评审结果文件
- ❌ 禁止因为"变更很小"跳过评审
