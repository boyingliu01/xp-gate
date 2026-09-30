# 根 lockfile registry 归一化决策记录

> 分支: chore/package-lock-registry　日期: 2026-09-30　类型: 供应链卫生（非 bug 修复）
> 触发: PR #422 合并后发现 `package-lock.json` 内 127/555 条 `resolved` 指向 `registry.npmmirror.com`
> 本文经 Delphi code-walkthrough Round 1（3× REQUEST_CHANGES）、Round 2（1× REQUEST_CHANGES + 2× PASS_WITH_CAVEATS）、
> Round 3（1× APPROVED + 2× PASS_WITH_CAVEATS，零 Critical/Major）
> 与 Round 4（1× APPROVED + 2× PASS_WITH_CAVEATS，0 Critical / 3 Major，全部指向文档陈述未被实测）
> 与 Round 5（1× APPROVED + 2× PASS_WITH_CAVEATS，0 Critical / 2 Major：守护自证死角 + 守护测试会改写被守护的制品）修订，修订映射见 §0

---

## 0. 评审修订记录

| 轮次 | 评审方编号 | 缺口 | 本文/代码处置 |
|------|-----------|------|--------------|
| R1 | A-C1 / C-C1 | 只清存量、本机无修复路径（正统修复需连官方 registry），且禁止 `--no-verify` | §3 引入 `scripts/normalize-lock-registry.cjs` + `npm run normalize-lock`；§2 M7 给出权威验证 |
| R1 | A-C1 / C-C2 | `npm ci \|\| npm install` 兜底静默掩盖复发 | §3 移除兜底（`cross-platform-ci.yml:69`） |
| R1 | C-M1 / B-M2 | `new URL().host` 协议过宽、describe 收集期解析 | §3 检测改为 JSON 语义 + 协议限定 + `beforeAll` |
| R1 | A-M1 / B-M1 | `REQ-010-04` 不在 spec、`.cjs` 逃过 Gate 5c | §5 登记为已知悬空编号族与门禁盲区（本文显式声明 out-of-spec 注解） |
| R1 | A-M5 | 无 `lockfileVersion` 断言、host 白名单硬编码 | §3 形状哨兵；允许主机收敛为模块内单点常量（`CANONICAL_REGISTRY_HOST` / `AUTO_FIXABLE_HOSTS`）。<br>*修订注记*：本行原写 "`expect(lock.lockfileVersion).toBe(3)`" 与 "由模块单点**导出**"，均与最终实现不符 —— 形状断言放宽为 `[1,2,3]`（工具同时兼容 legacy 树），常量刻意**不**导出（R4-A 认定"三处口径同模块"是设计优点）。以 R3/R4 行为准。 |
| R2 | A-CI-1 / B-Major-1 | 行级正则在 CRLF 工作区静默 0 改写且 exit 0，而守护仍红 → 修复路径二次失效 | **检测改为 `JSON.parse` 语义 + 按 URL 值定点文本替换**（与行尾/空格无关），并在改写后自校验残留 |
| R2 | B-Major-2 | 守护用 `url.host`（含端口）、脚本用原始串比较 → `:443` 条目红灯无解 | 统一用 `url.hostname`，检测与改写共用 `findRegistryOffenders` |
| R2 | B-Major-4 | 非原子写覆盖 ~2MB lock | `lockPath.tmp` + `renameSync` |
| R2 | B-Major-3 / C-N1 | §6 声称 `npm ci` 是 integrity 权威校验，但消费根 lock 的 job 全在 ubuntu，平台门控二进制从不被下载 → 假设不可证伪 | §2 M7 改用**官方 registry 元数据逐条比对**直接证伪/证实；§6 重写 |
| R2 | A-MJ-1 | §4 以"必须新增编号 Gate、同步五处文档"否决本地拦截，前提不成立 | §4 更正：`githooks/gate-12-file-hygiene.sh` 为 warning-only 且已在 `*.json)` 分支遍历 staged 文件，落点确实存在；本 PR 仍不做，理由改记于 §4 |
| R2 | C-N2 | 否决 `prepare` 归一化的理由是"隐藏副作用"，与实际惯例不符 | §5 更正为决定性理由：`prepare` 会让 CI 的 `npm ci` 先把工作区 lock 洗白，从而抹平 lock-only 提交唯一的实时拦截点 |
| R2 | B-Minor | 代码与文档同 commit，违反 `docs/agents.md` 反模式 | 拆为 code commit + docs commit |
| R3 | A-1 / B3-M2 | `normalizeFile` 与 CLI 的 exit-code 分支被导出却零测试，而 `scripts/*.cjs` 又逃在 Gate 1 lint 与覆盖率口径之外 → 原子写与非零退出没有第二张安全网 | 补 `normalizeFile` 落盘/幂等/无 `.tmp` 残留/`changed=0` 不动 mtime，以及 CLI 非零退出与"目标不是 lockfile"共 5 条测试（12 → 24；R4 再补 5 条 → 29） |
| R3 | B3-M1 | 守护 fail-open：`http:` 明文、非默认端口、带凭据以及 `new URL` 解析失败的值被静默跳过，实际口径宽于 AGENTS.md/CHANGELOG 宣称的不变量 | 判净条件收紧为 `https:` + 裸 canonical 主机（无端口、无凭据）；解析失败值上报为 `unparseable` offender 而非跳过；明文 http 自动升级为 https，端口/凭据只上报不擅自改路由 |
| R3 | B3-M4 | 固定 `.tmp` 名在并发/失败下留残留或二次 rename 抛错 | `${lockPath}.${pid}.tmp` + `try/finally` 强制清理 |
| R3 | B3-M5 | legacy `dependencies` 分支缺 `meta` 守卫，null 条目以裸 TypeError 崩掉工具与守护 | 补守卫与畸形输入测试 |
| R3 | B3-M3 / B3-M7 / B3-M8 | 按条目重复全文扫描、`approvedHosts` 形参与 `AUTO_FIXABLE_HOSTS` 导出无消费者、`JSON.parse(output)` 只证明"仍是合法 JSON"而不证明"只改了 resolved" | 唯一 URL 去重扫描；删除未用形参与死导出；新增 `assertOnlyResolvedChanged` 深比较，非 `resolved` 叶差异直接抛错 |
| R3 | B3-M6 | `lockfileVersion === 3` 断言写在 `beforeAll`，npm 出新版本当日 12 条测试因无关原因集体变红 | 解耦为独立的"lock 形状可理解"断言，接受 v1/2/3 |
| R3 | C3-2 / C3-3 / C3-4 | 回滚表述隐含 squash 合并前提；未记在途依赖分支的协调动作；归一化后 fresh `npm ci` 对官方 registry 的可达性依赖从 77% 升到 100% 而未记账 | §6 补回滚前提与合并后协调行；§5 补可达性残留条目 |
| R3 | C3-1 | M7 的 `555/555` 无可重放入库工具，属口头数字 | 接受为残留：`integrity` 字段本身已使投喂不同字节变为 `EINTEGRITY` 硬失败（可发现、可回滚）。可重放工具 `scripts/verify-lock-integrity.cjs` 列为后续项（R4-C1 后升级为"登记在 PR 描述、必须排期"，见 §5 末条） |
| R4 | A-Major-1 | §5 的恢复路径"临时 `--registry` 覆盖"是**未证的断言**：`npm ci` 按 lock 的绝对 `resolved` 下载，覆盖可能根本不生效；叠加 AGENTS.md"禁止手改 lock"，受限网络机器可能无路可走 | §2 新增 **M8**：读 `npm 11.17.0` 捆绑 arborist 源码（`index.js:128-130` + `reify.js:710 → :902-946`）实证下载期主机改写机制；§5 该条改为按 `replace-registry-host` 取值分情况给出**生效**的命令，并说明 `npm ci` 不写 lock、`npm install` 才写 |
| R4 | C-Major-1 | 绿证据从未执行 win32/darwin 的根 lock 安装路径，M7 又不可重放 → PR 声称的平台覆盖面大于实证范围 | §6 按 job 逐条记账：三 OS job 走 `npm install -g ./src/npm-package`（`cross-platform-ci.yml:17/:21/:38`）**不解析根 lock**，故平台二进制仅由 M7 覆盖；§5 末条把 `verify-lock-integrity.cjs` 从"后续项"改为登记于 PR 描述的必排期项 |
| R4 | C-Major-2 | "合并后通知在途分支"无载体；且 77%→100% 的可达性叙述夸大了对镜像使用者的实际冲击 | §6 协调条改为**实测在途面**（2026-09-30：开放 PR #438/#435 的 `gh pr diff --name-only` 均不含根 lock）+ 条件触发的 ①②③ 载体；§5 按 M8 修正冲击面为"默认配置行为不变，仅 `replace-registry-host=never` 的机器需处置" |
| R4 | B-APPROVED（0 Critical / 0 Major） | B1/B2：文本切片 authority 吞掉 `?query` → 改写丢查询串且被判干净；canonical 主机带 query 的凭据被 `isClean` 放行 → 两条"既不进 changed 也不进 remaining"的静默死角 | `urlIdentity` 同时给出解析 tail 与文本 textTail，二者不一致即拒绝自动改写；`isClean` 增加 `hasQueryOrFragment`；改写结果等于输入即判不可修（§3 前两行） |
| R4 | B4/B5/B6/B8/B10 | 非字符串 `resolved` 被误标 `unparseable`；报错文案在括号中间断行；"可修+不可修并存"与零参数默认目标两条真实恢复路径无测试；R1-A-M5 行的历史表述与最终实现不符 | `not-a-string` 标签；文案重排；测试 24 → 29 条（含混合恢复路径、`main()` 零参数；该零参数测试在 R5 被判定为缺陷，见 R5-B1）；§0 该 R1 行加修订注记 |
| R5 | A-Major-1 | 执行点是**自证**的：守护的判净与工具的修复共用同一个 `findRegistryOffenders`，唯一的独立信号（`>100` 哨兵）也来自同一次遍历。而该分类器前四轮 each 出过盲区（R1 CRLF/协议、R2 host/hostname、R3 http/端口/凭据/解析失败、R4 query 双向） → 再来一次不会变红，只会静默绿 | 保留共用分类器作为**修复性**判据（避免重新制造"守护红/工具说没事"的双清单），另加**只属于测试、工具永远影响不到**的原文 oracle：`"resolved"` 文本计数 == 解析计数，且全部 http(s) 值以 canonical 前缀开头（当前 555/555）。测试 29 → 31 |
| R5 | B-Major-1 | R4-B8 要求补的那条"零参数默认目标"测试直接 `run()` 真实仓库 lock —— 守护测试因此变成了**修复工具**：一旦 lock 复发污染，它会在测试中途改写被跟踪文件，污染工作区并使 Gate MW 的 commit 绑定失效 | 改为在临时目录复制工具与其同级 `package-lock.json` 后运行副本，断言副本被修好的**同时**仓库 lock 字节不变。守护只观察，不修复 |
| R5 | B2/B3/B7 | `main()` 未捕获目标解析异常（坏文件抛堆栈并跳过后续参数）；mtime 断言在粗粒度时钟下可平凡通过；文件模式未保留（Windows 主仓无意义） | CLI 逐目标 `try/catch` 输出 `not processed` 并继续（+1 条混合目标测试）；mtime 断言保留但由"无 `.tmp` 残留"承载真实信号；模式保留按 R5 讨论明确不做 |
| R5 | A2/A3/A4/A6 + C1/C2/C3/C5 | 头注释与 §4 把 M3/M4 写成"该选项是 no-op"（只对**写入**成立）；AGENTS.md/§3 的"无端口"过宣称（`isClean` 用 `url.host`，显式 `:443` 被 WHATWG 折叠）；§5 白名单抽象后续项无载体；§6 回滚范围写死三段而分支已有 7 个 commit；可达性暴露面少枚举一类配置（非 `npmjs`/`always`/canonical 的显式取值）；`.gitattributes` 对 `autocrlf=true` 贡献者的一次性 renormalize 噪音未预告；`mutation-test.yml:3-9` 的 `pull_request.paths` 含 `package.json`，本 PR 会自己触发那个红检查；`npm-publish.yml:145` 是根 lock 的另一个消费者却不在记账里 | 逐条按实测更正：写入/下载两轴分开表述；改口为"无非默认端口"；两条后续项都登记进 PR 描述；回滚列出 7 个 commit 逆序；配置类枚举补全；§6 新增 renormalize 噪音、自触发红检查与 `npm-publish.yml` 三条 |

