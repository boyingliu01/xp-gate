# SRC/NPM-PACKAGE KNOWLEDGE BASE

**Generated:** 2026-05-30
**Commit:** 4517f2b
**Version:** v0.5.1

## OVERVIEW
npm distribution package — zero-install CLI for xp-gate with 8 commands, hooks, adapters, and bundled skills/plugins.

## STRUCTURE
```
src/npm-package/
├── bin/xp-gate.js       # CLI entry: 8 commands
├── adapters/            # 13 language adapters (copied from githooks/adapters/)
├── hooks/               # pre-commit, pre-push + adapter-common.sh
├── lib/                 # CLI implementations (JS/TS)
│   ├── init.js          # Hook installation
│   ├── install-skill.js # Skill download + install
│   ├── update-skill.js  # Skill update
│   ├── uninstall-skill.js # Skill removal
│   ├── uninstall.js     # Complete xp-gate removal (reverse of init)
│   ├── doctor.js        # Installation state diagnosis (config/hooks/adapters/env)
│   ├── migrate.js       # v0.4.x (GitHub Packages) → v0.5.x (npm) cleanup
│   ├── rollback.js      # Rollback failed installations
│   ├── detect-deps.js   # Dependency detection
│   ├── ui-detector.ts   # Sprint auto-detection module (Issue #79)
│   └── __tests__/       # 10 test files
├── scripts/             # sync-package-content.js (prepack bundling)
└── package.json         # Published as "xp-gate" on npm registry
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| CLI entry | bin/xp-gate.js | 8 commands: init, setup-global, install-skill, update-skill, uninstall-skill, uninstall, migrate, doctor |
| uninstall | lib/uninstall.js | Supports --dry-run, --force, --local, --global |
| doctor | lib/doctor.js | Diagnoses config/hooks/adapters/env state, supports --fix |
| migrate | lib/migrate.js | Cleans v0.4.x残留 GitHub Packages config |
| ui-detector | lib/ui-detector.ts | Auto-detects UI framework (Issue #79) |
| prepack sync | scripts/sync-package-content.js | Bundles 4 skills + claude-code plugin on npm publish |

## CONVENTIONS
- CLI lib files are `.js` (not `.ts`) — transpiled or hand-written JS
- ui-detector.ts is the only TypeScript file in lib/
- Tests in `__tests__/` alongside source
- Package includes shell scripts (adapters/, hooks/) alongside JS — non-standard for npm

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT edit adapters/ here without syncing from githooks/adapters/ (duplication risk)
- Do NOT add runtime dependencies — zero-install requirement
- Do NOT skip sync-package-content.js in prepack hook

## UNIQUE STYLES
- VERSION file in repo root → sync-version.sh → this package.json (3-digit npm semver)
- `prepack` script bundles skills + plugins before publish
- Package includes bash scripts, adapters, and markdown — not just JS
- Graceful degradation: CLI commands work even if hooks not installed

## COMMANDS
```bash
# From installed package
xp-gate init                  # Install hooks + adapters to current project
xp-gate doctor                # Diagnose installation
xp-gate uninstall             # Complete removal
xp-gate migrate               # v0.4.x → v0.5.x migration
xp-gate install-skill <name>  # Download + install skill from GitHub
xp-gate update-skill <name>   # Update installed skill
xp-gate uninstall-skill <name> # Remove skill (--force required)
```

## NOTES
- Published as `xp-gate` on public npm registry (moved from GitHub Packages in v0.5.1)
- Adapters duplicated from githooks/adapters/ — known tech debt, maintenance risk
- sync-package-content.js runs on `npm version` and `npm pack` to bundle skills/plugins
- Package version: 0.5.1 (npm semver, 3-digit)
