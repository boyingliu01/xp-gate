"""Seat model resolution fallbacks and violation cases.

Part of the #717 guard test suite, split so no module exceeds the
clean-code.many-exports ceiling (10).
"""

import json
import sys
from pathlib import Path

import check_delphi_local_models as guard

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))


def test_check_file_reads_requested_model_as_fallback(tmp_path):
    """Seats may name the model as requested_model instead of model."""
    model = min(guard.MODEL_ALLOWLIST)
    cfg = {"profiles": {"p": {"experts": {"r": {"requested_model": model}}}}}
    assert guard.check_file(str(tmp_path / "cfg.json"), cfg) is True


def test_check_file_treats_missing_model_as_violation(tmp_path):
    cfg = {"profiles": {"p": {"experts": {"r": {}}}}}
    assert guard.check_file(str(tmp_path / "cfg.json"), cfg) is False


# --- active_profile --------------------------------------------------------


def test_active_profile_resolves_named_profile():
    cfg = {"active_profile": "x", "profiles": {"x": {"id": 1}}}
    assert guard.active_profile(cfg) == {"id": 1}


def test_active_profile_defaults_to_default_profile():
    cfg = {"profiles": {"default": {"id": 2}}}
    assert guard.active_profile(cfg) == {"id": 2}


def test_active_profile_returns_none_when_unresolvable():
    assert guard.active_profile({"profiles": {}}) is None


# --- load_json -------------------------------------------------------------


def test_load_json_reads_valid_file(tmp_path):
    p = tmp_path / "c.json"
    p.write_text(json.dumps({"a": 1}), encoding="utf-8")
    assert guard.load_json(str(p)) == {"a": 1}


def test_load_json_returns_none_for_missing_file(tmp_path):
    assert guard.load_json(str(tmp_path / "absent.json")) is None


def test_load_json_reports_invalid_json_without_traceback(tmp_path, capsys):
    p = tmp_path / "bad.json"
    p.write_text("{not json", encoding="utf-8")
    assert guard.load_json(str(p)) is False
    assert "invalid config" in capsys.readouterr().out
