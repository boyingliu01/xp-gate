# C# 接入复盘与新语言接入清单（PHP 前置）

**日期**：2026-11-19
**复盘对象**：xp-gate 的 C#/.NET 支持（#717 / #730 / #763 / #768 / #776 / #780 / #783 / #798 / #806）
及其在消费项目 `dsh-aot-runner` 中的实际落地过程
**目的**：把一个真实项目的接入经验，转成「下一门语言一次做对」的检查清单

---

## 0. 一句话结论

C# 的支持**功能上是完整的**——13 个可检查面的接线最终都补齐了（实测 12 ✅ / 0 ❌ / 1 ⬜）。
但它是**分 5 波、跨 16 天、在项目侧用 400+ 行定制门禁兜了 6 天后**才补完整的，
而且直到今天仍有两处**声明与实际不符**（README 语言表、Gate 9）。

问题不在「漏了某个文件」，而在于**没有任何东西能回答「这门语言接全了吗」**。
每个 gate 面各自维护一份手写扩展名正则（现存 11 处不同口径），
每漏一处都表现为 `✅ PASSED` 而不是报错。所以「第一轮做不完整」是结构性的，
不是这一次的疏忽。

**本文附带一个已落地的检查工具** `xp-gate language-capability`（§6.1），
它从代码派生每门语言 × 每个门禁面的接线状态。第一次跑就找出 3 个此前无人知道的缺口
（Objective-C 未登记、Dart 无复杂度检查、shell/powershell/iac 无 principles 引擎）。
PHP 接入时，**它的输出就是「做完了没有」的验收标准**。

其中两个缺口已在本轮修复并各自留下 issue 与反向对照测试（#846 / #847），
修复过程又暴露出两个更深的缺陷：**Gate 3 的基线人口过滤器对所有语言都是坏的**
（读错 CSV 列，ratchet 全程失效，随 #847 一并修好），以及
**`ccn-report --csv-verified` 对非 JS/TS 语言会重算出错误的 CCN**
（Dart 实测 14→1，已开 #848；**本文写作时未修，后于 §9.2 修好**）。后者的教训写成了 §3 的 L9：
**「测试变绿」不等于「检查真的发生了」**。

**PHP 接入的实际工作量，一半以上不是写 PHP 工具链，而是先把这 11 处口径和 6 个语言知识面收敛成一份声明。**

---

## 1. 时间线：五波修复与项目侧的兜底

### 1.1 xp-gate 侧（5 波，跨 16 天）

| 日期 | 提交 | 修的是什么 | 属于哪一类 |
|---|---|---|---|
| 11-04 | `e8a2fe81` | 补 `adapters/csharp.sh`；`.cs` 加入 Gate 3/4 过滤器 | **第 1 轮**：文件过滤器 |
| 11-04 | `a09aa6cf` | Gate 4 principles adapter、Gate 6 csharp 架构分支 | **第 1 轮**：语言分支 |
| 11-06 | `a3f643d9` | `LANGUAGE_REGISTRY` 补 csharp（#730） | **漏洞 1**：CLI 链路 |
| 11-06 | `b7caee2b` | Gate 1 通用 adapter 分支加 verdict 协议（#776） | **漏洞 2**：verdict 协议 |
| 11-09 | `02cadb3c` | `runsettings` + 取最新 cobertura 报告（#768 / #760） | **漏洞 3**：工具调用契约 |
| 11-09 | `5d7e52cb` | `.sln` 与 `.csproj` 同层时指明 workspace 文件（#783） | **漏洞 4**：工具调用契约 |
| 11-08 / 11-12 | `1b0cd4a9` / `d84c5563` | Gate 13 注入严格度参数；`.cs` 视为源码而非文档（#798） | **漏洞 5**：另一条检测链 |
| 11-16 / 11-18 | `b78e60f2` / `b0719d86` | 「没检查」被记成「通过」的五处；Gate 13 五个静默跳过 | **漏洞 6**：verdict 记账 |

### 1.2 项目侧（dsh-aot-runner）在没等到上游前自己补的

`docs/质量门禁现状审计-2026-11-10.md` 与 `.githooks/*` 记录了这些：

| 项目侧加的 | 上游对应的缺口 |
|---|---|
| `pre-commit` 第 1 段：`dotnet format --verify-no-changes` 阻断 | Gate 1 当时对 C# 是 fail-open |
| 第 0 段：改动集合短路（27/30 提交不碰 C#，省 11 s） | 上游当时没有按输入短路 |
| 第 1.5 段：契约指纹漂移检测 | 项目特有，合理 |
| `pre-push` 转发器（`8842431`） | `core.hooksPath` 与 `init` 装的位置冲突 |
| `pre-push` 补 C# 编译检查（`1ca6559`） | pre-push **从未跑过任何有效检查** |
| `tools/cast-audit/`（Roslyn 语义分析） | C# 编译器对显式数值强转**零告警** |
| `build.sh --check` 的自建链路 | Gate 5 / Gate 8 被上游缺陷永久阻断 |

**这 7 项里只有 1 项（契约指纹）是真的项目特有。其余 6 项都是上游缺口，被项目侧以更高成本补了一遍。**

### 1.3 代价（可量化的部分）

- 项目侧定制门禁：`.githooks/pre-commit` + `.githooks/pre-push` + `build.sh` ≈ **400+ 行 sh**
- 从 C# 第 1 轮（11-04）到项目能用上完整门禁（11-10 审计）：**6 天**
- 上游侧遗留的**声明不符**（截至今日，见 §4）：**2 处**

---

## 2. 根因：11 处手写扩展名口径 + 6 个语言知识面

### 2.1 扩展名口径：同一门语言的「源码是什么」被抄了 11 遍

实测清点（`grep` 全仓，排除 `__tests__`）：

| # | 位置 | 现内容 | `.cs` 在位 | `.php` 在位 |
|---|---|---|---|---|
| 1 | `gate-0-entry.sh:69`（Gate 1 输入判定） | ts tsx js jsx py go java kt cpp c swift m mm dart sh ps1 psm1 **cs** csx fs vb rs php rb lua pl | ✅ | ✅ |
| 2 | `gate-0-entry.sh` `_detect_ext_lang` 系列 | 逐条 if 分支 | ✅ | ❌ |
| 3 | `gate-0-entry.sh:396` 注释要求与 Gate 5 保持一致 | — | 注释 | 注释 |
| 4 | `gate-5-entry.sh:683` `CODE_EXTENSIONS` | ts tsx js jsx mjs cjs py go java kt kts **cs** csx cpp cc cxx c h hpp swift m mm dart sh ps1 | ✅ | ❌ |
| 5 | `gate-2-entry.sh:242` `SOURCE_FILES` | ts tsx js jsx py go java scala kt cpp c h rs **php** dart swift **cs** csx fs vb | ✅ | ✅ |
| 6 | `gate-4.sh:79` principles 人口 | ts tsx js jsx py go java kt dart swift cpp c hpp h m mm **cs** | ✅ | ❌ |
| 7 | `gate-3.sh` lizard 人口 | ts tsx js jsx py go java swift cpp c hpp h m mm kt **cs** | ✅ | ❌ |
| 8 | `gate-6-entry.sh` 架构短路 | ts tsx js jsx mjs cjs py go java kt kts rs cpp cc cxx c h hpp swift dart **cs** csx fs vb | ✅ | ❌ |
| 9 | `gate-10-entry.sh:46` / `gate-10.sh:251` | ts tsx js jsx py go java kt cpp c swift m dart sh ps1 psm1 **cs** csx fs vb rs **php** rb lua pl | ✅ | ✅（但规则集不含 `p/php`，见 C4） |
| 10 | `lib/docs-only.sh:29` | ts tsx js jsx mjs cjs py go java kt kts swift cpp cc c h hpp m mm rs rb **php** **cs** dart sh bash ps1 psm1 | ✅ | ✅ |
| 11 | `src/gates/common.ts:194` `LIZARD_EXTENSIONS` | ts tsx js jsx py go java swift cpp c hpp h m mm kt **cs** | ✅ | ❌ |

