# Delphi Distinct-Model Policy Design V2

**Date:** 2026-08-19

**Status:** Approved correction

## Scope

This document supersedes only the local-model pass statements in `2026-08-19-delphi-distinct-model-policy-design.md`, including the claim that three `provider: local` labels satisfy distinct-model enforcement. The original design remains authoritative for all other decisions.

## Executed Model Identity

Distinct-model compliance requires three actual model executions. Each configured expert model identifier is trimmed once and used consistently for validation, the provider request, and requested-model provenance.

A successful provider response may report the model that actually served the request. That value is preserved separately as resolved-model provenance. If the provider omits the model field, resolved-model provenance is `null`; the configured alias must not be presented as the resolved model.

## Local Execution Correction

The special `provider: local` fallback is not a model execution. It cannot satisfy three-model enforcement and must be rejected before fallback output when distinct-model enforcement is active. The error must direct the user to configure a callable provider for the expert.

Locally hosted OpenAI-compatible endpoints remain fully supported. They are configured as normal providers with a callable `base_url`, credentials when required, and distinct model identifiers. This correction does not restrict provider location or ownership.

## Preserved Decisions

- Exactly the architecture, technical, and feasibility roles are required.
- The three normalized model identifiers must be distinct.
- Multiple experts may use the same provider or gateway.
- There is no provider, vendor, model-family, or country allowlist.
- Provider or model-call failures block the review.
- `distinct_models_required` cannot disable enforcement.
- Consensus remains at least 90 percent and at most five rounds.

## Safe Provenance And Errors

Review output records requested normalized model identity separately from resolved provider-reported model identity. Non-success provider response bodies are untrusted and are not copied into logs or returned error messages.
