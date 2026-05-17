# SonarQube for IDE 集成方案

**Date:** 2026-05-17
**Issue:** #44
**Status:** APPROVED
**Author:** Sisyphus

---

## 1. 概述

为 XGate 用户提供 **SonarQube for IDE** 的集成方案，实现编码过程中的即时质量反馈。

**核心价值**：
- XGate pre-commit hook 反馈延迟 < 30s
- SonarQube for IDE 提供 **编码时实时提示**（< 1s）
- 两者互补：IDE 预防问题 → pre-commit 最终验证

---

## 2. 核心任务

### 任务 1：调研 SonarQube for IDE 版本差异

| 版本 | 价格 | 功能 | 适用场景 |
|------|------|------|---------|
| **Community (免费)** | $0 | 基础规则、本地分析 | 个人项目、开源项目 |
| **Developer (付费)** | $9/月/用户 | 高级规则、SonarQube 服务器连接 | 团队开发、私有代码 |
| **Enterprise** | 定制 | 自定义规则、CI 集成 | 大型企业 |

**决策**：XGate 默认推荐 **Community 版**（免费），私有项目可升级到 Developer 版。

---

### 任务 2：IDE 集成文档

#### VS Code 集成

**插件**：SonarQube (by SonarSource)
**安装**：
```bash
# 通过 VS Code 扩展市场搜索 "SonarQube"
# 或使用命令行
code --install-extension sonarsource.sonarlint-vscode
```

**配置** (`.vscode/settings.json`)：
```json
{
  "sonarlint.connectedMode.project": {
    "connectionId": "SONARQUBE",
    "projectKey": "xgate"
  },
  "sonarlint.additionalRulesetPlugins": [
    "sonar-ts",
    "sonar-python",
    "sonar-java"
  ],
  "sonarlint.output.showSonarLogs": true,
  "sonarlint.showBottomPanelOnFindViolation": true
}
```

**扩展推荐** (`.vscode/extensions.json`)：
```json
{
  "recommendations": [
    "sonarsource.sonarlint-vscode",
    "dbaeumer.vscode-eslint",
    "ms-python.python",
    "ms-vscode.vscode-typescript"
  ]
}
```

#### JetBrains 集成

**插件**：SonarLint
**安装**：
```
Settings → Plugins → Search "SonarLint" → Install
```

**配置**：
```
Tools → SonarLint → Connect to SonarQube
→ Select project → Configure bindings
```

#### Vim/Neovim 集成

**插件**：coc-sonarlint (通过 coc.nvim)
**安装** (vim-plug)：
```vim
Plug 'neoclide/coc.nvim', {'branch': 'release'}
Plug 'coc-extensions/coc-sonarlint'
```

**配置** (`~/.config/nvim/init.vim`)：
```vim
let g:coc_global_extensions = ['coc-sonarlint']
let g:sonarlint_enabled = 1
```

---

### 任务 3：XGate 规则与 Sonar 规则映射

| XGate 规则 | Sonar 规则 | 冲突处理 |
|-----------|-----------|---------|
| Gate 1 (代码质量) | SonarLint 基础规则 | **互补**：Sonar 实时提示，Gate 最终验证 |
| Gate 4 (Clean Code) | `rules:sonar:clean-code` | **去重**：XGate 优先，Sonar 辅助 |
| Gate 6 (架构) | `rules:sonar:architecture` | **独立**：XGate 架构规则更严格 |

**关键决策**：
- **避免重复警告**：在 `.vscode/settings.json` 中禁用与 XGate 重复的 Sonar 规则
- **优先级**：XGate pre-commit 门禁为准，Sonar 作为辅助提示

**禁用重复规则** (`.vscode/settings.json`)：
```json
{
  "sonarlint.filteredRules": [
    "typescript:S3776",  // 圈复杂度（Gate 3 已覆盖）
    "python:S103",       // 行长度（Gate 4 已覆盖）
    "java:S1192",        // 重复字符串（Gate 2 已覆盖）
    "javascript:S3776"   // 函数复杂度（Gate 3 已覆盖）
  ]
}
```

