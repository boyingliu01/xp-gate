#!/usr/bin/env bash
# ============================================================================
# gate-0 entry — extracted from pre-commit by scripts/extract-gates.cjs
#
# WHY THIS FILE EXISTS (#798)
#   The gate order used to BE the physical order of blocks in a 6341-line
#   hook, so changing the order meant moving thousands of lines. An attempt at
#   that also moved the hook epilogue, after which every gate past Gate 13
#   silently stopped running while `bash -n`, a line count and five ordering
#   tests all passed. Gate 5a stopped blocking and only a behavioural test
#   noticed. With one file per gate, order is a list of names in
#   pre-commit's GATE_ORDER and cannot detach a body from its position.
#
# THE BODY BELOW IS A BYTE-EXACT SLICE of the original block. It is wrapped
# in a function so the gate keeps its own variable scope, and is called from
# pre-commit at the point the driver reaches it. Edit the gate here from now
# on - there is no copy left in the hook.
# ============================================================================

# ============================================================================
# Gate 0: Version Consistency Check (Protected Branches)
# ============================================================================
# Gate body. `return` is used instead of `exit` so the driver decides to
# stop: see scripts/wrap-gate-entries.cjs for why the two are equivalent
# here, and why sub-shell exits are deliberately left as `exit`.
gate_0_run() {
GATE_0_START=$(gate_start_ms)
GATE_0_STATUS="PASS"

CURRENT_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --abbrev-ref HEAD 2>/dev/null) || CURRENT_BRANCH=""
CURRENT_BRANCH=$(printf '%s' "$CURRENT_BRANCH" | tr -d '\r\n'); [ -n "$CURRENT_BRANCH" ] || CURRENT_BRANCH="HEAD"
PROTECTED_BRANCHES="master develop trunk mainline"
# #711: same shape as the branch/commit captures above — `git rev-parse` can
# print a partial line before failing, so `|| echo "."` can yield "<something>\n."
# and every later `cd "$ROOT_DIR"` / path join would silently use a two-line value.
ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null) || ROOT_DIR=""
ROOT_DIR=$(printf '%s' "$ROOT_DIR" | tr -d '\r\n'); [ -n "$ROOT_DIR" ] || ROOT_DIR="."

# Optional: project-level .protected-branches config file
if [ -f "$ROOT_DIR/.protected-branches" ]; then
  PROTECTED_BRANCHES="$PROTECTED_BRANCHES $(cat "$ROOT_DIR/.protected-branches" | tr '\n' ' ')"
fi

is_protected=false
for branch in $PROTECTED_BRANCHES; do
  if [ "$CURRENT_BRANCH" = "$branch" ]; then
    is_protected=true
    break
  fi
done

# A2 guard: narrowing the gate set is a local iteration tool, never a way to
# commit onto a protected branch with fewer checks. Same reasoning as
# SKIP_GATE_5A_BLOCK's main/master refusal further down, and refused outright
# rather than silently ignored so a scripted `XP_GATE_ONLY_GATE=1 git commit` on
# main cannot quietly appear to have run the full chain.
if gate_selection_active && [ "$is_protected" = true ]; then
  echo ""
  echo "❌ BLOCKED - XP_GATE_ONLY_GATE=${XP_GATE_ONLY_GATE} is not allowed on protected branch '$CURRENT_BRANCH'."
  echo "   Run the full gate chain here: unset XP_GATE_ONLY_GATE."
  return 1
fi

if gate_selection_active; then
  echo ""
  echo "⚠️  PARTIAL GATE RUN — XP_GATE_ONLY_GATE=${XP_GATE_ONLY_GATE} (branch: $CURRENT_BRANCH)"
  echo "   Gates not named are recorded as SKIP/not_selected, never as PASS."
  echo "   This commit has NOT been checked against the gates it skips."
fi

has_version_change=false
has_changelog_change=false

# #640: a fork costs ~90ms on Windows (measured: 100 `git rev-parse` = 9456ms),
# and this exact query is re-run by later gates. Cache it once; consumers below
# read $XP_STAGED_ACM. Subprocess COUNT, not scan duration, is the bottleneck.
#
# Computed HERE, once, and outside the protected-branch test below. It used to
# live inside that test, which meant the variable was only ever assigned when
# committing to master/main/develop/trunk/mainline. On a feature branch -- where
# essentially all work happens, and where CI fixtures commit -- it stayed EMPTY,
# and every #640 consumer that asks "did this commit touch a source file?" then
# matched nothing:
#   - Gate 6 skipped archlint on every feature-branch commit that DID change
#     source ("no source files changed"), silently dropping the architecture
#     check;
#   - Gate 0's own hint fired as though nothing were staged.
# A cache that is only warm on some branches is not a cache, it is a branch-wide
# behaviour difference. Assign it before anything can branch.
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)
XP_STAGED_ACM="$STAGED_FILES"
export XP_STAGED_ACM

