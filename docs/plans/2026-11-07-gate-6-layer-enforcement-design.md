# Gate 6 分层强制：让 architecture.yaml 第一次被真正读取

- 日期：2026-11-07
- 分支：`feat/gate-6-layer-enforcement`（worktree: `D:\projects\xp-gate-layers`）
- 基线：远端 `main` @ `1340b991`（v0.37.0.0）
- 关联 issue：#686（死配置）、#691（ARCH-04 分层方向规则）、#728（archlint 检测器恒空）

---

## 1. 问题：不是配置错了，是从来没人读

`architecture.yaml` 从 2026-04 起就声明了四条层边界，但 7 个月里没有任何一道门禁读过它。
这条时间线是本次实现的全部动机：

| Issue | 日期 | 当时的结论 | 实际发生了什么 |
|---|---|---|---|
| #16 | 05-03 | schema 不兼容，archlint 解析报错 | **修法是「不传 `--config`」** → `layers:` 从此永久死掉 |
| #102 | 06-02 | `src/architecture/index.ts` 不存在但 Gate 6 仍 PASS | 补了文件，没补消费者 |
| #171 | 06-07 | archlint 根本没装进任何 package.json | ARCH-001~014 是「documentation-only」 |
| #447 | 09-30 | `--config` 恒失败 | 再次绕开 |
| #619 | 10-26 | archlint 跑成功但记成 SKIP | 状态机 bug，遮住了问题 |
| #686 | 11-01 | 必须暴露死配置、禁止静默通过 | 加了 `[WARN:LAYERS_UNCHECKED]` |
| #728 | 11-03 | `layer_violation` 检测器**永远返回 0** | 仍未解决 |

**关键洞察**：#16 的「修法」本身就是病根。当时的正确反应应该是「架构配置没人读」，
而实际做法是把 `--config` 拿掉让它不再报错 —— 报错消失了，检查也没有了。

`architecture.yaml` 文件头自己写着：

> 本文件目前**不被任何代码消费** …… 但**不要认为它正在保护你的代码**。

这句话是诚实的，但它说明：**诚实标注不等于修复**。团队看到 Gate 6 PASS + 配置文件存在，
依然会以为分层干净。

---

## 2. 为什么不修 archlint，而是自己写

### 2.1 #728：检测器是空操作

`layer_violation` 在 `@archlinter/cli@0.16.0` 中：

- `archlint detectors list` 里**存在**，标 `disabled`
- 可以 `enabled: true`，可以 `-d layer_violation` 指定
- 配置能解析，进程 exit 0
- **但对教科书式的层违规产出 0 条结果**（7 种配置组合全部验证，见 ARCH-01 设计 §2.2）

依赖它意味着门禁的结论是「关于 archlint 的陈述」，不是「关于代码的陈述」。

### 2.2 迭代提速设计（O4）会让它更糟

性能优化任务要把 Gate 6 从「全树 scan」改成「按改动文件的父目录 scan」，
并自己标注了风险：

> 跨目录的循环依赖（A 在 dir1、B 在 dir2）可能漏检。

**分层违规按定义就是两个目录之间的一条边。** 按目录缩小扫描范围，结构上不可能看见它。
如果 O4 先落地而分层仍未实现，Gate 6 会从「没测分层」变成「测了一部分分层还给绿灯」——
比现状更难发现。

**因此本实现始终建全仓依赖图，不做增量。**

---

## 3. 设计

### 3.1 配置语义

沿用 `architecture.yaml` 现有格式（这是 #690 落地前的唯一输入）：

```yaml
layers:
  domain:
    pattern: "src/domain/**"
    allowedImports: []                       # 路径 glob 或层名，两种都认
    forbiddenImports: ["src/infrastructure/**"]
```

`allowedImports` 同时接受**路径 glob**（本仓库现用）和**裸层名**（更自然的写法）。
只支持一种，就会把用了另一种写法的所有边误报成违规 —— 这正是 allow-list 变成
误伤清单的方式。

**层归属按最长匹配决定**，不是按声明顺序。否则同一份文件会因为 YAML 排序不同
而 PASS 或 FAIL，判决依赖排序是这道门禁本身要消除的那类暗坑。

### 3.2 判定契约

沿用 pre-commit 既有的 `java.sh` / `powershell.sh` 协议：

| exit | 含义 | 触发条件 |
|---|---|---|
| 0 | PASS | 无违规 |
| 1 | FAIL | 有新违规 → 阻断提交 |
| 2 | BLOCK | 配置存在但不可用（fail-closed） |
| 3 | WARN | 无层配置，或违规全在 baseline 内 |

**「无配置」是 WARN 而不是 PASS。** 整类缺陷就是从「没配置 = 没东西可查 = 成功」开始的。
一个不声明分层的仓库没问题；一个声称自己查过分层、实际什么都没量的仓库才有问题。

### 3.3 Ratchet（baseline）

`.layer-baseline.json` 记录已接受的违规，形状与其他 baseline 一致：

```json
{
  "accepted": [
    {
      "file": "src/domain/legacy.ts",
      "from": "domain",
      "to": "infrastructure",
      "imports": "src/infrastructure/db"
    }
  ]
}
```

**baseline 文件损坏时 exit 2，不是当成空表。** 空表会把所有已接受的违规重新算成新的，
下一次自然反应就是「重建更大��� baseline」—— 债务被洗干净了。

