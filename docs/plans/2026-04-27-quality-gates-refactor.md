# 合并质量门禁为 6 个通用类型 - 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use subagent-driven-development

**Goal:** 将 9 个质量门禁合并为 6 个通用类型门禁，不同语言通过适配器自动选工具。

**Architecture:** 保留现有 pre-commit 框架结构，提取语言无关逻辑到 `githooks/adapter/`，pre-commit 路由到不同语言适配器。

**Tech Stack:** Bash, 各语言 lint/静态分析/测试工具

---

### Task 1: 创建语言适配器目录

**Files:**
- Create: `githooks/adapters/typescript.sh`
- Create: `githooks/adapters/python.sh`
- Create: `githooks/adapters/go.sh`
- Create: `githooks/adapters/shell.sh`
- Create: `githooks/adapter-common.sh`

`adapter-common.sh` 提供 `detect_language()`, `route_to_adapter(check_type)` 等函数。

### Task 2: 合并 Static Analysis + Linting + Shell → Gate 1: Code Quality

**Files:**
- Modify: `githooks/pre-commit` (replaces Gate 1, 2, 5)

原 Gate 1 (Static Analysis) + Gate 2 (Linting) + Gate 5 (Shell Script Check) 合并为新 Gate 1: Code Quality。

### Task 3: 合并 Unit Tests + Coverage → Gate 5: Tests

**Files:**
- Modify: `githooks/pre-commit` (replaces Gate 3, 4)

原 Gate 3 (Unit Tests) + Gate 4 (Coverage) 合并为新 Gate 5: Tests。

### Task 4: 合并 Architecture + Boy Scout → Gate 6: Architecture

**Files:**
- Modify: `githooks/pre-commit` (replaces Gate 8, 9)

### Task 5: 更新文档

**Files:**
- Modify: `CONTRIBUTING.md`
- Modify: `githooks/QUALITY-GATES-CODE-OF-CONDUCT.md`
- Create: `githooks/GATES-OVERVIEW.md`

---

## 新门禁结构

| Gate | 名称 | 包含原 Gate | 语言适配 |
|------|------|-----------|---------|
| 1 | Code Quality | 1+2+5 | TS: tsc+ESLint, Py: mypy+ruff, Go: go vet+golangci-lint, Shell: shellcheck |
| 2 | Duplicate Code | 新增 | jscpd (TS/Go), pylint-dup (Py) |
| 3 | Complexity | 7 | lizard (跨语言) |
| 4 | Principles | 6 | 现有 9 语言 adapter |
| 5 | Tests | 3+4 | jest, pytest, go test + coverage |
| 6 | Architecture | 8+9 | import 依赖图 + warnings baseline |
