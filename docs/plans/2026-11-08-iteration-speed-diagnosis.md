# XP-Gate 迭代速度与三件事的量化诊断

**日期**: 2026-11-08
**背景**: 用户诉求为「尽可能优化 XP-Gate 的迭代开发速度」，并指出三件必须彻底解决的事：
(1) 镜像重复导致代码膨胀与缺陷复现；(2) 门禁序号漂移；(3) 自动化测试用例瓶颈。
**本文只做量化与排期，不改代码。**

---

## 0. 结论先行

三件事不是并列的，它们有**共同根因**：同一份逻辑存在多份实现，而没有任何测试强制它们一致。

| 事 | 量化现状 | 与速度的关系 |
|---|---|---|
| ① 镜像重复 | 约 **30,404 行**重复代码，429 个文件被 git 跟踪 | 镜像测试被排除但仍占实盘；镜像分叉直接制造缺陷 |
| ② 序号漂移 | 注册表 `blocks` 列与代码**不一致**，且无测试守护 | 漂移导致修复落进不执行的文件，等于白做 |
| ③ 测试瓶颈 | 全量 **582.9 s**；前 4 个文件占 **58%** | 直接就是 Gate 5 的成本 |

**优先级建议：② → ③ → ①**。理由见 §5。

---

## 1. 度量环境

| 项 | 值 |
|---|---|
| 平台 | Windows 11 + Git Bash (MSYS2) |
| Node | v24.22.1 |
| CPU | 8 核 |
| 仓库 | `D:\projects\xp-gate` @ `8c39e265` (main) |
| `core.hooksPath` | `C:\Users\think\.config\xp-gate\hooks`（已同步至 5968 行，与仓库一致） |

### 1.1 一条必须知道的度量事实

**hook 自报的时间是错的，低估约 15 倍。**

实测一次 TypeScript 提交：

| | |
|---|---|
| `git commit` 真实耗时 | **57.9 s** |
| hook 写入报告 `duration_ms` | **4.0 s** |
| **未被记录** | **53.9 s** |

因此 `.xp-gate/reports/pre-commit/*.json` 与 `.xp-gate/audit.jsonl` **不能**用作速度基准。
历史上 `docs/plans/2026-11-07-iteration-speed-baseline.md` 的 ~65 s / ~150 s 就建立在这个漏记读数上。

**正确口径**：逐行给 hook 输出打时间戳，或直接对 `git commit` 计时。

---

## 2. 事①：镜像重复

### 2.1 规模

| 目录 | 文件 | 行数 |
|---|---|---|
| `githooks/adapters` | 29 | 5,346 |
| `src/npm-package/adapters` | 29 | 5,346 |
| `githooks/lib` | 19 | 3,395 |
| `src/npm-package/hooks/lib` | 19 | 3,395 |
| `src/principles` | 117 | 20,179 |
| `src/npm-package/principles` | 106 | 18,756 |
| `src/build-integrity` | 8 | 2,907 |
| `src/npm-package/build-integrity` | 8 | 2,907 |

重复约 **30,404 行**，`git ls-files` 跟踪 429 个镜像文件。

### 2.2 关键发现：镜像本来就不需要进版本控制

`src/npm-package/package.json` 的 `prepack` 已经会运行
`scripts/sync-package-content.js` 生成镜像。也就是说镜像在打包时**必然被重新生成**，
提交进 git 不提供任何保证，只提供**分叉的机会**。

`vitest.config.ts` 的注释已经承认了代价：

> `src/npm-package/<sub>/` 是 `src/<sub>/` 的字节副本，副本永远无法被覆盖：
> 测试 import 规范路径，v8 看到镜像为 0%。实测这些副本是 **11,688 行、0.00%**，
> 把报告总数从 82.77% 拖到 62.19%。

### 2.3 缺陷复现的真实机制

已发生过的实例（来自代码注释与 issue）：

- **#717**: 文档说 Gate 9 是 SAST，实际是 Build Integrity。修复被写进
  `githooks/gate-9.sh`——一个没有任何 hook source 的文件。改动"看起来落地了"，实际零效果。
- **#542**: 只改镜像不改 canonical，下次 prepack 被静默回滚，v0.27.3 带着这个 bug 发布。
- **#500**: 安装残留的 flat 副本会遮蔽被跟踪的文件。
- **本次会话**: 我改 `githooks/pre-commit` 后忘了同步
  `src/npm-package/hooks/pre-commit`，被 `doctor-hook-signatures` 测试抓到。

