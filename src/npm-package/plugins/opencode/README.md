# XP-Gate OpenCode Plugin

OpenCode plugin exposing xp-gate quality gates and AI workflow skills.

## Tools

- **gate-check**: Run all 6 quality gates on a file/directory
- **gate-principles**: Run Clean Code + SOLID principles checker
- **gate-arch**: Run architecture validation

## Installation

In your `opencode.json`:

```json
{
  "plugin": ["@xp-gate/opencode-plugin"]
}
```

Or via local path (development):

```json
{
  "plugin": ["./plugins/opencode"]
}
```

## Requirements

- OpenCode v0.11+
- xp-gate npm package installed globally (for `gate-check` tool)
- Repository with `src/principles/index.ts` (for `gate-principles` tool)
- `architecture.yaml` in repo root (for `gate-arch` tool)

## Graceful Degradation

If xp-gate CLI is unavailable, tools return helpful install instructions instead of failing.
