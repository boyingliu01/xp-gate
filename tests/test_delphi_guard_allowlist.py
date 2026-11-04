"""Seat allowlist: a sanctioned hosted seat must not read as a violation.

Part of the #717 guard test suite; split from test_check_delphi_local_models.py
so no single module exceeds the clean-code.many-exports ceiling. Together the
three files cover 99% of scripts/check_delphi_local_models.py.
"""

import sys
from pathlib import Path

import check_delphi_local_models as guard

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))


# --- the regression that motivated the tests -------------------------------


def test_sanctioned_hosted_seats_are_allowed():
    """The three seats that ran rounds 1-2 must not read as violations."""
    for model in ("s-deepseek-v4.1-flash", "s-glm-5.3-flash", "g-ling-3.1-flash"):
        assert model in guard.MODEL_ALLOWLIST, (
            f"{model} is a sanctioned seat but the guard would report "
            f"SEAT VIOLATION on it"
        )


def test_allowlist_is_explicit_not_a_wildcard():
    """A wildcard would bless any future seat, defeating the reviewable-edit
    contract the allowlist exists to provide."""
    for model in guard.MODEL_ALLOWLIST:
        assert "*" not in model, f"wildcard {model!r} in MODEL_ALLOWLIST"


def test_local_models_need_no_allowlist_entry():
    """`local-*` passes by prefix, so the allowlist stays about hosted seats."""
    assert guard.LOCAL_PREFIX == "local-"
