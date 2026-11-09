# 镜像重复：现状、成本与三个选项

**日期**：2026-11-08
**状态**：分析完成，等待决策
**相关**：#717、#542、#500、#713、#769

## 一句话结论

镜像重复（约 30,400 行 / 429 个文件）是**真实缺陷的反复来源**，但它的根源不是"没有同步机制"——同步机制已经有了，而且当前 0 漂移。根源是**同一份代码存在多个可被编辑的副本**，而其中有副本根本不被执行。彻底消除它需要一个产品决策：接受"仓库里有一份源码 + 发布产物里有一份副本"，还是接受"仓库里就有多份"。

## 现状

| 镜像对 | 文件数 | 说明 |
|---|---|---|
| `githooks/adapters` → `src/npm-package/adapters` | 293 | 含 `adapters/plugins/` 深层子目录 |
| `src/principles` → `src/npm-package/principles` | 107 | Gate 4 规则引擎 |
| `githooks/lib` → `src/npm-package/hooks/lib` | 21 | hook 辅助库 |
| `src/build-integrity` → `src/npm-package/build-integrity` | 8 | Gate 9 |
| `skills` → `src/npm-package/skills` | 若干 | prepack 时复制 |

合计 **429 个受版本控制的镜像文件**、约 **30,404 行**重复代码。

### 已有的防线（重要：不是没有防护）

- `scripts/check-hook-mirror.sh` —— 每次 commit 时随 Gate 12b 运行，比对 `githooks/` 与镜像。
- `xp-gate sync-mirrors [--write]` —— 漂移报告 + 修复，默认 dry-run（#713）。
- CI `mirror-parity` job —— 独立比对四个镜像对。
- `.stryker-tmp/**`、镜像树已从 vitest 收集与覆盖率中排除，**重复副本不产生测试运行成本**。

当前实测：`sync-mirrors` 报告 **5 对全部 IN SYNC**，`check-hook-mirror.sh` PASS。

### 为什么防线有了还是反复出事

因为防线只保证"副本之间一致"，不保证"你改的那份会被执行"。已发生的缺陷都属于这一类：

| Issue | 形态 |
|---|---|
| #717 | 修复写进了 `githooks/gate-9.sh` —— 一个**没有任何 hook source 的文件**。修复看起来落地了，实际什么都没改。 |
| #542 | 只改了镜像侧，prepack 时被 canonical 源**静默回滚**，缺陷随 v0.27.3 发布出去。 |
| #500 | 安装器残留文件**遮蔽**了受版本控制的文件。 |
| 本次会话 | 我自己改了 `githooks/pre-commit` 但漏同步 `src/npm-package/hooks/pre-commit`，被 `doctor-hook-signatures.test.js` 抓到。 |

**共同点**：多副本意味着"写对了地方"变成一个需要靠记忆和工具维持的约定，而不是由结构保证的事实。

## 硬约束

npm 的 `files` 字段**只能指向包内路径**。`src/npm-package/` 必须是自包含的目录树，无法引用 `../../githooks/`。所以"发布产物含副本"这一点无法消除，能选的只是副本**是否进入版本控制**。

`src/npm-package/package.json` 的 `files`：
```
bin/ hooks/ adapters/ lib/ gates/ skills/ plugins/ principles/ mutation/
mock-policy/ build-integrity/ scripts/ + 若干顶层 .sh
```

## 三个选项

### 选项 A：维持现状，加强防护（成本最低）

保留全部 429 个镜像文件，已投入的防线继续用，另外补两件事：

1. **把 `sync-mirrors --check` 升级为阻断门禁**（当前不是）。漂移不再只是报告。
2. **在 `githooks/` 侧加 marked header**，让每个镜像文件第一行写明"canonical 在 githooks/，本文件是镜像，请勿直接编辑"。`githooks/gate-9.sh` 这种无人 source 的孤儿脚本单独加一条 registry 断言（registry 测试已有 `gate-9.sh is not sourced by any hook` 一条，可扩展成"禁止任何孤儿 gate 脚本存在"）。

