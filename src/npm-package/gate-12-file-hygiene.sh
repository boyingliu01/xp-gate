# ============================================================================
# GATE 12: File Hygiene Check
# Detects common file quality issues in staged files:
# - Trailing whitespace
# - Missing EOF newline
# - Merge conflict markers (<<<<<<< , =======, >>>>>>>)
# - Oversized files (>1MB default, configurable)
# ============================================================================

 2>&1 echo ""
 2>&1 echo "→ Gate 12: File hygiene check..."
GATE_12_START=$(gate_start_ms)

# Configuration (can be overridden via environment)
MAX_FILE_SIZE_BYTES="${XP_GATE_MAX_FILE_SIZE:-1048576}"  # 1MB default

# Get list of staged files (excluding deleted files)
#
# Third-party trees are excluded. In a fresh `git init` fixture the CI's
# "First Commit Gates" job does `git add -A` before committing, so every
# node_modules/ file becomes staged — and third-party packages legitimately
# CONTAIN `<<<<<<<` text as documentation (semver/README.md, various NOTICE.txt).
# Gate 12 then reported "merge conflict markers detected" for files no author
# wrote, blocking the fixture commit, on every commit for months. A hygiene check
# that reads vendored documentation as a conflict is not finding anything.
#
# This is the same class as the __pycache__ filter in check-hook-mirror.sh (#587):
# build/dependency artefacts are not project source and must not be judged as it.
STAGED_FILES=$(git diff --cached --name-only --diff-filter=d 2>/dev/null \
  | grep -vE '(^|/)(node_modules|\.stryker-tmp|vendor)/' || true)

if [ -z "$STAGED_FILES" ]; then
  echo "     ℹ️  No staged files — skipping"
  echo "     ✅ PASSED - File Hygiene (no files to check)"
  GATE_12_STATUS="SKIP"
  record_gate_audit "gate-12" "file-hygiene" "$GATE_12_STATUS" "0" "$GATE_12_START" "${GATE_12_DETAIL:-}"
  # shellcheck disable=SC2317  # the gate body is SOURCED, never run to completion here:
  # the driver calls gate_12_run and treats a returned rc as the verdict, so the
  # lines after this return ARE reachable in production (see pre-commit).
  return 0 2>/dev/null || true
fi

# REQ-F2: a docs-only commit cannot introduce code regressions; conflict
# markers and YAML/JSON syntax are still checked (diff-scoped below).
if [ "${DOCS_ONLY_COMMIT:-false}" = true ]; then
  echo "     ⏭️  SKIPPED - File hygiene heavy checks (documentation-only commit; diff-scoped checks still run)."
  GATE_12_STATUS="SKIP"
  GATE_12_DOCS_ONLY=true
fi

HYGIENE_ISSUES=0
HYGIENE_FILES=""

# Is this staged file binary (so line-based checks do not apply)?
#
# This replaces `grep -q $'\x00'`, which was a no-op guard: bash strips NUL from
# `$'\x00'`, so the pattern was the EMPTY string and `grep -q ""` matches any
# non-empty input. Every staged file was therefore judged binary and `continue`d,
# silently disabling Check 1 (trailing whitespace), Check 2 (missing EOF newline)
# and -- worst -- Check 3 (merge conflict markers, a BLOCK-level check). Checks 4
# and 5 lacked the guard, which is why the gate looked half-working.
#
# Ask git instead of guessing: `--numstat` reports a binary entry as `-\t-\t<path>`
# because git already made that determination. A byte-level NUL test cannot be
# written with a shell pattern at all (variables and command substitution both drop
# NUL), and `grep -I` only suppresses output on a binary input -- it does not make
# `grep -q` fail, which is why that shortcut still reported text.
is_binary_staged_file() {
  case " $GATE_12_BINARY_SET " in
    *" $1 "*) return 0 ;;   # binary: git could not count lines
    *) return 1 ;;          # text (or empty -- nothing for the line checks)
  esac
}

