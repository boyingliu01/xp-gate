# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-05-05

### Added
- **Sprint Flow 全流程编排** — 一键启动 Think→Plan→Build→Review→Ship 7 阶段开发流水线
- **Phase 0: THINK** — brainstorming 需求探索，HARD-GATE 设计未批准不可实现
- **Phase 2: PARALLEL BUILD** — dispatching-parallel-agents 并行任务分发，executing-plans 隔离执行
- **Phase 3: REVIEW** — browse 浏览器自动化测试，test-spec-alignment 测试对齐
- **Phase 5: FEEDBACK** — retro 工程回顾，systematic-debugging 根因调试
- **Phase 6: SHIP** — finishing-a-development-branch 4 选项发布决策 (merge/PR/discard/keep)
- **Web 前端支持** — web-nextjs/web-react/web-vue 项目类型检测
  - design-shotgun UI 设计多版探索、qa 系统化测试、design-review 视觉审计、benchmark Core Web Vitals
- **移动端支持** — mobile-flutter/mobile-react-native 项目类型检测
  - flutter.sh 适配器 (flutter analyze/test)、flutter-test integration
- **CI/CD 集成** — GitHub Actions workflow (.github/workflows/quality-gates.yml)
- **负载/压力测试** — k6/locust/gatling 工具映射、.sprint-load-test.yaml 规范
- **API 测试** — Phase 3 API 自动化测试支持 (Go/Spring Boot/Django)
- **安全审计** — gstack/cso 全面替代 security-scan (15 phases 安全审计)
- **完整文档体系**：
  - README.md 全面重写 (381 lines，12 语言适配器 + Sprint Flow 流程图 + 配置说明)
  - ARCHITECTURE.md 新增 (818 lines，5 层架构图 + 分层详解 + 数据流)
  - CAPABILITIES.md 新增 (300 lines，完整能力清单矩阵)
- **project type 自动检测** — 8 种项目类型 (web/mobile/backend)

### Changed
- **Sprint Flow Phase 0** — office-hours → brainstorming (HARD-GATE 机制)
- **Sprint Flow Phase 3** — cross-model-review → delphi-review --mode code-walkthrough
- **6 道质量门禁适配 Flutter/PowerShell** — flutter.sh + powershell.sh 适配器
- **pre-commit 钩子** — 支持 React Native 检测 (package.json + react-native)
- **adapter-common.sh** — flutter/powershell 语言检测

### Fixed
- #6: specification-generator 触发器集成到 delphi-review
- #11/#13/#15: 管道退出码、pytest 误报、分支覆盖率
- #17: 6 个新语言适配器 (cpp/swift/objectivec/dart/flutter/powershell)
- #18: PowerShell 质量门禁
- #20: 质量门禁报告汇总
- #21: Stryker Mutation Testing Gate
- #26: cross-model-review → delphi-review --mode code-walkthrough
- #28: Web 前端项目支持
- #29: dispatching-parallel-agents 并行执行
- #30: Phase 0 brainstorming 替代 office-hours
- #31: Phase 6 finishing-a-development-branch
- #32: Phase 5 retro + systematic-debugging
- #33: 移动端支持 (Flutter/RN)
- security-scan → cso 安全能力覆盖验证

### Language Support (12 adapters)
TypeScript, Python, Go, Shell, Java, Kotlin, C++, Swift, Objective-C, Dart, Flutter, PowerShell

## [0.0.6] - 2026-04-30

### Added
- **Gate 9: Architecture Quality** - Clean Architecture layer boundary validation
  - TypeScript: archlint (@archlinter/cli) >= 2.0.0
  - Python: import-linter >= 2.0.0
  - Go: arch-go >= 1.7.0
  - Java: ArchUnit
  - C++: Phase 2 roadmap (requires `.skip-architecture-cpp` marker)
- **architecture.yaml** template with layer definitions and rules
  - 14 architecture rules: ARCH-001 to ARCH-014
  - Layer boundary enforcement (Domain, Application, Infrastructure, Presentation)
  - Circular dependency detection
  - Baseline/ratchet mode support
  - SARIF output integration
- **version-parser.ts**: Tool version compatibility checker
- **Gate 9 bats tests**: 18 test cases for shell script validation

### Changed
- Gate count: 8 → 9 (added Architecture Quality)
- TOOL-INSTALLATION-GUIDE.md: Added architecture tool installation
- README.md: Added Gate 9 documentation
- specification.yaml: Added REQ-ARCH-001 to REQ-ARCH-009

### Delphi Review Verified
- Round 1 → Round 2 → APPROVED (100% consensus, 9.67/10 confidence)
- Experts: delphi-reviewer-architecture, delphi-reviewer-technical, delphi-reviewer-feasibility
- Critical issues fixed: tool name, version checks, C++ skip marker

## [0.0.4] - 2026-04-14

### Fixed
- **Issue #7**: Code walkthrough pre-push hook CLI invocation error
  - Root cause: OpenCode CLI doesn't support skill subcommands
  - Solution: Replace CLI call with file validation (`.code-walkthrough-result.json`)
  - Hook validates: commit match, verdict=APPROVED, not expired (<1hr)
  - Skill executes in Agent session, writes result file
  - Decision: "mandatory but manually triggered" quality gate
- **Delphi Review**: code-walkthrough Round 1-3 → APPROVED (Expert A/B 9/10)

### Changed
- `githooks/pre-push`: 305 → 145 lines (file validation only)
- `skills/code-walkthrough/SKILL.md`: 276 → 469 lines (added result output)
- OpenCode environment: synced with latest fixes

### Added
- **specification-generator UPDATE mode**: Modify existing spec with Delphi review

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
- Initial XGate framework
- Principles checker with Clean Code + SOLID rules
- Git hooks framework
- Basic skill structure

### Known Issues
- AI agent shortcut-taking behavior (addressed in v0.0.2)
