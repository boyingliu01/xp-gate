# OpenCode Quality Gates - 工具安装指南

## 设计原则

**零容忍原则**: 如果工具未安装，质量门禁将 **BLOCK** 操作并通知用户。
用户必须确保环境已准备好，才能让 AI 自动执行质量检查。

---

## 按语言栈的完整工具列表

### TypeScript/JavaScript 项目

| 工具 | 用途 | 性能 | 安装命令 |
|------|------|------|----------|
| **tsc** | 类型检查 | 标准 | `npm install -D typescript` |
| **ESLint** | Lint + 代码风格 | 标准 | `npm install -D eslint` |
| **Biome** (推荐) | Lint + 格式化 + 类型感知 | **10-20x faster** | `npm install -D biome` |
| **Oxlint** (可选) | 极速预检 | **50-100x faster** | `npm install -D oxlint` |
| **Jest/Vitest** | 单元测试 | 标准 | `npm install -D jest` 或 `npm install -D vitest` |

### Python 项目

| 工具 | 用途 | 性能 | 安装命令 |
|------|------|------|----------|
| **Ruff** (强烈推荐) | Lint + 格式化 + 导入 | **100x faster** | `pip install ruff` |
| **mypy** | 类型检查 | 标准 | `pip install mypy` |
| **pytest** | 单元测试 | 标准 | `pip install pytest` |
| **pytest-cov** | 测试覆盖率 | 标准 | `pip install pytest-cov` |

### Go 项目

| 工具 | 用途 | 性能 | 安装命令 |
|------|------|------|----------|
| **golangci-lint** | 60+ lint rules | 并行优化 | `go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest` |
| **go test** | 单元测试 + 覆盖率 | 内置 | Go 自带 |

### Dart 项目

