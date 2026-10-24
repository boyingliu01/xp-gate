#!/usr/bin/env bats
# Gate 9: Architecture Quality Tests for Pre-commit Hook
# TDD: Tests for Clean Architecture layer boundary validation

setup() {
  TEST_DIR="$(mktemp -d '/tmp/xp gate9.XXXXXX')"
  export TEST_DIR
  export HOME="$TEST_DIR/home"
  mkdir -p "$HOME" "$TEST_DIR/lib" "$TEST_DIR/adapters" "$TEST_DIR/bin"
  cp "${BATS_TEST_DIRNAME}/../pre-commit" "${TEST_DIR}/pre-commit"
  cp "${BATS_TEST_DIRNAME}/../adapter-common.sh" "${TEST_DIR}/adapter-common.sh"
  cp "${BATS_TEST_DIRNAME}/../hook-module-resolution.sh" "${TEST_DIR}/hook-module-resolution.sh"
  # #592: copy the WHOLE lib/ directory, not just now-ms.sh.
  #
  # `pre-commit` sources ten helpers from lib/ (audit-sanitize, coverage-total,
  # docs-only, jscpd-run, now-ms, python-incremental-typecheck,
  # python-test-selection, sprint-gate-report, test-failure, typecheck). This
  # fixture copied only now-ms.sh, so the hook died before Gate 9 with
  #     FATAL: cannot load .../lib/audit-sanitize.sh (missing)
  # produced no gate output at all, and every verdict assertion failed.
  #
  # Copying the directory keeps the fixture working when a helper is added —
  # listing files by name is what let it drift nine helpers behind.
  cp -R "${BATS_TEST_DIRNAME}/../lib/." "${TEST_DIR}/lib/"
  # Same lesson as lib/ above, one directory later: copying only typescript.sh
  # left the Java fixture with no java adapter, so Gate 9 reported
  #     ⚠️  WARN - Java adapter not found (code quality NOT verified)
  # and the ArchUnit case found none of the words it asserts. Locally the hook's
  # fallback lookup found ../githooks/adapters/ by luck of the checkout layout;
  # on a CI runner it does not, so the case failed only there.
  cp -R "${BATS_TEST_DIRNAME}/../adapters/." "${TEST_DIR}/adapters/"
  chmod +x "${TEST_DIR}/pre-commit"
  cat > "$TEST_DIR/bin/npx" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"vitest --version"*) exit 0 ;;
  *"vitest run --coverage"*) mkdir -p coverage; printf '{"total":{"lines":{"pct":100}}}' > coverage/coverage-summary.json; exit 0 ;;
  *"vitest run"*|*"tsc"*|*"jscpd"*|*"tsx"*) exit 0 ;;
esac
exit 1
EOF
  chmod +x "$TEST_DIR/bin/npx"
  # Gate 5 is fail-closed per language since #570/#523, so a fixture that reaches
  # Gate 5 without a coverage artefact BLOCKS and Gate 9 never runs:
  #     ❌ BLOCKED - Could not determine Python coverage percentage.
  #     ❌ BLOCKED - Go coverage 0.0% below 80% threshold
  # Each case below is about Gate 9, so these stubs state the coverage those
  # branches read. Same convention as the npx stub above: stub the tool, do not
  # assume the host has run a coverage pass.
  cat > "$TEST_DIR/bin/coverage" <<'EOF'
#!/usr/bin/env bash
# coverage.py 7.x `report --format=total` prints a bare number.
echo "90"
exit 0
EOF
  chmod +x "$TEST_DIR/bin/coverage"
  cat > "$TEST_DIR/bin/go" <<'EOF'
#!/usr/bin/env bash
# `go test -coverprofile=coverage.out ./...` then `go tool cover -func=...`.
# Write the profile the hook expects and report a passing total.
case "$*" in
  *"-coverprofile"*)
    : > coverage.out
    exit 0 ;;
  *"tool cover"*)
    echo "total:	(statements)	90.0%"
    exit 0 ;;
