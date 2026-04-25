# Project Manifest

This file is machine-readable. LLM agents: parse this to discover all installable components and their install commands.

---

## Installable Components

Each component can be installed independently. No component requires sprint-flow.

```yaml
components:
  - id: pre-commit
    name: "Pre-Commit Hook (9 Gates)"
    description: "Static analysis, lint, test, coverage, shell check, principles (Clean Code + SOLID), cyclomatic complexity, Boy Scout Rule, architecture quality"
    type: git-hook
    install_command: "bash <(curl -fsSL https://raw.githubusercontent.com/boyingliu01/xp-workflow-automation/repo-main/scripts/install-pre-commit.sh)"
    local_install: "bash scripts/install-pre-commit.sh"
    requires:
      - node (>=20)
      - npm
    recommends:
      - lizard
      - archlint
      - ast-grep
    optional: true

  - id: pre-push
    name: "Pre-Push Hook (Delphi Code Walkthrough)"
    description: "Multi-expert AI code review before git push. Validates .code-walkthrough-result.json from Delphi review."
    type: git-hook
    install_command: "bash <(curl -fsSL https://raw.githubusercontent.com/boyingliu01/xp-workflow-automation/repo-main/scripts/install-pre-push.sh)"
    local_install: "bash scripts/install-pre-push.sh"
    requires: []
    recommends:
      - delphi-review skill
      - jq
    optional: true

  - id: principles-cli
    name: "Principles Checker CLI"
    description: "Clean Code (9 rules) + SOLID (5 rules) static checker with 9 language adapters. Outputs SARIF 2.1.0. Includes Boy Scout Rule enforcement."
    type: cli-tool
    install_command: "bash <(curl -fsSL https://raw.githubusercontent.com/boyingliu01/xp-workflow-automation/repo-main/scripts/install-principles-cli.sh)"
    local_install: "bash scripts/install-principles-cli.sh"
    requires:
      - node (>=20)
      - npm install
    recommends:
      - ast-grep
      - lizard
    optional: true

  - id: delphi-review
    name: "Delphi Review Skill"
    description: "Multi-expert anonymous consensus review. Two modes: design (default) and code-walkthrough. MANDATORY before implementation."
    type: ai-skill
    install_command: "bash <(curl -fsSL https://raw.githubusercontent.com/boyingliu01/xp-workflow-automation/repo-main/scripts/install-delphi-review.sh)"
    local_install: "bash scripts/install-delphi-review.sh"
    requires:
      - OpenCode or Claude Code
    recommends:
      - Multi-language API access (for multi-expert consensus)
    optional: true

  - id: test-spec-alignment
    name: "Test-Specification Alignment Skill"
    description: "Two-phase test verification ensuring tests match requirements. Phase 1: verify alignment, Phase 2: execute with frozen tests."
    type: ai-skill
    install_command: "bash <(curl -fsSL https://raw.githubusercontent.com/boyingliu01/xp-workflow-automation/repo-main/scripts/install-test-spec-alignment.sh)"
    local_install: "bash scripts/install-test-spec-alignment.sh"
    requires: []
    recommends:
      - delphi-review skill
      - specification.yaml
    optional: true

  - id: sprint-flow
    name: "Sprint Flow Skill (Orchestrator)"
    description: "One-Shot Sprint 自动流水线. Orchestrates: office-hours → autoplan → delphi-review → TDD → review → ship. Optional composite."
    type: ai-skill
    install_command: "bash <(curl -fsSL https://raw.githubusercontent.com/boyingliu01/xp-workflow-automation/repo-main/scripts/install-sprint-flow.sh)"
    local_install: "bash scripts/install-sprint-flow.sh"
    requires: []
    recommends:
      - delphi-review skill
      - test-spec-alignment skill
    optional: true

  - id: quality-gates-code-of-conduct
    name: "Quality Gates Code of Conduct"
    description: "Zero-tolerance policy document. Prohibits --no-verify bypass. Reference document, not executable."
    type: document
    install_command: "cp githooks/QUALITY-GATES-CODE-OF-CONDUCT.md ."
    requires: []
    recommends: []
    optional: true
```

## Pre-built Combinations

```yaml
bundles:
  - id: quality-gates
    name: "Quality Gates Bundle"
    description: "All git hooks + principles CLI + quality standards"
    components: [pre-commit, pre-push, principles-cli, quality-gates-code-of-conduct]
    install_command: "bash <(curl -fsSL https://raw.githubusercontent.com/boyingliu01/xp-workflow-automation/repo-main/scripts/install-all.sh)"
    local_install: "bash scripts/install-all.sh"

  - id: ai-review
    name: "AI Code Review Bundle"
    description: "Delphi review + test verification"
    components: [delphi-review, test-spec-alignment]
    install_command: "bash scripts/install-delphi-review.sh && bash scripts/install-test-spec-alignment.sh"

  - id: full-workflow
    name: "Full Sprint Workflow"
    description: "All components including sprint-flow orchestrator"
    components: [quality-gates, ai-review, sprint-flow]
    install_command: "bash scripts/install-all.sh && bash scripts/install-delphi-review.sh && bash scripts/install-test-spec-alignment.sh && bash scripts/install-sprint-flow.sh"
```

## Dependency Graph

```
pre-commit ─────────────┐
                        ├── (pre-push recommends delphi-review)
pre-push ──────────┐     │
                   ├── delphi-review ──┐
                   │                   │
test-spec-alignment ───┤               │
                       │               │
sprint-flow ───────────┘               │
                                       │
quality-gates-code-of-conduct ─────────┘ (reference, no runtime dependency)
```

No component is mandatory. Each works standalone.
