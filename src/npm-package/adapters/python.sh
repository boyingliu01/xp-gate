#!/usr/bin/env bash

# Python adapter for quality gates
# Tools: mypy, ruff/flake8, pytest, import-linter (architecture)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# SC1091：adapter-common.sh 由调用方按查找顺序提供，路径靠变量拼接，shellcheck 无法静态跟随。
# `source … || true` 是既有容错口径（仓库存档时该文件可能不在），不要改成硬依赖。
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../adapter-common.sh" 2>/dev/null || true

# A mypy target must exist AND actually contain .py files: a bare directory
# check lets through TS repos' src/ (mypy exits 2 with "There are no .py[i]
# files in directory" — #513 R1 expert-B reproduction), and a file check
# alone would accept empty shell directories. Supports files too, so a
# scope declaration may name a single .py file.
_mypy_target_usable() {
  [ -e "$1" ] || return 1
  [ -n "$(find "$1" -name '*.py' -print 2>/dev/null | grep .)" ]
}

run_static_analysis() {
  # NOTE: require_tool mypy runs AFTER target resolution, not here (#513 R2
  # expert-C): a repo with no type surface AND no mypy installed must reach
  # the SKIP branch (nothing to check) instead of false-BLOCKing on the
  # missing tool. The tool is only required when there is something to check.

  # 口径 = CI type job（.github/workflows/ci.yml:43-45）的目录集合（src/、
  # scripts/），并按调用方式对齐：**逐目录单独调用**（#513 R1 专家 B 实测：
  # 合并为 `mypy src scripts` 一次跑，src/util.py 与 scripts/util.py 同名时
  # 报 "Duplicate module named" exit 2，而 CI 分开跑各自 exit 0）。
  # 为什么不能写 `mypy .`：`.` 会递归扫到两类文件，而它们在仓库里从未被声明为
  # 门禁面，CI 也从不检查：
  #   ① 根目录一次性调研/演示脚本（fetch_*.py、demo_*.py、validate_*.py 等）——
  #      `[tool.ruff] exclude`（pyproject.toml:217-238）已逐文件把它们列为"历史产物，
  #      从未被 `ruff check src/ tests/` 覆盖"，mypy 侧却没有对应排除；
  #   ② `tests/` —— CI 只跑 `mypy src/` 与 `mypy scripts/`，测试域的类型问题
  #      没有任何门禁核对过。
  # 两份清单不一致的后果是钩子恒红且与本仓任何真实缺陷无关：实测 `mypy .` 87 条
  # error（本机），而 `mypy src/`（136 files）与 `mypy scripts/`（42 files）各自
  # exit 0。即当时钩子会阻断**任何**提交，包括纯文档改动。
  # 处置是让钩子对齐已声明的 CI 口径，而不是给那 87 处补注解——补注解既不在声明
  # 口径内，又会顺手动几十个无关文件（含 tests/）。
  # 口径一致性由仓库侧 BATS 测试双向锁住：
  # githooks/__tests__/adapter-mypy-pester-scope.test.bats（含"适配器里不得再
  # 出现裸 mypy ."），防止 `mypy .` 被写回来时无人报警。
  #
  # #513：上述 `src/`+`scripts/` 是"单一仓库的 CI 声明面"，不能当成所有 Python
  # 仓库的布局硬编码——无 src/ 的仓库（如 skill-cert 的 engine/ 布局）会得到
  # `mypy: can't read file 'src'` 而对任何 .py 提交恒 BLOCK，违反本项目
  # "门禁无法运行 → SKIP 而非 BLOCK" 规范。口径回归"按仓库声明"三级解析：
  #   ① 仓库根 `.xp-gate-mypy-scope`（每行一个目录；支持整行或行内 # 注释）
  #      存在则为其权威声明，声明条目同样过 usable 守卫（缺失/无 .py → WARN 跳过）；
  #   ② 否则仅对 usable 的默认目录（src/、scripts/）执行；
  #   ③ 两者皆无（或声明为空）→ 打印提示并 exit 0，绝不把 mypy 空跑一次。
  echo "Running Python static analysis (mypy)..."
  local -a MYPY_TARGETS=()
  local _mypy_declared=0
  if [ -f .xp-gate-mypy-scope ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      line="${line%%#*}"
      line="${line#"${line%%[![:space:]]*}"}"
      line="${line%"${line##*[![:space:]]}"}"
      [ -z "$line" ] && continue
      _mypy_declared=1
      if _mypy_target_usable "$line"; then
        MYPY_TARGETS+=("$line")
      else
        echo "  ⚠ mypy scope: declared target '$line' does not exist or contains no .py files — skipped"
      fi
    done < .xp-gate-mypy-scope
    echo "  scope: .xp-gate-mypy-scope declaration"
    if [ "${#MYPY_TARGETS[@]}" -eq 0 ]; then
      if [ "$_mypy_declared" -eq 1 ]; then
        echo "  ⚠ mypy: .xp-gate-mypy-scope has no usable target (all missing or without .py files) — skipping"
      else
        echo "  ⚠ mypy: .xp-gate-mypy-scope is present but empty (comments/blank lines only) — skipping"
      fi
      return 0
    fi
  else
    if [ -d src ] && _mypy_target_usable src; then
      MYPY_TARGETS+=(src)
    fi
    if [ -d scripts ] && _mypy_target_usable scripts; then
      MYPY_TARGETS+=(scripts)
    fi
    if [ "${#MYPY_TARGETS[@]}" -eq 0 ]; then
      echo "  ℹ️  mypy: repo declares no type surface (no .xp-gate-mypy-scope; src/ scripts/ absent or without .py files) — skipping"
      echo "      if this repo does have a type surface, declare it: create .xp-gate-mypy-scope (one directory per line)"
      return 0
    fi
  fi
  # 逐目标调用并聚合退出码（口径见函数头注释）。
  require_tool mypy "mypy" || return 1
  local _mypy_rc=0
  local _mypy_t
  for _mypy_t in "${MYPY_TARGETS[@]}"; do
    mypy "$_mypy_t" || _mypy_rc=1
  done
  return $_mypy_rc
}

run_lint() {
  if command -v ruff >/dev/null 2>&1; then
    echo "Running Python linting (ruff)..."
    ruff check .
    return $?
  elif command -v flake8 >/dev/null 2>&1; then
    echo "Running Python linting (flake8)..."
    flake8 .
    return $?
  else
    echo "⚠ No Python linter available (ruff or flake8 required)"
    return 0
  fi
}

run_architecture() {
  if [ ! -f ".import-linter.yml" ] && [ ! -f "import_linter_config.yml" ]; then
    return 0
  fi

  require_tool lint-imports "import-linter" || return 0

  echo "Running Python architecture checks (import-linter)..."
  lint-imports
  return $?
}

run_tests() {
  require_tool pytest "pytest" || return 1

  echo "Running Python tests..."
  # Skip e2e tests by default in pre-commit (require live API + network)
  PYTEST_OUTPUT=$(pytest --exitfirst --tb=short -m "not e2e" 2>&1)
  PYTEST_EXIT=$?

  # Show the short summary tail — this is where FAILED/assert diagnostics live.
  # With --exitfirst we stop at the first failure, so the last ~10 lines are the
  # most actionable: they contain the test name, assert expression, and expected
  # vs actual values.  Full output is saved to /tmp/ for post-mortem inspection.
  echo "$PYTEST_OUTPUT" | grep -E "(FAILED|PASSED|passed|failed|error|ERROR|assert)" | tail -10
  echo "$PYTEST_OUTPUT" | tail -5

  # Save full output for post-mortem inspection
  echo "$PYTEST_OUTPUT" > /tmp/xp-gate-pytest-output-$$.log

  # Check for collection errors (ModuleNotFoundError / ImportError)
  if echo "$PYTEST_OUTPUT" | grep -qi "ModuleNotFoundError\|ImportError"; then
    echo "❌ Python test collection errors detected — modules not importable"
    echo "   Fix: Run 'pip install -e .' or set PYTHONPATH=."
    return 1
  fi

  # Check if no tests were actually collected
  if echo "$PYTEST_OUTPUT" | grep -q "collected 0 items\|no tests ran"; then
    echo "❌ No tests were collected — nothing actually ran"
    return 1
  fi

  # Check for errors in summary line (e.g. "3 errors")
  ERROR_COUNT=$(echo "$PYTEST_OUTPUT" | grep -oP '\d+ error' | grep -oP '\d+' | sed -n '1p; 1q')
  if [ -n "$ERROR_COUNT" ] && [ "$ERROR_COUNT" -gt 0 ]; then
    echo "❌ $ERROR_COUNT test collection/execution errors detected"
    return 1
  fi

  return $PYTEST_EXIT
}

run_coverage() {
  require_tool pytest "pytest" || return 1

  echo "Running Python coverage..."
  # 阈值不在此处硬编码：pytest-cov 自动读取 pyproject.toml 的
  # [tool.coverage.report] fail_under（唯一事实源）。此前这里重复写了
  # --cov-fail-under=79.9，改 pyproject 不会让门禁跟着变，属于假配置。
  PYTEST_OUTPUT=$(pytest --exitfirst --tb=short --cov=src -m "not e2e" 2>&1)
  PYTEST_EXIT=$?
  echo "$PYTEST_OUTPUT" | grep -E "(FAILED|PASSED|passed|failed|error|ERROR|TOTAL|assert)" | tail -10
  echo "$PYTEST_OUTPUT" | tail -5
  echo "$PYTEST_OUTPUT" > /tmp/xp-gate-pytest-cov-output-$$.log

  # Check for collection errors (ModuleNotFoundError / ImportError)
  if echo "$PYTEST_OUTPUT" | grep -qi "ModuleNotFoundError\|ImportError"; then
    echo "❌ Python test collection errors detected — modules not importable"
    echo "   Fix: Run 'pip install -e .' or set PYTHONPATH=."
    return 1
  fi

  # Check if no tests were actually collected
  if echo "$PYTEST_OUTPUT" | grep -q "collected 0 items\|no tests ran"; then
    echo "❌ No tests were collected — nothing actually ran"
    return 1
  fi

  # Check for errors in summary line (e.g. "3 errors")
  ERROR_COUNT=$(echo "$PYTEST_OUTPUT" | grep -oP '\d+ error' | grep -oP '\d+' | sed -n '1p; 1q')
  if [ -n "$ERROR_COUNT" ] && [ "$ERROR_COUNT" -gt 0 ]; then
    echo "❌ $ERROR_COUNT test collection/execution errors detected"
    return 1
  fi

  return $PYTEST_EXIT
}
# ── Gate M: Python mutation testing (mutmut) ──

run_mutation() {
  local files_arg="$1"
  local timeout_ms="${2:-120000}"
  local timeout_s=$((timeout_ms / 1000))

  if ! detect_python_mutation_testable; then
    echo "⚠ mutmut not installed. SKIP — Gate M (Python)."
    return 0
  fi

  # Parse comma-separated file list into mutmut --paths-to-mulate args
  local file_list=""
  IFS=',' read -ra FILE_ARRAY <<< "$files_arg"
  for f in "${FILE_ARRAY[@]}"; do
    f=$(echo "$f" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [ -f "$f" ] && file_list="$file_list $f"
  done

  if [ -z "$file_list" ]; then
    echo "📚 No valid Python source files for mutation. SKIP — Gate M (Python)."
    return 0
  fi

  echo "🐍 Running Python mutation testing (mutmut) on: $file_list"

  # Gate M orchestrator (TypeScript) handles mutmut via MutmutRunner in src/mutation/runners/
  # The shell adapter delegates to the TS runner for consistency with TS Gate M.
  if [ -f "src/mutation/gate-m.ts" ]; then
    timeout "${timeout_s}s" npx tsx src/mutation/gate-m.ts \
      --changed-files "$files_arg" 2>&1
    return $?
  fi

  # Fallback: direct mutmut CLI if TS gate module not available
  local MUTATION_OUTPUT
  MUTATION_OUTPUT=$(mktemp)

  local MUTMUT_CMD="mutmut"
  if ! command -v mutmut >/dev/null 2>&1; then
    MUTMUT_CMD="python3 -m mutmut"
  fi

  # SC2086：`$MUTMUT_CMD` 与 `$file_list` 都是**故意按空白分词**的——
  # 前者可能是两个词（`python3 -m mutmut`），后者是空格分隔的多条路径，
  # 加引号会把它们并成单个参数、直接让命令失败。故此处显式声明意图，
  # 而不是改成引号（引号在这里不是修 bug，是造 bug）。
  # shellcheck disable=SC2086
  timeout "${timeout_s}s" $MUTMUT_CMD run --paths-to-mutate $file_list > "$MUTATION_OUTPUT" 2>&1
  local EXIT_CODE=$?

  cat "$MUTATION_OUTPUT"
  rm -f "$MUTATION_OUTPUT"

  case $EXIT_CODE in
    0)
      echo "✅ Gate M (Python): PASS"
      return 0
      ;;
    124)
      echo "⏱ Gate M (Python): TIMEOUT (${timeout_s}s). Allowing push with warning."
      return 0
      ;;
    *)
      echo "❌ Gate M (Python): mutation score below threshold"
      return 1
      ;;
  esac
}
