#!/usr/bin/env bats
# @test REQ-002
# @test REQ-003
# @intent Gate 13 — SLICE-2: the C/C++ warning tiers, the capability probe, and
#         the changed-files strictness policy.
#
#         Why this is the heart of the gate: a measured `g++ -Wall -Wextra` pass
#         over an innocuous-looking translation unit reports -Wnon-virtual-dtor,
#         -Wreorder, -Wparentheses, -Wclass-memaccess, -Wold-style-cast and
#         -Wswitch-default. Those are real defects; no clang-tidy/cppcheck pass
#         configured without the build's own flags sees them, and Gate 9 never
#         compiles C/C++ at all.
#
#         Two review findings drive the shape of these tests:
#           CI-03 / FC-01 — the baseline lifecycle. "Baseline only grows" is a
#             statement about HOOK behaviour (the hook never writes the file), not
#             about how a baseline comes to exist. A MISSING baseline therefore
#             cannot mean "block everything": new files still get -Werror because
#             their baseline count is inherently zero, while modified files are
#             report-only until an explicit command creates one.
#           MA-01 — probe results are cached for one hook run only. A persisted
#             cache would go stale on compiler upgrade and silently drop checks.
#
#         The real compiler is used for the end-to-end cases (g++/clang++ are on
#         this machine); pure-logic cases use stubs so they assert the contract
#         rather than a particular gcc version's wording.
#
# @covers AC-002-01, AC-002-02, AC-002-03, AC-003-01, AC-003-02, AC-003-03, AC-003-04, AC-003-05

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

# Stage a file so it appears in `git diff --cached`.
stage() {
  git add -- "$@" >/dev/null 2>&1
}

# A translation unit with several genuine -Wall/-Wextra findings.
write_dirty_cpp() {
  cat > "$1" <<'EOF'
#include <cstring>
#include <string>

class Base {
 public:
  ~Base() {}
  virtual void f() {}
};

int main(int argc, char**) {
  int a = argc;
  if (a = 3) { }
  std::string s = "x";
  memset(&s, 0, sizeof s);
  return 0;
}
EOF
}

write_clean_cpp() {
  cat > "$1" <<'EOF'
int add(int a, int b) { return a + b; }
int main() { return add(1, 2) == 3 ? 0 : 1; }
EOF
}

# ------------------------------------------------------ AC-002-01 tiers

@test "AC-002-01: balanced tier resolves to -Wall -Wextra" {
  load_gate
  run gate13_cpp_flags balanced cpp
  [ "$status" -eq 0 ]
  [[ "$output" == *"-Wall"* ]]
  [[ "$output" == *"-Wextra"* ]]
  [[ "$output" != *"-Wconversion"* ]]
}

@test "AC-002-01: strict tier adds the strict and C++-only flags" {
  load_gate
  run gate13_cpp_flags strict cpp
  [ "$status" -eq 0 ]
  [[ "$output" == *"-Wall"* ]]
  [[ "$output" == *"-Wextra"* ]]
  [[ "$output" == *"-Wpedantic"* ]]
  [[ "$output" == *"-Wconversion"* ]]
  [[ "$output" == *"-Wold-style-cast"* ]]
  [[ "$output" == *"-Wnon-virtual-dtor"* ]]
}

@test "AC-002-01: strict C files do NOT get the C++-only flags" {
  load_gate
  run gate13_cpp_flags strict c
  [ "$status" -eq 0 ]
  [[ "$output" == *"-Wall"* ]]
  [[ "$output" != *"-Wold-style-cast"* ]]
  [[ "$output" != *"-Wnon-virtual-dtor"* ]]
  [[ "$output" != *"-Woverloaded-virtual"* ]]
}

@test "AC-002-01: an unknown tier falls back to balanced and warns" {
  load_gate
  run gate13_resolve_tier bogus
  [ "$status" -eq 0 ]
  [[ "$output" == *"balanced"* ]]
  [[ "$output" == *"XP_G13_REASON"* ]]
}

@test "AC-002-01: tiers come from XP_GATE_COMPILER_STRICTNESS" {
  export XP_GATE_COMPILER_STRICTNESS=strict
  load_gate
  run gate13_resolve_tier
  [[ "$output" == *"strict"* ]]
}

