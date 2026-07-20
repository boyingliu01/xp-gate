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
STAGED_FILES=$(git diff --cached --name-only --diff-filter=d 2>/dev/null)

if [ -z "$STAGED_FILES" ]; then
  echo "     ℹ️  No staged files — skipping"
  echo "     ✅ PASSED - File Hygiene (no files to check)"
  GATE_12_STATUS="SKIP"
  record_gate_audit "gate-12" "file-hygiene" "$GATE_12_STATUS" "0" "$GATE_12_START"
  return 0 2>/dev/null || true
fi

HYGIENE_ISSUES=0
HYGIENE_FILES=""

# --- Check 1: Trailing whitespace ---
TRAILING_WS_FILES=""
while IFS= read -r file; do
  [ -z "$file" ] && continue
  # Skip binary files by checking if file contains null bytes
  if git diff --cached --no-color -- "$file" 2>/dev/null | grep -q $'\x00'; then
    continue
  fi
  # Check staged content for trailing whitespace (spaces/tabs at end of lines)
  if git show ":$file" 2>/dev/null | grep -qE '[[:space:]]$'; then
    TRAILING_WS_FILES="$TRAILING_WS_FILES $file"
  fi
done <<EOF
$STAGED_FILES
EOF

if [ -n "$TRAILING_WS_FILES" ]; then
  echo "     ⚠️  Trailing whitespace detected in:"
  for f in $TRAILING_WS_FILES; do
    echo "        - $f"
  done
  HYGIENE_ISSUES=$((HYGIENE_ISSUES + 1))
  HYGIENE_FILES="$HYGIENE_FILES trailing-whitespace"
fi

# --- Check 2: Missing EOF newline ---
NO_EOF_NEWLINE_FILES=""
while IFS= read -r file; do
  [ -z "$file" ] && continue
  # Skip binary files
  if git diff --cached --no-color -- "$file" 2>/dev/null | grep -q $'\x00'; then
    continue
  fi
  # Check if file content ends with newline
  FILE_CONTENT=$(git show ":$file" 2>/dev/null)
  if [ -n "$FILE_CONTENT" ]; then
    LAST_CHAR=$(printf '%s' "$FILE_CONTENT" | tail -c 1)
    if [ "$LAST_CHAR" != "" ]; then
      NO_EOF_NEWLINE_FILES="$NO_EOF_NEWLINE_FILES $file"
    fi
  fi
done <<EOF
$STAGED_FILES
EOF

if [ -n "$NO_EOF_NEWLINE_FILES" ]; then
  echo "     ⚠️  Missing EOF newline in:"
  for f in $NO_EOF_NEWLINE_FILES; do
    echo "        - $f"
  done
  HYGIENE_ISSUES=$((HYGIENE_ISSUES + 1))
  HYGIENE_FILES="$HYGIENE_FILES no-eof-newline"
fi

# --- Check 3: Merge conflict markers ---
CONFLICT_MARKER_FILES=""
while IFS= read -r file; do
  [ -z "$file" ] && continue
  # Skip binary files
  if git diff --cached --no-color -- "$file" 2>/dev/null | grep -q $'\x00'; then
    continue
  fi
  # Check for conflict markers in staged content
  if git show ":$file" 2>/dev/null | grep -qE '^(<<<<<<<|=======|>>>>>>>)'; then
    CONFLICT_MARKER_FILES="$CONFLICT_MARKER_FILES $file"
  fi
done <<EOF
$STAGED_FILES
EOF

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
while IFS= read -r file; do
  [ -z "$file" ] && continue
  [ ! -f "$file" ] && continue
  FILE_SIZE=$(wc -c < "$file" 2>/dev/null | tr -d ' ')
  if [ -n "$FILE_SIZE" ] && [ "$FILE_SIZE" -gt "$MAX_FILE_SIZE_BYTES" ]; then
    SIZE_MB=$((FILE_SIZE / 1048576))
    OVERSIZED_FILES="$OVERSIZED_FILES $file(${SIZE_MB}MB)"
  fi
done <<EOF
$STAGED_FILES
EOF

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
YAML_JSON_ERRORS=""
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
        if [ $? -ne 0 ] && [ -n "$YAML_ERROR" ]; then
          YAML_JSON_ERRORS="$YAML_JSON_ERRORS $file(yaml:$YAML_ERROR)"
        fi
      fi
      ;;
    *.json)
      YAML_JSON_CHECK_COUNT=$((YAML_JSON_CHECK_COUNT + 1))
      if [ "$JSON_CMD" = "node" ]; then
        JSON_ERROR=$(git show ":$file" 2>/dev/null | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{JSON.parse(d)}catch(e){console.log(e.message.split('\\n')[0]);process.exit(1)}})
" 2>&1)
        if [ $? -ne 0 ] && [ -n "$JSON_ERROR" ]; then
          YAML_JSON_ERRORS="$YAML_JSON_ERRORS $file(json:$JSON_ERROR)"
        fi
      elif [ "$JSON_CMD" = "jq" ]; then
        JSON_ERROR=$(git show ":$file" 2>/dev/null | jq empty 2>&1)
        if [ $? -ne 0 ] && [ -n "$JSON_ERROR" ]; then
          YAML_JSON_ERRORS="$YAML_JSON_ERRORS $file(json:syntax error)"
        fi
      fi
      ;;
  esac
done <<EOF
$STAGED_FILES
EOF

if [ -n "$YAML_JSON_ERRORS" ]; then
  echo "     ❌ YAML/JSON syntax errors:"
  for f in $YAML_JSON_ERRORS; do
    echo "        - $f"
  done
  HYGIENE_ISSUES=$((HYGIENE_ISSUES + 1))
  HYGIENE_FILES="$HYGIENE_FILES yaml-json-syntax"
elif [ "$YAML_JSON_CHECK_COUNT" -gt 0 ]; then
  echo "     ✅ YAML/JSON syntax OK ($YAML_JSON_CHECK_COUNT file(s) checked)"
fi

# --- Result ---
if [ "$HYGIENE_ISSUES" -eq 0 ]; then
  echo "     ✅ PASSED - No file hygiene issues detected."
  GATE_12_STATUS="PASS"
else
  # Hard blocks: conflict markers + YAML/JSON syntax errors
  if [ -n "$CONFLICT_MARKER_FILES" ] || [ -n "$YAML_JSON_ERRORS" ]; then
    echo ""
    echo "❌ BLOCKED - File hygiene violations must be fixed before commit."
    GATE_12_STATUS="BLOCK"
    record_gate_audit "gate-12" "file-hygiene" "$GATE_12_STATUS" "$HYGIENE_ISSUES" "$GATE_12_START"
    exit 1
  else
    echo ""
    echo "     ⚠️  WARNINGS - $HYGIENE_ISSUES file hygiene issue(s) found."
    echo "     Fix recommended but not blocking (no conflict markers or syntax errors)."
    echo "     Issues:$HYGIENE_FILES"
    GATE_12_STATUS="WARN"
  fi
fi

record_gate_audit "gate-12" "file-hygiene" "$GATE_12_STATUS" "$HYGIENE_ISSUES" "$GATE_12_START"
