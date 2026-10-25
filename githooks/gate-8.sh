# ============================================================================
# GATE 8: Secret Scanning (gitleaks + detect-secrets)
# Detects secrets (API keys, passwords, tokens) in staged files.
# Tools:
#   gitleaks        -- primary, fail-closed (missing or non-0/1 exit => BLOCK, #499)
#   detect-secrets  -- secondary, baseline-diff: only blocks on secrets NOT in
#                      .secrets.baseline; silently does nothing when unavailable
# ============================================================================

 2>&1 echo ""
 2>&1 echo "→ Gate 8: Secret scanning (gitleaks + detect-secrets)..."
GATE_8_START=$(gate_start_ms)

# Gitleaks availability check
GITLEAKS_CMD=""
if command -v gitleaks >/dev/null 2>&1; then
  GITLEAKS_CMD="gitleaks"
elif [ -f "$HOME/.local/bin/gitleaks" ]; then
  GITLEAKS_CMD="$HOME/.local/bin/gitleaks"
fi

if [ -z "$GITLEAKS_CMD" ]; then
  # fail-closed (#499): an uninstalled gitleaks used to SKIP the gate, so any
  # contributor without it shipped commits with zero secret protection and no
  # signal. A security gate that cannot run must not report success.
  echo "     ❌ BLOCKED - gitleaks not installed (fail-closed, #499)."
  echo "   Secret scanning is mandatory before commit. Install gitleaks then retry:"
  echo "     macOS:   brew install gitleaks"
  echo "     Windows: winget install gitleaks"
  echo "     Linux:   scripts/install-gitleaks.sh  (or https://github.com/gitleaks/gitleaks)"
  exit 1
fi

GITLEAKS_CONFIG=""
if [ -f ".gitleaks.toml" ]; then
  # gitleaks is a native binary and may not understand MSYS/WSL paths, so pass an
  # absolute path in the host's own format when we can derive one (#449).
  #
  # #582 found this the hard way: `cygpath` exists only in Git-for-Windows/MSYS, and on
  # WSL its absence meant the fallback handed `/mnt/d/projects/<repo>/.gitleaks.toml`
  # to the native gitleaks.exe. It could not open the file, exited 1, and Gate 8
  # reported "Secrets detected". The conversion now lives in a shared library so the
  # next gate handing a path to a native binary does not re-derive it (#581).
  #
  # This script may also run standalone (archived/copied hook) without the library, so
  # the converter is used when present and the inline branch kept as the fallback.
  if declare -F to_native_path >/dev/null 2>&1; then
    GITLEAKS_CONFIG="--config=$(to_native_path "$(pwd)/.gitleaks.toml")"
  elif command -v cygpath >/dev/null 2>&1; then
    GITLEAKS_CONFIG="--config=$(cygpath -w "$(pwd)/.gitleaks.toml")"
  elif command -v wslpath >/dev/null 2>&1; then
    GITLEAKS_CONFIG="--config=$(wslpath -w "$(pwd)/.gitleaks.toml")"
  else
    GITLEAKS_CONFIG="--config=$(pwd)/.gitleaks.toml"
  fi
fi

# Scan the INDEX, not history. gitleaks 8.x `git --pre-commit` walks committed
# revisions and reports "0 commits scanned" on a pre-commit run -- so a staged
# secret was never seen and Gate 8 always passed. `git --staged` scans
# `git diff --cached`, which is exactly the pre-commit payload (#449).
GITLEAKS_REPORT="${TMPDIR:-/tmp}/gitleaks-report.json"
rm -f "$GITLEAKS_REPORT"
GITLEAKS_OUTPUT=$($GITLEAKS_CMD git --staged --redact --no-banner $GITLEAKS_CONFIG --report-format=json --report-path="$GITLEAKS_REPORT" 2>&1)
GITLEAKS_EXIT=$?

