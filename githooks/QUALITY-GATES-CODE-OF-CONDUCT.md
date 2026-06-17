# 质量门禁行为准则

## 核心原则

**质量门禁是刚性的。工具检测出告警/错误 = 必须修复，不允许绕过。**

---

## 禁止行为

### 严禁使用 `--no-verify` 绕过门禁

```bash
# ❌ 绝对禁止
git push --no-verify
git commit --no-verify

# ✅ 正确做法：修复问题后正常提交
git commit    # 门禁通过后才允许
git push      # pre-push 验证通过后才允许
```

**唯一例外**: 纯文档变更（markdown、yaml、json 非代码配置）且不涉及任何源码文件时，pre-push hook 会自动跳过 code-walkthrough 检查，无需手动干预。

---

## 允许跳过的场景

### 1. 工具无法检查的文件类型

| 文件类型 | 原因 | 处理 |
|----------|------|------|
| `.md` | 无静态分析工具 | 自动跳过，不需要人工干预 |
| `.txt` | 纯文本 | 自动跳过 |
| `.json` (非代码配置) | 无语法检查 | 自动跳过 |
| `.yaml` (非代码配置) | 无语法检查 | 自动跳过 |
| 图片文件 | 无法静态分析 | 自动跳过 |

**判断标准**: 门禁工具本身是否能检查该文件类型。能检查 → 必须通过；不能检查 → 自动跳过。

### 2. 门禁工具未安装

```
❌ 错误：因为工具没装所以跳过检查
✅ 正确：安装工具后重新提交
```

工具未安装不是跳过的理由。Agent 必须：
1. 报告缺失工具
2. BLOCK 操作
3. 通知用户安装
4. 等待用户解决环境问题

---

## 门禁失败处理流程

### 当工具检测出告警/错误时

```
1. 停止所有后续操作
2. 分析告警/错误原因
3. 修复问题（最小改动）
4. 重新运行门禁验证
5. 通过后才能继续
```

**禁止行为**:
- 用 `--no-verify` 跳过
- 删除 failing tests 让门禁通过
- 修改门禁阈值让告警消失
- 用 `@ts-ignore`/`as any` 压制类型错误

---

## 门禁工具行为映射

| 门禁 | 工具 | 失败处理 | 允许跳过？ |
|------|------|---------|-----------|
| Gate 1: 代码质量 | tsc/ruff/clang-tidy/ESLint/flake8 等 | 修复错误后重试 | ❌ 不允许 |
| Gate 2: 重复代码 | jscpd/pylint-dup 等 | 减少重复代码 | ❌ 不允许 |
| Gate 3: 圈复杂度 | lizard | 降低复杂度 | ❌ 不允许 |
| Gate 4: Principles | principles checker | 修复代码异味 | ❌ 不允许 |
| Gate 5: 测试 + 覆盖率 | vitest/pytest/go test 等 | 增加测试覆盖 | ❌ 不允许 |
| Gate 5a-BLOCK: 新增文件测试强制 | pre-commit (Gate 5 子检查) | 新增 .ts/.tsx 文件添加对应测试，或添加 `@no-test-required` 注解 | ❌ 不允许（新增文件 BLOCK，修改文件 WARNING） |
| Gate 6: 架构 + 童子军 | archlint + boy-scout.ts | 修复架构/减少警告 | ❌ 不允许 |
| Gate 7: 密钥扫描 | gitleaks/trufflehog | 移除密钥或使用环境变量 | ❌ 不允许 |
| Pre-push Gate M2: Mock 密度 | inline in pre-push | 降低 mock 密度至 ≤30% (Phase 1 WARNING) 或添加 `@mock-justified` | ❌ 不允许（Phase 1 WARNING，Phase 2 将启用 BLOCK） |
| Pre-push: Code Walkthrough | delphi-review | 修复专家提出的问题 | ❌ 不允许 |

---

## Red Flags

如果你发现自己有以下想法，**立即停止**：

