# 根 lockfile registry 归一化决策记录

> 分支: chore/package-lock-registry　日期: 2026-09-30　类型: 供应链卫生（非 bug 修复）
> 触发: PR #422 合并后发现 `package-lock.json` 内 127/555 条 `resolved` 指向 `registry.npmmirror.com`
> 本文经 Delphi code-walkthrough Round 1（3× REQUEST_CHANGES）与 Round 2（1× REQUEST_CHANGES + 2× PASS_WITH_CAVEATS）修订，修订映射见 §0

---

## 0. 评审修订记录

| 轮次 | 评审方编号 | 缺口 | 本文/代码处置 |
|------|-----------|------|--------------|
| R1 | A-C1 / C-C1 | 只清存量、本机无修复路径（正统修复需连官方 registry），且禁止 `--no-verify` | §3 引入 `scripts/normalize-lock-registry.cjs` + `npm run normalize-lock`；§2 M7 给出权威验证 |
| R1 | A-C1 / C-C2 | `npm ci \|\| npm install` 兜底静默掩盖复发 | §3 移除兜底（`cross-platform-ci.yml:69`） |
| R1 | C-M1 / B-M2 | `new URL().host` 协议过宽、describe 收集期解析 | §3 检测改为 JSON 语义 + 协议限定 + `beforeAll` |
| R1 | A-M1 / B-M1 | `REQ-010-04` 不在 spec、`.cjs` 逃过 Gate 5c | §5 登记为已知悬空编号族与门禁盲区（本文显式声明 out-of-spec 注解） |
| R1 | A-M5 | 无 `lockfileVersion` 断言、host 白名单硬编码 | §3 `expect(lock.lockfileVersion).toBe(3)`；允许 host 由模块单点导出 |
| R2 | A-CI-1 / B-Major-1 | 行级正则在 CRLF 工作区静默 0 改写且 exit 0，而守护仍红 → 修复路径二次失效 | **检测改为 `JSON.parse` 语义 + 按 URL 值定点文本替换**（与行尾/空格无关），并在改写后自校验残留 |
| R2 | B-Major-2 | 守护用 `url.host`（含端口）、脚本用原始串比较 → `:443` 条目红灯无解 | 统一用 `url.hostname`，检测与改写共用 `findRegistryOffenders` |
| R2 | B-Major-4 | 非原子写覆盖 ~2MB lock | `lockPath.tmp` + `renameSync` |
| R2 | B-Major-3 / C-N1 | §6 声称 `npm ci` 是 integrity 权威校验，但消费根 lock 的 job 全在 ubuntu，平台门控二进制从不被下载 → 假设不可证伪 | §2 M7 改用**官方 registry 元数据逐条比对**直接证伪/证实；§6 重写 |
| R2 | A-MJ-1 | §4 以"必须新增编号 Gate、同步五处文档"否决本地拦截，前提不成立 | §4 更正：`githooks/gate-12-file-hygiene.sh` 为 warning-only 且已在 `*.json)` 分支遍历 staged 文件，落点确实存在；本 PR 仍不做，理由改记于 §4 |
| R2 | C-N2 | 否决 `prepare` 归一化的理由是"隐藏副作用"，与实际惯例不符 | §5 更正为决定性理由：`prepare` 会让 CI 的 `npm ci` 先把工作区 lock 洗白，从而抹平 lock-only 提交唯一的实时拦截点 |
| R2 | B-Minor | 代码与文档同 commit，违反 `docs/agents.md` 反模式 | 拆为 code commit + docs commit |

## 1. 问题

开发者机器的用户级 `~/.npmrc` 把 registry 指向镜像，npm 把镜像 URL 原样写入根
`package-lock.json` 的 `resolved` 字段。后果不是 CI 失败（GitHub runner 访问镜像没问题），
而是**发布仓库对第三方镜像产生了隐式供应链依赖**：CI 安装的 tarball 来源不再是官方 registry，
`integrity` 校验的也是镜像投喂的字节。本 PR 是一次性清洗 + 建立防复发机制。

## 2. 实测数据（2026-09-30，本机 win32 / npm 11.17.0 / node 24.19.0）