if [ "$GITLEAKS_EXIT" -eq 0 ]; then
  # Decide SKIP from the REPORT ARTIFACT, not from log wording. Parsing stdout
  # meant a gitleaks message change would silently turn a no-evidence run into
  # a PASS -- the same fail-open class this gate just fixed (#449).
  # The report exists and is a JSON array of findings; `[]` == clean scan.
  GITLEAKS_FINDINGS="?"
  if [ -f "$GITLEAKS_REPORT" ]; then
    # A report that is not shaped like a JSON array is no evidence: leave the
    # '?' sentinel so the gate reports SKIP, never a PASS it cannot support
    # (the fail-closed-on-the-claim rule #449 established).
    if grep -q '^\[' "$GITLEAKS_REPORT" 2>/dev/null; then
      # Count occurrences, not matching lines: `grep -c` prints its own zero AND
      # exits 1 on a clean report, so the old `|| echo 0` handed the verdict table
      # $'0\n0' -- no branch matched and a clean scan was BLOCKED as if it leaked
      # (#493). wc -l emits exactly one value, and `|| true` keeps the assignment
      # errexit/pipefail-safe (#489).
      GITLEAKS_FINDINGS=$(grep -o '"RuleID"' "$GITLEAKS_REPORT" 2>/dev/null | wc -l | tr -d '[:space:]') || true
    fi
  fi

  if [ "$GITLEAKS_FINDINGS" = "0" ]; then
    echo "     ✅ PASSED - No secrets detected."
    GATE_8_STATUS="PASS"
  elif [ "$GITLEAKS_FINDINGS" = "?" ]; then
    # #592: exit 0 with no usable report has TWO very different causes, and the
    # operator can only act if we tell them which one happened:
    #
    #   (a) the scan never ran — config unreadable, FTL, bad --report-path.
    #       Nothing was checked, so this must fail closed with the tool's own
    #       words, not be filed as "no evidence about the code".
    #   (b) the scan ran and found nothing, but the tool wrote no file (reported
    #       for gitleaks 8.30.1 on WSL; measured NOT to happen in git-bash with
    #       the same version, so the code must handle both). Only stdout is left,
    #       and stdout is weaker evidence than an artifact, so it still may not
    #       produce a PASS.
    #
    # The order matters and is the point: artifact first, tool failure second,
    # tool output last (#449 established the principle; #592 re-opens it).
    if printf '%s\n' "$GITLEAKS_OUTPUT" | grep -qiE '(^|[[:space:]])(FTL|fatal error)[[:space:]:]|unable to load'; then
      echo "     ❌ BLOCKED - ENVIRONMENT: gitleaks exited 0 but reported a failure, so"
      echo "        NO secret scan took place. This is a tooling problem, not a verdict"
      echo "        about the staged code."
      printf '%s\n' "$GITLEAKS_OUTPUT" | grep -iE 'FTL|fatal|unable' | head -3 | sed 's/^/        /'
      echo "   Fix the gitleaks config/invocation above and commit again."
      exit 1
    fi

    if printf '%s\n' "$GITLEAKS_OUTPUT" | grep -q 'no leaks found'; then
      # The scan demonstrably ran and found nothing, but there is no artifact to
      # prove it beyond this line. Reporting PASS from log wording is exactly what
      # #449 forbade, so this stays SKIP — and says WHY, which the old message did
      # not: without that, SKIP is indistinguishable from "tool missing".
      echo "     ⚠️  gitleaks scanned and reported no leaks, but wrote no report file"
      echo "        (${GITLEAKS_REPORT} missing). No artifact means no PASS (#449)."
      echo "     ⏭️  SKIPPED - secret scanning produced no artifact (scan reported clean)."
    else
      echo "     ⚠️  gitleaks exited 0 but produced no readable report and no scan summary"
      echo "     ⏭️  SKIPPED - secret scanning produced no evidence (not a pass)"
    fi
    GATE_8_STATUS="SKIP"
  else
    echo "     ❌ BLOCKED - gitleaks reported $GITLEAKS_FINDINGS finding(s)"
    echo "$GITLEAKS_OUTPUT"
    echo ""
    echo "Remediation: remove the secret, or allowlist a false positive in .gitleaks.toml."
    exit 1
  fi