> **§0 的治理边界**（R5-A7）：本文在 APPROVED 之前按轮次就地修订，台账见上表；
> 一旦取得 APPROVED，`docs/agents.md` 的"已批准计划不可变"生效 —— 后续任何更正（含排期中的
> `scripts/verify-lock-integrity.cjs`）必须另开 `-v2` 或独立文档，不得回填本表。

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
| M8 | **npm 下载期主机改写机制**（读安装侧源码，非推测）：本机 `npm 11.17.0` 捆绑的 `@npmcli/arborist` —— `lib/arborist/index.js:128-130` 把 `replaceRegistryHost` 的空值/`npmjs` 归一为字面量 `registry.npmjs.org`；`lib/arborist/reify.js:710` 调 `#registryResolved`（`:902-946`），当 `replaceRegistryHost === resolvedURL.hostname` 或为 `always` 时，用**配置的 registry** 覆盖 hostname/port/protocol，并把改写后的 URL 交给 pacote 下载 | 默认配置下，lock 里的 `registry.npmjs.org` **会在下载期被换成开发者 `.npmrc` 的 registry**。因此 `--registry` 覆盖对 `npm ci` 确实有效（§5 的处置成立），同时本 PR 的不变量边界也只到"制品层"，见结论 4 |

**结论 1（M3/M4）**：`.npmrc replace-registry-host` 只替换 npm 认定的 registry 主机，镜像元数据里
dist.tarball 的**写入**不受其影响，实测四种取值全为 no-op —— Round 1 首选的"仓库级 `.npmrc` 治根"方案被否证。
**结论 2（M5）**：复发面是每次新增依赖 1 条，守护必须给出可直接执行的修复命令。
**结论 3（M7）**：`integrity` 等价性不再是假设 —— lock 内每条摘要都等于官方 registry 公布的
`dist.integrity`，即镜像投喂的 tarball 与官方 tarball 摘要一致；这覆盖了任何 ubuntu runner 都不会下载的平台二进制。
**结论 4（M8，不变量的边界）**：本 PR 买到的是**制品层**保证，不是**下载层**保证。
lock 归一化后，仓库对第三方镜像的隐式依赖消失，CI（无镜像配置）按 lock 原样从官方 host 下载；
但按 M8，任何把 `.npmrc registry` 指向镜像的开发者，其 `npm ci` 仍会在下载期被 npm 改写回镜像 ——
这与 lock 写的是哪个 host 无关。守护测试因此**不可能**、也不声称能发现"某人实际从镜像下载"这件事；
要收口那一层需要仓库级 `.npmrc`（已被 M2 的可达性波动与 M3/M4 一并在 §4 否证），属另一议题。

