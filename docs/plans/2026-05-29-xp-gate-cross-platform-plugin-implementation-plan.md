# XP-Gate Cross-Platform Plugin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Package xp-gate as plugins for both Claude Code and OpenCode while keeping the npm package unchanged for git hooks.

**Architecture:** Dual distribution — npm package (unchanged git hooks), Claude Code plugin (plugin.json + skills/ + hooks/), OpenCode plugin (index.ts + skills/). Both plugins bundle the same 7 SKILL.md files with platform-specific packaging.

**Tech Stack:** TypeScript, Bash, Claude Code plugin spec (JSON manifest), OpenCode plugin API (@opencode-ai/plugin), npm for distribution

**Design Doc:** `docs/plans/2026-05-29-xp-gate-cross-platform-plugin-design.md`

**Principles:** DRY (shared SKILL.md files), YAGNI (no unnecessary abstractions), TDD (tests for plugin build scripts), frequent commits (one per task)

---

### Task 1: Project Structure Setup

**Files:**
- Create: `plugins/claude-code/` directory structure
- Create: `plugins/opencode/` directory structure
- Create: `.gitignore` additions for plugin build artifacts
- Verify: plugins/ directory does not already exist, create fresh

**Step 1: Create plugin directory structure**

Create the following directories:
```bash
mkdir -p plugins/claude-code/.claude-plugin
mkdir -p plugins/claude-code/skills
mkdir -p plugins/claude-code/hooks
mkdir -p plugins/claude-code/bin
mkdir -p plugins/opencode
mkdir -p plugins/opencode/skills
mkdir -p plugins/shared
```

**Step 2: Verify structure**

```bash
ls -la plugins/claude-code/
ls -la plugins/opencode/
```

Expected: All subdirectories present.

**Step 3: Update .gitignore**

Add to existing `.gitignore`:
```
# Plugin build artifacts
plugins/**/skills/
plugins/**/*.lock
plugins/**/*.js.map
plugins/opencode/dist/
```

**Step 4: Commit**

```bash
git add plugins/ .gitignore
git commit -m "feat: add cross-platform plugin directory structure"
```

---

### Task 2: Claude Code Plugin Manifest

**Files:**
- Create: `plugins/claude-code/.claude-plugin/plugin.json`
- Test: Validate JSON schema matches Claude Code plugin spec

**Step 1: Create plugin.json**

Create `plugins/claude-code/.claude-plugin/plugin.json`:

```json
{
  "name": "xp-gate",
  "version": "0.4.0",
  "displayName": "XP-Gate",
  "description": "Extreme Programming quality gates + AI workflow skills for Claude Code. Includes 6 quality gates, Sprint Flow, and Delphi multi-expert review.",
  "author": {
    "name": "boyingliu01"
  },
  "homepage": "https://github.com/boyingliu01/xp-gate",
  "repository": "https://github.com/boyingliu01/xp-gate",
  "license": "MIT",
  "keywords": ["quality-gates", "sprint-flow", "delphi-review", "xp", "ai-development"],
  "skills": "./skills/",
  "hooks": "./hooks/hooks.json"
}
```

**Step 2: Validate JSON**

```bash
cat plugins/claude-code/.claude-plugin/plugin.json | node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8')); console.log('Name:', data.name); console.log('Version:', data.version);"
```

Expected output:
```
Name: xp-gate
Version: 0.4.0
```

**Step 3: Commit**

```bash
git add plugins/claude-code/.claude-plugin/
git commit -m "feat: add Claude Code plugin.json manifest"
```

---

### Task 3: Claude Code Plugin Hooks

**Files:**
- Create: `plugins/claude-code/hooks/hooks.json`
- Create: `plugins/claude-code/bin/xp-gate-check` (bash wrapper)

**Step 1: Create hooks.json**

Create `plugins/claude-code/hooks/hooks.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PLUGIN_ROOT\"/bin/xp-gate-check \"${TOOL_INPUT_FILE}\""
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "echo \"[XP-Gate] Session complete. Run 'xp-gate init' for full git hook integration.\""
          }
        ]
      }
    ]
  }
}
```

**Note (Delphi A-C1, M1, B-M1):** The `$CLAUDE_PLUGIN_ROOT` variable (not `${CLAUDE_PLUGIN_ROOT}`) is set by Claude Code at hook invocation time. The `|| true` wrapper is removed from hooks.json — the bin/xp-gate-check script itself handles graceful degradation and always exits 0, but logs warnings to stderr instead of swallowing errors silently.

**Step 2: Create bin/xp-gate-check wrapper**

Create `plugins/claude-code/bin/xp-gate-check`:

```bash
#!/bin/bash
# xp-gate-check: Quality gate wrapper for Claude Code plugin
# Usage: xp-gate-check <file_path>
#
# Graceful degradation: if xp-gate CLI unavailable, logs warning and exits 0.

set -euo pipefail

FILE_PATH="${1:-}"

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

[ -f "$FILE_PATH" ] || exit 0

case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.py|*.go|*.java|*.kt|*.rb|*.rs)
    ;;
  *)
    exit 0
    ;;
esac

# Resolve repo root: plugin is in plugins/claude-code/, repo is 2 levels up
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

if command -v xp-gate >/dev/null 2>&1; then
  npx -y tsx "${REPO_ROOT}/src/principles/index.ts" --files "$FILE_PATH" --format console 2>&1 || true
elif [ -f "${REPO_ROOT}/src/principles/index.ts" ]; then
  echo "[XP-Gate] Running principles check (xp-gate CLI not installed)" >&2
  npx -y tsx "${REPO_ROOT}/src/principles/index.ts" --files "$FILE_PATH" --format console 2>&1 || true
else
  echo "[XP-Gate] Quality check skipped: xp-gate not installed. Run 'npm install -g xp-gate'" >&2
fi

# Always exit 0 to avoid blocking the Claude session
exit 0
```