同一类缺陷在四个不同位置重复发生，说明这不是"某人疏忽"，而是**结构必然**。

### 2.4 建议方向

1. **镜像移出 git**，加入 `.gitignore`，由 `prepack` 生成。
   - 需要先确认 CI 的 Mirror Parity 作业是否依赖被跟踪的镜像。
2. 若必须保留（例如 CI 需要可见性），则改为**单一生成器 + 强制校验**，
   并让 `scripts/check-hook-mirror.sh` 在 pre-commit 而非仅 CI 执行。
3. **消除镜像测试**：`boy-scout.test.ts`、`mutmut-runner.test.ts`、
   `import-resolver.test.ts` 各有两份，占测试时间却不增加覆盖。

---

## 3. 事②：门禁序号漂移

### 3.1 注册表存在，但有一个致命缺口

`githooks/gate-registry.sh` 设计正确（name → number → impl → blocks），
并有漂移测试 `githooks/__tests__/gate-registry.test.bats`。

**但漂移测试不断言 `blocks` 列**：

```
grep -c "blocks" githooks/__tests__/gate-registry.test.bats   → 0
```

### 3.2 实测出的真实不一致

| 门禁 | 注册表声明 | 代码实际 | 一致？ |
|---|---|---|---|
| `code-quality` | `blocks=NO` | 4 处 `GATE_1_STATUS="BLOCK"` + `exit 1` | ❌ |
| `build-integrity` | `blocks=NO` | 1 处 `GATE_9_STATUS="BLOCK"` | ❌ |

代码证据（`githooks/pre-commit:2305`）：

```bash
1)
  echo "❌ BLOCKED - PSScriptAnalyzer violations (fix or add suppressions)"
  GATE_1_STATUS="BLOCK"
  GATE_1_DETAIL="powershell: PSScriptAnalyzer findings"
  exit 1
  ;;
```

这就是 #769 所说的"它的 blocks 列在发布当天就与 pre-commit 冲突"。

### 3.3 其他已上报的序号问题

- **#738**: CLI 侧（`gate-coverage.js`）门禁编号与 hook **相反**，9/10 双轨，#677 漏修。
- **#715**: Gate 6 双执行面分叉——pre-commit 缺架构配置即 BLOCK，CLI 面报 PASS。
- **#778**: 同一条门禁逻辑有三条执行路径，产生不同结论，**没有任何测试断言它们一致**。
- **#769**: `hooks/gate-registry.sh` 随包发布，但两条安装链路都不部署它。

### 3.4 `bats` 不在本地依赖里

`githooks/__tests__/*.bats` 是门禁的**可执行契约**，但 `bats` 未安装，
本地 `git commit` 不会跑它们；CI 用 `npx bats` 跑。
结果：漂移测试只在 CI 生效，改注册表的当天本地无感。

### 3.5 建议方向

1. 给漂移测试补 `blocks` 断言（这是最小、最直接的一步）。
2. 把注册表提升为**唯一生成源**：`impl`/`blocks` 从代码扫描得出，而非手写。
3. 消除三执行路径（#778）—— 优先让 hook 与 CLI 共用同一实现。

---

## 4. 事③：测试用例瓶颈

### 4.1 全量基线

| 组 | 耗时 | 测试数 |
|---|---|---|
| `src/npm-package/lib` | **152.8 s** | 1,293 |
| `src/principles` | 21.4 s | 747 |
| `src/build-integrity` | 10.2 s | 159 |
| `src/mutation` | 3.4 s | 194 |
| `src/npm-package/principles` | 1.2 s | (镜像，已排除) |

全量 `vitest run` 实测 **253–261 s**；带 `--coverage` 再加约 8 s。

### 4.2 前 4 个文件占 58%

| 文件 | 文件总耗时 | execSync 调用点 |
|---|---|---|
| `phase-transition.test.js` | **151.7 s** | 2 |
| `sprint-status-rework.test.js` | 80.5 s | 2 |
| `gate-runner.test.js` | 54.5 s | 9 |
| `doctor.test.js` | 54.0 s | 7 |
| `arch.test.js` | 31.7 s | — |
| `mirror-sync.test.js` | 29.8 s | — |
| `init.test.js` | 22.2 s | — |