if [ "$is_protected" = "true" ]; then
  # Env var bypass: SKIP_VERSION_CHECK=1 skips Gate 0 entirely
  # Useful for: SKIP_VERSION_CHECK=1 git commit -m "chore: ..."
  if ! gate_enabled 0; then
    echo "⏭️  SKIPPED - Gate 0: Version consistency (not selected by XP_GATE_ONLY_GATE)"
    GATE_0_STATUS="SKIP"
    GATE_0_DETAIL="not_selected"
  elif [ "${SKIP_VERSION_CHECK:-}" = "1" ]; then
    echo "⏭️  SKIPPED - Gate 0: Version consistency (SKIP_VERSION_CHECK=1 env var)"
  else
  for file in $STAGED_FILES; do
    case "$file" in
      VERSION) has_version_change=true ;;
      CHANGELOG.md) has_changelog_change=true ;;
    esac
  done

  # If either VERSION or CHANGELOG.md is staged, pass
  if [ "$has_version_change" = "true" ] || [ "$has_changelog_change" = "true" ]; then
    # Auto-run sync-version when VERSION is staged (issue #206 follow-up).
    # Propagates VERSION → 4 package.json + refreshes AGENTS.md headers,
    # then stages only files sync-version is known to touch (NOT runtime
    # journals or unrelated edits) so the commit captures it atomically.
    # Prefer Node.js (.cjs) for cross-platform; fall back to bash (.sh).
    SYNC_VERSION_CMD=""
    if [ -f "$ROOT_DIR/scripts/sync-version.cjs" ] && command -v node >/dev/null 2>&1; then
      SYNC_VERSION_CMD="node $ROOT_DIR/scripts/sync-version.cjs"
    elif [ -f "$ROOT_DIR/scripts/sync-version.sh" ]; then
      SYNC_VERSION_CMD="bash $ROOT_DIR/scripts/sync-version.sh"
    fi
    if [ "$has_version_change" = "true" ] && [ -n "$SYNC_VERSION_CMD" ]; then
      echo "🔄 Gate 0: VERSION staged — running sync-version to fan out to package.json + AGENTS.md headers..."
      if $SYNC_VERSION_CMD > /tmp/xp-gate-sync-version.log 2>&1; then
        SYNC_STAGED=0
        # Stage the 4 known package.json targets if modified
        for pkg in package.json src/npm-package/package.json \
                   plugins/claude-code/.claude-plugin/plugin.json \
                   plugins/opencode/package.json \
                   src/npm-package/plugins/claude-code/.claude-plugin/plugin.json \
                   src/npm-package/plugins/opencode/package.json; do
          if [ -f "$ROOT_DIR/$pkg" ] && ! git diff --quiet -- "$ROOT_DIR/$pkg" 2>/dev/null; then
            git add "$ROOT_DIR/$pkg"
            SYNC_STAGED=$((SYNC_STAGED + 1))
          fi
        done
        # Stage AGENTS.md files with header-only modifications (header refresh is the only thing sync-version touches in AGENTS.md)
        while IFS= read -r -d '' agents_file; do
          if ! git diff --quiet -- "$agents_file" 2>/dev/null; then
            git add "$agents_file"
            SYNC_STAGED=$((SYNC_STAGED + 1))
          fi
        done < <(find "$ROOT_DIR" -name 'AGENTS.md' -not -path '*/node_modules/*' -not -path '*/.git/*' -print0)
        echo "   auto-staged $SYNC_STAGED file(s) from sync-version (package.json × ≤6 + AGENTS.md headers)"
      else
        echo "⚠️  sync-version failed; see /tmp/xp-gate-sync-version.log — continuing without auto-sync"
      fi
    fi
    echo "✅ PASSED - Gate 0: Version Consistency Check (VERSION/CHANGELOG staged)"
  else
    # Check for doc-only changes (no source code files)
    #
    # The extension list must cover every language an adapter supports, not just
    # the C-family languages this repo happens to be written in. It previously
    # stopped at `*.java`, so a staged .kt/.cs/.swift/.dart/.sh/.ps1 file made
    # Gate 0 report "doc-only changes" — and the doc-only path skips the REST OF
    # THE CHAIN. A Kotlin-only commit therefore ran no code gate at all, while
    # reading green. Found once the Kotlin fixtures stopped skipping themselves
    # (the skips had hidden it): kotlin-gate reported Gate 0 "doc-only" for a
    # fixture whose only staged file was BadCode.kt.
    #
    # Keep this identical to gate-5-entry.sh's CODE_EXTENSIONS, which is the list
    # the coverage gate already trusts. A second hand-maintained copy is exactly
    # how these two drifted apart.
    for file in $STAGED_FILES; do
      case "$file" in
        *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.py|*.go|*.java|*.kt|*.kts|*.cs|*.csx)
          has_source=true
          ;;
        *.cpp|*.cc|*.cxx|*.c|*.h|*.hpp|*.swift|*.m|*.mm|*.dart|*.sh|*.ps1)
          has_source=true
          ;;
        *.css|*.scss|*.rs)
          has_source=true
          ;;
      esac
    done

    # Check for build-tooling-only changes (adapters, scripts, hooks)
    has_real_source=false
    for file in $STAGED_FILES; do
      case "$file" in
        src/npm-package/adapters/*|src/npm-package/scripts/*|src/npm-package/hooks/*|scripts/*|githooks/adapters/*)
          continue ;;
        *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.py|*.go|*.java|*.kt|*.kts|*.cs|*.csx)
          has_real_source=true
          ;;
        *.cpp|*.cc|*.cxx|*.c|*.h|*.hpp|*.swift|*.m|*.mm|*.dart|*.sh|*.ps1)
          has_real_source=true
          ;;
        *.css|*.scss|*.rs)
          has_real_source=true
          ;;
      esac
    done

    # Doc-only / build-tooling-only changes need no VERSION bump.
    #
    # #624 defect 2: the split used to test ONLY `has_source`, which is true for
    # any .py/.ts/... path INCLUDING `scripts/*`. So a commit that touched
    # nothing but build tooling still fell into the version-check branch and was
    # blocked. `has_real_source` is exactly "production source that needs a bump"
    # — it was computed a few lines up but never consulted here. It must decide.
    if [ "$has_source" = "false" ]; then
      echo "✅ PASSED - Gate 0: Version Consistency Check (doc-only changes)"
    elif [ "$has_real_source" = "false" ]; then
      echo "✅ PASSED - Gate 0: Version Consistency Check (build-tooling-only changes)"
    else
      # Production source on a protected branch without VERSION/CHANGELOG.
      #
      # #624 defect 1: this branch used to offer a `[skip-version-check]` message
      # prefix as a bypass, read from `.git/COMMIT_EDITMSG`. That cannot work:
      # git runs pre-commit BEFORE it builds the message, so the file does not
      # exist yet (`-m`, `-F` and the interactive editor path all measured on
      # git 2.54), and the hook gets no arguments. What the old code read was the
      # PREVIOUS commit's message, so the prefix never matched — the documented
      # recipe silently could not clear the gate, and --no-verify was the only
      # way through. Rather than keep a bypass whose input this hook structurally
      # cannot see, the escape hatch is the one that actually works and is
      # already documented in CHANGELOG: the SKIP_VERSION_CHECK=1 environment
      # variable (handled earlier in this Gate 0 block).
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  VERSION CONSISTENCY CHECK (Gate 0)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Branch: $CURRENT_BRANCH
ERROR: Committing production source to a protected branch without a
VERSION/CHANGELOG update.

This bypasses the ship workflow and causes version drift.
Before committing:
  1. Update VERSION file with new version
  2. Add entry to CHANGELOG.md
  3. Run: node scripts/sync-version.cjs

Build-tooling-only changes (adapters/, scripts/, hooks/) need NO version bump
and pass this gate automatically — no marker required.

If you genuinely must land production source without a version bump, the
supported escape hatch is the env var (a message prefix cannot work here
because pre-commit runs before git builds the message):
  SKIP_VERSION_CHECK=1 git commit ...

Staged files: $(echo "$STAGED_FILES" | tr '\n' ', ' | sed 's/,$//')
"
      GATE_0_STATUS="BLOCK"
      record_gate_audit "gate-0" "version-consistency" "$GATE_0_STATUS" "1" "$GATE_0_START"
      return 1
    fi
  fi
  fi  # closes SKIP_VERSION_CHECK if/else
else
  echo "✅ PASSED - Gate 0: Version Consistency Check (non-protected branch: $CURRENT_BRANCH)"
fi

record_gate_audit "gate-0" "version-consistency" "$GATE_0_STATUS" "0" "$GATE_0_START"

echo ""

# Get list of changed files.
#
# Byte-identical mirrors (src/npm-package/**) are governed by CI Mirror Parity,
# not by re-linting. Leaving them in this scan set double-counted every
# lint/complexity signal and made jscpd report the source-vs-mirror pair as a
# 100% whole-file clone, which then tripped Gate 6's "<=5 warnings must clear
# to zero" rule on ANY edit to a mirrored file -- a warning that is
# structurally impossible to clear. (Gate 6's MIRROR_EXCLUDE and #494's test
# selection already exclude mirrors for the same reason.)
#
# IMPORTANT: the exclusion applies to the LINT SCAN CORPUS only. The early
# exit below must key on the RAW staged list -- Gate 8 (secret scanning) is
# unconditional and fail-closed (#499), and gating it behind a path-filtered
# list would let a mirror-only commit land with zero secret scanning and no
# CI backstop.
# Single source of truth for the mirror-path filter (#510): every consumer
# that must ignore the byte-identical npm-package mirrors (lint corpus here,
# Boy Scout's new/modified split further down) reads this one regex, so the
# two sites cannot drift apart.
# dashboard/ is a standalone browser-only visualization page (document/Chart.js
# globals, static HTML output). It is not part of the gate engine, never runs
# in CI or hooks, and its chart-config object literals trip structural rules
# (deep-nesting/long-function) that carry no signal for this codebase. Same
# scope rationale as the mirror exclusion (#507 Delphi round-2 follow-up).
MIRROR_PATH_FILTER='^src/npm-package/'
DASHBOARD_PATH_FILTER='^dashboard/'
RAW_CHANGED_FILES="${XP_STAGED_ACM:-$(git diff --cached --name-only --diff-filter=ACM)}"

# Dependencies and build output are not project code (#649).
#
# `git diff --cached` knows nothing about .gitignore: anything that reaches the
# index is listed. A project that vendors its dependencies, a CI fixture that
# commits after `npm install`, an accidental `git add -A`, or a monorepo's
# nested `packages/*/node_modules` therefore hands every downstream scanner a
# list containing third-party source, and each scanner judges it as the
# project's own.
#
# This has already cost two outages, one language branch at a time: #595 (Gate 1
# PowerShell arm blocked every commit once Playwright's node_modules was
# scanned for Write-Host) and #648 (Gate 1 JS/TS arm blocked on the bare
# `debugger;` in node_modules/typescript/dist/internal/utils.js). Both were
# fixed at the single site that happened to fail, so the next branch re-broke
# the same way. The filter belongs HERE, at the one place the list is built, so
# a scanner added tomorrow is safe by default instead of by memory.
#
# The exclusion itself is the shared build-output list from jscpd-run.sh
# (jscpd_is_build_output), so the directory names have one definition across the
# gates. Deliberately NOT the full Gate 2 ignore set: that one also drops
# *.yaml/*.yml/*.txt/*.log because repetition there is data shape rather than a
# refactoring target, and using it here would make a commit that only adds
# infra/deployment.yaml look like "No code files changed" -- skipping the IaC
# and lint gates that exist to scan exactly that file. The XP_GATE_JSCPD_DEFAULT_IGNORE=0
# escape hatch still applies.
#
# RAW_CHANGED_FILES stays unfiltered on purpose: it is the only truthful answer
# to "did the user stage anything at all", and a future "you accidentally
# committed dependencies" warning needs to see what this filter removed.
CHANGED_FILES=$(printf '%s\n' "$RAW_CHANGED_FILES" \
  | grep -v "$MIRROR_PATH_FILTER" | grep -v "$DASHBOARD_PATH_FILTER" \
  | {
      while IFS= read -r _cf; do
        [ -n "$_cf" ] || continue
        jscpd_is_build_output "$_cf" || printf '%s\n' "$_cf"
      done
    } || true)

# REQ-F2: one commit-level docs-only verdict, computed once and reused by the
# heavy gates (2/5/9/12). Light gates never consult it — a secret in a README
# is still a secret.
DOCS_ONLY_COMMIT=false
if printf '%s\n' "$CHANGED_FILES" | detect_docs_only_commit | grep -q '^true$'; then
  DOCS_ONLY_COMMIT=true
fi

if [ -z "$RAW_CHANGED_FILES" ]; then
  echo "No files changed. Skipping gates."
  return 0
fi

# Gate 5 test selection (#494): vitest.config.ts excludes the bundled mirror
# subtrees and the skills/plugins source trees, so a path under one of them can
# never be collected. When such a path is the only target, vitest exits 1 with
# "No test files found" and Gate 5 reports a failing test run -- a commit that
# touched nothing but a byte-identical mirror cannot land. Map each mirror path
# to the canonical twin it copies, drop what has no twin, collapse duplicates.
select_root_suite_targets() {
  # Deliberately not `s|...|...|`: the alternation below contains `|`, which sed
  # would read as the end of its pattern ("unknown option to `s'").
  printf '%s\n' "$1" \
    | sed -E 's#^src/npm-package/(principles|mutation|mock-policy|build-integrity)/#src/\1/#' \
    | grep -vE '^(src/_wip/|plugins/|skills/|src/npm-package/(plugins|skills|principles|mutation|mock-policy|build-integrity)/)' \
    | sed '/^$/d' \
    | sort -u
}

