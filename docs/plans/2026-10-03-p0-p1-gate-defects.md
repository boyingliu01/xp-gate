# P0/P1 质量门禁缺陷修复 — 设计文档

**Sprint**: sprint-20261003-75
**Issues**: #454 (P0), #457, #452, #423 (P1)
**状态**: DRAFT → 待 R2 Delphi 评审
**基线**: `main` @ `1cb5493b`

---

## 0. 背景与范围修正（重要）

4 个 issue 均经过独立只读调查 + Lead 亲自实测。**调查结果与 issue 描述有实质出入，
范围已按实测证据修正**。本节记录修正内容，避免设计与实际证据脱节。

| Issue | issue 原描述 | 实测结论 | 范围修正 |
|---|---|---|---|
| #454 | Gate 5 无法区分测试失败与 runner 错误 | `is_runner_infrastructure_error()` **已存在**（`pre-commit:146`）；但 6 个 BLOCK 站点**只有 1 个**接了守卫 | 补全其余 5 个站点；REQ-1 不盲改 |
| #452 | 基线被静默覆盖，既有条目丢失 | `merged = {...existing}`（`boy-scout.ts:647`）使清空**结构上不可能**；实测条目被 `preserved` | **merge 已存在，不重复实现**；只修 REQ-3 |
| #457 | `.principlesrc` 对 15 条规则不生效 | **完全证实**，15 个文件精确；另发现 3 个 issue 未提及的缺陷面 | 扩大为完整的「配置生效」修复 |
| #423 | 只校验自述 `requested_model` | 证实，且**更严重**：三专家可全是同一 `resolved_model` 而 PASS | 需先补 `channel` 字段（issue 方案按字面无法实现） |

**据此，本设计只做 4 件有真实证据支撑的事**，不做已存在的修复。

---

## 1. #457 — 让 `.principlesrc` 真正生效

### 1.1 问题（已复现）

```
.principlesrc 设 large-file.threshold = 1050
$ npx tsx -e "...getDefaultConfig()...largeFileRule.threshold"
getDefaultConfig = 1150
LIVE RULE       = 1150   ← 应为 1050
```

三个叠加缺陷：

**缺陷 A — 15 个规则在模块加载时固化配置。**
10 个 clean-code + 5 个 solid 模块，全部形如：
```ts
const config = getDefaultConfig();                    // 模块导入即求值
export const xRule: Rule = {
  threshold: config.rules['clean-code']['x'].threshold,   // 固化
  severity: config.rules['clean-code']['x'].severity as Severity,
};
```
ES 模块只求值一次，之后加载任何配置都无法改变这些常量。

**其中 5 个更严重** —— 配置值被**模块作用域的辅助函数/常量**消费，
单纯「把读取挪进 `check`」不足以修复：
- `srp.ts:5` 解构 `{ methodThreshold, severity }`
- `lsp.ts:5` 固化 `severity`，被自由函数 `buildViolation()`（L45）消费
- `dip.ts:5-8` 解构 `{ severity }` + 固化 `EXCLUDED_CLASSES`，被 `shouldSkipInstantiation()`（L10-14）消费
- `isp.ts:9-10`
- `magic-numbers.ts:6` 固化 `EXCLUDED_NUMBERS`

**缺陷 B — `index.ts:62` 丢弃 `loadConfig()` 返回值**，且 `Rule.check` 签名
（`types.ts:8`）为 `(file, adapter) => Violation[]`，**没有通道**把配置送进规则。

**缺陷 C — 消费面比 issue 描述更广（issue 未提及）：**
1. **`enabled: false` 同样被忽略** —— 全仓库没有任何代码读 `config.rules[...].enabled`。
2. **Gate 6 同样受影响** —— `boy-scout.ts:33-34` 用同一批冻结单例。
   **只修 Gate 4 会让 Gate 4 与 Gate 6 判定不一致**（同一文件两套阈值）。
3. **`--config` 根本没实现**，且 `parseArgs`（`index.ts:16-46`）
   把 `--config .principlesrc` **误当作输入文件**：
   `{"files":["a.ts",".principlesrc"],...}`。`src/principles/AGENTS.md:104` 的文档是错的。
4. `loadConfig()` 硬编码 `join(process.cwd(), '.principlesrc')`（`config.ts:91`），
   无向上查找；Gate 4 可能 `cd "$PROJECT_SUBDIR"`，故 cwd 不可靠。
5. `loadConfig()` 的**浅层 spread**（`config.ts:105-112`）会整体替换规则对象 ——
   部分覆盖如 `{"large-file":{"threshold":1050}}` 会**丢掉 `severity`**。

### 1.2 方案：Approach A — 模块级可变配置 + lazy 读取

**选型理由**：生产侧只有**一个** `check()` 调用点（`analyzer.ts:118`）。
对比三种方案：

