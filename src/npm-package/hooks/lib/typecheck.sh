#!/usr/bin/env bash

# Gate 1 TypeScript static analysis — the single place that decides HOW a project
# is type-checked (#436).
#
# Before this file, `githooks/pre-commit` and `githooks/adapters/typescript.sh` each
# hardcoded `npx tsc --noEmit`. Plain tsc cannot resolve `.vue` single-file
# components, so every `import X from './Foo.vue'` became a TS2307 and a Vue project
# whose own `vue-tsc --noEmit` run is clean was blocked on every commit. Because
# pre-commit runs under `set -o pipefail`, those false findings really did block.
#
# Resolution order:
#   1. GATE_TS_TYPECHECK_CMD        explicit override, same precedent as SKIP_VERSION_CHECK
#   2. package.json scripts.typecheck
#   3. package.json scripts.type-check (the name create-vue generates)
#   4. `npx tsc --noEmit --skipLibCheck` — the pre-#436 behavior, unchanged
#
# Return codes follow the gate exit-code contract: 0 clean, 1 findings, 2 checker
# unavailable (a tool failure must never be read as "no type errors").

resolve_typecheck_command() {
  if [ -n "${GATE_TS_TYPECHECK_CMD:-}" ]; then
    printf '%s' "$GATE_TS_TYPECHECK_CMD"
    return 0
  fi

  [ -f "package.json" ] || return 1
  command -v node >/dev/null 2>&1 || return 1

  local declared_script
  declared_script=$(node -e '
    let pkg;
    try {
      pkg = JSON.parse(require("fs").readFileSync("package.json", "utf8"));
    } catch {
      process.exit(0);
    }
    const scripts = (pkg && pkg.scripts) || {};
    if (scripts.typecheck) process.stdout.write("typecheck");
    else if (scripts["type-check"]) process.stdout.write("type-check");
  ' 2>/dev/null) || return 1

  [ -n "$declared_script" ] || return 1

  printf 'npm run %s' "$declared_script"
  return 0
}

# The #293 extra pass: projects commonly exclude test files from tsconfig.json, so
# their type errors accumulate silently. Only meaningful for the tsc fallback —
# a project checker covers the files its own config declares.
run_test_file_pass() {
  local has_tests_in_tsc=false
  if npx tsc --noEmit --skipLibCheck --listFiles 2>/dev/null | grep -qE '__tests__/|\.test\.ts|\.spec\.ts'; then
    has_tests_in_tsc=true
  fi
  [ "$has_tests_in_tsc" = false ] || return 0

  local test_pass_exit=0
  if [ -f "tsconfig.tests.json" ]; then
    echo "Checking test files with tsconfig.tests.json..."
    npx tsc --noEmit --project tsconfig.tests.json 2>&1 | head -30
    test_pass_exit=${PIPESTATUS[0]}
  else
    echo "Checking test files for type errors..."
    local temp_tsconfig=".tsconfig.withtests.json"
    node -e "
      const cfg = JSON.parse(require('fs').readFileSync('tsconfig.json','utf8'));
      delete cfg.exclude;
      cfg.include = cfg.include || ['src/**/*'];
      cfg.include.push('src/**/__tests__/**','src/**/*.test.ts','src/**/*.spec.ts');
      require('fs').writeFileSync('$temp_tsconfig', JSON.stringify(cfg, null, 2));
    " 2>/dev/null
    npx tsc --noEmit --project "$temp_tsconfig" --skipLibCheck 2>&1 | head -30
    test_pass_exit=${PIPESTATUS[0]}
    rm -f "$temp_tsconfig"
  fi

  if [ "$test_pass_exit" -ne 0 ]; then
    echo ""
    echo "❌ BLOCKED - TYPE ERRORS in test files"
    echo "Your project's tsconfig.json excludes test files from type checking."
    echo "Add a tsconfig.tests.json to customise test file checking."
    return 1
  fi
  return 0
}

run_typescript_typecheck() {
  if ! command -v npx >/dev/null 2>&1; then
    echo "ℹ️  SKIP - npx not available (no TypeScript checker)"
    return 2
  fi

  local project_checker
  if project_checker=$(resolve_typecheck_command); then
    # Word-split deliberately on the command name only: `npm run <script>` from
    # package.json, or a user-set GATE_TS_TYPECHECK_CMD. Never a path list.
    local checker_argv=()
    read -r -a checker_argv <<< "$project_checker"
    echo "Running project typecheck (${project_checker})..."
    "${checker_argv[@]}" 2>&1 | head -30
    if [ "${PIPESTATUS[0]}" -ne 0 ]; then
      echo ""
      echo "❌ BLOCKED - TYPE ERRORS detected by the project's own typecheck script"
      echo "Fix the type errors above before committing."
      return 1
    fi
    echo "✅ PASSED - project typecheck."
    return 0
  fi

  # Verify tsc is the real compiler (npx may fetch the deprecated tsc@2.0.4 placeholder).
  local tsc_version
  tsc_version=$(npx tsc --version 2>&1)
  if ! echo "$tsc_version" | grep -q "Version"; then
    echo "ℹ️  SKIP - tsc not properly installed ($tsc_version)"
    echo "Install typescript (npm install typescript --save-dev) for type checking."
    return 2
  fi

  if [ ! -f "tsconfig.json" ]; then
    echo "ℹ️  SKIP - tsconfig.json not found (no TypeScript project config)"
    return 2
  fi

  echo "Running TypeScript static analysis ($tsc_version)..."
  npx tsc --noEmit --skipLibCheck 2>&1 | head -30
  if [ "${PIPESTATUS[0]}" -ne 0 ]; then
    echo ""
    echo "❌ BLOCKED - TYPE ERRORS detected"
    echo "Fix the type errors above before committing."
    return 1
  fi
  echo "✅ PASSED - TypeScript static analysis."

  if [ -d "src/__tests__" ] || [ -d "src/tests" ] || [ -d "tests" ] || [ -d "__tests__" ]; then
    run_test_file_pass || return 1
  fi
  return 0
}
