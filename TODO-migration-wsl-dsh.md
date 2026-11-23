# TODO — 迁移到 WSL + DSH 开发环境前的待办交接

> 状态时间：2026-11-23。本文件是**交接快照**，不是长期文档；WSL/DSH 环境就绪后，
> 未完成项应照下面「重建清单」逐条在新环境落一次，然后可删除本文件。
>
> 迁移动机：Windows + Qoder 下执行门禁（bats 全量 pre-commit）过慢，
> 已多次把"等待"误判成"卡死"。

## 0. 当前仓库状态（迁移前基线）

| 项 | 值 |
|---|---|
| 仓库 | `D:\projects\xp-gate-rust`（`https://github.com/boyingliu01/xp-gate` 的 worktree） |
| 分支 | `feat/rust-language-support` |
| 版本 | `package.json` = `0.38.10.0`，`src/npm-package/package.json` = `0.38.10` |
| 已提交 HEAD | `64e4403a seed` |
| 工作区 | 20 个文件已暂存（18 个改动 + `TODO-migration-wsl-dsh.md` 与新增夹具套件），1148+ 行 |
| 镜像一致性 | `bash scripts/check-hook-mirror.sh` → PASS（`githooks/` 与 `src/npm-package/hooks/` 字节与权限一致） |

## 1. 本次改动包含什么（已暂存、已逐一验证）

- **新增门禁夹具套件** `githooks/__tests__/fixture-writes-stay-in-fixture.test.bats`
  （REQ-FIXTURE-ISOLATION，AC-01..04）：扫描仓库内全部 `.bats`，凡是把源码扩展名文件
  写到仓库根的块，一律点名。实测 7 个发现 / 5 个非发现；两次可证伪探针
  （注入 `leak.go`、`extra.py`）都被点名，探针已还原。
- **修掉 6 个套件自己的越界写入**（共 11 个文件改动，其中若干也只是格式/注释同步）：
  `adapter-shell-tests`、`gate-0-version-consistency`、
  `gate-1-verdict-integrity`、`gate-5-adapter-fail-closed`、`gate-6-layers`、
  `gate-activation`、`gate-cjs-source-detection`、`issue-594-coverage-nan-pass`、
  `java-gate`、`rust-language-support`；`gate9-architecture` 的 C++ 夹具改为
  `src/cpp/main.cpp` + `src/cpp/.skip-architecture-cpp`。
- **shell 适配器的 bats 串行执行改造**（`githooks/adapters/shell.sh` 及其两个镜像）：
  逐套件执行、`BATS_TEST_TIMEOUT`（默认 300s，`XP_GATE_BATS_TEST_TIMEOUT` 可覆盖）、
  `run_without_git_context` 隔离、失败套件全文打印、无 verdict 不计为通过。
- `adapter-common.sh` / `pre-commit` 的两处镜像改动；`CHANGELOG.md` 的 0.38.10.0 段；
  `AGENTS.md` 一行修订。

## 2. 未完成项（WSL 建好后继续做）

### 2.1 立即要做：把这次提交落盘

- [ ] 在新环境重新 `git commit`（**走真实 pre-commit 钩子，不用 `--no-verify`**）。
  在 Windows 上最后一次提交被钩子判 `❌ BLOCKED - Tests FAILED`，但逐个套件单跑全绿、
  日志截断到钩子尾部看不到具体套件 —— 高度怀疑是**整套 bats 全量串行超时**而非真实失败。
  WSL 下请**把钩子输出重定向到文件**再判断：
  ```bash
  git commit -F msg.txt > /tmp/commit.log 2>&1; echo "exit=$?"
  grep -nE '^not ok|exited .* without a verdict|failed after' /tmp/commit.log
  ```
- [ ] 若仍被 BLOCK：先看 `/tmp/commit.log` 里 `❌ <suite> failed after Ns` 那一行定位套件，
  再单跑该套件复现；**不要**为了通过而调低阈值或加豁免。

### 2.2 收口 xp-gate 0.38.10 的发布链

- [ ] `mvn` 无关；跑 `npm test`（vitest + `npm run test:bats`）与
  `node scripts/run-bats.cjs` 全量，确认全绿。
- [ ] 全局安装并验证：`npm install xp-gate -g` → `xp-gate update-hooks --global --force`，
  再在客户端仓库 `~/projects/ksxing-exam-client`（新环境下为 `~/projects/...`）
  跑 `xp-gate doctor` 与一次空提交验证钩子生效。
- [ ] 打 tag / 发布 0.38.10 的 npm 包（若本次会话确认要发布）。

### 2.3 任务清单里仍未完成的项（本轮目标：内部质量 0 告警）

