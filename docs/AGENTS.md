# DOCUMENTATION KNOWLEDGE BASE

**Updated:** 2026-11-17

> **Scope.** Reference guides, design history, postmortems and retros — the
> project's memory. This file records the rules that keep that memory usable.
>
> File inventories are deliberately absent. The previous revision carried a tree
> of individual plan filenames and asserted "30+ plans, newest = 2026-06"; the
> directory now holds over a hundred, and the listed "newest" entries are months
> stale. A catalogue of files is a snapshot that decays with every commit — list
> the directory instead:
>
> | Question | Answer |
> |---|---|
> | What plans exist | `ls docs/plans/` |
> | What happened recently | `ls docs/plans/ | sort | tail` |
> | How a past decision was reached | grep `docs/plans/` and `docs/incidents/` |
> | Current requirements | `specification.yaml` at the repo root |

## WHY THIS DIRECTORY EXISTS

Three kinds of document live here, and they have different lifespans:

- **Reference guides** — describe how something works *now*. Must be kept true or
  deleted; a stale guide is actively harmful because it reads as current fact.
- **Design plans** — record what was decided and why, at a point in time. Their
  value survives being out of date: they answer "why is it like this?" even when
  the answer has been superseded.
- **Postmortems and retros** — record what went wrong and what was learned. These
  are the highest-value documents per line in the repository, and the least
  likely to be reread, which is why their conclusions get re-learned the hard way.

The distinction matters when editing: **a reference guide is wrong if stale; a
plan is not.** Do not "update" a historical plan to match today's code — that
destroys the record of what was believed at the time.

## THE RULES THAT PROTECT THE RECORD

### Plans are immutable once approved

Corrections go in a new file (`-v2`, `-v3`), never by editing the original. The
whole point of the archive is that you can read an old decision in the state it
was actually made. An edited plan is a forgery of your own history.

### Filename date is the decision date

`YYYY-MM-DD-topic.md` — the date the design was approved or filed, not when code
shipped. This is how the archive stays chronological, and why you can locate "the
thinking in November" without opening files.

### One topic, one file

Bundled documents cannot be reviewed (a single verdict covering three designs
hides which one was objectionable) and cannot be superseded cleanly.

### Only approved designs flow into requirements

Design documents feed the requirements file only once approved. A draft that
leaks into `specification.yaml` makes an unratified idea look like a committed
requirement — and downstream, every gate that checks against requirements will
enforce it.

## TRAPS

- **A stale reference guide is worse than no guide.** It is trusted. When the
  code changes and the guide does not, the guide teaches the old behaviour with
  full confidence. Update it in the same change, or delete it.
- **Listing files in prose creates a second, decaying catalogue.** Point at the
  directory.
- **"Known issues" sections harden into misinformation.** Once an issue is fixed,
  delete the entry. An entry marked "resolved" reads as live to the next reader.
- **Retros are only useful if someone reads them.** A lesson recorded here and
  then contradicted in practice is a signal that the rule was never internalised —
  prefer a test or a lint over a paragraph.
- **Documents that duplicate generated facts** (counts, versions, gate lists)
  drift silently. Link to the source instead.

## CONVENTIONS

- Do not mix documentation and code changes in one commit — the gates may pass,
  but the history becomes hard to bisect.
- A docs-only change is still a change: it is gated, and it should not be used as
  a way to move a branch forward.
- When superseding a design, link forward from the old file to the new one so a
  reader following history does not stop at a superseded decision.
- Record the *decision and its reason*, not a transcript. The value is in the
  rejected alternatives — that is the part future readers cannot reconstruct.

## ANTI-PATTERNS

- Do NOT edit an approved plan. Supersede it.
- Do NOT rename or delete an approved plan.
- Do NOT let a draft requirement into the requirements file before approval.
- Do NOT keep resolved issues documented as warnings.
- Do NOT catalogue files in prose; list the directory.
- Do NOT re-introduce skill validation/evaluation/certification content — out of
  scope by decision (see the changelog for that release). This project's skill
  responsibility is packaging, install, update, uninstall, distribution and
  runtime invocation only.