#!/bin/bash
# ============================================================================
# ccn-ratchet.sh — Gate 3 baseline ratchet (sprint-20261018-quality REQ-D)
#
# The repo carries years of complex-but-alive functions. Blocking them today
# would freeze the codebase; ignoring them lets complexity grow silently. The
# ratchet splits the difference: .ccn-baseline.json records the CCN each
# known function has TODAY, and the gate only fires when a recorded function
# gets WORSE (strictly greater — equal passes). Functions with no entry are
# new code and face the live warn/block thresholds unchanged. When a function
# improves we say so and suggest refreshing the baseline, because a stale
# ceiling invites nobody to finish the job.
#
# ── Population (#617) ───────────────────────────────────────────────────────
# A ratchet is only meaningful over the population it was recorded from. Gate 3
# grades every extension it recognises; a repo whose baseline came from a
# narrower scan then reports pre-existing code as "new", which is a false BLOCK
# no repair can clear — the file has no baseline entry to fix.
#
# The baseline may therefore DECLARE its population:
#
#   { "population": { "roots": ["src/main/java"], "extensions": [".java"] },
#     "entries": { "src/main/java/A.java::f": 4 } }
#
# A baseline without that key is LEGACY and is treated as unrestricted, which is
# exactly the historical behaviour: every baseline already in the field has the
# flat `{ "path::fn": ccn }` shape, and refusing to load it would break every
# install on upgrade. Absent metadata must never be read as an empty population
# -- that would silently grade nothing at all, the opposite failure.
#
# Key = "<relative/path>::<functionName>". Rename or move = new key = treated
# as a new function. That is deliberate: fuzzy matching would hide debt moves.
# `node scripts/ccn-report.cjs --write-baseline` regenerates the file after a
# legitimate refactor.
#
# evaluate_ccn_ratchet <baseline-json> reads lizard --csv rows on stdin and
# prints "OK|WARN|BLOCK|LOWER <fn> ..." verdict lines for every function row.
# ============================================================================

# Convert lizard CSV rows to unit-separator-delimited fields.
#
# The CSV is only ever parsed once, here, with the quote rules written out in
# one place; downstream code then reads positional fields with no quoting to
# worry about. gawk arrays are pass-by-value, so a helper function CANNOT fill
# a caller-visible array, and `split($0, F, ",")` tears apart lizard's quoted
# signature column (signatures contain commas). Both of those were live bugs:
# every lookup fell through to the "new function" branch, so recorded
# functions were graded against the flat threshold instead of their baseline.
#
# Output columns (this is real lizard 1.21.3 --csv output, 11 columns):
#   1 NLOC, 2 CCN, 3 token_len, 4 param_count, 5 48 (location size),
#   6 fn@start-end@path, 7 path, 8 name, 9 signature, 10 start, 11 end
#
# The separator is ASCII Unit Separator written via sprintf so the byte never
# has to survive a shell/awk escape round trip: -F'\001' is NOT a reliable way
# to name a control character (gawk treats the argument as a regex, and the
# literal backslash path silently yields a separator that matches nothing, so
# every row is read as a single field).
CSV_FS=$'\x1f'

