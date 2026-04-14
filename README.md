# XP Workflow Automation

AI-powered development workflow tools with consensus engines and quality gates for XP pair programming.

## Features

- **XP Consensus Engine** - Driver + Navigator + Arbiter decision workflow using Delphi method
- **Code Walkthrough** - Multi-expert post-commit code review before push
- **Delphi Review** - MANDATORY consensus review before any implementation/design decisions
- **Test-Specification Alignment** - Two-phase verification ensuring tests match requirements
- **Principles Checker** - Clean Code (9) + SOLID (5) rules with 9 language adapters
- **Boy Scout Rule** - Differential warning enforcement for historical projects
- **8-Gate Quality System** - Pre-commit hooks blocking bad code

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
git commit  # Runs pre-commit (8 Gates)

# Push with AI code review
git push    # Runs pre-push (multi-expert Delphi review)
```

### Manual Skill Execution
```bash
# XP consensus workflow
/xp-consensus

# Code walkthrough
/code-walkthrough

# Delphi review
/delphi-review

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
Requirements and acceptance criteria in YAML format:
```yaml
specification:
  id: SPEC-XXX
  requirements:
    - id: REQ-XXX
      acceptance_criteria:
        - id: AC-XXX-01
          given: ...
          when: ...
          then: ...
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
├── xp-consensus/SKILL.md        # Driver-Navigator-Arbiter workflow
├── code-walkthrough/SKILL.md    # Multi-expert Delphi review
├── delphi-review/SKILL.md       # MANDATORY before implementation
├── test-specification-alignment/SKILL.md  # Two-phase verification
└── code-reviewer/SKILL.md       # Static analysis + SARIF
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