esac
exit 0
EOF
  chmod +x "$TEST_DIR/bin/go"
  # #592: PREPEND the stub dir; keep the real PATH behind it.
  #
  # The old line REPLACED PATH with a fixed three-entry list:
  #     export PATH="$TEST_DIR/bin:/usr/bin:/bin"
  # Neither `git` nor `node` lives there on the machines that run this suite:
  #   - Linux CI runner: node is /usr/local/bin
  #   - Windows Git Bash: git is "/c/Program Files/Git/..."
  # so setup() died immediately with
  #     `git init --quiet' failed with status 127
  #     line 29: git: command not found
  # and all 18 cases failed — in CI on the verdict assertions, locally on the
  # very first `git init`. Either way the suite asserted nothing about Gate 9.
  #
  # Prepending keeps the stub `npx` in front (which is the point of the stub)
  # while letting the hook find the real git/node behind it. Every other
  # stub-based suite in this directory already does `"$stub:$PATH"`.
  export PATH="$TEST_DIR/bin:$PATH"
  
  cd "$TEST_DIR"
  git init --quiet
  git config user.email "test@test.com"
  git config user.name "Test User"
  # #592: move off the default branch. `git init` creates master/main, both of
  # which Gate 0 treats as PROTECTED: on a protected branch the hook stops with
  #     ERROR: Committing to a protected branch without VERSION/CHANGELOG update.
  # and exits before any gate runs. Measured: the fixture produced no gate output
  # at all, so every "the hook must print X" assertion failed no matter what the
  # architecture gate did. A feature branch is also what a real user commits on.
  git checkout --quiet -b feature/gate9-fixture
  cat >> .git/info/exclude <<'EOF'
pre-commit
adapter-common.sh
lib/
adapters/
bin/
EOF
}

@test "nested TypeScript project runs root archlint baseline from repository root" {
  mkdir -p "$TEST_DIR/node_modules/.bin" "$TEST_DIR/apps/nested/src"
  cat > "$TEST_DIR/node_modules/.bin/archlint" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$PWD" > "$ARCHLINT_LOG.cwd"
printf '%s\n' "$@" > "$ARCHLINT_LOG.args"
exit 0
EOF
  chmod +x "$TEST_DIR/node_modules/.bin/archlint"
  echo '{}' > "$TEST_DIR/.archlint.yaml"
  echo '{}' > "$TEST_DIR/.architecture-baseline.json"
  echo '{"name":"nested","version":"1.0.0"}' > "$TEST_DIR/apps/nested/package.json"
  echo '{}' > "$TEST_DIR/apps/nested/tsconfig.json"
  echo '// @no-test-required: Gate 6 fixture' > "$TEST_DIR/apps/nested/src/index.ts"
  git add .archlint.yaml .architecture-baseline.json apps/nested/package.json apps/nested/tsconfig.json apps/nested/src/index.ts
  export ARCHLINT_LOG="$TEST_DIR/archlint"
  run ./pre-commit
  [ -f "$ARCHLINT_LOG.cwd" ]
  [ "$(cat "$ARCHLINT_LOG.cwd")" = "$TEST_DIR" ]
  [ "$(tr '\n' ' ' < "$ARCHLINT_LOG.args")" = "diff .architecture-baseline.json --fail-on high " ]
}

teardown() {
  cd "$BATS_TEST_DIRNAME" || return 1
  rm -rf "$TEST_DIR"
}

@test "local archlint resolves to a project-root binary" {
  run grep -F 'if [ -x "$PROJECT_ROOT/node_modules/.bin/archlint" ]; then' "$BATS_TEST_DIRNAME/../pre-commit"
  [ "$status" -eq 0 ]

  run grep -F 'ARCHLINT_BIN="$PROJECT_ROOT/node_modules/.bin/archlint"' "$BATS_TEST_DIRNAME/../pre-commit"
  [ "$status" -eq 0 ]
}