## 3. 决策

| 措施 | 落点 | 依据 |
|------|------|------|
| 定点重写 `resolved` 的 scheme+authority（`integrity`/`version`/路径/格式/行序不动） | `scripts/normalize-lock-registry.cjs`（`npm run normalize-lock`） | M2/M3/M4：不需要官方 registry 也能修；M7 前置实测：输出与人工 host 替换逐字节一致，重跑 0 改写 |
| 判净条件收紧为 `https:` + 裸 `registry.npmjs.org`（无**非默认**端口、无凭据、**无 query/fragment**）；解析失败值上报 `unparseable`、非字符串值上报 `not-a-string`；文本 tail 与解析 tail 不一致、或改写结果等于输入时一律拒绝自动改写 | `collectOffenders` / `isClean` / `fixableOffender` | R3-B3-M1：守护的口径不能宽于 AGENTS.md/CHANGELOG 宣称的不变量，否则"绿"是虚假安全感。R4-B2：token 也能藏在 `?access_token=` 里，只查 userinfo 等于漏一半。R5-A3：`isClean` 比的是 `url.host`，WHATWG 会折叠显式 `:443`，所以"无端口"是过宣称，准确表述是"无非默认端口" |
| 只有当"文本切出的 tail"与"URL 解析出的 tail"逐字相等时才允许自动改写；改写结果与输入相同也判为不可修 | `fixableOffender` / `canonicalTarget` | R4-B1：authority 之后没有 `/` 的 URL（`https://host?query`）会让文本切片吞掉 query，改写后丢掉查询串却被判为干净 —— 静默降级为"既不在 changed 也不在 remaining"的死角 |
| 明文 `http:` 自动升级为 https；canonical 主机上的端口/凭据**只上报不擅自改路由** | `fixableOffender` | canonical 主机带端口或凭据说明有东西在被路由，静默剥离等于把拦截点藏起来 |
| 深比较断言"只有 `resolved` 叶发生变化"，否则抛错 | `assertOnlyResolvedChanged` | R3-B3-M8：把结构性巧合变成显式契约 |
| 唯一 URL 去重扫描 + `${pid}.tmp` + `try/finally` 清理 + legacy 树 `meta` 守卫 | 同上 | R3-B3-M3/M4/M5 |
| 检测与改写共用同一实现（`findRegistryOffenders`，JSON 语义 + `url.hostname` + 协议限定 + 兼容 legacy `dependencies` 树） | 同上 + `scripts/__tests__/package-lock-registry.test.cjs` | R2-A-CI-1 / B-Major-2：避免"守护判红、工具说没事"的双清单死角 |
| 改写后自校验残留，残留非空即 exit 1；缺失文件 exit 1；写盘走 `.tmp` + `renameSync` | 同上 | R2-B-Major-4 |
| 根 lock 归一化（127 → 0） | `package-lock.json` | 127 插入 / 127 删除，全部落在 `"resolved"` 行，非 resolved 行改动 0 |
| `package-lock.json text eol=lf` | `.gitattributes` | 仓库原先只对 `.sh` 与 hook 文件强制 LF。本机实测 `core.autocrlf=input`（checkout 不会给出 CRLF lock），此条是为 `autocrlf=true` 的贡献者把不变量固定在仓库侧而非机器侧；改写本身已与行尾解耦，见 §0 R2 首行 |
| 守护测试 31 条：纯函数（CRLF/紧凑排版/端口/凭据/query/文本-解析 tail 不一致/共享 URL/legacy 树/幂等/解析失败/非字符串）+ `normalizeFile` 落盘与 mtime 不变 + CLI 非零退出与默认目标，另含 `lockfileVersion` 形状断言、`>100` 规模哨兵、offender 附修复命令 + **与工具解耦的原文文本哨兵** | `scripts/__tests__/package-lock-registry.test.cjs` | M5：新增依赖即红灯且提示一键修复。R4-B8：补齐"同一文件内可修 + 不可修并存"的真实恢复路径。R5-A1：守护与工具共用分类器 = 分类器一旦系统性误判就同时失明，故补一条只读字节的 oracle（`"resolved"` 原文计数须等于解析计数，且所有 http(s) 值必须以 `https://registry.npmjs.org/` 开头） |
| 移除 CI 安装兜底 `npm ci \|\| npm install` | `.github/workflows/cross-platform-ci.yml:69` | M6：`npm ci` 现为绿；兜底只会静默重装并重写工作区 lock |