**这是 11 处，不是 1 处，而且它们的集合互不相等。** 判据很明显：
`gate-3.sh` 没有 `cxx/cc/hpp`，`gate-4.sh` 没有 `kts`，`gate-2-entry.sh` 有 `scala`，
`gate-0-entry.sh` 有 `fs/vb/rs/php/rb/lua/pl`，`gate-5-entry.sh` 有 `mjs/cjs`。

任何一处漏写，症状都是**该门禁读到空列表 → 走「无匹配文件」分支 → 打印 `✅ PASSED`
或 `⏭️ SKIPPED`**，与「检查通过」在日志里几乎不可区分。

`gate-0-entry.sh:396` 那条注释（「保持与 gate-5-entry.sh 的 CODE_EXTENSIONS 一致」）
是这套结构的自我承认：**作者知道两份会漂，于是用注释维系，而不是用代码。**

### 2.2 六个语言知识面：每门语言要在 6 个地方各写一遍

| 面 | 文件 | 加一门语言要写什么 | C# 在哪里踩过 |
|---|---|---|---|
| A | `githooks/adapters/<lang>.sh` | 4 个函数：`run_static_analysis` / `run_lint` / `run_tests` / `run_coverage` + 可选声明（`coverage_runs_tests`、`tests_delegated_to_ci`） | #776 之前返回 1 只打印不阻断 |
| B | `src/principles/adapters/<lang>.ts` **+ `analyzer.ts` 的 `adapterMap`** | 词法级扫描器 + 类/函数提取 + **注册** | 只加文件不加注册 → `getAdapterForFile` 返回 `null`，Gate 4 收下文件再丢弃 |
| C | `gate-1-entry.sh` 的 verdict 分支 | 0/1/2/3 → PASS/BLOCK/BLOCK/WARN 映射 | 通用 `*)` 分支原本 fail-open（#776） |
| D | `gate-6-entry.sh` 的 `"<lang>")` 架构臂 | 架构工具的发现与 verdict | 落进 `*)` → 报「not configured for X」而根本不找配置文件 |
| E | `gate-13-compiler-strictness.sh` 的 `gate13_run_<lang>_analysis` **+ `gate-13-entry.sh` 里那次调用** | 严格编译参数 + 告警计数 + 基线 | 函数存在但没被调用 = 静默跳过（#717 §8 自己写的） |
| F | `GATE_REGISTRY_ROWS` / `XP_GATE_ORDER` / `gate-runner.js` `GATE_REGISTRY` | 5 个登记面 | 12b/12c 曾经「跑但不登记」，所以 `gate-list` 看不见它们 |

**A–E 五面里，有四面是「加了文件但没接线」就会静默失效的结构。**
C# 在 B（没注册）和 E（没调用）两面上都恰好踩中了。

### 2.3 第三条链路：CLI / doctor / init / CI

| 链路 | 文件 | C# 的教训 |
|---|---|---|
| `LANGUAGE_REGISTRY` | `src/npm-package/lib/language-tools.js` | 缺失 → `detect-languages` 生成的配置**没有 csharp**，而 hook 读配置后**不再回退扩展名嗅探** → C# 永不路由（#730）。这条是「生成的配置文件关掉了回退」——一个静默失效的放大装置 |
| CI 语言检测 | `.github/workflows/quality-gates.yml:66-130` | **独立复制了一份检测链**，C# 臂曾是后加的，且位置有讲究（要在 `.ps1`/`.sh` 之前）→ 本地过、CI 不看 |
| `arch.js` / `gate-runner.js` / `test-alignment.ts` | 三处**互不引用**的扩展名表 | `.php` 已在 `arch.js` 和 `gate-runner.js` 里，但没有任何门禁会真的检查 PHP |

### 2.4 一处结构性问题：fail-open 的默认方向

`gate-1-entry.sh` 的通用 `*)` 分支在 #776 之前是：

```bash
ADAPTER_FILE=$(resolve_adapter_path "$CURRENT_LANG")
if [ -n "$ADAPTER_FILE" ] && source ...; then
    run_static_analysis | head   # 只打印
    run_lint | head              # 只打印
    echo "⏭️ SKIPPED - (tools unavailable or failed)"
    # GATE_1_STATUS 保持 PASS
fi
```

于是 **C#、C++、ObjC、Swift、Kotlin、Go、Python、Dart、Flutter 九门语言全部 fail-open**，
只有 java 和 powershell 拿到了 #507/#547 挣来的 verdict 协议。
dsh-aot-runner 侧实测：`TreatWarningsAsErrors=true` 的项目里 `dotnet format` 明确失败，
Gate 1 依然 `PASS`——**门禁比它所代表的编译器更松**。

---

## 3. 复盘出的 9 个结构性教训

> 每条都对应上面一个真实的失效，PHP 接入时逐条对照。

### L1 —— 「文件过滤器」不是「支持」
`.cs` 进了 `gate-4.sh:79` 的过滤正则，设计文档就写了「Gate 4 covered」。
实际 `getAdapterForFile('A.cs') → null`：文件被收下，然后被丢弃，门禁仍然打印「正在检查」。
**过滤器只证明「输入被接受」，不证明「有任何东西处理了它」。**
新语言必须验证到**输出侧**：给一个已知违规的 fixture，确认它被报出来。

### L2 —— 「函数存在」≠「函数被调用」
`gate13_run_csharp_analysis()` 写完当时没人调用（#717 §8 自己记录）。
同理，12b/12c 跑在 `XP_GATE_ORDER` 里但从没进 `GATE_REGISTRY_ROWS`。
**接入图上每一条边都要有一次「故意破坏」验证**：把实现改坏，门禁必须变红。

### L3 —— 单语言检测链会被混合仓库遮蔽
`detect_project_lang()` 是排他首匹配（`.sh` 先于 `.cs`），
dsh-aot-runner（2031 行 C# + ~900 行 JS）被判成 `typescript`。
修复方式是**把 C# 臂提到最前**——这只对 C# 成立（没有别的语言会带 `.csproj`）。
**PHP 没有独占的清单文件**（`composer.json` 可以被 JS 仓库的 composer 工具携带），
所以「提到最前」对 PHP 是错的。PHP 必须走扩展名侧，且必须在**短路判定**（面 1）里就正确，
而不是靠检测链的排序。

