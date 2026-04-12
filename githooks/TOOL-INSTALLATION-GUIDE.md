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
| TypeScript | tsc + ESLint + Jest | `npm install -D typescript eslint jest` |
| Python | Ruff + mypy + pytest | `pip install ruff mypy pytest pytest-cov` |
| Go | golangci-lint | `go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest` |
| Dart | dart analyze + dart test | `brew install dart` |
| Flutter | flutter analyze + flutter test | [官网安装](https://docs.flutter.dev/get-started/install) |

**性能原则**: 选择最快的代码检查工具
- Dart 项目优先使用 `dart analyze`（不依赖 Flutter 框架，启动更快）
- Flutter 项目使用 `flutter analyze`（包含 Flutter 特定规则）

**环境准备好后，AI 才能自动执行质量门禁。**