## 4. 否决的替代方案

| 方案 | 否决理由 |
|------|----------|
| 仓库级 `.npmrc` 写 `registry=https://registry.npmjs.org` | 可达性随环境波动（M2），在不可达的机器上等于让 `npm install` 直接失败；且与镜像使用者的网络现实冲突 |
| `.npmrc` 写 `replace-registry-host=<任意>` | M3/M4 实测四种取值都**不能**改变 npm **写入** `resolved` 的镜像主机（M8：它作用在下载期改写，与"把不变量固化进制品"是两件事） |
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
  `vitest.config.ts` 的 coverage `include` 为 `src/**`。新工具虽有 31 条单测（纯函数 + `normalizeFile`
  落盘 + CLI 退出码），但不受 80% 阈值约束，也不受 lint 约束。
- **可达性影响的真实面比"77% → 100%"小**（R3-C3-4 + R4-A1/C2，由 M8 定量收敛）：lock 的**声明**来源从
  77% 官方升到 100% 官方，但按 M8，`replace-registry-host` 默认值恰好等于 `registry.npmjs.org`，
  npm 在下载期会把官方 host 改写回该机器 `.npmrc` 配置的 registry —— 即镜像-only 的受限网络机器
  **默认配置下行为不变**，不需要临时覆盖，也不会因本 PR 突然装不上。
  需要手工处置的是"lock host 被逐字使用"这一类配置：`replace-registry-host=never`，以及任何既不是
  `npmjs`/`always`、也不等于 `registry.npmjs.org` 的显式取值（例如 `registry.yarnpkg.com`，R5-C1 补全枚举）。
  其恢复路径是 `--registry=<mirror>` **配** `replace-registry-host=always`；单给 `--registry` 在这类配置下无效。
  两种情况都**不得**让镜像写回 lock：`npm ci` 不写 lock，`npm install` 会（M5 的复发面正是它），
  一旦写回守护会在下一次 CI 变红。AGENTS.md 的"禁止手改 lock"与此不冲突 —— 恢复动作是配置层，不是制品层。
