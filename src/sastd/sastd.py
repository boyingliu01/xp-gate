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


def _handle_scan(request):
    """Run one scan through semgrep's in-process API."""
    # Imported lazily so `ping` answers immediately. A caller probing readiness
    # should not have to wait for the import it is about to amortise anyway --
    # and if the import itself fails, that error belongs to `scan`, where the
    # caller knows how to fall back.
    from pathlib import Path

    from semgrep.run_scan import run_scan_and_return_json

    config = Path(request["config"])
    roots = [Path(p) for p in request["roots"]]

    result = run_scan_and_return_json(config=config, scanning_roots=roots)

    # The API returns a dict today and a JSON string in some versions; accept both
    # rather than pinning to one internal detail.
    if isinstance(result, str):
        return json.loads(result)
    return result


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
