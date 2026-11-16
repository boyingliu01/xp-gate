#!/usr/bin/env bats

# @test REQ-GATE-8-001
# @intent Gate 8's detect-secrets branch must distinguish "the tool is not
#         installed" from "the baseline file is missing". Both used to fall into
#         one `else` that printed `detect-secrets-hook unavailable (install: pip
#         install -e ".[dev]")`, so a repo with the tool on PATH was told to
#         install what it already had (measured in #793 against
#         detect-secrets 1.5.52).
# @covers AC-793-01
# @covers AC-793-02
#
# The instruction is what makes this a real defect rather than a wording nit:
# the reader follows it, the install is a no-op, and the actual missing piece --
# the committed baseline file -- is never named.

SOURCE_GITHOOKS="${XP_GATE_GITHOOKS:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"

setup() {
  export TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR"
  git init -q -b test-branch
  git config user.email "test@test.com"
  git config user.name "Test"
  mkdir -p "$TEST_DIR/empty-hooks"
  git config core.hooksPath "$TEST_DIR/empty-hooks"

  # A fake detect-secrets-hook that is present and runnable. Gate 8 only needs
  # `command -v` to succeed here; the branch must be chosen by the BASELINE's
  # absence, not by the tool's.
  mkdir -p "$TEST_DIR/bin"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$TEST_DIR/bin/detect-secrets-hook"
  chmod +x "$TEST_DIR/bin/detect-secrets-hook"
  # gitleaks must also be absent so the gate reports a single, clear warning.
  PATH="$TEST_DIR/bin:$PATH"
  export PATH

  echo "init" > README.md
  git add README.md
  git commit -q -m "init"  # core.hooksPath pinned to an empty dir in setup

  echo "const a = 1;" > sample.ts
  git add sample.ts
}

teardown() {
  cd /
  rm -rf "$TEST_DIR"
}

_run_gate8() {
  run bash -c "cd '$TEST_DIR' && bash '$SOURCE_GITHOOKS/adapters/gate-8.sh'"
}

# A PATH with every directory that does NOT provide detect-secrets-hook. Deleting
# the fixture's own copy is not enough: the developer machine also has the real
# tool installed, so `command -v` would still succeed and the "absent" case would
# silently exercise the "present" branch -- a test that proves nothing.
_path_without_detect_secrets() {
  local out="" dir
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    if [ -x "$dir/detect-secrets-hook" ] || [ -x "$dir/detect-secrets-hook.exe" ]; then
      continue
    fi
    out="$out:$dir"
  done <<< "$(printf '%s' "$PATH" | tr ':' '\n')"
  printf '%s' "${out#:}"
}

# ── AC-793-01: tool present, baseline missing → say so ───────────────

@test "AC-793-01: a missing baseline is reported as a missing baseline, not a missing tool" {
  [ ! -f .secrets.baseline ]
  _run_gate8
  [[ "$output" != *"detect-secrets-hook unavailable"* ]]
  [[ "$output" == *"baseline"* ]]
}

# ── AC-793-02: the tool-missing case still says the tool is missing ──

# Anti-vacuity: the fix must not simply stop printing the old sentence
# everywhere. When the tool really is absent, the install hint is correct advice
# and has to stay.
@test "AC-793-02: when the tool is genuinely absent, the tool-missing message stays" {
  local original_path="$PATH"
  PATH="$(_path_without_detect_secrets)"
  export PATH
  _run_gate8
  PATH="$original_path"
  [[ "$output" == *"unavailable"* ]]
}