# ---------------------------------------------------------------------------
# #617: baseline population.
#
# Prints the declared population as `<root>|<ext>|<ext>...` on one line, or
# NOTHING when the baseline carries no `population` key (legacy => unrestricted).
# Printing nothing is deliberate: "no declaration" and "empty population" are
# opposite meanings, and a caller that cannot tell them apart would either grade
# everything (wrong for a Java-only repo) or nothing (catastrophic -- the ratchet
# would report a clean run while comparing zero functions).
# ---------------------------------------------------------------------------
ccn_baseline_population() {
  local _bl="${1:-.ccn-baseline.json}"
  [ -f "$_bl" ] || return 0
  command -v node >/dev/null 2>&1 || return 0
  node -e '
    const fs = require("fs");
    let data;
    try { data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch { process.exit(0); }
    // Legacy shape: a flat map of "path::fn" -> ccn. No declaration.
    if (!data || typeof data !== "object" || !data.population) process.exit(0);
    const pop = data.population || {};
    const roots = Array.isArray(pop.roots) ? pop.roots : [];
    const exts = Array.isArray(pop.extensions) ? pop.extensions : [];
    // A declared-but-empty population is not a legitimate declaration: it would
    // excuse every file. Treat it as no declaration so the gate keeps grading.
    if (roots.length === 0 && exts.length === 0) process.exit(0);
    // One line: "<roots csv>|<exts csv>". Callers split on the single pipe.
    process.stdout.write(roots.join(",") + "|" + exts.join(","));
  ' "$_bl" 2>/dev/null
  return 0
}

# ---------------------------------------------------------------------------
# #617: is this file inside the baseline's declared population?
#
# Returns 0 when the file may be graded, 1 when it is outside the population.
# A legacy baseline (no declaration) permits everything, preserving the
# behaviour every existing install already relies on.
#
# Both axes are ANDed only when both are declared; a baseline declaring just
# roots (or just extensions) narrows on that axis alone.
# ---------------------------------------------------------------------------
ccn_file_in_population() {
  local _bl="${1:-.ccn-baseline.json}"
  local _file="${2:-}"
  [ -n "$_file" ] || return 1

  local _pop
  _pop=$(ccn_baseline_population "$_bl")
  # No declaration => unrestricted (legacy baseline).
  [ -n "$_pop" ] || return 0

  local _roots="${_pop%%|*}"
  local _exts="${_pop#*|}"
  # Normalise separators so a Windows path and a POSIX path compare the same way.
  local _norm
  _norm=$(printf '%s' "$_file" | tr '\' '/')

  if [ -n "$_roots" ]; then
    local _hit=0 _r
    local _oldifs="$IFS"
    IFS=','
    for _r in $_roots; do
      IFS="$_oldifs"
      case "$_norm" in
        "$_r"|"$_r"/*) _hit=1; break ;;
      esac
    done
    IFS="$_oldifs"
    [ "$_hit" -eq 1 ] || return 1
  fi

  if [ -n "$_exts" ]; then
    local _match=0 _e
    local _oldifs2="$IFS"
    IFS=','
    for _e in $_exts; do
      IFS="$_oldifs2"
      case "$_norm" in
        *"$_e") _match=1; break ;;
      esac
    done
    IFS="$_oldifs2"
    [ "$_match" -eq 1 ] || return 1
  fi

  return 0
}

csv_to_unit_separated() {
  awk '
    function emit(line,   cur, i, ch, q, nf) {
      nf = 1; cur = ""; q = 0
      for (i = 1; i <= length(line); i++) {
        ch = substr(line, i, 1)
        if (q) {
          if (ch == "\"") { if (substr(line, i + 1, 1) == "\"") { cur = cur "\""; i++ } else q = 0 }
          else cur = cur ch
        } else if (ch == "\"") q = 1
        else if (ch == ",") { f[nf++] = cur; cur = "" }
        else cur = cur ch
      }
      f[nf] = cur
      out = f[1]
      for (i = 2; i <= nf; i++) out = out FS_OUT f[i]
      print out
    }
    # Build the 0x1F byte from its numeric code: shell escapes into awk strings
    # are fragile across gawk/mawk/Windows builds, but printf to an awk variable
    # is unambiguous.
    BEGIN { FS_OUT = sprintf("%c", 0x1F) }
    { emit($0) }
  '
}

evaluate_ccn_ratchet() {
  local baseline_file="$1"
  local warn_threshold="${CCN_WARN_THRESHOLD:-5}"
  local block_threshold="${CCN_BLOCK_THRESHOLD:-10}"

  # Capture stdin up front: it is consumed twice (baseline rows and verdicts).
  local awk_input
  awk_input=$(cat)

  local baseline_json=""
  if [ -f "$baseline_file" ]; then
    baseline_json=$(cat "$baseline_file")
  fi

  # Flatten {"path::fn": 12, ...} to "path::fn=12" lines without spawning a
  # JSON parser per commit (every spawn is expensive on Windows AV filters).
  local flat
  flat=$(printf '%s' "$baseline_json" \
    | tr -d '\n' \
    | sed 's/^[^{]*{//; s/}[^}]*$//' \
    | grep -oE '"[^"]+"[[:space:]]*:[[:space:]]*[0-9]+' \
    | sed 's/[[:space:]]//g; s/":/=/; s/"//g' || true)

  # An empty or unparseable baseline must not read as "everything is new code,
  # nothing is protected". `{}` and a truncated file both flatten to zero lines,
  # and the grader then silently degrades to flat thresholds for a repository
  # that explicitly opted into the ratchet. Say so on stderr (verdict lines stay
  # clean for the caller) rather than passing quietly — the caller decides
  # whether an empty baseline is fatal, but it must be able to tell.
  if [ -z "$flat" ]; then
    echo "WARN - complexity baseline '${baseline_file}' is empty or unparseable; grading against flat thresholds only (no function is protected by the ratchet)" >&2
  fi

  # Convert the CSV rows once into position-only fields, then grade them. The
  # CSV quote rules live in csv_to_unit_separated and nowhere else; see the
  # comment there for why parsing in-place inside awk does not work.
  # Columns: $1 NLOC, $2 CCN, $3 token_len, $4 param_count, $5 location size,
  #          $6 fn@start-end@path, $7 path, $8 name, $9 signature,
  #          $10 start, $11 end
  local csv_rows
  csv_rows=$(printf '%s\n' "$awk_input" | csv_to_unit_separated || true)

  # Only function rows survive the conversion with a numeric CCN, which is what
  # the $2 guard below keys on.
  #
  # Duplicate-name tally: baselineKey() in scripts/ccn-report.cjs keys a name by
  # line when it occurs more than once in a file, because two rows can otherwise
  # share one entry and each regresses against the other. The rule is mirrored
  # here so the hook and CI cannot disagree; the count is computed in shell
  # because awk cannot see the whole file before grading its first row.
  local dup_names
  dup_names=$(printf '%s\n' "$csv_rows" | awk -F"$CSV_FS" '
    $2 ~ /^[0-9]+$/ {
      n = split($6, p, "@")
      name = p[1]
      path = (n >= 3) ? p[n] : $7
      gsub(/\\/, "/", path)
      count[path "::" name]++
    }
    END {
      for (k in count) if (count[k] > 1) print k
    }
  ' || true)

  printf '%s\n' "$csv_rows" | awk -F"$CSV_FS" -v flat="$flat" -v warn="$warn_threshold" -v block="$block_threshold" -v dups="$dup_names" -v anon_marker="(anonymous)" -v anon_short="(anon)" '
    BEGIN {
      n = split(flat, kv, "\n")
      for (i = 1; i <= n; i++) {
        eq = index(kv[i], "=")
        if (eq > 0) base[substr(kv[i], 1, eq - 1)] = substr(kv[i], eq + 1) + 0
      }
      m = split(dups, duprow, "\n")
      for (i = 1; i <= m; i++) if (length(duprow[i]) > 0) dup[duprow[i]] = 1
    }
    # FIELD INDEXING: $1 NLOC, $2 CCN, $3 token_len, $4 param_count,
    # $5 location size, $6 fn@start-end@path, $7 path, $8 name,
    # $9 signature, $10 start, $11 end.
    # Those two lines are the entire column contract. Earlier revisions read
    # CCN out of the identity column and name/path out of a shifted column, so
    # nothing ever matched its baseline entry and every recorded function was
    # graded as new code against the flat thresholds.
    # NOTE: this awk program is single-quoted in shell. The two hazards that
    # silently broke earlier revisions: an apostrophe anywhere below, and a
    # bare double-quote pair that the shell re-pairs across the awk text. The
    # anonymous marker is therefore passed in as a -v value, not written inline.
    $2 ~ /^[0-9]+$/ {
      ccn = $2 + 0
      n2 = split($6, parts, "@")
      name = parts[1]
      path = (n2 >= 3) ? parts[n2] : $7
      gsub(/\\/, "/", path)
      # Anonymous callbacks are keyed by position: a file holds many of them and
      # the baseline would otherwise keep only the last one parsed, so every
      # other callback was graded against the number of a different function.
      is_anon = 0
      if (name == anon_marker) is_anon = 1
      if (name == anon_short) is_anon = 1
      start = (n2 >= 3) ? parts[2] : $10
      sub(/-.*/, "", start)
      key = path "::" name
      if (is_anon) key = path "::" anon_marker "@" start
      else if ((path "::" name) in dup) key = path "::" name "@" start
      if (key in base) {
        if (ccn > base[key])      printf "BLOCK %s CCN=%d baseline=%d (ratchet: worse than recorded)\n", name, ccn, base[key]
        else if (ccn < base[key]) printf "LOWER %s CCN=%d baseline=%d (improved — refresh baseline when convenient)\n", name, ccn, base[key]
        else                      printf "OK %s CCN=%d at baseline\n", name, ccn
      } else {
        if (ccn > block)     printf "BLOCK %s CCN=%d (%s exceeds block threshold)\n", name, ccn, path
        else if (ccn > warn) printf "WARN %s CCN=%d (%s new/over warn threshold)\n", name, ccn, path
        else                 printf "OK %s CCN=%d\n", name, ccn
      }
    }
  '
}
