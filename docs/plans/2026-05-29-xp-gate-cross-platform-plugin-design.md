# XP-Gate Cross-Platform Plugin Design

**Date:** 2026-05-29
**Author:** Sisyphus
**Status:** Proposed

## 1. Problem Statement

xp-gate currently distributes via npm package (`xp-gate`) which installs git hooks and AI skills to platform-specific paths. This requires users to run `npm install -g xp-gate && xp-gate init` per project. Both Claude Code and OpenCode support plugin systems that auto-load globally. Reimagining xp-gate as a plugin for both platforms would:

- **Reduce installation friction**: One command install, works across all projects
- **Enable IDE integration**: Quality checks fire during agent editing, not just at git commit
- **Share skills natively**: SKILL.md files load automatically without separate registry
- **Maintain backward compatibility**: Existing npm installation continues to work

## 2. Constraints

- **Both platforms use event-based hooks**, NOT native git hooks (no `PreToolUse` equivalent to `pre-commit`)
- **Claude Code** uses JSON manifest (`plugin.json`) + directory structure, runs in Node.js
- **OpenCode** uses JS/TS module (`export Plugin`), runs in Bun runtime
- **Git hooks cannot be provided by plugins** — they must remain as a separate installable component
- **SKILL.md format is shared** — same files work in both platforms without modification
- **Backward compatibility mandatory** — existing users must not break

## 3. Approaches Considered

| Approach | Description | Pros | Cons |
|----------|-------------|------|------|
| **A: Dual Distribution** (Chosen) | Keep npm package for git hooks + add plugin format for skills/tools | Best UX, backward compatible, zero migration risk | Two distribution channels to maintain |
| B: Full Plugin Migration | Rewrite everything as plugins, drop native git hooks | Single distribution model | Manual commits bypass quality gates |
| C: Unified Core + Wrappers | Shared JS library, thin wrappers per platform | DRY, single gate logic source | Abstraction complexity, two runtimes |

**Decision: Approach A.** Incremental adoption, preserves existing behavior, gives users immediate benefit. Can evolve toward C later if warranted.

## 4. Architecture

### 4.1 Three Distribution Channels

```
┌──────────────────────────────────────────────────────────────┐
│                    XP-GATE v0.4.0                             │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────┐  │
│  │  npm Package    │  │  Claude Plugin   │  │ OpenCode    │  │
│  │  (unchanged)    │  │                  │  │ Plugin      │  │
│  │                 │  │  .claude-plugin/ │  │             │  │
│  │  bin/xp-gate.js │  │    plugin.json   │  │  index.ts   │  │
│  │  hooks/         │  │  skills/         │  │  skills/    │  │
│  │  adapters/      │  │  hooks/hooks.json│  │             │  │
│  │  lib/           │  │  bin/xp-gate-check│ │             │  │
│  └─────────────────┘  └──────────────────┘  └─────────────┘  │
│         │                      │                      │       │
│         v                      v                      v       │
│  git hooks remain       plugin auto-loads        plugin exports│
│  installable via        skills + event hooks     Plugin function│
│  xp-gate init           on Edit/Write events     + tools       │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 Component Mapping

| xp-gate Component | npm Package | Claude Plugin | OpenCode Plugin |
|-------------------|:-----------:|:-------------:|:---------------:|
| Git hooks (pre-commit, pre-push) | ✅ | ❌ (not supported) | ❌ (not supported) |
| Language adapters | ✅ | ❌ (via bin/ if needed) | ❌ (via shell if needed) |
| CLI tools (init, install-skill) | ✅ | ❌ | ❌ |
| AI Skills (7 SKILL.md) | ✅ | ✅ (auto-discovered) | ✅ (via plugin) |
| Principles checker | ✅ | ⚠️ (via bin/ shell) | ⚠️ (via tool) |
| Architecture validator | ✅ | ⚠️ (via bin/ shell) | ⚠️ (via tool) |
| Event-based quality gates | N/A | ✅ (PreToolUse hooks) | ✅ (tool.execute.before) |

### 4.3 Claude Code Plugin Structure

```
xp-gate-claude/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   ├── sprint-flow/SKILL.md
│   ├── delphi-review/SKILL.md
│   ├── test-specification-alignment/SKILL.md
│   ├── ralph-loop/SKILL.md
│   ├── test-driven-development/SKILL.md
│   ├── improve-codebase-architecture/SKILL.md
│   └── to-issues/SKILL.md
├── hooks/
│   └── hooks.json
└── bin/
    └── xp-gate-check
```

**plugin.json:**
```json
{
  "name": "xp-gate",
  "version": "0.4.0",
  "displayName": "XP-Gate",
  "description": "Extreme Programming quality gates + AI workflow skills for Claude Code",
  "skills": "./skills/",
  "hooks": "./hooks/hooks.json"
}
```

**hooks/hooks.json:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "\"${CLAUDE_PLUGIN_ROOT}\"/bin/xp-gate-check \"${TOOL_INPUT_FILE}\""
          }
        ]
      }
    ]
  }
}
```

