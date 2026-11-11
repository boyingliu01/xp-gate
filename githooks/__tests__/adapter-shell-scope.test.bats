#!/usr/bin/env bats
#
# @test REQ-GATE-SHELL-SCOPE The Shell adapter must lint the files it claims to lint
# @intent `run_lint()` ended with `shellcheck ./*.sh ./**/**/*.sh`. The second
#         pattern looks like a recursive glob but is not one: globstar is off by
#         default, so `**` degrades to `*` and the pattern only matches paths of
#         exactly one directory component. Measured in this repo: of 173 tracked
#         .sh files, `./**/**/*.sh` matched the 47 at depth 3 and silently
#         dropped the other 126 (depth 1, 2, 4, 5, 6, 7) — and `./*.sh` matched
#         none, because the root holds no scripts at all.
#
#         Nothing failed loudly. ShellCheck was simply handed a file list a
#         quarter the size of the project and reported PASS on it, which reads
#         exactly like "the project is clean" — the #717 shape, where a gate is
#         green because the input was never assembled.
#
#         The same function also claimed `./*.sh` in run_static_analysis(), which
#         in a repo with no root-level scripts matches nothing and turns the
#         shellcheck call into a no-argument invocation.
#
# @covers AC-GATE-SHELL-SCOPE-01
# @covers AC-GATE-SHELL-SCOPE-02
#
# ASCII only.

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  ADAPTER="$REPO_ROOT/githooks/adapters/shell.sh"
}

# Strip comment lines before asserting on source shape: the fix records the
# defective glob in a comment so the next reader sees why the file-list helper
# exists, and a bare grep would then report the explanation as the defect.
adapter_code() {
  grep -vE '^[[:space:]]*#' "$ADAPTER"
}

@test "AC-GATE-SHELL-SCOPE-01: no code line relies on the non-recursive ** glob" {
  run bash -c "$(declare -f adapter_code 2>/dev/null); adapter_code() { grep -vE '^[[:space:]]*#' '$ADAPTER'; }; adapter_code | grep -nE 'shellcheck[^|]*\*\.sh'"
  [ "$status" -ne 0 ]
}

