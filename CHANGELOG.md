# Changelog

All notable changes to this project will be documented in this file.

## [0.0.3] - 2026-04-14

### Added
- **Boy Scout Rule** (Gate 8): Differential warning enforcement for historical projects
  - `boy-scout.ts`: File classification, delta calculation, baseline management
  - `baseline.ts`: Warning history storage (.warnings-baseline.json)
  - New files: zero-tolerance, Modified files: decrease-or-maintain
- **Objective-C Adapter**: Regex-based extraction for .m/.mm files
  - @implementation/@interface parsing
  - Objective-C method declarations
- **C++ Adapter**: Regex-based extraction for .cpp/.c/.h files
  - Function extraction with const/override/noexcept
  - Class/struct with inheritance
- **Gate 7 CCN**: lizard integration for C++/Objective-C cyclomatic complexity
- **Test annotations**: @test REQ-XXX, @intent, @covers AC-XXX format
- **specification.yaml**: YAML-based requirements and acceptance criteria

### Changed
- Gate count: 7 → 8 (added Boy Scout Rule)
- Language adapters: 7 → 9 (added C++, Objective-C)
- Test count: 166 → 257 tests
- Coverage: 94% → 85%+ (still above threshold)

### Fixed
- TypeScript strict mode issues in test files
- AdapterFactory null return type handling
- LSP rule parameter type annotation

### XP Consensus Verified
- Gate 1: PASS (TypeScript + Tests + Coverage)
- Navigator Phase 1: REQUEST_CHANGES
- Navigator Phase 2: APPROVED (confidence 10/10)
- Arbiter: APPROVED

## [0.0.2] - 2025-04-11

### Added
- **Hook-based Quality Gates**: Code-level enforcement replacing soft prompt constraints
- **Iron Law Workflow**: Mandatory verification before implementation
- **Delphi Review System**: Multi-expert consensus (≥91% threshold)
- **XP Consensus Engine**: Driver + Navigator + Arbiter decision workflow
- **Code Walkthrough**: Multi-model post-commit review
- **Test-Specification Alignment**: Two-phase verification

### Changed
- Addressed AI agent "shortcut-taking" problem from v0.0.1
- Zero-tolerance for quality gate tools availability
- No degradation on cost/environment issues

### Design Decisions
- Hook-based gates over stronger prompts (100% reliability vs ~30%)
- SARIF 2.1.0 output for IDE integration
- Skills as SKILL.md markdown (not executable code)

## [0.0.1] - 2025-03-XX

### Added
- Initial XP Workflow Automation framework
- Principles checker with Clean Code + SOLID rules
- Git hooks framework
- Basic skill structure

### Known Issues
- AI agent shortcut-taking behavior (addressed in v0.0.2)