| 编号 | 测量 | 结果 |
|------|------|------|
| M1 | `npm -v` / `registry` | 11.17.0 / `https://registry.npmmirror.com` |
| M2 | 官方 registry 可达性 | **不稳定**：清洗当日早间 `curl https://registry.npmjs.org/left-pad` = 000（不可达），同日 10:1x 复测 = 200。可达性不作为决策依据（真正排除 `.npmrc` 路线的是 M3/M4），但影响 M7 能否本地完成 |
| M3 | `.npmrc` `replace-registry-host=npmjs`（npm 默认值）+ 镜像 registry，全新 `npm install --package-lock-only` | `resolved` host 仍为 `registry.npmmirror.com` |
| M4 | 同上，`replace-registry-host` 取 `never` / `registry.npmjs.org` / `registry.yarnpkg.com` | 三种变体的 `resolved` host **全部仍是镜像** |
| M5 | 在**已归一化**的根 lock 上增量 `npm install --package-lock-only left-pad` | 只有新增的 1 条变回镜像，其余 554 条保持官方 host → 复发面是"每次新增依赖 1 条" |
| M6 | `cross-platform-ci.yml` 最近一次运行 | `npm ci` 成功（`added 475 packages`），兜底路径未被触发 |
| M7 | **官方元数据逐条比对**：取 lock 内全部 555 条 `resolved`，按包名向 `registry.npmjs.org` 拉 metadata，比对 `versions[ver].dist.integrity` 与 lock 内 `integrity` | `checked=555 mismatch=0 missing=0`（470 个不同包路径，含 `@esbuild/*`、`@ast-grep/cli-*`、`@archlinter/cli-win32-x64` 等 `cpu`/`os` 门控平台二进制） |

**结论 1（M3/M4）**：`.npmrc replace-registry-host` 只替换 npm 认定的 registry 主机，镜像元数据里
`dist.tarball` 的主机不在其作用范围，实测四种取值全为 no-op —— Round 1 首选的"仓库级 `.npmrc` 治根"方案被否证。
**结论 2（M5）**：复发面是每次新增依赖 1 条，守护必须给出可直接执行的修复命令。
**结论 3（M7）**：`integrity` 等价性不再是假设 —— lock 内每条摘要都等于官方 registry 公布的
`dist.integrity`，即镜像投喂的 tarball 与官方 tarball 摘要一致；这覆盖了任何 ubuntu runner 都不会下载的平台二进制。

## 3. 决策

| 措施 | 落点 | 依据 |
|------|------|------|
| host-only 定点重写（按 `resolved` 的 URL 值替换，`integrity`/`version`/格式/行序不动） | `scripts/normalize-lock-registry.cjs`（`npm run normalize-lock`） | M2/M3/M4：不需要官方 registry 也能修；M7 前置实测：输出与人工 host 替换逐字节一致，重跑 0 改写 |
| 检测与改写共用同一实现（`findRegistryOffenders`，JSON 语义 + `url.hostname` + 协议限定 + 兼容 legacy `dependencies` 树） | 同上 + `scripts/__tests__/package-lock-registry.test.cjs` | R2-A-CI-1 / B-Major-2：避免"守护判红、工具说没事"的双清单死角 |
| 改写后自校验残留，残留非空即 exit 1；缺失文件 exit 1；写盘走 `.tmp` + `renameSync` | 同上 | R2-B-Major-4 |
| 根 lock 归一化（127 → 0） | `package-lock.json` | 127 插入 / 127 删除，全部落在 `"resolved"` 行，非 resolved 行改动 0 |
| `package-lock.json text eol=lf` | `.gitattributes` | 仓库原先只对 `.sh` 与 hook 文件强制 LF，`core.autocrlf=true` 的 Windows checkout 会拿到 CRLF lock |
| 守护测试：`lockfileVersion` 断言、`>100` 规模哨兵、offender 附修复命令 | `scripts/__tests__/package-lock-registry.test.cjs` | M5：新增依赖即红灯且提示一键修复 |
| 移除 CI 安装兜底 `npm ci \|\| npm install` | `.github/workflows/cross-platform-ci.yml:69` | M6：`npm ci` 现为绿；兜底只会静默重装并重写工作区 lock |

## 4. 否决的替代方案