| 想法 | 现实 |
|------|------|
| "这个测试不重要，可以跳过" | 测试是门禁的一部分，跳过 = 降低质量 |
| "用 --no-verify 快速提交" | 绕过门禁 = 技术债务 |
| "门禁太严格了" | 门禁是质量保障，不是障碍 |
| "这个问题以后修" | 问题现在必须修，gate 不允许带病提交 |
| "文件不多，手动检查就行" | 工具检查比人工更可靠 |
| "工具没装，先提交再说" | 环境问题不是跳过理由 |

---

## 违规后果

| 行为 | 后果 |
|------|------|
| 使用 `--no-verify` | 代码可能被回退，重新评审 |
| 删除 failing tests | 测试覆盖缺口，质量风险 |
| 压制告警 | 潜在 bug 引入生产环境 |

**门禁是零容忍的。不允许例外。**

---

## 设计约束：staged-only 扫描

**pre-commit hook 默认只扫描 staged 文件（`$CHANGED_FILES`），不扫描全量代码库。**

这是有意为之的设计决策，原因：

| 原因 | 说明 |
|------|------|
| 性能 | 全量扫描大型代码库会导致每次提交等待 30s+，破坏开发流 |
| 童子军规则 | Boy Scout Rule 保证"修改不恶化"，存量债务不阻断新提交 |
| 增量改进 | Hook 聚焦 staged 变更，全量质量由 CI/CD 管道覆盖 |

**这意味着**：

- 预存在的代码债务不会在本地提交时被阻断（仅新代码和修改的代码受检）
- 全量质量扫描由 `.github/workflows/quality-gates.yml` 的 CI 作业和定期 `quality-audit` 任务覆盖
- 如果需要对某些文件触发全量检查，对该文件做任意修改后提交即可（修改会触发该文件的全量扫描）

> **不是漏洞，是设计约束。** Hook 聚焦增量质量，全量质量靠 CI 和定期审计。

## Lint Baseline（lint 基线）

lint 基线是 staged-only 扫描的配套机制。它允许项目记录当前 lint 错误的总量，并在每次提交时只检查**新增**的 lint 错误。

### 工作机制

1. **初始化基线**：`xp-gate baseline create` 全量扫描代码库，记录每个文件的 lint 错误数
2. **增量检查**：每次 `git commit` 时，pre-commit hook 对比当前 lint 错误数和基线中的记录
3. **决策规则**：
   - 当前错误 ≤ 基线 → ✅ PASS（甚至显示减少量）
   - 当前错误 > 基线 → ❌ BLOCK（显示新增的错误数）

### 什么时候用

| 项目状态 | 建议 |
|---------|------|
| 新项目（无 lint 错误） | 不需要基线，`--max-warnings 0` 够用 |
| 有存量 lint 错误的项目 | 创建基线后，每次提交只检查新增错误 |
| CI 永远是红色 | 创建基线 → 逐步修复 → `xp-gate baseline reset` 更新基线 |

### CLI 命令

```bash
xp-gate baseline create   # 创建基线（全量扫描）
xp-gate baseline show     # 查看当前基线
xp-gate baseline reset    # 重置基线（修复完错误后更新）
xp-gate baseline diff     # 对比当前状态和基线差异
```

### 相关配置

基线存储在 `.xp-gate/lint-baseline.json`（已 gitignore），每个项目/分支独立。

### 和 Boy Scout Rule 的关系

| 机制 | 覆盖范围 | 检查时机 | 目标 |
|------|---------|---------|------|
| Boy Scout Rule | Principles 警告（Clean Code/SOLID） | 每次 commit | 修改不恶化，≤5 清零 |
| Lint Baseline | Lint 工具错误（ESLint/ruff/shellcheck） | 每次 commit | 不引入新错误，逐步减少债务 |

两者共同保证：**存量债务不阻断工作，增量必须逐步改善。**

## 自动跳过逻辑

pre-push hook 已内置自动检测：

```bash
# 如果推送的文件全部是非源码文件
# hook 会自动跳过 code-walkthrough 检查
# 输出: "📚 Documentation-only push. Skipping walkthrough."

# 如果包含任何源码文件
# hook 会要求 code-walkthrough 结果
# 缺失 → BLOCK，不允许推送
```

**Agent 不需要也不应该手动判断是否跳过。让 hook 决定。**
