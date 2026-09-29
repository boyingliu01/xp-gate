# ADR Format

## Filename convention

`docs/adr/{NNNN}-{kebab-case-title}.md`

Where `{NNNN}` is a zero-padded incrementing number (e.g., `0001`, `0002`).

## Structure

```md
# {NNNN}. {Title}

## Status

Proposed | Accepted | Deprecated | Superseded by ADR-XXXX

## Context

{The issue(s) or situation(s) motivating this decision. What forces are at play? What is the problem?}

## Decision

{The decision made. Stated in full sentences, in the present tense. What did we decide to do?}

## Consequences

### Positive
- {Benefit 1}
- {Benefit 2}

### Negative
- {Trade-off 1}
- {Trade-off 2}

### Neutral
- {Neutral observation 1}

## Alternatives Considered

### {Alternative 1 title}
{Brief description and why it was rejected.}

### {Alternative 2 title}
{Brief description and why it was rejected.}
```

## Rules

- **Write for future readers, not present participants.** Future readers won't have the conversation context.
- **Be honest about trade-offs.** Every decision has costs. Name them.
- **One decision per ADR.** If you're writing "we decided X AND Y", split them.
- **Keep the decision short.** 1-3 sentences. The context section is where the complexity lives.
- **Superseded decisions are not deleted.** When a decision is overturned, create a new ADR that supersedes it. Update the old one's status to "Superseded by ADR-XXXX". This preserves history.
- **Don't document trivial choices.** If the answer is obvious or easily reversible, skip the ADR.

## When NOT to write an ADR

- The decision is easily reversible.
- The decision is a personal preference with no team impact.
- The decision is well-documented elsewhere (e.g., in the project's CONTRIBUTING.md).
- The decision follows an obvious path with no real alternatives.

When in doubt, skip it. An ADR that shouldn't exist creates more noise than value.
