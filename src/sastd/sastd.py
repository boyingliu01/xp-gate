#!/usr/bin/env python3
"""xp-gate SAST daemon: keep one semgrep process alive instead of paying import tax per run.

A direct `semgrep scan` costs ~3.8-4.0s on this machine, and the bill is almost
entirely Python import tax -- `semgrep --version` alone takes 2.4-2.8s. Measured
in-process: the first import costs ~1.3s, every scan after that costs ~2.1s and
the second in-process import of `semgrep.commands.scan` is free.

So the tax is real, and it is reusable. This process pays it once and then answers
scan requests over a line-delimited JSON protocol.

PROTOCOL (one JSON object per line, both directions)
    request  {"op":"ping"}
    reply    {"ok":true,"data":{"version":...}}

    request  {"op":"scan","config":"/abs/rules.yml","roots":["/abs/file.js"]}
    reply    {"ok":true,"data":{...}}          semgrep's own JSON, unmodified
    reply    {"ok":false,"error":"..."}        never a crash, never a silent pass

WHY THIS USES AN INTERNAL SEMGREP MODULE
`semgrep.run_scan.run_scan_and_return_json` is not public API and semgrep has made
no stability promise about it. That is a known, accepted risk -- which is exactly
why the caller treats every failure here as "fall back to a real direct scan",
never as "the scan passed". A daemon that cannot answer must be invisible, not
authoritative.

The alternative carriers were checked and rejected:
  - `semgrep mcp` returns 401 without SEMGREP_APP_TOKEN, so it is unusable offline.
  - `semgrep lsp` speaks a diagnostics protocol built for editors, not a verdict
    interface, and gate-10's existing verdict parser would have to be rewritten.
"""

import json
import sys
import traceback


def _emit(payload):
    """Write one reply line and flush.

    Flushing matters more than it looks: the caller blocks on a read, so a reply
    left in the buffer is indistinguishable from a hang until the timeout fires.
    """
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


# Resolved registry configs, keyed by the spec string ("p/security-audit").
#
# WHY THIS CACHE EXISTS: `run_scan_and_return_json` takes a `pathlib.Path` and
# therefore accepts only a LOCAL rules file. Gate 10's default is a registry
# reference, so passing it straight through fails with "invalid configuration
# file". Resolving it costs a network round trip (~6s for 225 rules), which is
# exactly the kind of per-run cost this daemon exists to remove -- so it is
# resolved once and kept for the life of the process.
#
# The cache is deliberately never invalidated. Rules changing under a long-lived
# process is a real tradeoff, accepted because the alternative (re-resolving every
# run) restores the cost we are removing; a daemon restart picks up new rules.
# Maps a config spec to the local path it was materialised as.
_resolved_configs: dict[str, object] = {}


def _resolve_config(spec):
    """Turn a semgrep config spec into something the scan API accepts.

    Registry references ("p/security-audit") are resolved through semgrep's own
    resolver -- the same one the CLI uses -- rather than reimplemented here.
    Local paths pass through untouched.
    """
    from pathlib import Path

    cached = _resolved_configs.get(spec)
    if cached is not None:
        return cached

    candidate = Path(spec)
    if candidate.exists():
        # A real file: give the API exactly what it expects.
        _resolved_configs[spec] = candidate
        return candidate

    from semgrep.config_resolver import Config

    config, errors = Config.from_config_list([spec], project_url=None)
    if errors:
        raise RuntimeError(f"could not resolve config {spec!r}: {errors[0]}")

    # The resolved Config must be handed over as a FILE, not an object:
    # run_scan_and_return_json does `config_strs=[str(config)]`, so passing the
    # object would interpolate its repr and be rejected as an invalid config.
    # Writing the resolved rules to a temp file is what makes a registry spec
    # usable through an API that only understands paths.
    import tempfile

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".yml", prefix="xp-gate-rules-", delete=False, encoding="utf8"
    ) as handle:
        handle.write(_render_rules(config))
        resolved = Path(handle.name)

    _resolved_configs[spec] = resolved
    return resolved


def _render_rules(config):
    """Serialise a resolved semgrep Config back to rule YAML.

    semgrep's own rule objects carry the original YAML, so the round trip can
    reuse it instead of re-deriving structure we would only get wrong.
    """
    import yaml

    rules = []
    for rule in config.get_rules(True):
        raw = getattr(rule, "raw", None)
        if raw:
            # `raw` is the rule as semgrep parsed it, minus the top-level key.
            rules.append(raw)
    return yaml.safe_dump({"rules": rules}, sort_keys=False, allow_unicode=True)


def _handle_scan(request):
    """Run one scan through semgrep's in-process API."""
    # Imported lazily so `ping` answers immediately. A caller probing readiness
    # should not have to wait for the import it is about to amortise anyway --
    # and if the import itself fails, that error belongs to `scan`, where the
    # caller knows how to fall back.
    from pathlib import Path

    from semgrep.run_scan import run_scan_and_return_json

    config = _resolve_config(request["config"])
    roots = [Path(p) for p in request["roots"]]

    result = run_scan_and_return_json(config=config, scanning_roots=roots)

    # The API returns a dict today and a JSON string in some versions; accept both
    # rather than pinning to one internal detail.
    if isinstance(result, str):
        result = json.loads(result)

    result = _clean_check_ids(result, config)
    return _verify_coverage(result, roots)


