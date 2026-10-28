#!/usr/bin/env bash
# ============================================================================
# GATE 13: Compiler Strictness Check
#
# The compiler is the first and cheapest static analysis tool for any compiled
# language, and XP-Gate historically never used it that way: `cpp.sh` only runs
# clang-tidy/cppcheck over the first 20 files, and Gate 9's build-integrity half
# is TypeScript-and-Maven only. A measured `g++ -Wall -Wextra` pass over an
# innocuous-looking translation unit reports -Wnon-virtual-dtor, -Wreorder,
# -Wparentheses, -Wclass-memaccess, -Wold-style-cast and -Wswitch-default —
# real defects no linter in the chain is positioned to see. Bare `javac`
# likewise reports NOTHING for raw types; `-Xlint:all` does, and an identical
# Java file went from "0 diagnostics" to a hard error under `-Werror`.
#
# Design: docs/plans/2026-10-26-gate-13-compiler-strictness-design.md
# Requirement rounds 1-3 (.sprint-state/) — review findings folded in below are
# tagged with their review id (CI-xx architecture, MC-xx technical, FC-xx
# feasibility).
#
# ── VERDICT CONTRACT ────────────────────────────────────────────────────────
# Inherited from pre-commit's established java.sh / powershell.sh protocol (#507):
#   0 = PASS      every compiled file clean or within its baseline
#   1 = FAIL      new warnings on changed files (a real finding) -> commit blocked
#   2 = BLOCK     tool RAN but its output is untrustworthy (fail-closed)
#   3 = WARN      compiler absent / cross-compiling / timeout / warn-only findings
#                 -> counted IN the scoring denominator, never PASS
#
# A TIMEOUT is always 3, never 2 (architecture MA-03): a timeout is incomplete
# coverage, not a wrong conclusion, and promoting it to BLOCK would turn machine
# load into a failed commit. 2 is reserved for the case where the tool finished
# but contradicted itself or emitted unparseable output.
#
# Reasons cross the command-substitution subshell as an `XP_G13_REASON: ...`
# stdout line — an `export` inside this file can NEVER reach the caller, whose
# `$(...)` discards the child environment.
# ============================================================================

# ── Verdict codes (pinned by the bats suite) ────────────────────────────────
# shellcheck disable=SC2034  # public contract: pre-commit reads these by name
GATE13_PASS=0
# shellcheck disable=SC2034  # emitted from SLICE-2 onward (C/C++ warning findings)
GATE13_FAIL=1
# shellcheck disable=SC2034  # public contract
GATE13_BLOCK=2
# shellcheck disable=SC2034  # public contract
GATE13_WARN=3

GATE13_DEFAULT_TIMEOUT=120

# ---------------------------------------------------------------------------
# Reason channel. Mirrors java.sh's XP_G1_REASON protocol so pre-commit can
# surface a SKIP/WARN cause without losing the verdict code.
#
# Written to stderr, NOT stdout: the helpers below are also called in command
# substitution (`budget=$(gate13_timeout_budget)`), and a stdout reason would be
# captured INTO the value — turning a valid budget into "XP_G13_REASON: ... 120"
# and breaking every numeric consumer. pre-commit reads the reason with 2>&1.
# ---------------------------------------------------------------------------
gate13_reason() {
  printf 'XP_G13_REASON: %s\n' "$*" >&2
}

# ---------------------------------------------------------------------------
# AC-007-01 — timeout budget.
# Precedence (feasibility FC-02): XP_GATE_COMPILER_TIMEOUT > .xp-gate/compiler-gate-timeout
# > 120s. The env var wins so CI can raise the budget for a large changeset
# without editing a tracked file. An unreadable/invalid override WARNs and falls
# back — an unreadable override must never silently disable the budget.
# ---------------------------------------------------------------------------
gate13_timeout_budget() {
  local file=".xp-gate/compiler-gate-timeout" val=""

  if [ -n "${XP_GATE_COMPILER_TIMEOUT:-}" ]; then
    val=$(printf '%s' "$XP_GATE_COMPILER_TIMEOUT" | tr -d '[:space:]')
    case "$val" in
      ''|*[!0-9]*|0)
        gate13_reason "invalid XP_GATE_COMPILER_TIMEOUT='${XP_GATE_COMPILER_TIMEOUT}' (expected a positive integer), falling back to ${GATE13_DEFAULT_TIMEOUT}s"
        echo "$GATE13_DEFAULT_TIMEOUT"
        return 0
        ;;
      *) echo "$val"; return 0 ;;
    esac
  fi

  if [ -f "$file" ]; then
    val=$(tr -d '[:space:]' < "$file")
  fi

  case "$val" in
    '')
      echo "$GATE13_DEFAULT_TIMEOUT"
      ;;
    *[!0-9]*|0)
      gate13_reason "invalid $file value '${val}' (expected a positive integer), falling back to ${GATE13_DEFAULT_TIMEOUT}s"
      echo "$GATE13_DEFAULT_TIMEOUT"
      ;;
    *) echo "$val" ;;
  esac
}

# ---------------------------------------------------------------------------
# AC-007-02 / AC-006-03 — timeout classification. Always WARN, and the output
# must be visually distinguishable from "clean" so a reader never mistakes
# incomplete coverage for a pass.
# ---------------------------------------------------------------------------
gate13_classify_timeout() {
  echo "TIMEOUT — coverage incomplete (the compiler did not finish within the budget); verdict treated as WARN, not a finding"
  return "$GATE13_WARN"
}

