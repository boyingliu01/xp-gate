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

**pre-commit 需要的 package.json scripts:**
```json
{
  "scripts": {
    "test": "jest",
    "test:coverage": "jest --coverage"
  }
}
```

**Biome 配置 (推荐 - 10-20x faster):**
```json
// biome.json
{
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "formatter": {
    "enabled": true
  }
}
```

---

### Python 项目

| 工具 | 用途 | 性能 | 安装命令 |
|------|------|------|----------|
| **Ruff** (强烈推荐) | Lint + 格式化 + 导入 | **100x faster** | `pip install ruff` |
| **mypy** | 类型检查 | 标准 | `pip install mypy` |
| **pytest** | 单元测试 | 标准 | `pip install pytest` |
| **pytest-cov** | 测试覆盖率 | 标准 | `pip install pytest-cov` |

**Ruff 配置 (pyproject.toml):**
```toml
[tool.ruff]
line-length = 88
target-version = "py39"

[tool.ruff.lint]
select = [
  "E",   # pycodestyle errors
  "W",   # pycodestyle warnings
  "F",   # pyflakes
  "I",   # isort
  "C",   # flake8-comprehensions
  "B",   # flake8-bugbear
  "UP",  # pyupgrade
  "ARG", # flake8-unused-arguments
  "C90", # mccabe complexity
]
ignore = []

[tool.ruff.lint.mccabe]
max-complexity = 10

[tool.ruff.format]
quote-style = "double"
```

**pytest 配置 (pyproject.toml):**
```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-v --tb=short"
```

---

### Go 项目

| 工具 | 用途 | 性能 | 安装命令 |
|------|------|------|----------|
| **golangci-lint** | 60+ lint rules | 并行优化 | `go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest` |
| **go test** | 单元测试 + 覆盖率 | 内置 | Go 自带 |

**golangci-lint 配置 (.golangci.yml):**
```yaml
linters:
  enable:
    # 基础检查
    - gofmt
    - goimports
    - govet
    - errcheck
    
    # 复杂度 (SOLID/SRP)
    - cyclop
    - gocognit
    - funlen
    
    # 代码质量
    - revive
    - gocritic
    
    # 重复代码
    - dupl
    
    # 安全
    - gosec
    
linters-settings:
  cyclop:
    max-complexity: 10
  funlen:
    lines: 60
    statements: 40
```

---

## pre-push 工具

| 工具 | 用途 | 安装命令 |
|------|------|----------|
| **OpenCode CLI** | 多模型代码走查 | 参考 OpenCode 官方安装文档 |
| **code-walkthrough skill** | Delphi 代码评审 | `opencode skills install code-walkthrough` |

---

## 快速安装脚本

### TypeScript 项目
```bash
# 安装核心工具
npm install -D typescript eslint jest

# 或使用 Biome（推荐，更快）
npm install -D biome

# 添加 package.json scripts
npm pkg set scripts.test="jest"
npm pkg set scripts.test:coverage="jest --coverage"
```

### Python 项目
```bash
# 安装核心工具（Ruff 100x faster）
pip install ruff mypy pytest pytest-cov

# 或使用 pipx（推荐）
pipx install ruff
pipx install mypy
pip install pytest pytest-cov  # pytest 通常安装在项目环境
```

### Go 项目
```bash
# 安装 golangci-lint
go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest

# 创建配置文件
cat > .golangci.yml << 'EOF'
linters:
  enable:
    - gofmt
    - govet
    - errcheck
    - cyclop
    - funlen
EOF
```

---

## 验证环境是否准备好

### TypeScript 验证
```bash
# 检查工具可用性
command -v tsc && echo "✅ tsc installed"
command -v eslint && echo "✅ eslint installed"
command -v npx && echo "✅ npx installed"

# 检查 package.json scripts
grep '"test"' package.json && echo "✅ test script exists"
grep '"test:coverage"' package.json && echo "✅ coverage script exists"

# 运行测试验证
npm test && echo "✅ tests passing"
```

### Python 验证
```bash
# 检查工具可用性
command -v ruff && echo "✅ ruff installed"
command -v mypy && echo "✅ mypy installed"
command -v pytest && echo "✅ pytest installed"

# 运行 Ruff 验证
ruff check . && echo "✅ ruff passing"

# 运行 pytest 验证
pytest && echo "✅ pytest passing"
pytest --cov=. && echo "✅ coverage available"
```

### Go 验证
```bash
# 检查工具可用性
command -v golangci-lint && echo "✅ golangci-lint installed"

# 运行 lint 验证
golangci-lint run && echo "✅ lint passing"

# 运行测试验证
go test ./... && echo "✅ tests passing"
go test -cover ./... && echo "✅ coverage available"
```

---

## 错误示例

### ❌ 错误：工具未安装
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ❌ ENVIRONMENT ERROR - COMMIT BLOCKED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Required tool 'ruff' is NOT installed.

Your responsibility: Install the tool to enable quality gates.

Install commands:
  pip install ruff
  or: pipx install ruff

After installation, retry the commit.
```

### ✅ 正确：工具已安装
```
→ Gate 1: Static analysis...
✅ Ruff lint check passed.
✅ mypy type check passed.

→ Gate 3: Unit tests...
✅ pytest passed.

→ Gate 4: Coverage check...
✅ Coverage check passed.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ✅ ALL GATES PASSED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Clean Code / SOLID 原则检查覆盖

| 检查项 | TypeScript (Biome) | Python (Ruff) | Go (golangci-lint) |
|--------|-------------------|---------------|---------------------|
| 语法错误 | ✅ | ✅ | ✅ (govet) |
| 复杂度分析 | ✅ | ✅ (C90, PLR09) | ✅ (cyclop, gocognit) |
| 重复代码 | ⚠️ 有限 | ⚠️ 需 dupl 插件 | ✅ (dupl) |
| 类型检查 | ✅ (tsc) | ✅ (mypy) | ✅ (内置) |
| Clean Code | ✅ | ✅ | ✅ (revive, gocritic) |
| SOLID 原则 | ⚠️ 需自定义 | ⚠️ 需自定义 | ✅ (cyclop, iface) |

**额外 SOLID 检查建议:**
- 使用 **Semgrep** 自定义规则检查 SOLID 原则
- 配置复杂度阈值限制（SRP 原则）
- 使用接口检查器（ISP 原则）

---

## 总结

| 语言 | 核心工具 | 安装命令 |
|------|---------|----------|
| TypeScript | tsc + ESLint + Jest | `npm install -D typescript eslint jest` |
| TypeScript (推荐) | **Biome** | `npm install -D biome` |
| Python | **Ruff** + mypy + pytest | `pip install ruff mypy pytest pytest-cov` |
| Go | **golangci-lint** | `go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest` |

**安装后必须验证:**
1. `command -v <tool>` 检查工具可用
2. 运行 `npm test` / `pytest` / `go test` 验证测试
3. 运行 lint 工具验证无错误

**环境准备好后，AI 才能自动执行质量门禁。**