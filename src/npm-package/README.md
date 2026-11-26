# XP-Gate

**AI 写的代码，谁来验？**

> AI 写 100 行代码只需 5 秒，但判断这 100 行对不对仍然要人工花 30 分钟。
> XP-Gate 在每次提交、每次推送、每次设计评审上放一道机器门禁，把这 30 分钟压回秒级。

[![npm](https://img.shields.io/npm/v/@boyingliu01/xp-gate?logo=npm&color=cb3837)](https://www.npmjs.com/package/@boyingliu01/xp-gate)
[![npm downloads](https://img.shields.io/npm/dm/@boyingliu01/xp-gate?color=brightgreen)](https://www.npmjs.com/package/@boyingliu01/xp-gate)
[![GitHub stars](https://img.shields.io/github/stars/boyingliu01/xp-gate?style=flat&color=yellow)](https://github.com/boyingliu01/xp-gate/stargazers)
[![license](https://img.shields.io/badge/license-MIT-blue)](https://github.com/boyingliu01/xp-gate/blob/main/LICENSE)
[![platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20WSL%20%7C%20Windows-lightgrey)]()

[Delphi 评审](https://github.com/boyingliu01/xp-gate/tree/main/skills/delphi-review) · [Sprint Flow](https://github.com/boyingliu01/xp-gate/tree/main/skills/sprint-flow) · [变更日志](https://github.com/boyingliu01/xp-gate/blob/main/CHANGELOG.md) · [贡献指南](https://github.com/boyingliu01/xp-gate/blob/main/CONTRIBUTING.md)

---

## 60 秒看效果（不需要安装）

在一个现有的 Git 仓库里直接跑，**只看不拦**：

```bash
npx @boyingliu01/xp-gate check .
```

你会立刻拿到一份代码体检报告 —— 21 条 Clean Code / SOLID 规则。
**不写任何配置、不装 hook、不碰你的提交。**

```text
━━━ Gate 4: Principles ━━━
✓ No violations found
Files checked: 1    Rules run: 21    Execution time: 4ms
```

默认只跑 `principles`（Gate 4）。想把架构层、复杂度、重复代码也一起体检：

```bash
npx @boyingliu01/xp-gate check . --all
```

觉得有用，再决定要不要把它接到提交上 👇

---

## 装上之后，它替你挡什么

本仓库共 **15 道数字门禁（Gate 0–13，含 12b / 12c）** 挂在 `git commit` / `git push` 上，另有 4 道按需门禁（`python-health` / `test-layers` / `pbt` 等）由 `xp-gate check` 单独调用。

下面每一条都来自本仓库自己的审计记录（`docs/gate-quality-matrix-2026-11-19.md` §10.4），
不是设想出来的场景：

| 门禁 | 真实拦下的一次提交 | 是不是真问题 |
|---|---|---|
| **Gate 0** | 改了生产源码却忘记升级版本号 | ✅ 是 |
| **Gate 1** | shellcheck 告警数超过空基线 | ✅ 是 |
| **Gate 3** | 一个函数复杂度从 3 涨到 4（加了三元表达式） | ✅ 是 |
| **Gate 12b** | 只改了 canonical 源码，没有同步镜像文件 | ✅ 是 |

> **门禁在拦我，说明它们在工作。**

反过来，这个项目也被自己的门禁坑过：三个门禁看起来一直是绿的，
实际上一次都没真正执行过（[#636](https://github.com/boyingliu01/xp-gate/issues)，详见 CHANGELOG 0.38.126）。
从那以后，每个门禁都必须输出 **PASS / DEBT / SKIP / FAIL 四态**，
**没跑过永远不会被报告成"绿"**。这是 XP-Gate 和"看起来能跑"的工具之间最大的区别。

---

---

## 安装

```bash
npm install -g @boyingliu01/xp-gate
cd your-project
xp-gate init
```

需要 Node ≥18、Git ≥2.38。完整文档：[GitHub README](https://github.com/boyingliu01/xp-gate#readme)

## 常用命令

| 命令 | 作用 |
|---|---|
| `xp-gate init` | 安装 Git Hooks + 适配器 |
| `xp-gate doctor [--fix]` | 诊断 / 自动修复安装状态 |
| `xp-gate check <path> [--all]` | 手动跑门禁 |
| `xp-gate gate-coverage [--debt]` | 看清每道门禁的真实状态（PASS / DEBT / SKIP / FAIL） |
| `xp-gate baseline create` | 把存量告警记为基线，只拦新变差的 |
| `xp-gate uninstall` | 完整回滚 |

## License

MIT
