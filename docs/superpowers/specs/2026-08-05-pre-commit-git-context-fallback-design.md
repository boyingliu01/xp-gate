# Pre-commit Git Context Fallback Design

## Problem

`pre-commit` prefers the globally installed `adapter-common.sh` over the project copy. An older global installation may not define `run_without_git_context`, while current Gate 5 paths call it directly. This makes project hooks fail before tests run and prevents the project copy from supplying the new safety behavior.

## Decision

Keep the existing adapter resolution order. Immediately after sourcing the selected `adapter-common.sh`, `pre-commit` checks whether `run_without_git_context` exists. If it does not, the hook defines a local compatibility implementation that clears Git's repository-local environment variables before launching a child command.

The canonical helper remains in `githooks/adapter-common.sh` and its npm mirror. New installations use that implementation. The local hook fallback only protects installations whose global adapter is stale.

## Alternatives Rejected

- Prefer the project adapter over the global adapter. This changes established resolution behavior and could silently ignore user-managed global adapters.
- Require users to upgrade the global adapter before committing. This leaves existing installations broken and cannot protect automated environments.

## Verification

- Add a BATS regression that sources `pre-commit` with a stale global adapter fixture and confirms the fallback exists.
- Run the existing Git-context BATS tests, shell syntax checks, and canonical/npm mirror comparisons.
- Commit a TypeScript test change through the real pre-commit hook and confirm tests pass without synthetic commits appearing in branch history.
