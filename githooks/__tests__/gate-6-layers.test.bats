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

@test "the violation is named, not just counted -- a count alone is unactionable" {
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

@test "an untracked file is scanned -- agent-authored code is the case that matters" {
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

# ── Round 5 review findings ──────────────────────────────────────────────────
# Both cases below cover paths that were missing from the first version and that
# each reproduce the #686 defect class one level deeper: a verdict that reads
# like "checked and clean" when nothing was checked.

@test "config whose layers match no file reports WARN, not PASS (vacuous run)" {
  # Declared layers exist in the config but classify none of the files present.
  # Before this case existed, that produced "0 violations" and exit 0, which is
  # exactly the silent-pass shape Gate 6 was built to remove. XP-Gate's own repo
  # is this situation: architecture.yaml ships a Clean Architecture template whose
  # directories do not exist here.
  cat > "$XP_GATE_LAYER_CONFIG" <<'YAML'
version: 1
layers:
  domain:
    patterns: ["src/domain/**"]
    allowedImports: ["src/shared/**"]
  infrastructure:
    patterns: ["src/infrastructure/**"]
    allowedImports: []
YAML
  mkdir -p src/somewhere
  printf 'export const x = 1;\n' > src/somewhere/thing.ts
  run bash "$GATE"
  [ "$status" -eq 3 ]
  [[ "$output" == *"nothing was actually checked"* ]]
  [[ "$output" == *"layer_config_matches_no_files"* ]]
}

@test "a classifying config still PASSes, so the vacuous guard is not over-broad" {
  # The counterpart to the case above: the guard must fire only when NOTHING was
  # classified. A config that classifies at least one file and finds no violation
  # is a real pass and must stay exit 0.
  write_config
  seed_clean_tree
  run bash "$GATE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"file(s) classified"* ]]
}

@test "a 'patterns:' array classifies files, same as singular 'pattern:'" {
  # The parser originally read only `pattern:`. A config using the natural
  # plural form -- the one a layer owning two directories has to write -- parsed
  # to an empty pattern list, matched nothing, and reported "0 violations". That
  # is the same silent pass as the vacuous-config case above, reached from a
  # valid-looking config instead of a mismatched one.
  cat > "$XP_GATE_LAYER_CONFIG" <<'YAML'
version: 1
layers:
  domain:
    patterns: ["src/domain/**", "src/shared/**"]
    allowedImports: []
  infrastructure:
    patterns: ["src/infrastructure/**"]
    allowedImports: ["src/domain/**", "src/shared/**"]
YAML
  mkdir -p src/domain src/shared src/infrastructure
  printf 'export const v = 1;\n' > src/domain/a.ts
  printf 'export const s = 1;\n' > src/shared/b.ts
  printf 'import { v } from "../domain/a";\nexport const i = v;\n' > src/infrastructure/c.ts
  run bash "$GATE"
  [ "$status" -eq 0 ]
  # 3 files across 2 layers, all classified -- not the zero-classified warn.
  [[ "$output" == *"3 file(s) classified"* ]]
}

@test "a 'patterns:' array still catches a violation" {
  cat > "$XP_GATE_LAYER_CONFIG" <<'YAML'
version: 1
layers:
  domain:
    patterns: ["src/domain/**", "src/shared/**"]
    allowedImports: []
  infrastructure:
    patterns: ["src/infrastructure/**"]
    allowedImports: ["src/domain/**"]
YAML
  mkdir -p src/domain src/infrastructure
  printf 'import { i } from "../infrastructure/c";\nexport const d = i;\n' > src/domain/a.ts
  printf 'export const i = 1;\n' > src/infrastructure/c.ts
  run bash "$GATE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"domain -> infrastructure"* ]]
}

@test "a layers: sequence of maps parses, and its paths: key classifies files" {
  # #811: a list of maps is ordinary YAML for `layers:`, but the parser only
  # recognised the map form and only the `pattern(s):` key. A correct config
  # written this way parsed to an empty layer table and the gate exited 2
  # (unparsable) — a fail-closed block for the wrong reason.
  cat > "$XP_GATE_LAYER_CONFIG" <<'YAML'
version: 1
layers:
  - name: domain
    paths: ["src/domain/**"]
    allowed_imports: [domain]
  - name: infrastructure
    paths: ["src/infrastructure/**"]
    allowed_imports: [domain, infrastructure]
YAML
  mkdir -p src/domain src/infrastructure
  printf 'export const v = 1;\n' > src/domain/a.ts
  printf 'import { v } from "../domain/a";\nexport const i = v;\n' > src/infrastructure/c.ts
  run bash "$GATE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"2 file(s) classified"* ]]
}

@test "a bare dash record keeps its nested name: and block-list paths" {
  # The third YAML shape for a list of maps: `-` alone, then `name:` at the next
  # level. Fields were dropped whenever the name was not on the dash line, so
  # this shape needs its own assertion — the same silent no-op one level deeper.
  cat > "$XP_GATE_LAYER_CONFIG" <<'YAML'
version: 1
layers:
  -
    name: domain
    paths:
      - "src/domain/**"
    allowed_imports: [domain]
  - name: infrastructure
    paths:
      - src/infrastructure/**
    allowed_imports:
      - domain
      - infrastructure
YAML
  mkdir -p src/domain src/infrastructure
  printf 'export const v = 1;\n' > src/domain/a.ts
  printf 'import { v } from "../domain/a";\nexport const i = v;\n' > src/infrastructure/c.ts
  run bash "$GATE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"2 file(s) classified"* ]]
}

@test "the sequence form still catches a violation" {
  # Accepting more shapes must not soften the verdict: the positive case is what
  # separates a working parser from one that merely stopped blocking.
  cat > "$XP_GATE_LAYER_CONFIG" <<'YAML'
version: 1
layers:
  - name: domain
    paths: ["src/domain/**"]
    allowed_imports: [domain]
  - name: infrastructure
    paths: ["src/infrastructure/**"]
    allowed_imports: [domain, infrastructure]
YAML
  mkdir -p src/domain src/infrastructure
  printf 'import { i } from "../infrastructure/c";\nexport const d = i;\n' > src/domain/a.ts
  printf 'export const i = 1;\n' > src/infrastructure/c.ts
  run bash "$GATE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"domain -> infrastructure"* ]]
}

# ── Round 2 walkthrough findings (MC-01) ─────────────────────────────────────
# An unrecognised record shape at the layer indent used to be skipped without
# flushing, so its field lines merged into the record above it: two layers became
# one, the inner->outer import fell inside the same layer, and the gate exited 0
# on a tree that violates. The general skip is now a parse error.

@test "a record key the parser does not recognise is BLOCKED, not merged into the previous layer" {
  cat > "$XP_GATE_LAYER_CONFIG" <<'YAML'
version: 1
layers:
  - name: domain
    paths: ["src/domain/**"]
    allowed_imports: [domain]
  - Name: infrastructure
    paths: ["src/infrastructure/**"]
    allowed_imports: [domain, infrastructure]
YAML
  mkdir -p src/domain src/infrastructure
  printf 'import { i } from "../infrastructure/c";\nexport const d = i;\n' > src/domain/a.ts
  printf 'export const i = 1;\n' > src/infrastructure/c.ts
  run bash "$GATE"
  [ "$status" -eq 2 ]
  [[ "$output" == *"layer_config_unparsable"* ]]
}

@test "a quoted record key is BLOCKED too, for the same merge reason" {
  cat > "$XP_GATE_LAYER_CONFIG" <<'YAML'
version: 1
layers:
  - name: domain
    paths: ["src/domain/**"]
  - "name": infrastructure
    paths: ["src/infrastructure/**"]
YAML
  seed_clean_tree
  run bash "$GATE"
  [ "$status" -eq 2 ]
  [[ "$output" == *"layer_config_unparsable"* ]]
}

# ── Round 1 walkthrough findings (#811 follow-up) ───────────────────────────
# YAML permits both layouts below, and each used to parse to an empty (or
# partial) layer table — the same style-dependent failure #811 fixed one form of.

@test "a sequence that starts at column 0 parses (layers: then - name: at indent 0)" {
  cat > "$XP_GATE_LAYER_CONFIG" <<'YAML'
version: 1
layers:
- name: domain
  paths:
  - src/domain/**
  allowed_imports: [domain]
- name: infrastructure
  paths:
  - src/infrastructure/**
  allowed_imports: [domain, infrastructure]
YAML
  mkdir -p src/domain src/infrastructure
  printf 'export const v = 1;\n' > src/domain/a.ts
  printf 'import { v } from "../domain/a";\nexport const i = v;\n' > src/infrastructure/c.ts
  run bash "$GATE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"2 file(s) classified"* ]]
}

@test "block-list items at their key's own indent parse (paths: then - x, both at 4)" {
  cat > "$XP_GATE_LAYER_CONFIG" <<'YAML'
version: 1
layers:
  - name: domain
    paths:
    - src/domain/**
  - name: infrastructure
    paths:
    - src/infrastructure/**
    allowed_imports: [domain, infrastructure]
YAML
  mkdir -p src/domain src/infrastructure
  printf 'export const v = 1;\n' > src/domain/a.ts
  printf 'import { v } from "../domain/a";\nexport const i = v;\n' > src/infrastructure/c.ts
  run bash "$GATE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"2 file(s) classified"* ]]
}

@test "a record that never receives a name is BLOCKED (exit 2), not dropped" {
  # Dropping a nameless record would enforce the rest of the config while the
  # file still claims that boundary — partial enforcement that reads as a pass.
  cat > "$XP_GATE_LAYER_CONFIG" <<'YAML'
version: 1
layers:
  -
    paths: [src/domain/**]
YAML
  seed_clean_tree
  run bash "$GATE"
  [ "$status" -eq 2 ]
  [[ "$output" == *"layer_config_unparsable"* ]]
}

@test "a sequence-form name outside the key grammar is BLOCKED (exit 2)" {
  # The map form only accepts [A-Za-z0-9_-]+ keys; the sequence form took any
  # substring, and a comma corrupts the comma-encoded name column.
  cat > "$XP_GATE_LAYER_CONFIG" <<'YAML'
version: 1
layers:
  - name: a,b
    paths: [src/domain/**]
YAML
  seed_clean_tree
  run bash "$GATE"
  [ "$status" -eq 2 ]
  [[ "$output" == *"layer_config_unparsable"* ]]
}

@test "a nested name: line gets the same validation as an inline one" {
  # The two name paths share setname(); before that they diverged, and the
  # nested form would have written "a,b" straight into the table.
  cat > "$XP_GATE_LAYER_CONFIG" <<'YAML'
version: 1
layers:
  -
    name: a,b
    paths: [src/domain/**]
YAML
  seed_clean_tree
  run bash "$GATE"
  [ "$status" -eq 2 ]
  [[ "$output" == *"layer_config_unparsable"* ]]
}

@test "a flow-mapping record is BLOCKED (exit 2), never silently skipped" {
  cat > "$XP_GATE_LAYER_CONFIG" <<'YAML'
version: 1
layers:
  - {name: domain, paths: [src/domain/**]}
YAML
  seed_clean_tree
  run bash "$GATE"
  [ "$status" -eq 2 ]
  [[ "$output" == *"layer_config_unparsable"* ]]
}

@test "a trailing comment on a sequence-form name is stripped, not part of the name" {
  cat > "$XP_GATE_LAYER_CONFIG" <<'YAML'
version: 1
layers:
  - name: domain # the core
    paths: [src/domain/**]
YAML
  seed_clean_tree
  run bash "$GATE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"1 file(s) classified"* ]]
}

@test "a trailing comment on a map-form key is still a record" {
  cat > "$XP_GATE_LAYER_CONFIG" <<'YAML'
version: 1
layers:
  domain:   # the core
    paths: [src/domain/**]
YAML
  seed_clean_tree
  run bash "$GATE"
  [ "$status" -eq 0 ]
  [[ "$output" == *"1 file(s) classified"* ]]
}