any_changed_files_match() {
  local pattern

  for pattern in "$@"; do
    # Here-string, not `printf | grep -q`. Under the `set -o pipefail` above,
    # `grep -q` exits the moment it matches, the writer takes SIGPIPE, and the
    # pipeline reports 141 -- so the `if` reads "no match" even though grep DID
    # match. Whether that happens depends on whether the list fits in the pipe
    # buffer, which is why it showed up as a size-dependent, flaky SKIP.
    #
    # It was not theoretical: in the Cross-Platform CI first-commit fixture the
    # staged list is long enough to trip it, and Gate 1 announced "No code files
    # changed, skipping lint" for a commit that had staged 19 shell scripts --
    # while Gate 2, reading the same variable, happily scanned them and reported
    # duplicates. The hook log carried the fingerprint the whole time:
    # `line 847: printf: Broken pipe`.
    #
    # A here-string has no writer process to be killed, so the match cannot be
    # lost. Same reason `run_tsx` and the coverage probes avoid `| head`.
    if grep -qE -- "$pattern" <<< "$CHANGED_FILES"; then
      return 0
    fi
  done
  return 1
}

# ============================================================================
# Multi-language detection (v0.15.0+): detect all languages from changed file
# extensions, with fallback to manifest-based detection.
# Result: PROJECT_LANGS (space-separated string), PROJECT_LANG (first language for
# compatibility), PROJECT_SUBDIR (derived from changed file paths in monorepos;
# v0.15.1+; ARCH-03 fix), PROJECT_SUBDIRS (per-language subdir override, empty = root).
# ============================================================================

