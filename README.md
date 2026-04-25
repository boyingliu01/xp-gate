# XP Workflow Automation

AI-powered development workflow tools with consensus engines and quality gates for XP pair programming.

## Features

- **Sprint Flow** - One-Shot Sprint 自动流水线 (Think → Plan → Build → Review → Ship) using superpowers TDD + review
- **Delphi Review** - MANDATORY consensus review before any implementation/design decisions (supports design and code-walkthrough modes)
- **Test-Specification Alignment** - Two-phase verification ensuring tests match requirements
- **Principles Checker** - Clean Code (9) + SOLID (5) rules with 9 language adapters
- **Boy Scout Rule** - Differential warning enforcement for historical projects
- **8-Gate Quality System** - Pre-commit hooks blocking bad code
- **Quality Gates Code of Conduct** - Zero-tolerance policy prohibiting `--no-verify` bypass

## Quality Gates

| Gate | Name | Purpose |
|------|------|---------|
| 1 | Static Analysis | TypeScript strict mode |
| 2 | Linting | ESLint checks |
| 3 | Unit Tests | vitest execution |
| 4 | Coverage | 80% threshold |
| 5 | Shell Check | shellcheck validation |
| 6 | Principles | Clean Code + SOLID |
| 7 | CCN | Cyclomatic complexity (≤5 warn, ≤10 block) |
| 8 | Boy Scout | Differential warning enforcement |
| 9 | Architecture | Clean Architecture layer boundaries |

### Gate 9: Architecture Quality

Enforces Clean Architecture principles using language-specific tools:

| Language | Tool | Rules |
|----------|------|-------|
| TypeScript | archlint (@archlinter/cli) | Layer dependency direction, boundary violations |
| Python | Deply | Layer isolation, import validation |
| Go | goarchtest | Architecture test patterns |
| Java | ArchUnit | Layer constraints, naming conventions |
| C++ | ⚠️ Not supported (Phase 2) | Requires `.skip-architecture-cpp` marker |

**Configuration**: Create `architecture.yaml` in project root to define layers and rules.

**Rules enforced**:
- ARCH-001 to ARCH-004: Layer boundary enforcement (Domain, Application, Infrastructure, Presentation)
- ARCH-005 to ARCH-007: Circular dependency detection
- ARCH-008 to ARCH-010: Type location validation

## Installation

```bash
# Clone repository
git clone https://github.com/boyingliu01/xp-workflow-automation.git
cd xp-workflow-automation

# Install dependencies
npm install

# Setup git hooks
cp githooks/pre-commit .git/hooks/pre-commit
cp githooks/pre-push .git/hooks/pre-push
chmod +x .git/hooks/pre-commit .git/hooks/pre-push
```

## Usage

### Git Workflow
```bash
# Commit with quality gates
git commit  # Runs pre-commit (9 Gates)

# Push with AI code review
git push    # Runs pre-push (multi-expert Delphi review)
```

### Manual Skill Execution
```bash
# One-Shot Sprint (自动流水线)
/sprint-flow "开发访谈机器人，支持多轮对话"
# Phase 2 uses: test-driven-development (superpowers) + freeze + review

# Delphi review (supports design and code-walkthrough modes)
/delphi-review                  # Design mode (default)
/delphi-review --mode code-walkthrough  # Code walkthrough mode (git push review)

# Test-specification alignment
/test-specification-alignment
```

### Principles Checker CLI
```bash
# Check files for Clean Code + SOLID violations
npx tsx src/principles/index.ts --files "src/**/*.ts" --format console

# SARIF output for IDE integration
npx tsx src/principles/index.ts --files "src/**/*.ts" --format sarif > results.sarif
```

### Boy Scout Rule
```bash
# Initialize baseline for historical project
npx tsx src/principles/boy-scout.ts --init-baseline

# Enforce differential warnings
npx tsx src/principles/boy-scout.ts \
  --new-files src/new-feature.ts \
  --modified-files src/existing.ts \
  --baseline .warnings-baseline.json
```

## Language Support

| Language | Adapter | Analyzer Tools |
|----------|---------|----------------|
| TypeScript | TypeScriptAdapter | tsc, ESLint |
| Python | PythonAdapter | Ruff, mypy |
| Go | GoAdapter | golangci-lint |
| Java | JavaAdapter | CheckStyle, PMD, SpotBugs |
| Kotlin | KotlinAdapter | detekt, ktlint |
| Dart | DartAdapter | dart analyze |
| Swift | SwiftAdapter | swiftlint |
| C++ | CppAdapter | clang-tidy, cppcheck |
| Objective-C | ObjectiveCAdapter | scan-build, oclint |

## Configuration

### .principlesrc
```json
{
  "rules": {
    "clean-code": {
      "long-function": { "enabled": true, "threshold": 50 },
      "god-class": { "enabled": true, "threshold": 15 },
      "deep-nesting": { "enabled": true, "threshold": 4 }
    },
    "solid": {
      "srp": { "enabled": true, "methodThreshold": 15 },
      "dip": { "enabled": true }
    }
  },
  "performance": {
    "mode": "changed-files-only"
  }
}
```

### specification.yaml
Requirements and acceptance criteria (auto-generated from APPROVED design docs):
```yaml
specification:
  source: "docs/plans/2026-04-14-auth-design.md"
  generated: "2026-04-14"
  requirements:
    - description: "User login with password"
      acceptance_criteria:
        - given: "valid username and password"
          when: "POST /login"
          then: "returns 200 + JWT token"
```

### Test Annotations
```typescript
/**
 * @test REQ-XXX Feature implementation
 * @intent Verify correct behavior
 * @covers AC-XXX-01, AC-XXX-02
 */
describe('Feature', () => { ... });
```

## Skills Architecture

Each skill is defined as `SKILL.md` (markdown, not executable code):

```
skills/
├── sprint-flow/                   # One-Shot Sprint 自动流水线
│   ├── SKILL.md                   # Main skill definition
│   ├── references/                # Phase-specific execution instructions
│   │   ├── phase-0-think.md
│   │   ├── phase-1-plan.md
│   │   ├── phase-2-build.md       # TDD + freeze + review (replaces xp-consensus)
│   │   ├── phase-3-review.md
│   │   ├── phase-4-uat.md
│   │   ├── phase-5-feedback.md
│   │   └── phase-6-ship.md
│   └── templates/                 # Output templates
│       ├── pain-document-template.md
│       ├── emergent-issues-template.md
│       └── sprint-summary-template.md
├── delphi-review/SKILL.md         # MANDATORY before implementation (design + code-walkthrough dual modes)
├── specification-generator/SKILL.md  # Lightweight spec auto-generation from APPROVED design docs
├── test-specification-alignment/SKILL.md  # Two-phase verification
└── code-reviewer/SKILL.md         # Static analysis + SARIF
```

## Conventions

- **Zero-tolerance**: Quality gates block if tools unavailable
- **Delphi consensus**: Multi-expert anonymous review until ≥91% agreement
- **Boy Scout Rule**: Leave code cleaner than found
- **Test annotations**: @test, @intent, @covers required
- **Push limits**: Max 20 files, 500 LOC per push

## Documentation

- [Installation Guide](./githooks/TOOL-INSTALLATION-GUIDE.md)
- [Gate Validation Guide](./docs/gate-validation-guide.md)
- [Principles Configuration](./docs/principlesrc-configuration.md)

## License

MIT License - See [LICENSE](./LICENSE) file.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.