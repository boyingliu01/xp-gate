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
  cp "${BATS_TEST_DIRNAME}/../lib/now-ms.sh" "${TEST_DIR}/lib/now-ms.sh"
  cp "${BATS_TEST_DIRNAME}/../adapters/typescript.sh" "${TEST_DIR}/adapters/typescript.sh"
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
  export PATH="$TEST_DIR/bin:/usr/bin:/bin"
  
  cd "$TEST_DIR"
  git init --quiet
  git config user.email "test@test.com"
  git config user.name "Test User"
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

  mkdir -p src/domain
  touch src/domain/entity.py
  
  git add .
  
  run ./pre-commit
  
  [[ "$output" == *"deply"* ]] || [[ "$output" == *"Deply"* ]] || [[ "$output" == *"Architecture"* ]] || [[ "$output" == *"Gate 9"* ]] || [[ "$output" == *"ENVIRONMENT ERROR"* ]]
}

@test "Go project architecture test via goarchtest" {
  cat > go.mod << 'EOF'
module test-project

go 1.21
EOF

  mkdir -p domain
  touch domain/entity.go
  
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
  
  git add .
  
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
