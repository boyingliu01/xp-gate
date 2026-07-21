---
name: sprint-flow
version: 2.1.0
description: >
  Orchestrates a 6-phase end-to-end feature development pipeline (PREP → DESIGN → BUILD → VERIFY → SHIP → CLOSE).
  Integrates brainstorming, autoplan, delphi-review, TDD, ralph-loop, code-walkthrough, ship, and other skills.
  Pauses at key gates for user decisions. Acknowledges emergent requirements with mandatory manual UAT in CLOSE phase.

  WHAT: Automates the full development lifecycle from worktree isolation to production deployment.
  WHEN: User explicitly requests building a feature, developing new functionality, starting a sprint, or running /sprint-flow.
  NOT WHEN: Asking HOW to implement something (educational), implementing a single function/algorithm, environment setup,
  deployment-only requests, feature suggestions without execution intent, or casual "do it" requests without a feature scope.

  TRIGGERS: "/sprint-flow", "start sprint", "开发新功能", "实现 X (where X is a feature/module)", "一键开发", "develop new feature",
  "implement feature X", "one-shot development", "build X (where X is a feature)".
  NEGATIVE TRIGGERS: "实现排序算法", "实现一下", "帮我实现这个函数", "怎么实现登录功能", "start spring boot", "开发环境配置",
  "一键部署", "新功能建议", "implement a sort function", "how to implement auth".
  On trigger, first line MUST output: `Sprint Flow: PREP → DESIGN → BUILD → VERIFY → SHIP → CLOSE`
maturity: beta
auto_continue: false    # Sprint-flow pauses at user decision gates (unlike delphi-review which auto-continues rounds)
triggers:
  - "/sprint-flow"
  - "start sprint"
  - "开发新功能"
  - "一键开发"
  - "implement feature"
  - "one-shot development"
  - "build a feature"
triggers_negative_examples:
  - "实现排序算法"          # algorithm implementation, not feature development
  - "实现一下"              # casual "do it", not a sprint request
  - "帮我实现这个函数"      # single function, not full feature
  - "怎么实现登录功能"      # asking HOW, not requesting development
  - "start spring boot"     # framework name, not sprint
  - "开发环境配置"          # environment setup, not feature development
  - "一键部署"              # deploy, not develop
  - "新功能建议"            # feature suggestion/request, not execution
  - "implement a sort function"  # algorithm, not full feature
  - "how to implement auth"      # educational question
  - "实现一个util函数"      # utility function, not feature
  - "帮我写个脚本"          # script writing, not feature development
  - "代码review"            # code review, not development
  - "refactor this"         # refactoring, not new feature
triggers_negative_test_cases:
  - input: "实现排序算法"
    expect: "NOT triggered"
  - input: "实现一下"
    expect: "NOT triggered"
  - input: "帮我实现这个函数"
    expect: "NOT triggered"
  - input: "怎么实现登录功能"
    expect: "NOT triggered"
  - input: "start spring boot"
    expect: "NOT triggered"
  - input: "开发环境配置"
    expect: "NOT triggered"
  - input: "一键部署"
    expect: "NOT triggered"
  - input: "新功能建议"
    expect: "NOT triggered"
  - input: "implement a sort function"
    expect: "NOT triggered"
  - input: "how to implement auth"
    expect: "NOT triggered"
  - input: "开发用户认证模块"
    expect: "triggered"
  - input: "/sprint-flow \"开发访谈机器人\""
    expect: "triggered"
  - input: "一键开发 REST API"
    expect: "triggered"
  - input: "implement user authentication feature"
    expect: "triggered"
  - input: "start sprint for login module"
    expect: "triggered"
  - input: "帮我写个脚本"
    expect: "NOT triggered"
  - input: "代码review"
    expect: "NOT triggered"
  - input: "refactor this module"
    expect: "NOT triggered"
