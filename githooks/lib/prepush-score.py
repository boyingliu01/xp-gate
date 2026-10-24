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
from typing import Any, Dict, Iterable, List, Optional, Sequence


def compute(gates: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Return the score fields for a gate list.

    Keys: score (str | None), score_scope (str), gates_run, gates_skipped,
    gates_total. The rule lives here and nowhere else.
    """
    total = len(gates)
    ran: List[Dict[str, Any]] = [g for g in gates if g.get("status") != "SKIP"]
    passed = sum(1 for g in ran if g.get("status") == "PASS")

    if not ran:
        scope = "not measured"
        score: Optional[str] = None
    elif len(ran) * 2 <= total:
        # A majority is required. Six of twelve is a tie, not an endorsement.
        scope = "%d of %d gates is too few to summarise" % (len(ran), total)
        score = None
    else:
        scope = "%d of %d gates" % (len(ran), total)
        score = "%.1f/10" % (10.0 * passed / len(ran))

    return {
        "score": score,
        "score_scope": scope,
        "gates_run": len(ran),
        "gates_skipped": total - len(ran),
        "gates_total": total,
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
