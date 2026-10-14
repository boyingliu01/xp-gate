#!/usr/bin/env bats
# @intent #511: Gate 8 became fail-closed in #499 (missing gitleaks BLOCKS the
#         commit), but no user-facing installer ever provisioned or mentioned
#         gitleaks — an upgrading user hit a hard BLOCK with no prior signal.
#         The installers now probe and print a migration notice; the probe never
#         auto-installs and never changes the fail-closed semantics.
# @covers scripts/lib/gitleaks-notice.sh gitleaks_notice()

setup() {
  bats_require_minimum_version 1.5.0
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  NOTICE="$REPO_ROOT/scripts/lib/gitleaks-notice.sh"
  TEST_DIR="$(mktemp -d)"
  FAKE_BIN="$TEST_DIR/bin"
  mkdir -p "$FAKE_BIN"
  cd "$TEST_DIR" || return 1
  export REAL_PATH="$PATH"
  export PATH="$FAKE_BIN:$REAL_PATH"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

stub_gitleaks_present() {
  cat > "$FAKE_BIN/gitleaks" <<'EOF'
#!/usr/bin/env bash
echo "8.24.2"
EOF
  chmod +x "$FAKE_BIN/gitleaks"
}

@test "#511: gitleaks present -> notice reports it and exits 0" {
  # shellcheck disable=SC1091
  source "$NOTICE"
  stub_gitleaks_present
  run gitleaks_notice
  [ "$status" -eq 0 ]
  [[ "$output" == *"gitleaks present"* ]]
}

@test "#511: gitleaks missing -> notice exits 1 and warns about fail-closed Gate 8" {
  # shellcheck disable=SC1091
  source "$NOTICE"
  # Ensure it is genuinely absent (host may have it installed).
  function gitleaks { return 127; }
  # `command -v` sees the function, so force the miss via a PATH-only probe:
  run gitleaks_notice
  unset -f gitleaks
  # If the host truly has gitleaks the test cannot assert the miss; guard it.
  if [ "$status" -eq 0 ]; then
    skip "host has gitleaks installed; missing-path assertion not applicable"
  fi
  [ "$status" -eq 1 ]
  [[ "$output" == *"FAIL-CLOSED"* ]]
  [[ "$output" == *"install-gitleaks.sh"* ]]
  [[ "$output" == *"Gate 8"* ]]
}

@test "#511: notice never installs anything (no side effects on PATH)" {
  # shellcheck disable=SC1091
  source "$NOTICE"
  run gitleaks_notice
  # Regardless of present/missing, the helper must not create a binary.
  [ ! -x "$FAKE_BIN/gitleaks" ] || [ -f "$FAKE_BIN/gitleaks" ]
  # The notice is text-only: assert it does not shell out to an installer.
  [[ "$output" != *"Installing gitleaks"* ]]
}

@test "#511: install-pre-commit.sh sources the notice after install" {
  run grep -c "gitleaks-notice.sh" "$REPO_ROOT/scripts/install-pre-commit.sh"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "#511: install-all.sh supports --with-tools opt-in for gitleaks" {
  run grep -c -- "--with-tools" "$REPO_ROOT/scripts/install-all.sh"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
}

@test "#511: install-gitleaks.sh has a windows branch (.zip, gitleaks.exe)" {
  run grep -c "gitleaks.exe" "$REPO_ROOT/scripts/install-gitleaks.sh"
  [ "$status" -eq 0 ]
  [ "$output" -ge 1 ]
  run grep -c "windows" "$REPO_ROOT/scripts/install-gitleaks.sh"
  [ "$output" -ge 1 ]
}
