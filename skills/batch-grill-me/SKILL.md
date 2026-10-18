---
name: batch-grill-me
version: 1.1.0
description: A relentless interview that asks every frontier question at once, round by round. Thin alias of `grilling` (#540) — upstream mattpocock/skills absorbed this protocol into grilling; XP-Gate keeps this name as the sprint-flow Phase 2 entry point so orchestration docs stay stable.
disable-model-invocation: true
---

> **Disposition (#540):** upstream deleted the standalone batch-grill-me skill — its round-based
> frontier protocol now IS upstream `grilling`. This file is intentionally a thin alias: keep it
> as the canonical sprint-flow reference name; protocol changes land in `skills/grilling/SKILL.md`
> (the single source), not here.

The protocol is identical to [`grilling`](../grilling/SKILL.md): read and follow that skill. Summary:

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled — the questions you can ask *now* without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Each round the user answers reshapes the tree — settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a *later* round, not this one.

Finding *facts* is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it — don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report — ask the rest of the frontier now. The *decisions* are the user's — put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