| 方案 | 否决理由 |
|------|----------|
| 仓库级 `.npmrc` 写 `registry=https://registry.npmjs.org` | 可达性随环境波动（M2），在不可达的机器上等于让 `npm install` 直接失败；且与镜像使用者的网络现实冲突 |
| `.npmrc` 写 `replace-registry-host=<任意>` | M3/M4 实测四种取值全为 no-op |
| `npm install --package-lock-only --registry=https://registry.npmjs.org` 重新生成 | 需要官方 registry 可达（M2 不稳定）；重新生成会顺带改动版本解析，diff 远大于 host-only |
| 新增编号 Gate（如 Gate 13） | 门禁计数需同步 `githooks/pre-commit` + npm 镜像 + `AGENTS.md`/`README`/`CAPABILITIES`/插件 manifest 五处文档，本仓库刚在 v0.18.2 花一个版本清完门禁计数漂移 |
| **扩展 Gate 12 做 authoring-time 警告**（R2-A-MJ-1 指出的现成落点） | **落点确实存在且成本低**：`githooks/gate-12-file-hygiene.sh` 是 warning-only，`*.json)` 分支已逐个校验 staged JSON。本 PR 仍不做，改记理由为：① 共享门禁改动需同步 npm 镜像副本并按 parity 测试补例，与本 PR 的"lockfile + 工具"边界不同轴；② warning-only 不阻断，收益是把第一反馈点从 CI 提前到 commit，属独立可验证改进。→ 作为后续项，不写成"成本高所以不做" |
| 同时守护 `plugins/opencode/package-lock.json` | 该文件是构建产物且被 `.gitignore:135` 排除，不进入任何提交；实测 `src/npm-package/plugins/opencode/` 下不存在 lockfile，构建不复制 |

## 5. 已知残留（有意不在本 PR 处理）

- **本地即时拦截缺失**：仅改 lock 的提交走 pre-commit 的 "no code files changed" 分支跳过测试
  （`githooks/pre-commit:1793` 的 `CODE_EXTENSIONS` 不含 `.cjs`），第一反馈点是 CI 全量 `npm test`。
  落点见 §4 末行（Gate 12 扩展）。
- **不在 `prepare` 里自动归一化**：根 `package.json:10` 的 `prepare` 已经会在 install 期改写 tracked 文件，
  所以"隐藏副作用"不是理由。决定性理由是：若 `prepare` 做归一化，CI 的 `npm ci` 会先把工作区 lock 洗白，
  守护测试再读文件必然变绿 —— 而 CI 恰是 §5 第一条场景（lock-only 提交跳过本地测试）的**唯一**实时拦截点。
  自动洗白会把这条防线连同它的信号一起抹掉，故保持显式命令。
- **REQ 编号族悬空**：`REQ-010-*` / `AC-010-*` 只存在于 `scripts/__tests__/` 的注解约定里，
  `specification.yaml` 实际承载 `REQ-DSH-*`；且 `githooks/pre-commit:1737` 的 Gate 5c 正则
  （`\.(test|spec)\.(ts|tsx|js|jsx)$`）不含 `.cjs`，使"注解必须可追溯"对整个 `scripts/` 守护族**结构上不可校验**。
  本次沿用同目录既有编号（`REQ-010-04`）并在测试头显式声明 out-of-spec，属止损而非修复；
  根治需要把该族迁到独立前缀或正式登记进 `specification.yaml`，另开分支处理。
- **`scripts/*.cjs` 不在 Gate 1 与覆盖率口径内**：`npm run lint` = `eslint src --ext .ts`，
  `vitest.config.ts` 的 coverage `include` 为 `src/**`。新工具虽有 12 条单测，但不受 80% 阈值约束。

## 6. 合入门槛与回滚

- **integrity 等价性已由 M7 用官方元数据逐条证实**（555/555 摘要一致），因此 §6 不再把它写成"待 CI 证伪的假设"。
  CI 侧仍以 `npm ci` 为安装路径回归门槛：`quality-gates.yml:133/:214/:674`、`security-audit.yml:29`、
  `cross-platform-ci.yml:69`（Node 18/20/22 × ubuntu）。注意这些 job 只下载 linux-x64 子集，
  平台门控二进制的字节一致性由 M7 的元数据比对覆盖，而非由 CI 覆盖。
- `mutation-test.yml` 自 2026-07-21 起持续 45 分钟超时被取消，与本改动无关，**不计入绿证据**（独立跟进项）。
- 回滚为单 commit revert，同时退回 lock、脚本与守护测试；若仍出现 `EINTEGRITY`，采整 PR revert 而非"只回滚单个 offender"
  ——平台包摘要无法在本机与 CI 双证，逐条回滚的定位成本更高。
- 首个 CI 周期 `hashFiles('package-lock.json')` 缓存失效，流水线时长会小幅上升（预期行为）。
