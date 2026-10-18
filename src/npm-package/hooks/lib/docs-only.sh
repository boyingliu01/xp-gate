#!/bin/bash
# ============================================================================
# docs-only.sh — commit-level documentation-only detection (REQ-F2)
#
# The pre-commit hook already knows about PROJECT-level documentation repos
# (PROJECT_LANG=documentation-only: the repo has no code files at all). This
# is the COMMIT-level sibling: xp-gate's own docs churn — typo fixes, changelog
# entries, plan docs — used to pay the full ~46s gate bill even though tests,
# jscpd, tsc and file hygiene cannot observe a markdown edit. When every
# staged file is documentation, those heavy gates SKIP with reason
# docs_only_change; light gates (secrets, version, principles) still run.
#
# Fail-closed by construction: an empty list or any single non-matching path
# prints "false" and the gates run as before.
#
# detect_docs_only_commit reads newline-separated staged paths on stdin and
# prints true|false.
# ============================================================================

detect_docs_only_commit() {
  local f ext saw=0
  while IFS= read -r f || [ -n "$f" ]; do
    [ -n "$f" ] || continue
    saw=1
    # Any recognizable source extension is code, wherever it lives — a .ts
    # under docs/ (sample snippets, doc tooling) still deserves its gates.
    ext="${f##*.}"
    case "$ext" in
      ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|kts|swift|cpp|cc|c|h|hpp|m|mm|rs|rb|php|cs|dart|sh|bash|ps1|psm1)
        printf 'false'
        return 0
        ;;
    esac
    case "$f" in
      *.md|*.mdx|*.rst|*.txt|*.adoc) continue ;;
      docs/*|docs-*/**|.github/ISSUE_TEMPLATE/**) continue ;;
      *)
        printf 'false'
        return 0
        ;;
    esac
  done
  if [ "$saw" = 1 ]; then
    printf 'true'
    return 0
  fi
  printf 'false'
  return 0
}
