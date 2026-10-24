#!/usr/bin/env python3
"""Score a pre-push gate list, or refuse to.

`overall.score` is the most quotable number in a pre-push report, so it has to
generalise over the gates it claims to summarise (#580, #577).

Two shapes must produce no number at all:

    no gate ran            ->  0.0/10 would claim "everything broke"
    some gate ran, but the  -> 10.0/10 off a single passing gate would claim
    rest never did             "everything is green"

The honest answer in both cases is None — "not measured" — because either way the
number would be a claim the run cannot support. A score is emitted only when the
gates that ran are a MAJORITY of the gates that exist, and it always travels with
`score_scope` naming what it covers, so no reader can quote it as global quality.

Usage:
    prepush-score.py --status PASS --status SKIP ...      # one per gate
    prepush-score.py --report path/to/report.json        # patch in place
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


# Statuses grouped by what they say about the run. Kept as data rather than as
# branches so adding a status is a one-line change and cannot silently fall
# through to "failed" (which is exactly what DEGRADED used to do, #574).
FAILED_STATUSES = ("FAIL", "BLOCK")
# A degradation is a gate that ran but could not fully do its job, so it counts
# with the warnings: a degraded gate must never be judged a hard failure.
DEGRADED_STATUSES = ("DEGRADED", "WARN")


def _group_by_disposition(gates: Sequence[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """Split the gate list into ran / passed / failed / warned / degraded / skipped."""
    def with_status(statuses: Sequence[str]) -> List[Dict[str, Any]]:
        return [g for g in gates if g.get("status") in statuses]

    ran = [g for g in gates if g.get("status") != "SKIP"]
    return {
        "ran": ran,
        "passed": with_status(("PASS",)),
        "failed": with_status(FAILED_STATUSES),
        "warned": with_status(("WARN",)),
        "degraded": with_status(DEGRADED_STATUSES),
        "skipped": with_status(("SKIP",)),
    }


def _score_for(ran: Sequence[Dict[str, Any]], passed_count: int, total: int) -> Tuple[Optional[str], str]:
    """The score and the scope it covers, or (None, reason) when it cannot apply.

    A score speaks for the gates that ran, so it is only emitted when those can
    summarise the report. Two shapes cannot:

        nothing ran            -> 0.0/10 would claim "everything broke"
        fewer than half ran    -> 10.0/10 off one passing gate would claim
                                  "everything is green"

    Six of twelve is a tie, not an endorsement, hence `* 2 <=`.
    """
    if not ran:
        return None, "not measured"
    if len(ran) * 2 <= total:
        return None, "%d of %d gates is too few to summarise" % (len(ran), total)
    return "%.1f/10" % (10.0 * passed_count / len(ran)), "%d of %d gates" % (len(ran), total)


def compute(gates: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Return the score fields for a gate list.

    Keys: score (str | None), score_scope (str), gates_run, gates_skipped,
    gates_total, gates_passed, gates_failed, gates_warned, gates_degraded,
    failed_gates, skipped_gates. The rule lives here and nowhere else.

    `gates_total` and `gates_passed` are counted from the list rather than taken
    from the caller: they used to be a hardcoded 8 and a 1/0 squashed out of the
    verdict, so a report could claim eight gates while listing twelve (#569).
    """
    total = len(gates)
    groups = _group_by_disposition(gates)
    score, scope = _score_for(groups["ran"], len(groups["passed"]), total)

    return {
        "score": score,
        "score_scope": scope,
        "gates_run": len(groups["ran"]),
        "gates_skipped": len(groups["skipped"]),
        "gates_total": total,
        "gates_passed": len(groups["passed"]),
        "gates_failed": len(groups["failed"]),
        "gates_warned": len(groups["warned"]),
        "gates_degraded": len(groups["degraded"]),
        "failed_gates": [g.get("id") for g in groups["failed"]],
        "skipped_gates": [g.get("id") for g in groups["skipped"]],
    }


def apply_to_report(report: Dict[str, Any]) -> Dict[str, Any]:
    """Patch the score fields into a report's `overall` section, in place."""
    overall = report.setdefault("overall", {})
    overall.update(compute(report.get("gates", [])))
    return report


def main(argv: Optional[Iterable[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Score a pre-push gate list.")
    parser.add_argument(
        "--status",
        action="append",
        default=[],
        metavar="STATUS",
        help="status of one gate (repeatable, in gate order)",
    )
    parser.add_argument(
        "--report",
        metavar="PATH",
        help="patch the score fields into this report JSON in place",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    if args.report:
        path = Path(args.report)
        report = json.loads(path.read_text(encoding="utf-8"))
        apply_to_report(report)
        path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        return 0

    if not args.status:
        parser.error("either --report or at least one --status is required")

    print(json.dumps(compute([{"status": s} for s in args.status])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
