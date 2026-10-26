#!/usr/bin/env bats
# @test REQ-005
# @test REQ-008
# @intent Gate 13 — SLICE-4 (`gcc -fanalyzer`, C only, opt-in) and SLICE-5 (the
#         registration wiring).
#
#         SLICE-4: `-fanalyzer` is a real path-sensitive analyser that finds
#         use-after-free / double-free / NULL dereference that no warning flag
#         reaches. It is OFF by default for three measured reasons: it is slow
#         (seconds per TU, not milliseconds), it is GCC-only (clang has no
#         equivalent flag and errors out), and it emits NOTHING under
#         `-fsyntax-only` — it needs real code generation, so it produces object
#         files that must be discarded into a temp dir, never the work tree.
#         Requirement round 2 (feasibility FC-04) scoped it to C files only.
#
#         SLICE-5: the gate is worthless if nothing calls it. These cases pin the
#         registration in githooks/pre-commit, githooks/install.sh and
#         scripts/check-hook-mirror.sh — the three places a new gate must appear.
#         The whole point of this sprint's conflict-minimisation constraint is
#         that the pre-commit change is a TAIL APPEND after Gate 12, touching no
#         existing gate line.
#
# @covers AC-005-01, AC-005-02, AC-008-01, AC-008-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-13-compiler-strictness.sh"
  TEST_DIR="$(mktemp -d)"
  export TEST_DIR

  cd "$TEST_DIR" || return 1
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  git config core.hooksPath .git/hooks
  mkdir -p bin src
}

teardown() {
  cd / || return 1
  rm -rf "$TEST_DIR"
}

load_gate() {
  # shellcheck source=/dev/null
  source "$GATE"
}

# -------------------------------------------------- AC-005-01 opt-in

@test "AC-005-01: -fanalyzer is OFF by default" {
  unset XP_GATE_COMPILER_ANALYZER
  load_gate
  run gate13_analyzer_enabled
  [ "$status" -ne 0 ]
}

@test "AC-005-01: XP_GATE_COMPILER_ANALYZER=1 turns it on" {
  export XP_GATE_COMPILER_ANALYZER=1
  load_gate
  run gate13_analyzer_enabled
  [ "$status" -eq 0 ]
}

@test "AC-005-01: XP_GATE_COMPILER_ANALYZER=0 keeps it off" {
  export XP_GATE_COMPILER_ANALYZER=0
  load_gate
  run gate13_analyzer_enabled
  [ "$status" -ne 0 ]
}

# ------------------------------------- AC-005-02 C-only, gcc-only

@test "AC-005-02: -fanalyzer applies to C files only, never C++" {
  write_cpp() { printf 'int main(){return 0;}\n' > "$1"; }
  write_c() { printf 'int main(void){return 0;}\n' > "$1"; }
  write_cpp src/a.cpp
  write_c src/b.c
  git add -A >/dev/null 2>&1

  load_gate
  run gate13_analyzer_files
  [ "$status" -eq 0 ]
  [[ "$output" == *"b.c"* ]]
  [[ "$output" != *"a.cpp"* ]]
}

@test "AC-005-02: a compiler without -fanalyzer support disables the stage with a report" {
  cat > bin/nogcc <<'EOF'
#!/usr/bin/env bash
for a in "$@"; do
  case "$a" in
    --version) echo "clang version 23.1.2"; exit 0 ;;
    -fanalyzer) echo "error: unknown argument '-fanalyzer'" >&2; exit 1 ;;
  esac
done
exit 0
EOF
  chmod +x bin/nogcc

  load_gate
  run gate13_analyzer_supported "$TEST_DIR/bin/nogcc"
  [ "$status" -ne 0 ]
}

@test "AC-005-02: the analyzer compiles with -c into a temp dir, never the work tree" {
  # -fanalyzer silently does nothing under -fsyntax-only (measured), so it must
  # compile for real. That means -c (no link) and -o into a temp dir: a bare
  # `gcc -fanalyzer foo.c` would drop a.out into the developer's tree.
  grep -q 'fanalyzer -c -o' "$GATE"
  grep -q 'workdir=.*TMPDIR' "$GATE"
}

# ------------------------------------------- AC-008-01 registration

@test "AC-008-01: githooks/pre-commit invokes Gate 13" {
  run grep -n 'gate-13-compiler-strictness' "$REPO_ROOT/githooks/pre-commit"
  [ "$status" -eq 0 ]
}

@test "AC-008-01: the pre-commit Gate 13 execution block appears AFTER Gate 12's" {
  # Anchor on EXECUTION lines only: Gate 12 sources its script, Gate 13 prints
  # the check banner. The summary/JSON lines that also mention Gate 12 come later
  # in the file for both gates and would give a meaningless answer.
  local l12 l13
  l12=$(grep -n 'source .*gate-12-file-hygiene\.sh' "$REPO_ROOT/githooks/pre-commit" | head -1 | cut -d: -f1)
  l13=$(grep -n 'Gate 13: Compiler Strictness Check\.\.\.' "$REPO_ROOT/githooks/pre-commit" | head -1 | cut -d: -f1)
  [ -n "$l12" ]
  [ -n "$l13" ]
  [ "$l13" -gt "$l12" ]
}

@test "AC-008-01: githooks/install.sh registers the gate script" {
  run grep -n 'gate-13-compiler-strictness' "$REPO_ROOT/githooks/install.sh"
  [ "$status" -eq 0 ]
}

@test "AC-008-01: check-hook-mirror.sh does NOT demand a mirror yet (SHIP-phase work)" {
  # Mirroring into src/npm-package/** is deliberately OUT of this sprint's scope:
  # writing there collides with the parallel refactor branch, and the mirror must
  # be created byte-identically by the sync step at SHIP time. Listing gate-13 in
  # check-hook-mirror.sh now would make the checker fail on a missing mirror, so
  # the registration is intentionally deferred and pinned by this test.
  run grep -c 'gate-13-compiler-strictness' "$REPO_ROOT/scripts/check-hook-mirror.sh"
  [ "$output" -eq 0 ]
}

# ------------------------------------------ AC-008-03 no mirror writes

@test "AC-008-03: the gate does not modify src/npm-package mirrors" {
  # Mirror sync is a SHIP-phase concern; writing under src/npm-package in BUILD
  # risks colliding with the parallel refactor branch.
  run grep -rn 'src/npm-package' "$GATE"
  [ "$status" -ne 0 ]
}

@test "AC-008-03: the pre-commit Gate 13 block writes nothing under src/npm-package" {
  local block
  block=$(sed -n '/GATE 13/,/GATE 13 END\|^fi$/p' "$REPO_ROOT/githooks/pre-commit" 2>/dev/null)
  [ -n "$block" ] || skip "block marker not present yet"
  [[ "$block" != *"src/npm-package"* ]]
}
