#!/usr/bin/env python3
"""Guard: every Delphi expert seat must resolve to a LOCAL gateway model.

The whalecloud gateway exposes ~200 models including expensive overseas ones
(claude/gpt/gemini/grok). delphi-external-review.cjs sends the config's model
field verbatim with zero whitelist, so a drifted .delphi-config.json can burn
the daily quota silently (2026-10-03 incident: 78 calls, 100 CNY/day cap).

This script checks every config location it can find and optionally probes the
gateway /v1/models + one chat call per seat to prove resolution.

Usage:
    python scripts/check_delphi_local_models.py            # check files only
    python scripts/check_delphi_local_models.py --probe    # also probe gateway
"""

import json
import os
import sys
import urllib.request

from check_delphi_seat_probe import probe, seat_model, seat_verdict

from check_delphi_seat_policy import LOCAL_PREFIX, MODEL_ALLOWLIST, active_profile, seat_items

CONFIGS = [
    os.path.expanduser("~/.config/xp-gate/.delphi-config.json"),
    os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        ".delphi-config.json",
    ),
    # The loader's third resolution tier: a project-local override in the
    # current directory, when it is neither of the two paths above
    # (walkthrough R9 MA-02: guard coverage must match loader resolution).
    os.path.join(os.getcwd(), ".delphi-config.json"),
]


def profile_names(cfg):
    """The profiles to inspect: the active one when present, else ALL of them.

    The fallback is deliberate: a config whose `active_profile` names nothing still has
    seats worth checking, and checking NONE would report it as clean.
    """
    profiles = cfg.get("profiles", {})
    active = cfg.get("active_profile")
    return [active] if active in profiles else list(profiles)




def iter_seats(cfg):
    profiles = cfg.get("profiles", {})
    for name in profile_names(cfg):
        for role, seat in seat_items(profiles[name].get("experts", {})):
            yield name, role, seat






def check_file(path, cfg):
    ok = True
    label = os.path.basename(os.path.dirname(path))
    for profile, role, seat in iter_seats(cfg):
        model = seat_model(seat)
        allowed, note = seat_verdict(model)
        ok = ok and allowed
        print(f"{'OK  ' if allowed else 'FAIL'} [{label}] profile={profile} role={role} model={model}{note}")
    return ok










def load_json(path):
    """Parse a config, reporting problems as a clean FAIL instead of a
    traceback (R10 FC-02/FC-03): the exists()-then-open() dance crashed when
    a file vanished mid-run, and malformed JSON escaped as JSONDecodeError."""
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as exc:
        print(f"FAIL [{path}] invalid config: {exc}")
        return False














def unique_config_paths():
    """The config paths to inspect, de-duplicated by REAL path.

    The cwd config usually IS the repo-root or global file, so reading it twice would
    report the same seats twice and make one verdict look like two (R9 CI-01).
    """
    return list(dict.fromkeys(os.path.realpath(p) for p in CONFIGS))


def scan_configs():
    """Load and check every present config. Returns (ok, loaded configs)."""
    ok = True
    found = {}
    for path in unique_config_paths():
        cfg = load_json(path)
        if cfg is None:  # absent: nothing to check here
            print(f"SKIP {path} (absent)")
            continue
        if cfg is False:  # invalid: loud FAIL, no traceback (R10 FC-03)
            ok = False
            continue
        found[path] = cfg
        ok = check_file(path, cfg) and ok
    return ok, found


def main():
    ok, found = scan_configs()
    if "--probe" in sys.argv:
        ok = probe(found) and ok
    print("RESULT:", "ALL SEATS ALLOWED" if ok else "SEAT VIOLATION FOUND")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