### 4.3 根因：Windows 进程启动成本 × 调用次数

单个测试全是 `0.00 s`，但 `phase-transition.test.js` 的 103 个测试合计 **71.67 s**
—— 时间全在 `execSync('git …')` 里。

实测单次成本：

| 操作 | 耗时 |
|---|---|
| `git rev-parse` | 132–141 ms |
| `node -e ""` | 164–182 ms |
| `bash` no-op | ~80 ms |

**这是 Windows 平台特性，不是代码写得差。**
103 个测试 × 若干次 git 调用 × 130 ms ≈ 70 s。

### 4.4 两个立刻可做的高杠杆动作

**A. 合并 git 调用**：`phase-transition` 每个测试 setUp 都起 git 进程。
用一次 `git init` + 直接写 `.git` 文件，或复用 fixture 仓库，可去掉绝大部分。

**B. 提高并发**：`vitest.config.ts` **没有任何** `pool` / `maxWorkers` 配置，
8 核机器用默认值。显式设 `maxWorkers` 到 4–6 通常有显著收益。

> 注意：`v8` coverage 有进程级固定开销（实测与插桩范围无关，空 include 仍 +26 s）。

---

## 5. 优先级与理由

| 序 | 事项 | 为什么是这个顺序 | 预期收益 |
|---|---|---|---|
| **P0** | ② 序号漂移 | 是**其他一切的前提**：漂移让修复落进不执行的文件，先做速度优化可能优化错对象。且成本最低（补 `blocks` 断言 + 修注册表）。 | 防止白做；解锁可信度量 |
| **P1** | ③ 测试瓶颈 | 收益最确定、可独立验证。测试时间就是 Gate 5 的主要成本。 | 152 s → 目标 <60 s |
| **P2** | ① 镜像重复 | 收益最大但风险最高（触及打包/发布链路）。P0 完成后有测试兜底再做。 | 减 30k 行重复；消除一类缺陷源 |
| **P3** | 门禁执行成本 | Gate 1 静态分析 19 s、Gate 5 覆盖率 ~14 s、启动 7 s | 见 §6 |

### 为什么不先做①

① 改动会碰 `prepack`、`package.json files`、CI 发布链路，
一旦出错影响的是**已发布产物**。而②③都是纯内部改动、可随时回滚。
先把守护性工作（②）做完，① 才有安全网。

---

## 6. 附：门禁执行成本（真实时间线）

场景二（改一段 TypeScript，70 s 全流程）：

| 阶段 | 耗时 |
|---|---|
| 启动 + Gate 0 | 7 s |
| Gate 1 静态分析 + ESLint | 19 s |
| Gate 2 jscpd | 4 s |
| Gate 3 复杂度 | 8 s |
| Gate 4 Principles | 2 s |
| **Gate 5 测试 + 覆盖率** | **24 s** |
| Gate 6 archlint | 6 s |

场景一（改一行 hook 脚本）三次实测：42.6 / 64.9 / 107.8 s，中位 **64.9 s**。

### 6.1 关于 10% 目标

原目标 6.5 s / 15 s **不可达**：仅启动 + Gate 0 就要 7 s。
即便砍掉 Gate 2/3/4/6 且 Gate 5 归零，也到不了 15 s。

现实目标是 **70 s → 30–35 s（约 50%）**。要达到 10% 必须**减少门禁数量**，
而非优化其实现——这是一个产品决策，不是工程问题。

---

## 7. 待办清单

- [ ] P0-1 给 `gate-registry.test.bats` 补 `blocks` 列断言（先 RED）
- [ ] P0-2 修正注册表 `code-quality` / `build-integrity` 的 `blocks` 值
- [ ] P0-3 核查 #738 / #715 / #778 三条编号与执行面漂移
- [ ] P1-1 `vitest.config.ts` 显式配置 `maxWorkers`
- [ ] P1-2 重写 `phase-transition.test.js` 的 fixture，去掉逐测试 git 进程
- [ ] P1-3 按同样方法处理 `sprint-status-rework` / `gate-runner` / `doctor`
- [ ] P2-1 评估镜像移出 git 的可行性（先查 CI Mirror Parity 依赖）
- [ ] P2-2 删除镜像测试副本
- [ ] P3-1 Gate 5 覆盖率去留（CI 已在跑）
