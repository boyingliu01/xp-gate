#!/usr/bin/env bash
# Shared gitleaks migration notice (#511).
#
# Context: since #499, Gate 8 (secret scanning) is fail-closed — a missing
# gitleaks BLOCKs the commit with per-OS install instructions. The block message
# is correct but arrives too late: the user-facing installers (install-all.sh,
# install-pre-commit.sh, xp-gate init) never provisioned or even mentioned
# gitleaks, so an existing user upgrading into #499 hit a hard BLOCK on their
# next commit with no signal beforehand. This helper is the missing migration
# path: a probe-and-notice at install time. It never auto-installs (that stays
# the user's explicit choice) and never touches the fail-closed semantics.

# Echo the gitleaks status. Returns 0 when present, 1 when missing. The caller
# decides whether a missing tool is fatal — installers warn, they do not fail.
gitleaks_notice() {
  if command -v gitleaks >/dev/null 2>&1; then
    echo "✓ gitleaks present: $(gitleaks --version 2>/dev/null || echo 'version unknown')"
    return 0
  fi

  echo ""
  echo "⚠  gitleaks is NOT installed."
  echo "   Gate 8 (secret scanning) is FAIL-CLOSED since #499: your next commit"
  echo "   will be BLOCKED until gitleaks is available."
  echo ""
  echo "   Install it now:"
  echo "     bash scripts/install-gitleaks.sh"
  echo ""
  echo "   Per-OS alternatives:"
  echo "     macOS:          brew install gitleaks"
  echo "     Linux:          see https://github.com/gitleaks/gitleaks/releases"
  echo "     Windows:        winget install gitleaks  (or: scoop install gitleaks)"
  echo ""
  return 1
}