# ---------------------------------------------------------------------------
# AC-006-03 — the ONLY path that yields verdict 2. The tool ran, but produced
# output that contradicts itself or cannot be interpreted, so no conclusion can
# be drawn. Missing tools never come here (they are 3).
# ---------------------------------------------------------------------------
gate13_classify_unusable() {
  echo "BLOCK (fail-closed) — the compiler ran but its output is untrustworthy; refusing to report success"
  return "$GATE13_BLOCK"
}

# ---------------------------------------------------------------------------
# AC-001-03 — cross-compilation predicate. Pure: takes a compiler name/command,
# returns 0 (cross) or 1 (host). Three explicit conditions (architecture CI-01),
# each independently testable:
#   1. CROSS_COMPILE is non-empty
#   2. the basename matches ^(prefix-)?(gcc|g++|cc|c++|clang|clang++)(-ver)?$
#      with a NON-EMPTY prefix  (arm-linux-gnueabihf-g++, aarch64-none-elf-gcc)
#   3. the target triple differs from the host triple (needs -dumpmachine)
#
# Explicitly answered in review: an empty CROSS_COMPILE with
# CC=arm-linux-gnueabihf-gcc IS cross-compilation — condition 2 catches it.
# ---------------------------------------------------------------------------
gate13_is_cross_compiling() {
  local cc="${1:-}"
  local base prefix

  if [ -n "${CROSS_COMPILE:-}" ]; then
    return 0
  fi

  base=$(basename -- "$cc" 2>/dev/null || printf '%s' "$cc")
  # Strip a trailing -<version> / -<major.minor> so g++-13 is host, not cross.
  base=$(printf '%s' "$base" | sed -E 's/-[0-9]+(\.[0-9]+)*$//')

  # prefix-<tool>. `gcc` itself has no prefix; `<prefix>-gcc` does.
  if printf '%s' "$base" | grep -Eq '^(.+)-(gcc|g\+\+|cc|c\+\+|clang|clang\+\+)$'; then
    prefix=$(printf '%s' "$base" | sed -E 's/^(.+)-(gcc|g\+\+|cc|c\+\+|clang|clang\+\+)$/\1/')
    # A leading path component was already stripped by basename, so any prefix
    # left here is a toolchain prefix.
    if [ -n "$prefix" ]; then
      return 0
    fi
  fi

  # Known host-style names with no prefix at all.
  case "$base" in
    gcc|g++|cc|c++|clang|clang++) return 1 ;;
  esac

  # Anything else (e.g. an absolute path to a foreign toolchain) — cond 3.
  if [ -x "$cc" ] && command -v "$cc" >/dev/null 2>&1; then
    local target host
    target=$("$cc" -dumpmachine 2>/dev/null)
    host=$(uname -m 2>/dev/null)
    if [ -n "$target" ] && [ -n "$host" ]; then
      case "$target" in
        "$host"*) return 1 ;;
        *) return 0 ;;
      esac
    fi
  fi

  return 1
}

# ---------------------------------------------------------------------------
# Usability probe — `command -v` alone is NOT enough. A broken shim, a missing
# shared library, or a PATH entry for the wrong architecture all pass `command
# -v` and then fail at the first real invocation. Treating that as "compiler
# present" would route to the analysis stage and report a spurious failure (or,
# worse, no failure at all). Ask the compiler to identify itself; anything but
# a clean exit means "not usable".
# ---------------------------------------------------------------------------
gate13_compiler_usable() {
  local cc="$1"
  "$cc" --version >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# AC-001-01 / AC-001-04 — compiler selection.
# Order (REQ-001): $CXX > Makefile CXX := > PATH (g++ > clang++ > c++).
# A user-named compiler that cannot be used is REPORTED, never silently replaced
# (AC-001-04) — a silent swap would compile the wrong code with the wrong flags
# and still print PASS.
#
# Prints the selected compiler path on stdout and the selection basis on stderr
# so callers can capture the path without the narrative.
# ---------------------------------------------------------------------------
gate13_select_cxx() {
  local cand=""

  # 1. Environment — this is what make itself would use.
  if [ -n "${CXX:-}" ]; then
    if command -v "$CXX" >/dev/null 2>&1 && gate13_compiler_usable "$CXX"; then
      echo "compiler selected: $CXX (basis: \$CXX environment variable)" >&2
      printf '%s\n' "$CXX"
      return 0
    fi
    gate13_reason "explicitly configured CXX='${CXX}' is not runnable; refusing to substitute a different compiler"
    echo "compiler selected: none (basis: \$CXX='${CXX}' is unusable)" >&2
    return 1
  fi

  # 2. Makefile assignment — the project's own declared compiler.
  if [ -f "Makefile" ]; then
    cand=$(sed -nE 's/^[[:space:]]*CXX[[:space:]]*[:?]?=[[:space:]]*([^[:space:]#]+).*/\1/p' Makefile 2>/dev/null | head -1)
    if [ -n "$cand" ] && command -v "$cand" >/dev/null 2>&1 && gate13_compiler_usable "$cand"; then
      echo "compiler selected: $cand (basis: Makefile CXX assignment)" >&2
      printf '%s\n' "$cand"
      return 0
    fi
  fi

  # 3. PATH lookup, most standard first.
  for cand in g++ clang++ c++; do
    if command -v "$cand" >/dev/null 2>&1 && gate13_compiler_usable "$cand"; then
      echo "compiler selected: $cand (basis: PATH lookup)" >&2
      printf '%s\n' "$cand"
      return 0
    fi
  done

  echo "compiler selected: none (basis: no usable C++ compiler on PATH)" >&2
  return 1
}

# Same order for C, so a pure-C project is not forced through a C++ driver.
gate13_select_cc() {
  local cand=""

  if [ -n "${CC:-}" ]; then
    if command -v "$CC" >/dev/null 2>&1 && gate13_compiler_usable "$CC"; then
      printf '%s\n' "$CC"
      return 0
    fi
    gate13_reason "explicitly configured CC='${CC}' is not runnable; refusing to substitute a different compiler"
    return 1
  fi

  if [ -f "Makefile" ]; then
    cand=$(sed -nE 's/^[[:space:]]*CC[[:space:]]*[:?]?=[[:space:]]*([^[:space:]#]+).*/\1/p' Makefile 2>/dev/null | head -1)
    if [ -n "$cand" ] && command -v "$cand" >/dev/null 2>&1 && gate13_compiler_usable "$cand"; then
      printf '%s\n' "$cand"
      return 0
    fi
  fi

  for cand in gcc clang cc; do
    if command -v "$cand" >/dev/null 2>&1 && gate13_compiler_usable "$cand"; then
      printf '%s\n' "$cand"
      return 0
    fi
  done

  return 1
}

# ---------------------------------------------------------------------------
# AC-008-02 — emergency kill switch, orthogonal to the strictness tier
# (feasibility FC-03). A gate that cannot be disabled during a misreport storm
# gets disabled permanently by `--no-verify`, which the Code of Conduct forbids —
# so the sanctioned escape hatch is an explicit, audited SKIP.
# ---------------------------------------------------------------------------
gate13_is_disabled() {
  [ "${XP_GATE_DISABLE_13:-}" = "1" ]
}

# ---------------------------------------------------------------------------
# AC-002-01 — strictness tier resolution.
# Values: strict | balanced (default) | warn-only. An unrecognised value WARNs
# and falls back to balanced rather than silently choosing a stricter or looser
# policy than the user asked for.
# ---------------------------------------------------------------------------
gate13_resolve_tier() {
  local tier="${1:-${XP_GATE_COMPILER_STRICTNESS:-balanced}}"
  case "$tier" in
    strict|balanced|warn-only) printf '%s\n' "$tier" ;;
    *)
      gate13_reason "unknown XP_GATE_COMPILER_STRICTNESS='${tier}' (expected strict|balanced|warn-only), falling back to balanced"
      printf 'balanced\n'
      ;;
  esac
}

