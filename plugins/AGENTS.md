# PLUGINS KNOWLEDGE BASE

**Updated:** 2026-11-17

> **Scope.** Four host platforms, one shared skill corpus. This file records the
> constraints that make the shapes different and the traps that make edits
> disappear. Inventories are not here on purpose.
>
> The previous revision warned — with warning markers and an issue list — that
> three of the four platforms shipped only a single skill, that one had no
> manifest, and that the bundles were incomplete. Every one of those entries was
> stale: all platforms now carry the full corpus, and the manifest gap is closed.
> A "known issues" section that is not pruned converts into misinformation with
> the passage of time, which is worse than having none.
>
> | Question | Answer |
> |---|---|
> | What a platform ships | the platform's `skills/` directory, or `scripts/build-plugin.sh` |
> | Package/manifest identity | each platform's own `package.json` / manifest |
> | Whether the bundles agree | `node scripts/test-plugins.mjs` |

## THE CORE CONSTRAINT

**`plugins/*/skills/` is generated. `skills/` at the repo root is canonical.**

Editing a platform's skills directory is editing a build artifact: the next
build overwrites it, and the change is gone with no error. Edit
`skills/<name>/`, then rebuild.

The same applies to the byte-identical `AGENTS.md` copies that ride along inside
each skill directory — they are copies, not sources.

## WHY THE PLATFORMS GENUINELY DIFFER

This is the part people try to "clean up" and should not.

**Claude Code** — JSON manifest plus shell hooks. No compilation. Its hooks are
the IDE-side enforcement of review gates, not a convenience: they run on tool use
and stop an edit that a gate has not authorised. That enforcement only works
while the hook is registered; a hook that fails to load silently downgrades the
whole platform to advisory.

**OpenCode** — a TypeScript module published as a package, exposing gate tools
that shell out to the CLI. It has a real build step and a real artifact.

**Qoder** — skills-only. No hooks, no compiled entrypoint. Its capability ceiling
is what a skill can instruct, not what a process can enforce.

**DSH** — carries its own package, build configuration and client directory; the
heaviest integration of the four.

Three shapes, three enforcement levels. A change that works on one is not
evidence for another.

## DESIGN INTENT

### Graceful degradation, everywhere

Every entrypoint must still work when the `xp-gate` CLI is not on PATH. Plugins
are installed into other people's environments where the tool may be absent,
misconfigured or mid-upgrade. A plugin that hard-fails on a missing dependency
turns an optional convenience into a broken editor.

The direction of degradation matters: **degrade toward doing less, never toward
claiming success.** An unavailable check must report that it did not run, not
that the code is clean.

### One skill corpus, four delivery mechanisms

The corpus is shared so that a rule fixed once is fixed everywhere. Any
platform-specific variant of a skill reintroduces the drift the shared corpus
exists to prevent.

Corollary: when a platform cannot express something (no hooks in a skills-only
host), that platform gets a **weaker** guarantee, not a different rule.

### The guard is only as real as its registration

A review guard implemented as a hook enforces nothing if the hook is not wired
up, and nothing reports the omission — the platform simply behaves as if the
guard passed. Verify registration, not just the script's existence.

## TRAPS

- **Editing generated skill directories.** Silent, total loss at next build.
- **Assuming hosts load the same way.** Manifest file names, hook schemas and
  packaging differ; a copied-and-renamed config is a plugin that never activates.
- **Trusting a green test suite to mean the plugin works.** The test script
  validates structure and degradation, not that the host loaded the artifact.
  Installation in a real host is the only proof of activation.
- **Leaving stale known-issue lists in documentation.** They read as current
  fact. If an issue is fixed, delete the entry rather than marking it resolved;
  a long "resolved" history becomes indistinguishable from a live list.
- **Putting shared logic in a platform directory.** Anything genuinely shared
  belongs in `shared/` or the root corpus, or it will be duplicated four times
  and fixed three of them.

## ANTI-PATTERNS

- Do NOT edit `plugins/*/skills/` — rebuild from the canonical corpus.
- Do NOT put platform-specific logic in `shared/`.
- Do NOT remove or bypass the Delphi guard hook; it is the enforcement edge.
- Do NOT assume the CLI exists in the consumer's environment.
- Do NOT add a platform by copying an existing one. Determine how the target host
  discovers plugins, then implement that.
- Do NOT keep resolved issues in the documentation as live warnings.

## COMMANDS

```bash
npm run build:plugins                                  # all platforms
bash scripts/build-plugin.sh --platform claude-code    # one platform
bash scripts/build-plugin.sh --platform opencode
bash scripts/build-plugin.sh --platform qoder

node scripts/test-plugins.mjs                          # structure + degradation
```

Build and test prove the artifact is well-formed. They do not prove the host
loads it — install it in the real host before claiming the plugin works.