### L4 —— 「跑不起来」必须是第三种状态，且要能穿过每一层
`dotnet test` 的 testhost 启动失败在本机是常态（`Win32Exception(5)`）。
在 `runtime` 里返回 2 不够——上游两层会把它压成两种错的东西：
Gate 1 压成 `SKIPPED`（看着像通过），Gate 5 压成 `BLOCKED - Tests FAILED`（看着像代码坏了）。
**新语言的 verdict 协议要在适配器、gate 分支、report 三层都验一遍**，
而且要验「返回 2 时日志里出现的是不是 `NOT a test verdict` 这类明确措辞」。

### L5 —— 工具的调用契约必须先实测，再写适配器
三处踩坑全是「调用方式错了」而不是「工具不强」：

| 坑 | 症状 |
|---|---|
| `.sln` + `.csproj` 同层 → `dotnet format <dir>` 抛 `FileNotFoundException`，退出 1 | 与「1 处格式变更」的退出码相同 → 显式指明 workspace 文件 |
| 没有 `coverage.runsettings` → coverlet 默认 `IncludeTestAssembly=false`，产出 `line-rate="0"` + 空 `<packages/>` 的**合法**报告 | 「0% 覆盖率」看起来像真实结论 |
| `TestResults/<guid>/` 累积多份报告，`find \| head -1` 取到旧的那份 | 实际 67%，报告说 0% |

**共同形态：工具在错误调用下产出了格式合法、数值错误的结果。**
这比崩溃危险，因为没有任何一层能识别它。PHP 侧等价物见 §5。

### L6 —— 默认方向必须是保守侧，且「保守」是具体可验的
正确的默认（#794）：适配器不声明 `coverage_runs_tests()` 就**重跑**测试。
错的方向：不声明就当「不需要检查」。

反例（现状）：`gate-2-entry.sh` 的 `*)` 分支里，`SOURCE_FILES` 为空时
`echo "✅ PASSED - No source files detected for duplicate checking."`（**这是 PASS，不是 SKIP**）。
新语言一旦不在第 5 行的集合里，就会拿到一个**绿色的 PASS**。

### L7 —— 改动集合短路与「项目内容」判定的区别
`any_changed_files_match`（Gate 1）是「改动集合」判定 —— 短路的对象是**复选框本身**。
而 Gate 5 的 `TESTS_SKIPPED` 是一个**跨语言全局标志**（#760）：
typescript 臂「没改动」把 csharp 臂的真实结果冲掉了。

**短路必须按语言/按面独立，不能用一个全局标志代表「有没有东西要测」。**

### L8 —— 声明要能自动校验，不能靠注释维系
`gate-0-entry.sh:396` 那行注释、README 的语言表、`docs/CAPABILITIES.md` 的矩阵，
三者都是「声明」，三者都没有任何 CI 校验。

实测当前已经出现两处**活的**不符：

1. **README.md:328 仍写「12 种语言」，表里没有 C#**（C# 是第 13 种）。
2. **Gate 9（Build Integrity）对 C# 仍然 SKIP**——`docs/ARCHITECTURE.md:128`
   写的是「非 TS 项目 SKIP」，`docs/CAPABILITIES.md:164` 写的是「tsc + import 检查」。
   `gate-9-entry.sh` 里**只有两个臂：TypeScript 与 Java**（`:211` 判 docs-only，
   `:250` 附近判 TS，`:275` 附近判 `git diff --cached` 里的 `.java`），**没有任何 csharp 臂**。
   dsh-aot-runner 的审计文档把它记为「❌ 不适用」并自己补了 `build.sh --check`。
   **这不是「已支持的维度」，但对外表述里没有一处说它不支持。**

   > 注：PHP 接入时这里要一次补两个臂（C# 与 PHP），否则同一个缺口会被复制一遍。

`docs/CAPABILITIES.md` 里已经写下了正确的原则：

> 「配置模板」不等于「已阻断」：一道门的等级写在这里，就必须有下表「证据」列指向的实现或测试。

**但这条原则只被用于人工审阅，没有被机制执行。**

---

### L9 —— 「测试通过」可能只证明桩在工作（本次修 #847 时学到的，比 L1–L8 更尖锐）

修 Dart 时，我先改了扩展名正则，再跑测试——绿。**但真实门禁什么都没评分。**
两层原因叠加，且每一层都被一个绿色的测试掩盖着：

1. 测试 fixture 里的 `scripts/ccn-report.cjs` 是个
   `process.stdin.pipe(process.stdout)` 的**透传桩**。真实脚本会把 lizard CSV 的
   第 2 列（CCN）重写成校验值并把格式规范化；桩不做这件事，于是人口过滤器读到了
   一个「看起来像路径」的裸数字，测试却只断言了「不报 outside」，**恰好绕过**。
2. 更根本的是，人口过滤器本身读错了列（`$1` 是 NLOC，路径在第 7 列）。
   这个缺陷**对所有语言都成立**——实测 Python 同样被丢弃，ratchet 全程失效。

由此得到两条可执行的规则：

- **fixture 里的桩是一个宪法漏洞。** 桩与被替代物**行为不同**时，它测试的是桩。
  凡是被断言的输出由某个 helper 产生，fixture 必须用**真 helper**（本次改成
  `cp` 真 `ccn-report.cjs` + 真 `ccn-ratchet.sh`），或者把桩的契约写成测试单独钉住。
- **「新语言没接上」和「这个门早就坏了」的区分方法是：拿一门已支持的语言跑同一路径。**
  本次正是用 Python 跑同一个 fixture 才发现根因与 Dart 无关。**没有这条对照，
  就会去修 Dart，而把真正的缺陷留在一个更隐蔽的地方。**

> 这一条是 L1–L8 的自我指涉的加强版：L1 说「文件过滤器 ≠ 支持」，
> L9 说**「测试变绿 ≠ 检查发生」**，而且给出的是判定手法而不只是警告。


---

## 4. 当前遗留（接入「看起来完成」而实际未完成的部分）

> §9 已修的问题不留在本表里——按 `docs/AGENTS.md`，「标记为已解决的条目」
> 对下一个读者读起来仍然像还活着。本表只列**此刻仍然存在**的缺口。

| 项 | 状态 | 影响 |
|---|---|---|
| Gate 9 Build Integrity 无 C# 臂 | **未实现** | C# 项目的「构建可编译」只由 `dotnet build` 顺带覆盖（Gate 1 里），构建产物与 import 解析无人检查 |
| README 语言表缺 C# | **未更新** | 对外宣称 12 种语言，实际 hook 层覆盖 13 种 |
| `LANGUAGE_REGISTRY` 的 `tools` 只列 `dotnet` | 已知限制 | `check-tools` 不会提示缺 `coverlet.collector`（有注释解释为何如此，理由成立） |
| Gate 9 / Gate 11 在 C# 项目常年绿 | 显示问题 | 已是 `⏭️ SKIPPED`，但 `gate-coverage` 的汇总里仍可能被读成「已覆盖」 |
| pre-push 无 C# 臂 | 依赖 `core.hooksPath` 转发 | dsh-aot-runner 自己补了 `pre-push` 转发 + C# 编译检查 |

---

## 5. PHP 接入：一次性做对的检查清单

> 设计原则：**每一行都要能被验证为「故意破坏时会变红」**，
> 不能只写「已接入」。验证方式写在每行的「破」列。

### 5.1 工具链选型（先定，后写）