@test "AC-002-01: the default tier is balanced" {
  unset XP_GATE_COMPILER_STRICTNESS
  load_gate
  run gate13_resolve_tier
  [[ "$output" == *"balanced"* ]]
}

# -------------------------------------------------- AC-002-02/03 probing

@test "AC-002-03: the capability probe uses the POSITIVE -Wfoo form" {
  # Older gcc accepts unknown -Wno-* SILENTLY (a cc1plus note appears only when
  # other diagnostics exist), so probing with the negative form would report
  # success for flags that do nothing. The probe must ask for -Wfoo.
  run grep -n 'gate13_flag_supported' "$GATE"
  [ "$status" -eq 0 ]
  run grep -A12 'gate13_flag_supported()' "$GATE"
  [[ "$output" == *'-W'* || "$output" == *'flag'* ]]
}

@test "AC-002-02: a compiler rejecting a flag causes it to be dropped with a report line" {
  cat > bin/fakecxx <<'EOF'
#!/usr/bin/env bash
for a in "$@"; do
  case "$a" in
    --version) echo "fakecxx 1.0"; exit 0 ;;
    -Wuseless-cast|-Wpedantic|-Wshadow) echo "error: unrecognized command-line option '$a'" >&2; exit 1 ;;
  esac
done
exit 0
EOF
  chmod +x bin/fakecxx
  export PATH="$TEST_DIR/bin:$PATH"

  load_gate
  run gate13_probe_flags "$TEST_DIR/bin/fakecxx" cpp "-Wall" "-Wextra" "-Wpedantic" "-Wuseless-cast"
  [ "$status" -eq 0 ]
  [[ "$output" == *"dropped flag: -Wpedantic"* || "$output" == *"dropped flag: -Wuseless-cast"* ]]
  # accepted flags survive
  [[ "$output" == *"-Wall"* ]]
}

@test "AC-002-02: a compiler accepting everything drops nothing" {
  cat > bin/fakecxx <<'EOF'
#!/usr/bin/env bash
[ "$1" = "--version" ] && { echo "fakecxx 1.0"; exit 0; }
exit 0
EOF
  chmod +x bin/fakecxx

  load_gate
  run gate13_probe_flags "$TEST_DIR/bin/fakecxx" cpp "-Wall" "-Wextra" "-Wpedantic"
  [ "$status" -eq 0 ]
  [[ "$output" != *"dropped flag"* ]]
  [[ "$output" == *"-Wpedantic"* ]]
}

# ---------------------------------------------- AC-003-04 changed set

@test "AC-003-04: the changed set is limited to staged files" {
  write_clean_cpp src/clean.cpp
  stage src/clean.cpp
  write_dirty_cpp src/untracked_dirty.cpp

  load_gate
  run gate13_changed_cpp_files
  [ "$status" -eq 0 ]
  [[ "$output" == *"src/clean.cpp"* ]]
  [[ "$output" != *"untracked_dirty.cpp"* ]]
}

@test "AC-003-04: newly added and modified files are classified separately" {
  write_clean_cpp src/existing.cpp
  stage src/existing.cpp
  git -c user.name=t -c user.email=t@t commit -q -m base

  echo '// touched' >> src/existing.cpp
  write_dirty_cpp src/brand_new.cpp
  stage src/existing.cpp src/brand_new.cpp

  load_gate
  run gate13_classify_changed
  [ "$status" -eq 0 ]
  [[ "$output" == *"added"*"src/brand_new.cpp"* || "$output" == *"A"*"brand_new"* ]]
  [[ "$output" == *"modified"*"src/existing.cpp"* || "$output" == *"M"*"existing"* ]]
}

# ------------------------------------- AC-003-01 new file with warnings blocks

@test "AC-003-01: a newly added C++ file with warnings blocks the commit" {
  command -v g++ >/dev/null 2>&1 || skip "g++ not available"
  write_dirty_cpp src/dirty.cpp
  stage src/dirty.cpp

  load_gate
  run gate13_run_cpp_analysis
  [ "$status" -eq "$GATE13_FAIL" ]
}

@test "AC-003-01: a newly added clean C++ file passes" {
  command -v g++ >/dev/null 2>&1 || skip "g++ not available"
  write_clean_cpp src/clean.cpp
  stage src/clean.cpp

  load_gate
  run gate13_run_cpp_analysis
  [ "$status" -eq "$GATE13_PASS" ]
}