| 方案 | 改动面 | 破坏公开 `Rule` 类型 | ~150 处既有 `check()` 直调 |
|---|---|---|---|
| **A. 模块级可变配置** | ~18 文件 | **否** | **不动** |
| B. 加 `check(file, adapter, config?)` 第三参 | ~19 生产 + ~300 测试 | 是（若必填） | 全部要改 |
| C. 规则工厂 `createRules(cfg)` | ~19 文件 | 否，但破坏 `getAllRules()` 扩展点 | 单例消失则全改 |

**采纳 A** —— 唯一同时满足「不破坏公开类型」与「不动既有测试」的方案。

**实现要点：**

1. **`config.ts` 新增模块级配置访问器 + 显式重置**
   ```ts
   let activeConfig: PrinciplesConfig = getDefaultConfig();
   export function getActiveConfig(): PrinciplesConfig { return activeConfig; }
   export function setActiveConfig(cfg: PrinciplesConfig): void { activeConfig = cfg; }
   /** 仅供测试使用：恢复到内置默认值，防止用例间状态泄漏。 */
   export function resetActiveConfig(): void { activeConfig = getDefaultConfig(); }
   ```
   > **R2 修订（3/3 一致指出）**：三个模型都指出模块级可变状态有**跨测试污染 / 并发**风险。
   > `resetActiveConfig()` 是为测试隔离而**必须**提供的（缺它则 flaky）。
   > 并发约束（同进程不可并行跑不同配置）需在 JSDoc 显式声明，不得留白。

2. **15 个规则模块**：删除模块作用域的 `const config = getDefaultConfig()`，
   改为**在 `check()` 内部**通过 `getActiveConfig()` 读取。
   - 对 5 个「配置值被模块作用域函数消费」的模块，把这些函数**改为接收参数**
     或在函数内部现读配置，消除固化。
   - 数组常量（`EXCLUDED_NUMBERS`、`EXCLUDED_CLASSES`）改为函数内现取。
3. **`Rule.threshold` / `Rule.severity` 语义分裂的处理（3/3 一致指出，必须解决）**
   > 三个模型一致认为「仅靠类型注释不足」。表现为隐性契约破裂：
   > 消费方按静态值判断会与 `check()` 静默不一致。
   >
   > **采纳方案**：新增 `getEffectiveConfigFor(ruleId)` 可观测入口，
   > 并在 `Violation` 上附带生效阈值（`effectiveThreshold`），
   > 使线上判定**自带**依据，而非依赖规则对象自述。
   > `Rule.threshold`/`severity` **保留**（不破坏既有测试与消费者）但加
   > `@deprecated` JSDoc 标注，指明改用可观测入口。**不做静默移除**。
4. **`enabled` 支持**：`analyzer.runRuleOnFile()` 在调用 `check` 前查
   `getActiveConfig().rules[group][ruleId].enabled`；为 `false` 则跳过。
5. **`loadConfig()` 修正**：
   - 接受可选路径参数；默认解析顺序为
     `--config` 显式路径 → `git rev-parse --show-toplevel` 的 `.principlesrc` → `cwd`。
   - **git 不可用时必须优雅回退**（架构师 mC-02 / 可行 MC-02）：
     `git rev-parse` 失败（非 git 目录、浅检出异常、worktree、submodule）→
     **回退 cwd，不抛错、不崩溃**，并补对应测试。
   - **深合并规格必须精确**（可行 MC-01，否则 AC-457-05 无法稳定验收）：
     - 规则级：逐字段合并（缺失字段取默认）。
     - **组级**：只提供 `clean-code` 组时，`solid` 组规则**不得整体丢失**（架构师 mC-03）。
     - 数组：`exclude` 采用**覆盖**（非拼接）—— 与现有 `.principlesrc` 语义一致，需测试固化。
     - 类型不匹配：**保留默认值并告警**，不用非法值覆盖。
   - 解析失败不再静默吞掉（当前 L115-117）——改为**输出警告并回退默认**。
6. **`parseArgs` 新增 `case '--config:'`**，不再把路径塞进 `files`。
7. **`index.ts` 与 `boy-scout.ts`**：在调用 `analyze()`/`getAllRules()` **之前**
   `setActiveConfig(await loadConfig(opts.configPath))`，保证 Gate 4 与 Gate 6 用同一配置。
   > **R2 修订（架构师 MC-01）**：初始化责任散落在多入口会导致「新增入口静默回退默认」，
   > 重蹈 #457 覆辙。**收敛到单一 choke point**：`analyze()` 内部若检测到配置未显式
   > 初始化则告警（而非静默用默认），使遗漏可被发现。
8. **Gate 4 传 `--config`**：`githooks/gates/gate-4-principles.sh` 显式传项目根的
   `.principlesrc`（若存在），消除对 cwd 的依赖。

### 1.3 验收标准

- **AC-457-01**：`.principlesrc` 设 `threshold: 1050` → 规则**实际**按 1050 判定
  （构造 1060 行文件应报违规，1000 行不报）。
