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
  local cc="$1" flag="$2" probe_tu out
  local key="${cc}|${flag}"

  case " ${GATE13_PROBE_CACHE:-} " in
    *" ${key} "*)
      [ "${GATE13_PROBE_DROPPED:-}" = "" ] && return 0
      ;;
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
    if gate13_flag_supported "$cc" "$flag"; then
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

# ---------------------------------------------------------------------------
# AC-003-01/02/03/05 — the C/C++ analysis stage, replacing SLICE-1's endpoint.
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
  return "$GATE13_PASS"
}
