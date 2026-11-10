#!/bin/bash
# Behavioral verification of pre-push tier precedence (P1-C, REQ-RESOLVE-001).
#
# Runs the REAL pre-push resolution block in a fixture directory, once per
# layout, and prints which adapter-common.sh it chose. This is the check that
# matters: a text assertion can pass while `_hook_tier_dir` is called with the
# wrong arguments.
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PRE_PUSH="$REPO/githooks/pre-push"
GENERATED="$REPO/githooks/hook-module-resolution.sh"

# Extract just the resolution block: from the SCRIPT_DIR assignment down to the
# line that closes the "no tier found" branch.
START=$(grep -n '^SCRIPT_DIR=' "$PRE_PUSH" | cut -d: -f1)
END=$(grep -n 'GATE_M_SKIP_REASON="adapter-common.sh not found in any resolution tier' "$PRE_PUSH" | cut -d: -f1)
END=$((END + 2))

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/proj/githooks" "$TMP/global" "$TMP/hookdir"
# The generated table must live next to the hook. Copy it, and put the extracted
# block there too, so `dirname "$0"` resolves to the hook directory.
cp "$GENERATED" "$TMP/hookdir/"
cp "$GENERATED" "$TMP/hookdir/hook-module-resolution.sh"
sed -n "${START},${END}p" "$PRE_PUSH" > "$TMP/hookdir/resolution-block.sh"
bash -n "$TMP/hookdir/resolution-block.sh" || { echo "FAIL: extracted block has a syntax error"; exit 1; }

run_case() {
  local name="$1" has_project="$2" has_global="$3"
  rm -f "$TMP/proj/githooks/adapter-common.sh" "$TMP/global/adapter-common.sh"
  [ "$has_project" = "1" ] && echo 'MARKER=PROJECT' > "$TMP/proj/githooks/adapter-common.sh"
  [ "$has_global" = "1" ] && echo 'MARKER=GLOBAL' > "$TMP/global/adapter-common.sh"

  (
    cd "$TMP/proj" || exit 1
    # Feed the block the same names pre-push uses, but with fixture roots.
    eval "$(sed \
      -e "s|^SCRIPT_DIR=.*|SCRIPT_DIR=\"$TMP/hookdir\"|" \
      -e "s|^PROJECT_GITHOOKS=.*|PROJECT_GITHOOKS=\"$TMP/proj/githooks\"|" \
      -e "s|^GLOBAL_ADAPTER_DIR=.*|GLOBAL_ADAPTER_DIR=\"$TMP/global\"|" \
      "$TMP/hookdir/resolution-block.sh")"

    if [ -n "${ADAPTER_COMMON:-}" ] && [ -f "${ADAPTER_COMMON:-}" ]; then
      printf '%-18s -> %-16s kind=%s\n' "$name" "$(cat "$ADAPTER_COMMON")" "${GATE_M_SKIP_KIND:-<none>}"
    else
      printf '%-18s -> %-16s kind=%s\n' "$name" '(not resolved)' "${GATE_M_SKIP_KIND:-<none>}"
    fi
  )
}

echo "=== pre-push tier precedence, executed for real ==="
run_case 'only project'   1 0
run_case 'only global'    0 1
run_case 'BOTH (the bug)' 1 1
run_case 'neither'        0 0
