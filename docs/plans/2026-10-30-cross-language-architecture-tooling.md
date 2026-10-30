# 分析：架构约束工具的全语言版图 —— ArchUnit 不是孤例

- 日期：2026-10-30
- 承接：`docs/plans/2026-10-30-archunit-33-rules-gap-analysis.md`
- 核心结论：**每个主流语言都有自己的 ArchUnit 等价物，xp-gate 一个都没接**

---

## 一、直接回答：ArchUnit 只适合 Java

ArchUnit 的核心能力是「把编译后的字节码读进内存，当成对象图来断言」。这套能力依赖 JVM 的 `ClassFile` 加载机制，**无法移植**。所以它的等价物在别的语言里不是「ArchUnit 的移植」，而是各自基于本语言 AST/import 图重新实现的工具。

但这不代表其他语言做不到同样的事。事实上**规则语义是通用的**——「domain 不能依赖 infrastructure」在任何语言里都是同一个命题，只是表达方式和执行载体不同。

## 二、全语言版图

| 语言 | ArchUnit 等价物 | 强制方式 | 分层表达能力 | 是否已接入 xp-gate |
|---|---|---|---|---|
| **Java** | ArchUnit | 运行时 JUnit 测试 | ⭐⭐⭐⭐⭐ 全能力 | 🟡 仅探测 `*Architecture*` 测试是否存在 |
| **Kotlin** | Konsist | 运行时 JUnit 测试 | ⭐⭐⭐⭐⭐ | ❌ 无 |
| **C# / .NET** | ArchUnitNET / NetArchTest | 运行时测试 | ⭐⭐⭐⭐⭐ | ❌ 无（xp-gate 不支持 C#） |
| **TypeScript/JS** | dependency-cruiser、archlint、eslint-plugin-boundaries | 静态 CLI | ⭐⭐⭐⭐ | 🟡 仅 archlint，且分层配置失效 |
| **Python** | import-linter、tach | 静态 CLI | ⭐⭐⭐⭐⭐ layers 契约完整 | 🟡 有 `run_architecture()` 但**从未被调用** |
| **Go** | go-arch-lint、arch-go | 静态 CLI | ⭐⭐⭐⭐ | 🟡 有 `run_architecture()` 但**从未被调用** |
| **Rust** | cargo-deny（依赖层面）、ArchUnit 无对等物 | 静态 CLI | ⭐⭐ 仅 crate 级 | ❌ 无 |
| **C/C++** | 无成熟等价物 | — | ⭐ | ❌ 已声明 `supported: false` |

### 逐语言要点