# ---------------------------------------------------------------------------
# AC-002-01 — the flag set for a tier and language.
#
# balanced covers the highest-value real-bug classes from the GCC manual with a
# low false-positive cost. strict adds -Wconversion/-Wsign-conversion, which are
# very noisy in numeric code, hence opt-in. The C++-only flags are separated so a
# C translation unit is never handed -Wold-style-cast (a C++ diagnostic gcc would
# reject as unrecognised for C with -Werror).
# ---------------------------------------------------------------------------
gate13_cpp_flags() {
  local tier lang base strict common
  tier=$(gate13_resolve_tier "${1:-}")
  lang="${2:-cpp}"

  base="-Wall -Wextra"

  if [ "$tier" = "balanced" ] || [ "$tier" = "warn-only" ]; then
    printf '%s\n' "$base"
    return 0
  fi

  # strict
  common="-Wpedantic -Wshadow -Wformat=2 -Wcast-qual -Wcast-align -Wnull-dereference -Wswitch-enum"
  if [ "$lang" = "c" ]; then
    printf '%s %s\n' "$base" "$common"
  else
    printf '%s %s -Wconversion -Wsign-conversion -Wold-style-cast -Wuseless-cast -Wnon-virtual-dtor -Woverloaded-virtual\n' "$base" "$common"
  fi
}

# ---------------------------------------------------------------------------
# AC-002-02 / AC-002-03 — capability probe.
#
# One clean throwaway translation unit, each candidate flag tried ALONE in the
# POSITIVE form. Measured: gcc reports `unrecognized command-line option '-Wfoo'`
# for an unknown positive flag, but accepts an unknown `-Wno-foo` silently (a
# `cc1plus: note:` appears only when other diagnostics exist). Probing the
# negative form would therefore "succeed" for every flag and the gate would claim
# checks it never ran.
#
# Caching (architecture MA-01): results live in GATE13_PROBE_CACHE for the
# lifetime of one hook run — a persisted cache would go stale on compiler upgrade.
# Emits the ACCEPTED flags on stdout (space separated) and `dropped flag:` lines
# on stderr.
# ---------------------------------------------------------------------------
gate13_flag_supported() {
  local cc="$1" flag="$2" lang="${3:-cpp}" probe_tu out
  # The cache key carries the language (walkthrough R2 MA-05): gcc accepts
  # -Wold-style-cast for C++ and rejects it for C, so a key without the language
  # would let a C probe inherit the C++ answer.
  local key="${cc}|${lang}|${flag}"

  # Two separate caches, checked separately. A single "seen this key" cache was
  # wrong (walkthrough MA-02): once any flag was dropped, every cached key
  # returned "supported", re-enabling flags the compiler had already rejected.
  case " ${GATE13_PROBE_DROPPED:-} " in
    *" ${key} "*) return 1 ;;
  esac
  case " ${GATE13_PROBE_CACHE:-} " in
    *" ${key} "*) return 0 ;;
  esac

  probe_tu="${GATE13_PROBE_TU:-}"
  if [ -z "$probe_tu" ] || [ ! -f "$probe_tu" ]; then
    probe_tu="${TMPDIR:-/tmp}/gate13_probe_$$.cpp"
    printf 'int main() { return 0; }\n' > "$probe_tu"
    GATE13_PROBE_TU="$probe_tu"
  fi

  if out=$("$cc" -fsyntax-only "$flag" "$probe_tu" 2>&1); then
    GATE13_PROBE_CACHE="${GATE13_PROBE_CACHE:-} ${key}"
    return 0
  fi

  case "$out" in
    *"unrecognized command-line option"*|*"unknown warning option"*|*"unknown argument"*)
      GATE13_PROBE_DROPPED="${GATE13_PROBE_DROPPED:-} ${key}"
      return 1
      ;;
  esac

  # The flag compiled but failed for some other reason (bad probe TU, missing
  # system headers). Assume support: dropping a working flag silently loses
  # coverage, and a genuinely unsupported flag is caught by the pattern above.
  GATE13_PROBE_CACHE="${GATE13_PROBE_CACHE:-} ${key}"
  return 0
}

