#!/usr/bin/env bats
# @test REQ-597
# @intent The pre-push JSON journal was never written — on any platform — and the
#         code that was supposed to write it failed silently. Two independent defects,
#         one hiding the other.
#
#         1. The Python emitter was a `<<PY` heredoc, invoked from the EXIT trap:
#
#                trap '_pre_push_report_on_exit' EXIT
#                ...
#                while read local_ref local_sha remote_ref remote_sha; do
#
#            A heredoc is read from STDIN, and by the time the trap runs the stdin
#            loop above has consumed it. So `python - <<PY` received NOTHING and bash
#            executed the body as shell commands:
#                .git/hooks/pre-push: line 92: None: command not found
#                .git/hooks/pre-push: line 92: verdict: command not found
#
#         2. `python3 - <<PY 2>/dev/null || true` swallowed everything. On Windows
#            Git Bash `python3` is the Microsoft Store stub (exits 49, prints
#            nothing) while `python` is the real 3.12 interpreter — so the command
#            failed, stderr went to /dev/null, `|| true` returned success, and nothing
#            was journaled. Measured: `gitleaks`/`ls .xp-gate/reports/pre-push/` came
#            back empty for a real tag push.
#
#         Net effect: the ONLY audit record a push leaves was missing, and the gate
#         looked healthy because a `|| true` guaranteed a zero exit.
#
#         Fixes: resolve an interpreter that actually answers `--version` (python3 →
#         python → py); write the Python body to a temp file so stdin is irrelevant;
#         and report a non-zero interpreter instead of masking it.
#
#         Pin: never emit a script body through a heredoc from an EXIT trap, and never
#         wrap a whole emitter in `|| true`.
# @covers AC-597-01, AC-597-02, AC-597-03

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  PRE_PUSH="$REPO_ROOT/githooks/pre-push"
  TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR" || exit 1
  git init -q -b feature/journal-fixture . || exit 1
  git config user.email "test@test.com"
  git config user.name "Test"
  mkdir -p .git/hooks/lib
  cp "$REPO_ROOT/githooks/pre-push" .git/hooks/pre-push
  chmod +x .git/hooks/pre-push
  cp "$REPO_ROOT/githooks/lib/validate-code-walkthrough.cjs" .git/hooks/lib/ 2>/dev/null || true
  # The scorer is a real install artefact (install.sh copies lib/*.py beside the
  # hook), and pre-push fails closed without it (#580-04), so the fixture installs
  # it like a real install does. Local runs used to pass only because the hook's
  # last-resort lookup found ../githooks/lib/ by luck of the checkout layout.
  cp "$REPO_ROOT/githooks/lib/prepush-score.py" .git/hooks/lib/ 2>/dev/null || true
  cp "$REPO_ROOT/githooks/adapter-common.sh" .git/hooks/ 2>/dev/null || true
  cp "$REPO_ROOT/githooks/hook-module-resolution.sh" .git/hooks/ 2>/dev/null || true
  git config core.hooksPath .git/hooks

  mkdir -p "$TEST_DIR/bin"
  for t in gitleaks jscpd lizard semgrep checkov hadolint; do
    printf '#!/bin/bash\nexit 0\n' > "$TEST_DIR/bin/$t"
    chmod +x "$TEST_DIR/bin/$t"
  done
  export PATH="$TEST_DIR/bin:$PATH"

  printf 'init\n' > README.md
  git add . >/dev/null 2>&1
  git commit -q --no-verify -m "init"
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

@test "AC-597-01: a real push writes the pre-push journal" {
  local sha stdin_file
  sha="$(git rev-parse HEAD)"
  stdin_file="$TEST_DIR/push-stdin.txt"
  printf 'refs/heads/feature/journal-fixture %s refs/heads/feature/journal-fixture %s\n' \
    "$sha" "0000000000000000000000000000000000000000" > "$stdin_file"

  run .git/hooks/pre-push origin https://example.com < "$stdin_file"
  echo "hook exit: $status"

  local f
  f="$(ls -1t .xp-gate/reports/pre-push/*.json 2>/dev/null | head -n1)"
  [ -n "$f" ] || {
    echo "no journal file under .xp-gate/reports/pre-push/"
    echo "The push left no audit record. Hook output tail:"
    echo "$output" | tail -n 20
    return 1
  }

  # And it must be parseable JSON with the expected shape.
  run node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    if (!Array.isArray(j.gates) || j.gates.length === 0) throw new Error("no gates array");
    if (!j.overall || j.overall.verdict === undefined) throw new Error("no overall.verdict");
    console.log("gates:", j.gates.length, "verdict:", j.overall.verdict);
  ' "$f"
  [ "$status" -eq 0 ] || {
    echo "journal is not valid:"
    echo "$output"
    return 1
  }
}

@test "AC-597-02: the hook never runs a heredoc python body from the exit trap" {
  # A `<<PY` body fed to python cannot work from the EXIT trap: the stdin loop
  # upstream has already consumed stdin. Assert the temp-file form is used.
  run bash -c "sed 's/#.*//' '$PRE_PUSH' | grep -nE 'python3?[0-9.]*\\s+-\\s*<<'"
  [ -z "$output" ] || {
    echo "pre-push still pipes a heredoc into python:"
    echo "$output"
    echo "From the EXIT trap stdin is already consumed, so the body never reaches"
    echo "the interpreter and bash executes it as shell commands."
    return 1
  }
  bash -c "sed 's/#.*//' '$PRE_PUSH' | grep -q 'py_script'" || {
    echo "pre-push does not write the journal emitter to a temp script file"
    return 1
  }
}

@test "AC-597-03: a missing interpreter is reported, not masked with || true" {
  # The emitter must not end in a blanket `|| true` that turns any failure into
  # success — that is what hid the missing journal for so long.
  run bash -c "sed 's/#.*//' '$PRE_PUSH' | grep -nE '\\|\\|\\s*true' | grep -iE 'python|py_bin'"
  [ -z "$output" ] || {
    echo "the python emitter is still wrapped in || true:"
    echo "$output"
    return 1
  }
  # A failed interpreter must produce a visible warning.
  grep -q 'Gate M journal:' "$PRE_PUSH" || {
    echo "pre-push has no visible warning for a failed journal write"
    return 1
  }
}
