# Contributing to XP-Gate

Thank you for your interest in contributing!

## Development Setup

> **Windows 用户**: 需安装 [Git for Windows](https://git-scm.com/download/win)，确保 `bash` 在 PATH 中可用。
> 安装后 Git Bash 会自动将 `git.exe` 所在目录加入 PATH。

```bash
# Clone and install
git clone https://github.com/boyingliu01/xp-gate.git
cd xp-gate
npm install

# Setup git hooks (MANDATORY) — installs hooks + adapter infrastructure
bash githooks/install.sh --force

# Verify installation
bash githooks/verify.sh
```

## Running Tests

```bash
npm test                  # 全量：137 test files / 2038 tests
npx vitest run <path>     # 定向跑单个文件
```

测试只允许写 `os.tmpdir()` 下的副本。vitest 的 globalSetup
(`scripts/vitest-worktree-guard.cjs`) 会在运行前后对比 `git status --porcelain`，
把**本次运行新增**的脏文件报出来——你自己未提交的改动不会被算到测试头上。
确实需要写回仓库的测试（例如验证 sync 真的落盘）用逃生阀降级为告警：

```bash
XP_GATE_SKIP_WORKTREE_GUARD=1 npm test
```

Windows 与 ubuntu 现在应当同样全绿。若 Windows 上出现失败，先留下
`npm test` 的完整输出再定位，不要用定向跑绕过——全量红、定向绿正是 #428 掩盖问题的方式。

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

All commits must pass the 6-gate quality system:

| Gate | 检查内容 | 标准 |
|------|---------|------|
| 1 | 代码质量 (Static + Lint + Shell) | 零错误 |
| 2 | 重复代码检测 | ≤5% 相似度 |
| 3 | 圈复杂度 | ≤5 警告，≤10 阻断 |
| 4 | Clean Code + SOLID | 零错误 |
| 5 | 单元测试 + 覆盖率 | 全部通过 + ≥80% |
| 6 | 架构质量 + 童子军规则 | 层边界不违规 + 警告不增加 |

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

## Walkthrough Scope

Code walkthroughs have no hard file-count or LOC limit. Large diffs must be reviewed completely or split by user choice before review; size-based bypass is not permitted.

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
