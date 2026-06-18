# Windows Compatibility Design

**Date**: 2026-06-18
**Issues**: #187 (Windows/Qoder bash hooks compatibility), #168 (Windows compatibility redesign from current main)
**Status**: Draft

## Overview

XP-Gate's git hooks are bash scripts with extensive Unix-only patterns (52 `head` usages, 47 `[[ ]]` bash-isms, 55 `command -v` calls, 4 `brew` references, 1 `chmod +x`). There is zero Windows detection anywhere. This design systematically addresses both the specific bugs in #187 and the broader redesign scope of #168.

## Scope

### In Scope
- OS detection layer in `adapter-common.sh`
- `head` → `sed` migration across all githooks/ shell scripts
- `[[ ]]` → `[ ]` conversion in adapter-common.sh, install.sh, verify.sh, shell.sh
- Windows alternatives in tool install messages (brew → winget/choco)
- Cross-platform CI improvements (Windows Git Bash hook verification)
- Documentation updates (TOOL-INSTALLATION-GUIDE.md)
- All changes isolated to branch `sprint/2026-06-18-windows-compat`

### Out of Scope
- Converting all adapters to POSIX `[ ]` (adapter-common.sh and shell.sh only — adapters remain bash)
- Full bash→sh migration of the entire codebase
- Adding Windows VMs for manual testing (CI runner covers this)
- OTel GenAI observability (#124)
- Multi-language mutation testing (#160)

## Design

### 1. OS Detection Layer

File: `githooks/adapter-common.sh`

Add a new function at the top:
```bash
detect_os_env() {
  case "$(uname -s 2>/dev/null || echo unknown)" in
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    Darwin*) echo "macos" ;;
    Linux*) echo "linux" ;;
    *) echo "unknown" ;;
  esac
}
```

The function checks `uname -s` for MSYS/MINGW/CYGWIN signatures which are standard Git Bash environment markers. This is a POSIX-compatible check.

### 2. `head` → `sed` Migration

Replace all 52 `head` invocations with POSIX `sed` equivalents:

| Pattern | Replacement |
|---------|-------------|
| `head -1` | `sed -n '1p'` |
| `head -n 1` | `sed -n '1p'` |
| `head -20` / `head -30` / `head -5` | `sed -n '1,20p'` etc. |
| `grep ... \| head -n X` | `grep -m X ...` (works with GNU grep, sed fallback) |

**Exception**: Plugin scripts in `githooks/adapters/plugins/` (p3c-java, whalecloud-java) use `head` for file-level operations (splitting XML). These are third-party extensions — convert them but keep the same logic.

### 3. `[[ ]]` → `[ ]` Conversion

Convert 47 occurrences across 4 files. These are the most consequential changes because they affect core routing logic.

**Rules**:
- `[[ -f "x" ]]` → `[ -f "x" ]`
- `[[ -n "$var" ]]` → `[ -n "$var" ]`
- `[[ -z "$var" ]]` → `[ -z "$var" ]`
- `[[ -d "x" ]]` → `[ -d "x" ]`
- `[[ -n "$(cmd)" ]]` → `[ -n "$(cmd)" ]`
- `[[ "a" =~ pattern ]]` → use `case` or `grep -q`
- `[[ "a" == "b" ]]` → `[ "a" = "b" ]`
- `[[ "a" != "b" ]]` → `[ "a" != "b" ]`

**Key risks**:
- `[[ ]]` prevents word splitting; `[ ]` does not — all variable expansions must be quoted
- `[[ ]]` supports regex matching (`=~`); `[ ]` does not — use `case` or `grep -q` instead
- Empty variable in `[ ]` causes syntax error — double-quote ALL variable references

### 4. Tool Install Messages

Replace 4 `brew` references with cross-platform alternatives:

```
# Before
echo "     Install: brew install gitleaks (macOS) | scripts/install-gitleaks.sh (Linux)"
echo "     Install: brew install semgrep | pip install semgrep"

# After
echo "     Install: brew install gitleaks (macOS) | winget install gitleaks (Windows) | scripts/install-gitleaks.sh (Linux)"
echo "     Install: brew install semgrep (macOS) | pip install semgrep (Linux/Windows)"
```

### 5. Cross-platform CI

Add a `windows-gitbash-hooks` job to `cross-platform-ci.yml`:

```yaml
  windows-gitbash-hooks:
    name: Hook Execution (Windows Git Bash)
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install project dependencies
        run: npm ci
      - name: Test hooks execute on Git Bash
        shell: bash
        run: |
          # Test adapter-common.sh can source without error
          bash -n githooks/adapter-common.sh || exit 1
          bash -n githooks/install.sh || exit 1
          bash -n githooks/verify.sh || exit 1
          # Test individual gate scripts parse
          for f in githooks/gate-*.sh; do
            bash -n "$f" || echo "FAIL: $f"
          done
```

### 6. Documentation Updates

**TOOL-INSTALLATION-GUIDE.md**: Add a Windows section at the top:

```markdown
## Windows Environment Requirements

XP-Gate hooks require **Git Bash** (included with Git for Windows). All hook scripts use
POSIX-compatible shell syntax and run under Git Bash's MSYS2 environment.

### Windows Tool Installation

| Tool | Install Command |
|------|----------------|
| gitleaks | `winget install gitleaks` |
| semgrep | `pip install semgrep` |
| lizard  | `pip install lizard` |
| checkov | `pip install checkov` |
| hadolint | `winget install hadolint` |
```

## Testing Strategy (Cross-Platform: Single Test Suite)

### Principle: One Test Suite, Dual Platform

所有测试**只写一套**，但测试代码本身必须跨平台兼容（和hooks代码同一标准）。不在两个平台上维护两套独立的测试。

原因：
- hooks在Windows上通过Git Bash的MSYS2环境运行，解释器**本质上还是同一个bash**
- 真正需要两套的是CI runner（`ubuntu-latest` + `windows-latest`），不是测试代码
- 维护两套测试的成本 > 收益，且容易漂移

### 测试代码兼容性要求

测试脚本（BATS）也遵循与hooks相同的POSIX兼容标准：

| 禁止 | 替代 |
|------|------|
| `[[ ]]` | `[ ]` 并双引号所有变量 |
| `head` | `sed -n '1p'` 或 `grep -m` |
| `source` (除非必要) | `.` 命令（POSIX兼容） |
| 硬编码Unix路径 | `$PWD`、`$(dirname "$0")` |
| `command -v` | 同，Git Bash支持 |

### 测试层级

```
Level 1: Syntax validation (最轻量，必过)
  ├─ bash -n githooks/adapter-common.sh
  ├─ bash -n githooks/pre-commit
  ├─ bash -n githooks/pre-push
  └─ bash -n for every gate-*.sh, adapters/*.sh

Level 2: BATS unit tests (githooks/__tests__/)
  ├─ 现有BATS测试保持不变（gate-parsing, gate-activation等）
  ├─ 新增: detect_os_env() 单元测试
  │   ├─ "linux" ← 模拟 $(uname -s) = "Linux"
  │   ├─ "windows" ← 模拟 $(uname -s) = "MINGW64_NT-10.0"
  │   └─ "macos" ← 模拟 $(uname -s) = "Darwin"
  └─ 新增: 验证所有gate脚本的bash -n解析（自动扫描）

Level 3: CI execution (两平台)
  ├─ ubuntu-latest: 完整测试 + BATS + gate集成测试
  └─ windows-latest (shell: bash): bash -n语法检查 + script源测试
```

### CI配置

```yaml
  windows-gitbash-hooks:
    name: Hook Syntax Check (Windows Git Bash)
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install dependencies
        run: npm ci
      - name: Syntax check all shell scripts via bash -n
        shell: bash
        run: |
          errors=0
          for f in $(find githooks -name "*.sh" -type f); do
            if ! bash -n "$f" 2>/dev/null; then
              echo "SYNTAX ERROR: $f"
              errors=$((errors + 1))
            fi
          done
          # Also test pre-commit/pre-push (no .sh suffix)
          for f in githooks/pre-commit githooks/pre-push; do
            if ! bash -n "$f" 2>/dev/null; then
              echo "SYNTAX ERROR: $f"
              errors=$((errors + 1))
            fi
          done
          echo "Total syntax errors: $errors"
          [ "$errors" -eq 0 ] || exit 1
      - name: Test OS detection
        shell: bash
        run: |
          # Simulate detect_os_env() inline test
          detect_os_env() {
            case "$(uname -s 2>/dev/null || echo unknown)" in
              MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
              Darwin*) echo "macos" ;;
              Linux*) echo "linux" ;;
              *) echo "unknown" ;;
            esac
          }
          OS=$(detect_os_env)
          echo "Detected OS: $OS"
          if [ "$OS" != "windows" ]; then
            echo "FAIL: Expected 'windows' on Windows runner"
            exit 1
          fi
          echo "PASS: OS detection works on Windows"
```

## Implementation Order

The work should proceed in this order to minimize merge conflicts:

1. **Opt 1**: `adapter-common.sh` — OS detection + `head` → `sed` + `[[ ]]` → `[ ]`
   - Largest file, most changes, foundational
2. **Opt 2**: `install.sh`, `verify.sh`, `shell.sh` — `[[ ]]` → `[ ]` + `chmod` guard
3. **Opt 3**: Gate 8/9 scripts — `brew` replacement + tool install messages
4. **Opt 4**: `cross-platform-ci.yml` — Windows Git Bash job (含语法检查 + OS检测验证)
5. **Opt 5**: `TOOL-INSTALLATION-GUIDE.md` — Windows section

## Risks

1. **`[[ ]]` → `[ ]` typo risk**: 47 conversions × high density in adapter-common.sh
   - Mitigation: `bash -n` catches syntax errors; CI validates on both Linux + Windows
2. **`sed` behavior**: GNU sed vs BSD sed differences
   - Mitigation: `sed -n '1p'` pattern is POSIX-standard, works everywhere
3. **Plugin scripts**: Third-party extensions (p3c-java, whalecloud-java) use `head` for XML editing — lower confidence
   - Mitigation: Treat as stretch goal, test syntax only
4. **BATS on Windows**: BATS是bash测试框架，在Git Bash下可以运行，但需确认shebang和环境变量
   - Mitigation: CI中用`bats`命令（Windows Git Bash安装后有bat兼容），或用`bash bats/test.bats`显式调用
