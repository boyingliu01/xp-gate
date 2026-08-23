# @boyingliu01/dsh-plugin-xp-gate

XP-Gate deterministic quality gates + AI workflow skills as a **DeepSeek Harness (DSH)** native plugin.

## Tools

| Tool | Purpose |
|------|---------|
| `gate-check` | Run XP-Gate quality gates (`xp-gate check`) on a file or directory |
| `gate-principles` | Run the 14 Clean Code/SOLID rules (`xp-gate principles`, Gate 4) |
| `gate-arch` | Run architecture validation (`xp-gate arch`, Gate 6) |

## Install

```bash
dsh plugin --profile <name> add @boyingliu01/dsh-plugin-xp-gate
```

The tools require a global `xp-gate` CLI:

```bash
npm install -g @boyingliu01/xp-gate
```

When `xp-gate` is missing the tools degrade gracefully (tool-missing → SKIP-style message) rather than erroring.