- **AC-457-02**：`severity` 覆盖生效（设 `error` → Gate 4 阻塞）。
- **AC-457-03**：`exclude` 覆盖生效（`magic-numbers`）。
- **AC-457-04**：`enabled: false` 使规则真正不运行。
- **AC-457-05**：部分覆盖不丢字段（只给 `threshold` 时 `severity` 仍为默认）。
- **AC-457-06**：Gate 4 与 Gate 6 对同一文件得出**一致**的阈值判定。
- **AC-457-07**：既有 15 个规则测试全绿（回归）。
- **AC-457-08**：`--config <path>` 生效且不再污染 `files`。

---

## 2. #454 — Gate 5 区分真实失败与 runner 基础设施错误

### 2.1 问题

`is_runner_infrastructure_error()`（`pre-commit:146`）已实现且逻辑正确：
```sh
is_runner_infrastructure_error() {
  local _out="$1"
  [ -n "$_out" ] || return 1
  printf '%s' "$_out" | grep -qE 'Unhandled Error' || return 1
  if printf '%s' "$_out" | grep -qE 'Tests +[0-9]+ failed|FAIL |AssertionError'; then
    return 1
  fi
  return 0
}
```

> **R2 修订（架构师 major-02）**：`is_runner_infrastructure_error` 的 grep 模式
> 是 **vitest 特有**的输出形态。L2008 是**非 TS adapter** 站点，其 runner 输出格式不同，
> 直接复用存在「真实失败输出恰好含 `Unhandled Error` 却无上述标记」的**理论误放行**路径。
>
> **处理**：`is_runner_infrastructure_error` **保持单参不变**（不扩展签名）。
> 非 TS adapter 站点（L2008、L1992）**不启用**该守卫 —— 它们是 `run_tests`
> 经 adapter 路由的通用路径，输出格式不保证，**保守地维持原有 BLOCK 行为**。
> 只有确认输出为 vitest 形态的 4 个 TS 站点启用守卫。
>
> 这**严格不降低**门禁强度（非 TS 站点行为完全不变），且消除了未论证的误放行路径。

**真实缺口**：6 个 `❌ BLOCKED - Tests FAILED` 站点，**只有 1 个（L1905）接了守卫**：

| 行 | 场景 | 守卫 |
|---|---|---|
| L1885 | >20 个测试文件 → 全量 `--coverage` | ❌ |
| L1915 | 改动测试文件 `--coverage` | ✅ |
| L1960 | 相关测试文件 `--coverage` | ❌ |
| L1973 | 无相关测试 → 全量 `--coverage` | ❌ |
| L1992 | fallback `run_tests` | ❌ |
| L2008 | 非 TS adapter `run_tests` | ❌ |

L1973 正是 issue 报告的路径（`npx vitest run --coverage`）。

### 2.2 方案

抽出一个**统一的判定 + 消息**辅助函数，杜绝「新增站点忘记接守卫」再次发生：

> **R2 修订（2/3 指出 MC-04）**：必须**显式传入**输出与上下文，
> 不得依赖调用点恰好设置了全局变量 `TESTS_OUTPUT`（隐式耦合会在某站点变量为空时误判放行）；
> 且文案不得硬编码 vitest 语境 —— L2008 是非 TS adapter 站点，复用会产生误导。

```sh
# 统一处理测试命令的非零退出。
# $1 = 输出内容（显式传入，不读全局变量 TESTS_OUTPUT —— 避免隐式耦合）
# $2 = 站点上下文（用于错误消息，可为空）
# 返回 0 = 应放行（runner 基础设施错误，已打印 SKIP）
# 返回 1 = 应 BLOCK（真实测试失败）
#
# 仅用于输出确定为 vitest 形态的站点。非 TS adapter 的通用 run_tests 路径
# 不启用本 helper（其输出格式不保证，保守维持 BLOCK）。
handle_test_failure() {
  local _out="$1" _ctx="$2"
  if is_runner_infrastructure_error "$_out"; then
    echo ""
    echo "⏭️  SKIPPED - vitest runner infrastructure error (no test failed)"
    echo "    Detected: Unhandled Errors with 0 failed tests."
    echo "    Known Windows issue: EPERM on vitest temp/ssr cache (#454)."
    return 0
  fi
  echo ""
  echo "❌ BLOCKED - Tests FAILED${_ctx:+ ($_ctx)}"
  return 1
}
```

**启用的 4 个站点**（均为 vitest 输出）—— 显式传参，保留各站点原有的
per-site 上下文与详细输出（架构师 minor）：

```sh
if [ "$TESTS_EXIT_CODE" -ne 0 ]; then
  handle_test_failure "$TESTS_OUTPUT" "changed test files" || exit 1
else
  echo "✅ PASSED - ..."
fi
```

| 行 | 场景 | 处理 |
|---|---|---|
| L1885 | >20 测试文件 → 全量 `--coverage` | **启用守卫** |
| L1915 | 改动测试文件 `--coverage` | 已启用（现状保留） |
| L1960 | 相关测试文件 `--coverage` | **启用守卫** |
| L1973 | 无相关测试 → 全量 `--coverage` | **启用守卫** |
| L1992 | fallback `run_tests` | **不启用**（通用路径，保持 BLOCK） |
| L2008 | 非 TS adapter `run_tests` | **不启用**（通用路径，保持 BLOCK） |

