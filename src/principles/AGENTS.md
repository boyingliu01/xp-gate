# PRINCIPLES CHECKER MODULE

**Updated:** 2026-11-17

> **Scope.** This is the TypeScript engine behind the Clean-Code/SOLID gate and
> the Boy Scout enforcement. What follows is the design intent and the rules you
> cannot read off the code.
>
> Rule lists, adapter counts and file trees were here before and were wrong: the
> doc claimed "9 language adapters" in three places while the directory held
> more, and that wrong figure propagated outward into the CLI's own hardcoded
> help text. Ask the code:
>
> | Question | Answer |
> |---|---|
> | Every rule, its severity and limit | `xp-gate gate-rules` |
> | Rule implementations | `rules/clean-code/`, `rules/solid/` |
> | Language coverage | `adapters/` (language adapters sit beside shared helpers — see TRAPS) |
> | Effective thresholds | `.principlesrc` plus built-in defaults |

## DESIGN INTENT

### Two tiers of language coverage, and the divergence is deliberate

This engine only covers languages it can **parse meaningfully**. The shell
adapters cover languages it can **lint or test**. The two sets do not match, and
that mismatch is correct: a language with no TS-side rule support still gets
gated, just by different means. Do not "close the gap" by inventing shallow
adapters — a rule that reports noise is worse than no rule.

### Rules are IDs, and IDs are contracts

Rule IDs are dot-namespaced and stable (`clean-code.long-function`,
`solid.srp`). They appear in config, in baselines, in SARIF and in suppression
records. Renaming one silently invalidates every baseline entry that referenced
it — the warning count appears to drop because the rule no longer matches, not
because the code improved.

### Severity has three meanings

- `error` — blocks.
- `warning` — blocks under Boy Scout **if the count increased**.
- `info` — logged only.

The middle one is the subtle case: a warning does not block, but *one more of
them than yesterday* does. This is why baselines are load-bearing.

### Boy Scout is differential, not absolute

The rule is not "no warnings". It is: **you may not leave more warnings than you
found.** Modified files are compared against the baseline; new files start from
zero. That comparison is what makes the gate adoptable in an imperfect codebase —
an absolute rule would block all work immediately and be switched off within a
day.

Consequence worth knowing: the baseline must be regenerated when rule behaviour
changes legitimately, or every subsequent commit inherits phantom debt.

### Per-path severity overrides exist, and only relax

Project config may relax a rule's severity for specific path globs. Overrides are
**relax-only by design**: a path-scoped entry can downgrade, never escalate. That
direction is what keeps the override mechanism from becoming a second, invisible
gate policy — anything that raises severity must be visible in the rule
definition, where a reviewer will see it.

This exists because the alternative was worse: without it, projects add blanket
suppressions for test trees, which also silence production code.

### Parse where possible, regex where necessary, and say which

AST-based analysis is preferred. Regex fallbacks are limited to languages the AST
tooling does not reach (C/C++, Objective-C), where they are **known to be
approximate**. A regex adapter that reports a confident finding it cannot verify
is the failure mode to avoid — prefer under-reporting to fabricating.

## TRAPS

- **`adapters/` holds two kinds of file.** Language adapters sit beside shared
  extraction helpers (`base`, `duplication`, `member-scan`, `quote-state`,
  `control-nesting`, `import-clause`, `position-analysis`). Counting files in that
  directory does not give a language count — which is exactly how the "9
  language adapters" figure went wrong.
- **C++ handles C.** There is no separate C adapter; one adapter covers both. Do
  not add one.
- **Suppression is easy to over-apply.** A config entry that turns off a rule for
  a directory also turns it off for everything added there later.
- **Baselines go stale.** A baseline captured before a rule change encodes the old
  rule's opinions; comparing against it produces findings that have nothing to do
  with the change under review.
- **The extension point is the rule registry in `index.ts`.** A rule file that
  exists but is not registered simply never runs, silently.

## CONVENTIONS

- **Never weaken types to satisfy a rule** — no `as any`, `@ts-ignore`,
  `@ts-expect-error` in rule implementations. The analyzer is trusted by every
  gate that reads its output.
- **Every test declares its traceability tags** (`@test REQ-XXX`, `@intent`,
  `@covers`); untagged tests are rejected.
- **Mocks are inline**, not fixture files — a rule test should read as one
  self-contained claim about one rule.
- **New rules are four-part changes**: the implementation, its tests, its
  registration, and its user-facing description. Any three without the fourth
  produces a rule nobody can interpret.

## COMMANDS

```bash
npx tsx src/principles/index.ts --files "src/**/*.ts" --format console
npx tsx src/principles/index.ts --files "src/**/*.ts" --format sarif > results.sarif
npx tsx src/principles/index.ts --files "src/**/*.ts" --config .principlesrc
```

Output formats exist because two different consumers read the same findings: a
human at a terminal and a code-scanning service ingesting SARIF. Keep both
faithful to the same verdict — a rule that reports differently through the two
channels is worse than one that reports only one.