# Classify the WHOLE change set in one git call.
#
# This used to be `git diff --cached --numstat -- "$file"` inside
# is_binary_staged_file, i.e. one process per file PER CHECK that asked. Three
# checks ask, so every staged text file cost three git spawns just to learn
# "text", before any check looked at a byte:
#
#     measured 2026-11-19, plain-text fixture, this machine:
#       300 staged files   4m22s    (~0.87 s/file)
#       100 staged files   2m36s
#         0 staged files   0.5s     (the loop never runs)
#
# and the audit journal agrees -- 1208 credible file-hygiene rows, median 4.2s,
# p90 41.7s, 244 over 20s. The cost is process creation, not bytes examined, so
# it scales with the change set; a text check should not be the second most
# expensive gate in the chain.
#
# `--numstat` already reports the whole index in one shot and marks a binary
# entry as `-\t-\t<path>`. Same predicate, computed once. If git fails the set
# stays empty and every file is treated as text -- identical to the old per-file
# fallback (a failed `git diff` produced no finding).
GATE_12_BINARY_SET=" "
while IFS=$'\t' read -r _g12_adds _g12_dels _g12_path; do
  [ -z "$_g12_path" ] && continue
  case "$_g12_adds" in
    -) GATE_12_BINARY_SET="${GATE_12_BINARY_SET}${_g12_path} " ;;
  esac
done <<EOF
$(git diff --cached --numstat --diff-filter=d 2>/dev/null | grep -vE '(^|/)(node_modules|\.stryker-tmp|vendor)/')
EOF

# --- Checks 1 and 2 share ONE process per file, not two --------------------
#
# Both checks read the same blob. They used to read it separately:
#
#     git show ":$file" | grep -qE '[[:space:]]$'   # trailing whitespace
#     git show ":$file" | tail -c 1                 # missing EOF newline
#
# so the content was produced twice per file. `git cat-file --batch` streams both
# answers from a single process for the whole change set.
#
# The two predicates are unchanged, which is the point of the rewrite:
#   trailing whitespace -> a line ending in space/tab exists in the blob
#   missing EOF newline -> the blob is non-empty and its last byte is not \n
#
# The last byte is taken with `od`, not command substitution: `$(...)` strips
# every trailing newline, which is the original defect this check documents --
# a correctly terminated file reported its last visible character and was flagged
# every time.
# The AWK scanner that answers all three content checks in one process. Resolved
# next to this script's own directory chain, like every other shared library, so
# a global install (~/.config/xp-gate/) and the tracked tree both work.
#
# The layouts this must cover, all of which keep the scanner in a `lib/` beside
# the gate script:
#
#     githooks/gate-12-file-hygiene.sh          -> githooks/lib/gate-12-blob-scan.awk
#     githooks/adapters/gate-12-file-hygiene.sh -> githooks/lib/gate-12-blob-scan.awk   (one level up)
#     ~/.config/xp-gate/adapters/gate-12-...sh  -> ~/.config/xp-gate/lib/...           (one level up)
#
# Candidates are normalised with `cd ... && pwd` before the `-f` test: measured
# 2026-11-20 on Git for Windows, `[ -f ".../githooks/../lib/x" ]` answers FALSE --
# the test builtin does not resolve `..`. When the loop finds nothing,
# GATE_12_SCANNER stays empty, `_g12_scan_blobs` bails at its own `-f` guard, and
# all three checks report nothing while the gate prints PASS.
if [ -z "${GATE_12_SCANNER:-}" ]; then
  _g12_here=$(dirname "${BASH_SOURCE[0]}")
  for _g12_dir in "${GATE_DIR:-}" "$_g12_here" "$_g12_here/.." "$_g12_here/../.."; do
    [ -n "$_g12_dir" ] || continue
    # Normalise; a directory that cannot be entered is not a candidate.
    _g12_dir=$(cd "$_g12_dir" 2>/dev/null && pwd) || continue
    if [ -f "$_g12_dir/lib/gate-12-blob-scan.awk" ]; then
      GATE_12_SCANNER="$_g12_dir/lib/gate-12-blob-scan.awk"
      break
    fi
  done
  unset _g12_dir
fi
GATE_12_SCANNER="${GATE_12_SCANNER:-}"

GATE_12_HAS_TRAILING_WS=" "
GATE_12_MISSING_EOF=" "
GATE_12_HAS_CONFLICT=" "

