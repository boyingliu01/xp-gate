#!/usr/bin/env bats

# @test REQ-F3-004
# @intent A YAML/JSON syntax error must be reported as ONE entry. The gate
#         accumulated errors into a space-separated string and then re-split it
#         with an unquoted `for f in ...`, so a parser message containing spaces
#         became a run of fake "filenames" -- one real problem printed as many
#         (measured in #772).
# @covers AC-772-01
# @covers AC-772-02
#
# Why this matters beyond cosmetics: the line under "YAML/JSON syntax errors:" is
# read as a list of files to go fix. Splitting one message into `mapping`,
# `values`, `are`, `not`, `allowed`, `here` sends the reader looking for files
# that do not exist, while the one file that IS broken is buried at the start.

SOURCE_GITHOOKS="${XP_GATE_GITHOOKS:-$(cd "$BATS_TEST_DIRNAME/.." && pwd)}"

setup() {
  export TEST_DIR="$(mktemp -d)"
  cd "$TEST_DIR"
  git init -q -b test-branch
  git config user.email "test@test.com"
  git config user.name "Test"
  mkdir -p "$TEST_DIR/empty-hooks"
  git config core.hooksPath "$TEST_DIR/empty-hooks"

  # On this machine `python3` resolves to the Microsoft Store alias stub: it
  # exits 0 having done nothing, so a `python3 -c "import yaml"` probe looks
  # successful while the YAML branch silently validates nothing. That is #793's
  # family, not this issue's subject, so the fixture puts the REAL interpreter
  # first on PATH and lets the YAML branch actually run.
  local real_python
  real_python="$(command -v python 2>/dev/null || true)"
  if [ -n "$real_python" ]; then
    mkdir -p "$TEST_DIR/bin"
    ln -sf "$real_python" "$TEST_DIR/bin/python3"
    PATH="$TEST_DIR/bin:$PATH"
    export PATH
  fi

  echo "init" > README.md
  git add README.md
  git commit -q -m "init"  # core.hooksPath pinned to an empty dir in setup
}

teardown() {
  cd /
  rm -rf "$TEST_DIR"
}

# ── AC-772-01: a multi-word parser message stays one entry ───────────

@test "AC-772-01: a YAML error containing spaces is reported as a single entry" {
  # An unterminated flow sequence: PyYAML's first message line is
  # "while parsing a flow sequence" -- four words, so the old unquoted re-split
  # produced four fake filenames instead of one file entry.
  printf 'a: 1\nb: [1, 2\nc: 3\n' > broken.yaml
  git add broken.yaml

  run bash "$SOURCE_GITHOOKS/gate-12-file-hygiene.sh"
  # The gate is warning-only for this check, so the exit status is not the signal.
  # The signal is how many bullet lines the error section printed.
  local bullet_count
  bullet_count="$(printf '%s\n' "$output" | grep -c '^        - ' || true)"
  [ "$bullet_count" -eq 1 ]
  printf '%s\n' "$output" | grep -q 'broken.yaml'
}

# ── AC-772-02: anti-vacuity — two broken files still give two entries ─

# Without this, a "fix" that printed nothing (or always exactly one line) would
# satisfy AC-772-01. Two files with distinct names must produce two entries.
@test "AC-772-02: two broken files produce two separate entries" {
  printf 'a: 1\nb: [1, 2\nc: 3\n' > broken-one.yaml
  printf '":\n' > broken-two.json
  git add broken-one.yaml broken-two.json

  run bash "$SOURCE_GITHOOKS/gate-12-file-hygiene.sh"
  local bullet_count
  bullet_count="$(printf '%s\n' "$output" | grep -c '^        - ' || true)"
  [ "$bullet_count" -eq 2 ]
  printf '%s\n' "$output" | grep -q 'broken-one.yaml'
  printf '%s\n' "$output" | grep -q 'broken-two.json'
}
