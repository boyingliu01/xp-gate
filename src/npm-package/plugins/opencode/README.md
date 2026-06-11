# XP-Gate OpenCode Plugin

OpenCode plugin exposing xp-gate quality gates and AI workflow skills.

## Tools

These three tools are **dual-surface**: callable both as OpenCode tools (from
inside an OpenCode session) and as `xp-gate` CLI subcommands (from any shell).
Both paths produce identical output. See repo README for the matching CLI table.

- **gate-check** ⇄ `xp-gate check <path>`: Run user-invokable quality gates
  (Gate 4 Principles + Gate 6 Architecture) on a file or directory.
- **gate-principles** ⇄ `xp-gate principles <path>`: Run Clean Code + SOLID
  principles checker (Gate 4 standalone).
- **gate-arch** ⇄ `xp-gate arch`: Run architecture validation (Gate 6
  standalone, layer boundary checks).

> Earlier docs said "all 6 quality gates" — that was inaccurate. `gate-check`
> intentionally runs only the two user-invokable gates (Principles + Arch); the
> full 10-gate pre-commit suite (Gate 0-9) is enforced by `xp-gate init`'s git
> hooks, not by this tool. Fixes #208.

## Installation

In your `opencode.json`:

```json
{
  "plugin": ["@boyingliu01/opencode-plugin"]
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
- One of:
  - `xp-gate` CLI installed globally (`npm install -g @boyingliu01/xp-gate`) — **preferred**, or
  - the xp-gate repo checked out locally with `src/principles/index.ts` reachable — **fallback** (the tool will shell out via `npx -y tsx`)
- `architecture.yaml` in repo root (for `gate-arch` only)

## Graceful Degradation

Every tool runs a chained shell-out: it first tries `xp-gate <subcommand>` and,
only if that's not on `PATH`, falls back to invoking the underlying checker
source directly. If both paths fail, the tool returns install instructions
instead of throwing.