PHP 的质量工具生态与 C# 的关键差异：**没有官方单一入口**，`composer` 只管依赖，
`require-dev` 里的工具通过 `vendor/bin/` 暴露。这带来一个 C# 没有的问题——
**工具是否安装取决于项目是否 `composer install` 过 `require-dev`**。

| 面 | 选型 | 为什么 | 已知陷阱（→ L5） |
|---|---|---|---|
| 静态分析 / Lint | **PHP_CodeSniffer（`phpcs`）+ `php-cs-fixer`** | `phpcs` 是唯一同时做**风格 + 部分安全规则**的主流工具；`php-cs-fixer` 有 `--dry-run` 可直接映射 `--verify-no-changes` 的语义 | `phpcs --standard=<name>` 找不到 standard 时**退出码 3**，与「发现了违规」的 1/2 不同，必须分开映射（→ 等价于 C# 的 126/127 分支） |
| 静态类型分析 | **PHPStan**（首选，`--error-format=json`）或 Psalm | PHPStan 的 `analyse` 需要 `--level`；**未给 `--level` 时用 phpstan.neon 的配置，两者都没有则报错退出**，不是「用默认级别分析」 | `vendor/bin/phpstan` 不存在时 `command -v` 找不到，但 `./vendor/bin/phpstan` 是相对路径 —— 必须用 `vendor/bin/phpstan` 判定，且要处理 **Windows 上的 `phpstan.bat`** |
| 复杂度 | **lizard**（原生支持 PHP） | 与其它语言统一，无需自研 | `lizard` 对 `.php` 的 `<?php` 标签、`declare(strict_types=1);`、`use` 语句的处理需实测；**且要验 `namespace` + 类方法的 `Class::method@line` 命名格式是否与 `ccn-report.cjs` 的 span 校验兼容** |
| 重复代码 | jscpd（支持 php） | 已在 Gate 2 第 5 行的集合里，但 Gate 2 **不是**逐语言分支 | Gate 2 的 `*)` 分支在空列表时打印 **PASS 而非 SKIP**（→ L6） |
| 测试 | **PHPUnit**（`phpunit --log-junit`）或 Pest（构建在 PHPUnit 上） | `--testdox` 无关紧要，需要的是**机器可读的计数** | `phpunit` 在 `phpunit.xml` 缺失且无 `tests/` 时退出 **2** 并打印 "No tests executed!"；**不区分「0 个测试」和「测试套件坏了」** → 必须像 `_has_test_project()` 那样先做正向探针 |
| 覆盖率 | **PCOV**（快）或 **Xdebug**（慢，需 `xdebug.mode=coverage`） | PHPUnit 原生 `--coverage-clover` / `--coverage-cobertura` 产出 cobertura XML | 两者**都没装**时 PHPUnit 退出 **0** 且**不产出报告**（只有一条 warning）→ 与「覆盖率达标」不可区分 → 必须要求产物存在（→ L5） |
| 安全 SAST | 现有 **semgrep**（`p/php` 规则集可用） | Gate 10 已有 semgrep 臂 | 需确认 `p/php` 是否已加入 `gate10_resolve_ruleset` 的加载体 |
| 架构 | **deptrac**（层依赖） | 等价于 Java 的 ArchUnit / C# 的 NetArchTest，且是唯一主流选择 | deptrac 的配置是 `deptrac.yaml`；无配置文件时 `analyse` 退出 1 并打印 no config → 与「有分层违规」**同码** → 需先判配置存在性 |
| 依赖安全 | `composer audit --format=json` | 可进 Gate 8/10 的补充 | `composer` 不在 `PATH` 时（本机实测**未安装**）必须 SKIP 而非 BLOCK |

### 5.2 接入点清单（21 项，按依赖顺序）

> 每项的「破」= 故意破坏的验证方式，必须实测，不能推断。

#### 阶段 A —— 声明与检测（先做，否则后面全是空转）

| # | 接入点 | 具体文件 / 位置 | 验收 | 破 |
|---|---|---|---|---|
| A1 | 扩展名集合**收敛成单一来源** | 新增 `githooks/lib/language-extensions.sh`，导出 `xp_gate_source_exts <lang>` | 11 处引用它 | 删掉 `.php` → 11 处全部受影响 |
| A2 | `gate-0-entry.sh:69` 短路判定 | **已含 `php`**（实测：`xp-gate language-capability php` 报 ✅）—— 这一行只需回归验证，不需改动 | 只改 `.php` 的提交不跳过 Gate 1/2/12 | 暂存一个 `.php`，看是否打印「no changed code files」 |
| A3 | `_detect_ext_lang` 增加 php 臂 | `gate-0-entry.sh` | `PROJECT_LANGS` 含 `php` | 同上 |
| A4 | `LANGUAGE_REGISTRY`（**CLI 链路**） | `src/npm-package/lib/language-tools.js` | `xp-gate detect-languages` 输出含 `php`；`.xp-gate-config.json` 有 php 条目 | 删条目后重跑 → 配置里没有 php 而 hook 不再嗅探扩展名（#730 的原形） |
| A5 | CI 语言检测 | `.github/workflows/quality-gates.yml:66` | CI 判定为 php | **这条必须在 `.sh` 臂之前**（PHP 项目几乎都带 shell 脚本）——但**位置断言要写成测试**（AC-717-22 的先例） |
| A6 | `adapter-common.sh` `detect_project_lang()` | 加 `composer.json` 臂 —— **放在 `.sh` 之前、`tsconfig.json` 之后**（→ L3：PHP 不独占清单，不能提到最前） | 混合仓库（`composer.json` + `package.json`）报 php | 用 dsh-aot-runner 形状的 fixture：`.sh` + `tsconfig.json` + `composer.json` |
| A7 | `arch.js` / `gate-runner.js` / `test-alignment.ts` | 三处 `.php` 已在，**核对是否与 A1 一致** | 一致 | 抽掉其一 → 应从 import/`--all` 侧看出差异 |
| A8 | **`gate-3.sh` 有两份副本** | `githooks/gate-3.sh` 与 `githooks/adapters/gate-3.sh`（本次修 #847 时实测逐字节相同；生产 `GATE_DIR` 又指向 `~/.config/xp-gate/adapters/` 的第三份） | 两份改完后 `cmp` 返回 0 | **只改一份 → 测试变红**。本次就是这样被抓到的；若无测试则会「看起来落地了」而一半路径仍是旧逻辑（#717 同类事故） |
| A9 | **Gate 3 人口过滤器读第几列** | `githooks/{gate-3.sh,adapters/gate-3.sh}` 的人口循环：路径在 lizard `--csv` 的**第 7 列**（`csv_to_unit_separated` + `$7`），不是第 1 列 | 加 php 后，一个真实 `.php` 文件应被**评分**而不是打印「outside the baseline population」 | 用**已支持语言**（如 python）跑同一 fixture：若也报 outside，说明是列缺陷而不是新语言的锅 —— 本次正是这样定位的 |
| A10 | **`.ccn-baseline.json` `population.extensions` 要含 `.php`** | `.ccn-baseline.json` 的 `population`（writer 与 reader 必须同口径，否则存量代码被判「新增」→ 无法修复的假 BLOCK，#495 Round 3） | 声明后 `ccn_file_in_population` 对 `.php` 返回真 | 抽掉 `.php` → 文件被静默丢弃（这就是 #847 的第二半） |
| A11 | **verifier 是否支持该语言** | `scripts/ccn-report.cjs` `findDeclarationLine()` 目前只认 `function` / `const` / `let` / `var`（JS/TS 形） | 对 PHP 取一个真实热点函数，比较 `lizard --csv` 与 `--csv-verified` 的 CCN **必须一致** | 用 python（已知口径正确）做**阳性对照**：python 应 4→4。若 PHP 出现类似 #848 的 `14→1`，**先修 verifier 再接语言**，否则接进来的是错误数字 |

