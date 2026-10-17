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

# Seat models that are NOT local but remain explicitly permitted. The user's
# standing rule is local-only seats; this allowlist exists so a future hosted
# seat requires an intentional, reviewable edit here (walkthrough R8 CI-01:
# the guard and the loaders must agree on what is legal).
MODEL_ALLOWLIST: set[str] = set()

CONFIGS = [
    os.path.expanduser("~/.config/xp-gate/.delphi-config.json"),
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".delphi-config.json"),
    # The loader's third resolution tier: a project-local override in the
    # current directory, when it is neither of the two paths above
    # (walkthrough R9 MA-02: guard coverage must match loader resolution).
    os.path.join(os.getcwd(), ".delphi-config.json"),
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
        allowed = local or model in MODEL_ALLOWLIST
        mark = "OK  " if allowed else "FAIL"
        if not allowed:
            ok = False
        note = "" if local else (" (allowlisted)" if allowed else "")
        print(f"{mark} [{os.path.basename(os.path.dirname(path))}] profile={profile} role={role} model={model}{note}")
    return ok


def probe_one_seat(base, key, role, model):
    """One chat completion proving the seat resolves. Returns ok."""
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
        # timeout is mandatory (R9 FC-02): an unresponsive gateway must
        # fail the check, never hang a CI pipeline.
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        # A 200 whose body carries no model id means the seat did not
        # actually resolve — status alone is not proof (R9 MA-01).
        resolved = payload.get("model") or payload.get("data", [{}])[0].get("id", "")
        print(f"PROBE OK   role={role} model={model} -> resolved={resolved or 'NO-MODEL-FIELD'}")
        return bool(resolved)
    except urllib.error.HTTPError as exc:
        # 401/403 = credential problem, not a missing model; report it
        # distinctly so one misconfigured key does not read as 3 dead
        # seats (R9 MA-01).
        kind = "AUTH" if exc.code in (401, 403) else f"HTTP {exc.code}"
        print(f"PROBE FAIL role={role} model={model} -> {kind}")
        return False
    except Exception as exc:  # noqa: BLE001 - report any transport failure
        print(f"PROBE FAIL role={role} model={model} -> ERR {exc}")
        return False


def active_profile(cfg):
    """Resolve the active profile exactly like the loaders do. Probing every
    profile iterated wrong gateways and stale seat lists — a 401 from an
    inactive profile used to fail the whole guard while its real target never
    got tested (R9 CI-01 follow-up)."""
    profiles = cfg.get("profiles", {})
    active_name = cfg.get("active_profile") or ("default" if "default" in profiles else None)
    return profiles.get(active_name)


def probe(cfg_by_path):
    key = (os.environ.get("WHALECLOUD_API_KEY") or "").strip()
    if not key:
        print("PROBE SKIP: WHALECLOUD_API_KEY not set")
        return True
    ok = True
    for path, cfg in cfg_by_path.items():
        prof = active_profile(cfg)
        if not prof:
            print(f"PROBE SKIP {path}: no resolvable active profile (active_profile={cfg.get('active_profile')!r})")
            continue
        base = None
        for prov in prof.get("providers", {}).values():
            base = prov.get("base_url")
        if not base:
            continue
        experts = prof.get("experts", {})
        items = experts.items() if isinstance(experts, dict) else [(e.get("role", i), e) for i, e in enumerate(experts)]
        for role, seat in items:
            ok = probe_one_seat(base, key, role, str(seat.get("model") or "")) and ok
    return ok


def main():
    ok = True
    found = {}
    # Dedupe: the cwd config usually IS the repo-root or global file (R9 CI-01
    # flagged the empty allowlist as making a second rule look permissive — one
    # read path, one verdict source keeps guard semantics unambiguous).
    for path in dict.fromkeys(os.path.realpath(p) for p in CONFIGS):
        # Read once, guarded (walkthrough R8 FC-01): a config deleted between
        # check_file's existence test and this load used to crash the guard.
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            found[path] = json.load(fh)
        ok = check_file(path) and ok
    if "--probe" in sys.argv:
        ok = probe(found) and ok
    print("RESULT:", "ALL SEATS LOCAL" if ok else "NON-LOCAL SEAT FOUND")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
