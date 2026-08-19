# Delphi Distinct-Model Policy Design V3

**Date:** 2026-08-19

**Status:** Approved correction

## Scope

This document supersedes only wording in `2026-08-19-delphi-distinct-model-policy-design-v2.md` that could imply one runner invocation executes all three configured models. All other v2 and v1 decisions remain in force.

## Invocation Boundary

Each `delphi-external-review.cjs --expert <role>` invocation executes exactly one configured model for the selected architecture, technical, or feasibility role. This one-expert-per-invocation boundary preserves anonymous, independent Round 1 reviews and does not expose the other experts' responses to the selected expert.

Each successful invocation emits a typed `delphi_expert_result`. It contains the selected role, the model's expert verdict, requested model provenance, and resolved model provenance. A single expert result is not global Delphi approval and must not be written as global walkthrough evidence.

## Workflow-Level Enforcement

The Delphi workflow, not one runner process, must:

1. Invoke architecture, technical, and feasibility independently.
2. Require all three invocations to succeed.
3. Verify the three successful expert results contain distinct requested model identifiers.
4. Aggregate at least 90 percent consensus.
5. Complete within no more than five review rounds.
6. Write global walkthrough evidence only after those workflow-level conditions pass.

## Consensus Bounds

Configuration normalization treats `threshold_percent` as a minimum of 90 and `max_review_rounds` as a range of 1 through 5. Out-of-range or non-numeric values are normalized deterministically and emit machine-readable warning codes. Multiple warning codes are preserved and reported independently.

## Preserved Decisions

- Exactly three enumerable expert roles are configured.
- Each role uses a distinct normalized requested model identifier.
- One provider or gateway may serve multiple distinct models.
- Local OpenAI-compatible endpoints remain supported as normal callable providers.
- Special non-executing local fallback labels remain blocked.
- There is no provider, vendor, model-family, or country allowlist.
- Provider failures block the affected expert result and therefore block workflow completion.
