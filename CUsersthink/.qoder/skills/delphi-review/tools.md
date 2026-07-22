# Tools Whitelist — Delphi Review

Delphi Review is a **read-only review skill** that dispatches expert subagents
and synthesizes their verdicts. It does NOT implement code changes.

## Allowed Tools

| Tool | Usage | Rationale |
|------|-------|-----------|
| `Read` | Read design docs, code, configs, specification.yaml | Required for review input analysis |
| `Glob` | Find files by pattern | Required for context discovery |
| `Grep` | Search code content | Required for codebase understanding |
| `Bash` | Read-only: git diff, git log, file stats | Required for change analysis |
| `Task(subagent_type=oracle)` | Dispatch oracle for deep analysis | Required for complex review questions |
| `Task(subagent_type=delphi-reviewer-architecture)` | Dispatch architecture expert | Core Delphi expert dispatch |
| `Task(subagent_type=delphi-reviewer-technical)` | Dispatch technical expert | Core Delphi expert dispatch |
| `Task(subagent_type=delphi-reviewer-feasibility)` | Dispatch feasibility expert | Core Delphi expert dispatch |
| `Write(specification.yaml, .code-walkthrough-result.json, delphi-reviewed.json)` | Write output artifacts only | Required for review output persistence |
| `Skill` | Invoke related skills for context | Required for cross-skill integration |
| `Question` | Ask user at decision points | Required for user interaction |

## Denied Tools

| Tool | Rationale |
|------|-----------|
| `Edit(source code)` | Delphi review NEVER edits implementation code during review |
| `Write(source code)` | Delphi review NEVER writes implementation code |
| `Bash(git commit, git push)` | Delphi review NEVER commits or pushes during review |
| `Task(category=*, subagent_type=build)` | Delphi review NEVER delegates build/implementation tasks |
