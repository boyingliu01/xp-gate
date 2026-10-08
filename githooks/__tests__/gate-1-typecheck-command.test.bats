#!/usr/bin/env bats
# @test REQ-436
# @intent Gate 1's TypeScript branch must type-check a project with the checker the
#         project itself declares, not with a hardcoded `npx tsc --noEmit`. Plain tsc
#         cannot resolve `.vue` single-file components, so every `import X from './Foo.vue'`
#         became TS2307 and blocked 100% of commits in a Vue project whose own
#         `vue-tsc --noEmit` run is clean. With `set -o pipefail` active (pre-commit:112)
#         the pipeline's exit status really is the checker's, so those false findings
#         block. Resolution order: GATE_TS_TYPECHECK_CMD > package.json scripts.typecheck
#         > package.json scripts["type-check"] > the pre-#436 `npx tsc --noEmit` fallback.
#         When a project checker is resolved, the #293 extra test-file pass must not run
#         plain tsc afterwards — otherwise the same false TS2307 returns through it.
# @covers AC-436-01, AC-436-02, AC-436-03, AC-436-04, AC-436-05, AC-436-06, AC-436-07, AC-436-08

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  LIB="$REPO_ROOT/githooks/lib/typecheck.sh"
  WORK="$BATS_TEST_TMPDIR/proj"
  STUBS="$BATS_TEST_TMPDIR/stubs"
  mkdir -p "$WORK" "$STUBS"
}

# Build a stub toolchain where plain tsc reports the Vue false positives (exit 1)
# and the project's own checker is clean (exit 0). Each stub appends its own name
# to CALLED so a test can assert which checkers actually ran.
make_stubs() {
  cat > "$STUBS/npx" <<EOF
#!/usr/bin/env bash
echo "npx \$*" >> "$CALLED"
if [ "\$1" = "tsc" ] && [ "\$2" = "--version" ]; then echo "Version 5.6.1-Stub"; exit 0; fi
echo "src/router/index.ts(4,18): error TS2307: Cannot find module '@/views/Home.vue'."
exit 1
EOF
  cat > "$STUBS/npm" <<EOF
#!/usr/bin/env bash
echo "npm \$*" >> "$CALLED"
exit 0
EOF
  chmod +x "$STUBS/npx" "$STUBS/npm"
}

# Run the gate's TypeScript type-check step inside a prepared project fixture.
run_gate() {
  (
    cd "$WORK" || exit 90
    PATH="$STUBS:$PATH"
    CALLED_FILE="$CALLED"
    # shellcheck disable=SC1090
    source "$LIB"
    run_typescript_typecheck
  )
}

write_pkg() {
  printf '%s' "$1" > "$WORK/package.json"
  printf '{}\n' > "$WORK/tsconfig.json"
}

@test "AC-436-01: scripts.typecheck is resolved as the project checker" {
  write_pkg '{"scripts":{"typecheck":"vue-tsc --noEmit"}}'
  run bash -c "cd '$WORK' && source '$LIB' && resolve_typecheck_command"
  [ "$status" -eq 0 ]
  [ "$output" = "npm run typecheck" ]
}

@test "AC-436-02: scripts.type-check resolves too, and typecheck wins when both exist" {
  write_pkg '{"scripts":{"type-check":"vue-tsc --noEmit"}}'
  run bash -c "cd '$WORK' && source '$LIB' && resolve_typecheck_command"
  [ "$output" = "npm run type-check" ]

  write_pkg '{"scripts":{"typecheck":"npm run check:types","type-check":"vue-tsc --noEmit"}}'
  run bash -c "cd '$WORK' && source '$LIB' && resolve_typecheck_command"
  [ "$output" = "npm run typecheck" ]
}

@test "AC-436-03: a project declaring no checker keeps the pre-#436 tsc fallback" {
  write_pkg '{"scripts":{"build":"vite build"}}'
  run bash -c "cd '$WORK' && source '$LIB' && resolve_typecheck_command"
  [ "$status" -ne 0 ]
  [ -z "$output" ]

  # And the gate then behaves exactly as before: tsc's findings block.
  CALLED="$WORK/called.txt"; make_stubs
  run run_gate
  [ "$status" -eq 1 ]
  [[ "$output" == *"TS2307"* ]]
  grep -q "npx tsc --noEmit" "$CALLED"
}

@test "AC-436-04: GATE_TS_TYPECHECK_CMD overrides package.json" {
  write_pkg '{"scripts":{"typecheck":"vue-tsc --noEmit"}}'
  run bash -c "cd '$WORK' && GATE_TS_TYPECHECK_CMD='npx tsc --noEmit -p strict.json' && source '$LIB' && resolve_typecheck_command"
  [ "$output" = "npx tsc --noEmit -p strict.json" ]
}

@test "AC-436-05: an unparseable package.json degrades to the fallback, never a block" {
  write_pkg '{"scripts": this is not json'
  run bash -c "cd '$WORK' && source '$LIB' && resolve_typecheck_command"
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

@test "AC-436-06: a clean project checker passes the gate even though plain tsc reports TS2307" {
  write_pkg '{"scripts":{"typecheck":"vue-tsc --noEmit"}}'
  CALLED="$WORK/called.txt"; make_stubs
  run run_gate
  [ "$status" -eq 0 ]
  [[ "$output" != *"TS2307"* ]]
  grep -q "npm run typecheck" "$CALLED"
}

@test "AC-436-07: a failing project checker still blocks" {
  write_pkg '{"scripts":{"typecheck":"vue-tsc --noEmit"}}'
  CALLED="$WORK/called.txt"; make_stubs
  cat > "$STUBS/npm" <<'EOF'
#!/usr/bin/env bash
echo "src/App.vue(3,14): error TS2345: Argument of type 'string' is not assignable."
exit 2
EOF
  chmod +x "$STUBS/npm"
  run run_gate
  [ "$status" -eq 1 ]
  [[ "$output" == *"BLOCKED"* ]]
}

@test "AC-436-08: with a project checker, the #293 test-file pass must not run plain tsc" {
  mkdir -p "$WORK/src/__tests__"
  write_pkg '{"scripts":{"typecheck":"vue-tsc --noEmit"}}'
  CALLED="$WORK/called.txt"; make_stubs
  run run_gate
  [ "$status" -eq 0 ]
  # Only the version probe is allowed to touch npx; no tsc type-checking pass.
  run grep -c "npx tsc --noEmit" "$CALLED"
  [ "$output" = "0" ]
}

@test "both TS call sites route through the shared resolver" {
  # The two places that used to hardcode the checker must now share one decision.
  run grep -n "run_typescript_typecheck" "$REPO_ROOT/githooks/pre-commit"
  [ "$status" -eq 0 ]
  run grep -n "run_typescript_typecheck" "$REPO_ROOT/githooks/adapters/typescript.sh"
  [ "$status" -eq 0 ]
}