### 4.4 OpenCode Plugin Structure

```
xp-gate-opencode/
├── index.ts
├── skills/
│   ├── sprint-flow/SKILL.md
│   ├── delphi-review/SKILL.md
│   ├── test-specification-alignment/SKILL.md
│   ├── ralph-loop/SKILL.md
│   ├── test-driven-development/SKILL.md
│   ├── improve-codebase-architecture/SKILL.md
│   └── to-issues/SKILL.md
└── package.json
```

**index.ts:**
```typescript
import type { Plugin, tool } from "@opencode-ai/plugin"

export const XpGatePlugin: Plugin = async ({ directory, $ }) => {
  return {
    tool: {
      'gate-check': tool({
        description: "Run xp-gate quality checks on a file or directory",
        args: {
          path: tool.schema.string({ description: "File or directory path to check" }),
          gates: tool.schema.array(tool.schema.string(), {
            description: "Specific gates to run (all if omitted)",
          }),
        },
        async execute(args) {
          const result = await $`xp-gate-check ${args.path}`.catch(() => ({
            stdout: "xp-gate-check not found. Install xp-gate: npm install -g xp-gate",
            stderr: "",
          }))
          return result.stdout || result.toString()
        },
      }),
      'gate-principles': tool({ /* ... */ }),
      'gate-arch': tool({ /* ... */ }),
    },
  }
}
```

### 4.5 Shared Skill Packaging

Skills are the same SKILL.md files for both platforms. The npm package build process copies them to both plugin output directories. No modification needed — SKILL.md is platform-agnostic markdown.

### 4.6 Event Hook Data Flow

```
Agent calls Edit tool
       ↓
Plugin intercepts (PreToolUse / tool.execute.before)
       ↓
Runs xp-gate-check on changed file
       ↓
  ┌────┴────┐
  PASS      FAIL
  ↓         ↓
Edit proceeds  Edit blocked
               Error shown: "PRINC-003: Function too long (52 > 50)"
```

### 4.7 Error Handling

| Scenario | Behavior |
|----------|----------|
| Plugin tool fails | Returns error message, doesn't crash session |
| xp-gate CLI unavailable | Skip gate check, log warning once per session |
| Skill file missing | Plugin loads without that skill, no hard failure |
| Conflicting .principlesrc | Use project-local values over global defaults |

### 5. Migration Path

```
v0.3.x (current)              →  v0.4.0 (dual distribution)
─────────────────────────────────────────────────────────────
npm install -g xp-gate        →  npm install -g xp-gate (unchanged)
xp-gate init                  →  xp-gate init (unchanged)
skills via install-skill      →  skills ALSO bundled in plugins
                                  + claude: /plugin install xp-gate
                                  + opencode: add to opencode.json
```

**Existing users:** No migration needed. Everything continues to work.
**New users:** One choice — install npm package (for git hooks + full features) OR install plugin (for skills + IDE integration) OR both.

### 6. Installation Instructions

**npm Package (git hooks):**
```bash
npm install -g xp-gate
xp-gate init          # project-local
xp-gate setup-global  # global for all projects
```

**Claude Code Plugin:**
```bash
/plugin install xp-gate@github
# or
/plugin install xp-gate@marketplace
```

**OpenCode Plugin:**
```json
// opencode.json
{
  "plugin": ["xp-gate"]
}
```

### 7. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Claude Code plugin system changes | Plugin breaks | Monitor Claude Code releases, add version checks to plugin.json |
| OpenCode plugin API evolves | TypeScript module breaks | Pin to `@opencode-ai/plugin` version |
| Users confused by two install paths | UX friction | Clear docs: "Use npm for git hooks, plugin for skills" |
| Plugin shell invocation is slow | Performance | Cache gate results per file, debounce rapid edits |

### 8. Testing Strategy

- **npm package:** All existing gate tests pass (regression)
- **Claude plugin:** Install in Claude Code, verify skills load, edit triggers hook
- **OpenCode plugin:** Install via opencode.json, verify tools appear in tool list
- **Cross-platform:** Same SKILL.md files used by both, no drift
- **Manual QA:** `/sprint-flow` works in both platforms, gates fire correctly

### 9. Success Criteria

- [ ] Plugin installs globally and works across all projects without `xp-gate init`
- [ ] All 7 SKILL.md files load correctly in both Claude Code and OpenCode
- [ ] Quality gate tools are invocable from both platforms
- [ ] Existing npm installation path unchanged (no breaking changes)
- [ ] Event-based quality checks fire on Edit/Write in both platforms
- [ ] Documentation covers all three installation options clearly
