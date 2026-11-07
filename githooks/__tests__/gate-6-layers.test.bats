#!/usr/bin/env bats
# @test REQ-LAYERS-01
# @intent Gate 6 declares layer boundaries in architecture.yaml and has never
#         enforced them (#16, #686, #728). The failure was not a wrong config —
#         nothing ever read the config. So the gate's own test has to assert the
#         ANSWER per input kind (violation present / absent / config missing /
#         config unusable), not merely that the script exits without crashing.
#         A layer checker that reports "0 violations" on a tree that violates is
#         indistinguishable from a working one unless something asserts the
#         positive case, which is exactly how the original defect survived for
#         seven months.
# @covers AC-LAYERS-01, AC-LAYERS-02, AC-LAYERS-03, AC-LAYERS-04, AC-LAYERS-05
#
# Verdict contract under test (inherited from pre-commit's java.sh/powershell.sh):
#   0 = PASS    no violations
#   1 = FAIL    new violations
#   2 = BLOCK   config present but unusable (fail-closed)
#   3 = WARN    no config / only baselined violations

setup() {
  REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
  GATE="$REPO_ROOT/githooks/gate-6-layers.sh"
  WORK="$(mktemp -d)"
  cd "$WORK"
  # No git init: the gate takes the find() fallback for bare directories, which
  # is the path a user's freshly-created project hits before its first commit.
  export XP_GATE_LAYER_CONFIG="$WORK/architecture.yaml"
  export XP_GATE_LAYER_BASELINE="$WORK/.layer-baseline.json"
}

teardown() {
  cd /
  rm -rf "$WORK"
}

write_config() {
  cat > "$XP_GATE_LAYER_CONFIG" <<'YAML'
version: 1
layers:
  domain:
    pattern: "src/domain/**"
    allowedImports: []
    forbiddenImports: ["src/infrastructure/**"]

  infrastructure:
    pattern: "src/infrastructure/**"
    allowedImports: ["src/domain/**"]
    forbiddenImports: []
YAML
}

# A perfectly ordinary project: infra depends on domain, which is allowed.
seed_clean_tree() {
  mkdir -p src/domain src/infrastructure
  printf 'export class Entity {}\n' > src/domain/entity.ts
  printf 'import { Entity } from "../domain/entity";\nexport const x = Entity;\n' \
    > src/infrastructure/db.ts
}

@test "clean tree passes with exit 0" {
  write_config
  seed_clean_tree
  run bash "$GATE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Layer boundaries verified"* ]]
}

@test "an inner layer importing an outer layer is BLOCKED with exit 1" {
  write_config
  seed_clean_tree
  # The textbook violation ARCH-001 describes: domain must not reach outward.
  printf 'import { x } from "../infrastructure/db";\nexport const y = x;\n' \
    > src/domain/violation.ts
  run bash "$GATE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"src/domain/violation.ts"* ]]
  [[ "$output" == *"domain -> infrastructure"* ]]
}

@test "the violation is named, not just counted — a count alone is unactionable" {
  write_config
  seed_clean_tree
  printf 'import { x } from "../infrastructure/db";\nexport const y = x;\n' \
    > src/domain/violation.ts
  run bash "$GATE"
  [[ "$output" == *"imports src/infrastructure/db"* ]]
}

@test "no layer config yields exit 3 and says so, never a silent pass" {
  seed_clean_tree
  run bash "$GATE"
  [ "$status" -eq 3 ]
  [[ "$output" == *"NOT checked"* ]]
  [[ "$output" == *"no_layer_config"* ]]
}

@test "a config with no usable layers is BLOCKED (exit 2), not silently passed" {
  printf 'version: 1\n' > "$XP_GATE_LAYER_CONFIG"
  seed_clean_tree
  run bash "$GATE"
  [ "$status" -eq 2 ]
  [[ "$output" == *"layer_config_unparsable"* ]]
}

@test "a recorded baseline downgrades a known violation to WARN (exit 3)" {
  write_config
  seed_clean_tree
  printf 'import { x } from "../infrastructure/db";\nexport const y = x;\n' \
    > src/domain/violation.ts
  cat > "$XP_GATE_LAYER_BASELINE" <<'JSON'
{"accepted": ["src/domain/violation.ts\tdomain\tinfrastructure\tsrc/infrastructure/db"]}
JSON
  run bash "$GATE"
  [ "$status" -eq 3 ]
  [[ "$output" == *"baseline"* ]]
}