workflow_steps:
  - "Phase 1/6: PREP → Output: ## Phase 1/6: PREP (准备工作)"
  - "Phase 2/6: DESIGN → Output: ## Phase 2/6: DESIGN (设计)"
  - "Phase 3/6: BUILD → Output: ## Phase 3/6: BUILD (构建)"
  - "Phase 4/6: VERIFY → Output: ## Phase 4/6: VERIFY (验证)"
  - "Phase 5/6: SHIP → Output: ## Phase 5/6: SHIP (发布)"
  - "Phase 6/6: CLOSE → Output: ## Phase 6/6: CLOSE (收尾)"
hooks:
  security:
    - "/careful": "Safety guardrails for destructive commands — activate before any rm, force-push, or git reset"
    - "/freeze": "Restrict edits to sprint worktree directory — prevent accidental changes outside scope"
    - "/guard": "Full safety mode combining careful + freeze for maximum protection"
  operational:
    - "/context-save": "Save sprint context before pause or handoff"
    - "/context-restore": "Restore sprint context on resume"
tools_allowed:
  - "Bash(git, gh, npm, node)"  # git worktree/branch/commit, gh PR/release, npm/node CLI
  - "Read"                       # read project files, configs, docs
  - "Write"                      # write sprint-state, specification.yaml, phase summaries
  - "Edit"                       # edit sprint-state, CHANGELOG, VERSION
  - "Glob"                       # find project files by pattern
  - "Grep"                       # search file contents
  - "Task"                       # delegate to subagents (quick, deep, unspecified-high)
  - "Skill"                      # invoke integrated skills (brainstorming, autoplan, delphi-review, etc.)
  - "TodoWrite"                  # track sprint progress
  - "Question"                   # ask user at decision gates
tools_denied:
  - "rm -rf (any recursive force remove)"
  - "git push --force"
  - "DROP TABLE or destructive DB operations"
  - "Write(source code)"            # NEVER write implementation code directly — delegate to subagents via Task
  - "Edit(source code)"             # NEVER edit implementation code — sprint-flow orchestrates, subagents implement
---

# Sprint Flow — 6-Phase Development Pipeline

## Triggers

| Trigger Type | Phrases |
|--------------|---------|
| **中文** | "开发新功能", "一键开发", "/sprint-flow", "开发用户登录", "创建 XXX 模块" |
| **English** | "/sprint-flow", "start sprint", "implement feature", "one-shot development", "build a feature" |

**Usage**: `/sprint-flow "[feature description]"`

**Examples**:
- `/sprint-flow "开发访谈机器人，支持多轮对话"`
- `/sprint-flow "实现用户认证模块，支持 OAuth2"`
- `/sprint-flow "开发 REST API 端点"`

**Optional Parameters**:
- `--no-isolate`: Skip auto worktree isolation (⚠️ risk of polluting protected branches)
- `--branch-name <name>`: Custom branch name (default: `sprint/YYYY-MM-DD-NN`)
- `--force`: Force continue on current branch even if protected (⚠️ requires explicit confirmation)
- `--stop-at <phase>`: Stop after specified phase (prep/design/build/verify/ship/close)
- `--resume-from <phase>`: Resume from specified phase
- `--phase <phase>`: Execute only single phase (prep-only/design-only/build-only/verify-only/ship-only/close-only)
- `--lang <language>`: Specify project language (springboot/django/golang)
- `--type <project_type>`: Specify project type (web-nextjs/web-react/web-vue/backend-go/backend-django/backend-springboot)
- `--spec <file>`: Use existing specification.yaml file
- `--with-performance`: Enable load/stress testing (backend projects)
- `--mode <build_mode>`: Phase 3 BUILD build mode. Default = ralph-loop. parallel = legacy all-at-once mode
- `--status`: View Sprint progress dashboard (read-only, no execution)

## Security Notes

- Sprint flow **does NOT execute destructive commands** (no `rm -rf`, `git push --force`, `DROP TABLE`, etc.)
- `git worktree remove` only deletes temporary worktree directories created by the sprint, never affects the main repo
- Phase 5 SHIP only creates PRs (`gh pr create`), never auto-merges without explicit user confirmation
- Sprint flow does not download, install, or execute external binaries

## Permissions

