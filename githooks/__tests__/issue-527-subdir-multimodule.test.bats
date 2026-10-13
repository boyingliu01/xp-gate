#!/usr/bin/env bats
# @test REQ-A-04
# @intent #527: the root-marker short-circuit (#515) assumed a root marker means
#         "single project". For two ecosystems that assumption is wrong by
#         convention: Gradle multi-module repos ALWAYS have a root build.gradle
#         (plus settings.gradle with include), and CMake projects routinely
#         have a root CMakeLists.txt that only wires subdirectories. The old
#         short-circuit pinned PROJECT_SUBDIR="" for both, so Gates 1-9 ran
#         from the repo root against module-relative paths. Disambiguation:
#         Gradle root + settings.gradle(.kts) containing include → derivation
#         stays on; CMake root + a nested */CMakeLists.txt → derivation stays
#         on. Single-project repos (no such declaration) keep the old
#         short-circuit; XP_GATE_ROOT_SHORTCIRCUIT=1 restores it explicitly
#         for repos that depended on it (FC-08 migration).
# @covers AC-A-04-01, AC-A-04-02

HOOK="$BATS_TEST_DIRNAME/../pre-commit"

setup() {
  sandbox="$(mktemp -d)"
  cat > "$sandbox/drive.sh" <<'DRIVE'
cd "$SBX_REPO" || exit 1
PROJECT_LANGS="$SBX_LANGS"
CHANGED_FILES="$SBX_CHANGED"
# shellcheck source=/dev/null
source "$SBX_SECTION"
echo "SUBDIR=[$PROJECT_SUBDIR]"
DRIVE
  export SBX_SECTION="$sandbox/section.sh" SBX_DRIVE="$sandbox/drive.sh"
  SBX_REPO="$sandbox/repo"
  mkdir -p "$SBX_REPO"
  export SBX_REPO SBX_LANGS="java" SBX_CHANGED=""
}

teardown() {
  if [ -n "${sandbox:-}" ]; then
    rm -rf "$sandbox"
    sandbox=""
  fi
  unset SBX_REPO SBX_LANGS SBX_CHANGED SBX_SECTION SBX_DRIVE sandbox XP_GATE_ROOT_SHORTCIRCUIT
}

# Extract the hook's REAL derivation block (the same anchors the #515 suite
# uses) so these tests lock the hook's behaviour, not a re-implementation.
extract_section() {
  sed -n '/# ---- Derive PROJECT_SUBDIR from changed file paths/,/# ---- Subdirectory fallback/p' "$HOOK" \
    | sed '$d' > "$SBX_SECTION"
  [ -s "$SBX_SECTION" ] && grep -q "_detect_subdir" "$SBX_SECTION"
}

# ── AC-A-04-01: Gradle multi-module ──────────────────────────────────────────

@test "AC-A-04-01: root build.gradle + settings.gradle include + nested module derives the module" {
  extract_section || fail "derivation block extraction failed (anchors moved?)"
  printf 'apply plugin: "java"\n' > "$SBX_REPO/build.gradle"
  printf "include ':services:api'\n" > "$SBX_REPO/settings.gradle"
  mkdir -p "$SBX_REPO/services/api/src/main/java"
  printf 'apply plugin: "java"\n' > "$SBX_REPO/services/api/build.gradle"
  SBX_CHANGED="services/api/src/main/java/App.java" run bash "$SBX_DRIVE"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SUBDIR DETECTED"* ]]
  [[ "$output" == *"SUBDIR=[services/api]"* ]]
}

@test "AC-A-04-01: Kotlin-DSL settings.gradle.kts include() also derives the module" {
  extract_section || fail "derivation block extraction failed (anchors moved?)"
  printf 'plugins { java }\n' > "$SBX_REPO/build.gradle.kts"
  printf 'include(":app")\n' > "$SBX_REPO/settings.gradle.kts"
  mkdir -p "$SBX_REPO/app/src/main/kotlin"
  printf 'plugins { java }\n' > "$SBX_REPO/app/build.gradle.kts"
  SBX_LANGS="kotlin" SBX_CHANGED="app/src/main/kotlin/Main.kt" run bash "$SBX_DRIVE"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SUBDIR=[app]"* ]]
}

@test "AC-A-04-01 regression: root build.gradle WITHOUT settings.gradle include keeps the short-circuit" {
  # Single-project Gradle repo (or a multi-module repo whose settings.gradle
  # does not use include): the #515 short-circuit behaviour is preserved.
  extract_section || fail "derivation block extraction failed (anchors moved?)"
  printf 'apply plugin: "java"\n' > "$SBX_REPO/build.gradle"
  mkdir -p "$SBX_REPO/services/api/src/main/java"
  printf 'apply plugin: "java"\n' > "$SBX_REPO/services/api/build.gradle"
  SBX_CHANGED="services/api/src/main/java/App.java" run bash "$SBX_DRIVE"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SUBDIR=[]"* ]]
}

