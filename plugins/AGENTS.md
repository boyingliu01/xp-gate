# PLUGINS KNOWLEDGE BASE

**Generated:** 2026-06-14
**Commit:** d967c4c
**Branch:** sprint/2026-06-14-01
**Version:** 0.8.11.0

## OVERVIEW
Cross-platform plugin system for Claude Code, OpenCode, and Qoder. Shared skills + platform-specific hooks/tooling. **The three platforms currently ship inconsistent skill sets — see "Known Issues" below.**

## STRUCTURE
```
plugins/
├── claude-code/
│   ├── .claude-plugin/plugin.json  # Manifest (name=xp-gate, version=0.8.8, skills=./skills/)
│   ├── hooks/hooks.json            # PreToolUse / PostToolUse / Stop hooks
│   ├── bin/
│   │   ├── xp-gate-check           # PostToolUse: principles check (graceful degradation)
│   │   └── delphi-review-guard.sh  # PreToolUse: blocks Edit/Write before Delphi APPROVED
│   └── skills/                     # ⚠️ Currently bundles ONLY sprint-flow (1 skill)
├── opencode/
│   ├── index.ts                    # Plugin entry: 3 tools (gate-check, gate-principles, gate-arch)
│   ├── package.json                # @opencode-ai/plugin dependency
│   ├── tsconfig.json               # ESNext + bundler moduleResolution
│   └── skills/                     # ⚠️ Currently bundles ONLY sprint-flow (1 skill)
├── qoder/
│   │                               # ⚠️ NO manifest file (plugin.json / qoder.json missing)
│   └── skills/                     # Bundles 7 skills:
│                                   #   admin-template-guidelines, delphi-review,
│                                   #   improve-codebase-architecture, ralph-loop,
│                                   #   sprint-flow, test-specification-alignment, to-issues
│                                   # (missing only: test-driven-development — added in 0.8.x)
└── shared/                         # Common cross-platform docs (when present)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Claude manifest | claude-code/.claude-plugin/plugin.json | Defines name, version, skills path, hooks path |
| Claude hooks | claude-code/hooks/hooks.json | PreToolUse (Delphi guard), PostToolUse (principles), Stop |
| Delphi guard | claude-code/bin/delphi-review-guard.sh | Reads `.sprint-state/delphi-reviewed.json` |
| Principles check | claude-code/bin/xp-gate-check | Always exits 0 (non-blocking, advisory) |
| OpenCode entry | opencode/index.ts | `tool()` helper from `@opencode-ai/plugin` |
| OpenCode package | opencode/package.json | Published as `@boyingliu01/opencode-plugin` |
| Qoder skills | qoder/skills/ | 7 skill dirs; no manifest registered |
| Build script | ../scripts/build-plugin.sh | `--platform claude-code\|opencode\|qoder` |
| Copy script | ../scripts/copy-skills.sh | Full skill dir copy (preserves references/, templates/) |
| Plugin tests | ../scripts/test-plugins.sh | 28 integration tests |

## CONVENTIONS
- **Plugin skill mirrors are auto-populated** by `build-plugin.sh` — never hand-edit `plugins/*/skills/`. Edit `skills/<name>/` in repo root, then rebuild.
- **AGENTS.md files inside `skills/`** are byte-identical copies of the canonical `skills/<name>/AGENTS.md` — propagated by the copy script.
- **Claude hooks degrade gracefully** — `xp-gate-check` exits 0 even if the CLI isn't installed.
- **OpenCode plugin is TypeScript** (compiled by bundler); Claude plugin is JSON+bash (no compile step).
- **Both platforms share the same SKILL.md source** — single source of truth in repo root `skills/<name>/`.

## ANTI-PATTERNS (THIS PROJECT)
- Do NOT edit `plugins/*/skills/` directly — rebuild via `scripts/build-plugin.sh`. Changes will be overwritten.
- Do NOT assume `xp-gate` CLI is installed in user environments — plugins must degrade gracefully (exit 0 when missing).
- Do NOT mix platform-specific logic into `shared/`.
- Do NOT skip the Delphi guard hook in `claude-code/hooks/hooks.json` — it's the IDE-side enforcement of HARD-GATE.

## UNIQUE STYLES
- **Claude Code**: JSON manifest + bash hooks + bin wrappers (no TypeScript compilation step at install time).
- **OpenCode**: TS module published as `@boyingliu01/opencode-plugin`, registered via `"plugin": ["./plugins/opencode"]` in `opencode.json`.
- **Qoder**: skills-only layout (no manifest yet — see Known Issues).
- **Graceful degradation everywhere**: every plugin entrypoint works even without `xp-gate` CLI on PATH.

## COMMANDS
```bash
# Build plugins
npm run build:plugins                                  # Build all platforms
bash scripts/build-plugin.sh --platform claude-code    # Single platform
bash scripts/build-plugin.sh --platform opencode
bash scripts/build-plugin.sh --platform qoder

# Test plugins (28 integration tests)
bash scripts/test-plugins.sh

# Install Claude plugin
/plugin install boyingliu01/xp-gate                    # From GitHub

# Register OpenCode plugin
# opencode.json:  { "plugin": ["./plugins/opencode"] }
```

## KNOWN ISSUES (filed as GitHub issues during 2026-06-09 audit)

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | `plugins/qoder/` is missing a manifest file (`plugin.json` / `qoder.json`) — the plugin can't be registered with Qoder host as-is | High | ✅ Fixed in commit `1d2cff8` (#202) |
| 2 | `plugins/claude-code/skills/` and `plugins/opencode/skills/` bundle only `sprint-flow`; docs say "6 skills" / "7 skills". `scripts/build-plugin.sh` or `scripts/copy-skills.sh` isn't copying the full set for these two platforms | High | ✅ Fixed in commit `1d2cff8` (#203) |
| 3 | None of the three platforms ships the new `test-driven-development` skill (added in 0.8.x) | Medium | ✅ Fixed in commit `1d2cff8` (#203) |
| 4 | OpenCode plugin's `gate-check` and `gate-arch` tools shell out to `xp-gate check` and `npx archlint check` — neither subcommand/package exists as advertised. Tools silently no-op or crash | High | ✅ Fixed in 0.8.9 (#208): new `xp-gate check/principles/arch` subcommands + plugin shell-out + npx-tsx fallback |

See root `AGENTS.md` → "Known Drift" #6, #7 for full context.

## NOTES
- v0.4.0+: plugin system introduced.
- v0.8.x: plugin version bumped to 0.8.8 (synced from repo `VERSION`).
- OpenCode plugin exposes 3 tools: `gate-check`, `gate-principles`, `gate-arch`.
- `test-plugins.sh` validates JSON manifests, version pinning, build outputs, and graceful-degradation behavior.