#### 阶段 B —— 门禁面（6 个知识面，B1–B6）

| # | 接入点 | 具体文件 | 验收 | 破 |
|---|---|---|---|---|
| B1 | **适配器** | `githooks/adapters/php.sh`：`run_static_analysis` / `run_lint` / `run_tests` / `run_coverage` + `coverage_runs_tests` 声明 | 4 个返回码 0/1/2 各有 e2e（在**临时目录**里跑真实 PHPUnit，不是本仓路径——dsh-aot-runner 的教训） | 让 `phpcs` 返回 3（standard 找不到）→ 必须是「工具不可用」而非「有违规」 |
| B2 | **Gate 1 分支** | `gate-1-entry.sh` —— **不加语言专属臂**，走通用 `*)` | 通用臂的 0/1/2/3 → PASS/BLOCK/BLOCK/WARN 映射对 php 生效 | 把 `run_static_analysis` 改成 `return 1` → 必须 **BLOCK**（#776 的原形：只打印不阻断） |
| B3 | **Gate 3 复杂度** | `gate-3.sh` 的 lizard 人口 | `lizard --csv -C 5 Probe.php` 确实产出 CCN 行 | 给一个 CCN 11 的函数 → 必须 BLOCK |
| B4 | **Gate 4 principles** | 新增 `src/principles/adapters/php.ts` **+ `analyzer.ts` 的 `adapterMap` 注册** | `getAdapterForFile('A.php')` 非 null；14 条规则返回结构化 metric（`paramCount` / `length` / `nestingDepth` / `hasTryCatch` / `methodCount`） | **删掉 `adapterMap` 那一行** → 文件仍被收下、检查数变 0（→ L1，这就是 C# 走过的坑） |
| B5 | **Gate 5 测试与覆盖率** | `gate-5-entry.sh`：`CODE_EXTENSIONS` 加 php；`run_coverage` 走通用臂 | `coverage.cobertura.xml` 或 clover XML 能被 Stage 2 解析 | 删掉 clover 产物 → 必须 BLOCK 而不是 PASS（#570 的原形） |
| B6 | **Gate 6 架构** | `gate-6-entry.sh` 加 `"php")` 臂，读 `deptrac.yaml` / `.xp-gate/arch-php.yaml` | 有配置时跑 deptrac 并用 `PIPESTATUS[0]` 取 verdict | 加一条跨层 `use` → 必须 BLOCK；无配置时 SKIP **且带 reason** |

#### 阶段 C —— 编译器严格度与其它门禁

| # | 接入点 | 具体文件 | 验收 | 破 |
|---|---|---|---|---|
| C1 | **Gate 13 PHP 臂** | `gate-13-compiler-strictness.sh` 加 `gate13_run_php_analysis()` **且必须在 `gate-13-entry.sh` 的 worst-of 归约里加一次调用** | PHP 没有编译期告警集，等价物是 **PHPStan 的最高 level**（level 9/max）。返回码 0/1/2/3 | **删掉 `gate-13-entry.sh` 里那一次调用** → 函数存在但永不执行（→ L2，C# 踩过） |
| C2 | **Gate 9 Build Integrity** | `gate-9-entry.sh` 加 php 臂：`composer validate --no-check-publish` + `php -l` 全量语法检查 | **这一次要把 C# 的遗留一起补上**（见 §4）。现行结构是「TS 臂 + 独立的 Java 臂」，PHP 臂必须与 Java 臂同形：判 `git diff --cached` 里有 `.php` 才跑，`GATE_9_PHP_STATUS` 单独记录 | 造语法错误 → 必须 BLOCK；无 `composer.json` → SKIP 带 reason；**删掉 `.php` 判定 → 只改 PHP 的提交必须 SKIP 而不是 PASS** |
| C3 | **Gate 2 重复代码** | `gate-2-entry.sh:242` 已有 `php`；修掉空列表时的 `✅ PASSED - No source files detected`（`:281`）→ `⏭️ SKIPPED` + reason | PASS 只在真跑过 jscpd 时出现 | 只暂存一个 `.php` 而 jscpd 不存在 → 必须是 SKIP 不是 PASS |
| C4 | **Gate 10 SAST** | `gate10_resolve_ruleset` 增加 `p/php`（当 `SEMGREP_FILES` 含 `.php` 时额外加载，**照 `p/csharp` 那 3 行现成写法**，`gate-10.sh:366-370`） | 一个已知 PHP 注入 fixture 被报出 | 去掉 `p/php` → 该 fixture 通过（这是「没检查」而非「干净」）。**这是 #717 在 C# 上踩过的原形，`.cs` 一直在过滤器里，规则集却看不见 C#** |
| C5 | **Gate 7 IaC** | `composer.json` / `Dockerfile` 无关，确认不误判 | — | — |
| C6 | **pre-push** | `githooks/pre-push` 的语言分支 | php 项目 push 时跑 PHPUnit 或 PHPStan | 推送纯 `.php` 提交 → 不得被判为「documentation-only push」 |

#### 阶段 D —— 声明与文档（收尾，但**不能省**）

| # | 项 | 文件 | 验收 |
|---|---|---|---|
| D1 | README 语言表 | `README.md:326-346` | 加入 C# 与 PHP；「12 种」改为实际数 |
| D2 | `docs/CAPABILITIES.md` 矩阵 | §3 Language Support Matrix | 每门语言的每一格都指向实现或测试；Gate 9 的 C# 一格如实写「未实现」或补上 |
| D3 | 能力边界矩阵 | 新增 `docs/plans/<date>-php-capability-matrix.md`，格式照抄 #717 §4 | 6 个 Gate 面 × 「covered / partial / not implemented」+ 各自的证据行 |
| D4 | **阻断矩阵** | 同文档 §9 格式 | 逐 gate 回答「能不能拦住一次 PHP 提交」与机制；**「covered」≠「can block」** |
| D5 | **接入完整性自检** | `xp-gate language-capability php` | 输出里 ❌ 为 0；每个 ⬜ 都在 D3 的矩阵里有一行说明。**这是本清单的验收命令**，也是 C# 复盘最可复用的一条产出 |
| D6 | 模板 | `.github/ISSUE_TEMPLATE/language-onboarding.md` | 每个语言接入开一条 issue，清单就是 §5.2；关掉的条件是 D5 全绿 |

---

## 6. 落地的改进：把「接全了吗」做成可执行的检查

C# 的教训里最可复用的一条是：**所有失效都是「看不见」而不是「报错」**。
所以最高杠杆的改进不是再补一处遗漏，而是让遗漏本身可见。

### 6.1 已落地：`xp-gate language-capability`

> 实现：`src/npm-package/lib/language-capability.js`（+ 14 项测试，
> `src/npm-package/lib/__tests__/language-capability.test.js`）
> 命令：`xp-gate language-capability [<lang>...] [--json]`
> 退出码：任一接入面为「未接线」→ 1；只有「已声明不实现」→ 0；语言名未知 → 2

