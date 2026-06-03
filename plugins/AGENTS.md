# PLUGINS KNOWLEDGE BASE

**Generated:** 2026-05-30
**Version:** v0.4.0+

## OVERVIEW
Cross-platform plugin system for Claude Code, OpenCode, and Qoder — shared skills, platform-specific hooks and tooling.

## STRUCTURE
```
plugins/
├── claude-code/
│   ├── .claude-plugin/plugin.json  # Manifest: skills + hooks paths
│   ├── hooks/hooks.json            # PreToolUse/PostToolUse/Stop hooks
│   ├── bin/
│   │   ├── xp-gate-check           # PostToolUse: principles check (graceful degradation)
│   │   └── delphi-review-guard.sh  # PreToolUse: blocks Edit/Write before delphi APPROVED
│   └── skills/                     # Auto-populated by build-plugin.sh (7 skills)
├── opencode/
│   ├── index.ts                    # Plugin entry: 3 tools (gate-check, gate-principles, gate-arch)
│   ├── package.json                # @opencode-ai/plugin dependency
│   ├── tsconfig.json               # ESNext + bundler moduleResolution
│   └── skills/                     # Auto-populated (same as claude-code)
├── qoder/
│   ├── README.md                   # Qoder installation guide
│   ├── AGENTS.md                   # Qoder plugin knowledge base
│   ├── widgets/                    # genui Widget templates
│   │   ├── quality-report.html     # Quality report dashboard
│   │   └── sprint-dashboard.html   # Sprint state dashboard
│   └── skills/                     # Auto-populated (8 skills, includes admin-template-guidelines)
└── shared/                         # Common documentation
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Claude manifest | claude-code/.claude-plugin/plugin.json | Skills + hooks reference |
| Claude hooks | claude-code/hooks/hooks.json | PreToolUse (delphi guard), PostToolUse (principles), Stop |
| Delphi guard | claude-code/bin/delphi-review-guard.sh | Reads .sprint-state/delphi-reviewed.json |
| Principles check | claude-code/bin/xp-gate-check | Always exits 0 (non-blocking) |
| OpenCode entry | opencode/index.ts | tool() helper from @opencode-ai/plugin |
| Build script | ../scripts/build-plugin.sh | --platform claude-code\|opencode\|qoder |
| Copy skills | ../scripts/copy-skills.sh | cp -r entire skill dirs (preserves refs/templates) |

## CONVENTIONS
- Plugin skills auto-populated by build script — never edit skills/ directly
- Claude hooks use bash wrappers with graceful degradation (exit 0 if CLI missing)
- OpenCode uses TypeScript with @opencode-ai/plugin API
- Both platforms share same SKILL.md files (copy-skills.sh duplicates them)

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT edit plugin skills/ directly — rebuild from source via build-plugin.sh
- Do NOT assume xp-gate CLI is installed — plugins must degrade gracefully
- Do NOT mix platform-specific logic in shared/ directory

## UNIQUE STYLES
- Claude Code: JSON manifest + bash hooks + bin wrapper (no TypeScript compilation)
- OpenCode: TS module with tool() helper (bundled via bun build)
- Qoder: SKILL.md auto-discovery + genui Widget templates + Memory integration
- Graceful degradation: plugins work even without xp-gate CLI installed
- Shared skill source: one SKILL.md → copied to all three platforms

## COMMANDS
```bash
# Build plugins
npm run build:plugins                    # Build all three platforms
bash scripts/build-plugin.sh --platform claude-code  # Single platform
bash scripts/build-plugin.sh --platform opencode
bash scripts/build-plugin.sh --platform qoder

# Test plugins
bash scripts/test-plugins.sh             # Integration tests (3 platforms)

# Install Claude plugin
/plugin install boyingliu01/xp-gate      # From GitHub

# Install OpenCode plugin
# opencode.json: { "plugin": ["./plugins/opencode"] }

# Install Qoder plugin
bash scripts/install-qoder-skills.sh --global  # User-level
bash scripts/install-qoder-skills.sh --local   # Project-level
```

## NOTES
- v0.4.0+: Plugin system introduced (Claude Code + OpenCode)
- v0.6.0+: Qoder plugin added (8 skills + widget templates + Memory integration)
- Claude plugin: 7 skills (sprint-flow, delphi-review, test-specification-alignment, ralph-loop, test-driven-development, improve-codebase-architecture, to-issues)
- OpenCode plugin: 3 tools (gate-check, gate-principles, gate-arch)
- Qoder plugin: 8 skills (same 7 + admin-template-guidelines) + 2 widget templates
- build-plugin.sh validates 7 expected skills (8 for Qoder) in output
- test-plugins.sh: integration tests — JSON validity, versions, builds, packaging, graceful degradation, widget templates, platform constraints
