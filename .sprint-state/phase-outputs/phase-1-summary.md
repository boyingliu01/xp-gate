---
phase: 1
phase_name: PLAN
status: completed
outputs:
  - path: ".sprint-state/phase-outputs/specification.yaml"
    type: specification
decisions:
  - title: "Sequential execution (3 independent REQs)"
    rationale: "REQ-1 and REQ-2 are independent files, REQ-3 depends on REQ-1. Execute sequentially."
unresolved_issues: []
next_phase_context: "3 REQs: (1) VERSION-GATE in SKILL.md Phase 6 SHIP, (2) skill-cert job in quality-gates.yml, (3) plugin sync"
---

## Phase Summary

Implementation plan for 3 REQs:

| REQ | File | Action | Est. Lines |
|-----|------|--------|-----------|
| REQ-1 | `skills/sprint-flow/SKILL.md` | Add VERSION-GATE to Phase 6 SHIP (after line 477) | +8 |
| REQ-2 | `.github/workflows/quality-gates.yml` | Add `skill-cert-check` job (before final summary) | +30 |
| REQ-3 | `plugins/*/skills/sprint-flow/` | Run `copy-skills.sh` to sync | auto |
