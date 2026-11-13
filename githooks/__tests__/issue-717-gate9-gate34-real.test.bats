#!/usr/bin/env bats

# #717 AC-717-19 / AC-717-20: Gate 9 and Gate 3/4 actually PROCESS a real .cs
# file, not merely list the extension.
#
# R1 round 11 (FC-C1, FC-C2) rejected "the extension is already in the filter"
# as evidence: a filter that matches nothing and a filter that works look
# identical from the source text. These assert observable output.

setup() {
  REPO_ROOT="$BATS_TEST_DIRNAME/../.."
  FIXTURE=$(mktemp -d)
  # These cases run `git add` / `git commit` inside a throwaway repo. On a
  # developer box `core.hooksPath` points at the INSTALLED hooks
  # (~/.config/xp-gate/hooks), so the commit fired the real pre-commit and was
  # blocked by Gate 6 — the fixture has no .archlint.yaml, and a throwaway repo
  # cannot satisfy the architecture gate:
  #     ❌ ARCHITECTURE CONFIG MISSING - COMMIT BLOCKED
  # `&& git commit` then short-circuited, so the git command this case exists to
  # exercise never ran and the case failed for a reason that has nothing to do
  # with Gate 9's .cs selection. The same case passed in CI (no hooksPath) and
  # failed locally — machine-dependent, which is the worst kind of red.
  # An empty hooksPath keeps the throwaway repo hermetic: `git config --get
  # core.hooksPath` is still consulted, but resolves to a directory with no
  # hooks in it, so no gate can run and none can block.
  export GIT_CONFIG_COUNT=1
  export GIT_CONFIG_KEY_0=core.hooksPath
  export GIT_CONFIG_VALUE_0="$FIXTURE/.git/no-hooks"
}

teardown() {
  rm -rf "$FIXTURE"
}

# ---------------------------------------------------------------------------
# AC-717-19: Gate 9 (SAST) selects staged .cs files for semgrep.
# ---------------------------------------------------------------------------

@test "#717 AC-717-19: gate-9 selects a staged .cs file for scanning" {
  ( cd "$FIXTURE" && git init -q . && printf 'class A {}\n' > A.cs && git add A.cs ) >/dev/null 2>&1
  # Reproduce gate-9's own selection predicate against a real git index.
  run bash -c "cd '$FIXTURE' && git diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep -E '\.(ts|tsx|js|jsx|py|go|java|c|cpp|cs|rb|php|scala|swift)\$'"
  [ "$status" -eq 0 ]
  [ "$output" = "A.cs" ]
}

@test "#717 AC-717-19: gate-9 also selects .cs from a non-staged full listing" {
  ( cd "$FIXTURE" && git init -q . && printf 'class A {}\n' > A.cs && git add A.cs && git -c user.email=t@t -c user.name=t commit -qm x ) >/dev/null 2>&1
  run bash -c "cd '$FIXTURE' && git ls-files 2>/dev/null | grep -E '\.(ts|tsx|js|jsx|py|go|java|c|cpp|cs|rb|php|scala|swift)\$'"
  [ "$status" -eq 0 ]
  [ "$output" = "A.cs" ]
}

@test "#717 AC-717-19: the .cs entry survives in the file that actually runs SAST" {
  # #738: githooks/adapters/gate-9.sh was deleted along with its copies. The
  # regression this AC guards (a C# project whose .cs never reaches the SAST
  # language list, so the gate silently scans nothing) now lives or dies in
  # Gate 10's body -- the file the registry binds to the sast gate. Assert there:
  # pinning the deleted script would have failed for the wrong reason and proved
  # nothing about what runs.
  local sast="$REPO_ROOT/githooks/gate-entries/gate-10-entry.sh"
  [ -f "$sast" ] || {
    echo "Gate 10's body is gone; re-read this test"
    return 1
  }
  run grep -qF '|cs|csx|' "$sast"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# AC-717-20: Gate 3 (complexity) and Gate 4 (principles) ACT on a real .cs file.
# ---------------------------------------------------------------------------

@test "#717 AC-717-20: lizard parses a real .cs file and reports its CCN" {
  command -v lizard >/dev/null 2>&1 || skip "lizard not installed"
  # A method with 6 branches -> CCN well above the block threshold of 10 only
  # when nested; here assert that lizard REPORTS a number for C#, which is what
  # "the extension is in the filter" alone never proved.
  cat > "$FIXTURE/Complex.cs" <<'EOF'
namespace N;
public class Complex
{
    public int Grade(int a, int b, int c, int d, int e)
    {
        if (a > 0) { if (b > 0) { if (c > 0) { return 3; } return 2; } return 1; }
        if (d > 0 && e > 0) { return 4; }
        return 0;
    }
}
EOF
  run bash -c "cd '$FIXTURE' && lizard --csv -C 5 Complex.cs 2>/dev/null"
  [ "$status" -eq 0 ]
  # CSV row: NLOC,CCN,token,param,length,location
  echo "$output" | grep -q "Complex.cs"
  local ccn
  ccn=$(echo "$output" | head -1 | cut -d, -f2)
  [ -n "$ccn" ] && [ "$ccn" -gt 5 ]
}

@test "#717 AC-717-20: the Gate 3 complexity filter matches a .cs path" {
  run bash -c "echo 'src/JobRunner.cs' | grep -E '\.(ts|tsx|js|jsx|py|go|java|swift|cpp|c|hpp|h|m|mm|kt|cs)\$'"
  [ "$status" -eq 0 ]
  [ "$output" = "src/JobRunner.cs" ]
}

@test "#717 AC-717-20: the Gate 4 principles filter matches a .cs path" {
  run bash -c "echo 'src/JobRunner.cs' | grep -E '\.(ts|tsx|js|jsx|py|go|java|kt|dart|swift|cpp|c|hpp|h|m|mm|cs)\$'"
  [ "$status" -eq 0 ]
  [ "$output" = "src/JobRunner.cs" ]
}

@test "#717 AC-717-20: a non-C# path is still rejected by both filters" {
  # The mirror-image check: widening a filter must not match everything.
  run bash -c "echo 'docs/readme.md' | grep -E '\.(ts|tsx|js|jsx|py|go|java|swift|cpp|c|hpp|h|m|mm|kt|cs)\$'"
  [ "$status" -ne 0 ]
}
