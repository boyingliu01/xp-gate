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
    local os
    # 优先使用uname -s（POSIX标准，所有平台可用）
    os=$(uname -s 2>/dev/null || echo "unknown")
    case "$os" in
        Linux*)     echo "linux";;
        Darwin*)    echo "macos";;
        MINGW*|MSYS*|CYGWIN*) echo "windows";;
        *)
            # 降级：检测$OSTYPE（bash特有，某些非POSIX环境备用）
            if [ -n "${OSTYPE-}" ]; then
                case "${OSTYPE-}" in
                    linux*)     echo "linux";;
                    darwin*)    echo "macos";;
                    msys*|cygwin*) echo "windows";;
                    *)          echo "unknown";;
                esac
            else
                echo "unknown"
            fi
            ;;
    esac
}
```

The function checks `uname -s` for MSYS/MINGW/CYGWIN signatures which are standard Git Bash environment markers. Uses `${OSTYPE-}` (default-value syntax) as a fallback when `uname` is unavailable — the `-` suffix avoids `set -u` failures without needing an explicit `set +u`.

### 2. `head` → `sed` Migration

Replace all 52 `head` invocations with POSIX `sed` equivalents:

| Pattern | Replacement |
|---------|-------------|
| `head -1` | `sed -n '1p'` |
| `head -n 1` | `sed -n '1p'` |
| `head -20` / `head -30` / `head -5` | `sed -n '1,20p'` etc. |
| `grep ... \| head -n 1` | `grep ... \| sed -n '1p'` |
| `grep ... \| head -n X` (X>1) | `grep ... \| sed -n '1,Xp'` |
| `head -N` (如plugin中的`head -20`) | `sed -n '1,Np'` |

> ⚠️ **Critical: `grep -m X` 不可用**。`grep ... | head -n 1` 中即使grep无匹配，head仍返回0；改为`grep -m 1`后无匹配返回1，改变管道退出码。在`set -e`环境下会导致脚本提前退出。**统一使用`sed -n '1,Np'`替代所有`head -N`**。

> 📝 `sed -n '1,Np'` 在输入行数 < N时输出全部行（与`head -N`行为一致），无需额外处理。

**Exception**: Plugin scripts in `githooks/adapters/plugins/` (p3c-java, whalecloud-java) use `head` for file-level operations (splitting XML, `head -20`). These are third-party extensions — convert them using `sed -n '1,20p'` with the same logic. Syntax-check via `bash -n` on CI only (stretch goal).

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

> ⚠️ **MANDATORY: ALL variable expansions inside `[ ]` MUST be double-quoted**: `[ -n "$var" ]`, NOT `[ -n $var ]`. Unquoted empty variables either cause syntax error (`[  = "" ]`) or are misinterpreted (`[ -n ]` is always true because `-n` is 2 chars). This is the #1 bug source in `[[ ]]` → `[ ]` conversion.

**Key risks**:
- `[[ ]]` prevents word splitting; `[ ]` does not — all variable expansions must be quoted
- `[[ ]]` supports regex matching (`=~`); `[ ]` does not — use `case` or `grep -q` instead
- Empty variable in `[ ]` causes syntax error — double-quote ALL variable references

### 4. `command -v` Strategy

**Decision: Keep unchanged.** `command -v` is POSIX-standard (IEEE Std 1003.1) and available in Git Bash, MSYS2, and all Unix shells. It works correctly for tool detection on all supported platforms. The 55 existing usages require no migration.

Note: `command -v` is NOT available in Windows PowerShell/cmd.exe — but hooks always run under Git Bash, where it works.

### 5. `chmod +x` on Windows

**Decision: Document, no change needed.** In Git Bash (MSYS2/MinGW), `chmod +x` is effectively a no-op — Windows NTFS ACLs don't map to Unix permission bits. Hook executability is guaranteed by:
- npm package distribution: files are marked executable at pack time
- `core.filemode` in git config: on Windows, typically `false`; hooks run via `bash <script>` regardless of exec bit
- `xp-gate init` copies files via `fs.copyFileSync()` which preserves source permissions

The single `chmod +x` in `install.sh` line 28 is a best-effort operation — on Windows it's harmless (no error), on Unix it's necessary. Keep it.

### 6. Tool Install Messages

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

### Principle: One Test Suite, Platform-Specific Execution

所有测试代码**只写一套**，但执行范围因平台而异。BATS 测试仅在 Linux 上运行（Windows Git Bash 下 BATS 的 shebang 解析和环境变量行为未经实际验证，存在兼容性风险）。Level 1 语法检查和内置的 OS 检测测试在所有平台运行。

原因：
- hooks在Windows上通过Git Bash的MSYS2环境运行，解释器**本质上还是同一个bash**
- 真正需要两套的是CI runner（`ubuntu-latest` + `windows-latest`），不是测试代码
- BATS在Windows Git Bash下的可用性未验证 — 不冒这个风险，Windows只做语法检查

### 测试代码兼容性要求

BATS 测试脚本（仅 Linux 运行）也遵循 POSIX 兼容标准，确保与 hooks 代码风格一致：

| 禁止 | 替代 |
|------|------|
| `[[ ]]` | `[ ]` 并双引号所有变量 |
| `head` | `sed -n '1p'` 或 `grep -m` |
| `source` (除非必要) | `.` 命令（POSIX兼容，Git Bash也支持） |
| 硬编码Unix路径 | `$PWD`、`$(dirname "$0")` |
| `command -v` | POSIX标准，Git Bash支持，保持不变 |

### 测试层级

```
Level 1: Syntax validation (最轻量，双平台)
  ├─ bash -n githooks/adapter-common.sh
  ├─ bash -n githooks/pre-commit
  ├─ bash -n githooks/pre-push
  └─ bash -n for every gate-*.sh, adapters/*.sh

Level 2: BATS unit tests (仅 Linux)
  ├─ 现有BATS测试保持不变（gate-parsing, gate-activation等）
  ├─ 新增: detect_os_env() 单元测试
  │   ├─ "linux" ← 模拟 $(uname -s) = "Linux"
  │   ├─ "windows" ← 模拟 $(uname -s) = "MINGW64_NT-10.0"
  │   └─ "macos" ← 模拟 $(uname -s) = "Darwin"
  └─ 新增: 验证所有gate脚本的bash -n解析（自动扫描）

Level 3: CI execution (平台差异化)
  ├─ ubuntu-latest: Level 1 + Level 2 (完整BATS)
  └─ windows-latest (shell: bash): Level 1 only (bash -n + 内联OS检测)
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
          # Simulate detect_os_env() inline test (full logic, incl. OSTYPE fallback)
          detect_os_env() {
            local os
            os=$(uname -s 2>/dev/null || echo "unknown")
            case "$os" in
                Linux*)     echo "linux";;
                Darwin*)    echo "macos";;
                MINGW*|MSYS*|CYGWIN*) echo "windows";;
                *)
                    if [ -n "${OSTYPE-}" ]; then
                        case "${OSTYPE-}" in
                            linux*)     echo "linux";;
                            darwin*)    echo "macos";;
                            msys*|cygwin*) echo "windows";;
                            *)          echo "unknown";;
                        esac
                    else
                        echo "unknown"
                    fi
                    ;;
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

## Rollback Plan

If the Windows compatibility changes break existing hook behavior:

| Trigger | Detection | Rollback Action |
|---------|-----------|-----------------|
| `bash -n` fails on any modified `.sh` file | Pre-commit Gate 6 / CI Level 1 | `git checkout -- githooks/adapter-common.sh` — 恢复整个文件 |
| `detect_os_env()` returns wrong OS on Linux | E2E test failure or gate misrouting | `git checkout -- githooks/adapter-common.sh` — 恢复OS检测部分 |
| `[ ]` quoting bug causes false positive/negative | Gate 1 fails on unrelated file, or shellcheck errors | 定位到具体行，`git checkout -- <file>` 恢复该文件 |
| 任何CI新错误 | CI pipeline failure | `git revert <commit>` 回退到上一个commit |

**不回退**的情况：
- Windows CI runner 上 tools 未安装导致 gate SKIP（这是预期行为，不是回归）
- BATS 测试在 Linux 上暴露了 Windows 特有路径问题（标记 known issue）
- `sed -n '1p'` 行为差异（POSIX标准，回退可能性极低）

## Risks

1. **`[[ ]]` → `[ ]` typo risk**: 47 conversions × high density in adapter-common.sh
   - Mitigation: `bash -n` catches syntax errors; CI validates on both Linux + Windows
2. **`sed` behavior**: GNU sed vs BSD sed differences
   - Mitigation: `sed -n '1p'` pattern is POSIX-standard, works everywhere
3. **Plugin scripts**: Third-party extensions (p3c-java, whalecloud-java) use `head` for XML editing — lower confidence
   - Mitigation: Treat as stretch goal, test syntax only
4. **BATS on Windows**: BATS是bash测试框架，在Git Bash下可以运行，但需确认shebang和环境变量
   - Mitigation: CI中用`bats`命令（Windows Git Bash安装后有bat兼容），或用`bash bats/test.bats`显式调用
