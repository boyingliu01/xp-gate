# Skill Version Sync — 设计文档 (v2)

## 问题背景

xp-gate 由两大组件构成：
1. **Hook 质量门禁**（代码变更为主）— 修改 githooks/adapters/src/ 等
2. **Skills**（Markdown 变更为主）— 修改 skills/*.md 模板和流程定义

当前版本发布流程：
- `VERSION` 文件（4 位格式 `MAJOR.MINOR.PATCH.MICRO`）是版本唯一真相源
- `sync-version.sh` 将版本号同步到 4 个 package.json
- `npm-publish.yml` 仅在 `push` 到 `main` 且 `VERSION` 文件变更时触发
- npm 仅支持 3 位 semver（`MAJOR.MINOR.PATCH`），当前 sed 丢弃 MICRO 位

### 问题

对 skill 进行调优时（仅修改 .md 文件），开发者往往不会 bump VERSION 文件。这导致：
1. npm publish 不触发 → 用户安装不到最新的 skill 更新
2. 版本号与实际发布内容不一致 → 版本混乱
3. Skill 变更缺少质量验证 → 没有 skill-cert 评估来验证 skill 质量

## 设计方案

### 核心规则

**每完成一个 sprint（sprint-flow 迭代），PATCH 版本号 +1，与变更内容无关。**

- Skill-only 变更 → bump PATCH（如 `0.6.0.0` → `0.6.1.0`）
- Code 变更 → bump PATCH（如 `0.6.0.0` → `0.6.1.0`）
- 重大功能 → bump MINOR（如 `0.6.0.0` → `0.7.0.0`）
- Breaking change → bump MAJOR（如 `0.x → 1.0.0.0`）

npm 版本映射保持不变：`MAJOR.MINOR.PATCH.MICRO` → 丢弃 MICRO → npm `MAJOR.MINOR.PATCH`。
MICRO 仅在 sprint 内部迭代时使用，每次 sprint SHIP 后 MICRO 重置为 0。

### 版本 bump 约定

| 变更类型 | 版本 bump | 示例 | npm 效果 |
|---------|----------|------|---------|
| Breaking change | MAJOR | `0.x.0.0 → 1.0.0.0` | `1.0.0` |
| 重大新功能 | MINOR | `0.6.0.0 → 0.7.0.0` | `0.7.0` |
| 普通 sprint（代码或 skill） | PATCH | `0.6.0.0 → 0.6.1.0` | `0.6.1` |

### 修改清单

#### 1. `skills/sprint-flow/SKILL.md` — Phase 6 SHIP 新增 VERSION-GATE

在 Phase 6 SHIP 段落新增 HARD-GATE，强制每个 sprint 完成时 bump VERSION：

```markdown
- **⚠️ VERSION-GATE**: Phase 6 提交前必须 bump VERSION 文件
  - 默认 bump PATCH 位（如 `0.6.0.0` → `0.6.1.0`，MICRO 重置为 0）
  - 重大新功能 bump MINOR 位，Breaking change bump MAJOR 位
  - 运行 `bash scripts/sync-version.sh` 同步到所有 package.json
  - 更新 `CHANGELOG.md` 添加本次变更记录
  - 验证：`git diff VERSION` 确认版本号已变更
  - 此规则与变更类型无关 — 纯 skill 变更也必须 bump PATCH
```

#### 2. `.github/workflows/quality-gates.yml` — Skill 变更触发 skill-cert

在 quality-gates 工作流中新增一个 job，当 PR 包含 skill 文件变更时自动触发 skill-cert 评估：

```yaml
skill-cert-check:
  if: contains(github.event.pull_request.changed_files, 'skills/')
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Setup Python
      uses: actions/setup-python@v5
      with:
        python-version: '3.12'
    - name: Install skill-cert
      run: |
        cd skill-cert
        python -m venv venv
        source venv/bin/activate
        pip install -e .
    - name: Run skill-cert on changed skills
      run: |
        # 检测变更的 skill 目录并逐一评估
        CHANGED_SKILLS=$(git diff --name-only origin/main...HEAD -- skills/ | \
          grep -oP 'skills/\K[^/]+' | sort -u)
        for skill in $CHANGED_SKILLS; do
          echo "=== skill-cert: $skill ==="
          cd skill-cert && source venv/bin/activate
          python -m skill_cert evaluate --skill "../skills/$skill" --output json
          cd ..
        done
```

#### 3. 插件副本同步

通过 `scripts/copy-skills.sh` 同步更新后的 SKILL.md 到 3 个插件目录（claude-code, opencode, qoder）。

### 不修改的部分

- `scripts/sync-version.sh`：npm 版本映射保持不变（丢弃 MICRO）。
- `npm-publish.yml`：保持 `paths: [VERSION]` 触发。流程已强制 VERSION bump，无需修改。
- `test-plugins.sh`：版本一致性检查逻辑不变。
- VERSION 文件格式：保持 4 位 `MAJOR.MINOR.PATCH.MICRO`。

### 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| PATCH 频繁增长（每个 sprint +1） | 低 | 符合 semver 规范，不影响用户 |
| skill-cert 未安装时 CI 失败 | 中 | CI 中使用 `continue-on-error` 或条件跳过 |
| 开发者忘记 bump VERSION | 中 | Phase 6 VERSION-GATE 强制 + CI 检测 |

### 向后兼容

- 已发布的 npm 版本不受影响
- 当前 VERSION `0.6.0.0`，下一个 sprint 将 bump 到 `0.6.1.0`（npm `0.6.1`）
- 版本映射逻辑不变，无过渡期问题
