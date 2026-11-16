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

# ─── Output helpers ─────────────────────────────────────────────────────────
_layers_say() { echo "     $*"; }

_layers_verdict() {
  local code="$1" text="$2" reason="${3:-}"
  _layers_say "$text"
  if [ -n "$reason" ]; then
    _layers_say "       reason: $reason"
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
# Three record shapes are accepted, because all three are ordinary YAML for a
# list of maps and the gate must judge the code, not the author's style:
#     shared:                 map form
#     - name: shared          sequence form, name inline
#     -                       sequence form, name on the following line
# Two layout freedoms apply to all of them, because YAML allows both:
#     layers:
#     - name: shared          a sequence may start at column 0
#       paths:
#       - src/shared/**       block-list items may sit at their key's indent
# Paths may be written as `pattern:`, `patterns:` or `paths:` (the last is what
# dependency-cruiser-style configs use), and lists may be flow (`[a, b]`) or
# block (`- a` on following lines). Accepting only one spelling made a correct
# config parse to an empty layer table — a fail-closed BLOCK that blocked the
# commit for the wrong reason (#811).
#
# Not supported, and rejected as unparsable rather than skipped: flow-mapping
# records (`- {name: x, paths: [y]}`), records with no name, and names outside
# the map form's `[A-Za-z0-9_-]+` key grammar. Skipping them would enforce the
# rest of the config silently — partial enforcement that reads as a pass.
# A name is comma-encoded in the table, so `a,b` would corrupt it; a comment on
# a sequence-form name (`- name: core # note`) is stripped before the check.
LAYER_TSV=$(awk '
  function trim(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
  function unq(s)  { s = trim(s); gsub(/^["\047]|["\047]$/, "", s); return s }
  # Split a YAML flow list into a comma-joined string of unquoted items.
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
  function join(cur, v) { return (cur == "" ? v : cur "," v) }
  # Start one record. A bare `-` starts a record whose name arrives on a later
  # line, so an empty name here is legitimate — `inrecord` says "fields below
  # belong to a record", which an empty name must not be used to infer.
  # The name is comma-encoded in the table and must obey the same grammar as a
  # map-form key, so strip a trailing comment first and fail closed otherwise.
  # Both the dash-line name and the nested `name:` line go through here, or the
  # nested form would bypass the check.
  function setname(v,   n) {
    n = trim(v); sub(/#.*$/, "", n); name = unq(n)
    if (name != "" && name !~ /^[A-Za-z0-9_-]+$/) parse_error = 1
  }
  function start(n) {
    name = ""; pattern = ""; allowed = ""; forbidden = ""
    setname(n)
    inrecord = 1; listkey = ""; listindent = -1
  }
  function additem(k, v) {
    if (v == "") return
    if (k == "pattern")      pattern   = join(pattern, v)
    else if (k == "allowed") allowed   = join(allowed, v)
    else                     forbidden = join(forbidden, v)
  }
  # awk initialises every variable to "" rather than 0. `layerindent < 0` on an
  # unset variable compares a string to a number and never fires, so the layer
  # indent was never recorded and every layer was silently skipped — the same
  # class of defect this gate exists to catch. Initialise explicitly.
  # Emit one row per pattern so a layer can own several directories. Patterns
  # are matched independently and longest-pattern-wins still resolves nesting.
  # A layer with no pattern is emitted with an empty column: it can never match
  # a file, and the scanner zero-classified guard reports that instead of
  # treating it as clean.
  function flush(   k, i, p) {
    # A record that was opened but never received a name is not a layer the
    # scanner can judge: dropping it would enforce the rest of the config while
    # the file still claims that boundary. Fail closed instead.
    if (inrecord && name == "") parse_error = 1
    inrecord = 0
    if (name == "") return
    k = split(pattern, p, ",")
    if (k == 0) { print name "\t\t" allowed "\t" forbidden; name = ""; return }
    for (i = 1; i <= k; i++) {
      if (p[i] == "") continue
      print name "\t" p[i] "\t" allowed "\t" forbidden
    }
    name = ""
  }
  BEGIN {
    inlayers = 0; layerindent = -1; inrecord = 0
    name = ""; pattern = ""; allowed = ""; forbidden = ""
    listkey = ""; listindent = -1; parse_error = 0
  }
  /^[ \t]*#/ { next }
  /^[ \t]*$/ { next }
  {
    line = $0
    match(line, /^[ \t]*/); indent = RLENGTH
    body = trim(line)
    # `layers:` may carry a trailing comment — still the block opener.
    if (!inlayers) { if (body ~ /^layers:[ \t]*(#.*)?$/) inlayers = 1; next }
    # A KEY at column 0 ends the layers block. A sequence item at column 0 does
    # not: `layers:` followed by `- name: x` is everyday YAML, and exiting on it
    # made a valid config unparsable — the style-dependent failure of #811.
    if (indent == 0 && body !~ /^-/) exit
    if (layerindent < 0) layerindent = indent
    # ── record starts ──────────────────────────────────────────────────────
    if (indent == layerindent && body ~ /^- +name[ \t]*:/) {
      flush(); start(substr(body, index(body, ":") + 1)); next
    }
    if (indent == layerindent && body == "-") {
      flush(); start(""); next
    }
    if (indent == layerindent && body ~ /^[A-Za-z0-9_-]+:[ \t]*(#.*)?$/) {
      flush(); start(substr(body, 1, index(body, ":") - 1)); next
    }
    # A flow-mapping record is valid YAML we do not parse. Skipping it would
    # leave the rest of the config enforced while this layer silently vanished.
    if (indent == layerindent && body ~ /^- *\{/) { parse_error = 1; next }
    # Fields before the first record start (a stray key above `layers:`).
    if (!inrecord) next
    # ── block-list continuation: `paths:` whose value starts on later lines ──
    # YAML also allows the items at the SAME indent as their key (`paths:` then
    # `- src/x` both at 4), so the test is `>=`, not `>`.
    if (listkey != "" && indent >= listindent && body ~ /^- /) {
      additem(listkey, clean(substr(body, 3))); next
    }
    listkey = ""; listindent = -1
    # Any other dash item at the layer indent belongs to a list, not a record.
    if (indent == layerindent && body ~ /^- /) { next }
    if (body ~ /^name:/) { setname(substr(body, 6)); next }
    if (body ~ /^patterns?:/ || body ~ /^paths:/) {
      v = clean(substr(body, index(body, ":") + 1))
      if (v == "") { listkey = "pattern"; listindent = indent } else pattern = join(pattern, v)
      next
    }
    if (body ~ /^allowedImports:/   || body ~ /^allowed_imports:/) {
      v = clean(substr(body, index(body, ":") + 1))
      if (v == "") { listkey = "allowed"; listindent = indent } else allowed = join(allowed, v)
      next
    }
    if (body ~ /^forbiddenImports:/ || body ~ /^forbidden_imports:/) {
      v = clean(substr(body, index(body, ":") + 1))
      if (v == "") { listkey = "forbidden"; listindent = indent } else forbidden = join(forbidden, v)
      next
    }
  }
  END { flush(); if (parse_error) exit 3 }
' "$LAYER_CONFIG" 2>/dev/null)
LAYER_PARSE_RC=$?

# ─── 3. Config present but unparseable → BLOCK (fail-closed) ───────────────
if [ "$LAYER_PARSE_RC" -ne 0 ]; then
  _layers_verdict 2 \
    "❌ BLOCKED - $LAYER_CONFIG has an unusable layer record (flow-mapping record, or a record with a missing or invalid name)." \
    "layer_config_unparsable"
fi
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

# Side channel for the scan's own bookkeeping (files seen / files classified).
# Defaults to 0/0 so a scan that dies before writing it reads as "classified
# nothing", which lands on the WARN path rather than a silent pass.
LAYER_STATS_FILE="${TMPDIR:-/tmp}/xp-layer-stats.$$"
: > "$LAYER_STATS_FILE"
LAYER_CLASSIFIED_FILES=0
LAYER_CLASSIFIED=0

# The file list goes in as ARGV, not on stdin: awk builds FILENAME from ARGV,
# and a stdin-driven loop leaves FILENAME empty — every file would be assigned
# layer 0 and the scan would report a clean tree. That is exactly the failure
# mode this gate exists to prevent, so the plumbing has to be right first.
# $FILE_LIST is deliberately unquoted: one path per ARGV slot is the contract;
# awk builds FILENAME from ARGV and a single joined string would collapse it.
# shellcheck disable=SC2086
FINDINGS=$(XP_LAYER_TSV="$LAYER_TSV_FILE" XP_LAYER_STATS="$LAYER_STATS_FILE" awk '
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
    # Classified-file accounting (#REVIEW-R5): a run where the config declares
    # layers but no file matches any of them is indistinguishable from a clean
    # tree, and reporting that as PASS is how "declared but unenforced" survives
    # one level deeper. Count both sides so the verdict can tell them apart.
    seen++
    if (src != 0) classified++
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
  END {
    # Classified-file counts go to a side file, not stdout: stdout is the
    # findings stream the verdict reads, and mixing a summary line into it would
    # be parsed as a violation.
    if (ENVIRON["XP_LAYER_STATS"]) {
      printf "%d %d\n", seen, classified > ENVIRON["XP_LAYER_STATS"]
      close(ENVIRON["XP_LAYER_STATS"])
    }
  }
' $FILE_LIST 2>/dev/null)
rm -f "$LAYER_TSV_FILE"

if [ -s "$LAYER_STATS_FILE" ]; then
  read -r LAYER_CLASSIFIED_FILES LAYER_CLASSIFIED < "$LAYER_STATS_FILE" || true
fi
rm -f "$LAYER_STATS_FILE"
case "$LAYER_CLASSIFIED_FILES" in ''|*[!0-9]*) LAYER_CLASSIFIED_FILES=0 ;; esac
case "$LAYER_CLASSIFIED" in ''|*[!0-9]*) LAYER_CLASSIFIED=0 ;; esac

# ─── 6. Verdict ─────────────────────────────────────────────────────────────
if [ -z "$FINDINGS" ]; then
  # Zero findings means one of two very different things: every classified file
  # obeyed the rules, or NO FILE was classified at all because the config and the
  # tree disagree. The first is a pass; the second is a config/reality drift and
  # calling it a pass is the "declared but unenforced" defect Gate 6 exists to
  # catch. Tell them apart before saying anything good.
  if [ "$LAYER_CLASSIFIED" -eq 0 ]; then
    _layers_verdict 3 \
      "⚠️  0 of $LAYER_CLASSIFIED_FILES scanned file(s) match any of the $LAYER_COUNT declared layer(s) — nothing was actually checked." \
      "layer_config_matches_no_files" \
      "   Declared patterns are checked against repo-relative paths." \
      "   A config for a different layout than this tree will never enforce anything."
  fi
  _layers_verdict 0 \
    "✅ Layer boundaries verified ($LAYER_COUNT layers, $LAYER_CLASSIFIED file(s) classified, 0 violations)." \
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