gate13_probe_flags() {
  local cc="$1" lang="$2"
  shift 2
  local flag accepted="" dropped=""

  for flag in "$@"; do
    if gate13_flag_supported "$cc" "$flag" "$lang"; then
      accepted="$accepted $flag"
    else
      dropped="$dropped $flag"
      printf 'dropped flag: %s (unsupported by %s)\n' "$flag" "$(gate13_compiler_id "$cc")" >&2
    fi
  done

  printf '%s\n' "$(printf '%s' "$accepted" | sed 's/^ *//')"
}

gate13_compiler_id() {
  local cc="$1" v
  v=$("$cc" --version 2>/dev/null | head -1)
  printf '%s' "${v:-$cc}"
}

# ---------------------------------------------------------------------------
# AC-003-04 — the changed set. Staged files only, matching Gate 1/12.
# Deleted files are excluded: they cannot be compiled.
# ---------------------------------------------------------------------------
gate13_changed_cpp_files() {
  git diff --cached --name-only --diff-filter=d -- '*.c' '*.cc' '*.cpp' '*.cxx' '*.C' 2>/dev/null
}

# Emits "<status>\t<file>" where status is A (added) or M (modified/other).
gate13_classify_changed() {
  local f status
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    status=$(git diff --cached --name-status --diff-filter=ACMR -- "$f" 2>/dev/null | awk '{print $1}' | head -1)
    case "$status" in
      A) printf 'added\t%s\n' "$f" ;;
      *) printf 'modified\t%s\n' "$f" ;;
    esac
  done <<EOF
$(gate13_changed_cpp_files)
EOF
}

# ---------------------------------------------------------------------------
# AC-003-02 — baseline storage. In-repo, mirroring Gate 6's .warnings-baseline.json
# precedent (technical CRITICAL-1 / feasibility FC-01). A local cache was
# rejected because it makes CI and developer verdicts diverge.
# The HOOK NEVER WRITES THIS FILE — that is the precise meaning of
# "baseline only grows" (architecture CI-03): a hook that silently rewrote the
# baseline could excuse its own regressions.
# ---------------------------------------------------------------------------
gate13_baseline_path() {
  printf '%s\n' ".xp-gate/compiler-warnings-baseline.json"
}