_g12_scan_blobs() {
  # ONE awk process for the whole change set (see githooks/lib/gate-12-blob-scan.awk
  # for the measurements that made this a rewrite rather than a tidy-up).
  #
  # The path list is |-separated because a staged path may contain a newline.
  local _paths _out
  _paths=$(printf %s "$STAGED_FILES" | tr '\n' '|')
  [ -z "$_paths" ] && return 0
  _out=$(printf '%s\n' "$STAGED_FILES" | sed 's/^/:/' \
    | git cat-file --batch 2>/dev/null \
    | awk -v paths="$_paths" -f "$GATE_12_SCANNER" 2>/dev/null) || return 0
  [ -z "$_out" ] && return 0
  GATE_12_HAS_TRAILING_WS=$(printf %s "$_out" | sed -n 's/^WS://p')
  GATE_12_MISSING_EOF=$(printf %s "$_out" | sed -n 's/^NOEOF://p')
  GATE_12_HAS_CONFLICT=$(printf %s "$_out" | sed -n 's/^CONFLICT://p')
}

if [ "${GATE_12_DOCS_ONLY:-false}" != true ]; then
  _g12_scan_blobs
fi

_g12_in_set() {
  case " $1 " in
    *" $2 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# --- Check 1: Trailing whitespace ---
TRAILING_WS_FILES=""
for file in $GATE_12_HAS_TRAILING_WS; do
  TRAILING_WS_FILES="$TRAILING_WS_FILES $file"
done

if [ -n "$TRAILING_WS_FILES" ]; then
  echo "     ⚠️  Trailing whitespace detected in:"
  for f in $TRAILING_WS_FILES; do
    echo "        - $f"
  done
  HYGIENE_ISSUES=$((HYGIENE_ISSUES + 1))
  HYGIENE_FILES="$HYGIENE_FILES trailing-whitespace"
fi

# --- Check 2: Missing EOF newline ---
# Reads the LAST BYTE from the raw blob. The previous form captured the content
# with $(...) and then asked for its final character: command substitution
# strips every trailing newline, so a file that ends correctly produced its last
# visible character — never empty — and was reported as missing its newline.
# Every staged text file was a false positive, which is how a check that always
# fires looks exactly like a strict check. `git show | tail -c 1` keeps the byte.
file_missing_eof_newline() {
  # Answered by _g12_scan_blobs, from the same single process that answered
  # Check 1. Kept as a named predicate because that is the question being asked;
  # the implementation is a set lookup now.
  _g12_in_set "$GATE_12_MISSING_EOF" "$1"
}

NO_EOF_NEWLINE_FILES=""
if [ "${GATE_12_DOCS_ONLY:-false}" != true ]; then
for file in $GATE_12_MISSING_EOF; do
  NO_EOF_NEWLINE_FILES="$NO_EOF_NEWLINE_FILES $file"
done
fi

if [ -n "$NO_EOF_NEWLINE_FILES" ]; then
  echo "     ⚠️  Missing EOF newline in:"
  for f in $NO_EOF_NEWLINE_FILES; do
    echo "        - $f"
  done
  HYGIENE_ISSUES=$((HYGIENE_ISSUES + 1))
  HYGIENE_FILES="$HYGIENE_FILES no-eof-newline"
fi

# --- Check 3: Merge conflict markers ---
# Runs in BOTH modes. Docs-only commits read the staged DIFF (hunk cost)
# instead of every full blob — a marker line must be ADDED to matter, so
# '^+' minus '+++' headers is the precise scope.
# Exactly 7 chars + a space/EOL boundary: longer runs (Maven `====` log separators, RST/setext underlines) are not conflicts.
CONFLICT_MARKER_FILES=""
if [ "${GATE_12_DOCS_ONLY:-false}" = true ]; then
  if git diff --cached --no-color --diff-filter=d 2>/dev/null \
      | grep -E '^\+' | grep -v '^+++' | grep -qE '^\+(<{7}|={7}|>{7})([[:space:]]|$)'; then
    CONFLICT_MARKER_FILES="$STAGED_FILES"
  fi
else
for file in $GATE_12_HAS_CONFLICT; do
  CONFLICT_MARKER_FILES="$CONFLICT_MARKER_FILES $file"
done
fi

if [ -n "$CONFLICT_MARKER_FILES" ]; then
  echo "     ❌ Merge conflict markers detected in:"
  for f in $CONFLICT_MARKER_FILES; do
    echo "        - $f"
  done
  HYGIENE_ISSUES=$((HYGIENE_ISSUES + 1))
  HYGIENE_FILES="$HYGIENE_FILES conflict-markers"
fi

# --- Check 4: Oversized files ---
OVERSIZED_FILES=""
if [ "${GATE_12_DOCS_ONLY:-false}" != true ]; then
while IFS= read -r file; do
  [ -z "$file" ] && continue
  [ ! -f "$file" ] && continue
  # `wc -c` is a process per file; measured 300 files = 12.6s on this machine,
  # which after the blob scanner was the largest remaining share of a 36.9s run.
  # `$(<file)` is a bash builtin with no fork, and `LC_ALL=C` makes ${#var} a
  # BYTE count rather than a character count -- the threshold is in bytes
  # (XP_GATE_MAX_FILE_SIZE, default 1 MiB), so a multibyte file must not measure
  # short and slip under it.
  #
  # Binary files are not excluded from this check, so the read must not choke on
  # them: an unreadable blob leaves FILE_SIZE empty and the comparison is skipped,
  # exactly as a failed `wc -c` did.
  FILE_SIZE=""
  if [ -r "$file" ]; then
    _g12_content=$(LC_ALL=C IFS= read -r -d '' _g12_all < "$file" 2>/dev/null; printf '%s' "${#_g12_all}")
    FILE_SIZE=$((${_g12_content:-0}))
    unset _g12_content
  fi
  if [ -n "$FILE_SIZE" ] && [ "$FILE_SIZE" -gt "$MAX_FILE_SIZE_BYTES" ]; then
    SIZE_MB=$((FILE_SIZE / 1048576))
    OVERSIZED_FILES="$OVERSIZED_FILES $file(${SIZE_MB}MB)"
  fi
done <<EOF
$STAGED_FILES
EOF
fi

if [ -n "$OVERSIZED_FILES" ]; then
  echo "     ⚠️  Oversized files (>${MAX_FILE_SIZE_BYTES} bytes):"
  for f in $OVERSIZED_FILES; do
    echo "        - $f"
  done
  HYGIENE_ISSUES=$((HYGIENE_ISSUES + 1))
  HYGIENE_FILES="$HYGIENE_FILES oversized-files"
fi

# --- Check 5: YAML/JSON syntax validation (Issue #351) ---
# Only check staged YAML/JSON files that have changes
#
# #772: these were accumulated into a space-separated STRING and re-split with an
# unquoted `for f in $YAML_JSON_ERRORS`. Parser messages contain spaces, so one
# broken file printed as a run of fake "filenames" -- PyYAML's
# "while parsing a flow sequence" became five entries. The list under
# "YAML/JSON syntax errors:" reads as the set of files to go fix, so the split
# sent the reader hunting for files that do not exist. Arrays keep each entry
# whole no matter what the message contains.
YAML_JSON_ERRORS=()
YAML_JSON_CHECK_COUNT=0

# Detect available validators
YAML_CMD=""
if command -v python3 >/dev/null 2>&1; then
  YAML_CMD="python3"
elif command -v python >/dev/null 2>&1; then
  YAML_CMD="python"
fi

JSON_CMD=""
if command -v node >/dev/null 2>&1; then
  JSON_CMD="node"
elif command -v jq >/dev/null 2>&1; then
  JSON_CMD="jq"
fi

# Check which staged YAML/JSON files actually changed (REQ-F3: a repo with 40
# YAML configs but one edited file validates ONE blob, not forty).
CHANGED_YAML_JSON=$(git diff --cached --name-only --diff-filter=d -- '*.yml' '*.yaml' '*.json' 2>/dev/null)

while IFS= read -r file; do
  [ -z "$file" ] && continue
  [ ! -f "$file" ] && continue

  case "$file" in
    *.yml|*.yaml)
      if [ -n "$YAML_CMD" ]; then
        YAML_JSON_CHECK_COUNT=$((YAML_JSON_CHECK_COUNT + 1))
        # Validate YAML syntax using Python's yaml module
        YAML_ERROR=$(git show ":$file" 2>/dev/null | $YAML_CMD -c "
import sys, yaml
try:
    yaml.safe_load(sys.stdin.read())
except yaml.YAMLError as e:
    print(str(e).split(chr(10))[0])
    sys.exit(1)
except Exception:
    pass
" 2>&1)
        _g12_rc=$?
        if [ "$_g12_rc" -ne 0 ] && [ -n "$YAML_ERROR" ]; then
          YAML_JSON_ERRORS+=("$file(yaml:$YAML_ERROR)")
        fi
      fi
      ;;
    *.json)
      YAML_JSON_CHECK_COUNT=$((YAML_JSON_CHECK_COUNT + 1))
      if [ "$JSON_CMD" = "node" ]; then
        JSON_ERROR=$(git show ":$file" 2>/dev/null | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{JSON.parse(d)}catch(e){console.log(e.message.split('\\n')[0]);process.exit(1)}})