# Language override resolution (project-level > git config > env var)
# Priority: .xp-gate-lang file > git config xp-gate.lang > XP_GATE_LANG env
_RESOLVED_LANG_OVERRIDE=""
if [ -f ".xp-gate-lang" ]; then
  _RESOLVED_LANG_OVERRIDE=$(sed -n '1p' .xp-gate-lang 2>/dev/null | tr -d '[:space:]')
elif git config xp-gate.lang >/dev/null 2>&1; then
  _RESOLVED_LANG_OVERRIDE=$(git config xp-gate.lang 2>/dev/null)
elif [ -n "${XP_GATE_LANG:-}" ]; then
  _RESOLVED_LANG_OVERRIDE="$XP_GATE_LANG"
  echo "⚠️  XP_GATE_LANG env var is deprecated for multi-project use."
  echo "   Prefer: echo '$XP_GATE_LANG' > .xp-gate-lang  OR  git config xp-gate.lang $XP_GATE_LANG"
fi

if [ -n "$_RESOLVED_LANG_OVERRIDE" ]; then
  PROJECT_LANGS="$_RESOLVED_LANG_OVERRIDE"
  PROJECT_LANG="$_RESOLVED_LANG_OVERRIDE"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "   🔧 LANGUAGE OVERRIDE: $PROJECT_LANG"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
elif [ -f ".xp-gate-config.json" ]; then
  # ---- Read from project config file (v0.15.2+) ----
  # .xp-gate-config.json is generated by `xp-gate init` or `xp-gate detect-languages`
  # It contains detected languages and their tool status.
  _CONFIG_LANGS=$(node -e "try{const c=JSON.parse(require('fs').readFileSync('.xp-gate-config.json','utf8'));console.log(Object.keys(c.languages||{}).join(' '));}catch(e){console.log('');}" 2>/dev/null || echo "")
  if [ -n "$_CONFIG_LANGS" ]; then
    PROJECT_LANGS="$_CONFIG_LANGS"
    PROJECT_LANG=$(echo "$_CONFIG_LANGS" | awk '{print $1}')
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "   📋 LANGUAGES FROM .xp-gate-config.json"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Detected languages: $PROJECT_LANGS"
    echo ""
  else
    # Config file exists but no languages detected — fall through to extension detection
    _CONFIG_LANGS=""
  fi
