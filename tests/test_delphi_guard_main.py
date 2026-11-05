"""The main() CLI contract the hook and humans both rely on.

Part of the #717 guard test suite, split so no module exceeds the
clean-code.many-exports ceiling (10). Together the files cover 99% of
scripts/check_delphi_local_models.py.
"""

import json
import sys
from pathlib import Path

import check_delphi_local_models as guard

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))


# --- main (the CLI contract the hook and humans both rely on) --------------


def test_main_returns_zero_when_all_seats_allowed(monkeypatch, tmp_path, capsys):
    cfgp = tmp_path / "c.json"
    model = min(guard.MODEL_ALLOWLIST)
    cfgp.write_text(
        json.dumps({"profiles": {"p": {"experts": {"r": {"model": model}}}}}),
        encoding="utf-8",
    )
    monkeypatch.setattr(guard, "CONFIGS", [str(cfgp)])
    monkeypatch.setattr(guard.sys, "argv", ["guard"])
    assert guard.main() == 0
    assert "ALL SEATS ALLOWED" in capsys.readouterr().out


def test_main_returns_one_on_seat_violation(monkeypatch, tmp_path, capsys):
    cfgp = tmp_path / "c.json"
    cfgp.write_text(
        json.dumps({"profiles": {"p": {"experts": {"r": {"model": "nope"}}}}}),
        encoding="utf-8",
    )
    monkeypatch.setattr(guard, "CONFIGS", [str(cfgp)])
    monkeypatch.setattr(guard.sys, "argv", ["guard"])
    assert guard.main() == 1
    assert "SEAT VIOLATION FOUND" in capsys.readouterr().out


def test_main_skips_absent_config_without_failing(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(guard, "CONFIGS", [str(tmp_path / "absent.json")])
    monkeypatch.setattr(guard.sys, "argv", ["guard"])
    assert guard.main() == 0
    out = capsys.readouterr().out
    assert "absent" in out and "ALL SEATS ALLOWED" in out


def test_main_fails_on_invalid_config(monkeypatch, tmp_path, capsys):
    bad = tmp_path / "bad.json"
    bad.write_text("{nope", encoding="utf-8")
    monkeypatch.setattr(guard, "CONFIGS", [str(bad)])
    monkeypatch.setattr(guard.sys, "argv", ["guard"])
    assert guard.main() == 1
    assert "invalid config" in capsys.readouterr().out


def test_main_runs_probe_only_when_asked(monkeypatch, tmp_path, capsys):
    """--probe is opt-in: the seat check alone must not open a socket."""
    cfgp = tmp_path / "c.json"
    model = min(guard.MODEL_ALLOWLIST)
    cfgp.write_text(
        json.dumps({"profiles": {"p": {"experts": {"r": {"model": model}}}}}),
        encoding="utf-8",
    )
    monkeypatch.setattr(guard, "CONFIGS", [str(cfgp)])
    called = []
    monkeypatch.setattr(guard, "probe", lambda f: called.append(1) or True)

    monkeypatch.setattr(guard.sys, "argv", ["guard"])
    guard.main()
    assert called == [], "probe ran without --probe"

    monkeypatch.setattr(guard.sys, "argv", ["guard", "--probe"])
    guard.main()
    assert called == [1], "probe did not run with --probe"


def test_probe_one_seat_reports_resolved_model(monkeypatch, capsys):
    """A 200 with a model field proves the seat resolved."""

    class Resp:
        def read(self):
            return json.dumps({"model": "resolved-id"}).encode()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(guard.urllib.request, "urlopen", lambda *a, **k: Resp())
    assert guard.probe_one_seat("http://x", "k", "r", "m") is True
    assert "resolved-id" in capsys.readouterr().out


def test_probe_one_seat_rejects_200_without_model(monkeypatch, capsys):
    """Status alone is not proof (R9 MA-01)."""

    class Resp:
        def read(self):
            return b"{}"

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(guard.urllib.request, "urlopen", lambda *a, **k: Resp())
    assert guard.probe_one_seat("http://x", "k", "r", "m") is False
    assert "NO-MODEL-FIELD" in capsys.readouterr().out