---

### 任务 4：IDE 状态同步评估

**需求**：将 Sonar 问题自动转为 XGate TODO

**方案对比**：

| 方案 | 复杂度 | 价值 | 建议 |
|------|--------|------|------|
| **TODO 注释同步** | 低 | 中 | ✅ 推荐 |
| **GitHub Issue 自动创建** | 中 | 高 | ⚠️ 可选 |
| **XGate Dashboard 集成** | 高 | 中 | ❌ Phase 2 |

**TODO 同步实现**：
```typescript
// 检测 Sonar 问题 → 自动添加 TODO 注释
// 文件：src/ide-sync.ts
function syncSonarToTodo(sonarIssue: SonarIssue): void {
  const todoComment = `// TODO[XGate-${sonarIssue.ruleId}]: ${sonarIssue.message}`;
  // 插入到问题位置
}
```

**决策**：Phase 1 仅实现 **TODO 注释同步**（低复杂度），Phase 2 评估 GitHub Issue 同步。

---

## 3. 输出物

### 文档

- `docs/IDE-INTEGRATION.md` — 完整集成指南
- `.vscode/settings.json` — VS Code 配置模板
- `.vscode/extensions.json` — VS Code 扩展推荐
- `skills/sonarqube-ide/SKILL.md` — on-demand 查询 Sonar 状态 Skill

### 代码

- `src/ide-sync.ts` — IDE 状态同步工具（Phase 1）
- `scripts/setup-ide.sh` — IDE 环境一键配置脚本

---

## 4. 安装脚本

```bash
#!/usr/bin/env bash
# scripts/setup-ide.sh

set -e

echo "🔧 配置 VS Code..."

# 安装 SonarLint 插件
code --install-extension sonarsource.sonarlint-vscode --force

# 复制配置模板
cp .vscode/settings.json.example .vscode/settings.json
cp .vscode/extensions.json.example .vscode/extensions.json

echo "✅ VS Code 配置完成"
echo "   重启 VS Code 以生效"
```

---

## 5. 测试验证

| 验证项 | 方法 |
|--------|------|
| SonarLint 安装 | `code --list-extensions` 查看 |
| 规则映射正确 | 添加问题代码，验证仅显示非重复警告 |
| TODO 同步 | 添加 Sonar 问题，验证 TODO 注释生成 |
| 多 IDE 支持 | 在 VS Code/JetBrains/Vim 分别测试 |

---

## 6. 关键决策

| 决策 | 方案 | 理由 |
|------|------|------|
| 免费 vs 付费版本 | Community (免费) | XGate 用户多为个人/小团队，免费版足够 |
| 规则冲突处理 | XGate 优先，Sonar 辅助 | pre-commit 门禁为准，IDE 仅辅助 |
| 状态同步范围 | TODO 注释 → GitHub Issue | 渐进式：先实现低复杂度方案 |
| IDE 支持优先级 | VS Code > JetBrains > Vim | 覆盖 80% 用户，Vim 为可选 |

---

## 7. 实施计划

### Phase 1 (MVP)

- [x] 调研 SonarQube 版本差异
- [x] 编写 IDE 集成文档
- [x] 提供 `.vscode/settings.json` 和 `.vscode/extensions.json` 模板
- [ ] 实现 TODO 同步工具
- [ ] 创建安装脚本

### Phase 2 (可选)

- [ ] GitHub Issue 自动创建
- [ ] XGate Dashboard 集成
- [ ] 自定义规则扩展

---

## 8. 参考链接

- [SonarQube for IDE](https://www.sonarsource.com/products/sonarqube/ide/)
- [VS Code 插件文档](https://docs.sonarsource.com/sonarqube-for-ide/vs-code/)
- [SonarLint 规则文档](https://docs.sonarsource.com/sonarlint/)

