# QODER PLUGIN KNOWLEDGE BASE

**Generated:** 2026-06-03
**Version:** v0.6.0

## OVERVIEW
Cross-platform plugin for Qoder IDE — shared skills, Qoder-specific enhancements (genui widgets, Canvas, Memory, CodeReview subagent, browser-use MCP). No hooks.json (Qoder uses skill-embedded gates instead of file-system event hooks).

## STRUCTURE
```
plugins/qoder/
├── README.md                      # Installation and usage guide
├── AGENTS.md                      # This knowledge base
├── skills/                        # Auto-populated by build-plugin.sh (8 skills)
│   ├── sprint-flow/SKILL.md       # 7-phase pipeline + Qoder Pre-Edit Gate + Agent mapping
│   ├── delphi-review/SKILL.md     # Multi-expert consensus + Qoder multi-model adaptation
│   ├── test-specification-alignment/SKILL.md  # 2-phase test-spec verification
│   ├── ralph-loop/SKILL.md        # REQ-level iterative build + Memory integration
│   ├── test-driven-development/SKILL.md       # TDD enforcement (zero modification)
│   ├── improve-codebase-architecture/SKILL.md # Architecture health + Canvas output
│   ├── to-issues/SKILL.md         # Vertical slice issue splitting (zero modification)
│   └── admin-template-guidelines/SKILL.md     # 6 maintainability rules (zero modification)
├── widgets/                       # genui show_widget templates
│   ├── quality-report.html        # Quality gate report dashboard
│   └── sprint-dashboard.html      # Sprint status board
└── references/
    └── qoder-adaptation.md        # Platform differences and adaptation rules
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Installation | README.md | User-level (~/.qoder/skills/) and project-level (.qoder/skills/) |
| Skill adaptations | skills/*/SKILL.md | Qoder-specific paragraphs marked with "Qoder" header |
| Pre-Edit Gate | skills/sprint-flow/SKILL.md | Replaces Claude Code's delphi-review-guard.sh hook |
| Multi-model review | skills/delphi-review/references/qoder-multi-model.md | Expert→model mapping via Qoder Agent subagents |
| Agent dispatch | skills/sprint-flow/SKILL.md | Phase→Qoder Agent mapping table |
| External skill fallback | skills/sprint-flow/references/qoder-adaptation.md | superpowers/gstack replacements |
| Quality widget | widgets/quality-report.html | genui show_widget template for Phase 3 results |
| Sprint widget | widgets/sprint-dashboard.html | genui show_widget template for sprint status |
| Memory integration | skills/ralph-loop/SKILL.md | UpdateMemory for permanent/contextual learnings |
| CodeReview | skills/sprint-flow/SKILL.md | Phase 2 step 4 + Phase 3 code walkthrough |
| Browser MCP | skills/sprint-flow/references/qoder-adaptation.md | browser-use replaces gstack/browse |

## CONVENTIONS
- Plugin skills auto-populated by build-plugin.sh --platform qoder — never edit plugins/qoder/skills/ directly
- Qoder-specific skill modifications live in source skills/ directory (marked with "## Qoder" sections)
- No hooks.json — Qoder lacks file-system event hooks; gates embedded in skill instructions
- genui widgets use show_widget MCP tool with widget_path template mode
- Memory system replaces gstack/learn for learnings persistence
- CodeReview subagent replaces superpowers/requesting-code-review
- browser-use MCP replaces gstack/browse for Phase 3 browser testing
- External skills (superpowers/gstack) replaced by orchestrator inline execution or Qoder native capabilities

## ANTI-PATTERNS (THIS PLUGIN)
- Do NOT edit plugins/qoder/skills/ directly — rebuild from source via build-plugin.sh
- Do NOT assume xp-gate CLI is installed — skills must degrade gracefully
- Do NOT create hooks.json for Qoder — platform does not support file-system event hooks
- Do NOT use curl for API calls — curl is in Qoder's command deny list; use PowerShell Invoke-RestMethod or Qoder's built-in multi-model capability
- Do NOT reference OpenCode task() API in Qoder skills — use Agent tool (Browser/CodeReview/plan-agent) instead

## UNIQUE STYLES
- Qoder: SKILL.md + genui widgets + Canvas + Memory + CodeReview subagent + browser-use MCP
- Pre-Edit Gate: skill-embedded mandatory check replaces Claude Code's physical hook blocking
- Multi-model review: Qoder Agent subagent dispatch (plan-agent/CodeReview) replaces OpenCode task() API
- Graceful degradation: skills work even without xp-gate CLI installed
- Shared skill source: one SKILL.md → copied to Claude Code, OpenCode, and Qoder platforms

## COMMANDS
```bash
# Build Qoder plugin
npm run build:qoder-plugin                    # Build Qoder plugin with all 8 skills
bash scripts/build-plugin.sh --platform qoder  # Same, via script

# Install skills
bash scripts/install-qoder-skills.sh --global  # User-level: ~/.qoder/skills/
bash scripts/install-qoder-skills.sh --local   # Project-level: .qoder/skills/

# Test plugin
bash scripts/test-plugins.sh                   # Includes Qoder platform tests

# CLI skill install
xp-gate install-skill sprint-flow --platform qoder --global
xp-gate install-skill delphi-review --platform qoder --local
```

## NOTES
- v0.6.0+: Qoder plugin support introduced
- Qoder plugin: 8 skills (all source skills, including admin-template-guidelines)
- Claude Code plugin: 7 skills (no admin-template-guidelines)
- OpenCode plugin: 7 skills + 3 custom tools (gate-check, gate-principles, gate-arch)
- build-plugin.sh validates 8 expected skills for Qoder platform
- test-plugins.sh: includes Qoder-specific test cases (widgets, no hooks.json)