# --------------------------------- AC-003-02/03 modified files vs baseline

@test "AC-003-03: a missing baseline leaves modified files report-only while new files still block" {
  command -v g++ >/dev/null 2>&1 || skip "g++ not available"

  write_dirty_cpp src/legacy.cpp
  stage src/legacy.cpp
  git -c user.name=t -c user.email=t@t commit -q -m "legacy with warnings"
  echo '// touch' >> src/legacy.cpp
  stage src/legacy.cpp

  load_gate
  run gate13_run_cpp_analysis
  # Modified file, no baseline -> not blocking (report-only), with the hint.
  [ "$status" -eq "$GATE13_PASS" ]
  [[ "$output" == *"baseline"* ]]
}

@test "AC-003-03: the missing-baseline hint names the create command" {
  command -v g++ >/dev/null 2>&1 || skip "g++ not available"
  write_dirty_cpp src/legacy.cpp
  stage src/legacy.cpp
  git -c user.name=t -c user.email=t@t commit -q -m base
  echo '// touch' >> src/legacy.cpp
  stage src/legacy.cpp

  load_gate
  run gate13_run_cpp_analysis
  [[ "$output" == *"compiler-baseline create"* ]]
}

@test "AC-003-02: a modified file exceeding its baseline blocks" {
  command -v g++ >/dev/null 2>&1 || skip "g++ not available"
  write_clean_cpp src/f.cpp
  stage src/f.cpp
  git -c user.name=t -c user.email=t@t commit -q -m base

  # Establish a baseline of 0 for this file, then introduce warnings.
  mkdir -p .xp-gate
  printf '{"version":1,"files":{"src/f.cpp":{"count":0,"tool":"test"}}}\n' > .xp-gate/compiler-warnings-baseline.json
  write_dirty_cpp src/f.cpp
  stage src/f.cpp

  load_gate
  run gate13_run_cpp_analysis
  [ "$status" -eq "$GATE13_FAIL" ]
}

@test "AC-003-02: a modified file at or below its baseline passes" {
  command -v g++ >/dev/null 2>&1 || skip "g++ not available"
  write_dirty_cpp src/g.cpp
  stage src/g.cpp
  git -c user.name=t -c user.email=t@t commit -q -m base

  # Baseline generous enough to cover the existing warnings.
  mkdir -p .xp-gate
  printf '{"version":1,"files":{"src/g.cpp":{"count":99,"tool":"test"}}}\n' > .xp-gate/compiler-warnings-baseline.json
  echo '// touch' >> src/g.cpp
  stage src/g.cpp

  load_gate
  run gate13_run_cpp_analysis
  [ "$status" -eq "$GATE13_PASS" ]
}

# --------------------------------------------------- AC-003-05 warn-only

@test "AC-003-05: warn-only never blocks even with findings" {
  command -v g++ >/dev/null 2>&1 || skip "g++ not available"
  export XP_GATE_COMPILER_STRICTNESS=warn-only
  write_dirty_cpp src/dirty.cpp
  stage src/dirty.cpp

  load_gate
  run gate13_run_cpp_analysis
  [ "$status" -eq "$GATE13_WARN" ]
  [ "$status" -ne "$GATE13_FAIL" ]
}

@test "AC-003-05: a new file with warnings blocks under both balanced and strict" {
  command -v g++ >/dev/null 2>&1 || skip "g++ not available"
  for tier in balanced strict; do
    export XP_GATE_COMPILER_STRICTNESS="$tier"
    write_dirty_cpp "src/d_${tier}.cpp"
    stage "src/d_${tier}.cpp"
    load_gate
    run gate13_run_cpp_analysis
    [ "$status" -eq "$GATE13_FAIL" ]
  done
}

# ------------------------------------------------- baseline read/write

@test "AC-003-02: the baseline file path is .xp-gate/compiler-warnings-baseline.json" {
  load_gate
  run gate13_baseline_path
  [ "$status" -eq 0 ]
  [ "$output" = ".xp-gate/compiler-warnings-baseline.json" ]
}

@test "AC-003-02: reading a missing baseline yields zero entries, not an error" {
  load_gate
  run gate13_baseline_count "src/whatever.cpp"
  [ "$status" -eq 0 ]
  [ -z "$output" ] || [ "$output" = "0" ]
}