@test "a baseline does not excuse a NEW violation" {
  write_config
  seed_clean_tree
  printf 'import { x } from "../infrastructure/db";\nexport const a = x;\n' \
    > src/domain/known.ts
  cat > "$XP_GATE_LAYER_BASELINE" <<'JSON'
{"accepted": ["src/domain/known.ts\tdomain\tinfrastructure\tsrc/infrastructure/db"]}
JSON
  printf 'import { x } from "../infrastructure/db";\nexport const b = x;\n' \
    > src/domain/fresh.ts
  run bash "$GATE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"src/domain/fresh.ts"* ]]
  [[ "$output" != *"src/domain/known.ts"* ]]
}

@test "allowedImports accepts a path glob, the form this repo's config uses" {
  cat > "$XP_GATE_LAYER_CONFIG" <<'YAML'
version: 1
layers:
  domain:
    pattern: "src/domain/**"
    allowedImports: []
  shared:
    pattern: "src/shared/**"
    allowedImports: []
  application:
    pattern: "src/application/**"
    allowedImports: ["src/domain/**", "src/shared/**"]
YAML
  mkdir -p src/domain src/shared src/application
  printf 'export const d = 1;\n' > src/domain/d.ts
  printf 'export const s = 1;\n' > src/shared/s.ts
  printf 'import { d } from "../domain/d";\nimport { s } from "../shared/s";\nexport const a = d + s;\n' \
    > src/application/a.ts
  run bash "$GATE"
  [ "$status" -eq 0 ]
}

@test "allowedImports also accepts a bare layer name" {
  cat > "$XP_GATE_LAYER_CONFIG" <<'YAML'
version: 1
layers:
  domain:
    pattern: "src/domain/**"
    allowedImports: []
  application:
    pattern: "src/application/**"
    allowedImports: [domain]
YAML
  mkdir -p src/domain src/application
  printf 'export const d = 1;\n' > src/domain/d.ts
  printf 'import { d } from "../domain/d";\nexport const a = d;\n' > src/application/a.ts
  run bash "$GATE"
  [ "$status" -eq 0 ]
}

@test "the longest matching pattern wins, so a nested layer beats its parent" {
  # Declared parent-first and again with a deeper layer: ordering must not
  # decide the verdict, or the same file would pass or fail depending on how
  # the YAML happens to be sorted.
  cat > "$XP_GATE_LAYER_CONFIG" <<'YAML'
version: 1
layers:
  infrastructure:
    pattern: "src/infrastructure/**"
    allowedImports: []
  domain:
    pattern: "src/domain/**"
    allowedImports: []
  infra_db:
    pattern: "src/infrastructure/db/**"
    allowedImports: ["src/domain/**"]
YAML
  mkdir -p src/domain src/infrastructure/db
  printf 'export const d = 1;\n' > src/domain/d.ts
  printf 'import { d } from "../../domain/d";\nexport const x = d;\n' \
    > src/infrastructure/db/x.ts
  run bash "$GATE"
  [ "$status" -eq 0 ]
}

@test "imports outside any declared layer are not violations" {
  write_config
  seed_clean_tree
  mkdir -p scripts
  printf 'import { Entity } from "../src/domain/entity";\nexport const s = Entity;\n' \
    > scripts/tool.ts
  run bash "$GATE"
  [ "$status" -eq 0 ]
}

@test "a commented-out import is not a violation" {
  write_config
  seed_clean_tree
  printf '// import { x } from "../infrastructure/db";\nexport const y = 1;\n' \
    > src/domain/commented.ts
  run bash "$GATE"
  [ "$status" -eq 0 ]
}

@test "an untracked file is scanned — agent-authored code is the case that matters" {
  # Regression: the first version used `git ls-files` (tracked only), so a
  # violation written into a not-yet-added file was invisible. That is exactly
  # the moment a check needs to fire, and it would have looked like a pass.
  write_config
  seed_clean_tree
  git init -q .
  git config user.email "t@example.com"
  git config user.name "t"
  git add -A
  printf 'import { x } from "../infrastructure/db";\nexport const y = x;\n' \
    > src/domain/untracked.ts
  run bash "$GATE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"src/domain/untracked.ts"* ]]
}

@test "a gitignored file is not scanned" {
  write_config
  seed_clean_tree
  git init -q .
  git config user.email "t@example.com"
  git config user.name "t"
  printf 'dist/\n' > .gitignore
  git add -A
  mkdir -p dist
  printf 'import { x } from "../infrastructure/db";\n' > dist/bundle.ts
  run bash "$GATE"
  [ "$status" -eq 0 ]
}