- `git`: read/write (worktree, branch, commit)
- `gh` (GitHub CLI): read/write (PR create, merge, CI query)
- `filesystem`: read/write (project dir + `.worktrees/` only)
- `network`: read-only (CI status, canary health)

---

## 6-Phase Pipeline

```
PREP → DESIGN → BUILD → VERIFY → SHIP → CLOSE
```

| Phase | Name | Key Actions | Output |
|-------|------|-------------|--------|
| 1/6 | PREP | Detect protected branch → Create git worktree → AUTO-ESTIMATE sizing → Classify (lightweight/standard/complex) | Worktree path + impact assessment |
| 2/6 | DESIGN | CONTEXT.md 预检 (#322) → brainstorming (如需要) → autoplan → delphi-review (HARD-GATE ≥90% consensus) → to-issues → specification.yaml | specification.yaml + slices-manifest.json |
| 3/6 | BUILD | GITHOOKS-GATE → DELPHI-GATE → ralph-loop (default) or parallel → TDD → freeze → blind review → verification | MVP code |
| 4/6 | VERIFY | delphi-review --mode code-walkthrough → test-specification-alignment → browse QA → learn + retro | Review report + feedback-log.md |
| 5/6 | SHIP | VERSION-GATE → finishing-a-development-branch → ship (create PR) → land-and-deploy → merge to main + CI + canary | PR URL + deploy status + merge confirmation |
| 6/6 | CLOSE | SHIP→CLOSE GATE (merge verified) → Backup sprint-state → USER ACCEPTANCE (⚠️ mandatory manual) → Capture emergent issues → Cleanup worktree + branch | Emergent issues list + cleanup report |

**Hard Gates**:
- **DESIGN → BUILD**: Design must be APPROVED by delphi-review (≥90% consensus) + GITHOOKS-GATE + DELPHI-GATE
- **VERIFY → SHIP**: feedback-log.md must exist (HARD-GATE)
- **SHIP → CLOSE**: PR must be merged to main + release completed (HARD-GATE)

---

## ⚠️ Required Output Format (MANDATORY for L3 Step Adherence)

Every phase MUST output its header as the first line of that phase's output. Format MUST be exact:

```markdown
## Phase 1/6: PREP (准备工作)
## Phase 2/6: DESIGN (设计)
## Phase 3/6: BUILD (构建)
## Phase 4/6: VERIFY (验证)
## Phase 5/6: SHIP (发布)
## Phase 6/6: CLOSE (收尾)
```

**Rules**:
1. First line of every phase output MUST be `## Phase X/6: NAME (中文名)`
2. NEVER omit "Phase" keyword (not "## 1/6" or "PREP" alone)
3. NEVER merge phase output — each phase gets its own header
4. On `/sprint-flow` trigger, first line MUST output: `Sprint Flow: PREP → DESIGN → BUILD → VERIFY → SHIP → CLOSE`
5. Each phase completion MUST write Phase Summary to `.sprint-state/phase-outputs/phase-{N}-summary.md`
6. Each phase completion MUST call `xp-gate phase-transition <N> <status> --render` — this programmatically updates `sprint-state.json` AND renders the ASCII dashboard in one command (resolves #338, #146)

### Phase Transition CLI (MANDATORY — replaces manual state updates)

7. **NEVER** manually write to `sprint-state.json` or manually render the dashboard from template. ALWAYS use:
   ```
   npx xp-gate phase-transition <phase> <status> --render [--outputs '<json>']
   ```
   - `<phase>`: 1-6
   - `<status>`: `in_progress` | `completed` | `skipped` | `failed` | `paused`
   - `--render`: Auto-renders ASCII progress dashboard after state update
   - `--outputs '<json>'`: Optional JSON of phase outputs to record
   
   Example (end of each phase):
   ```
   npx xp-gate phase-transition 1 completed --render --outputs '{"estimate":"3 story points"}'
   npx xp-gate phase-transition 2 in_progress --render
   ```
   
   This is a **HARD GATE** — the orchestrator MUST invoke this CLI command. Text-level instructions to "update state" or "render dashboard" are DEPRECATED; the CLI is the single source of truth for state transitions and dashboard rendering.

### Phase Output Status Schema (MANDATORY per phase)

Each phase MUST close with structured status:

```
status: completed | blocked | user_decision_required
outputs: [list of files produced]
decisions: [list of decisions made]
next_phase_context: [key info for next phase]
```

---

## Detailed Phase Instructions

**All detailed phase instructions are in `references/phase-overview.md`**. The router file above provides the canonical structure; load the reference file for step-by-step execution guides, skill integration details, parameter documentation, output contracts, templates, and research evidence.

> **Path convention**: `@references/` and `@templates/` resolve relative to the skill directory (`skills/sprint-flow/`). The per-phase reference files (`phase-*.md`) are the authoritative source for implementation details — this router file provides summary and dispatch logic only.

**Key reference files:**
| File | Phase | Content |
|------|-------|---------|
| `@references/phase-overview.md` | ALL | Complete phase details, skill integration, params, output contract |
| `@references/phase-1-prep.md` | 1/6 | PREP — worktree isolation + sizing |
| `@references/phase-2-design.md` | 2/6 | DESIGN — brainstorming + delphi-review HARD-GATE |
| `@references/phase-3-build.md` | 3/6 | BUILD — ralph-loop default + TDD |
| `@references/phase-4-verify.md` | 4/6 | VERIFY — code-walkthrough + QA + feedback |
| `@references/phase-5-ship.md` | 5/6 | SHIP — PR + merge + deploy + canary |
| `@references/phase-6-close.md` | 6/6 | CLOSE — UAT + cleanup |
| `@references/orchestration-rules.md` | ALL | Agent dispatch, context inheritance, transition gates |
| `@references/force-levels.md` | ALL | Phase forcing rules |
| `@templates/` | ALL | Pain doc, emergent issues, sprint summary, progress templates |

---

## Anti-Patterns

| ❌ Error | ✅ Correct |
|----------|-----------|
| Route Q&A, explanation, or code-search requests to sprint-flow | Only trigger for explicit feature development/implementation requests |
| Skip Phase 1/6 PREP isolation, edit directly on main/master/develop | Default: create worktree; only bypass with `--no-isolate` or `--force` + user confirmation |
| Skip AUTO-ESTIMATE and apply full heavy pipeline blindly | Evaluate lightweight/standard/complex first, follow recommended or user-confirmed flow |
| Skip Delphi review in DESIGN, go straight to BUILD | All requirement levels (lightweight/standard/complex) must pass autoplan + delphi-review; APPROVED before coding |
| Skip TDD, implement code directly | Phase 3/6 BUILD must follow RED → GREEN → REFACTOR; tests and implementation delivered together |
| Skip user acceptance, go straight to Ship | Phase 6/6 CLOSE USER ACCEPTANCE must be manual; never automate, skip, or fake |
| Enter CLOSE without SHIP completing merge to main | Phase 5/6 SHIP must complete merge to main + release before entering Phase 6/6 CLOSE; otherwise worktree cleanup leaves residue + UAT reviews unmerged code |
| Clean up CLOSE without backing up sprint-state first | `.sprint-state/` is inside worktree; it's lost on worktree removal. CLOSE step 1 MUST back up to repo-tracked path first |
| Keep adding random changes after verification failures | Max 3 fix cycles; if still failing, BLOCK and request user decision |
| Enter next phase without generating Phase Summary | Every phase MUST write `.sprint-state/phase-outputs/phase-{N}-summary.md` and pass transition gate |

---

## 使用示例

| 场景 | 命令 | 说明 |
|------|------|------|
| 完整流水线 | `/sprint-flow "开发访谈机器人"` | 自动执行 6 阶段 → specification.yaml + PR URL |
| 设计后停止 | `/sprint-flow "开发认证模块" --stop-at design` | 输出 specification.yaml 后停止，供评审 |
| 仅构建阶段 | `/sprint-flow "开发 API" --lang django --phase build-only` | 跳过准备/设计，直接 Build |

## 底层 Skills 保持独立

所有被调用的 Skills 独立可用：`delphi-review` (单独评审), `test-driven-development` (TDD)，sprint-flow 仅自动串联
