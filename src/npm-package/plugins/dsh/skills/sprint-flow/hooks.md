# Hooks — Sprint Flow

Sprint Flow integrates with safety and operational hooks to protect the development environment.

## Security Hooks

| Hook | Purpose | Activation |
|------|---------|------------|
| `/careful` | Safety guardrails for destructive commands | Activate before any `rm`, `force-push`, or `git reset` |
| `/freeze` | Restrict edits to sprint worktree directory | Prevent accidental changes outside sprint scope |
| `/guard` | Full safety mode (careful + freeze) | Maximum protection for high-risk operations |

## Operational Hooks

| Hook | Purpose | Activation |
|------|---------|------------|
| `/context-save` | Save sprint context before pause or handoff | Before pausing sprint or switching tasks |
| `/context-restore` | Restore sprint context on resume | When resuming from pause or handoff |
