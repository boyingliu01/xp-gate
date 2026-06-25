# Biome Configuration Guide

## `useLiteralKeys` vs `TS4111` Conflict

When a TypeScript project uses both Biome (with `useLiteralKeys` enabled) and TypeScript strict mode, two rules pull in opposite directions on `Record<string, unknown>` and index-signature types:

| Tool | Rule | Requirement | Reason |
|------|------|-------------|--------|
| **Biome** | `useLiteralKeys` | `obj.name` | Syntactic simplicity — string literal keys should use dot notation |
| **TypeScript** | `TS4111` | `obj['name']` | Type safety — index signature types don't declare explicit properties |

### Example of the Conflict

```typescript
// Common pattern: ORM update data, HTTP request bodies
const data: Record<string, unknown> = { updatedBy: 'admin' };

data['name'] = input.name;
//    ^ Biome flags: useLiteralKeys — can simplify to dot notation
//    ^ TypeScript requires bracket notation (TS4111 if you use dot)

data.name = input.name;
//    ^ TypeScript rejects: TS4111 Property 'name' comes from an index signature
//    ^ Biome wants this
```

## Solution

**Recommended:** Disable the `useLiteralKeys` rule in your `biome.json`. This is the simplest fix and does not affect other Biome linting rules.

### Option 1: Global Override (Recommended)

Create or update `biome.json`:

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

### Option 2: Targeted Suppression (Per-Line)

Use biome-ignore comments for specific occurrences:

```typescript
// biome-ignore lint/complexity/useLiteralKeys: Record<string,unknown> requires bracket notation
data['name'] = input.name;
```

### Option 3: File-Level Suppression

Disable the rule for specific files:

```json
{
  "linter": {
    "rules": {
      "complexity": {
        "useLiteralKeys": "off"
      }
    }
  },
  "overrides": [
    {
      "include": ["src/api/*.ts"],
      "linter": {
        "rules": {
          "complexity": {
            "useLiteralKeys": "off"
          }
        }
      }
    }
  ]
}
```

## Why XP-Gate Doesn't Block This

XP-Gate's philosophy: tools serve developers, not the other way around. When two valid tools produce conflicting guidance on the same code, xp-gate **warns but does not block** — both rules are correct in their context, and the developer is the final authority on which to follow.

The TypeScript adapter will:
1. Run `biome lint` if Biome is installed (graceful SKIP if not)
2. Detect the `useLiteralKeys` + `TS4111` conflict pattern
3. Emit an advisory warning with a link to this document

## Related

- [Biome `useLiteralKeys` rule](https://biomejs.dev/linter/rules/use-literal-keys/)
- [TypeScript `TS4111`](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-0.html#property-access-errors-with-index-types)