- **允许/可修白名单三处耦合**（R3-A2）：`CANONICAL_REGISTRY_HOST`、`AUTO_FIXABLE_HOSTS` 与
  `isClean` 的判净条件共同决定"什么算干净"。将来引入私有或 vendored registry 需同时改这三处，
  届时应从 npm 配置派生允许主机，而不是再加常量。本 PR 不做该抽象；
  与 `verify-lock-integrity.cjs` 同为本 PR 描述里登记的必排期后续项（R5-A4：不留载体的后续项等于没有后续项）。
- **M7 是单次 ad-hoc 实测，仓库内无可重放脚本**（R3-C3-1 + R4-C1）：`checked=555 mismatch=0 missing=0`
  这个数字后来者无法复跑。**证据分工要写清，不能让 CI 背它没跑的账**：
  本次改写涉及的 127 条里，linux-x64 子集由 CI 的 `npm ci` 逐条摘要校验实证（§6），
  只有 win32/darwin 门控条目仅由 M7 覆盖。兜底事实是 `integrity` 字段本身已在 `npm ci` 期强制摘要校验，
  所以 M7 若失实，后果是 win32/darwin 开发者本机 `EINTEGRITY` 硬失败（可发现、可回滚），
  不是静默不安全。后续项（独立 PR，登记在本 PR 描述的 Follow-up 段）：把逐条元数据比对固化为
  `scripts/verify-lock-integrity.cjs`（需出网，不可达时按本仓"工具缺失即 SKIP"惯例降级），
  使这个不变量对后来者**可证伪**；在此之前，本 PR 的"平台二进制同样安全"是**已实测但不可重放**。

