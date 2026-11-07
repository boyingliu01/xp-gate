#!/usr/bin/env bash
# ============================================================================
# GATE 6 (layers): Layer Boundary Enforcement
#
# ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
# `architecture.yaml` has declared layer boundaries since 2026-04, and Gate 6
# has never enforced them. #16 found the config schema didn't match archlint;
# the fix at the time was to stop passing `--config`, which made `layers:` dead
# config forever. #686 documented the resulting false green, and #728 measured
# that archlint 0.16.0's own `layer_violation` detector returns zero findings
# under every configuration (-A, -d, enabled: true, globs, exact paths).
#
# So the config was never wrong in the way the issue titles suggest. Nothing
# ever read it. This script reads it.
#
# Design: docs/plans/2026-11-07-gate-6-layer-enforcement-design.md
# Issues: #686 (dead config exposed), #691 (ARCH-04 layer direction rules),
#         #728 (archlint detector is a no-op)
#
# ── WHY NOT ARCHLINT ────────────────────────────────────────────────────────
# #728 is not a configuration bug we can wait out: the detector is listed,
# enable-able, and produces no output. Depending on it means the gate's verdict
# is a statement about archlint, not about the code.
#
# A second reason is scope. The iteration-speed design (O4) shrinks archlint to
# a per-directory scope, but a layer violation is *by definition* an edge
# between two directories. An incremental scan structurally cannot see it. This
# checker always builds the whole-repo graph, and is cheap enough to afford it.
#
# ── VERDICT CONTRACT (inherited from pre-commit's java.sh / powershell.sh) ──
#   0 = PASS      no layer violations
#   1 = FAIL      new violations on this change (commit blocked)
#   2 = BLOCK     config present but unusable (fail-closed)
#   3 = WARN      no layer config declared, or violations only in baseline
#
# ── PERFORMANCE ─────────────────────────────────────────────────────────────
# One awk pass over the tree. No subprocess per file, no network, no cache to
# invalidate.
# ============================================================================

set -uo pipefail

LAYER_CONFIG="${XP_GATE_LAYER_CONFIG:-architecture.yaml}"
LAYER_BASELINE="${XP_GATE_LAYER_BASELINE:-.layer-baseline.json}"
LAYER_SCAN_ROOT="${XP_GATE_LAYER_SCAN_ROOT:-.}"
LAYER_REASON=""

# ─── Output helpers ─────────────────────────────────────────────────────────
_layers_say() { echo "     $*"; }

_layers_verdict() {
  local code="$1" text="$2" reason="${3:-}"
  _layers_say "$text"
  if [ -n "$reason" ]; then
    _layers_say "       reason: $reason"
    LAYER_REASON="$reason"
  fi
  exit "$code"
}

# ─── 1. No config → WARN, never a silent pass ───────────────────────────────
# The whole defect class here began with "no config means nothing to check, and
# nothing to check means success".
if [ ! -f "$LAYER_CONFIG" ]; then
  _layers_verdict 3 \
    "⚠️  No layer config ($LAYER_CONFIG) — layer boundaries NOT checked." \
    "no_layer_config"
fi

