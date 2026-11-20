# no-npx-probe.awk -- awk predicates for scripts/check-no-npx-probe.sh
# Two predicates from scripts/check-no-npx-probe.sh, translated to awk.
#
# WHY THIS EXISTS
#
# The bash version calls a function once per scanned line. Measured 2026-11-20 on
# this repository (load 0.00, three runs): 7301 / 6478 / 6445 ms over ~33.4k lines
# in 110 files, while reading the same bytes with `cat | wc -l` takes 258 ms. The
# remaining ~6.2 s is bash per-line call overhead on Windows, i.e. a fifth of a
# commit spent in the interpreter rather than checking anything.
#
# THE TRANSLATION IS LINE-FOR-LINE ON PURPOSE
#
# This guard has already been broken twice by simplification -- once by
# `grep -v '#'`, which dropped CODE lines and let an injected
# `if npx vitest --version; then` pass as clean. A second rewrite that "cleans up"
# the conditions would repeat that. Every branch below corresponds to exactly one
# `case ... esac` in the shell source, in the same order, and the shell is still
# the reference the tests compare against.
#
# MODE
#   awk -v mode=probe  -f no-npx-probe.awk <files>   # is_probe_line()   == 1
#   awk -v mode=run    -f no-npx-probe.awk <files>   # npx_runs_tool()   == 1
#
# Emits "FILE:LINE: TEXT" for each matching line.

function strip(code) {
  # code="${line%%\#*}" -- drop from the first '#'.
  if ((i = index(code, "#")) > 0) code = substr(code, 1, i - 1)
  # code="${code//2>&1/}" -- remove every occurrence of the diagnostic redirect.
  while ((i = index(code, "2>&1")) > 0)
    code = substr(code, 1, i - 1) substr(code, i + 4)
  return code
}

# The bash globs `*npx\ *` and `*npx`: npx followed by a space, or npx at the end
# of the statement. Trailing blanks are ignored by both, since `*npx\ *` already
# matches when blanks follow.
function has_invocation_shape(code,    t) {
  if (index(code, "npx ") > 0) return 1
  t = code
  sub(/[ \t]+$/, "", t)
  return (length(t) >= 3 && substr(t, length(t) - 2) == "npx")
}

# is_probe_line(): npx AND --version AND invocation shape. Nothing else.
function is_probe_line(code) {
  if (index(code, "npx") == 0) return 0
  if (index(code, "--version") == 0) return 0
  return has_invocation_shape(code)
}

# npx_runs_tool(): an actual tool handed to npx, with the documented exemptions.
function npx_runs_tool(code) {
  if (index(code, "npx") == 0) return 0
  # npx_runs_tool() accepts ONLY `*npx\ *` -- it has no `*npx` end-of-line form,
  # unlike is_probe_line(). Verified against the shell: a bare `npx` line and
  # `foo npx` are not flagged here but ARE flagged by the probe predicate.
  if (index(code, "npx ") == 0) return 0
  # An existence CHECK on npx itself cannot install anything.
  if (index(code, "command -v npx") > 0) return 0
  if (index(code, "type -P npx") > 0) return 0
  if (index(code, "which npx") > 0) return 0
  # Flags that change npx's own behaviour are fine.
  if (index(code, "npx --version") > 0) return 0
  if (index(code, "npx --help") > 0) return 0
  # Guidance PRINTED for a human is not an invocation. The shell globs are
  # `*echo*npx*` and `*printf*npx*`, which is ORDER-SENSITIVE: the printer must
  # come BEFORE npx. `if npx vitest --version; then echo ok; fi` is a real probe
  # that happens to print afterwards, and the shell flags it -- a plain
  # "both words present" test exempts it, which weakens the guard while looking
  # equivalent. Caught by the corpus test on the first run.
  if ((i = index(code, "echo")) > 0 && (j = index(code, "npx")) > i) return 0
  if ((i = index(code, "printf")) > 0 && (j = index(code, "npx")) > i) return 0
  return 1
}

{
  code = strip($0)
  hit = (mode == "run") ? npx_runs_tool(code) : is_probe_line(code)
  if (hit) print FILENAME ":" FNR ": " $0
}
