# 门禁 × 语言 有效性矩阵

**测量时间**：2026-11-20
**版本**：0.38.55.0
**方法**：`scripts/probe-gate-matrix.sh` —— 每种语言建两个临时仓库
（`git init -b probe<name>`），一个干净、一个植入该语言的典型缺陷，
各提交一次，读 `.xp-gate/reports/pre-commit/<ts>.json` 的判定。
**汇总**：`node scripts/analyze-gate-matrix.cjs <raw.log>`

## 一、矩阵

图例：`P`=PASS `F`=FAIL `B`=BLOCK `S`=SKIP `W`=WARN `N`=NOT_REACHED `-`=无该门禁记录

| 语言 | 模式 | G1 | G2 | G3 | G8 | G10 | G7 | G5 | G6 | G4 | G9 | G11 | G12 | G13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| shell | clean | P | S | S | P | S | S | S | S | S | S | S | P | S |
| shell | dirty | **F** | N | N | N | N | N | N | N | N | S | S | P | S |
| python | clean | P | P | P | P | P | S | S | N | N | S | S | P | S |
| python | dirty | **F** | N | N | N | N | N | N | N | N | S | S | P | S |
| go | clean | P | P | P | P | P | S | S | N | N | S | S | P | P |
| go | dirty | N | N | N | N | N | N | N | N | N | N | S | P | **B** |
| typescript | clean | P | S | S | P | P | S | P | S | P | P | S | P | S |
| typescript | dirty | N | N | N | N | N | N | N | N | N | **B** | S | P | - |
| cpp | clean | P | P | P | P | P | S | S | N | N | S | S | P | P |
| cpp | dirty | N | N | N | N | N | N | N | N | N | N | S | P | **F** |
| flutter | clean | **W** | P | P | P | S | S | S | N | N | S | S | P | P |
| flutter | dirty | N | N | N | N | N | N | N | N | N | N | S | P | **B** |
| iac | clean | P | P | S | P | S | P | S | S | S | S | S | P | S |
| iac | dirty | **B** | N | N | N | N | N | N | N | N | S | S | P | S |
| java | clean | P | P | P | P | P | S | S | N | N | **P** | S | P | W |
| java | dirty | N | N | N | N | N | N | N | N | N | N | S | P | **F** |
| kotlin | clean | P | P | P | P | S | S | S | N | N | S | S | P | P |
| kotlin | dirty | N | N | N | N | N | N | N | N | N | N | S | P | **B** |
| dart | clean | P | P | P | P | S | S | S | N | N | S | S | P | P |
| dart | dirty | N | N | N | N | N | N | N | N | N | N | S | P | **B** |
| csharp | clean | P | P | P | P | P | S | S | N | N | S | S | P | P |
| csharp | dirty | N | N | N | N | N | N | N | N | N | N | S | P | **F** |

## 二、结论

### 1. 十一种语言，零假阳性

**每一种语言的 clean 用例都没有被拦。** 这是本轮最主要的成果：
上一轮 `swift` 干净仓库被 Gate 1 判为「code quality violations」而阻断，
`iac` 干净仓库被 Terraform provider 网络依赖阻断——都是假阳性。

### 2. 十一种语言，零漏检

**每一种语言的 dirty 用例都被某个门禁拦住了。** 拦截者符合该语言的
缺陷归属：

| 缺陷类型 | 拦截门禁 | 语言 |
|---|---|---|
| 密钥硬编码 | G1 | shell, python, iac |
| 类型/编译错误 | G13 | go, cpp, flutter, java, kotlin, dart, csharp |
| 危险 API | G9 | typescript |

### 3. `NOT_REACHED` 是这张表最重要的信息

dirty 行里大量的 `N` 不是"门禁失效"，而是**链在第一个阻断门禁处停下了**。
这正是本轮修的那个报告缺陷：修复前它们全部显示为 `S`（SKIP），
读起来像「门禁运行了但决定跳过」，进而让分析器报出
「植入缺陷没被抓到」的假结论。

**`N` 与 `S` 的区别，就是「没机会检查」与「检查了但放过」的区别。**

### 4. 唯一的分析器提示不是缺陷

```
[门禁不可达] iac 的负责门禁根本没有运行 — G7=NOT_REACHED
```

`iac` 的植入缺陷归 G7（IaC 安全）管，但 G1 先发现了密钥并阻断，
G7 根本没运行。**这是正确行为**，不是漏检。分析器如实报告"门禁不可达"
而非"漏检"，正是本轮修复的结果。

## 三、覆盖缺口（如实记录，不掩饰）

| 语言 | 缺口 |
|---|---|
| typescript | G13 无记录（G9 先阻断），类型检查未被验证 |
| shell / python | G13 无记录，无类型检查（这两种语言本身无编译期类型检查） |

`typescript` 的 `G13=-` 意味着**类型错误的 TS 代码是否会被拦截，本轮没有证据**。
下一轮应调整植入缺陷位置（把类型错误放在 G9 之前能发现的位置之后），
或单独用 `XP_GATE_ONLY_GATE` 验证 G13 对 TS 的行为。

## 四、未覆盖的语言

15 个 adapter 中，本矩阵覆盖 **11 个**：cpp csharp dart flutter go iac java
kotlin python shell typescript。

**未覆盖 4 个**：

| 语言 | 原因 |
|---|---|
| php | ✅ 已验证：clean 提交成功；无覆盖率报告时 Gate 5 正确 BLOCK 并记录原因 |
| powershell | ✅ 已验证：clean 提交成功；植入 AWS key 被 Gate 8 BLOCKED |
| swift | 本机无 `swift`/`swiftlint`，无法验证真实行为 |
| objectivec | 本机无 Objective-C 运行时（Windows） |

**"没测"不等于"通过"。** 这四种语言的有效性目前**没有证据**，
不应计入上面的"零假阳性/零漏检"结论。

## 五、复现

```bash
# 单种语言
bash scripts/probe-gate-matrix.sh java

# 多种语言（注意：并发会显著拉长单例耗时，不要据此判断性能）
bash scripts/probe-gate-matrix.sh shell python go typescript cpp

# 汇总
node scripts/analyze-gate-matrix.cjs <raw.log>
```

`XP_GATE_ONLY_GATE` 在受保护分支（`master`/`main`）上会被拒绝，
所以探针必须用 `git init -b probe<name>` 的临时仓库——脚本已经这样做了。

## 六、这一轮探针本身的六处缺陷（都会伪造结论）

矩阵工具自己也曾产出假结论，全部已修：

| 缺陷 | 后果 |
|---|---|
| 没有 `.gitignore` | `obj/`、`bin/` 等构建残留被当成提交内容 |
| 缺 `.architecture-skip` | Gate 6 对 fixture 报架构违规（假阳性） |
| flutter fixture 缺 `dev_dependencies` | `flutter test` 无测试可跑，G13 假阻断 |
| flutter fixture `import package:flutter/material.dart` | 需要网络 `pub get`，G13 报 `uri_does_not_exist` |
| iac fixture 用了 AWS provider | `terraform validate` 需联网拉 provider，G1 假阻断 |
| `/tmp` 路径在 MSYS 与 node 中解析不同 | 报告写到看不见的地方 |

**测量工具的缺陷和产品缺陷长得一模一样。** 上面六处全部是先被当成产品缺陷
排查、最后才发现是探针的问题。
