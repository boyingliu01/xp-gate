# DOCUMENTATION KNOWLEDGE BASE

**Generated:** 2026-07-21
**Commit:** 7e2d990
**Branch:** main
**Version:** 0.14.19.0

## OVERVIEW
Reference guides, design history, postmortems, and weekly retros. **30+ chronologically-archived design plans** under `plans/`. Plan docs follow `YYYY-MM-DD-topic.md` and each typically corresponds to a Delphi consensus report or implementation plan.

## STRUCTURE
```
docs/
├── plans/                # 30+ design docs (YYYY-MM-DD-topic.md format)
│   ├── 2026-04-05-*.md   # XP 12 practices, Delphi consensus
│   ├── 2026-04-09-*.md   # v0.0.2 architecture + implementation
│   ├── 2026-04-12-clean-code-solid-checker-design.md
│   ├── 2026-04-13-quality-gate-enhancement-design.md
│   ├── 2026-04-14-specification-generator-update-mode-design{,-v2}.md
│   ├── 2026-04-25-unified-boy-scout-design.md
│   ├── 2026-04-27-quality-gates-refactor.md
│   ├── 2026-05-04-mutation-testing-gate10.md
│   ├── 2026-05-04-sprint-flow-phase3-delphi.md
│   ├── 2026-05-04-sprint-flow-web-frontend.md
│   ├── 2026-05-16-gate8-mutation-testing-precommit.md
│   ├── 2026-05-17-web-dashboard.md
│   ├── 2026-05-19-xp-gate-zero-install-{design,specification.yaml,consensus-report}.md
│   ├── 2026-05-29-xp-gate-cross-platform-plugin-{design,implementation-plan}.md
│   ├── 2026-05-29-specification-fix-issues.yaml
│   ├── 2026-05-30-xp-gate-uninstall-design.md
│   ├── 2026-05-31-issue-79-ui-sprint-detection-design.md
│   ├── 2026-06-02-issue-78-mock-layering-strategy.md
│   ├── 2026-06-04-skill-version-sync-design.md
│   └── 2026-06-06-sprint-branch-cleanup-design.md
├── incidents/            # Postmortems
├── retros/               # Weekly engineering retrospectives
├── admin-template-guidelines.md
├── gate-validation-guide.md
├── MULTI-MODEL-REVIEW-GUIDE.md
├── performance-benchmark.md
├── principlesrc-configuration.md
├── ralph-loop-design.md
├── rename-guide.md
├── specification-ahe-observability.yaml
└── sprint-fix-open-issues-design.md
```

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Design history | `plans/` (sorted chronologically; oldest = 2026-04, newest = 2026-06) |
| Gate validation guide | `gate-validation-guide.md` |
| Multi-model review process | `MULTI-MODEL-REVIEW-GUIDE.md` |
| Performance benchmark data | `performance-benchmark.md` |
| Principles config reference | `principlesrc-configuration.md` |
| Ralph-loop design | `ralph-loop-design.md` |
| Mock-layering design | `plans/2026-06-02-issue-78-mock-layering-strategy.md` |
| UI sprint detection | `plans/2026-05-31-issue-79-ui-sprint-detection-design.md` |
| Skill version sync | `plans/2026-06-04-skill-version-sync-design.md` |
| Sprint-branch cleanup | `plans/2026-06-06-sprint-branch-cleanup-design.md` |
| Past incidents | `incidents/` |
| Weekly retros | `retros/` |

## CONVENTIONS
- **Plan doc filename**: strict `YYYY-MM-DD-topic.md`. Date = the day the design was approved or filed, not the day code shipped.
- **One topic = one file**. Major revisions get a `-v2`, `-v3` suffix; never overwrite history.
- **Approved design docs feed `specification.yaml`**: only APPROVED plans are auto-merged into the requirements file at the repo root.
- **Plans are immutable once Delphi-APPROVED**. Corrections happen in a new `-v2` file.

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT mix code and documentation changes in one commit. Hooks may pass but reviewers will reject.
- Do NOT create docs-only commits that bypass the gate suite by being all `*.md`. (Gate 0 still runs.)
- Do NOT re-introduce skill validation/evaluation/certification docs — out of scope per issue #140 (see CHANGELOG v0.7.2). XP-Gate's responsibility for skills is packaging / install / update / uninstall / distribution / runtime invocation only.
- Do NOT delete or rename a plan doc after it's been Delphi-APPROVED. Supersede with `-v2`.

## NOTES
- Plan docs frequently link to one or more `.code-walkthrough-result.json` snapshots stored under `.xp-gate/reports/` in the implementation PR.
- Skill validation/evaluation/certification docs were removed in issue #140 (see `CHANGELOG.md` v0.7.2). XP-Gate's skill scope is packaging/install/update/uninstall/distribution/runtime invocation only.
- The two newest plans (`2026-06-02-issue-78-mock-layering-strategy.md` and `2026-06-06-sprint-branch-cleanup-design.md`) correspond to the work that shipped in v0.8.x.