**硬约束遵守**：真实失败仍 BLOCK（守卫的第二段 `grep` 保证）；
不降低判定强度；不用 `--no-verify`；不拆分测试文件规避并行。

### 2.3 REQ-1（Windows EPERM）的处理 — 不盲改

**实测：本机（node v24.19.0 / vitest 1.6.1）无法复现**。issue 环境为 node v22.22.2。
已用 issue 报告的两组文件（`analyzer+config`、`reporter+types`）及 3 文件组合复现失败，
**全部 exit 0、无 Unhandled Errors**。

**明确不采纳全局 `--no-file-parallelism`**：实测代价 **+27% 耗时**
（33.1s → 42.2s，14 文件/265 测试）。
AGENTS.md 已记录 #418 是「pre-commit 耗时退化」的 issue，全局串行化会加剧它。

**改为**：
- REQ-1 → 在 `docs/` 记录该 Windows 限制与 `--no-file-parallelism` 这条**按需** workaround，
  以及「本机不可复现、需 node v22 环境验证」这一事实。
- REQ-4 → Windows CI 增加守卫：多文件运行**不得**出现 Unhandled Errors。

### 2.4 验收标准

- **AC-454-01**：**4 个 vitest 站点**接入守卫（`grep -c` 断言计数）；
  L1992/L2008 两个通用路径**保持** `echo "❌ BLOCKED"` 不变。
- **AC-454-02**：喂入含 `Unhandled Error` 且无失败标记的输出 → 报 SKIP，不 BLOCK。
- **AC-454-03**：喂入真实失败输出（`Tests 1 failed`）→ 仍 BLOCK。
- **AC-454-04**：同时含 `Unhandled Error` 与 `Tests 1 failed` → **BLOCK**（真实失败优先）。
- **AC-454-05**：Windows CI 出现 Unhandled Errors 时 job 失败。
  **前置条件已确认**：`.github/workflows/cross-platform-ci.yml` L21
  `os: [ubuntu-latest, macos-latest, windows-latest]`，L175 `windows-gitbash-hooks`
  亦为 `windows-latest`。该 CI 在 PR 上触发（已由本会话多次 PR 运行证实）。
- **AC-454-06**：非 TS adapter 路径行为**完全不变**（回归）。
- **AC-454-07**：4 个站点原有的 per-site 上下文与详细输出**不丢失**。

---

## 3. #452 — 只修 stale-entry 泄漏（REQ-3）

### 3.1 问题修正

**REQ-1/2/4 已满足，不重复实现。** 证据：
- `boy-scout.ts:647` `const merged: Record<string, BaselineEntry> = { ...existing };`
  → 非空基线**结构上不可能**变空。
- 实测探针：既有条目输出 `preserved: src/npm-package/lib/test-alignment.ts`，内容完整保留。
- `.warnings-baseline.json` 当前 1 条目、**工作区干净**，未污染提交边界。
- issue 描述的「静默覆盖」是 **#445 的旧状态**，已在 `8d9d647` 修复；
  探针中出现的 `{}` 仅发生于**格式非法条目**，且**有告警输出**（`⚠️ Dropped N malformed`）。

### 3.2 真实缺口（REQ-3）

`classifyFiles` 已解析 `deleted`（`boy-scout.ts:9/87/117`），
但**全仓库没有任何代码消费 `result.deleted`** → 已删除文件的基线条目**永久残留**。

后果：基线只增不减，逐渐变成「幽灵条目」集合；`xp-gate baseline show` 会列出已不存在的文件，
且这些条目永远无法通过正常提交流程清理。

### 3.3 方案

> **R2 修订（3/3 一致指出）**：初版「仅用 `fs.existsSync` 剪除」被三个模型一致指出
> 有**误删风险**：rebase/merge 冲突中间态、切分支、gitignored 生成物被清理、
> sparse-checkout、符号链接、权限受限 —— 都会让真实存在的文件被判为「不存在」，
> 从而**永久清除**历史条目。且未处理路径分隔符/大小写，Linux 与 Windows
> 对同一基线可能得出相反判定。
>
> **改为「双重确认」：文件既不存在、又已不被 git 追踪，才剪除。**

在 `initBaselineCommand` 的 merge 之后，移除**同时满足两个条件**的条目：

```ts
// #452 REQ-3: 移除已删除文件的基线条目。
// 必须双重确认，避免误删（R2 三位评审专家一致要求）：
//   1) 路径规范化后在磁盘上确实不存在（existsSync === false）
//   2) git 确认该路径已不再被追踪
// 任一条件不满足 -> 保留条目（保守优先，宁可留垃圾也不误删预算）。
const staleEntries = Object.keys(merged).filter(f => isConfirmedDeleted(f));
if (staleEntries.length > 0) {
  console.log(`🗑️  Removed ${staleEntries.length} baseline entry(ies) for deleted files:`);
  for (const f of staleEntries) { console.log(`   - ${f}`); delete merged[f]; }
}
```