elif [ "$GITLEAKS_EXIT" -eq 1 ]; then
  # #582: gitleaks exits 1 for BOTH "leaks found" and "I could not start" (unreadable
  # config, bad path, IO error). Treating every exit 1 as a finding produced the
  # loudest possible wrong answer: "Secrets detected in staged files", plus
  # instructions to rotate a key, on a repository where nothing had been scanned --
  # because WSL handed a POSIX path to the native binary (#582's own case).
  #
  # #592 established this distinction for exit 0 + FTL. The same test applies here,
  # and the order matters as much: a scanner that could not start must never be
  # reported as having found something, or the gate teaches people to disable it.
  if printf '%s\n' "$GITLEAKS_OUTPUT" | grep -qiE '(^|[[:space:]])(FTL|fatal error)[[:space:]:]|unable to load|cannot find the path'; then
    echo "     ❌ BLOCKED - ENVIRONMENT: gitleaks exited 1 because it could not start, so"
    echo "        NO secret scan took place. This is a tooling problem, not a verdict"
    echo "        about the staged code."
    printf '%s\n' "$GITLEAKS_OUTPUT" | grep -iE 'FTL|fatal|unable|cannot find' | head -3 | sed 's/^/        /'
    echo "   Fix the gitleaks config/invocation above and commit again."
    exit 1
  fi
  # Secrets found — output details
  echo "$GITLEAKS_OUTPUT"
  echo ""
  echo "     ❌ BLOCKED - Secrets detected in staged files."
  echo ""
  echo "Remediation options:"
  echo "  1. Remove the secret and use environment variables instead"
  echo "  2. Add a false positive to .gitleaks.toml allowlist"
  echo "  3. Use git secret or vault for sensitive data"
  echo ""
  echo "See: https://github.com/gitleaks/gitleaks"
  exit 1
else
  # fail-closed (#499): a non-0/1 exit (config error, crash) used to SKIP, which
  # let a broken scanner wave every commit through without any scan.
  echo "     ❌ BLOCKED - gitleaks exited with code $GITLEAKS_EXIT (fail-closed, #499)."
  echo "$GITLEAKS_OUTPUT"
  echo "   Secret scanning could not complete; fix the gitleaks error above and retry."
  exit 1
fi

# ---- detect-secrets（次要防线，基线比对）----
# detect-secrets-hook comes from the project's Python dev extra; it blocks only
# on secrets NOT yet registered in .secrets.baseline, so test-fixture dummy keys
# recorded in the baseline never trip it.
#
# The file list is piped NUL-delimited STRAIGHT into xargs -0 — never through a
# command substitution. `var=$(cmd -z)` strips every NUL byte (bash cannot hold
# NULs in a variable), which concatenated all filenames into one giant
# nonexistent path and would have BLOCKED every commit once a project shipped
# both detect-secrets-hook and .secrets.baseline. The pipeline lives inside an
# if-condition (errexit-exempt); a non-zero hook exit lands in the else branch.
if command -v detect-secrets-hook >/dev/null 2>&1 && [ -f ".secrets.baseline" ]; then
  DS_TMP="$(dirname "$(mktemp -u)")/ds-output.$$"
  if git diff --cached --name-only --diff-filter=ACM -z \
      | xargs -0 detect-secrets-hook --baseline .secrets.baseline > "$DS_TMP" 2>&1; then
    echo "     ✅ detect-secrets PASSED - no new secrets beyond baseline."
  else
    cat "$DS_TMP"
    echo ""
    echo "     ❌ BLOCKED - detect-secrets found secrets not in .secrets.baseline."
    echo "   If these are false positives, regenerate the baseline (cross-platform):"
    echo "     detect-secrets scan --update .secrets.baseline && git add .secrets.baseline"
    rm -f "$DS_TMP"
    exit 1
  fi
  rm -f "$DS_TMP"
else
  echo "     ⚠️  detect-secrets-hook unavailable (install: pip install -e \".[dev]\") — gitleaks only."
fi

record_gate_audit "gate-8" "secret-scanning" "$GATE_8_STATUS" "0" "$GATE_8_START"