## 6. 合入门槛与回滚

- **integrity 等价性由 M7 用官方元数据逐条实测**（555/555 摘要一致，仓库内不可重放，见 §5 末条），
  因此不再把它写成"待 CI 证伪的假设"。
  CI 侧仍以 `npm ci` 为安装路径回归门槛：`quality-gates.yml:133/:214/:674`、`security-audit.yml:29`、
  `mutation-test.yml:31`、`cross-platform-ci.yml:69`（Node 18/20/22 × ubuntu）。注意这些 job 只下载 linux-x64 子集；
  `cross-platform-ci.yml:17/:21/:38` 的三 OS job 走的是 `npm install -g ./src/npm-package`，**根本不解析根 lock**，
  所以 win32/darwin 在 CI 里既不下载也不摘要校验 —— 平台门控二进制的字节一致性只由 M7 的元数据比对覆盖，不由 CI 覆盖。
  消费者清单补一条（R5-C5）：`npm-publish.yml:145` 走 `npm install` 而非 `npm ci`， harmless（发布 runner 用官方 registry，
  且它只写自己工作区的临时 lock），但它确实是根 lock 的另一个消费者，记账不能漏。
- `mutation-test.yml` 自 2026-07-21 起持续 45 分钟超时被取消，与本改动无关，**不计入绿证据**（独立跟进项）。
  但该 workflow 的 `pull_request.paths` 含 `package.json`（`mutation-test.yml:3-9`），本 PR 恰好改了它，
  因此这个红/超时检查**会被本 PR 自己触发**并挂在 PR 页面上 —— 事先声明，免得被当成本改动的回归。
