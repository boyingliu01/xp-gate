"""The seat policy a Delphi config is judged against.

Kept in its own module so the checker and the probe can both read it without one
importing the other -- a cycle that Python resolves by handing out a partially
initialised module.
"""

import os

LOCAL_PREFIX = "local-"

MODEL_ALLOWLIST: set[str] = {
    # Kept as an explicit list, not a wildcard, so a future seat change still
    # requires an intentional edit here. Two separate decisions put entries in
    # this set, and both stay:
    #
    # #717 (2026-11-04): the guard had drifted behind the config and reported
    # SEAT VIOLATION on the very seats a review had just run on -- the failure
    # mode this list exists to prevent, one level up. The guard complained first,
    # so the sanctioned seats are recorded here.
    "s-qwen3.8-flash",
    # 2026-11-04: all three seats moved to hosted FLASH-tier models on the same
    # WhaleCloud gateway. The local deployments are re-tuned often enough that a
    # pinned local seat goes stale faster than a sprint, and a review whose seat
    # silently changes model mid-sprint cannot be trusted. Three DIFFERENT flash
    # models were chosen for cost while keeping the multi-model invariant: the ids
    # resolve to three distinct backends (deepseek-flash / glm-5-3-flash-260828 /
    # Ling-3.1-flash-DTMaaS), verified through the gateway-reported
    # `resolved_model` rather than the id text, because two distinct ids can alias
    # to one backend and quietly reduce the review to two models.
    "s-deepseek-v4.1-flash",
    "s-glm-5.3-flash",
    "g-ling-3.1-flash",
}