# Prints the recorded warning count for a file, or empty when there is no
# baseline / no entry for that file.
gate13_baseline_count() {
  local file="$1" path count
  path=$(gate13_baseline_path)
  [ -f "$path" ] || return 0

  if command -v node >/dev/null 2>&1; then
    count=$(node -e '
      const fs = require("fs");
      try {
        const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const e = (j.files || {})[process.argv[2]];
        if (e && typeof e.count === "number") process.stdout.write(String(e.count));
      } catch (_) { /* unreadable baseline == no baseline */ }
    ' "$path" "$file" 2>/dev/null)
  fi
  printf '%s' "$count"
}

gate13_baseline_exists() {
  [ -f "$(gate13_baseline_path)" ]
}

# ---------------------------------------------------------------------------
# Compile one translation unit and count its diagnostics.
# -fsyntax-only: no artifacts, measured to write nothing into the tree.
# Prints the diagnostics on stderr; the COUNT goes to stdout.
# ---------------------------------------------------------------------------
gate13_count_warnings() {
  local cc="$1" flags="$2" file="$3" out
  # shellcheck disable=SC2086  # flags is a deliberately word-split flag list
  out=$("$cc" -fsyntax-only $flags "$file" 2>&1)
  printf '%s\n' "$out" | grep -E 'warning:' | grep -vcE '^\s*$' || true
}

# ============================================================================
# JAVA PATH (REQ-004)
#
# Measured motivation: `List raw = l;` in a Java file produces ZERO diagnostics
# from bare javac, `[rawtypes]` under -Xlint:all, and a hard error under
# -Xlint:all -Werror. Gate 9's `mvn -q -DskipTests compile` suppresses the very
# warnings a strict gate exists to read.
# ============================================================================

# ---------------------------------------------------------------------------
# AC-004-01 — Maven arguments.
#
# `-B` (batch mode) NOT `-q`: -q suppresses non-error diagnostics, so "run mvn
# quietly" and "parse the warning lines" are mutually exclusive — a real
# self-contradiction caught in requirement round 2 (architecture CI-02).
# `-o` keeps a hook from reaching the network (REQ-007).
# `compilerArgument` is a SINGLE appended argument; -Xlint:all,-processing is
# one token precisely because of that (technical MC-01).
# ---------------------------------------------------------------------------
gate13_maven_args() {
  printf '%s\n' "-B -o -DskipTests compile -Dmaven.compiler.showWarnings=true -Dmaven.compiler.showDeprecation=true -Dmaven.compiler.compilerArgument=-Xlint:all,-processing"
}

gate13_javac_args() {
  printf '%s\n' "-Xlint:all,-processing -d"
}

gate13_java_sources() {
  git diff --cached --name-only --diff-filter=d -- '*.java' 2>/dev/null
}

# ---------------------------------------------------------------------------
# AC-004-02 — is the command-line Maven injection likely to take effect?
#
# Returns 0 = reliable, 1 = unreliable. Three known failure modes, each of which
# silently drops the lint flags rather than failing loudly:
#   1. the pom already declares <compilerArgs> — a CLI single-arg append is
#      overridden by the explicit configuration (technical MC-01)
#   2. maven-compiler-plugin < 3.1 — compilerArgument semantics were not stable
#      (feasibility FC-02)
#   3. no plugin version declared at all — the effective version is inherited or
#      defaulted and cannot be verified, so do not assume it works
#
# On "unreliable" the gate degrades to warn-only with a loud banner. It never
# fakes a PASS and never emits an unpredictable BLOCK.
# ---------------------------------------------------------------------------
# shellcheck disable=SC2016  # this function matches LITERAL ${...} in a pom, not expansions
gate13_maven_injection_reliable() {
  local pom="${1:-pom.xml}" ver

  [ -f "$pom" ] || return 1

  if grep -q '<compilerArgs>' "$pom" 2>/dev/null; then
    printf 'pom already declares <compilerArgs>; a command-line -Dmaven.compiler.compilerArgument may be overridden\n' >&2
    return 1
  fi

  # Extract the version belonging to the maven-compiler-plugin block.
  # Walkthrough R2 MA-04: a range match to the first </plugin> could pick up a
  # neighbouring plugin's version, and a strict numeric pattern missed
  # `3.13.0-SNAPSHOT`. Anchor on the plugin's own artifactId, then take the FIRST
  # <version> that follows it, and accept a qualifier suffix.
  ver=$(awk '
    /<artifactId>[[:space:]]*maven-compiler-plugin[[:space:]]*<\/artifactId>/ { found=1 }
    found && /<version>/ {
      line=$0
      sub(/.*<version>[[:space:]]*/, "", line)
      sub(/[[:space:]]*<\/version>.*/, "", line)
      print line
      exit
    }
  ' "$pom" 2>/dev/null)

  if [ -z "$ver" ]; then
    printf 'maven-compiler-plugin version is not declared; injection cannot be verified\n' >&2
    return 1
  fi

  # A property placeholder cannot be resolved statically — treat as unverified
  # rather than guessing (walkthrough R2 MA-04).
  case "$ver" in
    *'${'*)
      printf 'maven-compiler-plugin version is a property reference (%s); cannot be verified statically\n' "$ver" >&2
      return 1
      ;;
  esac

  # Drop a qualifier suffix (3.13.0-SNAPSHOT -> 3.13.0) before comparing.
  ver=${ver%%-*}

  local major minor
  major=${ver%%.*}
  minor=${ver#*.}
  minor=${minor%%.*}

  if [ "$major" -lt 3 ] || { [ "$major" -eq 3 ] && [ "$minor" -lt 1 ]; }; then
    printf 'maven-compiler-plugin %s predates stable compilerArgument support (needs >= 3.1)\n' "$ver" >&2
    return 1
  fi

  return 0
}

# ---------------------------------------------------------------------------
# AC-004-03 — count javac diagnostics for a file under the strict lint set.
# Verified by measurement: bare javac reports nothing for a raw type, this
# reports [rawtypes].
# ---------------------------------------------------------------------------
gate13_javac_warning_count() {
  local file="$1" out tmpd rc=0 budget
  command -v javac >/dev/null 2>&1 || { printf '0\n'; return 0; }

  tmpd="${TMPDIR:-/tmp}/gate13_javac_$$"
  mkdir -p "$tmpd"
  budget=$(gate13_timeout_budget)

  # Timeout-bounded (walkthrough MC-03): a pathological file can hang javac, and
  # a pre-commit hook must never hang with it. `timeout` may be absent on some
  # systems, in which case we run unbounded rather than skipping the check.
  if command -v timeout >/dev/null 2>&1; then
    out=$(timeout "$budget" javac -Xlint:all,-processing -d "$tmpd" "$file" 2>&1)
    rc=$?
  else
    out=$(javac -Xlint:all,-processing -d "$tmpd" "$file" 2>&1)
    rc=$?
  fi
  rm -rf "$tmpd"

  # timeout(1) reports 124 when it fired. Returning 0 here would be
  # indistinguishable from "compiled clean" (walkthrough round 2, CI-02), so
  # signal incompleteness with a dedicated non-numeric marker the caller checks.
  if [ "$rc" -eq 124 ]; then
    printf 'TIMEOUT\n'
    return 0
  fi

  # javac prefixes each warning with "warning:" (localised builds may differ), so
  # also count the "[category]" marker lines that every -Xlint diagnostic emits.
  printf '%s\n' "$out" | grep -cE 'warning:|\[(rawtypes|unchecked|deprecation|fallthrough|finally|cast|static|try|overrides|overloads|serial|synchronization)\]' || true
}

# ---------------------------------------------------------------------------
# Java analysis stage. Verdict semantics mirror the C/C++ stage:
#   0 PASS, 1 FAIL, 2 BLOCK(untrustworthy), 3 WARN (no toolchain / degraded).
# ---------------------------------------------------------------------------
gate13_run_java_analysis() {
  local srcs had_tool=0 degraded=0 files f cnt total=0

  if gate13_is_disabled; then
    gate13_reason "Gate 13 disabled via XP_GATE_DISABLE_13=1"
    echo "SKIPPED - compiler strictness check (XP_GATE_DISABLE_13=1)"
    return "$GATE13_WARN"
  fi

  srcs=$(gate13_java_sources)
  if [ -z "$srcs" ]; then
    return "$GATE13_PASS"
  fi

  if [ "${GATE13_FORCE_NO_JAVA_TOOLCHAIN:-}" = "1" ]; then
    echo "WARN - no usable Java toolchain (mvn / gradle / javac); Java compiler checks NOT performed."
    return "$GATE13_WARN"
  fi

  # ── Maven path ────────────────────────────────────────────────────────────
  if [ -f "pom.xml" ]; then
    if [ -x "./mvnw" ]; then
      had_tool=1
    elif command -v mvn >/dev/null 2>&1; then
      had_tool=1
    fi

    if [ "$had_tool" -eq 1 ]; then
      local mvn_bin="mvn"
      [ -x "./mvnw" ] && mvn_bin="./mvnw"

      if ! gate13_maven_injection_reliable "pom.xml" 2>/dev/null; then
        echo "     ⚠️  DEGRADED - Maven compiler-arg injection unreliable (see reasons below);"
        echo "         Java lint findings are REPORT-ONLY for this run (this is a degraded mode, not a normal warn-only run)."
        degraded=1
      fi

      local args budget rc mvn_out mvn_log mvn_findings
      args=$(gate13_maven_args)
      budget=$(gate13_timeout_budget)
      mvn_log="${TMPDIR:-/tmp}/gate13_mvn_$$.log"

      # Capture BOTH streams. This is the whole point of REQ-004: `mvn compile`
      # EXITS 0 even when javac emitted warnings, so a verdict derived from the
      # exit code alone can never see a -Xlint finding. (Walkthrough review CI-01
      # caught exactly that: the first implementation redirected to /dev/null and
      # printed PASSED no matter what javac said.)
      if command -v timeout >/dev/null 2>&1; then
        # shellcheck disable=SC2086
        timeout "$budget" "$mvn_bin" $args >"$mvn_log" 2>&1
      else
        # shellcheck disable=SC2086
        "$mvn_bin" $args >"$mvn_log" 2>&1
      fi
      rc=$?
      mvn_out=$(cat "$mvn_log" 2>/dev/null)
      rm -f "$mvn_log"

      if [ "$rc" -eq 124 ]; then
        gate13_classify_timeout
        return "$GATE13_WARN"
      fi
      if [ "$rc" -ne 0 ]; then
        if [ "$degraded" -eq 1 ]; then
          # We already know the lint flags were not applied, so a build failure
          # here says nothing about compiler strictness — it is usually missing
          # offline dependencies. Reporting it as FAIL would blame this gate for
          # a build-environment problem (and would be a lie: nothing was linted).
          echo "     ⚠️  Java build failed (mvn exit ${rc}) in degraded mode — not attributed to Gate 13"
          return "$GATE13_WARN"
        fi
        # A non-zero exit in a run where the lint flags WERE applied means javac
        # found something (with -Werror in a project config) or the code does not
        # compile. Either way it is a real finding, not an environment problem.
        echo "     ❌ Java compilation failed (mvn exit ${rc})"
        printf '%s\n' "$mvn_out" | grep -E 'ERROR|WARNING' | head -10 | sed 's/^/        /'
        return "$GATE13_FAIL"
      fi

      if [ "$degraded" -eq 1 ]; then
        echo "     ⚠️  DEGRADED - Java compiled but lint enforcement was NOT applied; no conclusion drawn"
        return "$GATE13_WARN"
      fi

      # Count javac's lint output. Maven prefixes it with "[WARNING] ".
      mvn_findings=$(printf '%s\n' "$mvn_out" \
        | grep -cE '\[WARNING\].*\[(rawtypes|unchecked|deprecation|fallthrough|finally|cast|static|try|overrides|overloads|serial|synchronization|varargs|divzero|empty|exports|module|opens|options|path|processing|removal|requires|text-blocks|this-escape)\]' \
        | tr -d '[:space:]')
      mvn_findings=${mvn_findings:-0}

      if [ "$mvn_findings" -gt 0 ]; then
        printf '%s\n' "$mvn_out" \
          | grep -E '\[WARNING\].*\[[a-z-]+\]' | head -10 | sed 's/^/        /'
        echo "     ❌ ${mvn_findings} javac -Xlint finding(s)"
        return "$GATE13_FAIL"
      fi

      echo "     ✅ PASSED - Java compiled with -Xlint:all,-processing (no findings)"
      return "$GATE13_PASS"
    fi
  fi

  # ── Gradle path ───────────────────────────────────────────────────────────
  if [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
    if [ -x "./gradlew" ] || command -v gradle >/dev/null 2>&1; then
      local g_bin="gradle"
      [ -x "./gradlew" ] && g_bin="./gradlew"
      local budget g_log grc g_out g_findings
      budget=$(gate13_timeout_budget)
      g_log="${TMPDIR:-/tmp}/gate13_gradle_$$.log"

      # Same reasoning as the Maven path: capture the output, because a
      # successful `compileJava` still carries the javac warnings.
      # NOTE: no -q here — it suppresses exactly the diagnostics we want, the
      # same trap that made -q wrong for Maven.
      if command -v timeout >/dev/null 2>&1; then
        timeout "$budget" "$g_bin" compileJava --offline --warning-mode all >"$g_log" 2>&1
      else
        "$g_bin" compileJava --offline --warning-mode all >"$g_log" 2>&1
      fi
      grc=$?
      g_out=$(cat "$g_log" 2>/dev/null)
      rm -f "$g_log"

      if [ "$grc" -eq 124 ]; then
        gate13_classify_timeout
        return "$GATE13_WARN"
      fi
      if [ "$grc" -ne 0 ]; then
        echo "     ❌ Java compilation failed (gradle exit ${grc})"
        printf '%s\n' "$g_out" | grep -E 'error|warning' | head -10 | sed 's/^/        /'
        return "$GATE13_FAIL"
      fi

      g_findings=$(printf '%s\n' "$g_out" \
        | grep -cE '\[(rawtypes|unchecked|deprecation|fallthrough|cast|static|overrides|serial|synchronization)\]' \
        | tr -d '[:space:]')
      g_findings=${g_findings:-0}
      if [ "$g_findings" -gt 0 ]; then
        printf '%s\n' "$g_out" | grep -E 'warning:' | head -10 | sed 's/^/        /'
        echo "     ❌ ${g_findings} javac lint finding(s) (gradle compileJava)"
        return "$GATE13_FAIL"
      fi
      echo "     ✅ PASSED - Java compiled (gradle compileJava, no findings)"
      return "$GATE13_PASS"
    fi
  fi

  # ── Bare javac path ───────────────────────────────────────────────────────
  if command -v javac >/dev/null 2>&1; then
    local blocking=0 timed_out=0
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      cnt=$(gate13_javac_warning_count "$f")
      # A timed-out file was NOT checked. Treating it as 0 warnings would report
      # a pass for code nobody looked at (walkthrough R2 CI-02).
      if [ "$cnt" = "TIMEOUT" ]; then
        gate13_classify_timeout
        echo "     ⚠️  ${f}: javac timed out — not analysed"
        timed_out=$((timed_out + 1))
        continue
      fi
      cnt=${cnt:-0}
      if [ "$cnt" -gt 0 ]; then
        total=$((total + cnt))
        echo "     ❌ ${f}: ${cnt} javac -Xlint finding(s)"
        blocking=$((blocking + 1))
      fi
    done <<EOF
$srcs
EOF
    if [ "$blocking" -gt 0 ]; then
      echo "     ❌ BLOCKED - ${blocking} Java file(s) with -Xlint findings (${total} total)"
      return "$GATE13_FAIL"
    fi
    if [ "$timed_out" -gt 0 ]; then
      echo "     ⚠️  WARN - ${timed_out} Java file(s) were not analysed (timeout); coverage incomplete"
      return "$GATE13_WARN"
    fi
    echo "     ✅ PASSED - Java compiler strictness (javac -Xlint:all,-processing)"
    return "$GATE13_PASS"
  fi

  echo "WARN - no usable Java toolchain (mvn / gradle / javac); Java compiler checks NOT performed."
  return "$GATE13_WARN"
}

# ============================================================================
# `-fanalyzer` PATH (REQ-005) — C files only, opt-in.
#
# Path-sensitive analysis that finds use-after-free / double-free / NULL
# dereference no warning flag reaches. OFF by default for three measured reasons:
#   * speed      — seconds per translation unit, not milliseconds
#   * portability— GCC-only; clang errors on the flag
#   * semantics  — it emits NOTHING under -fsyntax-only (measured), because the
#                  analysis hangs off real optimisation passes. It therefore has
#                  to compile for real, which is why artifacts go to a temp dir
#                  with -c (never a linked binary, never the work tree).
# Requirement round 2 (feasibility FC-04) restricted it to .c files: C++ TUs
# through -fanalyzer are dramatically slower and noisier.
# ============================================================================

gate13_analyzer_enabled() {
  [ "${XP_GATE_COMPILER_ANALYZER:-}" = "1" ]
}

# Print the staged C (not C++) files eligible for analysis.
gate13_analyzer_files() {
  git diff --cached --name-only --diff-filter=d -- '*.c' 2>/dev/null
}

# Can this compiler do -fanalyzer at all?
gate13_analyzer_supported() {
  local cc="$1" out tu
  [ -n "$cc" ] || return 1
  command -v "$cc" >/dev/null 2>&1 || return 1

  tu="${GATE13_ANALYZER_TU:-}"
  if [ -z "$tu" ] || [ ! -f "$tu" ]; then
    tu="${TMPDIR:-/tmp}/gate13_analyzer_probe_$$.c"
    printf 'int main(void) { return 0; }\n' > "$tu"
    GATE13_ANALYZER_TU="$tu"
  fi

  out=$("$cc" -fanalyzer -fsyntax-only "$tu" 2>&1) && return 0
  case "$out" in
    *"unknown argument"*|*"unrecognized command-line option"*|*"unknown option"*|*"not supported"*)
      return 1
      ;;
  esac
  # It failed for another reason (e.g. no C frontend): treat as unsupported
  # rather than silently claiming the analysis ran.
  return 1
}

gate13_run_analyzer() {
  local cc
  local files=""
  local f cnt total=0 blocking=0
  local workdir

  gate13_analyzer_enabled || return 0

  cc=$(gate13_select_cc)
  [ -n "$cc" ] || {
    echo "     ⚠️  -fanalyzer requested but no C compiler is usable; analyzer stage skipped"
    return 0
  }

  if ! gate13_analyzer_supported "$cc"; then
    echo "     ℹ️  $(gate13_compiler_id "$cc") has no -fanalyzer support; analyzer stage skipped"
    return 0
  fi

  files=$(gate13_analyzer_files)
  if [ -z "$files" ]; then
    echo "     ℹ️  -fanalyzer: no staged .c files"
    return 0
  fi

  workdir="${TMPDIR:-/tmp}/gate13_analyzer_$$"
  mkdir -p "$workdir"

  while IFS= read -r f; do
    [ -n "$f" ] || continue
    cnt=$("$cc" -fanalyzer -c -o "$workdir/$(basename -- "$f").o" "$f" 2>&1 \
          | grep -cE 'warning:|\[-Wanalyzer' || true)
    cnt=${cnt:-0}
    if [ "$cnt" -gt 0 ]; then
      total=$((total + cnt))
      echo "     ⚠️  ${f}: ${cnt} -fanalyzer finding(s)"
      blocking=$((blocking + 1))
    fi
  done <<EOF
$files
EOF

  rm -rf "$workdir"

  if [ "$total" -gt 0 ]; then
    echo "     ℹ️  -fanalyzer: ${total} finding(s) across ${blocking} file(s) (advisory, opt-in stage)"
  else
    echo "     ✅ -fanalyzer: clean"
  fi
  return 0
}

# ---------------------------------------------------------------------------
# AC-003-01/02/03/05 — the C/C++ analysis stage.
#
# Policy:
#   added file     -> -Werror: ANY warning in the active tier blocks
#   modified file  -> compare count to baseline; no baseline => report-only
#   untouched file -> never compiled
#   warn-only tier -> nothing blocks; findings surface as WARN
# ---------------------------------------------------------------------------
gate13_run_cpp_analysis() {
  local cxx budget tier flags
  local added_list="" modified_list=""
  local blocking=0 findings=0 baseline_seen=0

  if gate13_is_disabled; then
    gate13_reason "Gate 13 disabled via XP_GATE_DISABLE_13=1"
    echo "SKIPPED - compiler strictness check (XP_GATE_DISABLE_13=1)"
    return "$GATE13_WARN"
  fi

  budget=$(gate13_timeout_budget)
  cxx=$(gate13_select_cxx)
  local sel_rc=$?
  if [ "$sel_rc" -ne 0 ] || [ -z "$cxx" ]; then
    echo "WARN - no usable C/C++ compiler found; compiler checks NOT performed."
    echo "       Install one of: g++ / clang++ (Debian: build-essential, macOS: xcode-select --install)"
    return "$GATE13_WARN"
  fi

  if gate13_is_cross_compiling "$cxx"; then
    gate13_reason "cross-compilation detected (compiler: ${cxx}, CROSS_COMPILE=${CROSS_COMPILE:-<empty>}); skipping host-side compile checks"
    echo "WARN - cross-compilation detected: ${cxx}"
    echo "       Target-architecture code is not compiled with a host compiler; compiler checks NOT performed."
    return "$GATE13_WARN"
  fi

  tier=$(gate13_resolve_tier)
  flags=$(gate13_cpp_flags "$tier" cpp)
  local probed
  # shellcheck disable=SC2086  # $flags is a deliberately word-split flag list
  probed=$(gate13_probe_flags "$cxx" cpp $flags)
  [ -n "$probed" ] && flags="$probed"

  echo "compiler: ${cxx} ($(gate13_compiler_id "$cxx"))"
  echo "strictness: ${tier} | flags: ${flags} | budget: ${budget}s"

  local classified
  classified=$(gate13_classify_changed)
  if [ -z "$classified" ]; then
    echo "     ℹ️  No staged C/C++ source files — nothing to compile"
    return "$GATE13_PASS"
  fi

  if ! gate13_baseline_exists; then
    echo "     ⚠️  baseline missing — run 'xp-gate compiler-baseline create' to enable enforcement on modified files"
    echo "         (new files are still -Werror; modified files are report-only until then)"
  fi

  local f kind cnt base
  while IFS=$'\t' read -r kind f; do
    [ -n "$f" ] || continue

    if [ "$kind" = "added" ]; then
      # AC-003-01: an added file's baseline count is inherently zero, so it is
      # enforced even without a baseline file.
      cnt=$(gate13_count_warnings "$cxx" "$flags" "$f")
      cnt=${cnt:-0}
      if [ "$cnt" -gt 0 ]; then
        findings=$((findings + cnt))
        if [ "$tier" = "warn-only" ]; then
          echo "     ⚠️  ${f}: ${cnt} warning(s) (warn-only tier, not blocking)"
        else
          echo "     ❌ ${f}: ${cnt} warning(s) in a NEW file"
          blocking=$((blocking + 1))
        fi
      fi
    else
      # AC-003-02/03: modified file.
      base=$(gate13_baseline_count "$f")
      if [ -z "$base" ]; then
        baseline_seen=1
        cnt=$(gate13_count_warnings "$cxx" "$flags" "$f")
        echo "     ℹ️  ${f}: ${cnt:-0} warning(s) (no baseline entry, report-only)"
        continue
      fi
      cnt=$(gate13_count_warnings "$cxx" "$flags" "$f")
      cnt=${cnt:-0}
      if [ "$cnt" -gt "$base" ]; then
        findings=$((findings + cnt))
        if [ "$tier" = "warn-only" ]; then
          echo "     ⚠️  ${f}: ${base} -> ${cnt} warning(s) (warn-only tier, not blocking)"
        else
          echo "     ❌ ${f}: warning count rose ${base} -> ${cnt} (baseline exceeded)"
          blocking=$((blocking + 1))
        fi
      fi
    fi
  done <<EOF
$classified
EOF

  if [ "$tier" = "warn-only" ]; then
    if [ "$findings" -gt 0 ]; then
      echo "     ⚠️  WARN - ${findings} C/C++ compiler finding(s) (warn-only tier)"
    fi
    return "$GATE13_WARN"
  fi

  if [ "$blocking" -gt 0 ]; then
    echo "     ❌ BLOCKED - ${blocking} file(s) with compiler findings (${findings} warning(s) total)"
    echo "        Fix the warnings, or (for pre-existing code) record a baseline:"
    echo "          xp-gate compiler-baseline create"
    return "$GATE13_FAIL"
  fi

  echo "     ✅ PASSED - C/C++ compiler strictness (${tier} tier)"

  # NOTE: gate13_run_analyzer is deliberately NOT called here. pre-commit drives
  # the three stages separately and reduces their verdicts itself; calling it in
  # both places ran -fanalyzer twice (walkthrough MC-01), doubling the slowest
  # stage for no benefit.
  return "$GATE13_PASS"
}