- [ ] **#13 启用 Rust CCN 门禁并建立基线**（`.ccn-baseline` 对 `.rs` 走 lizard Rust 解析；
      注意 lizard 版本盲区——参考 AGENTS.md 里 `ccn-lizard-blind.json` 的做法）。
- [ ] **#14 启用 Rust SAST / 覆盖率 / 依赖漏洞**（semgrep Rust 规则、`cargo llvm-cov` 阈值、
      `cargo audit`；覆盖率形状复用 `coverage/lcov.info`）。
- [ ] **#15 清理现有全部告警至 0**（全仓库门禁输出只有 PASS / 已登记 info 项）。
- [ ] **#16 门禁可证伪性验证与文档**（每个新门禁都要有"注入违规 → 必须变红 → 还原"的实测记录，
      并写进 CHANGELOG 与 AGENTS.md）。
- [ ] **#17（进行中）xp-gate 增加 rust 语言支持（Gate 0/1/5）** —— 本轮批次合入后收尾。
- [ ] **#18 把客户端仓库 `ksxing-exam-client` 的全部告警清到 0。**
- [ ] **#19（进行中）修复 shell 适配器：bats 无超时串行导致 Windows 上 pre-commit 数小时**
      —— 代码已改，**验证要在 WSL 上做**（Windows 侧的耗时数据不可作结论）。

### 2.4 完成后才启动

- [ ] **sprint-flow Sprint 2（防作弊 MVP）**：反截图 + 进程检测 + Anti-VM + 本地审计，
      Windows 优先；先 PREP + DESIGN（R1 需求评审 + R2 delphi-review，三模型 ≥90% 共识）。
      启动前置条件：xp-gate 0.38.10 已全局安装且钩子在该仓库生效。

## 3. WSL/DSH 重建清单（环境层，不做就会重复踩 Windows 的坑）

- [ ] **行尾**：确认 `core.autocrlf` 与 `core.eol`。本仓库依赖 `.gitattributes` 的
      `*.sh`/`*.bats` → `eol=lf`；WSL 侧安装后务必 `git add --renormalize .` 后确认无 diff。
- [ ] **钩子路径**：`git config --get core.hooksPath` 必须指向 `~/.config/xp-gate/hooks`
      （或仓库本地 `.githooks`），装完跑 `xp-gate doctor`。
- [ ] **依赖工具**：`bats`（≥1.13）、`shellcheck`、`node`（≥20）、`python3`（≥3.10，
      供 `scripts/*.cjs` 与夹具里的扫描器）、`jq`；Rust 侧 `cargo`、`clippy`、
      `cargo llvm-cov`、`cargo audit`、`lizard`（钉版本，见 AGENTS.md 的盲区清单）。
- [ ] **CI 对齐**：仓库 `.gitea/.github` 的 ci.yml 是镜像关系，改一处要同步另一处。
- [ ] **不要搬运的东西**：`.local-env/`（Windows 专有目录，已 exclude）、
      `node_modules/`、`target/`、`coverage/`、`dist/`。
- [ ] **客户端仓库**：WSL 下 `~/projects/ksxing-exam-client` 重新 `npm ci`，
      并按 Sprint 1 的 SHIP 记录核对 VERSION/CHANGELOG。
- [ ] **防作弊客户端构建**：Tauri 在 WSL 下只能交叉编译到 Linux；**Windows 目标仍需
      Windows 侧工具链或 GitHub Actions**，重建环境时别忘记保留 CI 的 Windows job。

## 4. 已知陷阱（从本会话实测中带过来的，别重复踩）

1. **钩子在 Windows 上假超时**：宁可把输出重定向到文件再 grep，不要只看尾巴。
2. **SQLite/文件锁类偶发失败**：bats 套件会并发起临时 git 仓库；WSL 的 ext4 上通常更稳，
   但不要在 `/mnt/c`（DrvFs）上跑 bats——性能与文件锁行为都不同。
3. **`.bats` 夹具必须自己 `cd` 进临时目录再写文件**；新套件
   `fixture-writes-stay-in-fixture.test.bats` 会点名写到仓库根的块。
4. **`cargo test` 与覆盖率双跑**：适配器声明 `coverage_runs_tests` 才能避免跑两遍，
   加 Rust 门禁时按同样机制声明。
5. **提交一律走真实钩子**；确需 `--no-verify` 时必须在提交信息里写明原因。

## 5. 交接顺序建议

1. WSL 侧克隆 → 按第 3 节装工具 → `xp-gate doctor` 全绿。
2. 把本分支的暂存改动 `git commit` 落盘（第 2.1 节）→ push 到 `origin`。
3. 收口 0.38.10（第 2.2 节）→ 再开 Sprint 2（第 2.4 节）。