fi

# If no languages from override or config, detect from changed files
if [ -z "$PROJECT_LANGS" ] && [ -z "$_CONFIG_LANGS" ]; then
  # ---- Extension → language mapping ----
  # Extracts unique languages from changed file extensions
  PROJECT_LANGS=""
  _detect_ext_lang() {
    for ext in "$@"; do
      if echo "$CHANGED_FILES" | grep -qE "\.${ext}$" 2>/dev/null; then
        echo "1"
        return 0
      fi
    done
    echo "0"
    return 1
  }

  # Check changed files for each language by extension
  if [ "$(_detect_ext_lang "ts" "tsx" "js" "jsx" "mjs")" = "1" ]; then
    PROJECT_LANGS="$PROJECT_LANGS typescript"
  fi
  if [ "$(_detect_ext_lang "py")" = "1" ]; then
    PROJECT_LANGS="$PROJECT_LANGS python"
  fi
  if [ "$(_detect_ext_lang "go")" = "1" ]; then
    PROJECT_LANGS="$PROJECT_LANGS go"
  fi
  if [ "$(_detect_ext_lang "java")" = "1" ]; then
    PROJECT_LANGS="$PROJECT_LANGS java"
  fi
  if [ "$(_detect_ext_lang "kt" "kts")" = "1" ]; then
    PROJECT_LANGS="$PROJECT_LANGS kotlin"
  fi
  if [ "$(_detect_ext_lang "dart")" = "1" ]; then
    # Check for Flutter: if pubspec.yaml exists and contains flutter
    if [ -f "pubspec.yaml" ] && grep -q "flutter:" pubspec.yaml 2>/dev/null; then
      PROJECT_LANGS="$PROJECT_LANGS flutter"
    else
      PROJECT_LANGS="$PROJECT_LANGS dart"
    fi
  fi
  if [ "$(_detect_ext_lang "swift")" = "1" ]; then
    PROJECT_LANGS="$PROJECT_LANGS swift"
  fi
  if [ "$(_detect_ext_lang "m" "mm")" = "1" ]; then
    PROJECT_LANGS="$PROJECT_LANGS objectivec"
  fi
  if [ "$(_detect_ext_lang "cpp" "cxx" "cc" "c" "hpp" "h")" = "1" ]; then
    PROJECT_LANGS="$PROJECT_LANGS cpp"
  fi
  if [ "$(_detect_ext_lang "sh")" = "1" ]; then
    PROJECT_LANGS="$PROJECT_LANGS shell"
  fi
  if [ "$(_detect_ext_lang "ps1" "psm1")" = "1" ]; then
    PROJECT_LANGS="$PROJECT_LANGS powershell"
  fi
  # #717: without this arm a staged .cs file never produced a `csharp` entry in
  # PROJECT_LANGS, so the per-language loop at the adapter-routing site had no
  # turn in which to resolve adapters/csharp.sh -- the adapter was unreachable
  # no matter how correct it was. Detection on extensions (not manifests) is why
  # one arm is enough: a repo staging .cs always lands here.
  if [ "$(_detect_ext_lang "cs" "csx")" = "1" ]; then
    PROJECT_LANGS="$PROJECT_LANGS csharp"
  fi
  # IaC: .tf, .tfvars, Dockerfile, docker-compose*, .yaml/.yml in kube context
  if echo "$CHANGED_FILES" | grep -qE '(\.tf$|\.tfvars$|Dockerfile|docker-compose)' 2>/dev/null; then
    PROJECT_LANGS="$PROJECT_LANGS iac"
  fi

  # Trim leading space
  PROJECT_LANGS="${PROJECT_LANGS# }"

  # ---- Fallback: manifest-based detection when no extension matches ----
  if [ -z "$PROJECT_LANGS" ]; then
    if [ -f "package.json" ]; then
      HAS_RN=$(grep -q "react-native" package.json 2>/dev/null && echo "yes" || echo "no")
      HAS_IOS=$([ -d "ios" ] && echo "yes" || echo "no")
      HAS_ANDROID=$([ -d "android" ] && echo "yes" || echo "no")
      if [ "$HAS_RN" = "yes" ] || { [ "$HAS_IOS" = "yes" ] && [ "$HAS_ANDROID" = "yes" ]; }; then
        PROJECT_LANGS="react-native"
      else
        PROJECT_LANGS="typescript"
      fi
    elif [ -f "pyproject.toml" ] || [ -f "setup.py" ] || [ -f "requirements.txt" ]; then
      PROJECT_LANGS="python"
    elif [ -f "go.mod" ]; then
      PROJECT_LANGS="go"
    elif [ -f "pubspec.yaml" ]; then
      if grep -q "flutter:" pubspec.yaml 2>/dev/null || [ -f ".metadata" ]; then
        PROJECT_LANGS="flutter"
      else
        PROJECT_LANGS="dart"
      fi
    elif [ -f "pom.xml" ] || [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
      KOTLIN_FILES=$(find . -name "*.kt" -not -path "./.git/*" -not -path "*/node_modules/*" 2>/dev/null | wc -l)
      if [ "$KOTLIN_FILES" -gt 0 ]; then
        PROJECT_LANGS="kotlin"
      else
        PROJECT_LANGS="java"
      fi
    elif [ -f "CMakeLists.txt" ] || [ -f "Makefile" ]; then
      CPP_FILES=$(find . -maxdepth 2 \( -name "*.cpp" -o -name "*.cxx" -o -name "*.cc" \) -not -path "./.git/*" -not -path "*/node_modules/*" 2>/dev/null | head -1)
      OBJC_FILES=$(find . -maxdepth 2 \( -name "*.m" -o -name "*.mm" \) -not -path "./.git/*" -not -path "*/node_modules/*" 2>/dev/null | head -1)
      if [ -n "$CPP_FILES" ]; then
        PROJECT_LANGS="cpp"
      elif [ -n "$OBJC_FILES" ]; then
        PROJECT_LANGS="objectivec"
      fi
    elif [ -n "$(find . -maxdepth 2 -name "*.ps1" -not -path "./.git/*" -not -path "*/node_modules/*" 2>/dev/null | head -1)" ]; then
      PROJECT_LANGS="powershell"
    fi
  fi

  # ---- Derive PROJECT_SUBDIR from changed file paths (v0.15.1+; ARCH-03 fix) ----
  # Extension-based detection sets PROJECT_LANGS but leaves PROJECT_SUBDIR empty.
  # In a monorepo where config files (tsconfig.json, pyproject.toml, ...) live in
  # subdirectories (e.g. packages/frontend/), we must derive the subdirectory from
  # the actual changed files so that Gates 1-9 run in the correct context.
  PROJECT_SUBDIR=""
  if [ -n "$PROJECT_LANGS" ]; then
    # Walk up from each changed file to find the nearest project marker.
    _detect_subdir() {
      local fdir
      fdir=$(dirname "$1")
      while [ "$fdir" != "." ] && [ "$fdir" != "/" ]; do
        # Skip node_modules, .git, and other non-project directories
        case "$fdir" in
          */node_modules/*) fdir="${fdir%/*}" ; continue ;;
          */.git/*) fdir="${fdir%/*}" ; continue ;;
        esac
        if [ -f "$fdir/tsconfig.json" ] || [ -f "$fdir/package.json" ] || \
           [ -f "$fdir/pyproject.toml" ] || [ -f "$fdir/setup.py" ] || \
           [ -f "$fdir/go.mod" ] || [ -f "$fdir/pubspec.yaml" ] || \
           [ -f "$fdir/pom.xml" ] || [ -f "$fdir/build.gradle" ] || \
           [ -f "$fdir/build.gradle.kts" ] || [ -f "$fdir/CMakeLists.txt" ]; then
          echo "$fdir"
          return 0
        fi
        case "$fdir" in
          */*) fdir="${fdir%/*}" ;;
          *) break ;;
        esac
      done
      return 1
    }
    # #527: two ecosystems whose MULTI-module layouts normally carry a root
    # marker, so a root marker alone cannot prove "single project":
    #   - Gradle: root build.gradle(.kts) + settings.gradle(.kts) with include
    #   - CMake:  root CMakeLists.txt + a nested */CMakeLists.txt
    # Both probes are bounded (two file reads for Gradle; one maxdepth-7 find
    # for CMake — MC-05, no new unbounded scan) and only run once a root marker
    # is present. A false positive keeps derivation ON — the #515 default —
    # so the failure direction is never a false BLOCK.
    _gradle_multi_module_root() {
      local _sg
      for _sg in settings.gradle settings.gradle.kts; do
        # include ':app' (Groovy) / include(":app") (Kotlin DSL). The char
        # class anchors on the token after `include`, so `includeBuild` and
        # comment prose cannot false-positive.
        if [ -f "$_sg" ] && grep -qE "include[[:space:]]*['\"(]" "$_sg" 2>/dev/null; then
          return 0
        fi
      done
      return 1
    }
    _cmake_multi_module_root() {
      [ -f "CMakeLists.txt" ] || return 1
      # A nested CMakeLists.txt (depth 2..7 below the root) means the root file
      # is a wiring file, not the whole project.
      # -prune, not -not -path: filters the output AND stops traversal, so
      # .git/node_modules are never descended into — the old form walked the
      # whole tree on every commit of a repo that has both a root
      # CMakeLists.txt and a big node_modules (#532 walkthrough FC-04).
      # -mindepth is deliberately absent (a global -mindepth suppresses the
      # depth-1 prune action); the root file is excluded by the awk NF>2
      # filter instead (./CMakeLists.txt has no directory component).
      [ -n "$(find . -maxdepth 7 \( -path '*/.git' -o -path '*/node_modules' \) -prune -o -name "CMakeLists.txt" -print 2>/dev/null | awk -F/ 'NF>2' | head -1)" ]
    }
    # #515: when the repo ROOT itself declares the project, a nested marker that
    # is merely a module file (skill_cert/cli/setup.py incident) must not hijack
    # PROJECT_SUBDIR — Gates 1-9 would run from the wrong cwd and false-BLOCK on
    # root-relative paths. The root-marker set below MUST stay aligned with
    # _detect_subdir's marker set above (10 markers): every ecosystem recognized
    # for subproject derivation is also protected at the root. The JS-monorepo
    # check runs FIRST (#515 R2 delphi walkthrough): a root package.json with a
    # "workspaces" key declares a JS monorepo (often together with a shared
    # tsconfig.json), not a single project, so derivation keeps running there.
    # #527 (resolved): Gradle multi-module and CMake subdirectory layouts are
    # disambiguated by the predicates above; the short-circuit now applies to
    # genuinely single-project roots. pnpm/Lerna workspaces remain a known
    # limitation (no probe yet). Migration: repos that depended on the old
    # short-circuit set XP_GATE_ROOT_SHORTCIRCUIT=1 (or delete the root
    # marker); see githooks/__tests__/issue-527-subdir-multimodule.test.bats.
    _skip_subdir_derive=0
    if [ -f package.json ] && grep -q '"workspaces":' package.json 2>/dev/null; then
      _skip_subdir_derive=0 # JS monorepo root: subproject derivation stays on
    elif [ -f package.json ] || [ -f tsconfig.json ] || [ -f pyproject.toml ] || \
         [ -f setup.py ] || [ -f go.mod ] || [ -f pubspec.yaml ] || \
         [ -f pom.xml ] || [ -f build.gradle ] || \
         [ -f build.gradle.kts ] || [ -f CMakeLists.txt ]; then
      # #527: before short-circuiting, ask whether the root marker declares
      # MODULES (Gradle settings include / nested CMakeLists) rather than one
      # project. The override restores the pre-#527 behavior explicitly.
      if [ "${XP_GATE_ROOT_SHORTCIRCUIT:-0}" = "1" ]; then
        _skip_subdir_derive=1
      elif _gradle_multi_module_root || _cmake_multi_module_root; then
        _skip_subdir_derive=0 # root marker declares modules — keep deriving
      else
        _skip_subdir_derive=1
      fi
    fi
    _subdir_set=""
    if [ "$_skip_subdir_derive" -eq 0 ]; then
      while IFS= read -r _changed; do
        [ -z "$_changed" ] && continue
        _d=$(_detect_subdir "$_changed" 2>/dev/null) || true
        if [ -n "$_d" ] && [ "$_d" != "." ]; then
          case " $_subdir_set " in
            *" $_d "*) ;; # already seen
            *) _subdir_set="${_subdir_set} $_d" ;;
          esac
        fi
      done <<CHANGEDFILELIST
