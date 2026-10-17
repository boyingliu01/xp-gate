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

LOCAL_PREFIX = "local-"

CONFIGS = [
    os.path.expanduser("~/.config/xp-gate/.delphi-config.json"),
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".delphi-config.json"),
]


def iter_seats(cfg):
    profiles = cfg.get("profiles", {})
    active = cfg.get("active_profile")
    names = [active] if active in profiles else list(profiles)
    for name in names:
        prof = profiles[name]
        experts = prof.get("experts", {})
        if isinstance(experts, dict):
            items = experts.items()
        else:
            items = [(e.get("role", i), e) for i, e in enumerate(experts)]
        for role, seat in items:
            yield name, role, seat


def check_file(path):
    if not os.path.exists(path):
        print(f"SKIP {path} (absent)")
        return True
    with open(path, encoding="utf-8") as fh:
        cfg = json.load(fh)
    ok = True
    for profile, role, seat in iter_seats(cfg):
        model = str(seat.get("model") or seat.get("requested_model") or "")
        local = model.lower().startswith(LOCAL_PREFIX)
        mark = "OK  " if local else "FAIL"
        if not local:
            ok = False
        print(f"{mark} [{os.path.basename(os.path.dirname(path))}] profile={profile} role={role} model={model}")
    return ok


def probe(cfg_by_path):
    key = (os.environ.get("WHALECLOUD_API_KEY") or "").strip()
    if not key:
        print("PROBE SKIP: WHALECLOUD_API_KEY not set")
        return True
    ok = True
    for path, cfg in cfg_by_path.items():
        base = None
        for prof in cfg.get("profiles", {}).values():
            for prov in prof.get("providers", {}).values():
                base = prov.get("base_url")
        if not base:
            continue
        for _profile, role, seat in iter_seats(cfg):
            model = str(seat.get("model") or "")
            body = json.dumps({
                "model": model,
                "messages": [{"role": "user", "content": "reply OK"}],
                "max_tokens": 4,
            }).encode()
            req = urllib.request.Request(
                base.rstrip("/") + "/v1/chat/completions",
                data=body,
                headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
            )
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    code = resp.status
            except Exception as exc:  # noqa: BLE001 - report any transport failure
                code = f"ERR {exc}"
                ok = False
            print(f"PROBE {'OK  ' if code == 200 else 'FAIL'} role={role} model={model} -> {code}")
    return ok


def main():
    ok = True
    found = {}
    for path in CONFIGS:
        ok = check_file(path) and ok
        if os.path.exists(path):
            found[path] = json.load(open(path, encoding="utf-8"))
    if "--probe" in sys.argv:
        ok = probe(found) and ok
    print("RESULT:", "ALL SEATS LOCAL" if ok else "NON-LOCAL SEAT FOUND")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
