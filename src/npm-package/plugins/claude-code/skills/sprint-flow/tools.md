# Tools Whitelist — Sprint Flow

Sprint Flow is an **orchestration skill** that coordinates subagents and system commands.
It does NOT implement code directly — it delegates implementation to subagents.

## Allowed Tools

| Tool | Usage | Rationale |
|------|-------|-----------|
| `Bash(git, gh, npm, node)` | git worktree/branch/commit, gh PR/release, npm/node CLI | Required for sprint infrastructure management |
| `Read` | Read project files, configs, docs | Required for context gathering |
| `Write` | Write sprint-state, specification.yaml, phase summaries | Required for sprint state persistence |
| `Edit` | Edit sprint-state, CHANGELOG, VERSION | Required for version management |
| `Glob` | Find project files by pattern | Required for project discovery |
| `Grep` | Search file contents | Required for codebase understanding |
| `Task` | Delegate to subagents (quick, deep, unspecified-high) | Core orchestration mechanism |
| `Skill` | Invoke integrated skills (brainstorming, autoplan, delphi-review, etc.) | Required for skill chain execution |
| `TodoWrite` | Track sprint progress | Required for progress visibility |
| `Question` | Ask user at decision gates | Required for user decision points |

## Denied Tools

| Tool | Rationale |
|------|-----------|
| `rm -rf (any recursive force remove)` | Destructive — sprint flow only cleans up via `git worktree remove` |
| `git push --force` | Destructive — never force push during sprint |
| `DROP TABLE or destructive DB operations` | Destructive — sprint flow orchestrates, does not manage databases |
| `Write(source code)` | Sprint flow NEVER writes implementation code directly — delegates to subagents via `Task` |
| `Edit(source code)` | Sprint flow NEVER edits implementation code — delegates to subagents via `Task` |