`isConfirmedDeleted(path)` 的实现要求：

1. **路径规范化**：统一分隔符（`\` → `/`）并按平台做大小写规范化，
   与基线条目存储格式对齐后再比较（技术 mC-02 / 架构师 MC-03）。
2. **存在性检查**：`fs.existsSync` 为 `true` → 保留。
3. **git 追踪校验**：`existsSync` 为 `false` 时，再跑
   `git ls-files --error-unmatch <path>`：
   - 退出码 0（仍被追踪）→ **保留**（说明是 rebase/checkout 的临时缺失）。
   - 非 0（已不追踪）→ 确认为删除，可剪除。
4. **git 不可用或命令异常** → **保留全部**（保守）。
5. `existsSync` 抛错与返回 `false` 是**不同分支**（可行 MC-06）：
   抛错 → 保留；`false` → 仍需走第 3 步确认。

**边界处理**：不使用 `classifyFiles` 的 `deleted` 列表做唯一依据 ——
它只反映**本次提交**的删除，而 stale 条目可能来自**任何历史提交**；
存在性 + git 追踪才能覆盖全部历史。

**REQ-2 补强**：`runEnforcement` 的自动初始化当前只打印计数
（`Auto-initialized baseline for N files`，L725），不列文件名。改为列出文件名。

### 3.4 验收标准

- **AC-452-01**：既有基线含 `a.ts`，本次只传 `b.ts` → 结果同时含 `a.ts` 与 `b.ts`（回归，应已通过）。
- **AC-452-02**：基线含已删除文件 `gone.ts` → 下次 `--init-baseline` 后该条目被移除**且被报告**。
- **AC-452-03**：重复执行幂等（同输入两次结果一致）。
- **AC-452-04**：不存在性检查抛错时条目**被保留**，不被误删。
- **AC-452-05**：`runEnforcement` 自动初始化列出文件名。
- **AC-452-06**：未改动文件不被 Gate 6 判 BLOCK。

---

## 4. #423 — Gate MW 从「自述」收紧为「执行证明」

### 4.1 问题（比 issue 描述更严重）

`validateExpert`（`githooks/lib/validate-code-walkthrough.cjs:50-75`）：
- `requested_model`（L64-69）：非空 + trimmed 互异。**有约束。**
- `resolved_model`（L71-74）：**仅**「非空字符串或 null」。**从不 trim、从不计数、从不比较。**

**实测（Lead + 调查双重确认）**：
| 篡改 | 结果 |
|---|---|
| 基线真实证据 | exit 0 |
| `experts[1].resolved_model = null` | **exit 0（通过）** |
| `experts[1].resolved_model = experts[0].resolved_model` | **exit 0（通过）** |

第三行说明：**三个专家可以全部记录同一个真实模型而 Gate MW 照样通过**。
issue 说「凭空填三个不同模型名」还低估了 —— 连「不同」都不需要。

### 4.2 关键障碍：issue 的方案按字面无法实现

issue 方案 1 的条件是「当专家结果**声明**来自外部 provider 时」。
**但证据文件里根本没有 channel/provider/source 字段**（validator 中这三个词出现 0 次）。
`mode`、`provider`、`channel`、`source` 在真实证据文件中都不存在。
`delphi-external-review.cjs` 只在 stdout 里输出 `model_used`，
而真实的 `.code-walkthrough-result.json` **连 `model_used` 都没有**。

→ **必须先加 schema 字段**，否则无法区分通道，只能无条件收紧，
而**无条件收紧会破坏本地通道**。

### 4.3 方案：补 `channel` 字段 + 对 external 通道收紧

> **R2 修订（第 1 轮评审 CRIT-01）**：初版设计「`channel` 缺省视为 `local`」被三个模型
> **一致**指出存在**零成本绕过**：伪造者只要**省略** `channel` 字段，
> 外部伪造证据就会以 local 身份通过全部新约束，与「从自述收紧为执行证明」的目标直接冲突。
> 下述步骤 1/2 已按此修订为**显式声明 + 未知即失败**。

**步骤 1 — schema 扩展（producer 写入，显式声明）**
`scripts/delphi-external-review.cjs` 在 `buildReviewOutput`（L459-474）中增加：
```js
channel: 'external',            // 该 producer 只服务外部通道，硬编码，不可由输入覆盖
provider: provenance.provider,  // 已有，显式落盘
```
本地通道（Skill 手工写入）增加 `channel: 'local'`。

**步骤 2 — validator：显式声明 + 未知来源 fail（消除绕过）**

三态处理，**不再有任何「缺省放行」路径**：

```js
const CHANNELS = ['external', 'local'];

// (a) channel 必须是显式白名单值之一。缺失或未知 -> FAIL。
//     这是消除「省略字段即降级为 local」绕过的关键：
//     省略 channel 不再是「兼容旧文件」，而是「证据不完整」。
if (!CHANNELS.includes(expert.channel)) {
  fail(`expert ${expert.role} must declare channel as one of: ${CHANNELS.join(', ')}.`);
}