- **回滚前提是 squash/merge-commit 合并**（R3-C3-2）：此时单 commit revert 即同时退回 lock、脚本与守护测试。
  若逐 commit 合并，只 revert `9bd0416` 会留下 `f3b93ed` 的 RED 守护测试（该测试 `require` 工具文件，
  revert 工具即令其无法加载）使 CI 常红。分支现已因评审修订增长到 7 个 commit
  （`f3b93ed`/`9bd0416`/`3437ab7`/`b21d7cd`/`035faf2`/`ea075c9`/`ff8bb2f`，R5-C2 更正此前写死的
  `3437ab7..f3b93ed` 三段式表述），逐 commit 回滚必须按此逆序全 revert。若仍出现 `EINTEGRITY`，
  采整 PR revert 而非"只回滚单个 offender"——平台包摘要无法在本机与 CI 双证，逐条回滚的定位成本更高。
- **合并后协调动作**（R3-C3-3 + R4-C2，落到具体载体而非"记得说一声"）：**2026-09-30 实测**，
  开放 PR 只有 #438 / #435，`gh pr diff --name-only` 两者均不含根 `package-lock.json` → 当前无在途冲突面，
  协调动作是**条件触发**：若合并前出现 touch lock 的开放 PR（依赖 bump 最典型），以旧基线合并会把镜像条目重新带回，
  届时守护在下一次 CI 变红。执行顺序：① 本 PR 描述的 Follow-up 段列出"重跑 `npm run normalize-lock`"这一必做动作；
  ② 在那些分支上留一条 rebase 提示评论；③ 下一次发布的 CHANGELOG 顶部条目带同一句话。
  守护的报错文本本身已含可执行修复命令（M5 的落点），所以 ①②③ 是缩短发现延迟，不是唯一防线。
- **`.gitattributes` 的一次性噪音**（R5-A6）：新增 `package-lock.json text eol=lf` 会把 `core.autocrlf=true`
  贡献者的工作区 lock 在下次 checkout 时整体 renormalize 成 LF，表现为"整文件 M"而非 127 行改动。
  这不是回归（本机实测 `core.autocrlf=input` 不受影响），但预告比让贡献者自己猜便宜。
- 首个 CI 周期 `hashFiles('package-lock.json')` 缓存失效，流水线时长会小幅上升（预期行为）。
