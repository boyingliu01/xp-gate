# 0002. Arch rules live in principles as a fallback, and layer contracts will override them

## Status

Accepted

## Context

Sprint `sprint/2026-11-03-01` shipped three ArchUnit-derived rule families into the
principles engine (Gate 4) rather than waiting for ARCH-03's layer-contract
system:

- **R10/R11/R12** (`arch.naming.*`, #694) — package-path → class-name-suffix rules.
- **R08/R15/W01** (`arch.dependency.*`, #699) — dependency-direction rules.

ARCH-03 (#690) will let a project declare its own layers and permitted
directions in `.layer-contract.yaml`, and will be able to express the same
dependency-direction constraints. Two implementations of one concept is a
maintenance hazard: they can disagree, and a user who fixes a violation in one
will be surprised the other still complains.

The question this ADR settles: **which one wins when both are configured?**

## Decision

The principles rules are the **default when no layer contract exists**, and the
**user's explicit contract wins** when one does.

Concretely:

1. R08/R15/W01 and R10/R11/R12 encode the naming and layering structure that
   ArchUnit's 33-rule standard prescribes when a project has not declared its
   own. They need no configuration.
2. When a `.layer-contract.yaml` is present, ARCH-03's declarations take
   precedence for the directions it covers. A user who names their layers
   differently must not be fought by a hard-coded default.
3. When ARCH-03 lands, these rules become **instances of the default
   contract** — the same judgement logic (suffix sets, exclusion lists,
   framework-prefix skips) is reused; only the trigger changes from "always" to
   "when the contract does not say otherwise".

## Why doing this now is not wasted work

The judgement logic is the expensive part, and it is contract-independent:

- The excluded-suffix list (`*Constants`, `*Facade`, …) exists because
  `OrderServiceConstants` matches `*Service` but is not a service. Any layer
  system needs the same knowledge.
- The framework-prefix skip (`java.*`, `org.springframework.*`) exists because a
  `DiscoveryService` from Spring is not the project's application layer.
- The package-segment anchoring that survives Maven multi-module layouts is
  about parsing paths, not about who owns the rule.

ARCH-03 will supply a different *source* for the allowed-direction set. It will
not supply a different way to decide whether an import violates it.

## Consequences

### Positive
- Pre-commit catches the common ArchUnit violations today, without Maven and
  without a `.layer-contract.yaml` for every project.
- When ARCH-03 arrives, the rules degrade into one implementation instead of
  two competing ones.
- Projects that never adopt ARCH-03 keep a working architecture check.

### Negative / risks
- Until ARCH-03 exists, a project whose layering deliberately differs from the
  ArchUnit default will get violations it considers wrong. The escape hatch is
  per-rule configuration in `.principlesrc` (`rules.arch.*.enabled`), not a
  contract yet. **The disable/rollback path is not yet exercised by a test** —
  this is an open item carried out of DESIGN and recorded in
  `requirements-reviewed.json`.
- Two places will eventually express dependency direction. Point 2 above is the
  rule that keeps them from disagreeing; it is a convention, not an enforced
  invariant.

## References

- `docs/plans/2026-11-03-arch-rules-and-tool-registry.md` §4.2
- #694 (ARCH-07), #699 (ARCH-12), #689 (ARCH-14), #690 (ARCH-03 layer contract)