**Delphi fixes applied:**
- C1: Uses absolute path resolution from script location, not `CLAUDE_PLUGIN_ROOT` variable
- M1: Logs warning to stderr instead of `2>/dev/null` silent swallow
- B-M1: Path is absolute (derived from SCRIPT_DIR → REPO_ROOT), not relative

**Step 3: Make executable**

```bash
chmod +x plugins/claude-code/bin/xp-gate-check
```

**Step 4: Test hook structure**

```bash
cat plugins/claude-code/hooks/hooks.json | node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8')); console.log('Hook events:', Object.keys(data.hooks));"
```

Expected output:
```
Hook events: [ 'PostToolUse', 'Stop' ]
```

**Step 5: Commit**

```bash
git add plugins/claude-code/hooks/ plugins/claude-code/bin/
git commit -m "feat: add Claude Code event hooks and quality check wrapper"
```

---

### Task 4: Skill Copy Script (Shared Infrastructure)

**Files:**
- Create: `scripts/copy-skills.sh`
- Test: Run script to verify skills copy correctly

**Step 1: Write failing test**

Create `scripts/__tests__/copy-skills.bats`:

```bash
#!/usr/bin/env bats

setup() {
  TEST_DIR=$(mktemp -d)
  mkdir -p "$TEST_DIR/mock-skills/{sprint-flow,delphi-review,test-specification-alignment}"
  mkdir -p "$TEST_DIR/claude-skills" "$TEST_DIR/opencode-skills"
}

teardown() {
  rm -rf "$TEST_DIR"
}

@test "copy-skills.sh fails when skills directory missing" {
  run bash scripts/copy-skills.sh --source "$TEST_DIR/nonexistent" --dest "$TEST_DIR/claude-skills"
  [ "$status" -ne 0 ]
}

@test "copy-skills.sh creates target directory if missing" {
  bash scripts/copy-skills.sh --source "$TEST_DIR/mock-skills" --dest "$TEST_DIR/new-target"
  [ -d "$TEST_DIR/new-target" ]
}

@test "copy-skills.sh copies all skill directories" {
  run bash scripts/copy-skills.sh --source "$TEST_DIR/mock-skills" --dest "$TEST_DIR/claude-skills"
  [ "$status" -eq 0 ]
  [ -d "$TEST_DIR/claude-skills/sprint-flow" ]
  [ -f "$TEST_DIR/claude-skills/sprint-flow/SKILL.md" ] 2>/dev/null || true
}
```

**Step 2: Run test to verify it fails**

```bash
bats scripts/__tests__/copy-skills.bats
```

