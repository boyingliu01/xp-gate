# 0001. Keep CONTEXT.md as the canonical domain-model filename (do not follow upstream GLOSSARY.md rename)

## Status

Accepted

## Context

Upstream mattpocock/skills renamed its domain-model artifact from `CONTEXT.md` to `GLOSSARY.md` (and `CONTEXT-MAP.md` to `GLOSSARY-MAP.md`) across all docs (#540). The XP-Gate vendored `domain-modeling` skill and this repository deliberately forked that skill early (Chinese-localized workflow, integrated with grill-with-docs Phase 2 THINK). 22 repo files — skills, references, templates, phase docs — reference `CONTEXT.md`. Users' project repos carry `CONTEXT.md` files produced by earlier XP-Gate versions.

Adopting the upstream rename would mean either a breaking change for every existing user repo or a dual-filename compatibility layer inside the skill — both cost more than the naming alignment buys.

## Decision

We keep `CONTEXT.md` (and the CONTEXT-FORMAT.md template) as the canonical domain-model filename in all XP-Gate skills and docs. We do not sync the upstream `GLOSSARY.md` rename into the vendored `domain-modeling` skill. This is a deliberate, permanent fork of that one upstream detail; other upstream improvements to `domain-modeling` may still be adopted case by case.

## Consequences

### Positive
- Zero migration burden for existing user repos; no broken references in the 22 in-repo files.
- One canonical filename stays in play across the ecosystem XP-Gate controls (skills, sprint-flow docs, templates).

### Negative
- Permanent divergence from upstream `domain-modeling`: future upstream syncs must re-apply this exclusion.
- A user reading upstream docs will see a different filename; mitigated by this ADR and the note below.

### Neutral
- If a user's repo already adopted upstream's `GLOSSARY.md`, the skill's lazy-create rule ("create when the first term is resolved") simply never fires for `CONTEXT.md` until a term is added; nothing breaks.

## Migration Guidance for Users

No action needed. Existing `CONTEXT.md` files remain canonical. If you migrated a repo to upstream's `GLOSSARY.md` naming independently, keep it — the skill only writes `CONTEXT.md` when resolving new terms via XP-Gate flows.

## Alternatives Considered

- **Follow the rename** — rejected: breaking change for users, churns 22 files, no functional gain.
- **Accept both filenames** — rejected: two sources for one artifact is exactly the drift class this repo fights everywhere else.