测试里有一条**正向对照**已经实测过：把 Gate 13 的「已定义但未被调用」判定改坏，
对应测试立刻变红（14 项中 1 项失败），恢复后回到全绿 —— 即「测试通过」这件事本身
是被验证过的，而不是仅仅被陈述。

本次两个修复也各自做了反向对照，记录实测结果（不是「相信会红」）：

| 故意破坏 | 结果 |
|---|---|
| 从 `LANGUAGE_REGISTRY` 删掉 `objectivec` 条目 | `language-tools-detect` 3 项变红；恢复后 19/19 全绿 |
| **只**回退人口过滤器的列修复（保留 `dart` 正则） | gate-3 三条 #847 测试**全部**变红 —— 证明真正卡住 Dart 的是列缺陷，而不是扩展名正则 |
| 同时回退列修复**和** `dart` 正则 | 同样三条红（与只有列修复回退时一致：扩展名正则那半边是必要的但不充分） |

它**不维护第二份语言清单**，而是读门禁自己读的那些文件，用项目的三态词汇报告：

| 状态 | 含义 |
|---|---|
| ✅ `checked` | 该面会真正评估这门语言 |
| ❌ `not-wired` | 接入面存在、支持别的语言，但**这门语言不在里面** —— 一行就能修，属于「有人忘了」 |
| ⬜ `not-implemented` | 该面**根本没有这条臂** —— 需要声明或立项 |
| ❔ `unknown` | 无法判定（文件读不到 / 依据的外部产物未实测）——**绝不猜** |

区分 `not-wired` 与 `not-implemented` 是这个工具的核心：
前者是 bug，后者是决定，两者责任方不同，合并起来就等于重新制造「没检查」和「通过了」看起来一样的问题。

#### 实测输出（落地后第一次跑，全部 14 门语言 —— 这是修复前的快照）

留存这份快照是为了说明**工具当场就抓到了真问题**：`php` 只有 2/13 面接通、
`objectivec` 与 `dart` 各有一条 `not-wired`，而这两条随后都被确认是真缺陷（见 §6.2）。

```
lang         checked notWired notImpl unknown
typescript        11        0       2       0
python            11        0       2       0
go                11        0       2       0
java              13        0       0       0
kotlin            10        0       3       0
csharp            12        0       1       0
cpp               11        0       2       0
swift              9        0       3       1
objectivec         7        2       3       1
dart               8        1       3       1
php                2        6       4       1
shell              7        3       3       0
powershell         8        2       2       1
iac                2        7       3       1
```

**C# 那一行（12 ✅ / 0 ❌ / 1 ⬜）验证了这个工具与 §4 的人工审计完全一致**：
唯一未实现的面正是 Gate 9，其余全部接线。

#### 修复后的同一张表（本次两个 issue 修完之后）

```
lang         checked notWired notImpl unknown
objectivec         8        1       3       1     ← 曾 7/2（#846 修好 CLI 登记）
dart               9        0       3       1     ← 曾 8/1（#847 修好 Gate 3）
```

`dart` 的 `not-wired` 归零，`objectivec` 从 2 降到 1（剩下的那条是 CI 检测链，
见 §4/C3 的同类问题，未在本次范围内）。其余语言不受影响 —— 这正是
「按接入面报告」而不是「按语言报告一个总数」的价值：改动的影响面是**可核对**的。

#### 立刻用它跑出了 3 个此前无人知道的真实缺口

这些**不在**本次复盘的目标范围内，是工具本身的第一次收益：

| 语言 | 接入面 | 缺口 | 独立核实 | 结局 |
|---|---|---|---|---|
| **Objective-C** | `LANGUAGE_REGISTRY` | 从未登记 → `detect-languages` 生成的配置里没有它 → 与 #730 的 C# **完全同构** | `grep -c objectivec src/npm-package/lib/language-tools.js` → **0** | ✅ **已修**（#846） |
| **Dart** | Gate 3 复杂度 | 不在 lizard 人口里 → **Dart 的圈复杂度从未被检查过**，而 README 宣称「所有编程语言统一使用 lizard」 | `grep -c dart githooks/adapters/gate-3.sh` → **0** | ✅ **已修**（#847），但下方「连带发现」说明它只修好了第一层 |
| **shell / powershell / iac** | Gate 4 principles | 三个都没有 analyzer，属于**已声明的范围限制**（`analyzer.ts` 里没有任何对应适配器），已用测试钉住，防止有人只加一半 | `grep shell src/principles/analyzer.ts` → 无适配器 | ⬜ 按设计保留（测试已钉住） |

前两条已各开 issue 并修复。修复过程中又暴露出两层更深的缺陷，见下。

##### 连带发现 1：Gate 3 的「基线人口」过滤器对所有语言都是坏的（已修，随 #847）

修 Dart 时按 §5.2 A6 的要求去跑**真实门禁**而不是只改正则，发现改完仍不生效。
根因在 `githooks/adapters/gate-3.sh` 的人口过滤循环：

```bash
_cc_row_path=$(printf '%s' "$_cc_row" | awk -F, '{print $1}')   # ← 读的是 NLOC 列
```

lizard `--csv` 的列序是 `0 NLOC | 1 CCN | ... | 5 "name@start-end@path" | 6 path | ...`，
路径在第 **7** 列。于是递给 `ccn_file_in_population` 的「路径」永远是一个裸数字，
没有任何数字能匹配声明的 root 或 extension，**每一行都被判成「不在人口里」并丢弃**，
门禁什么都不评分，然后落到 `UNVERIFIED no parsable CCN row` 照样 PASS。

这条**与 Dart 无关**：实测 Python 同样被丢弃。也就是说 ratchet 对**所有语言**都处于
失效状态，而所有测试都是绿的——因为测试里的 `ccn-report.cjs` 是个
`process.stdin.pipe(process.stdout)` 桩，桩不做列重写，正好掩盖了它。

已修（改为引用共享的 `csv_to_unit_separated` 取第 7 列，引号安全），并补了两条测试：
一条断言「已支持的语言必须真的被评分」，一条断言「真的在人口外时必须报出**文件名**而不是数字」。

##### 连带发现 2：`--csv-verified` 对 Dart 重算出错误 CCN（#848，**后已修，见 §9.2**）

人口修好后 Dart 终于被评分，但拿到的数字是错的：

```
lizard --csv   → 17,14,122,...     (CCN 14)
--csv-verified → 17,1,122,...      (CCN 1)
```

`findDeclarationLine()` 只认 `function` / `const` / `let` / `var` 四种 JS/TS 声明形式，
Dart 的 `int grade(...)` 一个都不匹配，于是回退到错误的大括号配平切片。
Python 不受影响（实测 4 → 4），**所以这个缺陷一直藏在 TS 自测的盲区里**。

**这一条只记录、不修**：它属于另一个缺陷类别（verifier 的语言覆盖），
且方向是**低估**——CCN 从 14 变 1 会让真实热点永远拦不住，需要先按语言逐一量测
才能确定修法。已开 #848。

##### 连带发现 3：`gate-3.sh` 有一份**读者不会想到的孪生副本**（已修）