Expected: FAIL (script doesn't exist yet)

**Step 3: Write copy-skills.sh**

Create `scripts/copy-skills.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR=""
DEST_DIR=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --source)
      SOURCE_DIR="$2"
      shift 2
      ;;
    --dest)
      DEST_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Error: Source directory not found: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"

count=0

# Copy full skill directories (not just SKILL.md)
for skill_dir in "$SOURCE_DIR"/*/; do
  skill_name=$(basename "$skill_dir")
  skill_md="$skill_dir/SKILL.md"

  if [[ -f "$skill_md" ]]; then
    cp -r "$skill_dir" "$DEST_DIR/"
    echo "Copied: $skill_name"
    ((count++))
  fi
done

echo "Total skills copied: $count"
```

**Step 4: Make executable and run test**

```bash
chmod +x scripts/copy-skills.sh
```

Now run the test again:

```bash
bats scripts/__tests__/copy-skills.bats
```

Expected: All tests pass.

**Step 5: Commit**

```bash
git add scripts/copy-skills.sh scripts/__tests__/
git commit -m "feat: add skill copy script for plugin builds"
```

---

### Task 5: Build Script (Both Platforms)

**Files:**
- Create: `scripts/build-plugin.sh` (generic, parameterized by platform)
- Test: Build script verifies all skills copied for target platform

**Rationale:** Addresses Delphi M3 — a single generic script serves both Claude Code and OpenCode, eliminating >95% code duplication.

**Step 1: Create build-plugin.sh**

Create `scripts/build-plugin.sh`:

```bash
#!/bin/bash
# build-plugin.sh: Build a plugin package for a target platform
# Usage: scripts/build-plugin.sh --platform claude-code|opencode

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
PLATFORM=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform)
      PLATFORM="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [ -z "$PLATFORM" ]; then
  echo "Usage: build-plugin.sh --platform claude-code|opencode"
  exit 1
fi

PLUGIN_DIR="$REPO_ROOT/plugins/$PLATFORM"
SKILLS_SOURCE="$REPO_ROOT/skills"

if [ ! -d "$SKILLS_SOURCE" ]; then
  echo "Error: Skills directory not found: $SKILLS_SOURCE"
  exit 1
fi

echo "Building $PLATFORM plugin..."
bash "$SCRIPT_DIR/copy-skills.sh" --source "$SKILLS_SOURCE" --dest "$PLUGIN_DIR/skills"

EXPECTED_SKILLS=(
  "sprint-flow" "delphi-review" "test-specification-alignment"
  "ralph-loop" "test-driven-development" "improve-codebase-architecture" "to-issues"
)

MISSING=0
for skill in "${EXPECTED_SKILLS[@]}"; do
  if [ ! -f "$PLUGIN_DIR/skills/$skill/SKILL.md" ]; then
    echo "Missing: $skill/SKILL.md"
    MISSING=$((MISSING + 1))
  fi
done

if [ "$MISSING" -gt 0 ]; then
  echo "Error: $MISSING skills missing from $PLATFORM plugin"
  exit 1
fi

echo "Build complete: 7 skills packaged for $PLATFORM"
```

**Step 2: Make executable**

```bash
chmod +x scripts/build-plugin.sh
```

**Step 3: Test both platforms**

```bash
bash scripts/build-plugin.sh --platform claude-code
bash scripts/build-plugin.sh --platform opencode
```

**Step 4: Commit**

```bash
git add scripts/build-plugin.sh
git commit -m "feat: add generic plugin build script (both platforms)"
```

**Step 1: Create build-claude-plugin.sh**

Create `scripts/build-claude-plugin.sh`:

```bash
#!/bin/bash
# build-claude-plugin.sh: Build the Claude Code plugin package
# Usage: scripts/build-claude-plugin.sh [--clean]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
PLUGIN_DIR="$REPO_ROOT/plugins/claude-code"
SKILLS_SOURCE="$REPO_ROOT/skills"

# Clean if requested
if [[ "${1:-}" == "--clean" ]]; then
  echo "Cleaning existing plugin skills..."
  rm -rf "$PLUGIN_DIR/skills/"*
fi

echo "Building Claude Code plugin..."
echo "Source: $SKILLS_SOURCE"
echo "Target: $PLUGIN_DIR/skills"

# Check if skills directory exists
if [ ! -d "$SKILLS_SOURCE" ]; then
  echo "Error: Skills directory not found: $SKILLS_SOURCE"
  exit 1
fi

# Copy all skills
bash "$SCRIPT_DIR/copy-skills.sh" --source "$SKILLS_SOURCE" --dest "$PLUGIN_DIR/skills"

# Verify all expected skills are present
EXPECTED_SKILLS=(
  "sprint-flow"
  "delphi-review"
  "test-specification-alignment"
  "ralph-loop"
  "test-driven-development"
  "improve-codebase-architecture"
  "to-issues"
)

MISSING=0
for skill in "${EXPECTED_SKILLS[@]}"; do
  if [ ! -f "$PLUGIN_DIR/skills/$skill/SKILL.md" ]; then
    echo "Missing: $skill/SKILL.md"
    MISSING=$((MISSING + 1))
  fi
done

if [ "$MISSING" -gt 0 ]; then
  echo "Error: $MISSING skills missing from plugin"
  exit 1
fi

echo ""
echo "Build complete: ${EXPECTED_SKILLS[@]} skills packaged"
echo "Plugin location: $PLUGIN_DIR"
```

**Step 2: Make executable**

```bash
chmod +x scripts/build-claude-plugin.sh
```

**Step 3: Run build script**

```bash
bash scripts/build-claude-plugin.sh
```

Expected output:
```
Building Claude Code plugin...
Source: /home/boyingliu01/projects/xp-gate/skills
Target: /home/boyingliu01/projects/xp-gate/plugins/claude-code/skills
Copied: sprint-flow
Copied: delphi-review
...
Total skills copied: 7

Build complete: 7 skills packaged
Plugin location: /home/boyingliu01/projects/xp-gate/plugins/claude-code
```

**Step 4: Verify plugin structure**

```bash
find plugins/claude-code -type f | sort
```

Expected structure:
```
plugins/claude-code/.claude-plugin/plugin.json
plugins/claude-code/bin/xp-gate-check
plugins/claude-code/hooks/hooks.json
plugins/claude-code/skills/delphi-review/SKILL.md
plugins/claude-code/skills/improve-codebase-architecture/SKILL.md
plugins/claude-code/skills/ralph-loop/SKILL.md
plugins/claude-code/skills/sprint-flow/SKILL.md
plugins/claude-code/skills/test-driven-development/SKILL.md
plugins/claude-code/skills/test-specification-alignment/SKILL.md
plugins/claude-code/skills/to-issues/SKILL.md
```

**Step 5: Commit**

```bash
git add scripts/build-claude-plugin.sh plugins/claude-code/
git commit -m "feat: build Claude Code plugin with all 7 skills"
```

---

### Task 6: OpenCode Plugin - TypeScript Module

**Files:**
- Create: `plugins/opencode/index.ts`
- Create: `plugins/opencode/package.json`
- Create: `plugins/opencode/tsconfig.json`
- Test: TypeScript compilation succeeds

**Step 1: Create package.json**

Create `plugins/opencode/package.json`:

```json
{
  "name": "@xp-gate/opencode-plugin",
  "version": "0.4.0",
  "private": true,
  "type": "module",
  "main": "index.ts",
  "scripts": {
    "build": "bun build index.ts --outdir dist --target bun",
    "check": "tsc --noEmit"
  },
  "dependencies": {
    "@opencode-ai/plugin": "^0.0.1"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

**Note (Delphi B-M2, C-M2):** `@opencode-ai/plugin` must be in `dependencies` (runtime), not `devDependencies`. TypeScript compilation requires it at runtime.

**Step 2: Create tsconfig.json**

Create `plugins/opencode/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "outDir": "dist"
  },
  "include": ["index.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Write failing test**

Create `plugins/opencode/__tests__/index.test.ts`:

```typescript
import { describe, it, expect } from "bun:test"

describe("XpGatePlugin", () => {
  it("exports Plugin function", async () => {
    const { XpGatePlugin } = await import("../index.js")
    expect(typeof XpGatePlugin).toBe("function")
  })

  it("returns tool registry", async () => {
    const { XpGatePlugin } = await import("../index.js")

    // Create mock plugin input
    const mockInput = {
      directory: process.cwd(),
      worktree: null,
      project: { name: "test", path: process.cwd() },
      client: {} as any,
      $: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        return { stdout: "", stderr: "", exitCode: 0 }
      },
      serverUrl: "http://localhost:8080",
    }

    const plugin = await XpGatePlugin(mockInput)
    expect(plugin.tool).toBeDefined()
    expect(plugin.tool).toHaveProperty("gate-check")
    expect(plugin.tool).toHaveProperty("gate-principles")
    expect(plugin.tool).toHaveProperty("gate-arch")
  })

  it("gate-check tool has correct schema", async () => {
    const { XpGatePlugin } = await import("../index.js")
    const mockInput = {
      directory: process.cwd(),
      worktree: null,
      project: { name: "test", path: process.cwd() },
      client: {} as any,
      $: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
      serverUrl: "http://localhost:8080",
    }

    const plugin = await XpGatePlugin(mockInput)
    const gateCheck = plugin.tool["gate-check"]

    expect(gateCheck.description).toContain("quality")
    expect(gateCheck.args).toHaveProperty("path")
    expect(gateCheck.args).toHaveProperty("gates")
  })
})
```

**Step 4: Run test to verify it fails**

```bash
bun test plugins/opencode/__tests__/index.test.ts
```

Expected: FAIL (index.ts doesn't exist yet)

**Step 5: Write minimal implementation**

Create `plugins/opencode/index.ts`:

```typescript
import type { Plugin, tool } from "@opencode-ai/plugin"

export const XpGatePlugin: Plugin = async ({ directory, $ }) => {
  return {
    tool: {
      "gate-check": tool({
        description: "Run xp-gate quality checks on a file or directory (6 gates: code quality, duplicate code, complexity, principles, tests, architecture)",
        args: {
          path: tool.schema.string({
            description: "File or directory path to check",
          }),
          gates: tool.schema.array(tool.schema.string(), {
            description: "Specific gates to run (all gates if omitted): code-quality, dup-code, complexity, principles, tests, architecture",
          }),
        },
        async execute(args, context) {
          const { directory } = context
          const targetPath = args.path.startsWith("/") ? args.path : `${directory}/${args.path}`

          try {
            const gatesArg = args.gates ? ` --gates ${args.gates.join(",")}` : ""
            const result = await $`cd ${directory} && xp-gate-check ${targetPath}${gatesArg}`.catch(
              () => ({
                stdout: "xp-gate-check not found. Install xp-gate globally: npm install -g xp-gate",
                stderr: "",
              })
            )
            return result.stdout || result.toString()
          } catch (error: unknown) {
            return `Error running quality check: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        },
      }),
      "gate-principles": tool({
        description: "Run Clean Code + SOLID principles checker on a file (checks: function length, nesting depth, god class, parameters, naming, magic numbers)",
        args: {
          path: tool.schema.string({
            description: "File path to check",
          }),
        },
        async execute(args, context) {
          const { directory, $ } = context
          const targetPath = args.path.startsWith("/") ? args.path : `${directory}/${args.path}`

          try {
            const result = await $`npx -y tsx ${directory}/src/principles/index.ts --files ${targetPath} --format console`.catch(
              () => ({
                stdout: "Principles checker requires TypeScript and tsx.",
                stderr: "",
              })
            )
            return result.stdout || result.toString()
          } catch (error: unknown) {
            return `Error running principles check: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        },
      }),
      "gate-arch": tool({
        description: "Run architecture validation on source files (checks: layer boundaries, dependency direction, architectural rules)",
        args: {
          path: tool.schema.string({
            description: "Directory path to validate",
          }),
        },
        async execute(args, context) {
          const { directory, $ } = context
          const targetPath = args.path.startsWith("/") ? args.path : `${directory}/${args.path}`

          try {
            const result = await $`cd ${directory} && npm run check:arch -- --file ${targetPath}`.catch(
              () => ({
                stdout: "Architecture checker requires npm dependencies. Run: npm install",
                stderr: "",
              })
            )
            return result.stdout || result.toString()
          } catch (error: unknown) {
            return `Error running architecture check: ${error instanceof Error ? error.message : "Unknown error"}`
          }
        },
      }),
    },
  }
}
```

**Step 6: Run test to verify it passes**

```bash
bun test plugins/opencode/__tests__/index.test.ts
```

Expected: All 3 tests pass.

**Step 7: Verify TypeScript compilation**

```bash
bun run check
```

Expected: No TypeScript errors.

**Step 8: Commit**

```bash
git add plugins/opencode/
git commit -m "feat: add OpenCode plugin with 3 quality gate tools"
```

---

### Task 7: OpenCode Plugin - Skills Packaging

**Files:**
- Use `scripts/build-plugin.sh --platform opencode` (generic script from Task 5)
- Test: Build script copies all skills for OpenCode

**Step 1: Run build for OpenCode platform**

```bash
bash scripts/build-plugin.sh --platform opencode
```

Expected output: All 8 skills copied (sprint-flow, delphi-review, test-specification-alignment, ralph-loop, test-driven-development, improve-codebase-architecture, to-issues, admin-template-guidelines).

**Note (Delphi B-M3):** Uses the unified `build-plugin.sh` from Task 5 instead of a separate `build-opencode-plugin.sh`. Eliminates >95% code duplication per DRY principle.

---

### Task 8: Version Sync and NPM Integration

**Files:**
- Modify: `VERSION` file — bump from 0.3.2.0 to 0.4.0.0
- Modify: `src/npm-package/package.json` — bump version to 0.4.0
- Modify: `scripts/sync-version.sh` — verify plugin manifests sync
- Test: Version consistency across all artifacts

**Step 1: Write test for version consistency**

Create `scripts/__tests__/version-consistency.bats`:

```bash
#!/usr/bin/env bats

setup() {
  REPO_ROOT="$BATS_TEST_DIRNAME/../.."
}

@test "npm package version matches plugin.json" {
  NPM_VERSION=$(jq -r '.version' "$REPO_ROOT/src/npm-package/package.json")
  CLAUDE_VERSION=$(jq -r '.version' "$REPO_ROOT/plugins/claude-code/.claude-plugin/plugin.json")
  [ "$NPM_VERSION" = "$CLAUDE_VERSION" ]
}

@test "npm package version matches opencode plugin version" {
  NPM_VERSION=$(jq -r '.version' "$REPO_ROOT/src/npm-package/package.json")
  OPENCODE_VERSION=$(jq -r '.version' "$REPO_ROOT/plugins/opencode/package.json")
  [ "$NPM_VERSION" = "$OPENCODE_VERSION" ]
}

@test "VERSION file matches npm package (major.minor.micro)" {
  VERSION_RAW=$(cat "$REPO_ROOT/VERSION")
  VERSION_PREFIX=$(echo "$VERSION_RAW" | cut -d. -f1-3)
  NPM_VERSION=$(jq -r '.version' "$REPO_ROOT/src/npm-package/package.json")
  [ "$VERSION_PREFIX" = "$NPM_VERSION" ]
}
```

**Step 2: Run test to verify it fails**

```bash
bats scripts/__tests__/version-consistency.bats
```

Expected: FAIL (npm version is 0.3.2, plugin versions are 0.4.0)

**Step 3: Bump all versions to 0.4.0**

Update `VERSION` file: `0.4.0.0`

Update `src/npm-package/package.json`:
```json
{
  "name": "xp-gate",
  "version": "0.4.0",
  // ... rest unchanged
}

**Note (Delphi A-C2, C-C2):** Single source of truth is `VERSION` file (0.4.0.0). npm package and both plugin manifests sync to 0.4.0 (major.minor.micro). All three must match after this step.
```

Update `plugins/claude-code/.claude-plugin/plugin.json`:
```json
{
  "version": "0.4.0",
  // ... rest unchanged
}
```

Update `plugins/opencode/package.json`:
```json
{
  "version": "0.4.0",
  // ... rest unchanged
}
```

**Step 4: Update sync-version.sh to handle plugin manifests**

Modify `scripts/sync-version.sh` to include plugin version sync:

```bash
#!/bin/bash
# sync-version.sh: Sync version across all package.json files and plugin manifests
# Called by npm prepare and postinstall scripts

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# Determine version from src/npm-package/package.json
NPM_PACKAGE="$REPO_ROOT/src/npm-package/package.json"
if [ ! -f "$NPM_PACKAGE" ]; then
  echo "Warning: npm package.json not found, skipping version sync"
  exit 0
fi

VERSION=$(jq -r '.version' "$NPM_PACKAGE")
if [ -z "$VERSION" ] || [ "$VERSION" = "null" ]; then
  echo "Warning: Could not determine version from npm package.json"
  exit 0
fi

echo "Syncing version: $VERSION"

# Sync Claude Code plugin
CLAUDE_PLUGIN="$REPO_ROOT/plugins/claude-code/.claude-plugin/plugin.json"
if [ -f "$CLAUDE_PLUGIN" ]; then
  jq --arg v "$VERSION" '.version = $v' "$CLAUDE_PLUGIN" > "${CLAUDE_PLUGIN}.tmp" && \
  mv "${CLAUDE_PLUGIN}.tmp" "$CLAUDE_PLUGIN"
  echo "Updated: $CLAUDE_PLUGIN"
fi

# Sync OpenCode plugin
OPENCODE_PLUGIN="$REPO_ROOT/plugins/opencode/package.json"
if [ -f "$OPENCODE_PLUGIN" ]; then
  jq --arg v "$VERSION" '.version = $v' "$OPENCODE_PLUGIN" > "${OPENCODE_PLUGIN}.tmp" && \
  mv "${OPENCODE_PLUGIN}.tmp" "$OPENCODE_PLUGIN"
  echo "Updated: $OPENCODE_PLUGIN"
fi

echo "Version sync complete."
```

**Step 5: Run test to verify it passes**

```bash
bats scripts/__tests__/version-consistency.bats
```

Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/npm-package/package.json plugins/ scripts/sync-version.sh
git commit -m "chore: bump version to 0.4.0 and sync across all artifacts"
```

---

### Task 9: README Documentation

**Files:**
- Modify: `README.md` — add plugin installation section

**Step 1: Create plugin documentation section**

Add the following section to `README.md` before the "Web Dashboard" section:

```markdown
## Cross-Platform Plugins

XP-Gate v0.4.0+ supports both Claude Code and OpenCode plugins for IDE-integrated quality gates.

### Installation

**Option 1: npm Package (Git Hooks + Full Features)**

```bash
npm install -g xp-gate
xp-gate init          # Install git hooks to project
xp-gate setup-global  # Install git hooks globally
```

**Option 2: Claude Code Plugin (Global Skills + Event Hooks)**

```bash
# Install from GitHub
/plugin install boyingliu01/xp-gate

# Or from marketplace (when published)
/plugin install xp-gate@marketplace
```

Features:
- All 7 AI skills auto-loaded (`/sprint-flow`, `/delphi-review`, etc.)
- PostToolUse hooks run quality checks on Edit/Write
- Graceful degradation if xp-gate CLI not installed

**Option 3: OpenCode Plugin (Global Skills + Tools)**

Add to your `opencode.json`:
```json
{
  "plugin": ["xp-gate"]
}
```

Features:
- All 7 AI skills available in any project
- Custom tools: `/gate-check`, `/gate-principles`, `/gate-arch`
- Works with Bun runtime for fast execution

### Comparison

| Feature | npm Package | Claude Plugin | OpenCode Plugin |
|---------|:-----------:|:------------:|:--------------:|
| Git Hooks | ✅ | ❌ | ❌ |
| AI Skills | ✅ | ✅ | ✅ |
| IDE Integration | ❌ | ✅ | ✅ |
| Event-Based Gates | ❌ | ✅ | ✅ |
| Global Install | ✅ | ✅ | ✅ |

**Recommendation:** Use npm package for git hooks + plugin for IDE integration. Both work together seamlessly.
```

**Step 2: Verify README structure**

```bash
grep -n "## " README.md
```

Expected: Section order includes "Cross-Platform Plugins" before "Web Dashboard".

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add cross-platform plugin installation section to README"
```

---

### Task 10: Build Pipeline Integration

**Files:**
- Create: `package.json` scripts for plugin builds
- Modify: `scripts/build-claude-plugin.sh` and `scripts/build-opencode-plugin.sh`
- Test: `npm run build:plugins` produces both plugins

**Step 1: Add build scripts to root package.json**

Add to existing `scripts` section:

```json
{
  "scripts": {
    "build:claude": "bash scripts/build-claude-plugin.sh",
    "build:opencode": "bash scripts/build-opencode-plugin.sh",
    "build:plugins": "npm run build:claude && npm run build:opencode",
    "clean:plugins": "rm -rf plugins/claude-code/skills/* plugins/opencode/skills/*",
    "verify:plugins": "node -e \"const [claude, opencode] = ['plugins/claude-code/.claude-plugin/plugin.json', 'plugins/opencode/package.json'].map(f => require('./' + f).version); if (claude !== opencode) { process.exit(1); } console.log('Plugin versions match:', claude)\""
  }
}
```

**Step 2: Run build pipeline**

```bash
npm run build:plugins
```

Expected: Both plugins built successfully, all 14 skills copied.

**Step 3: Run verification**

```bash
npm run verify:plugins
```

Expected: `Plugin versions match: 0.4.0`

**Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add build pipeline scripts for both plugins"
```

---

### Task 11: Claude Plugin Installation Testing

**Files:**
- Create: `scripts/test-claude-plugin.sh`
- Test: Manual verification of plugin structure

**Step 1: Create test script**

Create `scripts/test-claude-plugin.sh`:

```bash
#!/bin/bash
# test-claude-plugin.sh: Verify Claude Code plugin structure
# Run: bash scripts/test-claude-plugin.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$SCRIPT_DIR/../plugins/claude-code"

echo "Testing Claude Code plugin structure..."

# Required files
REQUIRED_FILES=(
  ".claude-plugin/plugin.json"
  "hooks/hooks.json"
  "bin/xp-gate-check"
)

REQUIRED_SKILLS=(
  "sprint-flow"
  "delphi-review"
  "test-specification-alignment"
  "ralph-loop"
  "test-driven-development"
  "improve-codebase-architecture"
  "to-issues"
)

ERRORS=0

# Check required files
for file in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$PLUGIN_DIR/$file" ]; then
    echo "FAIL: Missing $file"
    ERRORS=$((ERRORS + 1))
  else
    echo "OK: $file"
  fi
done

# Check skills
for skill in "${REQUIRED_SKILLS[@]}"; do
  if [ ! -f "$PLUGIN_DIR/skills/$skill/SKILL.md" ]; then
    echo "FAIL: Missing skills/$skill/SKILL.md"
    ERRORS=$((ERRORS + 1))
  else
    echo "OK: skills/$skill/SKILL.md"
  fi
done

# Check plugin.json schema
PLUGIN_JSON=$(cat "$PLUGIN_DIR/.claude-plugin/plugin.json")
echo "$PLUGIN_JSON" | jq -e '.name, .version, .skills, .hooks' >/dev/null 2>&1 || {
  echo "FAIL: plugin.json missing required fields"
  ERRORS=$((ERRORS + 1))
}

# Check hooks.json schema
HOOKS_JSON=$(cat "$PLUGIN_DIR/hooks/hooks.json")
echo "$HOOKS_JSON" | jq -e '.hooks.PostToolUse' >/dev/null 2>&1 || {
  echo "FAIL: hooks.json missing PostToolUse hooks"
  ERRORS=$((ERRORS + 1))
}

# Summary
if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "FAILED: $ERRORS checks failed"
  exit 1
else
  echo ""
  echo "PASSED: All checks passed"
  exit 0
fi
```

**Step 2: Make executable and run**

```bash
chmod +x scripts/test-claude-plugin.sh
bash scripts/test-claude-plugin.sh
```

Expected: `PASSED: All checks passed`

**Step 3: Commit**

```bash
git add scripts/test-claude-plugin.sh
git commit -m "test: add Claude Code plugin structure verification script"
```

---

### Task 12: OpenCode Plugin Type Checking Integration

**Files:**
- Create: `plugins/opencode/tsconfig.json`
- Test: TypeScript compilation in opencode plugin

**Step 1: Create tsconfig.json (if not already created in Task 6)**

Create `plugins/opencode/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "outDir": "dist"
  },
  "include": ["index.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 2: Install dependencies and check types**

```bash
cd plugins/opencode && bun install && bun run check
```

Expected: No TypeScript errors.

**Step 3: Add to build pipeline**

Update `scripts/build-opencode-plugin.sh` to include type checking:

Add before the skills copy section:

```bash
# Run TypeScript check
echo "Running TypeScript type check..."
cd "$PLUGIN_DIR" && bun run check || {
  echo "TypeScript check failed. Please fix type errors before building."
  exit 1
}

# Return to repo root
cd "$REPO_ROOT"
```

**Step 4: Run full build**

```bash
npm run build:plugins
```

Expected: Both plugins build successfully, TS check passes.

**Step 5: Commit**

```bash
git add plugins/opencode/ scripts/build-opencode-plugin.sh
git commit -m "feat: add TypeScript type checking to OpenCode plugin build"
```

---

### Task 13: Full Integration Test

**Files:**
- Create: `scripts/test-integration.sh`
- Test: All plugins build, verify, and structure checks pass

**Step 1: Create integration test script**

Create `scripts/test-integration.sh`:

```bash
#!/bin/bash
# test-integration.sh: Full integration test for cross-platform plugins
# Run: bash scripts/test-integration.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo "XP-Gate Cross-Platform Plugin Integration Test"
echo "========================================"
echo ""

ERRORS=0

# Step 1: Build plugins
echo "Step 1: Building plugins..."
if bash "$SCRIPT_DIR/build-claude-plugin.sh" && bash "$SCRIPT_DIR/build-opencode-plugin.sh"; then
  echo "✅ Build successful"
else
  echo "❌ Build failed"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# Step 2: Verify versions
echo "Step 2: Checking version consistency..."
NPM_VERSION=$(jq -r '.version' "$REPO_ROOT/src/npm-package/package.json")
CLAUDE_VERSION=$(jq -r '.version' "$REPO_ROOT/plugins/claude-code/.claude-plugin/plugin.json")
OPENCODE_VERSION=$(jq -r '.version' "$REPO_ROOT/plugins/opencode/package.json")

if [ "$NPM_VERSION" = "$CLAUDE_VERSION" ] && [ "$NPM_VERSION" = "$OPENCODE_VERSION" ]; then
  echo "✅ Versions match: $NPM_VERSION"
else
  echo "❌ Version mismatch: npm=$NPM_VERSION claude=$CLAUDE_VERSION opencode=$OPENCODE_VERSION"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# Step 3: Verify Claude plugin structure
echo "Step 3: Verifying Claude plugin structure..."
if bash "$SCRIPT_DIR/test-claude-plugin.sh"; then
  echo "✅ Claude plugin structure valid"
else
  echo "❌ Claude plugin structure invalid"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# Step 4: Verify OpenCode plugin structure
echo "Step 4: Verifying OpenCode plugin structure..."
if [ -f "$REPO_ROOT/plugins/opencode/index.ts" ] && [ -f "$REPO_ROOT/plugins/opencode/package.json" ]; then
  echo "✅ OpenCode plugin files present"
else
  echo "❌ OpenCode plugin files missing"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# Step 5: Check skill count
CLAUDE_SKILL_COUNT=$(find "$REPO_ROOT/plugins/claude-code/skills" -name "SKILL.md" | wc -l | tr -d ' ')
OPENCODE_SKILL_COUNT=$(find "$REPO_ROOT/plugins/opencode/skills" -name "SKILL.md" | wc -l | tr -d ' ')

echo "Step 5: Checking skill counts..."
echo "  Claude Code plugins: $CLAUDE_SKILL_COUNT skills"
echo "  OpenCode plugins: $OPENCODE_SKILL_COUNT skills"

if [ "$CLAUDE_SKILL_COUNT" -eq 7 ] && [ "$OPENCODE_SKILL_COUNT" -eq 7 ]; then
  echo "✅ All 7 skills in both plugins"
else
  echo "❌ Skill count mismatch"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# Summary
echo "========================================"
if [ "$ERRORS" -eq 0 ]; then
  echo "✅ PASSED: All integration tests passed"
  exit 0
else
  echo "❌ FAILED: $ERRORS checks failed"
  exit 1
fi
```

**Step 2: Make executable and run**

```bash
chmod +x scripts/test-integration.sh
bash scripts/test-integration.sh
```

Expected output:
```
========================================
XP-Gate Cross-Platform Plugin Integration Test
========================================

Step 1: Building plugins...
✅ Build successful

Step 2: Checking version consistency...
✅ Versions match: 0.4.0

Step 3: Verifying Claude plugin structure...
✅ Claude plugin structure valid

Step 4: Verifying OpenCode plugin structure...
✅ OpenCode plugin files present

Step 5: Checking skill counts...
  Claude Code plugins: 7 skills
  OpenCode plugins: 7 skills
✅ All 7 skills in both plugins

========================================
✅ PASSED: All integration tests passed
```

**Step 3: Add to package.json scripts**

Add to root package.json scripts:
```json
"test:integration": "bash scripts/test-integration.sh"
```

**Step 4: Commit**

```bash
git add scripts/test-integration.sh package.json
git commit -m "test: add full integration test for cross-platform plugins"
```

---

### Task 14: Backward Compatibility Verification

**Files:**
- Test: Existing npm package installation path unchanged
- Verify: No changes to githooks/ directory

**Step 1: Verify git hooks unchanged**

```bash
git diff --stat HEAD~14 -- githooks/
```

Expected: No changes (empty output).

**Step 2: Verify npm package structure unchanged**

```bash
# Check that all files referenced in package.json 'files' array still exist
for dir in bin hooks adapters lib; do
  if [ -d "src/npm-package/$dir" ]; then
    echo "OK: $dir directory exists"
  else
    echo "FAIL: $dir directory missing"
    exit 1
  fi
done
```

Expected: All directories present.

**Step 3: Run existing tests**

```bash
# Run existing npm package tests if any
cd source/npm-package && npm test
```

Expected: All existing tests pass.

**Step 4: Verify quality gates still work**

```bash
# Make a trivial change and commit
echo "// test" >> src/npm-package/lib/detect-deps.js
git add src/npm-package/lib/detect-deps.js
git commit -m "test: verify quality gates still work"
```

Expected: All 6 gates pass (same as before).

**Step 5: Revert test change**

```bash
git revert HEAD
```

**Step 6: Commit (if verification passed)**

```bash
# If all checks passed, commit the verification note
echo "Verified: v0.4.0 maintains backward compatibility with v0.3.x installation" >> docs/COMPATIBILITY.md
git add docs/COMPATIBILITY.md
git commit -m "docs: add backward compatibility verification for v0.4.0"
```

---

### Task 15: Final Review and Release Preparation

**Files:**
- Create: `docs/plans/2026-05-29-xp-gate-plugin-release-checklist.md`
- Verify: All success criteria met

**Step 1: Create release checklist**

Create `docs/plans/2026-05-29-xp-gate-plugin-release-checklist.md`:

```markdown
# XP-Gate v0.4.0 Release Checklist

## Plugin Artifacts
- [ ] Claude Code plugin builds successfully (`npm run build:claude`)
- [ ] OpenCode plugin builds successfully (`npm run build:opencode`)
- [ ] Both contain all 7 SKILL.md files
- [ ] plugin.json has correct version (0.4.0)
- [ ] OpenCode plugin TypeScript compiles without errors
- [ ] All integration tests pass (`npm run test:integration`)

## Backward Compatibility
- [ ] npm package structure unchanged
- [ ] Git hooks work identically to v0.3.x
- [ ] Existing `xp-gate init` still functions
- [ ] `xp-gate install-skill` still works
- [ ] All existing gate tests pass

## Documentation
- [ ] README updated with plugin installation instructions
- [ ] Design document complete
- [ ] Plugin comparison table accurate
- [ ] Installation examples tested

## Distribution
- [ ] npm package ready to publish to GitHub Packages
- [ ] Claude Code plugin ready for GitHub marketplace submission
- [ ] OpenCode plugin ready for npm publication as `@xp-gate/opencode-plugin`
```

**Step 2: Run final verification**

```bash
npm run test:integration
```

Expected: All tests pass.

**Step 3: Review git log**

```bash
git log --oneline -20
```

Expected: Clean commit history with one commit per task.

**Step 4: Final commit**

```bash
git add docs/plans/2026-05-29-xp-gate-plugin-release-checklist.md
git commit -m "docs: add v0.4.0 release checklist"
```

---

## Summary

This plan consists of 15 tasks that build the cross-platform plugin system incrementally:

1. **Tasks 1-3:** Claude Code plugin foundation (manifest, hooks, bin wrapper)
2. **Tasks 4-5:** Skill copy infrastructure and Claude packaging
3. **Tasks 6-7:** OpenCode plugin TypeScript module and skill packaging
4. **Tasks 8-10:** Version sync and build pipeline integration
5. **Tasks 11-13:** Testing scripts for both plugins
6. **Tasks 14-15:** Backward compatibility verification and release prep

**Total estimated time:** 2-3 hours (assuming familiarity with both plugin systems)

**Key principles followed:**
- **DRY:** Shared skill files, not duplicated
- **YAGNI:** No unnecessary abstractions (separate build scripts, not a unified "builder")
- **TDD:** Tests written before implementations
- **Frequent commits:** One commit per task, atomic and revertible