# Gate 3 复杂度门禁的真实状态（2026-10-19）

## 一句话

Gate 3 从上线到 2026-10-19 **从未真正拦截过任何一个函数**。原因不是阈值太松，是读数读错了列。

## 根因

`lizard --csv` 输出 11 列、无表头：

```
NLOC, CCN, token_len, param_count, location_size, fn@start-end@path,
path, name, signature, start, end
```

工具链（`scripts/ccn-report.cjs` 与 `githooks/lib/ccn-ratchet.sh`）从**第 4 列**读 CCN。第 4 列是 `location_size` —— 函数体的**跨度长度**，不是圈复杂度。

后果连锁：

1. 每条记录里的 "CCN" 其实是跨度长度。`getRuleDescription` 真实 CCN 是 10，跨了 126 行，于是记成 126。
2. `verifyRowCcn`（用括号平衡重算真实分支数）只对**跨度长度 >10** 的行触发。跨度长度几乎总是 >10，所以它几乎对每行都触发——但它触发后重算的是"这个跨度里有几个分支"，结果仍然不是那个函数的 CCN。
3. ratchet 用 `path::name` 查基线。基线里的数值是跨度长度，实时测得的是另一个数字，**没有任何函数能匹配上自己的条目**。于是每个函数都掉进"新函数"分支，按平阈值（>10 阻断）评分。
4. 结论：ratchet 的"严格大于才阻断"语义从来没有生效过。

## 同时修掉的其他四个假数据来源

| 问题 | 表现 | 修法 |
|------|------|------|
| 调用点冒充定义 | `main()` 的 60 行函数体被记在 `resolvePromptBudgetBytes` 名下（CCN 70），而后者只是**在函数体里被调用过** | `locateBodyAtRow` 改为声明优先：先在整个文件里找 `function NAME(` / `const NAME =`，找到就以声明的括号平衡范围为准 |
| 匿名回调共用一个基线键 | 一个文件 40 个箭头回调，基线只留 1 条，其余 39 个被拿陌生数字评分 | 基线键加行号：`path::(anonymous)@line` |
| 同名不同函数 | `walk` 在同一文件的两个嵌套作用域里各有一个，共用一条基线 | 同名出现多次时同样按行号加身份 |
| lizard 重复行 | 对象字面量箭头成员被报两遍（`check@71-76` 与 `check@71-77`，CCN 还不一致） | 按 `(file, name, startline)` 去重，保留最宽跨度 |

## lizard 1.21.3 的解析缺陷（已隔离，未修复）

`function name(...): T {` 带返回类型注解、且**紧随一个 JSDoc 块**时，lizard 会丢失函数边界，把后续所有函数吸进同一行。实测 `findBodyBrace` 被报成 CCN 69 / 跨度 190 行，真实 CCN 是 8。

受控探针排除了以下假设（逐个单独测试，均不触发）：JSDoc 里的反引号、`try/catch`、多行数组、`require.resolve` 内联对象、`else if` 无括号链、内联类型字面量返回值。

`verifyRowCcn` 的括号平衡重算就是为此设计的兜底，会把 69 纠正为 8 并标记 `inflated: true`。**这是工具缺陷，不是代码复杂度问题**，不能靠改这个函数本身解决。

## 现在的真实数字

- 生产 >10：**13 个**（全部登记在 `.ccn-baseline.json` 中作为当前上限）
- 镜像 >10：58 个（镜像随规范源自动下降，不需要单独治理）
- 测试 >10：0 个
- 基线条目：755 条

**此前流传的 779→277→58→47 全部是用跨度长度量的，视为无效数字。** 唯一有意义的对比是从本文件记录的真实基线开始。

## CI 侧同时修复

`.github/workflows/quality-gates.yml` 的 Gate 3 原本：

```bash
SOURCE_FILES=$(find . ... | head -50 | tr '\n' ' ')   # 只扫前 50 个文件
lizard -C 10 $SOURCE_FILES 2>&1 | head -50
if [[ $LIZARD_STATUS -ne 0 ]]; then echo "⚠️ ... (non-blocking in CI)"
```

三个问题：采样、截断输出、**任何情况下都不会失败**。现在改为：

```bash
node scripts/ccn-report.cjs --check --baseline .ccn-baseline.json
```

`--check` 的语义与 pre-commit 的 `githooks/lib/ccn-ratchet.sh` 一致，两者共用同一个 `baselineKey()` 规则；缺基线文件或基线不可解析时 **fail closed**。

## 运维提醒

`core.hooksPath` 指向 `~/.config/xp-gate/hooks/`，所以**改 `githooks/` 不会自动影响本地提交**。本轮实测踩到了这个坑：`audit-sanitize.sh` / `ccn-ratchet.sh` / `docs-only.sh` 三个新库在已安装副本里根本不存在，导致 15 次提交跑的都是没有 sanitizer、没有 ratchet、没有 docs-only 短路的旧 hook。

修复方式：

```bash
xp-gate doctor                # 看漂移
xp-gate doctor --sync-hooks   # 同步
```

改完任何 `githooks/` 下的文件后都要跑一次。
