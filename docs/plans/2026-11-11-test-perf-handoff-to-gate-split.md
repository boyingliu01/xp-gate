# 测试提速交接：两处生产代码问题已开 issue，其中一处与你正在做的门禁拆分强耦合

**日期:** 2026-11-11
**来源工作线:** 测试用例执行效率优化（只改测试文件，未动任何生产脚本）
**目标工作线:** 门禁执行拆分（正在重构 `pre-commit` / `pre-push`，新增 `gate-driver.sh` + `gate-entries/`）

---

## 一句话总结

我在优化测试耗时的时候，追查到两个**生产代码**层面的问题。按约定我没有改它们，
开了 issue：**[#804](https://github.com/boyingliu01/xp-gate/issues/804)**（`crap` 命令，
可直接修）和 **[#805](https://github.com/boyingliu01/xp-gate/issues/805)**（`install.sh`，
**与你正在改的 `deploy-manifest.sh` 直接耦合，请等拆分落地后再动**）。

---

## 你需要先知道的：你的改动会让 install.sh 变得更慢

这不是提醒你"可能冲突"，是**已经可以量化的影响**。

`githooks/install.sh:95-103` 逐条遍历 `DEPLOY_MODULE_FILES`，每个条目做
`mkdir -p` + `cp` + `chmod +x` 三次外部命令：

```bash
for module in "${DEPLOY_MODULE_FILES[@]}"; do
  src="$HOOKS_DIR/$module"
  if [ -f "$src" ]; then
    mkdir -p "$TARGET_HOOKS/$(dirname "$module")"
    cp "$src" "$TARGET_HOOKS/$module"
    chmod +x "$TARGET_HOOKS/$module"
    echo "  + $module -> .git/hooks/$module"
  fi
done
```

你的未提交改动往 `githooks/deploy-manifest.sh` 的 `DEPLOY_MODULE_FILES` 里加了
**18 个 `gate-entries/*` 条目**：

| | 数组条目数 |
|---|---:|
| HEAD | 24 |
| 你的工作区 | **42**（+75%） |

在本机（Windows 11 / Git Bash，负载 20%）实测的单次进程创建基线：

| 操作 | 耗时 |
|---|---:|
| `bash -c true`（**纯启动基线**） | **106 ms** |
| `bash -c cp` | 150 ms |
| `bash -c chmod` | 144 ms |

即每条清单项约 **3 × 150 ms ≈ 450 ms**。24 条 ≈ 11 s，**42 条 ≈ 19 s**——
这与 install.sh 当前实测的 17.4–19.8 s 吻合。

**所以：拆分完成后 `install.sh` 会比现在再慢约 8 s。** 这就是我建议
"先别单独优化 install.sh"的原因——现在优化一遍，你合并后条目数又变，等于白做。

---

## 我这边做了什么、边界在哪

### 已提交的测试改动（与你完全不相交）

只改了测试文件，**生产脚本一行未动**：

| 文件 | 收益 | 状态 |
|---|---:|---|
| `src/npm-package/lib/__tests__/crap-cli.test.js` | 32–41 s | 已验证 |
| `src/npm-package/lib/__tests__/mirror-sync.test.js` | 19.1 s | 已验证 |
| `scripts/__tests__/ccn-report.test.cjs` | 1.1 s | 已验证 |
| `scripts/__tests__/ccn-baseline-analyzer-version.test.cjs` | 0.55 s | 已验证 |

另有若干此前已完成的测试优化（`gate-5-runner-error`、`doctor`、`sprint-status-rework`、
`check-mattpocock-license`、`delphi-runner-mirror`、`sync-package-content`）。

### 我**刻意没有碰**的文件

- `githooks/pre-commit`、`githooks/pre-push` —— 你在重构
- `githooks/deploy-manifest.sh` —— 你已改（+18 行）
- `githooks/gate-driver.sh`、`githooks/gate-entries/` —— 你新建的
- `githooks/install.sh` —— **未动**，问题已记录到 #805
- `src/npm-package/lib/crap-cli.js` —— 未动，问题已记录到 #804

另外注意到工作区里有 `scripts/__tests__/adapters-gate-mirror-parity.test.cjs`（已 staged 的 M）
和 `scripts/__tests__/generated-mirror-reproducibility.test.cjs`（已 staged 的 A），
**这两个不是我改的**，我没有动它们。

---

## Issue #804：`crap` 命令的检查顺序错了（可直接修，与拆分无关）

`src/npm-package/lib/crap-cli.js:158` 在**检查 coverage 是否存在之前**先扫全源码树：

```js
const csv = runLizard(opts.paths);          // ← 先扫全树（默认 --paths src）
if (csv === null) { ...; return 1; }

if (!fs.existsSync(opts.coverage)) {        // ← 再发现 coverage 不存在
  console.error(`✗ No coverage artifact at ${opts.coverage}`);
  return 1;
}
```

实测：默认 `--paths src` 扫 **10.5 s**（高负载期 36.3 s），产出 9070 行 CSV 后**立即丢弃**；
换成空目录只需 0.33 s。

**修法**：把 `fs.existsSync(opts.coverage)` 判断移到 `runLizard()` 之前。两者无数据依赖。
这正是本项目 `AGENTS.md` 里「输入短路要先于工具探测」（REQ-GATE-PROBE-SHORTCUT）的
同一条原则，只是 `crap` 上漏了。

**注意**：修完必须补一条「**不能被短路**」的测试（coverage 存在时仍要真实扫描并排序），
否则短路会把"检查了"变成"什么都没检查"。

我已开 issue，**没有动代码**——这是你的节奏，我只递证据。

---

## Issue #805：`install.sh` 在 Windows 下 17–20 s

细节见 #805。核心结论：

- 慢在**进程创建基线 106 ms**，不在脚本逻辑
- 脚本做 42 次 `cp` + 40 次 `chmod`
- 理论优化：把逐文件操作批量化为 `cp -r` / `chmod -R`，可省 8–10 s
- **但必须先确认**逐条 `[ -f "$src" ]` 的跳过语义不能被批量复制绕过

> **记一个我推翻过的错误归因**，避免你重走：我早期用"连续跑 40 次 `cp`"测出
> `cp` = 504 ms/次、`chmod` = 527 ms/次，据此认为慢在 cp/chmod 本身。换个时间点复测，
> 同样命令只有 86 ms / 75 ms —— **差 6 倍**。那个数字反映的是当时的机器负载，
> 不是操作固有成本。用 `bash -c true` 校准后，真正的常量是 106 ms 的启动开销。
> 这个教训已写在 #805 正文里。

---

## 建议的处理顺序

1. **先把你的门禁拆分做完并合入**（`deploy-manifest.sh` 条目数稳定下来）
2. 然后拿 #805 重新评估 `install.sh` 批量复制——那时条目数是确定的 42 条
3. #804 随时可修，与拆分无耦合，改动约 10 行 + 1 条反向测试

如果你想现在就让 `install.sh` 不变慢，还有一个**不改脚本**的选项：把新增的 18 个
`gate-entries/*` 合并成一个 `cp -r` 分支（只对目录做批量复制，单文件仍走原循环）。
这样既保留了逐条 `[ -f ]` 的语义，又把 18 条 × 3 次操作压成 1–2 次。要不要做，你定。