- 收益：消除"改错副本"这一类缺陷的大部分场景。
- 成本：低，只加断言和注释。
- 不解决：仓库里仍有 30,404 行重复，代码量统计虚高。

### 选项 B：镜像移出版本控制，prepack 生成（推荐）

`.gitignore` 掉四个镜像树，由 `scripts/sync-package-content.js` 在 `prepack` 时生成。源码仓库里**只剩一份**。

需要配合的改动：

1. `src/npm-package/package.json` 的 `prepack` 从"复制 skills/plugins"扩展为"生成全部镜像"（现有 sync 脚本已经在做这件事，扩大范围即可）。
2. `.github/workflows/cross-platform-ci.yml` 的 `mirror-parity` job 改为：**先跑 prepack 生成，再断言生成结果与 canonical 逐字节一致**。语义从"两份提交的文件是否相等"变成"生成是否可复现"，反而更强。
3. `check-hook-mirror.sh` 同理改为"生成后比对"。
4. 开发机上的 `npm test` 等命令若依赖镜像内容存在，需要在 `prepack` 之外也触发一次生成（或改 `prepare`）。

- 收益：仓库里重复代码 30,404 行 → **0**；改一处只改一个文件；"改错副本"在物理上不可能。
- 成本：中。触及发布链路，`mirror-parity` 语义变化，需要在 CI 上验证一轮完整发布（或至少 `npm pack` + 内容比对）。
- 风险：**做错会发布出不完整的包**。这是本项被排在最后的原因。

### 选项 C：两个包（长期正解，成本最高）

把 `principles`、`build-integrity`、`adapters` 拆成独立的 workspace 包，`src/npm-package` 依赖它们并打包。npm 的 `bundledDependencies` 可以做到。

- 收益：彻底没有镜像概念。
- 成本：高。改变发布模型、多包版本管理、安装器逻辑。
- 本轮不建议。

## 建议

**选 B，但分两步走**：

1. 先做 B 的**第一步——把 293 个 `adapters` 文件移出**。它是最大的一块（占 2/3），且 `adapters/` 的生成逻辑最简单（纯复制）。小范围验证 CI 与发布链路。
2. 验证通过后再移 `principles`（107）、`hooks/lib`（21）、`build-integrity`（8）。

`skills` 一对**暂时不动**：它已经在 prepack 时复制且未被 git 跟踪的细节需要单独确认。

在 B 完成之前，选项 A 的两件事（阻断式漂移门禁 + mirrored header）**都值得先做**，它们是 B 的安全网。

## 本轮已完成的（不在本决策范围内）

- 门禁批号漂移修复：`gate-registry.sh` 的 `blocks` 列 `code-quality` / `build-integrity` 两行由错改对，并新增**从代码行为推导**的守护测试（详见 PR 说明）。这对应 #769 的"blocks 列在发布当天就是错的"。
- 测试瓶颈：三个 git-fixture 文件与 doctor 用例合计优化。单文件实测：

  | 文件 | 优化前 | 优化后 |
  |---|---|---|
  | `phase-transition.test.js` | 85.0 s | 49.9 s |
  | `sprint-status-rework.test.js` | 80.5 s | 40.7 s |
  | `gate-runner.test.js` | 54.5 s | 22.9 s |
  | `doctor.test.js` | 67.5 s | 35.1 s |

  全量 `vitest run`：**253 s → 224.7 s**，324 文件 / 3625 测试全绿。

  注意：全量只降 11%，因为上述四个文件虽占单文件耗时的大头，但在 8 worker 并发下彼此重叠。
  真正被压缩的是**关键路径**（lib 组 152.8 s → 113.2 s）和 CI 上单 worker 串行的场景。

## 需要你回答的问题

1. **选 A、B 还是 C？** 我建议 B 的第一步（只移 `adapters`）。
2. 如果选 B，是否接受 `mirror-parity` CI 语义从"两份文件相等"变成"生成结果可复现"？
3. 本轮是否先把选项 A 的两件事（阻断式漂移门禁 + mirrored header）做掉，作为任何选项的共同前提？