// (b) external 通道必须提供执行证明。
if (expert.channel === 'external') {
  if (typeof expert.resolved_model !== 'string' || expert.resolved_model.trim() === '') {
    fail(`expert ${expert.role} is external but resolved_model is missing.`);
  }
  const resolved = expert.resolved_model.trim();
  if (resolvedModels.has(resolved)) {
    fail(`resolved_model ${resolved} is duplicated across experts.`);
  }
  resolvedModels.add(resolved);
}
```
- `resolvedModels` **每次校验运行重置**（架构师 mC-04）：作用域限于单次 invocation，
  不可跨文件/跨运行累积。
- **不要求** `requested_model === resolved_model`（网关会改名：
  `g-glm-5.3-flash` → `glm-5-3-flash-260826`，真实证据正是如此）。
- 仅对 `external` 要求 `resolved_model`；`local` 保持现状（可 null）。

**步骤 2b — 过渡期策略（架构师 CI-01 要求）**

强制 `channel` 会**破坏既有无 channel 的证据文件**（含 9 份文档示例与 3 个绿色 BATS）。
采用**两阶段**，且阶段切换有明确判据：

- **阶段 1（本 PR）**：`channel` 缺失 → **FAIL**（校验器层面）。
  同时**更新所有仓库内证据与文档示例**加上 `channel`，使仓库自洽。
  既有 BATS 断言（`:55`、`:157`）需**显式改写**为「缺失 channel 现在失败」——
  这是**语义变更**，按 TDD 必须明确改写而非静默绕过。
- **阶段 2（后续 issue）**：schema 版本化（`evidence_schema_version`），
  过渡期后彻底移除对旧形状的容忍。
- **理由**：三个模型一致认为「缺省放行」使本修复对真实威胁模型无效。
  宁可现在改测试，也不留旁路。**此变更需在 PR 描述中显著标注为 breaking change。**

**步骤 3 — 运行期护栏**
`delphi-external-review.cjs` 当前在 provider 未回显 `data.model` 时写入 `null`（L412）。
按新规则该专家将**永久无法成为合法外部证据**。改为：**缺 `data.model` 视为硬失败**，
而不是静默写 null —— 否则 Skill 会产出自己的门禁必然拒绝的文件。

### 4.4 必须改写的既有断言（R2 一致指出的重点）

> **⚠️ 本节已按 R2 第 1 轮 CRIT-01 完全重写。** 初版曾主张
> 「`channel` 缺省 = local，故既有测试继续通过」。三个模型一致指出
> 那是**零成本绕过**。现设计为**缺失即 FAIL**，因此既有断言**必须显式改写**。

新增的强制 `channel` 约束**会**使以下既有测试失败。它们是**语义变更的直接后果**，
按 TDD 必须**明确改写**，不得为「保持绿色」而保留旧语义：

| 位置 | 现断言 | 改写为 |
|---|---|---|
| `githooks/__tests__/gate-mw-evidence.test.bats:55` | 无 channel + `resolved_model: null` → **PASS** | 显式 `channel: 'local'` → PASS（本地通道语义不变） |
| `githooks/__tests__/gate-mw-evidence.test.bats:157` | 「null resolved model 仍可信」→ PASS | 拆两条：`channel:'local'`+null → PASS；**缺 channel → FAIL** |
| `githooks/__tests__/gate-mw-evidence.test.bats` setup fixture (L23-39) | 专家无 channel | 补 `channel: 'local'` |
| `gate-m2-threshold.test.bats:66-68`, `:118-120` | 专家无 channel | 补 `channel: 'local'` |
| `gate-cjs-source-detection.test.bats:68-70` | 专家无 channel | 补 `channel: 'local'` |
| `scripts/__tests__/code-walkthrough-doc.test.cjs:33` | 从文档抽示例跑 validator | 文档示例补 `channel` 后仍 PASS |

**需同步更新的文档（9 份副本）**：`skills/delphi-review/references/code-walkthrough.md`
的示例 JSON 增加 `channel` 字段，然后重新镜像到 4 份 `plugins/*` 与 5 份
`src/npm-package/**`（**先改 canonical，再跑镜像**）。

**新增测试**（`mutate_fixture` 已存在于该 BATS 文件，RED 测试约 5 行）：
- 缺 `channel` → FAIL
- `channel: 'foo'` → FAIL
- `channel: 'external'` + `resolved_model: null` → FAIL
- `channel: 'external'` + 三个 `resolved_model` 重复 → FAIL
- `channel: 'external'` + 三个互异 → PASS
- `channel: 'local'` + `resolved_model: null` → PASS

**此项为 breaking change，必须在 PR 描述中显著标注。**

### 4.5 验收标准

- **AC-423-01**：`channel: 'external'` 且 `resolved_model: null` → **FAIL**。
- **AC-423-02**：`channel: 'external'` 且三个 `resolved_model` 有重复 → **FAIL**。
- **AC-423-03**：`channel: 'external'` 且三个 `resolved_model` 互异 → **PASS**
  （含网关改名场景）。
- **AC-423-04**：**缺失 `channel` → FAIL**（R2 修订：不再缺省放行，消除绕过）。
- **AC-423-05**：`channel: 'local'` → `resolved_model` 可 null（本地通道语义不变）。
- **AC-423-06**：`channel` 为未知值（如 `'foo'`）→ **FAIL**。
- **AC-423-07**：producer 遇 provider 未回显 `data.model` → 报错而非写 null。
- **AC-423-08**：`resolvedModels` 去重集合**每次校验运行重置**（两次独立运行
  相同输入结果一致，不跨运行累积）。
- **AC-423-09**：`resolved_model` 为纯空白（`'  '`）→ 按缺失处理 **FAIL**（可行 mC-02）。
- **AC-423-10**：`githooks/lib/validate-code-walkthrough.cjs` 改动后
  `bash scripts/check-hook-lib-mirror.sh` 通过（镜像需手工 `cp`，无同步脚本）。

---

## 4b. 评审过程中新发现的缺陷（本轮顺带修复）

### #460-D1 — `parseExpertVerdict` 拒绝结构化 issue 对象，使 Delphi 实际不可用

**发现方式**：R2 评审时首次实调三个模型，**三个全部**返回 `Invalid expert verdict.`。

**根因**：`scripts/delphi-external-review.cjs` 的 `parseExpertVerdict` 要求
```js
if (!Array.isArray(value[field]) || !value[field].every(item => typeof item === 'string')) {
  return { valid: false, message: 'Invalid expert verdict.' };
}
```
但 LLM 的**自然输出**是结构化 issue 对象：
```json
"critical_issues": [{ "id": "CI-01", "title": "...", "description": "...", "impact": "High" }]
```
`{...}` 不是 string → 整体判为无效。

**影响**：这是**真实执行链路的既有缺陷** —— 任何按自然格式回答的模型其评审都会被丢弃。
已实测：三个模型内容质量都很高（架构师产出 2 critical + 5 major + 5 minor），
却全部被判 `delphi_expert_error`。这解释了为什么仓库的
`.code-walkthrough-result.json` 虽有 `rounds: 3` 但专家字段异常单薄。

**修复**：`parseExpertVerdict` 容忍 `string | {id?,title?,description?,impact?,recommendation?}`，
规范化为字符串（保留 `id` 与 `title` 前缀）。**不放松** `verdict`/`confidence` 的校验。

**范围（R2 定案，可行 MC-06 要求不得留模糊）**：

§4b **不并入本 PR**。已定死为**独立 issue + 独立 PR**，理由三条：
1. 它与 4 个 P0/P1 **无耦合**，并入会制造范围争议；
2. 它触及 `scripts/delphi-external-review.cjs` 及其镜像，
   与本轮 `validate-code-walkthrough.cjs` 的镜像同步是**不同文件**，分开更清晰；
3. 它是**评审工具链**缺陷，与「门禁判定」不同性质，独立可回滚。

→ 本轮 BUILD **只做 §4b 的定位记录 + 开 issue**，不写其修复代码。
（R2 已用「规范化 prompt 让模型返回 string[]」的方式**绕开**该缺陷完成评审，
故它**不阻塞**本轮交付。）

**修复要点（供独立 PR 参考）**：`parseExpertVerdict` 容忍
`string | {id?,title?,description?,impact?,recommendation?}`，规范化为**固定模板**字符串：
`"${id ? id + ' ' : ''}${title || ''}${description ? ': ' + description : ''}${impact ? ' (影响: ' + impact + ')' : ''}"`
（架构师 minor：模板须确定，避免多专家输出格式漂移）。
**不放松** `verdict`/`confidence` 校验。

---

## 5. 跨切面约束

### 5.1 镜像（必须遵守）
- `src/principles/**` 是**规范树**，`src/npm-package/principles/**` 是生成镜像
  （`sync-package-content.js` → `syncModules('principles')`，**全量递归覆盖**）。
  **只改 `src/principles/**`，绝不手改镜像。**
- `githooks/lib/validate-code-walkthrough.cjs` → `src/npm-package/hooks/lib/`
  **无同步脚本**，必须手工 `cp` 后跑 `bash scripts/check-hook-lib-mirror.sh`。
- `scripts/delphi-external-review.cjs` 若改动，需同步其镜像。

### 5.2 门禁强度
- 任何改动**不得**降低门禁强度。真实测试失败必须继续 BLOCK。
- 不得使用 `--no-verify`。
- 工具缺失仍为 SKIP，不得改为 BLOCK。

### 5.3 TDD
每个 REQ 必须先写**会失败**的测试（RED），再实现（GREEN）。
#423 与 #452 的 RED 测试可在既有 `mutate_fixture` / 探针基础上快速构造。

### 5.4 外科手术式改动
不清理 4 个 issue 之外的既有告警（例如 `doctor.js` 既有 13 个原则告警）。

---

## 6. 交付顺序（BUILD 阶段）

> **R2 修订（可行 MC-03）**：初版把 #457（面最大）排最后，评审指出
> 「若时间紧张最可能被压缩或跳过」，风险暴露窗口未缓解。改为**按风险前置**：
> 面最大且价值最高的 #457 提前，并明确每项的**镜像同步**为必做步骤。

按**风险与价值**排序：

1. **#454（守卫补全）** — 纯 shell 局部改动，独立，风险最低。起步建立信心。
2. **#457（配置生效）** — **面最大、价值最高，提前**避免被挤掉。
   完成后立即跑 15 个规则测试 + Gate 4/6 一致性验证。
3. **#452 REQ-3（stale 清理）** — 单文件局部改动，独立。
4. **#423（channel 收紧）** — schema + validator + producer + 同步镜像 + 改写冗余断言。
5. **§4b Delphi 解析器** — **独立 issue + 独立 PR**（已定案，不并入本轮）。

**每项完成后必须执行的镜像同步**（不可省）：

| 改动的规范文件 | 镜像动作 |
|---|---|
| `src/principles/**` | 跑 `node src/npm-package/scripts/sync-package-content.js` |
| `githooks/lib/validate-code-walkthrough.cjs` | 手工 `cp` 到 `src/npm-package/hooks/lib/` + 跑 `bash scripts/check-hook-lib-mirror.sh` |
| `scripts/delphi-external-review.cjs` | 手工 `cp` 到 `src/npm-package/scripts/` + 跑 `bash scripts/check-delphi-runner-mirror.sh` |
| `githooks/pre-commit`, `githooks/gates/*.sh` | 每项完成后 `xp-gate doctor --sync-hooks` + 跑 sync 脚本 |

全部完成后跑完整 `npx vitest run` + `npx tsc --noEmit` + `xp-gate doctor --sync-hooks`。

---

## 8. R2 评审遗留项（BUILD 阶段 checklist）

三位专家均 APPROVED，但留下若干**非阻断**的跟踪项。转为可勾选清单绑定 AC：

- [ ] AC-423-04 的实现须与 §4.4 改写后的断言**一致**（架构师 major-01 / 技术 major-01）
- [ ] `is_runner_infrastructure_error` 保持单参；非 TS 站点不启用守卫（架构师 major-02）
- [ ] Windows CI 前置条件已在 AC-454-05 给出 workflow 证据（可行 MC-04）
- [ ] `#457` 全局状态：`resetActiveConfig()` 每用例重置 + 并发约束 JSDoc（可行 MC-01）
- [ ] `#457` `effectiveThreshold` 加在 `Violation` 上须确认**不破坏既有快照/消费者**（可行 MC-02）
- [ ] `#457` deep merge 的 `null` 覆盖语义显式写入规格（架构师 minor）
- [ ] `#452` 路径比较函数以 **git 索引实际路径**为规范形（架构师 minor）
- [ ] `#423` breaking change 的全量证据改写清单在 PR 描述中逐项勾选（可行 MC-03）
- [ ] PR 描述声明**治理语义转变**：门禁强度控制点移至版本化 `.principlesrc`（架构师 minor）

---

## 7. 风险与缓解（R2 修订后）

| 风险 | 影响 | 缓解 |
|---|---|---|
| #457 改 15 个模块引入回归 | 高 | Approach A 不动 `Rule` 类型/签名；靠既有 ~150 处直调测试兜底 |
| #457 全局可变配置跨测试污染 | 高 | **`resetActiveConfig()` 必须提供**，每个用例前后重置；JSDoc 声明并发约束 |
| #457 `rule.threshold` 语义分裂 | 中 | 加 `@deprecated` + 新增 `effectiveThreshold` 可观测入口，不做静默移除 |
| #457 新入口忘记初始化 | 中 | 收敛到单一 choke point；未显式初始化时**告警**而非静默用默认 |
| #423 缺失 `channel` 绕过 | **高** | **改为缺失即 FAIL**（三模型一致的 CRIT）；同步更新 9 份文档示例与 3 个 BATS 断言 |
| #423 强制 channel 破坏既有证据 | 中 | 属**有意的 breaking change**，PR 显著标注；本 PR 内同步修好仓库内全部证据 |
| #452 存在性检查误删 | 中 | **双重确认**（不存在 + git 不追踪）；任一存疑则保守保留 |
| #452 路径分隔符/大小写差异 | 中 | 比较前规范化；补跨平台 AC |
| #454 helper 隐式依赖全局变量 | 中 | **显式传参**，不读 `TESTS_OUTPUT` 全局 |
| #454 非 TS 站点文案误导 | 低 | runner 名作为参数传入 |
| #454 REQ-1 无法本机验证 | 中 | 明确披露不可复现；不盲改全局配置；Windows CI **已存在**（`windows-latest`），交由守卫 |
| Delphi 解析器拒结构化输出 | **高** | 本轮已定位，见 §4b；作为独立项修复 |
| 镜像未同步导致 CI 红 | 低 | 每个涉及文件在交付顺序中**显式列出**镜像同步步骤，非事后检查 |