def _verify_coverage(payload, roots):
    """Refuse to hand back a scan that did not actually look at the roots.

    THE FAILURE THIS BLOCKS is the quiet one: semgrep can return a perfectly valid
    document with results:[] and errors:[] after failing to resolve a registry pack
    or skipping every target. The gate reads that as "no findings" and reports PASS.
    A truncated payload is already caught (it fails to parse and the gate fails
    closed), so the danger is not malformed output -- it is well-formed output that
    quietly covers less than it claims.

    The check is deliberately narrow: it reports the roots semgrep says it scanned and
    lets the caller compare. It does not try to be clever about globs or directories,
    because a wrong completeness check is its own kind of failure.
    """

    if not isinstance(payload, dict):
        return payload

    # A payload can omit `paths` entirely or return a non-list there. Treat any shape
    # that is not a list as "scanned nothing known", which is the conservative reading:
    # it routes to SKIP rather than PASS. Assuming an absent field means "everything was
    # fine" is exactly the mistake that makes a thinner scan look clean.
    raw_paths = payload.get("paths")
    raw_scanned = raw_paths.get("scanned") if isinstance(raw_paths, dict) else None
    scanned = raw_scanned if isinstance(raw_scanned, list) else []
    requested = [str(r) for r in roots]
    # Recorded so the caller can compare this run against a direct scan. The daemon
    # cannot express the CLI's --include filter (the in-process API has no equivalent
    # parameter), so it scans whole directories: a SUPERSET of what the direct path
    # looks at. That direction is safe -- a wider scan can report more, never less.
    # It is recorded rather than assumed, because "wider" is only true while the
    # roots are the same, and a future change to root selection would break it
    # silently.
    payload.setdefault("xp_gate_coverage", {})["files_scanned"] = len(scanned)
    payload["xp_gate_coverage"]["roots_requested"] = len(requested)

    if requested and not scanned:
        # Every root was requested, none was scanned. That is never a clean result.
        payload.setdefault("errors", []).append(
            {
                "code": 0,
                "level": "warning",
                "type": "Coverage",
                "message": f"no files were scanned for {len(requested)} requested root(s); "
                "treating as an incomplete scan rather than a clean one",
            }
        )
    return payload


def _config_prefix(config):
    """The flattened directory prefix semgrep puts in front of every check_id.

    Measured: semgrep uses the config FILE'S DIRECTORY and drops the filename --
    Given a rules file in %TEMP%, the prefix is the flattened TEMP directory,
    filename dropped. Three attempts were needed; each wrong version failed the
    same silent way, matching nothing and therefore cleaning nothing:
      - replacing ":" and then "\\" separately produced a double dot, "C..Users";
      - using the whole path left the ".yml" segment in the prefix;
      - only collapsing the two together, from the parent directory, matches.
    """
    from pathlib import Path

    if not isinstance(config, Path):
        return None
    parent = str(Path(str(config)).parent)
    return parent.replace(":", "").replace("/", ".").replace(chr(92), ".").strip(".")


def _clean_check_ids(payload, config):
    """Strip the config-path prefix semgrep adds to every check_id.

    The CLI reports "javascript.lang.security.detect-eval-with-expression"; a scan
    driven by a materialised rules file reports
    "C.Users.think.AppData.Local.Temp.javascript.lang...".

    That prefix is not cosmetic. The baseline keys suppressions on check_id, so a
    prefixed id matches nothing -- every recorded suppression silently stops
    working and old findings start failing the gate again for no visible reason.
    """
    if not isinstance(payload, dict):
        return payload

    prefix = _config_prefix(config)
    if not prefix:
        return payload

    hits = payload.get("results") or []
    for hit in hits:
        cid = hit.get("check_id")
        if isinstance(cid, str) and cid.startswith(prefix):
            hit["check_id"] = cid[len(prefix) :].lstrip(".")

    _flag_unmatched_prefixes(payload, hits, prefix)
    return payload


def _flag_unmatched_prefixes(payload, hits, prefix):
    """Warn when an id still carries the prefix.

    A check_id that does not match the baseline is worse than a visibly
    unprefixed one, because nothing announces the mismatch -- it just stops
    suppressing. Recording the anomaly in `errors` makes it contaminating the
    gate's diagnostics instead of hiding in a report nobody re-reads.
    """
    leftover = [
        h.get("check_id")
        for h in hits
        if isinstance(h.get("check_id"), str) and prefix in h.get("check_id", "")
    ]
    if not leftover:
        return
    payload.setdefault("errors", []).append(
        {
            "code": 0,
            "level": "warning",
            "type": "CheckIdPrefix",
            "message": f"could not normalise {len(leftover)} check_id(s); "
            "baseline matching may be unreliable for this run",
        }
    )


def _handle(request):
    """Dispatch one request. Returns the reply payload; never raises."""
    op = request.get("op")
    if op == "ping":
        return {"ok": True, "data": {"daemon": "xp-gate-sastd"}}
    if op == "scan":
        try:
            return {"ok": True, "data": _handle_scan(request)}
        except Exception as exc:  # noqa: BLE001 -- a reply is required, always
            return {
                "ok": False,
                "error": f"{type(exc).__name__}: {exc}",
                "traceback": traceback.format_exc(),
            }
    return {"ok": False, "error": f"unknown op: {op!r}"}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            _emit({"ok": False, "error": f"bad request JSON: {exc}"})
            continue
        _emit(_handle(request))
    return 0


if __name__ == "__main__":
    sys.exit(main())
