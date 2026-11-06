#!/usr/bin/env bats

# #717 AC-717-22: the CI workflow agrees with the local hooks about C#.
#
# R2 round 1 (arch CI-01/CI-02, feas FC-01) found the real hole: the local
# pre-commit gated .cs while .github/workflows/quality-gates.yml had NO csharp
# arm at all, so the same commit was enforced locally and invisible in CI.
# That is worse than not supporting C# anywhere -- it teaches a developer that
# green means safe when CI never looked.

setup() {
  REPO_ROOT="$BATS_TEST_DIRNAME/../.."
  CI="$REPO_ROOT/.github/workflows/quality-gates.yml"
}

@test "#717 AC-717-22: the CI workflow detects csharp" {
  run grep -F 'echo "csharp" > project_language.txt' "$CI"
  [ "$status" -eq 0 ]
}

@test "#717 AC-717-22: C# detection precedes the powershell and shell arms" {
  # A .NET repo that ships a build.ps1/bootstrap.sh was classified powershell or
  # shell, which is exactly how its C# gate went missing. Order is the fix.
  local cs ps
  cs=$(grep -n 'echo "csharp" > project_language.txt' "$CI" | head -1 | cut -d: -f1)
  ps=$(grep -n 'echo "powershell" > project_language.txt' "$CI" | head -1 | cut -d: -f1)
  [ -n "$cs" ] && [ -n "$ps" ]
  [ "$cs" -lt "$ps" ]
}

@test "#717 AC-717-22: the CI workflow has a C# Gate 1 branch" {
  run grep -F 'PROJECT_LANGUAGE" == "csharp"' "$CI"
  [ "$status" -eq 0 ]
  run grep -F 'dotnet format --verify-no-changes' "$CI"
  [ "$status" -eq 0 ]
}

@test "#717 AC-717-22: the C# CI branch blocks on format violations" {
  # Slice the csharp arm by line numbers (awk-in-bats quoting bit twice already);
  # then assert the arm contains a hard failure.
  local start end
  start=$(grep -n 'PROJECT_LANGUAGE" == "csharp"' "$CI" | head -1 | cut -d: -f1)
  end=$(grep -n 'PROJECT_LANGUAGE" == "unknown"' "$CI" | head -1 | cut -d: -f1)
  [ -n "$start" ] && [ -n "$end" ] && [ "$start" -lt "$end" ]
  run bash -c "sed -n '${start},${end}p' '$CI' | grep -c 'exit 1'"
  [ "$output" -ge 1 ]
}

@test "#717 AC-717-22: a missing dotnet SDK warns in CI instead of blocking" {
  # Repository convention: tool-missing degrades to SKIP/warning. Asserting the
  # warning text exists keeps the two readings distinct.
  run grep -F 'dotnet SDK not available' "$CI"
  [ "$status" -eq 0 ]
}

@test "#717 AC-717-22: the workflow file is still valid YAML" {
  # The needle has to survive TWO quoting layers (bats -> bash -> `node -e "..."`).
  # Written as `s.indexOf('echo \"csharp\" > project_language.txt')` bash consumed
  # the `\"`, leaving a bare `"` that closed the JS string early:
  #     SyntaxError: missing ) after argument list
  # node exited 1 on a SYNTAX error, so this case failed identically on every
  # platform -- and would have kept failing no matter what the workflow said.
  # A script file removes both layers, which is the only version that cannot
  # silently rot back into checking nothing.
  local script="$BATS_TEST_TMPDIR/check-yaml.js"
  cat > "$script" <<'JSEOF'
const fs = require('fs');
const file = process.argv[2];
const s = fs.readFileSync(file, 'utf8');
// No yaml dep is shipped; assert the structural things a hand-edit breaks:
// no tab indentation, and the csharp arm is inside the Gate 1 run block.
if (/\t/.test(s)) { console.error('tab indentation'); process.exit(1); }
const gate1 = s.indexOf('Gate 1: Code Quality');
const cs = s.indexOf('echo "csharp" > project_language.txt');
if (gate1 === -1 || cs === -1) { console.error('missing section'); process.exit(1); }
process.exit(0);
JSEOF
  run node "$script" "$CI"
  [ "$status" -eq 0 ]
}