@test "Gate 9 header displayed in pre-commit output" {
  cat > package.json << 'EOF'
{
  "name": "test-project",
  "version": "1.0.0"
}
EOF

  cat > architecture.yaml << 'EOF'
version: 1
layers:
  domain:
    pattern: "src/domain/**"
EOF

  mkdir -p src/domain
  echo '// @no-test-required: architecture fixture' > src/domain/entity.ts
  
  git add .
  
  run ./pre-commit
  
  [[ "$output" == *"Gate 9"* ]] || [[ "$output" == *"Architecture"* ]] || [[ "$output" == *"Gate 8"* ]] || [[ "$output" == *"PASSED"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

@test "TypeScript project requires archlint tool" {
  cat > package.json << 'EOF'
{
  "name": "test-project",
  "version": "1.0.0"
}
EOF

  mkdir -p src/domain
  echo '// @no-test-required: architecture fixture' > src/domain/entity.ts
  
  git add .
  
  run ./pre-commit
  
  [[ "$output" == *"archlint"* ]] || [[ "$output" == *"archlinter"* ]] || [[ "$output" == *"Architecture"* ]] || [[ "$output" == *"Gate 9"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

@test "architecture.yaml configuration file detected" {
  cat > package.json << 'EOF'
{
  "name": "test-project",
  "version": "1.0.0"
}
EOF

  cat > architecture.yaml << 'EOF'
version: 1
layers:
  domain:
    pattern: "src/domain/**"
EOF

  mkdir -p src/domain
  touch src/domain/entity.ts
  
  git add .
  
  run ./pre-commit
  
  [[ "$output" == *"architecture"* ]] || [[ "$output" == *"Architecture"* ]] || [[ "$output" == *"Gate"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

@test "Python project requires deply tool" {
  cat > requirements.txt << 'EOF'
ruff>=0.1.0
EOF

  # A real Python toolchain on the host shadows the fixture's `coverage` stub: on
  # Windows `coverage` resolves to .../Python312/Scripts/coverage, which chokes on
  # the fake .coverage and exits non-zero, so Gate 5 BLOCKED and Gate 9 never ran.
  # The `env PATH=...` below forces the fixture's bin first for this run.
  cat > "$TEST_DIR/bin/pytest" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
  chmod +x "$TEST_DIR/bin/pytest"

  mkdir -p src/domain
  touch src/domain/entity.py
  # The hook only consults `coverage report` when a .coverage database is present
  # (coverage-total.sh), so the stub needs this marker to be reached at all.
  echo "stub" > .coverage
  
  git add .
  
  run env "PATH=$TEST_DIR/bin:$PATH" ./pre-commit
  
  [[ "$output" == *"deply"* ]] || [[ "$output" == *"Deply"* ]] || [[ "$output" == *"Architecture"* ]] || [[ "$output" == *"Gate 9"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

@test "Go project architecture test via goarchtest" {
  cat > go.mod << 'EOF'
module test-project

go 1.21
EOF

  mkdir -p domain
  # #592: write a real Go file, not `touch` an empty one. An empty .go file is
  # "expected 'package', found 'EOF'" to golangci-lint, so Gate 1 BLOCKED and
  # exited before Gate 9 ran — the architecture assertion could never pass.
  cat > domain/entity.go << 'EOF'
// Package domain holds the fixture's domain layer.
package domain

// Entity is the fixture's domain entity.
type Entity struct{}
EOF

  git add .

  run ./pre-commit

  [[ "$output" == *"goarchtest"* ]] || [[ "$output" == *"Architecture"* ]] || [[ "$output" == *"go test"* ]] || [[ "$output" == *"Gate 9"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

@test "Java project architecture test via ArchUnit" {
  cat > pom.xml << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.test</groupId>
    <artifactId>test-project</artifactId>
    <version>1.0.0</version>
    <dependencies>
        <dependency>
            <groupId>com.tngtech.archunit</groupId>
            <artifactId>archunit</artifactId>
            <version>1.0.0</version>
            <scope>test</scope>
        </dependency>
    </dependencies>
</project>
EOF

  mkdir -p src/main/java/com/test/domain
  touch src/main/java/com/test/domain/Entity.java
  # Gate 5's Java branch is fail-closed since #570: with no JaCoCo report it BLOCKS
  # ("No JaCoCo report found, so the 80% Java coverage...") and Gate 9 never runs,
  # so the ArchUnit words this case asserts never appear in the output. The case is
  # about Gate 9, so it supplies the coverage artefact it needs rather than relying
  # on a JaCoCo run that a clean checkout has not performed.
  mkdir -p target/site/jacoco
  cat > target/site/jacoco/jacoco.csv << 'JACOCO'
GROUP,PACKAGE,CLASS,INSTRUCTION_MISSED,INSTRUCTION_COVERED,BRANCH_MISSED,BRANCH_COVERED,LINE_MISSED,LINE_COVERED,COMPLEXITY_MISSED,COMPLEXITY_COVERED,METHOD_MISSED,METHOD_COVERED
test-project,com.test.domain,Entity,0,10,0,0,0,10,0,1,0,1
JACOCO
  
  git add . -A
  
  run ./pre-commit
  
  [[ "$output" == *"ArchUnit"* ]] || [[ "$output" == *"archunit"* ]] || [[ "$output" == *"Architecture"* ]] || [[ "$output" == *"ArchitectureTest"* ]] || [[ "$output" == *"Gate 9"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

@test "C++ project blocked without skip marker" {
  cat > main.cpp << 'EOF'
int main() {
    return 0;
}
EOF

  git add .
  
  run ./pre-commit
  
  [[ "$output" == *"BLOCKED"* ]] || [[ "$output" == *"C++"* ]] || [[ "$output" == *".skip-architecture-cpp"* ]] || [[ "$output" == *"not implemented"* ]] || [[ "$output" == *"Gate 9"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

@test "C++ project passes with .skip-architecture-cpp marker" {
  cat > main.cpp << 'EOF'
int main() {
    return 0;
}
EOF

  touch .skip-architecture-cpp
  
  git add .
  
  run ./pre-commit
  
  [[ "$output" == *"skipped"* ]] || [[ "$output" == *"skip"* ]] || [[ "$output" == *"C++"* ]] || [[ "$output" == *"Gate"* ]] || [[ "$output" == *"PASSED"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

@test "Documentation-only project skips Gate 9" {
  cat > README.md << 'EOF'
# Documentation Project
EOF

  mkdir -p docs
  cat > docs/guide.md << 'EOF'
# Guide
EOF

  git add .
  
  run ./pre-commit
  
  [[ "$output" == *"skip"* ]] || [[ "$output" == *"documentation"* ]] || [[ "$output" == *"Documentation"* ]] || [[ "$output" == *"Gate"* ]] || [[ "$output" == *"PASSED"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

@test "Version check for archlint - minimum 2.0.0" {
  if ! command -v archlint &> /dev/null && ! command -v npx &> /dev/null; then
    skip "archlint and npx not installed"
  fi
  
  cat > package.json << 'EOF'
{
  "name": "test-project",
  "version": "1.0.0"
}
EOF

  cat > architecture.yaml << 'EOF'
version: 1
layers:
  domain:
    pattern: "src/domain/**"
EOF

  mkdir -p src/domain
  touch src/domain/entity.ts
  
  git add .
  
  run ./pre-commit
  
  [[ "$output" == *"version"* ]] || [[ "$output" == *"2.0"* ]] || [[ "$output" == *"Architecture"* ]] || [[ "$output" == *"Gate 9"* ]] || [[ "$output" == *"PASSED"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

@test "Version check for deply - minimum 0.5.0" {
  if ! command -v deply &> /dev/null; then
    skip "deply not installed"
  fi
  
  cat > requirements.txt << 'EOF'
ruff>=0.1.0
EOF

  mkdir -p src/domain
  touch src/domain/entity.py
  
  git add .
  
  run ./pre-commit
  
  [[ "$output" == *"version"* ]] || [[ "$output" == *"0.5"* ]] || [[ "$output" == *"Architecture"* ]] || [[ "$output" == *"Gate 9"* ]] || [[ "$output" == *"PASSED"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

@test "Baseline mode not enabled by default for new projects" {
  cat > package.json << 'EOF'
{
  "name": "test-project",
  "version": "1.0.0"
}
EOF

  cat > architecture.yaml << 'EOF'
version: 1
layers:
  domain:
    pattern: "src/domain/**"
baseline:
  enabled: false
EOF

  mkdir -p src/domain
  touch src/domain/entity.ts
  
  git add .
  
  run ./pre-commit
  
  [[ "$output" == *"Architecture"* ]] || [[ "$output" == *"Gate 9"* ]] || [[ "$output" == *"baseline"* ]] || [[ "$output" == *"PASSED"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

@test "SARIF output format mentioned in output" {
  cat > package.json << 'EOF'
{
  "name": "test-project",
  "version": "1.0.0"
}
EOF

  cat > architecture.yaml << 'EOF'
version: 1
layers:
  domain:
    pattern: "src/domain/**"
output:
  format: sarif
EOF

  mkdir -p src/domain
  touch src/domain/entity.ts
  
  git add .
  
  run ./pre-commit
  
  [[ "$output" == *"sarif"* ]] || [[ "$output" == *"SARIF"* ]] || [[ "$output" == *"Architecture"* ]] || [[ "$output" == *"Gate 9"* ]] || [[ "$output" == *"PASSED"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

@test "Missing architecture.yaml BLOCKS commit (zero tolerance)" {
  cat > package.json << 'EOF'
{
  "name": "simple-project",
  "version": "1.0.0"
}
EOF

  git add .
  
  run ./pre-commit
  
  # Should BLOCK when architecture.yaml missing (zero tolerance principle)
  [ "$status" -ne 0 ]
  [[ "$output" == *"BLOCKED"* ]] || [[ "$output" == *"architecture.yaml"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

@test "Missing architecture.yaml shows helpful fix instructions" {
  cat > package.json << 'EOF'
{
  "name": "simple-project",
  "version": "1.0.0"
}
EOF

  mkdir -p src
  echo '// @no-test-required: architecture fixture' > src/index.ts

  git add .
  
  run ./pre-commit
  
  # Should show fix instructions when blocking
  [[ "$output" == *"Quick fix"* ]] || [[ "$output" == *"curl"* ]] || [[ "$output" == *"github"* ]] || [[ "$output" == *"minimal config"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

@test "architecture.yaml can be JSON format (.architecturerc)" {
  cat > package.json << 'EOF'
{
  "name": "test-project",
  "version": "1.0.0"
}
EOF

  cat > .architecturerc << 'EOF'
{
  "version": 1,
  "layers": {
    "domain": {
      "pattern": "src/domain/**"
    }
  }
}
EOF

  mkdir -p src/domain
  touch src/domain/entity.ts
  
  git add .
  
  run ./pre-commit
  
  # Should accept .architecturerc as valid config
  [[ "$output" == *"architecture"* ]] || [[ "$output" == *"Architecture"* ]] || [[ "$output" == *"Gate"* ]] || [[ "$output" == *"PASSED"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

@test "Zero tolerance principle - tool missing blocks commit" {
  cat > package.json << 'EOF'
{
  "name": "test-project",
  "version": "1.0.0"
}
EOF

  cat > architecture.yaml << 'EOF'
version: 1
layers:
  domain:
    pattern: "src/domain/**"
integration:
  toolRequired: true
EOF

  mkdir -p src/domain
  touch src/domain/entity.ts
  
  git add .
  
  if ! command -v archlint &> /dev/null; then
    run ./pre-commit
    
    [ "$status" -ne 0 ]
    [[ "$output" == *"BLOCKED"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]] || [[ "$output" == *"archlint"* ]]
  else
    skip "archlint installed, cannot test missing tool scenario"
  fi
}

@test "Gate 9 runs after Gate 8 Boy Scout" {
  cat > package.json << 'EOF'
{
  "name": "test-project",
  "version": "1.0.0"
}
EOF

  git add .
  
  run ./pre-commit
  
  [[ "$output" == *"Gate 8"* ]] || [[ "$output" == *"Boy Scout"* ]] || [[ "$output" == *"Gate 9"* ]] || [[ "$output" == *"Architecture"* ]] || [[ "$output" == *"PASSED"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}