$CHANGED_FILES
CHANGEDFILELIST
      _subdir_count=$(echo "$_subdir_set" | awk '{ n=0; for(i=1;i<=NF;i++) n++; print n }')
      if [ "$_subdir_count" = "1" ]; then
        PROJECT_SUBDIR=$(echo "$_subdir_set" | awk '{print $1}')
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "   📁 MULTILANGUAGE SUBDIR DETECTED FROM CHANGED FILES"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "Language: $PROJECT_LANGS"
        echo "Location: $PROJECT_SUBDIR/"
        echo ""
      fi
    fi
  fi

  # ---- Subdirectory fallback (for single-language projects in subdirectories) ----
  # Only used when extension-based detection found nothing
  if [ -z "$PROJECT_LANGS" ]; then
    # Search for TypeScript/JavaScript projects
    TSCONFIG_SUB=$(find . -maxdepth 2 -name "tsconfig.json" -not -path "./.git/*" -not -path "*/node_modules/*" -not -path "./node_modules/*" 2>/dev/null | head -1)
    if [ -n "$TSCONFIG_SUB" ]; then
      PROJECT_SUBDIR=$(dirname "$TSCONFIG_SUB")
      if [ -f "$PROJECT_SUBDIR/package.json" ] && grep -q "react-native" "$PROJECT_SUBDIR/package.json" 2>/dev/null; then
        PROJECT_LANGS="react-native"
      else
        PROJECT_LANGS="typescript"
      fi
    fi

    # Search for Python projects
    if [ -z "$PROJECT_LANGS" ]; then
      PYPROJECT_SUB=$(find . -maxdepth 2 -name "pyproject.toml" -not -path "./.git/*" -not -path "*/node_modules/*" 2>/dev/null | head -1)
      if [ -n "$PYPROJECT_SUB" ]; then
        PROJECT_LANGS="python"
        PROJECT_SUBDIR=$(dirname "$PYPROJECT_SUB")
      fi
    fi

    # Search for Go projects
    if [ -z "$PROJECT_LANGS" ]; then
      GOMOD_SUB=$(find . -maxdepth 2 -name "go.mod" -not -path "./.git/*" -not -path "*/node_modules/*" 2>/dev/null | head -1)
      if [ -n "$GOMOD_SUB" ]; then
        PROJECT_LANGS="go"
        PROJECT_SUBDIR=$(dirname "$GOMOD_SUB")
      fi
    fi

    # Search for Flutter/Dart projects
    if [ -z "$PROJECT_LANGS" ]; then
      PUBSPEC_SUB=$(find . -maxdepth 2 -name "pubspec.yaml" -not -path "./.git/*" -not -path "*/node_modules/*" 2>/dev/null | head -1)
      if [ -n "$PUBSPEC_SUB" ]; then
        if grep -q "flutter:" "$PUBSPEC_SUB" 2>/dev/null || [ -f "$(dirname "$PUBSPEC_SUB")/.metadata" ]; then
          PROJECT_LANGS="flutter"
        else
          PROJECT_LANGS="dart"
        fi
        PROJECT_SUBDIR=$(dirname "$PUBSPEC_SUB")
      fi
    fi

    # Search for Java/Kotlin projects
    if [ -z "$PROJECT_LANGS" ]; then
      POM_SUB=$(find . -maxdepth 2 -name "pom.xml" -not -path "./.git/*" -not -path "*/node_modules/*" 2>/dev/null | head -1)
      GRADLE_SUB=$(find . -maxdepth 2 -name "build.gradle" -not -path "./.git/*" -not -path "*/node_modules/*" 2>/dev/null | head -1)
      if [ -n "$POM_SUB" ] || [ -n "$GRADLE_SUB" ]; then
        MANIFEST_FILE="${POM_SUB:-$GRADLE_SUB}"
        PROJECT_SUBDIR=$(dirname "$MANIFEST_FILE")
        KOTLIN_COUNT=$(find "$PROJECT_SUBDIR" -name "*.kt" -not -path "*/.git/*" 2>/dev/null | wc -l)
        if [ "$KOTLIN_COUNT" -gt 0 ]; then
          PROJECT_LANGS="kotlin"
        else
          PROJECT_LANGS="java"
        fi
      fi
    fi

    # Search for C++ projects
    if [ -z "$PROJECT_LANGS" ]; then
      CMAKE_SUB=$(find . -maxdepth 2 -name "CMakeLists.txt" -not -path "./.git/*" -not -path "*/node_modules/*" 2>/dev/null | head -1)
      if [ -n "$CMAKE_SUB" ]; then
        PROJECT_LANGS="cpp"
        PROJECT_SUBDIR=$(dirname "$CMAKE_SUB")
      fi
    fi

    # Search for React Native projects (ios/ + android/ directories)
    if [ -z "$PROJECT_LANGS" ]; then
      RN_SUB=$(find . -maxdepth 2 -type d -name "ios" -not -path "./.git/*" -not -path "*/node_modules/*" 2>/dev/null | head -1)
      if [ -n "$RN_SUB" ]; then
        PROJECT_SUBDIR=$(dirname "$RN_SUB")
        if [ -d "$PROJECT_SUBDIR/android" ] || [ -f "$PROJECT_SUBDIR/package.json" ]; then
          PROJECT_LANGS="react-native"
        fi
      fi
    fi

    # Search for PowerShell projects
    if [ -z "$PROJECT_LANGS" ]; then
      PS_SUB=$(find . -maxdepth 2 -name "*.ps1" -not -path "./.git/*" -not -path "*/node_modules/*" 2>/dev/null | head -1)
      if [ -n "$PS_SUB" ]; then
        PROJECT_LANGS="powershell"
        PROJECT_SUBDIR=$(dirname "$PS_SUB")
      fi
    fi

    # Report detected subdirectory project
    if [ -n "$PROJECT_SUBDIR" ] && [ -n "$PROJECT_LANGS" ]; then
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "   📁 SUBDIRECTORY PROJECT DETECTED"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ""
      echo "Language: $PROJECT_LANGS"
      echo "Location: $PROJECT_SUBDIR/"
      echo ""
    fi
  fi

  # Set PROJECT_LANG for backward compatibility (first language in list)
  PROJECT_LANG=$(echo "$PROJECT_LANGS" | awk '{print $1}')

  # ---- Documentation-only fallback ----
  if [ -z "$PROJECT_LANGS" ]; then
    CODE_FILES=$(find . -type f \( -name "*.py" -o -name "*.js" -o -name "*.ts" -o -name "*.tsx" -o -name "*.java" -o -name "*.go" -o -name "*.rs" -o -name "*.cpp" -o -name "*.c" -o -name "*.swift" -o -name "*.kt" -o -name "*.sh" -o -name "*.dart" -o -name "*.ps1" \) -not -path "./.git/*" -not -path "*/node_modules/*" 2>/dev/null | wc -l)

    if [ "$CODE_FILES" -eq 0 ]; then
      PROJECT_LANGS="documentation-only"
      PROJECT_LANG="documentation-only"
      echo ""
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "   📚 DOCUMENTATION-ONLY PROJECT DETECTED"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ""
      echo "This project contains no source code files."
      echo "Skipping static analysis and test gates."
      echo ""
      echo "Proceeding with documentation-only checks..."
    fi
  fi

  # ---- Multi-language project banner ----
  _lang_count=$(echo "$PROJECT_LANGS" | wc -w)
  if [ "$_lang_count" -gt 1 ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "   🌐 MULTI-LANGUAGE PROJECT DETECTED"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Detected $_lang_count languages from changed files:"
    for _l in $PROJECT_LANGS; do
      echo "  • $_l"
    done
    echo ""
  fi
fi  # close language override if/else

# Helper: check if a language is in PROJECT_LANGS
has_project_lang() {
  for lang in $PROJECT_LANGS; do
    if [ "$lang" = "$1" ]; then return 0; fi
  done
  return 1
}
# Switch to subdirectory if detected (for single-language subdirectory projects).
# Multi-language projects stay at root — each adapter handles its own path.
#
# IN_PROJECT_SUBDIR records whether this cd actually happened. Git reports
# staged paths relative to the repo root; after cd "$PROJECT_SUBDIR" the [ -f ]
# probes below need subdirectory-relative paths (hence the PROJECT_SUBDIR
# prefix strips in Gates 5a/5b/5c), but when the hook stays at the root
# (multi-language projects) stripping the prefix makes every path-based check
# resolve against the wrong directory — false BLOCKs in Gate 5a, silent no-ops
# in 5b/5c. Only strip when we really are inside the subdirectory.
ORIGINAL_DIR=""
IN_PROJECT_SUBDIR=0
_lang_count=$(echo "$PROJECT_LANGS" | wc -w)
if [ -n "$PROJECT_SUBDIR" ] && [ "$PROJECT_SUBDIR" != "." ] && [ "$PROJECT_LANG" != "documentation-only" ] && [ "$_lang_count" -le 1 ]; then
  ORIGINAL_DIR=$(pwd)
  # #392-#10: guard cd so a missing subdir cannot run gates in the wrong cwd.
  if cd "$PROJECT_SUBDIR" 2>/dev/null; then
    IN_PROJECT_SUBDIR=1
    echo "Working in: $PROJECT_SUBDIR/"
    echo ""
  else
    echo "WARN: could not enter $PROJECT_SUBDIR — continuing at repo root" >&2
  fi
fi
  return 0
}



# Called by pre-commit's ordered driver.

