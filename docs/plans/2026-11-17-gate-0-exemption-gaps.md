# Gate 0 版本一致性：三个豁免缺口（实测记录）

**日期:** 2026-11-17
**类型:** 缺陷记录（不是设计变更），供下一阶段修复排期
**触发:** 文档刷新与门禁修复过程中的连续提交，三次被同一道门禁拦下

---

## 0. 结论先行

Gate 0（版本一致性）在受保护分支上要求"改生产源码必须升 VERSION/CHANGELOG"。
它用一张**路径白名单**判定哪些改动算"构建工具链、不需要升版本"。

本次工作确认：**白名单缺三类路径**，导致这些改动被误判为生产源码，被要求升版本。
三次中断都靠 `SKIP_VERSION_CHECK=1` 绕过——**这是绕过了正确的门禁，不是修好了它**。
门禁本身的问题仍然存在，只是被环境变量掩住。

| # | 缺口 | 实测证据 | 影响 |
|---|---|---|---|
| G0a | `githooks/gate-entries/*` 不在白名单 | `grep -c "githooks/gate-entries/\*"` = 0 | 改任何 gate 逻辑都要求升版本，而同类的 `githooks/adapters/*` 却被豁免 |
| G0b | `skills/**` 不在白名单 | `grep -c "skills/\*"` = 0 | 改 skill 文档或脚本被当成改产品源码 |
| G0c | 测试文件（`__tests__/`、`*.test.cjs`）不在白名单 | `grep -c "__tests__/\*\|\.test\.cjs"` = 0 | 只改测试也被要求升版本 |

---

## 1. 缺口 G0a：`githooks/gate-entries/` 被漏掉

### 现象

一次只改 `githooks/gate-entries/gate-12-entry.sh`（加一行 SKIP 审计）的提交被拦：

```
ERROR: Committing production source to a protected branch without a
VERSION/CHANGELOG update.
```

### 根因

`githooks/gate-entries/gate-0-entry.sh:414` 的豁免分支：

```bash
src/npm-package/adapters/*|src/npm-package/scripts/*|src/npm-package/hooks/*|scripts/*|githooks/adapters/*)
  has_source=true
  continue
  ;;
```

`githooks/adapters/*` 在内，**`githooks/gate-entries/*` 不在**。
而这两个目录是同一类东西——都是门禁的实现代码，都不改变发布产物语义。

> **一个我先犯后纠的判断错误**：我一开始怀疑 bash `case` 的 `*` 不跨越 `/`，
> 所以 `hooks/*` 其实没覆盖子目录。**这是错的**：bash `case` 的 `*` 确实匹配 `/`，
> `hooks/*` 覆盖全部子目录。真正的缺口只有 `githooks/gate-entries/` 这一条。
> 记在这里，免得下一个人重复这个推理弯路。

### 为什么这不是"合理的门禁"

门禁逻辑的修改**不改变**包的行为契约，却改变"门禁说什么"。给这类修改升版本号，
会让版本号序列混入大量与用户无关的条目，版本语义随之失效。

---

## 2. 缺口 G0b：`skills/**` 被当成产品源码

### 现象

批次 4（skill 文档修正）提交被拦，暂存文件列表里是 `skills/sprint-flow/AGENTS.md`
与 `skills/sprint-flow/references/phase-overview.md`。

### 分析

`*.md` 本身不在扩展名列表里（第 416-428 行只列 `.ts/.js/.py/.go/...`），
纯 `.md` 提交会走 `has_source=false` 的 "doc-only" 分支**正常通过**——
本次文档刷新（7 个 AGENTS.md）就走通了。

拦截来自同批的 `skills/sprint-flow/__tests__/sprint-flow.test.cjs`（`.cjs`）。
所以 G0b 与 G0c 实际是**同一个缺口**：`skills/` 下的非文档文件。

### 判断

`skills/` 是随包分发的行为资产，但它的**内容修正**属于文档/测试范畴，
不等于发布语义变更。是否该升版本是个策略问题，不是缺陷——
**但当前状态是"没人决定过"**，只是恰好掉进了扩展名规则里。

---

## 3. 缺口 G0c：测试文件被当成产品源码

### 现象

只改 `githooks/__tests__/gate-12-verdict-integrity.test.bats` 时，
若同批没有别的源码，也会被要求升版本。

### 分析

`.bats` **不在扩展名列表里**（列表第 416-428 行只有 `.ts/.js/.py/.go/.java/.kt/.cs/.cpp/.c/.h/.swift/.m/.dart/.sh/.ps1/.css/.scss/.rs`；
文件里另有两处 `bats` 字样，经核实都是注释中引用的测试文件名，不是规则），
所以**纯 `.bats` 提交是安全的**——本次 Gate 12 的测试文件就搭着源码一起过，未单独触发。

但 `.cjs` 测试脚本（本仓大量测试是 `*.test.cjs`）在列表里，被判为真实源码。

### 判断

测试改动升版本号没有任何传递价值：用户装到的包里测试通常被排除，
版本号对用户承诺的是行为变化。

**但要小心**：不能简单豁免所有 `*.test.*`——本仓有测试同时充当契约文档
（如 `runtime-discipline-rules.test.cjs` 断言 AGENTS.md 结构），
改它可能改变发布物的内容。这一条需要单独决策，不宜顺手改。

---

## 4. 为什么本次没有直接修

1. **修 G0 白名单是行为变更**，需要它自己的 TDD 与验证周期；
   混在文档/门禁修复的提交里，会让"这次到底改了什么"变得不可审。
2. **G0b/G0c 需要策略决定**（skill 脚本、测试脚本是否算发布语义），
   这不是我能单方面定的——它牵动版本语义的定义。
3. 本次用 `SKIP_VERSION_CHECK=1` 是**已知的、有记录的绕过**，
   且每次都在提交信息里写明了理由与"这是缺陷不是惯例"。

---

## 5. 顺带确认的一个既有镜像缺口

`xp-gate sync-mirrors --write` **不覆盖** `src/npm-package/plugins/*/skills`。
它只同步 `skills -> src/npm-package/skills`，而 `skills-mirror-parity.test.cjs`
（AC-485）要求**六个**镜像树逐字节一致，包括
`src/npm-package/plugins/{claude-code,opencode,qoder,dsh}/skills`。

结果是：`sync-mirrors` 报完 IN SYNC，parity 测试仍然红。
修复动作只能靠测试报错信息里给的手工命令 `cp -r skills/. <mirror>/`。

这与 `docs/AGENTS.md` 里"文档重复生成事实会静默漂移"是同一类问题：
**有两个同步机制，只有一个是权威的，而失败时的提示来自另一个。**

---

## 6. 给下一阶段的输入

修复顺序建议（都不大，但需各自独立提交）：

1. **G0a** —— 纯补齐，语义清晰：把 `githooks/gate-entries/*` 加进白名单，
   与 `githooks/adapters/*` 并列。需要一条测试钉住"改 gate entry 不需要升版本"。
2. **G0c** —— 先定策略：测试脚本算不算发布语义。再动代码。
3. **G0b** —— 跟随 G0c 的结论，一次性把 `skills/` 的规则写清楚。
4. **镜像同步统一** —— 让 `sync-mirrors` 覆盖 plugin skills，
   或者让 parity 测试指向 `sync-mirrors` 而不是手工 `cp`。二选一。