" 2>&1)
        _g12_rc=$?
        if [ "$_g12_rc" -ne 0 ] && [ -n "$JSON_ERROR" ]; then
          YAML_JSON_ERRORS+=("$file(json:$JSON_ERROR)")
        fi
      elif [ "$JSON_CMD" = "jq" ]; then
        JSON_ERROR=$(git show ":$file" 2>/dev/null | jq empty 2>&1)
        _g12_rc=$?
        if [ "$_g12_rc" -ne 0 ] && [ -n "$JSON_ERROR" ]; then
          YAML_JSON_ERRORS+=("$file(json:$JSON_ERROR)")
        fi
      fi
      ;;
  esac
done <<EOF
$CHANGED_YAML_JSON
EOF

if [ "${#YAML_JSON_ERRORS[@]}" -gt 0 ]; then
  echo "     ❌ YAML/JSON syntax errors:"
  for f in "${YAML_JSON_ERRORS[@]}"; do
    echo "        - $f"
  done
  HYGIENE_ISSUES=$((HYGIENE_ISSUES + 1))
  HYGIENE_FILES="$HYGIENE_FILES yaml-json-syntax"
elif [ "$YAML_JSON_CHECK_COUNT" -gt 0 ]; then
  echo "     ✅ YAML/JSON syntax OK ($YAML_JSON_CHECK_COUNT file(s) checked)"
