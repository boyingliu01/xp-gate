# SRC/NPM-PACKAGE KNOWLEDGE BASE

**Generated:** 2026-07-23
**Commit:** 0280d4f
**Branch:** main
**Version:** 0.15.3.0

## OVERVIEW
npm distribution package — zero-install CLI for xp-gate. Published as `@boyingliu01/xp-gate` on the public npm registry. Bundles hooks + 13 language adapters + 8 skills + 3 platform plugins at `prepack` time. Registers **≥15 CLI subcommands** (was ≥11 before 0.8.9; `check`/`principles`/`arch` added for OpenCode-plugin parity, fixes #208).

## STRUCTURE
```
src/npm-package/
├── bin/xp-gate.js              # CLI entry: dispatches all subcommands
├── adapters/                   # 13 shell adapters (mirror of ../../githooks/adapters/)
├── hooks/                      # pre-commit, pre-push, adapter-common.sh (copied at publish)
├── lib/                        # 14 CLI implementation files
│   ├── init.js                 # `xp-gate init` — install hooks + adapters into a project
│   ├── install-skill.js        # `xp-gate install-skill`
│   ├── update-skill.js         # `xp-gate update-skill`
│   ├── uninstall-skill.js      # `xp-gate uninstall-skill --force`
│   ├── uninstall.js            # `xp-gate uninstall` (reverse of init; --dry-run/--force/--local/--global)
│   ├── doctor.js               # `xp-gate doctor [--fix]` — diagnose config/hooks/adapters/env
│   ├── migrate.js              # `xp-gate migrate` — clean v0.4.x GitHub-Packages residue from ~/.npmrc
│   ├── baseline.js             # `xp-gate baseline <create|show|reset|diff>` — Boy Scout track
│   ├── audit-log.ts            # gate-audit append-only log writer
│   ├── gate-audit.ts           # `xp-gate audit [--tail|--stats|record]`
│   ├── rollback.js             # rollback failed installations
│   ├── download-skill.js       # GitHub download helper used by install/update-skill
│   ├── ui-detector.ts          # auto-detects UI framework (Issue #79)
│   ├── ui-review.ts            # `xp-gate ui-review` — visual review for UI-bearing changes
│   ├── shared-paths.js         # cross-command path helpers
│   ├── shared-utils.js         # cross-command utilities
│   └── __tests__/              # unit tests
├── skills/                     # 8 skills bundled at publish time (mirror of ../../skills/)
├── plugins/                    # 3 platform plugins bundled at publish time
│   ├── claude-code/            # only sprint-flow currently — see root AGENTS.md drift #7
│   ├── opencode/               # only sprint-flow currently
│   └── qoder/                  # 7 skills, manifest still missing — see drift #6
├── scripts/sync-package-content.js  # prepack hook that syncs skills + plugins from repo
└── package.json                # name: "xp-gate" (registered under @boyingliu01 scope on publish)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| CLI entry | bin/xp-gate.js | Dispatches ≥15 subcommands |
| init (per-project install) | lib/init.js | Copies hooks + adapters into the consumer repo |
| setup-global | lib/init.js (mode flag) | Installs adapters under `~/.config/xp-gate/` |
| uninstall | lib/uninstall.js | Reverse of init; `--dry-run --force --local --global` |
| doctor | lib/doctor.js | Inspects config/hooks/adapters/env; `--fix` repairs |
| migrate | lib/migrate.js | Cleans v0.4.x GitHub-Packages residue |
| baseline | lib/baseline.js | Boy Scout Rule baseline lifecycle |
| audit log | lib/audit-log.ts | Append-only journal writer |
| audit CLI | lib/gate-audit.ts | `xp-gate audit --tail / --stats / record` |
| skill install/update | lib/install-skill.js, lib/update-skill.js, lib/download-skill.js | GitHub-fetched, per-version cached |
| UI detection | lib/ui-detector.ts | Auto-pick web/mobile framework |
| UI review | lib/ui-review.ts | Visual review entry for UI-bearing changes |
| rollback | lib/rollback.js | Rollback a failed install |
| prepack bundling | scripts/sync-package-content.js | Copies skills/ + plugins/ before publish |

## CLI Subcommands (registered in `bin/xp-gate.js`)

| Command | Purpose |
|---------|---------|
| `xp-gate init` | Install hooks + adapter infrastructure into current project |
| `xp-gate setup-global` | Install adapters globally under `~/.config/xp-gate/` |
| `xp-gate uninstall` | Reverse of `init`; supports `--dry-run --force --local --global` |
| `xp-gate doctor [--fix]` | Diagnose hook/adapter/env health; **Check 9: OpenCode TUI panel registration** |
| `xp-gate migrate` | Clean v0.4.x GitHub-Packages residue from `~/.npmrc` |
| `xp-gate baseline <create\|show\|reset\|diff>` | Manage lint baseline (Boy Scout track) |
| `xp-gate install-skill <name>` | Download + install a skill from GitHub |
| `xp-gate update-skill <name>` | Update an already-installed skill |
| `xp-gate uninstall-skill <name> --force` | Remove an installed skill |
| `xp-gate audit [--tail \| --stats \| record]` | Inspect / record gate audit log |
| `xp-gate ui-review` | Visual review for UI-bearing changes |
| `xp-gate sprint-status [--json] [--watch] [--dir <path>]` | Show Sprint Flow progress (reads `.sprint-state/sprint-state.json`) |
| `xp-gate --version` | Print version (sourced from VERSION file) |

## CONVENTIONS
- **Zero runtime dependencies.** `package.json` `dependencies` MUST stay empty. The point is a hook installer that works without `npm install` in the consumer repo.
- **VERSION as truth.** Repo root `VERSION` (4-digit MAJOR.MINOR.PATCH.MICRO) is propagated by `scripts/sync-version.cjs` into this `package.json` as 3-digit npm semver (MAJOR.MINOR.PATCH). Never hand-edit.
- **Adapters duplicated** from `githooks/adapters/`. Source of truth = `githooks/`. Sync via `scripts/sync-package-content.js` (runs in `prepack`).
- **Lib files mostly `.js`**, not `.ts` — keeps `bin/xp-gate.js` runnable with raw Node, no transpile step at install time. The few `.ts` files (`audit-log.ts`, `gate-audit.ts`, `ui-detector.ts`, `ui-review.ts`) are loaded via `npx tsx` on demand.
- **Tests** live alongside source under `lib/__tests__/`.
- **Graceful degradation**: CLI commands should produce useful output even when hooks aren't installed.

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT add anything to `dependencies` in `package.json`. Use `devDependencies` if you need it for development; everything that ships must be vendored or stdlib.
- Do NOT edit `adapters/` here directly — edit `../../githooks/adapters/` and resync.
- Do NOT skip `scripts/sync-package-content.js` in the `prepack` flow. Published artifacts will lose the skill/plugin bundle.
- Do NOT hand-edit `package.json` `version`. Run `node scripts/sync-version.cjs` against the repo root `VERSION`.
- Do NOT introduce a new CLI subcommand without also updating: (a) `bin/xp-gate.js` switch, (b) this file's CLI table, (c) the root `AGENTS.md` CLI table, (d) `README.md`, (e) `MANIFEST.md`.

## UNIQUE STYLES
- **Single source-of-truth for hooks/adapters/skills**: this package re-bundles from sibling directories, never duplicates content in version control beyond the necessary mirror.
- **Prepack-bundled, not symlinked**: ensures publish output is self-contained even if consumers copy the tarball offline.
- **`tsx` for TS lib files** — no compile step in the package, runtime tsx invocation only when those subcommands are called.

## COMMANDS
```bash
# From an installed package
xp-gate init                       # Install hooks + adapters in current project
xp-gate doctor --fix               # Diagnose + auto-repair installation
xp-gate uninstall --dry-run        # Preview removal
xp-gate baseline create             # Snapshot current lint state
xp-gate audit --tail               # Tail recent gate runs
xp-gate install-skill sprint-flow  # Pull skill from GitHub

# From repo (development)
node src/npm-package/bin/xp-gate.js --version
node src/npm-package/scripts/sync-package-content.js   # Manual prepack sync
```

## NOTES
- Published as `@boyingliu01/xp-gate` on the public npm registry (moved from GitHub Packages in v0.5.x; the `migrate` command cleans up v0.4.x users' `~/.npmrc`).
- Adapters duplicated from `githooks/adapters/` — known tech debt acknowledged in root `AGENTS.md`.
- `sync-package-content.js` runs in `prepack` on `npm version` and `npm pack`.
- Bundled skills snapshot is whatever `skills/` contains at publish time (currently 8 skills). The `plugins/` bundle is currently incomplete — see root `AGENTS.md` "Known Drift" #7 for the claude-code/opencode-only-ship-sprint-flow issue.