### 3.4 文件范围：tracked + untracked

用 `git ls-files --cached --others --exclude-standard`：

- **tracked**：整个树，不只是 diff。分层归属是树的属性，不是改动的属性
- **untracked**：Agent 刚写的文件恰是最该查的时刻
- 遵守 `.gitignore`：不用维护 node_modules/dist/coverage 的排除清单

> 第一版只用了 `git ls-files`（tracked only），e2e 测试立刻发现未 add 的违规文件被漏掉。
> 这个 bug 值得记：它会让门禁在**最需要它的时刻**恰好失效。

---

## 4. 实测

### 4.1 用例矩阵（15 个 BATS 用例，逐个用 shell 等价验证通过）

| # | 场景 | 期望 | 结果 |
|---|---|---|---|
| 1 | 干净树 | 0 | ✅ |
| 2 | domain → infrastructure | 1 | ✅ |
| 3 | 违规被具名（不是只报数量） | 含文件名+边+目标路径 | ✅ |
| 4 | 无配置 | 3 + 明确说 NOT checked | ✅ |
| 5 | 配置无 layers 块 | 2 | ✅ |
| 6 | baseline 收编已知违规 | 3 | ✅ |
| 7 | baseline 不豁免新违规 | 1，只报新的 | ✅ |
| 8 | baseline 损坏 | 2 | ✅ |
| 9 | `allowedImports` 用路径 glob | 0 | ✅ |
| 10 | `allowedImports` 用裸层名 | 0 | ✅ |
| 11 | 嵌套层最长匹配优先 | 0 | ✅ |
| 12 | 层外文件不算违规 | 0 | ✅ |
| 13 | 注释掉的 import 不算违规 | 0 | ✅ |
| 14 | untracked 文件被扫描 | 1 | ✅ |
| 15 | gitignored 文件被忽略 | 0 | ✅ |

### 4.2 性能

本仓库（645 个源文件）：

| 阶段 | 耗时 |
|---|---|
| 解析 architecture.yaml | ~0.3 s |
| `git ls-files` | ~0.3 s |
| awk 扫描 | ~1.5 s |
| **合计** | **~2.1 s** |

但实测墙钟是 **6.2 s** —— 差额全是 MSYS2 的 fork 开销（单次 `awk` 启动实测 0.4–0.8 s）。
这恰好独立印证了 #640 与性能任务的结论：**Windows 上的瓶颈是进程启动，不是算法**。
迁到 WSL 后这一段预计降到 2 s 以内。

---

## 5. 接入方式

`githooks/pre-commit` 在 Gate 6 架构段新增约 40 行，**不修改任何既有逻辑**：

- 与 archlint **并行存在**，不是替代：archlint 管通用坏味道（循环依赖/上帝类/死代码），
  本脚本管依赖方向
- `LAYER_CHECKER` 按 `GATE_DIR` → `git rev-parse --show-toplevel` 两级查找，与
  `gate-12-file-hygiene.sh` 同款
- 脚本缺失时记 `layer_checker_missing` WARN，不假装覆盖了分层

**改动面刻意压到最小**，因为 `pre-commit` 是 5916 行的巨文件，且性能任务（O4）也要改 Gate 6 段。

---

## 6. 镜像与同步债

新增文件按 AGENTS.md 约定改 canonical 后同步：

| canonical | 镜像 1 | 镜像 2 |
|---|---|---|
| `githooks/gate-6-layers.sh` | `src/npm-package/gate-6-layers.sh` | `src/npm-package/hooks/gate-6-layers.sh` |
| `githooks/lib/layer-baseline.cjs` | `src/npm-package/lib/layer-baseline.cjs` | — |

`scripts/check-hook-mirror.sh` 的 `HOOK_MIRROR_FILES` / `ROOT_MIRROR_FILES` 已同步更新。

> 这条「双份代码」债正是 #632 / #633 / #649 / #658 一批回归的根因。本次按规矩做了，
> 但**它本身应该被工具消灭**，而不是靠每次记得。

---

## 7. 不做什么

- **不删 `architecture.yaml` 的 `layers:` 块**。它是 #690 / #691 的输入，现在终于有消费者了
- **不改 archlint 的调用方式**。那是 O4 的范围，且本次改动与它正交
- **不做跨语言**。Java 的 ArchUnit、Go 的 arch-go 是各语言的事，本脚本先覆盖 TS/JS
  （`#537` 已记录 Gate 3/4/6 对非 TS 主语言零覆盖的问题）
- **不把 `LAYERS_UNCHECKED` 警告直接删掉**。archlint 侧确实仍未测分层，标记应保留，
  但含义从「没人看」变成「archlint 没看」

---

## 8. 遗留与后续

1. **xp-gate 自身 0 违规是「真空的 0」** —— `src/domain/`、`src/application/` 等目录
   在本仓库不存在，所以 4 条规则匹配不到任何文件。这说明 `architecture.yaml` 描述的是
   **Clean Architecture 模板**，不是 xp-gate 的真实结构。要么补一份描述真实模块边界的配置，
   要么删掉这份模板 —— 留着它本身就是「配置与实际脱节」的又一个实例。**这需要你拍板。**
2. **非 TS 语言无覆盖**（#537 遗留）。
3. **`import()` 动态导入与 `export ... from` 尚未解析**。当前只处理
   `from "..."` 和 `require("...")`。若仓库大量使用 `export * from`，会漏检。