@test "AC-GATE-SHELL-SCOPE-01: run_lint hands shellcheck every tracked script, at every depth" {
  # Four files at four different depths. The old glob could only ever have
  # reached one of them (depth 3), so a green assertion here proves the file
  # list is assembled rather than pattern-matched.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/top" "$work/a/b" "$work/a/b/c" "$work/a/b/c/d" "$work/bin"

  printf '#!/usr/bin/env bash\necho depth1\n' > "$work/top/d1.sh"
  printf '#!/usr/bin/env bash\necho depth2\n' > "$work/a/d2.sh"
  printf '#!/usr/bin/env bash\necho depth3\n' > "$work/a/b/d3.sh"
  printf '#!/usr/bin/env bash\necho depth4\n' > "$work/a/b/c/d4.sh"
  printf '#!/usr/bin/env bash\necho depth5\n' > "$work/a/b/c/d/d5.sh"

  # Fake shellcheck: record the basenames it was asked about, exit 0.
  cat > "$work/bin/shellcheck" <<'STUB'
#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in
    --version) echo "fake 0.0.0"; exit 0 ;;
    /*) echo "SAW:$(basename "$arg")" ;;
  esac
done
exit 0
STUB
  chmod +x "$work/bin/shellcheck"
  printf 'node_modules/\n' > "$work/.gitignore"
  git -C "$work" init -q -b test-branch 2>/dev/null
  git -C "$work" add -A 2>/dev/null

  ORIGPATH="$PATH"
  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:$ORIGPATH'
    export PATH
    # shellcheck source=/dev/null
    . '$ADAPTER'
    run_lint 2>&1
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"SAW:d1.sh"* ]]
  [[ "$output" == *"SAW:d2.sh"* ]]
  [[ "$output" == *"SAW:d3.sh"* ]]
  [[ "$output" == *"SAW:d4.sh"* ]]
  [[ "$output" == *"SAW:d5.sh"* ]]
}

@test "AC-GATE-SHELL-SCOPE-02: scripts without a .sh extension are still linted" {
  # pre-commit and pre-push are the two largest shell programs in the repo and
  # neither carries a .sh suffix, so an extension-only filter can never see
  # them. Scope is decided by the shebang, not the filename.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/bin" "$work/hooks"

  printf '#!/usr/bin/env bash\necho hook\n' > "$work/hooks/pre-commit"
  chmod +x "$work/hooks/pre-commit"
  printf '#!/usr/bin/env bash\necho helper\n' > "$work/helper.sh"

  cat > "$work/bin/shellcheck" <<'STUB'
#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in
    --version) echo "fake 0.0.0"; exit 0 ;;
    /*) echo "SAW:$(basename "$arg")" ;;
  esac
done
exit 0
STUB
  chmod +x "$work/bin/shellcheck"
  printf 'node_modules/\n' > "$work/.gitignore"
  git -C "$work" init -q -b test-branch 2>/dev/null
  git -C "$work" add -A 2>/dev/null

  ORIGPATH="$PATH"
  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:$ORIGPATH'
    export PATH
    # shellcheck source=/dev/null
    . '$ADAPTER'
    run_lint 2>&1
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"SAW:pre-commit"* ]]
  [[ "$output" == *"SAW:helper.sh"* ]]
}

@test "AC-GATE-SHELL-SCOPE-02: a non-shell file with no shebang is NOT linted" {
  # The complement, so the scope rule cannot be satisfied by widening to
  # "everything": a .md file or a .txt must never reach shellcheck.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/bin"

  printf '# notes\n\nNot a script.\n' > "$work/README.md"
  printf 'plain text\n' > "$work/data.txt"
  printf '#!/usr/bin/env bash\necho real\n' > "$work/real.sh"

  cat > "$work/bin/shellcheck" <<'STUB'
#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in
    --version) echo "fake 0.0.0"; exit 0 ;;
    /*) echo "SAW:$(basename "$arg")" ;;
  esac
done
exit 0
STUB
  chmod +x "$work/bin/shellcheck"
  printf 'node_modules/\n' > "$work/.gitignore"
  git -C "$work" init -q -b test-branch 2>/dev/null
  git -C "$work" add -A 2>/dev/null

  ORIGPATH="$PATH"
  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:$ORIGPATH'
    export PATH
    # shellcheck source=/dev/null
    . '$ADAPTER'
    run_lint 2>&1
  "
  [ "$status" -eq 0 ]
  [[ "$output" == *"SAW:real.sh"* ]]
  [[ "$output" != *"SAW:README.md"* ]]
  [[ "$output" != *"SAW:data.txt"* ]]
}

@test "AC-GATE-SHELL-SCOPE-01: an empty project reports PASS without invoking shellcheck" {
  # Anti-vacuity companion: "no files" must be a distinguishable outcome from
  # "files were checked and were clean", and it must not shell out at all.
  local work
  work="$(mktemp -d)"
  mkdir -p "$work/bin"

  cat > "$work/bin/shellcheck" <<'STUB'
#!/usr/bin/env bash
echo "SHELLCHECK_WAS_CALLED"
exit 0
STUB
  chmod +x "$work/bin/shellcheck"
  printf 'node_modules/\n' > "$work/.gitignore"
  git -C "$work" init -q -b test-branch 2>/dev/null
  git -C "$work" add -A 2>/dev/null

  ORIGPATH="$PATH"
  run bash -c "
    cd '$work' || exit 9
    PATH='$work/bin:$ORIGPATH'
    export PATH
    # shellcheck source=/dev/null
    . '$ADAPTER'
    run_lint 2>&1
  "
  [ "$status" -eq 0 ]
  [[ "$output" != *"SHELLCHECK_WAS_CALLED"* ]]
}
