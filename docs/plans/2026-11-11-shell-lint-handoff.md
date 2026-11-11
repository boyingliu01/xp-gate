# Shell 检查能力交接：pre-push 解析错误修复

**日期:** 2026-11-11
**来源分支:** `sprint/2026-11-11-shell-lint` (commit `74e54608`)
**目标工作线:** 门禁耗时排序和短路逻辑（正在重构 `pre-commit` / `pre-push`）

---

## 为什么这件事必须现在做

`githooks/pre-push` 当前有 **990 行（占全文 61%）处于「ShellCheck 无法解析」状态**。

不是"有 bug"，是**分析器在第 650 行就放弃了**，后面的代码从未被检查过。这与你正在做的重构有直接关系：你正在搬动一批结构未知的代码。

```
$ shellcheck -s bash githooks/pre-push
pre-push:650:38: error: Couldn't parse this then clause.  [SC1073]
pre-push:656:1:  error: ShellCheck directives only valid in front of
                        complete compound commands  [SC1123]
pre-push:657:6:  error: Unexpected keyword/token  [SC1072]
```

**根因**：一条 `# shellcheck source=...` 指示符被写在 `elif` 分支**内部**，ShellCheck 遇到这个就地放弃整个 `if` 块。

**已验证的代价**：修复后在副本上实测，暴露出 **9 条此前完全不可见的 warning**（原本只看到 3 条解析错误）。其中 `pre-push:1182` 的 SC2168 是**真错误**——`local` 被写在了 `for` 循环里而非函数内。

---

## 你要做的：两个 patch，共 10 行

### Patch 1 — 把指示符移出 `elif` 分支

**位置**：`githooks/pre-push` 约 656 行

**改前**：
```bash
if [ ! -f "$HOOK_RESOLUTION_FILE" ]; then
  echo "⚠️  hook-module-resolution.sh not found at $HOOK_RESOLUTION_FILE"
  echo "    Run: xp-gate init   (or reinstall the hooks)"
  echo "⚠️ Could not resolve adapter-common.sh. SKIP — Gate M."
  GATE_M_SKIP_REASON="hook-module-resolution.sh not found: $HOOK_RESOLUTION_FILE"
  GATE_M_SKIP_KIND="missing"
# shellcheck source=githooks/hook-module-resolution.sh
elif ! source "$HOOK_RESOLUTION_FILE" 2>/dev/null; then
```

**改后**（唯一区别：指示符移到 `if` 之前）：
```bash
# shellcheck source=githooks/hook-module-resolution.sh
if [ ! -f "$HOOK_RESOLUTION_FILE" ]; then
  echo "⚠️  hook-module-resolution.sh not found at $HOOK_RESOLUTION_FILE"
  echo "    Run: xp-gate init   (or reinstall the hooks)"
  echo "⚠️ Could not resolve adapter-common.sh. SKIP — Gate M."
  GATE_M_SKIP_REASON="hook-module-resolution.sh not found: $HOOK_RESOLUTION_FILE"
  GATE_M_SKIP_KIND="missing"
elif ! source "$HOOK_RESOLUTION_FILE" 2>/dev/null; then
```

> **语义变化：无。** 指示符是写给分析器看的，不是运行时指令。移到 `if` 之前它作用于整个复合命令，这正是它原本想要的效果。

### Patch 2 — 移除非法的 `local`

**位置**：`githooks/pre-push` 约 1182 行（Gate M2 mock 密度检查的 for 循环内）

**改前**：
```bash
      local _mock_content _mock_kw _mock_rest _mock_c
      _mock_content="$(cat "$test_file" 2>/dev/null)" || _mock_content=""
```

**改后**：
```bash
      # Not `local`: this block runs at top level (inside `for`, not a
      # function), so `local` is invalid here (SC2168). The names are already
      # file-scoped; each is assigned before use below.
      _mock_content="$(cat "$test_file" 2>/dev/null)" || _mock_content=""
```

> **语义变化：可忽略但需知晓。** 在当前 shell 中 `local` 于函数外**已经是错误**（bash 会报 `local: can only be used in a function` 并返回非零）。删掉后变量变为文件作用域，四个变量在使用前都已赋值，行为等价。**如果**这个 for 循环曾被包进函数，需重新评估——请在合并前确认它在顶层。

---

## 验证命令（必须全绿）

```bash
# 1. 解析错误必须归零
shellcheck -s bash -f gcc -S error githooks/pre-push
# 期望：无输出（exit 0）

# 2. 语法必须通过
bash -n githooks/pre-push

# 3. 应能看到 9 条 warning —— 这是「分析真的跑了」的证据
shellcheck -s bash -f gcc -S warning githooks/pre-push | wc -l
# 期望：9
```

**第 3 条是关键的反向验证**：如果你修完只能看到 0-3 条，说明解析仍然失败，代码还是没被检查。

那 9 条 warning 大多是 SC2034（变量看似未使用），属于**已被 source 机制使用的跨文件变量**，不必在本次修复中处理——它们会在 `.shellcheckrc` 和基线机制完善后统一处理。

---

## 我这边的边界（避免撞车）

在 `sprint/2026-11-11-shell-lint` 上**已完成并提交** `74e54608`，共 7 个文件：

| 文件 | 状态 |
|---|---|
| `githooks/adapters/shell.sh` | 已改（54 → 155 行） |
| `src/npm-package/adapters/shell.sh` | 已同步镜像 |
| `src/npm-package/lib/baseline.js` | 已改（+`findShellScripts`） |
| `.shellcheckrc` | 新增 |
| `githooks/__tests__/adapter-shell-{scope,tests}.test.bats` | 新增（9 个测试） |
| `src/npm-package/lib/__tests__/baseline-shell-scope.test.js` | 新增（4 个测试） |

**我刻意没有碰的文件**（留给你）：
- `githooks/pre-commit` —— 你正在重构
- `githooks/pre-push` —— 你正在重构（Patch 1+2 由你应用）
- `githooks/gate-entries/*` —— 你新建的，尚未被 git 跟踪

**合并后你会自动获得的收益**：shell 适配器的扫描范围从 glob 改为文件列表 + shebang 识别，覆盖数 **47 → 181**，`pre-commit` / `pre-push` 会第一次进入 Gate 1 的 shellcheck 检查。**这意味着你重构后的 hook 会被自动检查到**——如果那时 `pre-push` 的解析错误还没修，你会看到 Gate 1 报错。这正是两个改动需要配合的地方。

---

## 还需要你知道的：`gate-1-entry.sh` 有同样的过滤缺陷

`githooks/gate-entries/gate-1-entry.sh:464`：

```bash
SHELL_FILES=$(echo "$CHANGED_FILES" | grep '\.sh$' || true)
```

只匹配 `.sh` 后缀，所以 `pre-commit` / `pre-push` **永远进不了这个门禁**。

这不是急事（上面两个 patch 修的是分析器层面），但你在重构 `gate-1-entry.sh` 时顺手改掉最划算。参考实现在 `githooks/adapters/shell.sh` 的 `_shell_script_files()`——它同时按扩展名和 shebang 识别。

---

## 一句话总结

**先应用这两个 patch，再继续搬代码。** 否则你是在搬动 61% 结构未知的代码，搬完还得再验证一遍。