@test "AC-A-04-01: settings.gradle without include (e.g. pluginManagement only) keeps the short-circuit" {
  extract_section || fail "derivation block extraction failed (anchors moved?)"
  printf 'apply plugin: "java"\n' > "$SBX_REPO/build.gradle"
  printf 'pluginManagement { repositories { gradlePluginPortal() } }\n' > "$SBX_REPO/settings.gradle"
  mkdir -p "$SBX_REPO/services/api/src/main/java"
  printf 'apply plugin: "java"\n' > "$SBX_REPO/services/api/build.gradle"
  SBX_CHANGED="services/api/src/main/java/App.java" run bash "$SBX_DRIVE"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SUBDIR=[]"* ]]
}

# ── AC-A-04-02: CMake subdirectories ─────────────────────────────────────────

@test "AC-A-04-02: root CMakeLists.txt + nested */CMakeLists.txt derives the nested module" {
  extract_section || fail "derivation block extraction failed (anchors moved?)"
  printf 'cmake_minimum_required(VERSION 3.16)\nadd_subdirectory(lib)\n' > "$SBX_REPO/CMakeLists.txt"
  mkdir -p "$SBX_REPO/lib/src"
  printf 'add_library(lib lib.cpp)\n' > "$SBX_REPO/lib/CMakeLists.txt"
  SBX_LANGS="cpp" SBX_CHANGED="lib/src/lib.cpp" run bash "$SBX_DRIVE"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SUBDIR=[lib]"* ]]
}

@test "AC-A-04-02 regression: root CMakeLists.txt without a nested one keeps the short-circuit" {
  extract_section || fail "derivation block extraction failed (anchors moved?)"
  printf 'cmake_minimum_required(VERSION 3.16)\nadd_executable(app main.cpp)\n' > "$SBX_REPO/CMakeLists.txt"
  mkdir -p "$SBX_REPO/src"
  printf 'int main() { return 0; }\n' > "$SBX_REPO/src/main.cpp"
  SBX_LANGS="cpp" SBX_CHANGED="src/main.cpp" run bash "$SBX_DRIVE"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SUBDIR=[]"* ]]
}

@test "AC-A-04-02 regression: CMakeLists.txt inside .git/node_modules is not a nested module (prune, FC-04)" {
  extract_section || fail "derivation block extraction failed (anchors moved?)"
  printf 'cmake_minimum_required(VERSION 3.16)\nadd_executable(app main.cpp)\n' > "$SBX_REPO/CMakeLists.txt"
  # Vendored/vcs copies must not read as "the root file is a wiring file".
  mkdir -p "$SBX_REPO/.git" "$SBX_REPO/node_modules/pkg/lib"
  printf 'x\n' > "$SBX_REPO/.git/CMakeLists.txt"
  printf 'x\n' > "$SBX_REPO/node_modules/pkg/lib/CMakeLists.txt"
  SBX_LANGS="cpp" SBX_CHANGED="src/main.cpp" run bash "$SBX_DRIVE"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SUBDIR=[]"* ]]
}

# ── FC-08 migration escape hatch ─────────────────────────────────────────────

@test "XP_GATE_ROOT_SHORTCIRCUIT=1 restores the old short-circuit for Gradle multi-module" {
  extract_section || fail "derivation block extraction failed (anchors moved?)"
  printf 'apply plugin: "java"\n' > "$SBX_REPO/build.gradle"
  printf "include ':services:api'\n" > "$SBX_REPO/settings.gradle"
  mkdir -p "$SBX_REPO/services/api/src/main/java"
  printf 'apply plugin: "java"\n' > "$SBX_REPO/services/api/build.gradle"
  SBX_CHANGED="services/api/src/main/java/App.java" XP_GATE_ROOT_SHORTCIRCUIT=1 run bash "$SBX_DRIVE"
  echo "$output"
  [ "$status" -eq 0 ]
  [[ "$output" == *"SUBDIR=[]"* ]]
}

# ── structural pins: the disambiguation is wired, not aspirational ───────────

@test "structural: the short-circuit block carries the #527 disambiguation predicates" {
  run sed -n '/# #515: when the repo ROOT/,/_subdir_set=/p' "$HOOK"
  [ "$status" -eq 0 ]
  block="$output"
  [ -n "$block" ] || fail "short-circuit block anchors moved — extraction empty"
  # Both ecosystem predicates are called from the short-circuit decision.
  echo "$block" | grep -qF '_gradle_multi_module_root' || fail "gradle multi-module predicate not wired"
  echo "$block" | grep -qF '_cmake_multi_module_root' || fail "cmake multi-module predicate not wired"
  # The migration escape hatch is honored.
  echo "$block" | grep -qF 'XP_GATE_ROOT_SHORTCIRCUIT' || fail "migration override missing from short-circuit"
  # The #527 known-limitation comment is gone (the limitation is now handled).
  if echo "$block" | grep -qF 'Known limitation (#527)'; then
    fail "stale known-limitation comment still present"
  fi
  # The predicates themselves exist in the derivation block the sandbox runs.
  grep -q '_gradle_multi_module_root()' "$SBX_SECTION" 2>/dev/null || {
    extract_section || true
    grep -q '_gradle_multi_module_root()' "$SBX_SECTION" || fail "gradle predicate not defined in derivation block"
  }
  extract_section || true
  grep -q '_cmake_multi_module_root()' "$SBX_SECTION" || fail "cmake predicate not defined in derivation block"
}