仓库里同时存在 `githooks/gate-3.sh` 和 `githooks/adapters/gate-3.sh`，且**逐字节相同**
（md5 `1d4e07cc...`）。测试 source 的是 `adapters/` 那份，而本地开发路径用的是
`githooks/` 那份；`GATE_DIR` 在生产机上又解析到
`~/.config/xp-gate/adapters/`（第三份拷贝）。

我把修复只写进了 `adapters/`，测试因此红了——这是**运气好**：红的测试把它抓了出来。
若当时没有这条测试，改动会「看起来落地了」而实际有一半路径仍是旧逻辑。
这正是 `gate-registry.sh` 顶部记录的 #717 同类事故（SAST 修复写进了不执行的 `gate-9.sh`）。

处理：两份文件同步为逐字节相同，并在 `CC_FILES` 上方写明**本文件有孪生副本、改动必须两份都落**。


### 6.2 结构性（中等成本、消除 11 处漂移）

- **A1 的扩展名单一来源**：一个 `language-extensions.sh`（或一个 JSON），
  11 处全部引用。这消掉的是「同一事实抄 11 遍」这个缺陷**类别**，
  而不只是本次的 `.php`。
- **`gate-2-entry.sh` 的 `✅ PASSED - No source files detected`** 改为 SKIP + reason。
  这是一个**为了让新增语言不至于拿到绿色 PASS** 的具体小修，改动一行。
- **`docs-only.sh` 的扩展名表**要与 A1 对齐 —— C# 曾在这里被当成「文档」，
  导致只改 `.cs` 的提交被判为 documentation-only（#798）。

### 6.3 流程（低成本）

把 §5.2 的 21 项做成 issue 模板的一个 checklist
（`.github/ISSUE_TEMPLATE/language-onboarding.md`），
每个语言接入开一条 issue，**关掉它需要 D5 的派生输出全绿**。
C# 的复盘结论是「没有人能回答接全了吗」，模板至少让这个问题有一个归属。

---

## 7. PHP 特有的、不能照抄 C# 的地方

| C# 的做法 | 为什么 PHP 不能照抄 |
|---|---|
| 把清单检测臂提到检测链最前 | `composer.json` **不独占**（JS 项目也可能有 composer 工具链）；PHP 必须靠扩展名侧正确，而不是靠排序 |
| 用 `dotnet` 一个入口驱动全部工具 | PHP 有 4 个独立工具（phpcs / phpstan / phpunit / deptrac），**每个都要单独处理「不在 `vendor/bin` 里」** |
| 用 `.runsettings` 决定覆盖率口径 | PHPUnit 的口径在 `phpunit.xml` 的 `<source>` / `<coverage>`；**旧版 `whitelist` 与新版 `source` 并存**，两者都要认 |
| 覆盖率产物固定是 cobertura | PHPUnit 可出 clover（XML）/ cobertura / text；**Gate 5 Stage 2 现在只解析 cobertura 与 `coverage-summary.json`**，若选 clover 必须加解析臂（否则重演 #768：报告合法、格式不认、判「无法确定」） |

---

## 8. 附：本文引用的证据位置

| 结论 | 证据 |
|---|---|
| 11 处扩展名口径 | §2.1 表格（`grep` 可得，命令：`grep -rn "\.\(ts|tsx" githooks/`） |
| 两个真实的生产缺陷由新测试抓出 | dsh-aot-runner `docs/XP-GATE-BASELINE.md` §3.5（`SafeJobHandle.IsEmpty()` 恒 false） |
| 项目侧自定义门禁 420 行 | dsh-aot-runner `.githooks/pre-commit`、`.githooks/pre-push`、`build.sh` |
| Gate 1 fail-open 的真实后果 | xp-gate `gate-1-entry.sh` `*)` 分支注释引用的实测（net8.0 + `TreatWarningsAsErrors=true`） |
| 「过滤器 ≠ 覆盖」 | C# 设计文档 §12（本文引用其「Correction to an earlier claim」） |
| 「函数存在但没被调用」 | C# 设计文档 §8（Gate 13 那一段自述） |
| `dotnet format` 三处调用契约坑 | `githooks/adapters/csharp.sh` 头部与 `_workspace_arg` 注释 |
| Gate 9 无 C# 臂 | `githooks/gate-entries/gate-9-entry.sh`（grep 无 `csharp`） |
| README 语言表缺 C# | `README.md:328-346` |
| Objective-C 未登记（已修 #846） | `src/npm-package/lib/language-tools.js` `LANGUAGE_REGISTRY`；修复前 `grep -c objectivec` → 0 |
| Dart 不在 Gate 3 人口（已修 #847） | `githooks/{gate-3.sh,adapters/gate-3.sh}` 的 `CC_FILES` 正则；修复前 `grep -c '|dart)'` → 0 |
| Gate 3 人口过滤器读错列（已修） | `githooks/{gate-3.sh,adapters/gate-3.sh}` 人口循环；修复前 `awk -F, '{print $1}'` 读到 NLOC 列。实测 Python 同样被丢弃 |
| `--csv-verified` 重算错误 CCN（#848，**已修**） | 根因不在 `findDeclarationLine()` 的语言词表，而在 `verifyCcnForRow()` 把 `findFunctionBody()` 返回的 `[start,end]` **下标对**当成**行数组**交给 `classifyUnverifiedRow()`；`ccnOfBody` 遍历两个数字，匹配不到任何分支，于是落回初值 `1`。实测：Go 8→1、Dart 8→1；Python/C#/Java 只因先被 `verifyRowCcn` 修正才侥幸正确。修复后五种语言全部 8→8 |
| `gate-3.sh` 双副本 | `md5sum githooks/gate-3.sh githooks/adapters/gate-3.sh`（修复前两者同为 `1d4e07cc...`，现在同步） |

---

## 9. 2026-11-19 落地结果（全部有命令输出）

本节记的是**这次实际做了什么、拿什么证明**。与 §5 的清单对应，便于下次接入新语言时直接复用。

### 9.1 目标 A：先回答「Dart 到底支不支持」

**结论：不支持。** `language-capability dart` 显示 9/13，但那是**假绿**：

| 面 | 报告值 | 真实情况 |
|---|---|---|
| Gate 3 | ✅ | 假绿。`.ccn-baseline.json` 的 `population.extensions` 不含 `.dart`，真实 Dart 项目里文件被**静默丢弃** |
| CCN 数值 | — | `--csv-verified` 把 CCN 14 算成 1（#848） |

调查中发现一个关键的**结构性事实**，它改变了修复方向：

> `population.extensions` 不是手写清单，而是 `scripts/ccn-report.cjs` 的
> `baselinePopulation()` **从实际扫描到的文件推导**出来的。
> 所以「往 xp-gate 仓库的 `.ccn-baseline.json` 里加 `.dart`」是**错的**——
> 本仓库没有 Dart 代码，加了等于宣称有。正确做法是让**写入器**能扫到 `.dart`。

实测：在一个真含 Dart 文件的临时仓库里跑 `--write-baseline`，得到
`extensions: [".cjs", ".dart"]`、条目 `lib/complex.dart::grade`，
`ccn_file_in_population` 判为 GRADED。**写入器本来就是对的语言。**

### 9.2 目标 A 的真正缺陷：#848 跨语言

`--csv-verified` 在五种语言上的实测（同一复杂度、同一形状）：

