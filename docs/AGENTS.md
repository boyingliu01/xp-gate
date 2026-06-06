# DOCUMENTATION KNOWLEDGE BASE

**Generated:** 2026-06-06
**Version:** v0.7.x

## OVERVIEW
Reference guides, design history, and plan docs for XP-Gate project. 30+ design plans archived chronologically.

## STRUCTURE
```
docs/
├── plans/                # 30+ design docs (YYYY-MM-DD-topic.md format)
│   ├── 2026-04-05-*.md   # XP 12 practices, Delphi consensus
│   ├── 2026-04-09-*.md   # v0.0.2 architecture + implementation
│   ├── 2026-04-12-clean-code-solid-checker-design.md
│   ├── 2026-04-13-quality-gate-enhancement-design.md
│   ├── 2026-04-14-skill-consolidation-design.md
│   ├── 2026-05-04-mutation-testing-gate10.md
│   ├── 2026-05-16-gate8-mutation-testing-precommit.md
│   ├── 2026-05-19-xp-gate-zero-install-*.md   # npm distribution
│   ├── 2026-05-29-xp-gate-cross-platform-plugin-*.md
│   ├── 2026-05-29-specification-fix-issues.yaml  # historical fix plan
│   ├── 2026-05-30-xp-gate-uninstall-design.md
│   └── 2026-06-04-skill-version-sync-design.md
├── incidents/            # Postmortems
├── retros/               # Weekly engineering retrospectives
├── admin-template-guidelines.md
├── gate-validation-guide.md
├── MULTI-MODEL-REVIEW-GUIDE.md
├── performance-benchmark.md
├── principlesrc-configuration.md
├── ralph-loop-design.md
├── rename-guide.md
├── sonarqube-setup.md
├── specification-ahe-observability.yaml
└── sprint-fix-open-issues-design.md
```

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Design history | docs/plans/ (sorted by date, oldest to newest) |
| Gate validation | gate-validation-guide.md |
| Multi-model review process | MULTI-MODEL-REVIEW-GUIDE.md |
| Performance data | performance-benchmark.md |
| Principles config | principlesrc-configuration.md |
| Ralph-loop design | ralph-loop-design.md |
| Past incidents | incidents/ |
| Weekly retros | retros/ |

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT mix code and documentation changes
- Do NOT create docs-only commits that bypass tests
- Do NOT re-introduce skill validation/evaluation/certification docs — out of scope per issue #140

## NOTES
- Plan docs follow format: `YYYY-MM-DD-topic.md`
- 30+ design decisions archived in docs/plans/
- Historical v0.0.2 documents archived
- Each plan doc corresponds to a Delphi consensus report or implementation plan
- Skill validation/evaluation/certification docs were removed in issue #140 (see CHANGELOG v0.7.2). xp-gate's scope is packaging/install/update/uninstall/distribution/runtime invocation only.