**Kotlin → Konsist**（[docs](https://docs.konsist.lemonappdev.com/)、[GitHub](https://github.com/LemonAppDev/konsist)）
Konsist 是 Kotlin 专属的架构静态分析器，能力最接近 ArchUnit：能直接断言「某包下的类不能依赖另一包」「类名必须符合约定」「注解必须在某处」。对 xp-gate 特别重要的是——**xp-gate 已经有 kotlin 适配器**（`githooks/adapters/kotlin.sh`），但架构检查是 0 行。这是投入产出比最高的一块：语言已支持，工具成熟，只缺接入。

**Python → import-linter**（[layers 契约文档](https://import-linter.readthedocs.io/en/stable/contract_types/layers/)）
这是我查到的**分层表达能力最强的静态工具**，比 archlint 强得多：
- `layers` 契约：有序层列表，高层可依赖低层，反向即违规
- **自动包含间接依赖**：`low` 不能 import `high`，也不能 import 任何「间接依赖了 high」的模块——这一条 archlint 做不到
- `containers`：同一个层模式在多个父包下复用，不用重复写
- `exhaustive`：强制「每个模块都必须被声明为某一层」，防止新增模块逃逸出约束
- 多元素层：`a | b | c` 表示同层互不依赖，`a : b : c` 表示同层可互相依赖

这套语义几乎能直接表达 33 条规则里的 R01/R04/R19/R14/R15/R17。**xp-gate 只需生成/校验配置，不用自己实现检测逻辑。**

**Go → go-arch-lint / arch-go**
[go-arch-lint](https://github.com/fe3dback/go-arch-lint) 用 YAML 声明组件与依赖规则，专门为 hexagonal/onion/DDD 设计，比 arch-go 更活跃。arch-go 是 xp-gate 当前唯一在 `architecture.yaml` 里声明的 Go 工具。

**TypeScript → dependency-cruiser**
[dependency-cruiser](https://github.com/sverweij/dependency-cruiser) 的 `forbidden` 规则表达能力远超 archlint：支持 `from`/`to` 的路径模式、`dependencyTypes` 过滤、`reachable` 可达性分析（即间接依赖）、正则命名约束。**如果 TS 侧要真正做分层，dependency-cruiser 比 archlint 更合适**。archlint 的强项是「架构坏味道」（克隆/循环/上帝模块），不是「层边界」。

## 三、xp-gate 的结构性问题：架构工具根本没进工具链

这是本轮最关键的发现，比「缺 31 条规则」更根本。

### 问题 1：`run_architecture()` 是死代码，且适配器分派器本身也是死的

```bash
$ grep -n "run_architecture" githooks/adapters/*.sh
githooks/adapters/go.sh:46:run_architecture() {
githooks/adapters/python.sh:183:run_architecture() {

$ grep -rn "run_architecture" githooks/pre-commit
(无输出)
```

两个适配器**各自实现了 `run_architecture()`，但没有任何调用方**。

更值得注意的底层原因：**适配器分派器 `route_to_adapter()` 自己就是死代码**。

```bash
$ grep -rn "route_to_adapter" githooks/ --include=*.sh
githooks/adapter-common.sh:107:route_to_adapter() {      # 只有定义
# 无任何调用方
```

而 `route_to_adapter()` 的动作枚举本来就不含 `architecture`：

```bash
# githooks/adapter-common.sh L131-134
case "$action" in
  "static_analysis") run_static_analysis ;;
  "lint") run_lint ;;
  "tests") run_tests ;;
  "coverage") run_coverage ;;
  *) return 1 ;;
esac
```

`pre-commit` 实际上**绕过 `route_to_adapter`，直接调用 `run_*` 函数**（`source` 适配器后直接 `run_static_analysis` / `run_lint` / `run_tests` / `run_coverage`，见 L1878、L1978、L2737、L2939 等）。

所以「加一行 case 就能激活」这个判断**是错的**——加了也没用，因为没有人调 `route_to_adapter`。真正要做的有两件事：

1. 在 `pre-commit` 的 Gate 6 里显式调用 `run_architecture`（或统一改造为走 `route_to_adapter`，二选一，需先决策）
2. 顺带清理 `route_to_adapter` 这个死分派器，或把它真正接上

这个发现把「一行改动」的估计修正为「一次小重构 + 一个决策」。

### 问题 2：架构工具不在 doctor 的工具注册表里

```bash
$ grep -cE "archlint|archunit|import-linter|arch-go|konsist|dependency-cruiser" \
    src/npm-package/lib/language-tools.js
0
```

`language-tools.js`（912 行）是 `xp-gate doctor` 判断「本机缺什么工具、怎么装」的唯一数据源。它登记了 eslint、ruff、mvn、checkstyle、pmd…**但一个架构工具都没有**。

后果：用户跑 `xp-gate doctor`，永远看不到「你缺 archlint / 缺 import-linter」，装不上也就跑不起来，而 Gate 6 只会给出含糊的 SKIP。

### 问题 3：`architecture.yaml` 的 `languages` 块是愿望清单

```yaml
# architecture.yaml L178-199
languages:
  typescript: { tool: "@archlinter/cli", minVersion: "0.16.0" }
  python:     { tool: "import-linter",  minVersion: "2.0.0" }
  go:         { tool: "arch-go",        minVersion: "1.7.0" }
  java:       { tool: "archunit",       minVersion: "1.0.0" }
  cpp:        { supported: false, skipMarker: ".skip-architecture-cpp" }
```

这段配置**没有任何代码读取它**。它既没被 Gate 6 用，也没被 doctor 用，也没被 `xp-gate arch` 用。是一份描述「我们打算支持什么」的注释而已。

## 四、这如何改变上一轮的方案

上一轮我提的 ARCH-03「抽象语言无关的 layer-contract，自己实现多语言后端」——**这个方向要收回一半**。

原因：我当时的假设是「没有现成工具能表达分层，所以 xp-gate 得自己造」。实际调研下来，**Python/Go/Java/Kotlin 的分层工具都成熟且表达力强于 archlint**。自己造一套后端去重新实现 import 图解析、间接依赖传播、容器复用，是重复劳动，而且必然比专用工具做得差。

修正后的思路应该是**「编排现有工具」而不是「重新实现检测」**：

```
                    ┌─────────────────────────────┐
                    │  一份语言无关的层意图声明    │
                    │  (.layer-contract.yaml)     │
                    └──────────────┬──────────────┘
                                   │ 生成/校验
        ┌──────────────┬───────────┼───────────┬──────────────┐
        ▼              ▼           ▼           ▼              ▼
   import-linter   go-arch-lint  ArchUnit   Konsist    dependency-cruiser
   (Python)        (Go)          (Java)     (Kotlin)   (TS/JS)
        │              │           │           │              │
        └──────────────┴───────────┴───────────┴──────────────┘
                                   │
                       统一解析退出码 + 统一报告格式
```

xp-gate 的增值不在「检测」，而在三件事：
1. **一份意图，多语言落地**——用户只写一次层定义，xp-gate 生成各工具的原生配置
2. **统一编排**——不管底层是 CLI 还是 JUnit 测试，Gate 6 拿到统一的 PASS/FAIL + 违规清单
3. **统一 ratchet**——各工具的分层违规都折算进同一份 baseline，只拦新增

## 五、修正后的建议

### 立刻可做的（低成本、高收益）

**1. 接上 `run_architecture()`，激活死代码。**
两个适配器里已写好的 import-linter / arch-go 检查从「永不执行」变成「能执行」。注意这不是一行改动——`route_to_adapter()` 本身无调用方（见问题 1），需要在 Gate 6 里显式调用 `run_architecture`，或先决策是否统一改造成走 `route_to_adapter`。

**2. 把架构工具登记进 `language-tools.js`。**
让 `xp-gate doctor` 能诊断、能提示安装。每语言加一条记录即可。

**3. Kotlin 接 Konsist。**
xp-gate 已支持 Kotlin，Konsist 是成熟工具，`kotlin.sh` 里架构检查是 0 行——纯增量。

### 需要设计的（中等成本）

**4. 重写 ARCH-03 为「配置生成器」而非「自研后端」。**
`.layer-contract.yaml` 作为唯一真相源，提供 `xp-gate arch generate`：
- 生成 import-linter 的 `[importlinter:contract:...]` 段
- 生成 go-arch-lint 的 YAML
- 生成 ArchUnit 测试骨架
- 生成 dependency-cruiser 的 `forbidden` 规则

这样 33 条里「层间依赖方向」那 10 条（R01/R04/R07/R14/R15/R17/R19 等）**一次覆盖五种语言**。

**5. 统一 Gate 6 的判定口径。**
现在 Gate 6 对不同语言有四套不一致的逻辑（TS 走 archlint、Java 找测试文件、Python/Go 看配置文件）。应该统一为：`工具存在 → 执行 → 解析统一格式的违规清单`，工具缺失按项目既有约定（SKIP 或 fail-closed）处理。

### 需要澄清的（依赖外部）

**6. ArchUnit 33 条规则本身仍是 Java/Spring 专属。**
R03（Domain 零框架依赖）在 Kotlin 里对应的是「domain 包不能 import Spring 注解」，语义相同但注解类名不同；R09（禁 @Autowired）在 Python/TS 里没有对等物（没有字段注入这回事）。

**所以不要把 33 条当成跨语言标准**。它们是「Java/Spring 项目架构规范的实例化」。跨语言应该抽取的是**更上层的规则类别**：

| 规则类别 | 跨语言 | 33 条中的例子 |
|---|---|---|
| 层间依赖方向 | ✅ 完全通用 | R01 R04 R07 R14 R15 R17 R19 |
| 循环依赖 | ✅ 完全通用 | R06 |
| 命名约定 | ✅ 通用（后缀不同） | R10 R11 R12 W02 W03 W04 W05 |
| 可见性/封装 | ⚠️ 部分（Java private vs TS 无） | R13 R22 |
| 框架注解禁用 | ❌ Java/Spring 专属 | R09 R18 |
| DDD 战术模式 | ⚠️ 概念通用，实现各异 | R21 B-ADP B-EVT |

建议按这个分类重新组织 issue，而不是按 33 条逐条。

## 六、与上一轮 issue 的对应关系

| 上一轮 issue | 处置 | 说明 |
|---|---|---|
| ARCH-01（Gate 6 暴露死配置） | **保留，优先级不变** | 与本轮无关，仍是 P0 |
| ARCH-02（文档更正） | **保留，范围扩大** | 还需更正「languages 块已支持」的暗示 |
| ARCH-03（自研 layer-contract 后端） | **重写为配置生成器** | 见建议 4 |
| ARCH-04（R01/R04/R19） | **改为「生成各工具原生配置」** | 不自己实现检测 |
| ARCH-05（ArchUnit 模板库） | 保留，但降级为「五语言模板库」 | 见建议 4 |
| ARCH-06（覆盖矩阵） | **保留，扩展为全语言** | |
| ARCH-07~12（Java AST 规则） | **保留** | 这些是 ArchUnit 覆盖不到的增量，仍值得做 |
| 新增 ARCH-13 | 接上 `run_architecture` + 清理死分派器 | 见建议 1，含一个待决策项 |
| 新增 ARCH-14 | 架构工具进 doctor 注册表 | 见建议 2 |
| 新增 ARCH-15 | Kotlin + Konsist 接入 | 见建议 3 |

## 七、一句话总结

ArchUnit 只属于 Java，但**「用工具强制架构约束」这件事每种语言都有成熟方案**。xp-gate 的问题不是缺规则，而是**架构检查从未真正接入过它的工具链**——两个适配器里躺着写好的 `run_architecture()`，一个调用都没有；连本该调用它的 `route_to_adapter()` 分派器自己都是死代码。先把这条链路接上，再把「一份层意图、多语言生成」做起来，比自研一套检测后端划算得多。

## 附：核对方法

```bash
# 1. run_architecture 是死代码
grep -n "run_architecture" githooks/adapters/*.sh   # 有定义
grep -n "run_architecture" githooks/pre-commit       # 无调用
sed -n 128,136p githooks/adapter-common.sh           # 动作枚举无 architecture
grep -rn "route_to_adapter" githooks/ --include=*.sh  # 只有定义，无调用

# 2. 架构工具不在 doctor 注册表
grep -cE "archlint|archunit|import-linter|arch-go|konsist" \
  src/npm-package/lib/language-tools.js              # → 0

# 3. architecture.yaml 的 languages 块无人读取
grep -rn "minVersion\|toolRequired" src/ githooks/ --include=*.ts --include=*.js --include=*.sh
#    → 无命中

# 4. Kotlin 适配器无架构检查
grep -ci "arch" githooks/adapters/kotlin.sh          # → 0
```