# ─── 2. Parse layers into a TSV: name, pattern, allowed, forbidden ──────────
LAYER_TSV=$(awk '
  function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
  function unq(s)  { s = trim(s); gsub(/^["\047]|["\047]$/, "", s); return s }
  # Split a YAML flow/block list into a comma-joined string of unquoted items.
  function clean(v,   k,i,p,out) {
    v = trim(v); sub(/#.*$/, "", v); v = trim(v)
    sub(/^\[/, "", v); sub(/\]$/, "", v)
    k = split(v, p, ","); out = ""
    for (i = 1; i <= k; i++) {
      p[i] = unq(p[i])
      if (p[i] != "") out = (out == "" ? p[i] : out "," p[i])
    }
    return out
  }
  # awk initialises every variable to "" rather than 0. `layerindent < 0` on an
  # unset variable compares a string to a number and never fires, so the layer
  # indent was never recorded and every layer was silently skipped — the same
  # class of defect this gate exists to catch. Initialise explicitly.
  BEGIN {
    inlayers = 0; layerindent = -1
    name = ""; pattern = ""; allowed = ""; forbidden = ""
  }
  /^[ \t]*#/ { next }
  /^[ \t]*$/ { next }
  {
    line = $0
    match(line, /^[ \t]*/); indent = RLENGTH
    body = trim(line)
    if (!inlayers) { if (body == "layers:") inlayers = 1; next }
    # A key at indent 0 ends the layers block.
    if (indent == 0) exit
    if (layerindent < 0) layerindent = indent
    # A \"<name>:\" line at the layer indent starts a new layer record.
    # Supports both the map form (domain:) and an explicit name: field.
    if (indent == layerindent && body ~ /^[A-Za-z0-9_-]+:[ \t]*$/) {
      if (name != "") print name "\t" pattern "\t" allowed "\t" forbidden
      name = substr(body, 1, index(body, ":") - 1)
      pattern = ""; allowed = ""; forbidden = ""
      next
    }
    if (indent == layerindent && body ~ /^- /) { next }
    if (name == "") next
    if (body ~ /^name:/)            { name      = unq(substr(body, 6)) }
    else if (body ~ /^pattern:/)    { pattern   = clean(substr(body, 9)) }
    else if (body ~ /^allowedImports:/   || body ~ /^allowed_imports:/)   { allowed   = clean(substr(body, index(body, ":") + 1)) }
    else if (body ~ /^forbiddenImports:/ || body ~ /^forbidden_imports:/) { forbidden = clean(substr(body, index(body, ":") + 1)) }
  }
  END { if (name != "") print name "\t" pattern "\t" allowed "\t" forbidden }
' "$LAYER_CONFIG" 2>/dev/null)

# ─── 3. Config present but unparseable → BLOCK (fail-closed) ───────────────
if [ -z "$LAYER_TSV" ]; then
  _layers_verdict 2 \
    "❌ BLOCKED - $LAYER_CONFIG exists but declares no usable layers." \
    "layer_config_unparsable"
fi

LAYER_COUNT=$(printf '%s\n' "$LAYER_TSV" | grep -c . || true)

# ─── 4. Collect source files ────────────────────────────────────────────────
# Via git rather than find: `git ls-files` honours .gitignore by construction
# (no node_modules/dist/coverage exclusions to keep in sync with the ignore
# rules) and is faster on Windows — 0.5s vs 6.5s on this repo.
#
# Both tracked AND untracked-but-not-ignored files are included. A staged-only
# view would be wrong twice over: untracked files are exactly what an agent has
# just authored (the moment the check matters most), and `--cached` also misses
# a violation introduced in a file the commit does not touch. Layer membership
# is a property of the tree, not of the diff.
#
# Fallback to find for non-git fixtures (the BATS suite uses bare temp dirs).
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  FILE_LIST=$(git ls-files --cached --others --exclude-standard -- \
      '*.ts' '*.tsx' '*.js' '*.jsx' '*.mjs' '*.cjs' 2>/dev/null \
    | grep -v '^\.layer-fixture' || true)
else
  FILE_LIST=$(find "$LAYER_SCAN_ROOT" -type f \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \
       -o -name '*.mjs' -o -name '*.cjs' \) \
    -not -path '*/node_modules/*' -not -path '*/.git/*' \
    -not -path '*/dist/*' -not -path '*/coverage/*' \
    -not -path '*/.stryker-tmp/*' -not -path '*/.layer-fixture*' 2>/dev/null | sed 's|^\./||')
fi

if [ -z "$FILE_LIST" ]; then
  _layers_verdict 3 \
    "⚠️  No source files under $LAYER_SCAN_ROOT — layer boundaries NOT checked." \
    "no_source_files"
fi

# ─── 5. Scan imports and classify violations ────────────────────────────────
LAYER_TSV_FILE="${TMPDIR:-/tmp}/xp-layer-tsv.$$"
printf '%s\n' "$LAYER_TSV" > "$LAYER_TSV_FILE"

# The file list goes in as ARGV, not on stdin: awk builds FILENAME from ARGV,
# and a stdin-driven loop leaves FILENAME empty — every file would be assigned
# layer 0 and the scan would report a clean tree. That is exactly the failure
# mode this gate exists to prevent, so the plumbing has to be right first.
FINDINGS=$(XP_LAYER_TSV="$LAYER_TSV_FILE" awk '
  BEGIN {
    n = 0
    while ((getline row < ENVIRON["XP_LAYER_TSV"]) > 0) {
      if (row == "") continue
      split(row, f, "\t")
      if (f[1] == "") continue
      n++
      lname[n] = f[1]; lpat[n] = f[2]; lallow[n] = f[3]
      # Patterns are compiled once here. layer_of() runs twice per source file
      # (once for the importer, once per resolved target); recompiling there
      # meant ~5800 regex builds for this repo and dominated the 2s scan.
      lre[n] = pat2re(f[2])
      llen[n] = length(f[2])
    }
    close(ENVIRON["XP_LAYER_TSV"])
    if (n == 0) { print "LAYER_TABLE_EMPTY" > "/dev/stderr"; exit 3 }
  }
  function pat2re(p,   s) {
    s = p
    gsub(/[.]/, "\\.", s)
    gsub(/[*][*]/, "\001", s)
    gsub(/[*]/, "[^/]*", s)
    gsub(/\001/, ".*", s)
    return "^" s "$"
  }
  # Membership is decided by the LONGEST matching pattern, so a nested layer
  # beats its parent regardless of declaration order. First-match-wins would
  # make the verdict depend on YAML ordering.
  function layer_of(path,   best, blen, i) {
    best = 0; blen = -1
    for (i = 1; i <= n; i++) {
      if (llen[i] > blen && path ~ lre[i]) { blen = llen[i]; best = i }
    }
    return best
  }
  function in_csv(list, val,   k, j, p) {
    k = split(list, p, ",")
    for (j = 1; j <= k; j++) if (p[j] == val) return 1
    return 0
  }
  # `allowedImports` is written as path globs in this config ("src/shared/**")
  # but reads naturally as layer names ("domain"). Accept both: a path glob is
  # matched against the resolved target path, a bare identifier against the
  # destination layer name. Supporting only one form silently misreports every
  # edge that used the other, which is how an allow-list turns into a false
  # accusation.
  function allowed_ok(idx, tgt, dstname,   k, j, p) {
    k = split(lallow[idx], p, ",")
    for (j = 1; j <= k; j++) {
      if (p[j] == "") continue
      if (p[j] == dstname) return 1
      if (p[j] ~ /[*]/ && tgt ~ pat2re(p[j])) return 1
      if (p[j] !~ /[*]/ && (tgt == p[j] || tgt ~ ("^" p[j] "/"))) return 1
    }
    return 0
  }
  # Resolve a relative specifier against the importing file.
  function resolve(from, spec,   np, i, dir, res, k, pp, trail, sx) {
    sub(/[.](ts|tsx|js|jsx|mjs|cjs)$/, "", spec)
    if (spec !~ /^[.][.]?\//) return ""
    np = split(from, sx, "/")
    dir = ""
    for (i = 1; i < np; i++) dir = (dir == "" ? sx[i] : dir "/" sx[i])
    res = dir
    trail = spec
    while (trail ~ /^[.][.]?\//) {
      if (trail ~ /^[.]\//) { trail = substr(trail, 3); continue }
      trail = substr(trail, 4)
      if (res == "") return ""
      k = split(res, pp, "/"); res = ""
      for (i = 1; i < k; i++) res = (res == "" ? pp[i] : res "/" pp[i])
    }
    return (res == "" ? trail : res "/" trail)
  }
  FNR == 1 {
    file = FILENAME
    sub(/^[.][/]/, "", file)
    src = layer_of(file)
  }
  {
    line = $0
    # Skip whole-line comments only. A trailing-comment strip would eat the
    # // in http:// inside string literals.
    if (line ~ /^[ \t]*(\/\/|[#]|[*]|\/\*)/) next
    rest = line
    while (match(rest, /from[ \t]+"[^"]+"|from[ \t]+\047[^\047]+\047/)) {
      spec = substr(rest, RSTART, RLENGTH)
      sub(/^from[ \t]+["\047]/, "", spec)
      sub(/["\047]$/, "", spec)
      rest = substr(rest, RSTART + RLENGTH)
      if (src == 0 || spec == "") continue
      tgt = resolve(file, spec)
      if (tgt == "") continue
      dst = layer_of(tgt)
      if (dst == 0 || dst == src) continue
      if (allowed_ok(src, tgt, lname[dst])) continue
      printf "%s\t%s\t%s\t%s\n", file, lname[src], lname[dst], tgt
    }
  }
' $FILE_LIST 2>/dev/null)
rm -f "$LAYER_TSV_FILE"

# ─── 6. Verdict ─────────────────────────────────────────────────────────────
if [ -z "$FINDINGS" ]; then
  _layers_verdict 0 \
    "✅ Layer boundaries verified ($LAYER_COUNT layers, 0 violations)." \
    "layers_checked"
fi

TOTAL=$(printf '%s\n' "$FINDINGS" | grep -c . || true)

# Ratchet: a recorded baseline is a debt ledger, not an amnesty.
# The comparison lives in its own file rather than inline: three levels of
# quoting (bash single quotes -> node source -> JSON) is where the tab-in-JSON
# bug hid, and a baseline that fails to parse must not be read as "no
# baseline" — that would make a broken ledger look like a fresh start.
if [ -f "$LAYER_BASELINE" ] && command -v node >/dev/null 2>&1; then
  NEW_FINDINGS=$(printf '%s\n' "$FINDINGS" | node "$(dirname "$0")/lib/layer-baseline.cjs" "$LAYER_BASELINE" 2>/dev/null)
  if [ $? -eq 4 ]; then
    _layers_verdict 2 \
      "❌ BLOCKED - $LAYER_BASELINE exists but cannot be parsed (fail-closed)." \
      "layer_baseline_unreadable"
  fi
else
  NEW_FINDINGS="$FINDINGS"
fi

NEW_COUNT=$(printf '%s\n' "$NEW_FINDINGS" | grep -c . || true)

if [ "$NEW_COUNT" -eq 0 ]; then
  _layers_verdict 3 \
    "⚠️  $TOTAL layer violation(s), all in baseline — no new violations." \
    "layers_checked_baselined"
fi

_layers_say "❌ BLOCKED - $NEW_COUNT new layer violation(s) (of $TOTAL total):"
printf '%s\n' "$NEW_FINDINGS" | head -10 | while IFS="$(printf '\t')" read -r f s d t; do
  _layers_say "   - $f  [$s -> $d]  imports $t"
done
if [ "$NEW_COUNT" -gt 10 ]; then
  _layers_say "   ... and $((NEW_COUNT - 10)) more"
fi
_layers_say "   A layer may import only what its allowedImports lists."
_layers_say "   To accept an existing violation, record it in $LAYER_BASELINE."
exit 1
