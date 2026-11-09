# Delphi Code Walkthrough — 评审材料（供 /delphi-review --mode code-walkthrough 使用）

> 分支：`merge/gate-6-and-cli-perf`　HEAD：`99d8987f`
> 这份文件是为了让评审能在此仓库内执行、并让工具把证据写到本仓库而准备的。
> 内容即上一轮已获 **100% APPROVED** 的材料，无需修改。

---

## 一、变更概述

本分支实现 **Gate 6 分层边界校验**（#686 / #691 / #728），修复 `architecture.yaml` 中 `layers:` 声明**从未被执行**的问题。

**规模**：16 文件，+2838/-29 行。其中约 1300 行文档、约 900 行测试、约 620 行实质代码（含 3 份镜像副本）。

## 二、背景：要解决的问题

`architecture.yaml` 里的 `layers:` 从未被真正执行：

- **#16**（2026-05-03）：schema 不兼容，当时的修法是**不再传 `--config`** → `layers:` 从此永久死掉
- **#728**（2026-11-03）：实测 @archlinter/cli 0.16.0 的 `layer_violation` 检测器在 7 种配置组合下**恒返回 0 条**

门禁 6 一直在报「分层规则未校验」的 WARN，没有任何东西真正检查依赖方向。

## 三、核心新增：`githooks/gate-6-layers.sh`

解析 `architecture.yaml` 的 `layers:`，建立**全仓库导入图**，判定文件属层，检查跨层 import 是否违反声明的依赖方向。

关键设计决策：

1. **一次 awk pass 建立全图**。不用逐文件 grep。层违规是「两个目录之间的一条边」，增量的按目录扫描在结构上看不见这样的边。
2. **文件枚举用 `git ls-files --cached --others --exclude-standard`**（tracked + untracked，尊重 .gitignore）。
3. **层归属采用最长模式优先**。`src/domain` 与 `src/domain/entities` 同时匹配时，更长的胜出。
4. **环境变量覆盖**：`XP_GATE_LAYER_CONFIG` / `XP_GATE_LAYER_BASELINE` / `XP_GATE_LAYER_SCAN_ROOT`。
5. **退出码契约**：`0=PASS, 1=FAIL, 2=BLOCK, 3=WARN`。

## 四、核心新增：`githooks/lib/layer-baseline.cjs`

Ratchet 基线比较器。stdin 读 findings（TAB 分隔），argv[2] 是 JSON ledger。

**关键决策**：ledger 存在但解析失败时 **exit 4**，调用方映射为 BLOCK（fail-closed）。文件头注释：

> a ledger that silently reads as empty would turn every accepted violation back into a new one, and the next natural response — re-run with a bigger baseline — quietly launders the debt.

**为什么是独立文件**：第一版内嵌在 bash 单引号里，TAB 落进 JSON 字符串字面量，`JSON.parse` 拒绝，错误被 `2>/dev/null` 吞掉，ratchet 每次静默重置。

## 五、上轮评审发现并已修复的 4 个缺陷

### 缺陷 1：`*)` 分支 fail-open（3 位专家共同指出）

```bash
case "$LAYER_RC" in
  0) PASS ;;
  1) FAIL; GATE_6_STATUS="FAIL" ;;
  2) BLOCK; GATE_6_STATUS="FAIL" ;;
  3) WARN ;;
  *)  # 126/127（不可执行/找不到）、137（被杀）、bash 错误
      # 映射到 WARN 会让崩溃的校验器以「未检查」身份通过，是 #686 深一层
      GATE_6_LAYER_STATUS="BLOCK"
      GATE_6_STATUS="FAIL"
      GATE_6_LAYER_REASON="layer_checker_crashed_rc_${LAYER_RC}"
      GATE_6_LAYER_CRASHED=1
      ;;
esac
```

配套输出：

```bash
if [ "${GATE_6_LAYER_CRASHED:-0}" = "1" ]; then
  echo "     ❌ [BLOCK:LAYER_CHECKER_CRASHED] gate-6-layers.sh exited $LAYER_RC without a verdict."
  echo "        A checker that did not finish has not checked anything — fail closed."
fi
```

**验证**：模拟 `exit 127` → `BLOCK / FAIL / layer_checker_crashed_rc_127`。

### 缺陷 2：空洞 PASS

原代码 `if [ -z "$FINDINGS" ]; then _layers_verdict 0 "✅ ... 0 violations"`。

问题：`0 violations` 有两种含义——「所有被分类的文件都合规」和「根本没有任何文件被分类」。后者是配置与现实的漂移。

