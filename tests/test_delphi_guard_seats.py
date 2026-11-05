"""Seat iteration and active-profile resolution.

Part of the #717 guard test suite, split so no module exceeds the
clean-code.many-exports ceiling (10). Together the files cover 99% of
scripts/check_delphi_local_models.py.
"""

import sys
from pathlib import Path

import check_delphi_local_models as guard

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))


# --- iter_seats -------------------------------------------------------------


def test_iter_seats_uses_active_profile_only():
    cfg = {
        "active_profile": "prod",
        "profiles": {
            "prod": {"experts": {"architecture": {"model": "a"}}},
            "stale": {"experts": {"technical": {"model": "b"}}},
        },
    }
    seats = list(guard.iter_seats(cfg))
    assert [role for _, role, _ in seats] == ["architecture"]


def test_iter_seats_falls_back_to_all_profiles_when_active_unknown():
    cfg = {"active_profile": "nope", "profiles": {"p1": {"experts": {"r": {}}}}}
    assert len(list(guard.iter_seats(cfg))) == 1


def test_iter_seats_handles_list_shaped_experts():
    """The config permits a list as well as a dict; both must iterate."""
    cfg = {
        "active_profile": "p",
        "profiles": {"p": {"experts": [{"role": "arch", "model": "m"}]}},
    }
    seats = list(guard.iter_seats(cfg))
    assert seats[0][1] == "arch"


def test_iter_seats_survives_empty_config():
    assert list(guard.iter_seats({})) == []
