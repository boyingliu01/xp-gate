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
# @covers AC-005-01, AC-005-02, AC-006-01, AC-006-02, AC-008-01, AC-008-03

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

@test "AC-008-01: the gate chain includes Gate 13 and binds it to its script" {
  # #798: "pre-commit invokes Gate 13" is now two facts in two places, because
  # the chain's ORDER became data and the number became a LABEL bound by the
  # registry. Asserting a line in pre-commit would pin the pre-refactor shape
  # rather than the property this AC is about.
  #   1. gate-driver.sh lists 13 in XP_GATE_ORDER  -> it actually runs
  #   2. gate-registry.sh binds 13 to its script   -> it runs the right code
  run grep -qE '^XP_GATE_ORDER=.*(\s)13(\s)' "$REPO_ROOT/githooks/gate-driver.sh"
  [ "$status" -eq 0 ]
  run grep -q 'compiler-strictness|13|gate-13-compiler-strictness.sh' \
    "$REPO_ROOT/githooks/gate-registry.sh"
  [ "$status" -eq 0 ]
}

@test "AC-008-01: the Gate 13 execution position comes AFTER Gate 12's" {
  # #798: ordering is DATA (XP_GATE_ORDER in gate-driver.sh), not the physical
  # order of blocks in a file. Compare positions IN THAT LIST -- which is exactly
  # the sequence the driver walks. Position 12b/12c must not be mistaken for 12,
  # hence the exact-match grep rather than a substring test.
  local order pos12 pos13
  order=$(grep -E '^XP_GATE_ORDER=' "$REPO_ROOT/githooks/gate-driver.sh" \
    | head -1 | sed 's/^XP_GATE_ORDER=//; s/"//g')
  [ -n "$order" ]
  pos12=$(printf '%s\n' "$order" | tr ' ' '\n' | grep -n '^12$' | cut -d: -f1)
  pos13=$(printf '%s\n' "$order" | tr ' ' '\n' | grep -n '^13$' | cut -d: -f1)
  [ -n "$pos12" ]
  [ -n "$pos13" ]
  [ "$pos13" -gt "$pos12" ]
}

@test "AC-008-01: the deploy manifest registers the gate script" {
  # install.sh no longer names each gate script inline: it sources
  # githooks/deploy-manifest.sh (REQ-DEPLOY-001) and installs DEPLOY_GATE_FILES.
  # The manifest IS the registration now, so this AC has to read it there --
  # grepping install.sh would assert against a list that moved on purpose.
  run grep -q "'gate-13-compiler-strictness.sh'" "$REPO_ROOT/githooks/deploy-manifest.sh"
  [ "$status" -eq 0 ]
  # Anti-vacuity: the manifest must still be what install.sh installs from.
  run grep -q 'DEPLOY_GATE_FILES' "$REPO_ROOT/githooks/install.sh"
  [ "$status" -eq 0 ]
}

@test "AC-008-01: check-hook-mirror.sh registers the gate-13 mirror (SHIP-phase work, done)" {
  # Mirroring into src/npm-package/** was deliberately deferred out of the BUILD
  # phase: writing there collided with the parallel refactor branch. The mirror
  # now exists and is guarded, so the gate must appear in BOTH lists the checker
  # iterates -- HOOK_MIRROR_FILES (hooks/ copy) and ROOT_MIRROR_FILES (root copy).
  # One occurrence would leave whichever list is missing silently unguarded.
  run grep -c 'gate-13-compiler-strictness' "$REPO_ROOT/scripts/check-hook-mirror.sh"
  [ "$output" -eq 2 ]

  # And the mirror files themselves must exist, or the checker fails on them.
  [ -f "$REPO_ROOT/src/npm-package/hooks/gate-13-compiler-strictness.sh" ]
  [ -f "$REPO_ROOT/src/npm-package/gate-13-compiler-strictness.sh" ]
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
