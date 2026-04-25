# Contributing to XP Workflow Automation

Thank you for your interest in contributing!

## Development Setup

```bash
# Clone and install
git clone https://github.com/boyingliu01/xp-workflow-automation.git
cd xp-workflow-automation
npm install

# Setup git hooks (MANDATORY)
cp githooks/pre-commit .git/hooks/pre-commit
cp githooks/pre-push .git/hooks/pre-push
chmod +x .git/hooks/pre-commit .git/hooks/pre-push
```

## Delphi Review Setup

The delphi-review skill requires configuration before use. It is **not** plug-and-play out of the box — you must define your own models.

```bash
# 1. Copy the template
cp skills/delphi-review/.delphi-config.json.example .delphi-config.json

# 2. Add agent definitions to your opencode.json
#    See skills/delphi-review/opencode.json.delphi.example for the template

# 3. Replace YOUR_PROVIDER/YOUR_MODEL with your actual provider and model names
```

See [skills/delphi-review/INSTALL.md](skills/delphi-review/INSTALL.md) for the full setup guide.

## Quality Gates

All commits must pass the 8-gate quality system:

| Gate | 检查内容 | 标准 |
|------|---------|------|
| 1 | TypeScript 严格模式 | 零错误 |
| 2 | ESLint 代码风格 | 零告警 |
| 3 | 单元测试 | 全部通过 |
| 4 | 测试覆盖率 | ≥80% |
| 5 | Shell 脚本语法 | 零错误 |
| 6 | Clean Code + SOLID | 零错误（warnings 由 Gate 8 处理） |
| 7 | 圈复杂度 | ≤5 警告，≤10 阻断 |
| 8 | 童子军规则（统一） | 新文件零告警；修改文件：警告数不增加；≤5 告警必须清零 |

## Pull Request Process

### Before Implementation

**Option A: Manual Workflow**
1. **MANDATORY**: Run `/delphi-review` for design decisions
2. Get APPROVED verdict from Delphi consensus
3. Create `specification.yaml` with requirements and ACs

**Option B: Sprint Flow (推荐)**
1. Run `/sprint-flow "[需求描述]"` to execute the full Think → Plan → Build → Review → Ship pipeline
2. The sprint-flow skill automatically chains: office-hours → autoplan → delphi-review → TDD + review → cross-model-review → ship
3. Key pause points require user confirmation (taste decisions, approval gates, user acceptance)

### During Implementation

1. Write tests first (TDD)
2. Add test annotations: `@test REQ-XXX`, `@covers AC-XXX`
3. Verify coverage ≥80%
4. Run `git commit` to trigger quality gates

### Before Merge

1. Run `/test-specification-alignment` for final verification
2. Ensure all ACs have passing tests
3. Run `/delphi-review --mode code-walkthrough` (or let pre-push hook trigger it)

## Coding Standards

### File Naming
- Source: `src/module/file-name.ts`
- Tests: `src/module/__tests__/file-name.test.ts`
- Skills: `skills/skill-name/SKILL.md`

### Test Annotations
```typescript
/**
 * @test REQ-XXX Feature name
 * @intent Verify specific behavior
 * @covers AC-XXX-01, AC-XXX-02
 */
describe('Feature', () => {
  it('should do X when Y', () => { ... });
});
```

### Anti-Patterns (NEVER)
- `as any`, `@ts-ignore`, `@ts-expect-error`
- Empty catch blocks
- Skipping quality gates via flags
- Modifying frozen tests in Phase 2

### Historical Projects

**首次提交**：自动从当前 violations 创建基线
**后续提交**：修改的文件警告数必须下降或持平
**新文件**：零容忍（任何警告都会阻止提交）

## Push Limits

- Maximum **20 files** per push
- Maximum **500 LOC** changes per push

Split large changes into multiple commits.

## Skill Development

Skills are markdown files, not executable code:

```markdown
---
name: skill-name
description: Brief description
---

# Skill Title

## Core Principles
...

## Workflow
...
```

## Questions?

Open an issue or discussion on GitHub.