fi

# --- Result ---
if [ "${GATE_12_DOCS_ONLY:-false}" = true ] && [ "$HYGIENE_ISSUES" -eq 0 ]; then
  echo "     ✅ PASSED - File Hygiene (docs-only commit: diff-scoped conflict-marker + YAML/JSON checks clean)."
  GATE_12_STATUS="PASS"
  record_gate_audit "gate-12" "file-hygiene" "$GATE_12_STATUS" "0" "$GATE_12_START" "" "docs_only_change"
  # shellcheck disable=SC2317  # the gate body is SOURCED, never run to completion here:
  # the driver calls gate_12_run and treats a returned rc as the verdict, so the
  # lines after this return ARE reachable in production (see pre-commit).
  return 0 2>/dev/null || true
fi
if [ "$HYGIENE_ISSUES" -eq 0 ]; then
  echo "     ✅ PASSED - No file hygiene issues detected."
  GATE_12_STATUS="PASS"
else
  # Hard blocks: conflict markers + YAML/JSON syntax errors
  if [ -n "$CONFLICT_MARKER_FILES" ] || [ "${#YAML_JSON_ERRORS[@]}" -gt 0 ]; then
    echo ""
    echo "❌ BLOCKED - File hygiene violations must be fixed before commit."
    GATE_12_STATUS="BLOCK"
    record_gate_audit "gate-12" "file-hygiene" "$GATE_12_STATUS" "$HYGIENE_ISSUES" "$GATE_12_START" "${GATE_12_DETAIL:-}"
    exit 1
  else
    echo ""
    echo "     ⚠️  WARNINGS - $HYGIENE_ISSUES file hygiene issue(s) found."
    echo "     Fix recommended but not blocking (no conflict markers or syntax errors)."
    echo "     Issues:$HYGIENE_FILES"
    GATE_12_STATUS="WARN"
    # The journal carried only a count. Name the checks that fired, so a WARN
    # in the record says WHICH hygiene rule was broken without re-running the
    # gate. Same defect family as gate-4/6/10/13: the console knew, the record
    # did not.
    _g12_kinds=""
    [ -n "${GATE_12_HAS_TRAILING_WS:-}" ] && _g12_kinds="${_g12_kinds}${_g12_kinds:+,}trailing_whitespace"
    [ -n "${GATE_12_MISSING_EOF:-}" ] && _g12_kinds="${_g12_kinds}${_g12_kinds:+,}missing_eof_newline"
    GATE_12_DETAIL="${_g12_kinds:-hygiene_warnings}"
  fi
fi

record_gate_audit "gate-12" "file-hygiene" "$GATE_12_STATUS" "$HYGIENE_ISSUES" "$GATE_12_START" "${GATE_12_DETAIL:-}"
