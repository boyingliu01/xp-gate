# SKILLS/DELPHI-REVIEW KNOWLEDGE BASE

**Generated:** 2026-05-30
**Commit:** 4517f2b
**Branch:** main
**Version:** v0.5.1

## OVERVIEW
Delphi Consensus Review — multi-round anonymous expert review (≥91% threshold, 3 experts from ≥2 providers, domestic models only). Supports design + code-walkthrough modes.

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
| Code-walkthrough | references/code-walkthrough.md | Pre-push mode: 20 files/500 LOC limit |
| Config example | .delphi-config.json.example | 3 experts, domestic models |

## CONVENTIONS
- 3 experts anonymous in Round 1 (no cross-expert bias)
- ≥91% consensus threshold (was 95%, lowered to 91%)
- Max 5 rounds before forcing decision
- Cross-provider required: experts from ≥2 different providers
- Domestic models only: glm, kimi, minimax, qwen, deepseek
- Foreign models forbidden: Anthropic, OpenAI, Google
- Code-walkthrough mode: triggered on git push, stores result in .code-walkthrough-result.json
- Code-walkthrough skipped on main/master pushes (by design)

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT terminate before achieving true consensus (≥91%)
- Do NOT reveal other experts' opinions during Round 1
- Do NOT accept partial agreement without resolution
- Do NOT skip code-walkthrough when over thresholds (BLOCK + user decision)
- Do NOT degrade to single model on API errors (BLOCK)
- Do NOT declare complete without writing .code-walkthrough-result.json
- Do NOT use foreign models (Anthropic/GPT/Gemini)

## UNIQUE STYLES
- Anonymous expert reviews (Round 1)
- Statistical consensus measurement (≥91% threshold)
- Two modes: design review + code-walkthrough
- Pre-push integration: .code-walkthrough-result.json stores commit hash + verdict
- Delphi guard in claude-code plugin: blocks Edit/Write before APPROVAL

## COMMANDS
```bash
/delphi-review                              # Design review mode
/delphi-review --mode code-walkthrough      # Pre-push code walkthrough
```

## NOTES
- Used by pre-push hook for code-walkthrough validation
- Delphi guard (claude-code plugin) reads .sprint-state/delphi-reviewed.json
- Code-walkthrough result must match commit hash for verification