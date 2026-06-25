# Biome `useLiteralKeys` vs TypeScript `TS4111` Conflict Resolution

**Date:** 2026-06-25
**Sprint ID:** sprint-2026-06-25-04
**Issue:** #250

---

## 1. Problem

When a TypeScript project uses both Biome (with `useLiteralKeys` enabled) and TypeScript strict mode, two rules conflict on `Record<string, unknown>` (or any index signature type):

| Tool | Rule | Requirement |
|------|------|-------------|
| **Biome** | `useLiteralKeys` | Use `obj.name` instead of `obj['name']` |
| **TypeScript** | `TS4111` | Use `obj['name']` — dot access rejected on index signatures |

Both rules are individually correct, but they conflict in real-world patterns like ORM update data and HTTP request bodies.

## 2. Solution

**Documentation-first approach**: Add guidance in xp-gate's adapter and documentation, providing a pre-built `biome.json` configuration snippet users can adopt.

### 2.1 TypeScript Adapter Enhancement

Add Biome detection to `githooks/adapters/typescript.sh`:

- New `run_biome_lint()` function — runs `npx biome lint` if biome is available
- When biome reports `useLiteralKeys` on a file AND `tsc --noEmit` reports `TS4111` on the same file → emit **advisory warning** pointing to docs (does NOT block commit)
- Biome tool missing → SKIP (same as other tools)

### 2.2 Pre-commit Enhancement

In `githooks/pre-commit` Gate 1 section:
- After ESLint config detection block, add a Biome config detection block
- If no `biome.json`/`biome.jsonc` found but `@biomejs/biome` in package.json → emit advisory warning

### 2.3 Documentation

Add `docs/biome-configuration.md` with:
- Explanation of the conflict
- Recommended `biome.json` configuration overrides
- Project-level vs repository-level guidance

### 2.4 Recommended Configuration Template

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "linter": {
    "rules": {
      "complexity": {
        "useLiteralKeys": "off"
      }
    }
  }
}
```

Alternative: Users can use `// biome-ignore lint/complexity/useLiteralKeys` for targeted suppression.

## 3. Changes

| File | Change |
|------|--------|
| `githooks/adapters/typescript.sh` | Add `run_biome_lint()` function |
| `githooks/pre-commit` | Add Biome config detection block (Gate 1 section) |
| `docs/biome-configuration.md` | New: conflict explanation + config template |

## 4. Acceptance Criteria

- [ ] `githooks/adapters/typescript.sh` has `run_biome_lint()` function
- [ ] `githooks/pre-commit` detects Biome in package.json without config → emits advisory warning
- [ ] `docs/biome-configuration.md` exists with config snippet
- [ ] All existing tests pass (no behavior change for non-Biome projects)
- [ ] Biome missing → graceful SKIP (no block)

## 5. Out of Scope

- Automatic `biome.json` generation
- Automatic rule downgrading
- Upstream Biome contributions
- Any change to xp-gate's own linting configuration (this project does not use Biome)
