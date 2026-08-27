# SKILLS/DELPHI-REVIEW KNOWLEDGE BASE

**Generated:** 2026-08-24
**Commit:** a1a4683
**Branch:** dsh-plugin
**Version:** 0.19.0.0

## OVERVIEW
Delphi Consensus Review — multi-round anonymous expert review (≥90% threshold, exactly 3 experts with distinct executable model IDs). Supports design, requirements, and code-walkthrough modes.

## STRUCTURE
```
skills/delphi-review/
├── SKILL.md                  # Core Delphi methodology + output contract
├── INSTALL.md                # Setup instructions
├── AGENTS.md                 # This file
├── evals/                    # Evaluation test cases
├── opencode.json.delphi.example  # OpenCode delphi config example
├── references/
│   └── code-walkthrough.md   # Code-walkthrough mode specification
└── .delphi-config.json.example   # 3-expert config template
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Core methodology | SKILL.md | Delphi process, expert roles, consensus rules |
| Code-walkthrough | references/code-walkthrough.md | Pre-push mode: complete review evidence with no hard file/LOC threshold |
| Config example | .delphi-config.json.example | 3 experts, distinct models |

## CONVENTIONS
- 3 experts anonymous in Round 1 (no cross-expert bias)
- ≥90% consensus threshold (was 95%, now unified to 90%)
- Max 5 rounds before forcing decision
- Provider/vendor/nationality unrestricted; exactly three distinct trimmed requested model IDs are required
- Model selection: reads `delphi-reviewer-*` agent `model` fields from `opencode.json`
- No hardcoded model lists — models defined by user's `opencode.json` configuration
- Code-walkthrough mode: triggered on git push, stores result in .code-walkthrough-result.json
- Code-walkthrough skipped on main/master pushes (by design)

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT terminate before achieving true consensus (≥90%)
- Do NOT reveal other experts' opinions during Round 1
- Do NOT accept partial agreement without resolution
- Do NOT auto-skip or bypass code-walkthrough based on change size; review large diffs completely or split them by user choice
- Do NOT degrade to single model on API errors (BLOCK)
- Do NOT declare complete without writing .code-walkthrough-result.json
- Do NOT treat `provider: local` fallback as an executed expert

## UNIQUE STYLES
- Anonymous expert reviews (Round 1)
- Statistical consensus measurement (≥90% threshold)
- Three modes: requirements review + design review + code-walkthrough
- Pre-push integration: .code-walkthrough-result.json stores commit hash + verdict
- Delphi guard in claude-code plugin: blocks Edit/Write before APPROVAL

## COMMANDS
```bash
/delphi-review                              # Design review mode
/delphi-review --mode requirements          # Phase 2 R1 requirements review
/delphi-review --mode code-walkthrough      # Pre-push code walkthrough
```

## NOTES
- Used by pre-push hook for code-walkthrough validation
- Delphi guard (claude-code plugin) reads .sprint-state/delphi-reviewed.json
- Code-walkthrough result must match commit hash for verification