| 语言 | lizard CCN | `--csv-verified` CCN | 判定 |
|---|---|---|---|
| Go | 8 | **1** | ❌ |
| Dart | 8 | **1** | ❌ |
| Python | 8 | 8 | ✅（先被 `verifyRowCcn` 修正，未走 rescue） |
| Java | 8 | 8 | ✅（同上） |
| C# | 8 | 8 | ✅（同上） |

根因：`verifyCcnForRow()` 里

```
const body = findFunctionBody(slice, name);   // 返回 [start, end] 下标对
classifyUnverifiedRow({ body, ... })          // 期望的是「行数组」
```

`ccnOfBody([0,3])` 遍历的是两个数字，`BRANCH_RE` 一个都不匹配，于是返回初值 `1`。
**危险方向**：把真实热点改写成看起来微不足道，ratchet 永远咬不住它。
而 stderr 还打印「rescued by name」，让这一行看起来比未验证的行**更**可信。

修复：新增 `rescueBodyLines()` 把下标对还原成真实行。修复后五种语言全部 8→8。

**反向对照（证明测试真的咬得住）**：只把修复回退成传下标对，`vitest` 立刻
`2 failed | 35 passed`，**红的正是 .go 和 .dart**，Python/Java/C# 保持绿——
与上表的缺陷分布完全吻合。

### 9.3 目标 B：PHP 接入

工具链（实测版本）：PHP 8.4.27 (ZTS) + pcov 1.0.12、Composer 2.11.2、
phpstan 2.x、phpcs 3.11、phpunit 11.5。

**五个面的理论认知，全部实测确认**：

| 工具 | 退出码契约 | 适配器如何处理 |
|---|---|---|
| phpcs | 0=干净、2=有错、**3=工具跑不起来**（--standard 拼错或路径不存在） | 3 → BLOCK(2)，不是 FAIL(1) |
| phpstan | 0=无错、1=有错、**1 也用于路径/配置错误** | 退出码无法区分，改读 `--error-format=raw` 的结构化输出：非零退出且零诊断行 ⇒ BLOCK |
| phpunit | 0=通过、1=失败、2=错误/中止 | 直接映射 |
| 覆盖率 | PHPUnit 原生支持 `--coverage-cobertura` | **必须用 cobertura**：Gate 5 Stage 2 只解析 `<coverage line-rate>`（#768），clover 是 Gate 5 读不懂的合法报告 |
| 覆盖率驱动 | 无 pcov/xdebug 时 PHPUnit **不写文件且退出 0** | 先探测驱动，缺失 → BLOCK，绝不报 0% |

**接线结果**：`language-capability php` → **9/13，零 NOT WIRED**
（与 Dart 持平；高于 objectivec 8/13、shell 7/13、powershell 8/13）。
剩余 3 项是已声明的实现缺口（Gate 6/9/13），1 项 unknown（Gate 10 SAST 无 PHP 规则集）。

**B3 端到端证明**（真实 PHP 项目，非 mock）：

| 检查 | 命令 | 结果 |
|---|---|---|
| Gate 3 真的评分 | `ccn_file_in_population .ccn-baseline.json src/Hotspot.php` | GRADED（`vendor/` 与 `tests/` 正确 DROPPED） |
| Gate 3 真的拦得住 | 把热点从 CCN 9 改到 13 后 `--check` | `BLOCK src/Hotspot.php:9 CCN=13 baseline=9` ✅ |
| Gate 1 静态分析 | `run_static_analysis` | 抓到 3 条真实 phpstan 错误 → rc=1 |
| Gate 1 lint | `run_lint`（注入格式违规） | 抓到 6 条 PSR12 违规 → rc=1 |
| Gate 1 lint 工具坏掉 | `XP_GATE_PHPCS_STANDARD=NoSuchStandard` | **rc=2（BLOCK）**，不是 rc=1 |
| Gate 5 测试 | `run_tests`（断言失败） | rc=1 |
| Gate 5 覆盖率 | `run_coverage` | 生成 cobertura，`line-rate` 可被 Gate 5 解析 |
| 无覆盖率驱动 | 指向无 pcov 的 PHP | rc=2 且说明「拒绝把未测量的套件报成 0%」 |

### 9.4 接入过程中新发现的两个缺陷（都会让 Gate 3 在 PHP 项目里空转）

这两个都不是 #848，是这次接入才暴露的：

1. **`SOURCE_EXT` 没有 `php`** —— `findSourceFiles()` 返回 **0 个文件**，
   `--write-baseline` 照样写出一个空基线。这与 #847 的 Dart 遗漏同形：
   门禁在一个空人口上打印 PASSED。
2. **`skipDirs` 没有 `vendor`** —— composer 官方建议**提交** `vendor/`，
   所以「只扫 git 跟踪文件」这道过滤挡不住它。实测：一个只有 2 个源文件的
   fixture，生成基线时把 `vendor/phpunit/.../bootstrap.bundle.min.js`
   当成本项目的生产代码评分。

两个都补了测试，并各自做了**独立**反向对照：删 `php` → “discovers .php sources”
变红；删 `vendor` → “never scans composer vendor/” 变红。互不掩盖。

### 9.5 顺带修好的第三处：#717 又会以新形式复发

把 `gate-4.sh` 的 `PRINCIPLES_FILES` 加上 `php` 后，
`language-capability` 的既有测试立刻变红：

```
php: FILTER ACCEPTS IT, analyzer.ts adapterMap has no entry -> file accepted then dropped (#717)
```

这正是 #717 的形状，只不过换了个门。补上 `src/principles/adapters/php.ts` 与
`adapterMap` 的两个条目后变绿。**是测试抓住的，不是人肉 review 抓住的**——
这条测试存在的理由就是让下一门语言重复失败时立刻变红。

修复过程中还顺带修了两个既有缺陷（都不是我引入的）：

- `inspectRegistry()` 的正则 `^\s{2}${lang}:\s*\{` **从来匹配不到**：
  在 `m` 标志下 `\s` 会匹配 `^` 刚锚定的那个换行，于是要求「一空行 + 再一段空白」。
  实测对 `  csharp: {` 返回 false。**每个语言都被误报 NOT WIRED**，
  让真缺口和假缺口长得一样。改成 `[ \t]{2}`。
- `inspectGate6()` 读的是 `gate-6-layers.sh`，实际门禁体在 `gate-6-entry.sh`。
  读错文件，于是 S 语言一律报「无 arm」。

### 9.6 复盘本身也过了一遍门禁

`inspectLanguage()` 原本 **264 行**，被 Gate 4 判为
`clean-code.long-function: maximum 50` 违规。

> 一个讲「怎么把门禁接全」的报告，自己过不了门禁，是没有资格讲这件事的。

已拆成 `src/npm-package/lib/language-capability-surfaces.js`，一门禁一函数
（13 个面各一个），主文件相应降到 474 行。拆分后 Gate 4：
`✓ No violations found`。

**回归**：`php.test.ts` 7 + `language-tools-detect` 19 + `language-capability` 14
+ `ccn-report` 39 = **79/79 全绿**；bats `gate-3.test.bats` + `issue-717-mirror-parity.test.bats`
= **19/19 全绿**（含 gate-3.sh / gate-4.sh 各自 FIVE 份副本字节一致）。


