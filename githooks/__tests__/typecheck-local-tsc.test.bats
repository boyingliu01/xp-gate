#!/usr/bin/env bats
#
# @test REQ-438 Typecheck must not pay npx resolution when tsc is installed locally
# @intent `npx tsc --version` measured 1941 ms against `node
#         node_modules/typescript/bin/tsc --version` at 234 ms in this repo --
#         the same compiler, the same answer, 1.7 s of package resolution in
#         between. githooks/lib/typecheck.sh invoked `npx tsc` at five sites and
#         one commit runs several of them, so the typecheck half of Gate 1 paid
#         that toll repeatedly. This is the same finding as archlint's in
#         pre-commit:4324-4345 ("measured: 1909 ms via npx vs 319 ms direct"),
#         which already prefers the local binary; typecheck never got the same
#         treatment.
#
#         The behaviour asserted is: when node_modules/typescript is present, the
#         checker is invoked through node directly; when it is absent, npx still
#         provides the fallback so a consumer repo without a local install keeps
#         working exactly as before.
#
# @covers AC-438-01, AC-438-02
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  TYPECHECK="$REPO_ROOT/githooks/lib/typecheck.sh"
}

@test "AC-438-01: typecheck.sh resolves a local tsc before falling back to npx" {
  # A resolver function must exist and be reachable.
  run bash -c "grep -qE '^_tsc_command\\(\\)|^tsc_command\\(\\)' '$TYPECHECK'"
  [ "$status" -eq 0 ]
}

@test "AC-438-02: with typescript installed locally, no `npx tsc` is executed" {
  # Runs the resolver in a fixture that has node_modules/typescript/bin/tsc and a
  # stub npx that fails loudly. If the resolver still reaches for npx, the stub
  # makes the run fail instead of silently succeeding.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/node_modules/typescript/bin" "$work/bin"
  printf '#!/usr/bin/env node\nconsole.log("Version 5.9.3");\n' > "$work/node_modules/typescript/bin/tsc"
  cat > "$work/bin/npx" <<'STUB'
#!/usr/bin/env bash
echo "NXP-WAS-CALLED" >&2
exit 42
STUB
  chmod +x "$work/bin/npx"

  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:$PATH'
    export PATH
    # shellcheck source=/dev/null
    . '$TYPECHECK'
    _tsc_command --version
  "
  rm -rf "$work"

  [ "$status" -eq 0 ]
  [[ "$output" == *"Version 5.9.3"* ]]
  [[ "$output" != *"NXP-WAS-CALLED"* ]]
}

@test "AC-438-02: without a local install, the npx fallback is still used" {
  # A consumer repo that has not installed typescript must keep the historical
  # behaviour -- a fix that broke this would turn every local typecheck into a
  # SKIP.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/bin"
  cat > "$work/bin/npx" <<'STUB'
#!/usr/bin/env bash
echo "Version 5.9.3 (via npx)"
STUB
  chmod +x "$work/bin/npx"

  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:$PATH'
    export PATH
    # shellcheck source=/dev/null
    . '$TYPECHECK'
    _tsc_command --version
  "
  rm -rf "$work"

  [ "$status" -eq 0 ]
  [[ "$output" == *"via npx"* ]]
}
