# SRC/NPM-PACKAGE KNOWLEDGE BASE

**Updated:** 2026-11-17

> **What this file is for.** This directory is a *build output that is also
> committed* — the riskiest kind of tree to document. It carries the npm
> distribution and holds byte-identical mirrors of `githooks/`, `plugins/`,
> `skills/` and several `src/` modules, regenerated at prepack time.
>
> Counts, file lists and CLI inventories are deliberately absent. They were here
> before and drifted silently — an adapter count that read 13 when there were 14,
> a "≥15 CLI subcommands" figure, a skill count of 8 when there are 12. Every one
> of them was true when written. Ask the code instead:
>
> | Question | Answer |
> |---|---|
> | CLI surface | `xp-gate --help`, or read `bin/xp-gate.js` |
> | Gate name ↔ deciding file | `gate-registry.sh` (mirrored from `githooks/`) |
> | Mirror drift | `xp-gate sync-mirrors` (dry-run by default) |
> | What actually ships | `npm pack --dry-run` |

## THE ONE RULE THAT MATTERS HERE

**This directory is downstream. Edit upstream, then resync.**

| If you touched this here | The canonical source is |
|---|---|
| `adapters/*.sh`, `hooks/**`, `gate-*.sh` | `githooks/**` |
| `plugins/**` | `plugins/**` |
| `skills/**` | `skills/**` |
| `principles/**` | `src/principles/**` |
| `build-integrity/**`, `mutation/**`, `mock-policy/**`, `gates/**` | the sibling `src/<same>/` |

Prepack regenerates the mirrors, so a mirror-only fix is **silently reverted at
the next publish**. This is not hypothetical: a release once shipped with the fix
present in the working tree and absent from the tarball while every local check
stayed green.

First hypothesis when a change "didn't take effect": the CLI you ran is executing
*this* copy while your edit landed upstream.

## DESIGN INTENT

### Zero runtime dependencies

The package is installed transiently (`npx`, `npm i -g`) into environments where
a dependency tree cannot be assumed, and it has to work before anything is
installed in the consumer repo. A runtime `dependencies` entry breaks that
promise. Build-time and dev-time dependencies are fine.

Two consequences that are easy to forget:

- Shell hooks and adapters must **degrade gracefully** when a tool is absent —
  this is where the SKIP contract comes from, and why an unavailable tool must
  never be reported as a clean result.
- `.js` over `.ts` for CLI lib files is deliberate: they must run on raw Node
  with no transpile step at install time. The few `.ts` files are loaded on
  demand through `tsx`, and only for the subcommands that need them.

### Hooks are shipped, not installed by a package manager

`init` / `update-hooks` copy hook scripts into the consumer project or a shared
hooks directory. That copying is why mirror drift exists at all, and why `doctor`
must report which copy actually executes.

**The hooks shipped from here are the product.** A defect in them reaches every
consumer and will present as a git problem rather than a packaging problem.

### The bundle is asserted, not assumed

Build integrity (pack, module reachability) runs as a gate. A change that breaks
the tarball must fail locally, never at publish — publishing is the one step that
cannot be quietly undone.

### Advisory commands exit 0

Diagnostics (`rework`, `crap`, `runtime-journal`, `audit`) are advisory by
design; a script that gates on them would turn "here is information" into "here
is a verdict". Gate commands are the ones allowed to fail. When adding a
subcommand, decide deliberately which of those two it is.

## TRAPS

- **A green local test run does not prove the tarball is correct.** Mirrors are
  regenerated at pack time — test what ships, not what is in the tree.
- **`node_modules/` here is not part of the package**, and its presence says
  nothing about runtime availability.
- **The platform plugins genuinely differ in shape.** The DSH plugin carries its
  own package, build config and client directory; the others are lighter. Do not
  "unify" them without checking what each host actually loads.
- **Package name, version and manifest fields are generated.** Version flows from
  the repo-root `VERSION`; hand-editing a manifest version is both overwritten and
  blocked by the version-consistency gate.
- **A new subcommand has more than one registration point.** The dispatch switch
  alone is not enough — the manifest, the README and the help text all describe
  the same surface and are not generated from it. Missing one makes the feature
  invisible.

## ANTI-PATTERNS

- Do NOT edit a mirror. Edit upstream and resync.
- Do NOT add runtime dependencies.
- Do NOT hand-edit version fields.
- Do NOT skip the prepack content sync — the published artifact silently loses
  the bundled skills and plugins.
- Do NOT assume the hooks here are what runs on this machine; verify with
  `xp-gate doctor`.
- Do NOT record counts or inventories in this file. They change with every
  upstream edit, and a mirror cannot be trusted to stay in step.