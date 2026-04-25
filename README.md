# XP Workflow Automation

AI-powered development workflow tools with quality gates and multi-expert review.

---

## Why

开发过程中常见的问题：**没有门禁导致坏代码提交、没有评审导致设计缺陷、没有需求对齐导致测试遗漏。** 这个项目提供了一套可以独立或组合使用的质量门禁和 AI 评审工具，让每次 commit 和 push 都经过自动验证，重大设计决策经过多专家共识。

---

## What

三大模块，可以任意组合使用：

### 1. 质量门禁（纯确定性代码，不需要 AI）

每次 `git commit` 和 `git push` 时自动运行 9 道质量关卡，任何一项失败都会阻止操作：

| Gate | 检查内容 | 标准 |
|------|---------|------|
| 1 | TypeScript 严格模式 | 零错误 |
| 2 | ESLint 代码风格 | 零告警 |
| 3 | 单元测试 | 全部通过 |
| 4 | 测试覆盖率 | ≥80% |
| 5 | Shell 脚本语法 | 零错误 |
| 6 | Clean Code + SOLID | 零错误（警告由 Gate 8 处理）|
| 7 | 圈复杂度 | ≤5 警告，≤10 阻断 |
| 8 | 童子军规则（统一）| 新文件零告警，修改文件告警数不增加 |
| 9 | 架构质量 | 层边界不违规 |

### 2. Delphi Review（AI 多专家评审）

多专家匿名评审，直到所有专家达成共识（≥91%）：
- **Design 模式**：评审需求文档、设计文档、架构决策
- **Code Walkthrough 模式**：评审 git 代码变更，自动输出评审结果文件

### 3. Sprint Flow（一键编排器）

自动串联完整开发流程：`Think → Plan → Build → Review → Ship`。也可以用一句话启动：`/sprint-flow "开发用户登录"`

---

## How

### Step 1: 安装

每个组件都可以**独立安装**，不需要安装整个项目。

#### 快速安装（全部门禁 + 所有 AI 组件）

```bash
git clone https://github.com/boyingliu01/xp-workflow-automation.git
cd xp-workflow-automation

# 安装全部门禁（pre-commit + pre-push）
bash scripts/install-all.sh

# 安装 AI 评审组件
bash scripts/install-principles-cli.sh
bash scripts/install-delphi-review.sh
bash scripts/install-test-spec-alignment.sh
bash scripts/install-sprint-flow.sh
```

#### 按需安装

| 组件 | 一句话 | 安装命令 |
|------|--------|---------|
| **Pre-Commit 门禁** | git commit 自动运行 9 项检查 | `bash scripts/install-pre-commit.sh` |
| **Pre-Push 门禁** | git push 前验证代码走查结果 | `bash scripts/install-pre-push.sh` |
| **质量门禁包** | Pre-Commit + Pre-Push 一起装 | `bash scripts/install-all.sh` |
| **Principles Checker** | 独立命令行：Clean Code + SOLID 检查 | `bash scripts/install-principles-cli.sh` |
| **Delphi Review** | AI 多专家评审 | `bash scripts/install-delphi-review.sh` |
| **Test-Spec Alignment** | 测试与需求对齐验证 | `bash scripts/install-test-spec-alignment.sh` |
| **Sprint Flow** | 一键 Sprint 编排器 | `bash scripts/install-sprint-flow.sh` |

> Delphi Review 需要额外配置：复制 `.delphi-config.json.example` 为 `.delphi-config.json`，填入你的 LLM API key 和模型信息。

### Step 2: 使用

#### 日常开发（安装后自动运行）

```bash
git commit   # 自动运行 9 道门禁，失败则阻止提交
git push     # 自动验证 Delphi 评审结果，未通过则阻止推送
```

#### AI 评审工具

```bash
/delphi-review                              # 设计评审（默认模式）
/delphi-review --mode code-walkthrough      # 代码走查（push 前评审代码变更）
/test-specification-alignment               # 验证测试覆盖所有需求
```

#### 一键 Sprint 流程

```bash
/sprint-flow "开发用户登录功能"    # Think → Plan → Build → Review → Ship 全自动
```

#### Principles Checker（独立命令行）

```bash
# 检查代码规范
npx tsx src/principles/index.ts --files "src/**/*.ts" --format console

# 输出 SARIF 格式（IDE/CI 集成）
npx tsx src/principles/index.ts --files "src/**/*.ts" --format sarif

# 历史项目初始化（童子军规则）
npx tsx src/principles/boy-scout.ts --init-baseline
```

### Step 3: 零容忍政策

质量门禁是刚性的，不允许绕过：

- ❌ 禁止使用 `git commit --no-verify` 绕过预提交检查
- ❌ 禁止使用 `git push --no-verify` 绕过推送检查
- ❌ 禁止伪造评审结果文件
- ❌ 禁止因为"变更很小"跳过评审

详见 [`githooks/QUALITY-GATES-CODE-OF-CONDUCT.md`](githooks/QUALITY-GATES-CODE-OF-CONDUCT.md)。

---

## Configuration

### .principlesrc — 自定义检查阈值

```json
{
  "rules": {
    "clean-code": {
      "long-function": { "threshold": 50 },
      "god-class": { "threshold": 15 },
      "deep-nesting": { "threshold": 4 }
    },
    "solid": {
      "srp": { "methodThreshold": 15 }
    }
  }
}
```

### architecture.yaml — 架构规则

```yaml
layers:
  - name: domain
    allowed_imports: [domain]
  - name: application
    allowed_imports: [domain, application]
  - name: presentation
    allowed_imports: [domain, application, presentation]
```

### specification.yaml — 自动生成

从 APPROVED 设计文档自动生成，不需要手动编辑。

---

## Language Support

Principles Checker 支持 9 种语言的语法和分析：

| 语言 | 分析工具 | 架构验证工具 |
|------|---------|-------------|
| TypeScript | tsc, ESLint | archlint |
| Python | Ruff, mypy | Deply |
| Go | golangci-lint | goarchtest |
| Java | CheckStyle, PMD, SpotBugs | ArchUnit |
| Kotlin | detekt, ktlint | — |
| Dart | dart analyze | — |
| Swift | swiftlint | — |
| C++ | clang-tidy, cppcheck | — |
| Objective-C | scan-build, oclint | — |

---

## Sharing with Team

每个安装脚本都是独立的，可以单独分发给同事使用，不需要克隆整个仓库。也可以分享仓库地址，让对方按需安装需要的组件。

---

## License

MIT License - See [LICENSE](./LICENSE) file.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.
