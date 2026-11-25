"""Probing a Delphi seat's gateway: does this seat actually resolve?

Split out of `check_delphi_local_models.py` when that script's module surface grew past
the `many-exports` limit -- a SCRIPT should not advertise twenty helpers as API.

The rules this module enforces are the ones a wrong guess would break:

  * route each seat through ITS OWN provider; only a profile with exactly ONE provider
    may have a seat inherit it, because guessing could probe against the wrong gateway
    (R11 MA-01);
  * a 200 whose body carries no model id means the seat did NOT resolve -- status alone
    is not proof (R9 MA-01);
  * a 401/403 is a CREDENTIAL problem, reported distinctly so one bad key does not read
    as three dead seats (R9 MA-01);
  * the timeout is mandatory (R9 FC-02): an unresponsive gateway must fail the check,
    never hang a CI pipeline.
"""

import json
import urllib.error
import urllib.request

# The seat policy lives with the CHECK, not with the probe: these two are what
# a verdict is judged against, and they move only when that judgement changes.
from check_delphi_seat_policy import LOCAL_PREFIX, MODEL_ALLOWLIST


def seat_model(seat):
    """The model a seat names, preferring `model` over the older `requested_model`."""
    return str(seat.get("model") or seat.get("requested_model") or "")


def seat_verdict(model):
    """How this model is allowed, and what to note beside it.

    The NOTE distinguishes the two allowed outcomes: a local model is allowed by POLICY,
    an allowlisted one by a DECISION recorded in this file. Printing both as a bare OK
    would hide which rule kept it in.
    """
    if model.lower().startswith(LOCAL_PREFIX):
        return True, ""
    if model in MODEL_ALLOWLIST:
        return True, " (allowlisted)"
    return False, ""


def build_probe_request(base, key, model):
    """The minimal chat completion that proves a seat resolves.

    `max_tokens: 4` keeps the probe cheap: the question is whether the model is
    REACHABLE through this gateway, not whether it can answer well.
    """
    body = json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": "reply OK"}],
            "max_tokens": 4,
        }
    ).encode()
    return urllib.request.Request(
        base.rstrip("/") + "/v1/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
    )


def resolved_model_of(payload):
    """The model id the gateway says it used, or ''.

    A 200 whose body carries no model id means the seat did NOT resolve -- status alone
    is not proof (R9 MA-01).
    """
    return payload.get("model") or payload.get("data", [{}])[0].get("id", "")


def probe_one_seat(base, key, role, model):
    """One chat completion proving the seat resolves. Returns ok."""
    req = build_probe_request(base, key, model)
    try:
        # timeout is mandatory (R9 FC-02): an unresponsive gateway must
        # fail the check, never hang a CI pipeline.
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        resolved = resolved_model_of(payload)
        print(
            f"PROBE OK   role={role} model={model} -> resolved={resolved or 'NO-MODEL-FIELD'}"
        )
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


def resolve_base_url(seat, prof, providers):
    """The base_url a seat should be probed against, or None when ambiguous.

    Route each seat through ITS OWN provider (R10 CI-01); only when the profile
    declares exactly ONE provider may a seat without an explicit provider inherit
    it. With several providers an unspecified seat is a FAIL -- guessing could probe
    (or ship) against the wrong gateway (R11 MA-01).

    Returns None rather than a guess when the seat's provider is unresolved AND the
    profile has more than one candidate: two gateways and no way to tell which one
    is a question for the operator, not something to settle by picking one.
    """
    # The seat's own provider wins; a profile-level default is the fallback.
    provider_name = seat.get("provider") or prof.get("provider") or ""
    base = providers.get(provider_name, {}).get("base_url")
    if base:
        return base
    candidates = distinct_base_urls(providers)
    return candidates.pop() if len(candidates) == 1 else None


def distinct_base_urls(providers):
    """Every distinct non-empty base_url the profile declares."""
    return {p.get("base_url") for p in providers.values() if p.get("base_url")}


def probe_profile(path, cfg, key):
    """Probe every seat of one config file. Returns False on any failed seat."""
    prof = active_profile(cfg)
    if not prof:
        print(
            f"PROBE SKIP {path}: no resolvable active profile (active_profile={cfg.get('active_profile')!r})"
        )
        return True

    providers = prof.get("providers", {})
    ok = True
    for role, seat in seat_items(prof.get("experts", {})):
        ok = probe_seat(role, seat, prof, providers, key) and ok
    return ok


def probe_seat(role, seat, prof, providers, key):
    """Probe one seat, naming the reason when it could not be routed at all."""
    base = resolve_base_url(seat, prof, providers)
    if not base:
        print(
            f"PROBE FAIL role={role}: provider {seat.get('provider')!r} unresolved among {len(providers)} providers"
        )
        return False
    return probe_one_seat(base, key, role, seat_model(seat))


def probe(cfg_by_path):
    key = (os.environ.get("WHALECLOUD_API_KEY") or "").strip()
    if not key:
        print("PROBE SKIP: WHALECLOUD_API_KEY not set")
        return True
    ok = True
    for path, cfg in cfg_by_path.items():
        ok = probe_profile(path, cfg, key) and ok
    return ok