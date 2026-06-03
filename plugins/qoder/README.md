# XP-Gate Qoder Plugin

Qoder IDE plugin exposing xp-gate quality gates, AI workflow skills, and visual dashboards.

## Skills (8 AI Workflow Skills)

| Skill | Trigger | Description |
|-------|---------|-------------|
| sprint-flow | `/sprint-flow "需求"` | 7-phase pipeline: THINK→PLAN→BUILD→REVIEW→ACCEPT→FEEDBACK→SHIP |
| delphi-review | `/delphi-review` | Multi-expert anonymous consensus review (design + code-walkthrough) |
| test-specification-alignment | `/test-specification-alignment` | 2-phase test-spec verification |
| ralph-loop | Via sprint-flow Phase 2 | REQ-level iterative build (saves 40-67% tokens) |
| test-driven-development | `/test-driven-development` | TDD enforcement (RED→GREEN→REFACTOR) |
| improve-codebase-architecture | `/improve-codebase-architecture` | Architecture health checks |
| to-issues | `/to-issues` | Vertical slice issue splitting |
| admin-template-guidelines | Via sprint-flow BUILD | 6 maintainability rules for admin templates |

## Qoder-Specific Enhancements

- **genui Widgets**: Quality report dashboard and Sprint status board (via `show_widget`)
- **CodeReview Subagent**: Deep integration for Phase 2 blind review and Phase 3 code walkthrough
- **browser-use MCP**: Phase 3 browser automation testing (replaces gstack/browse)
- **Memory System**: Learnings persistence via Qoder's built-in memory (replaces gstack/learn)
- **Canvas Output**: Architecture relationship diagrams (via `.canvas.tsx`)

## Installation

### Option 1: User-Level (Global, All Projects)

```bash
# Via xp-gate CLI
xp-gate install-skill sprint-flow --platform qoder --global
xp-gate install-skill delphi-review --platform qoder --global

# Or via install script (all 8 skills)
bash scripts/install-qoder-skills.sh --global
# Installs to: ~/.qoder/skills/
```

### Option 2: Project-Level (Current Project Only)

```bash
# Via install script
bash scripts/install-qoder-skills.sh --local
# Installs to: .qoder/skills/

# Or via build script
bash scripts/build-plugin.sh --platform qoder
```

### Option 3: Build from Source

```bash
npm run build:qoder-plugin
# Produces plugins/qoder/ with all skills + widgets
```

## Requirements

- Qoder IDE
- xp-gate npm package installed globally (for git hooks: `npm install -g @boyingliu01/xp-gate && xp-gate init`)
- Node.js ≥ 18 (for principles checker)

## Pre-Edit Gate (Replaces Claude Code Hooks)

Qoder does not have file-system event hooks like Claude Code's `PreToolUse`/`PostToolUse`. Instead, xp-gate skills embed **mandatory pre-edit checks** in their SKILL.md instructions:

- **Delphi Gate**: Before any code edit in Phase 2+, skill verifies `.sprint-state/delphi-reviewed.json` verdict is `APPROVED`
- **Principles Check**: After each REQ completion, skill runs principles checker via terminal

## Graceful Degradation

If xp-gate CLI is unavailable, skills provide helpful install instructions instead of failing. Quality gates still run via git hooks (pre-commit) at commit time.

## Comparison with Other Platforms

| Feature | Claude Code | OpenCode | Qoder |
|---------|:-----------:|:--------:|:-----:|
| AI Skills (8) | ✅ | ✅ | ✅ |
| Git Hooks | ❌ (separate npm) | ❌ (separate npm) | ❌ (separate npm) |
| Event Hooks | ✅ PreToolUse/PostToolUse | ✅ tool() | ❌ (skill-embedded) |
| Custom Tools | ❌ | ✅ 3 tools | ❌ (MCP instead) |
| Widget UI | ❌ | ❌ | ✅ genui |
| Canvas Output | ❌ | ❌ | ✅ .canvas.tsx |
| Memory System | ❌ | ❌ | ✅ UpdateMemory |
| CodeReview Agent | ❌ | ❌ | ✅ subagent |
| Browser MCP | ❌ | ❌ | ✅ browser-use |
