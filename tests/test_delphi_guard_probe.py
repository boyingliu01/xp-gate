"""Gateway probing: transport failures and seat resolution proof.

Part of the #717 guard test suite, split so no module exceeds the
clean-code.many-exports ceiling (10). Together the files cover 99% of
scripts/check_delphi_local_models.py.
"""

import sys
from pathlib import Path

import check_delphi_local_models as guard

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))


# --- probe_one_seat (transport failures must return False, never raise) ----


def test_probe_one_seat_returns_false_on_transport_error(monkeypatch, capsys):
    def boom(*_a, **_kw):
        raise OSError("connection refused")

    monkeypatch.setattr(guard.urllib.request, "urlopen", boom)
    assert guard.probe_one_seat("http://x", "k", "r", "m") is False
    assert "PROBE FAIL" in capsys.readouterr().out


def test_probe_one_seat_returns_false_on_auth_error(monkeypatch, capsys):
    class Err(Exception):
        code = 401

    import urllib.error

    def boom(*_a, **_kw):
        raise urllib.error.HTTPError("u", 401, "no", {}, None)

    monkeypatch.setattr(guard.urllib.request, "urlopen", boom)
    assert guard.probe_one_seat("http://x", "k", "r", "m") is False
    assert "AUTH" in capsys.readouterr().out


# --- probe ----------------------------------------------------------------


def test_probe_skips_without_api_key(monkeypatch, capsys):
    monkeypatch.delenv("WHALECLOUD_API_KEY", raising=False)
    assert guard.probe({}) is True
    assert "PROBE SKIP" in capsys.readouterr().out


def test_probe_skips_when_active_profile_unresolvable(monkeypatch, capsys):
    monkeypatch.setenv("WHALECLOUD_API_KEY", "k")
    assert guard.probe({"cfg": {"profiles": {}}}) is True
    assert "no resolvable active profile" in capsys.readouterr().out


def test_probe_fails_when_seat_provider_is_ambiguous(monkeypatch, capsys):
    monkeypatch.setenv("WHALECLOUD_API_KEY", "k")
    cfg = {
        "active_profile": "p",
        "profiles": {
            "p": {
                "providers": {
                    "a": {"base_url": "http://a"},
                    "b": {"base_url": "http://b"},
                },
                "experts": {"r": {"model": "m"}},
            }
        },
    }
    assert guard.probe({"cfg": cfg}) is False
    assert "unresolved among" in capsys.readouterr().out


def test_probe_inherits_sole_provider(monkeypatch, capsys):
    monkeypatch.setenv("WHALECLOUD_API_KEY", "k")
    seen = {}

    def fake(base, key, role, model):
        seen["base"] = base
        return True

    monkeypatch.setattr(guard, "probe_one_seat", fake)
    cfg = {
        "active_profile": "p",
        "profiles": {
            "p": {
                "providers": {"only": {"base_url": "http://only"}},
                "experts": {"r": {"model": "m"}},
            }
        },
    }
    assert guard.probe({"cfg": cfg}) is True
    assert seen["base"] == "http://only"