```bash
if [ -z "$FINDINGS" ]; then
  if [ "$LAYER_CLASSIFIED" -eq 0 ]; then
    _layers_verdict 3 \
      "⚠️  0 of $LAYER_CLASSIFIED_FILES scanned file(s) match any of the $LAYER_COUNT declared layer(s) — nothing was actually checked." \
      "layer_config_matches_no_files" \
      "   Declared patterns are checked against repo-relative paths." \
      "   A config for a different layout than this tree will never enforce anything."
  fi
  _layers_verdict 0 \
    "✅ Layer boundaries verified ($LAYER_COUNT layers, $LAYER_CLASSIFIED file(s) classified, 0 violations)." \
    "layers_checked"
fi
```

awk 侧通道计数（不污染 findings 流）：

```awk
FNR == 1 {
  file = FILENAME
  sub(/^[.][/]/, "", file)
  src = layer_of(file)
  seen++
  if (src != 0) classified++
}
END {
  if (ENVIRON["XP_LAYER_STATS"]) {
    printf "%d %d\n", seen, classified > ENVIRON["XP_LAYER_STATS"]
    close(ENVIRON["XP_LAYER_STATS"])
  }
}
```

**验证**：本仓库（727 文件，0 个匹配声明的 4 层）现在输出 `⚠️ 0 of 727 ... nothing was actually checked`，rc=3。

### 缺陷 3：`patterns:` 数组被静默忽略（写缺陷 2 的 fixture 时发现）

解析器只认单数 `pattern:`。一个层拥有两个目录时必须写复数数组，解析成空 pattern 列表 → 匹配不到文件 → 报 0 violations → PASS。

```awk
else if (body ~ /^patterns?:/)  { pattern = clean(substr(body, index(body, ":") + 1)) }
```

```awk
function flush(   k, i, p) {
  if (name == "") return
  k = split(pattern, p, ",")
  if (k == 0) { print name "\t\t" allowed "\t" forbidden; name = ""; return }
  for (i = 1; i <= k; i++) { if (p[i] == "") continue; print name "\t" p[i] "\t" allowed "\t" forbidden }
  name = ""
}
END { flush() }
```

### 缺陷 4：2 个 bats 用例从未运行

两个 `@test` 名字含 em dash（`—`），bats 无法解析，报 `unknown test name` 并**跳过**，整体仍 exit 0。

被跳过的包括 `an untracked file is scanned`——正是覆盖之前「`git ls-files --cached` 漏掉未跟踪文件」那个 bug 的用例。**那个回归一直是绿的，因为测试从来没跑过。**

已改为 `--`。现在 18/18 全部执行。

## 六、端到端验证

**真实 Clean Architecture fixture**（git 仓库，`patterns:` 复数数组）：

合规状态：
```
✅ Layer boundaries verified (4 layers, 4 file(s) classified, 0 violations).
rc=0
```

注入 `src/domain/violation.ts`（`import { User } from "../infrastructure/db"`）：
```
❌ BLOCKED - 1 new layer violation(s) (of 1 total):
   - src/domain/violation.ts  [domain -> infrastructure]  imports src/infrastructure/db
rc=1
```

## 七、测试结果

```
bats githooks/__tests__/gate-6-layers.test.bats    18/18 通过
```

覆盖：层归属最长匹配、跨层违规检出、baseline ratchet 命中/未命中、ledger 损坏→exit 4、无配置→WARN、untracked 文件可见性、嵌套层、多语言 import 语法、空洞配置→WARN、`patterns:` 复数数组。

## 八、镜像一致性

```
check-hook-mirror.sh
PASS: canonical githooks and npm package mirrors are byte- and mode-identical
```

- `githooks/gate-6-layers.sh` → `src/npm-package/gate-6-layers.sh` + `src/npm-package/hooks/gate-6-layers.sh`
- `githooks/pre-commit` → `src/npm-package/hooks/pre-commit`
- `githooks/lib/layer-baseline.cjs` → `src/npm-package/hooks/lib/layer-baseline.cjs` + `src/npm-package/lib/layer-baseline.cjs`

## 九、已知的、评审者可能关注的语义

**本仓库的 `architecture.yaml` 是给用户项目的 Clean Architecture 模板**，声明的 `src/domain|application|infrastructure|presentation|shared` 在 xp-gate 自己仓库里一个都不存在。

因此在本仓库上跑会得到 WARN（`layer_config_matches_no_files`），**这是正确行为**——它诚实地说明「声明了但没东西可查」，而不是报 PASS。

校验器本身通过 18 个 bats 用例 + 真实 Clean Architecture fixture 验证。

## 十、非阻塞遗留项

1. `git ls-files --others` 在 10k+ 未跟踪文件仓库上的性能未基准测试（当前本仓库 727 文件下扫描约 2 秒）
2. `check-hook-mirror.sh` 是否跑在 CI 里待确认
3. YAML block-list 形式（`- item` 每行一项）的 `patterns:` 未解析，会退化为空洞 WARN（fail-closed，安全）
