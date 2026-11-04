"""Per-file seat checking across profile shapes.

Part of the #717 guard test suite, split so no module exceeds the
clean-code.many-exports ceiling (10). Together the files cover 99% of
scripts/check_delphi_local_models.py.
"""

import sys
from pathlib import Path

import check_delphi_local_models as guard

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))


# --- check_file -------------------------------------------------------------


def test_check_file_accepts_local_seat(tmp_path, capsys):
    cfg = {"profiles": {"p": {"experts": {"r": {"model": "local-llama"}}}}}
    assert guard.check_file(str(tmp_path / "cfg.json"), cfg) is True
    assert "OK" in capsys.readouterr().out


def test_check_file_accepts_allowlisted_hosted_seat(tmp_path, capsys):
    model = min(guard.MODEL_ALLOWLIST)
    cfg = {"profiles": {"p": {"experts": {"r": {"model": model}}}}}
    assert guard.check_file(str(tmp_path / "cfg.json"), cfg) is True
    assert "allowlisted" in capsys.readouterr().out


def test_check_file_rejects_unknown_hosted_seat(tmp_path, capsys):
    cfg = {"profiles": {"p": {"experts": {"r": {"model": "not-a-seat"}}}}}
    assert guard.check_file(str(tmp_path / "cfg.json"), cfg) is False
    assert "FAIL" in capsys.readouterr().out
