# Delphi Distinct-Model Policy Design

**Date:** 2026-08-19

**Status:** Approved

## Goal

Make Delphi review enforce model diversity directly. Three expert roles must use three distinct model identifiers. The models may share a provider or gateway, and XP-Gate does not restrict model vendors or countries of origin.

## Decision

Delphi review keeps these requirements:

- Three anonymous expert roles: architecture, technical, and feasibility.
- Three distinct configured `model` values.
- Round 1 remains independent and anonymous.
- Consensus remains at least 90 percent.
- Reviews may continue for at most five rounds.
- Provider or model failures block the review; the workflow never degrades to a single model.

Delphi review removes these requirements:

- Experts do not need to use different providers.
- Models do not need to come from different vendors.
- Models do not need to be domestic models.
- XP-Gate does not maintain a model-family or vendor allowlist.

The authoritative diversity signal is the exact configured model identifier after trimming whitespace. Provider names, API endpoints, gateways, and billing plans are transport details and do not contribute to diversity.

## Runtime Validation

The external review runner validates the complete expert configuration before any model call:

1. The architecture, technical, and feasibility expert entries must exist.
2. Every expert must define a non-empty `model` string.
3. The three normalized model strings must be unique.
4. Provider configuration is still required for transport resolution, but provider uniqueness is not checked.

Validation returns a structured failure that names duplicate or missing model assignments without exposing API credentials.

The current `validateCrossProvider()` API becomes `validateDistinctModels()`. Canonical and npm-distributed runner copies remain byte-identical through the existing package synchronization flow.

## Configuration Compatibility

The preferred consensus option is:

```json
{
  "consensus": {
    "threshold_percent": 90,
    "max_review_rounds": 5,
    "distinct_models_required": true
  }
}
```

`distinct_models_required` defaults to `true` when omitted.

The previously documented `cross_provider_required` option is deprecated. It no longer imposes provider diversity. Reading a configuration that contains it may emit a migration warning, but valid distinct-model configurations continue to work without requiring an immediate file edit.

No compatibility path may allow duplicate models when distinct-model validation is enabled.

## Model Access

Multiple models may be accessed through one provider or token plan. For example, a single `bailian-tp` provider may configure:

- architecture: `qwen3.7-max`
- technical: `deepseek-v4-pro`
- feasibility: `glm-5.2`

This configuration satisfies Delphi diversity because the model identifiers differ, even though the endpoint and API token are shared.

## Documentation And Mirrors

Canonical documentation must describe model diversity rather than provider or country restrictions:

- `skills/delphi-review/`
- `README.md`
- `docs/CAPABILITIES.md`
- root and skill `AGENTS.md` files
- configuration examples and installation guidance

Generated copies under `src/npm-package/` and platform plugin directories are refreshed from canonical sources through repository synchronization scripts. Generated mirrors are not edited independently.

Historical approved design documents remain immutable. New documentation supersedes earlier provider-diversity decisions rather than rewriting their historical text.

## Testing

The RED-GREEN suite covers these behaviors:

- One provider with three different models passes.
- Multiple providers with the same model fail.
- A missing model fails with an actionable reason.
- A model containing only whitespace fails.
- Three distinct local models pass; locality is not a diversity exception.
- The deprecated provider option does not restore provider-based blocking.
- Canonical and npm runner files stay synchronized.
- Published skill and plugin mirrors contain the current policy after synchronization.

The full release matrix remains unchanged: focused unit tests, complete Vitest suite before and after build, lint, TypeScript build, BATS, plugin integration, architecture differential checks, mirror checks, pre-commit, pre-push, CI, and exact-HEAD Delphi walkthrough evidence.

## Non-Goals

- Inferring whether two differently named models share weights or a model family.
- Enforcing vendor, provider, country, endpoint, or billing diversity.
- Automatically selecting models for the user.
- Allowing fewer than three experts.
- Lowering the consensus threshold or bypassing failed model calls.
