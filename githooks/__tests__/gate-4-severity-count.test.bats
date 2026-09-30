#!/usr/bin/env bats
# @test REQ-DSH-013
# @intent 验证 Gate 4 的 severity 计数能匹配 reporter 实际输出的 JSON 形式
#         （JSON.stringify(out, null, 2) → `"severity": "warning"`，冒号后有空格），
#         旧模式 `"severity":"warning"` 永匹配 0 导致 Gate 4 静默通过（#444）
# @covers AC-DSH-013-01

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  FIXTURE="$BATS_TEST_TMPDIR/principles-output.json"
}

# The exact payload shape formatJSON emits: JSON.stringify(output, null, 2).
write_payload() {
  cat > "$FIXTURE" <<'JSON'
{
  "violations": [
    {
      "file": "src/a.ts",
      "line": 12,
      "ruleId": "clean-code.magic-numbers",
      "message": "Magic number 12345",
      "severity": "warning"
    },
    {
      "file": "src/b.ts",
      "line": 3,
      "ruleId": "solid.srp",
      "message": "Class has multiple responsibilities",
      "severity": "error"
    }
  ],
  "summary": {
    "totalViolations": 2
  }
}
JSON
}

@test "REQ-DSH-013 the shipped gate-4 pattern matches pretty-printed JSON" {
  write_payload
  # The pattern now used by every gate-4*.sh copy.
  run grep -cE '"severity"[[:space:]]*:[[:space:]]*"warning"' "$FIXTURE"
  [ "$status" -eq 0 ]
  [ "$output" = "1" ]
}

@test "REQ-DSH-013 the shipped gate-4 pattern counts errors too" {
  write_payload
  run grep -cE '"severity"[[:space:]]*:[[:space:]]*"error"' "$FIXTURE"
  [ "$status" -eq 0 ]
  [ "$output" = "1" ]
}

@test "REQ-DSH-013 the shipped pattern also matches minified output" {
  # Defensive: a future `JSON.stringify(output)` without indentation must not
  # silently zero the counts again.
  printf '%s\n' '{"violations":[{"severity":"warning"},{"severity":"error"}]}' > "$FIXTURE"
  run grep -cE '"severity"[[:space:]]*:[[:space:]]*"warning"' "$FIXTURE"
  [ "$output" = "1" ]
  run grep -cE '"severity"[[:space:]]*:[[:space:]]*"error"' "$FIXTURE"
  [ "$output" = "1" ]
}

@test "REQ-DSH-013 the OLD space-less pattern is provably broken (regression guard)" {
  write_payload
  # This is the pre-fix pattern. It must NOT match pretty-printed output -- if it
  # ever does, the reporter changed and this guard should be re-derived.
  run grep -c '"severity":"warning"' "$FIXTURE"
  [ "$output" = "0" ]
}

@test "REQ-DSH-013 no shipped gate-4 copy still carries the space-less pattern" {
  cd "$REPO_ROOT" || return 1
  # Only the tracked/shipped copies matter. `.git/hooks/*` holds inert stale
  # copies (core.hooksPath points at ~/.config/xp-gate/hooks) and is untracked.
  offenders="$(git ls-files 'gate-4*.sh' '*/gate-4*.sh' | xargs grep -l '"severity":"' 2>/dev/null || true)"
  if [ -n "$offenders" ]; then
    printf 'space-less severity pattern still present in:\n%s\n' "$offenders" >&2
    return 1
  fi
}

@test "REQ-DSH-013 every shipped gate-4 copy uses the whitespace-tolerant pattern" {
  cd "$REPO_ROOT" || return 1
  files="$(git ls-files 'gate-4*.sh' '*/gate-4*.sh')"
  [ -n "$files" ]
  for f in $files; do
    grep -qE '"severity"\[\[:space:\]\]\*' "$f" || { echo "missing tolerant pattern in $f" >&2; return 1; }
  done
}

@test "REQ-DSH-013 gate-4 copies are syntactically valid" {
  cd "$REPO_ROOT" || return 1
  for f in githooks/gate-4.sh githooks/adapters/gate-4.sh githooks/gates/gate-4-principles.sh; do
    if [ -f "$f" ]; then
      run bash -n "$f"
      [ "$status" -eq 0 ] || { echo "syntax error in $f" >&2; return 1; }
    fi
  done
}
