# Hooks — Delphi Review

Delphi Review integrates with safety and operational hooks to ensure review integrity
and context preservation.

## Security Hooks

| Hook | Purpose | Activation |
|------|---------|------------|
| `/careful` | Safety guardrails for destructive commands | Ensure review is read-only — block any destructive operations |
| `/freeze` | Restrict edits to review scope | Prevent accidental changes during review |
| `/guard` | Full safety mode (careful + freeze) | Maximum protection — read-only review with no accidental edits |

## Operational Hooks

| Hook | Purpose | Activation |
|------|---------|------------|
| `/context-save` | Save review context before pause or handoff | Before pausing review or switching tasks |
| `/context-restore` | Restore review context on resume | When resuming review from pause or handoff |