| 工具 | 用途 | 性能 | 安装命令 |
|------|------|------|----------|
| **dart** | Dart SDK | 必需 | `brew install dart` 或 [官网](https://dart.dev/get-dart) |
| **dart analyze** | 静态分析 | **快速** (<5s) | 内置于 Dart SDK |
| **dart test** | 单元测试 | 标准 | 内置于 Dart SDK |

### Flutter 项目

| 工具 | 用途 | 性能 | 安装命令 |
|------|------|------|----------|
| **flutter** | Flutter SDK | 必需 | [官网](https://docs.flutter.dev/get-started/install) |
| **flutter analyze** | 静态分析 | 标准 | 内置于 Flutter SDK |
| **flutter test** | 单元测试 | 标准 | 内置于 Flutter SDK |

### Node.js (Principles Checker)

| 工具 | 用途 | 性能 | 安装命令 |
|------|------|------|----------|
| **Node.js** | 运行环境 | 必需 (>=18.x) | `brew install node` 或 [官网](https://nodejs.org/) |
| **ast-grep** | AST 分析引擎 | **175x faster** | `npm install -g @ast-grep/cli` |

### Cyclomatic Complexity (Gate 3)

| 工具 | 用途 | 语言覆盖 | 安装命令 |
|------|------|----------|----------|
| **lizard** | 函数级复杂度 | TS/Python/Go/Java/Swift | `pip3 install --user lizard` |
| **dart_code_linter** | Dart 复杂度 | Dart/Flutter | `dart pub add --dev dart_code_linter` |
| **detekt** | Kotlin 复杂度 | Kotlin | Gradle plugin 或 CLI |

### Architecture Quality (Gate 6)

| 工具 | 用途 | 语言覆盖 | 安装命令 |
|------|------|----------|----------|
| **archlint** (@archlinter/cli) | Clean Architecture 层级检查 | TypeScript | `npm install -g @archlinter/cli` |
| **Deply** | 依赖注入和层级分析 | Python | `pip install deply` |
| **goarchtest** | Go 架构测试 | Go | `go get github.com/fdaines/go-archtest` |
| **ArchUnit** | Java 架构约束 | Java | Maven/Gradle dependency |

> **重要**: Gate 6 使用 `archlint` (来自 `@archlinter/cli` 包)，不是 `architecture-linter`
> - `archlint` = Rust 实现，高性能，GitHub 130+ stars
> - CLI 命令: `archlint` 或 `npx @archlinter/cli`
> - 最低版本要求: 2.0.0

---

## 快速安装脚本

### TypeScript 项目
```bash
npm install -D typescript eslint jest
```

### Python 项目
```bash
pip install ruff mypy pytest pytest-cov
```

### Go 项目
```bash
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
```

### Dart 项目
```bash
# macOS
brew install dart
# Linux
sudo apt-get install dart
```

### Flutter 项目
```bash
# 参考: https://docs.flutter.dev/get-started/install
```

### Node.js (Principles Checker)
```bash
# macOS
brew install node
# Linux
sudo apt-get install nodejs
# Optional: ast-grep for AST-based analysis
npm install -g @ast-grep/cli
```

### Cyclomatic Complexity (lizard)
```bash
pip3 install --user lizard
~/.local/bin/lizard --version
```

### Architecture Quality (Gate 6)

#### TypeScript 项目
```bash
npm install -g @archlinter/cli
archlint --version
```

#### Python 项目
```bash
pip install deply
deply --version
```

#### Go 项目
```bash
go get github.com/fdaines/go-archtest
```

#### Java 项目
```bash
# Maven
# Add to pom.xml:
# <dependency>
#   <groupId>com.tngtech.archunit</groupId>
#   <artifactId>archunit</artifactId>
#   <version>1.0.0</version>
#   <scope>test</scope>
# </dependency>

# Gradle
# Add to build.gradle:
# testImplementation 'com.tngtech.archunit:archunit:1.0.0'
```

---

## 验证环境是否准备好

### Dart 验证
```bash
command -v dart && echo "✅ dart installed"
dart analyze && echo "✅ dart analyze passing"
dart test && echo "✅ dart test passing"
```

### Flutter 验证
```bash
command -v flutter && echo "✅ flutter installed"
flutter analyze && echo "✅ flutter analyze passing"
flutter test && echo "✅ flutter test passing"
```

### Node.js 验证
```bash
node --version && echo "✅ Node.js installed (need >=18.x)"
npm --version && echo "✅ npm installed"
# Optional
ast-grep --version && echo "✅ ast-grep installed"
```

### Lizard (Cyclomatic Complexity) 验证
```bash
~/.local/bin/lizard --version && echo "✅ lizard installed"
~/.local/bin/lizard -C 10 src/ && echo "✅ complexity within threshold"
```

### Architecture Quality (Gate 6) 验证

#### TypeScript
```bash
archlint --version && echo "✅ archlint installed (need >= 2.0.0)"
# 或使用 npx
npx @archlinter/cli --version
```

#### Python
```bash
deply --version && echo "✅ deply installed (need >= 0.5.0)"
```

#### Go
```bash
go test -run Architecture ./... && echo "✅ go architecture tests passing"
```

#### Java
```bash
mvn test -Dtest=*ArchitectureTest && echo "✅ ArchUnit tests passing"
```

---

## architecture.yaml 配置指南 (Gate 6)

### ⚠️ 重要提示

**Gate 6 现在遵循零容忍原则**：如果 `architecture.yaml` 或 `.architecturerc` 缺失，commit 将被 **阻塞**。

这与 Gate 1-5 的行为一致（工具缺失 = 阻塞）。

### 必需字段

| 字段 | 说明 | 是否必需 |
|------|------|---------|
| `version` | 配置版本，当前为 `1` | **必需** |
| `layers` | 层级定义，至少定义一个 layer | **必需** |
| `rules` | 架构规则配置 | 可选（默认启用 ARCH-001-010） |

### 最小配置示例

#### YAML 格式 (architecture.yaml)

```yaml
version: 1
layers:
  domain:
    pattern: "src/domain/**"
```

#### JSON 格式 (.architecturerc)

```json
{
  "version": 1,
  "layers": {
    "domain": {
      "pattern": "src/domain/**"
    }
  }
}
```

### 逐步配置策略

**第一步**：创建最小配置（上述示例）

**第二步**：添加更多层级

```yaml
version: 1
layers:
  domain:
    pattern: "src/domain/**"
    description: "Core business logic"
    allowedImports: ["src/shared/**"]
    forbiddenImports: ["src/infrastructure/**", "src/application/**"]
  
  application:
    pattern: "src/application/**"
    description: "Application services"
    allowedImports: ["src/domain/**", "src/shared/**"]
    forbiddenImports: ["src/infrastructure/**", "src/presentation/**"]
  
  infrastructure:
    pattern: "src/infrastructure/**"
    description: "External services"
    allowedImports: ["src/application/**", "src/domain/**", "src/shared/**"]
    forbiddenImports: ["src/presentation/**"]
  
  presentation:
    pattern: "src/presentation/**"
    description: "UI components"
    allowedImports: ["src/application/**", "src/domain/**", "src/shared/**"]
```

**第三步**：启用特定规则

```yaml
rules:
  ARCH-001:  # Domain isolation
    enabled: true
    severity: error
  
  ARCH-002:  # Application boundary
    enabled: true
    severity: error
  
  ARCH-005:  # Cross-layer cycles
    enabled: true
    severity: error
```

### 获取完整模板

```bash
# 下载完整模板
curl -O https://raw.githubusercontent.com/boyingliu01/xgate/main/architecture.yaml
```

### 迁移指南（Breaking Change）

**升级后首次 commit 将被阻塞**：

1. 这是故意设计（零容忍原则）
2. 无绕过标志（与 Gate 1-5 一致）
3. 需要创建 architecture.yaml 或 .architecturerc

**CI/CD 环境**：
- CI 必须同样有配置文件
- 建议：将 architecture.yaml 加入 CI setup scripts
- 紧急绕过：`skip_gate_9=true` 环境变量（仅记录日志）

---

## Clean Code / SOLID 原则检查覆盖

| 检查项 | TypeScript | Python | Go | Dart | Flutter |
|--------|-----------|--------|-----|------|--------|
| 语法错误 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 复杂度分析 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 类型检查 | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 总结

| 语言 | 核心工具 | 安装命令 |
|------|---------|----------|
| TypeScript | tsc + ESLint + Jest + archlint | `npm install -D typescript eslint jest && npm install -g @archlinter/cli` |
| Python | Ruff + mypy + pytest + Deply | `pip install ruff mypy pytest pytest-cov deply` |
| Go | golangci-lint + goarchtest | `go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest && go get github.com/fdaines/go-archtest` |
| Dart | dart analyze + dart test | `brew install dart` |
| Flutter | flutter analyze + flutter test | [官网安装](https://docs.flutter.dev/get-started/install) |
| Java | ArchUnit | Maven/Gradle dependency |

**性能原则**: 选择最快的代码检查工具
- Dart 项目优先使用 `dart analyze`（不依赖 Flutter 框架，启动更快）
- Flutter 项目使用 `flutter analyze`（包含 Flutter 特定规则）

**环境准备好后，AI 才能自动执行质量门禁。**
