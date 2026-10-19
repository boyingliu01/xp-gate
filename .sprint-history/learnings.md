
## sprint-20261009-67（#507 Java 门禁强化，2026-10-10 关闭）
- Delphi code-walkthrough 三轮全部拦下真实 fail-open 缺陷（R1×11 / R2×2 / R3 确认修复），评审流程价值实证。
- 新测试必须至少在一个可执行环境真正跑过再交付：本 sprint 两个测试"写了但从未运行"，CI 首轮即红。
- check-hook-mirror.sh 只在 CI 执行，本地不拦 principles 漂移 → issue #521。
- 门禁耗时大头是语言检测 find 扫 node_modules（112s 未入账），排除后提交 8m31s→3m32s。
- 本机 node spawn EBUSY 为环境级限制，spawn 类门禁本地以 CI 为准。

## sprint-20261018-19（门禁诚实性 + 提速，2026-10-19 VERIFY）

### Pattern: 改完 githooks/ 必须立刻 doctor --sync-hooks
- **Context**: `core.hooksPath` 指向 `~/.config/xp-gate/hooks/`，改仓库里的 `githooks/` 对本地提交**零效果**。
- **Insight**: 本 sprint 前 15 个提交跑的是没有 `audit-sanitize.sh` / `ccn-ratchet.sh` / `docs-only.sh` 三个库的旧 hook。我据此一度判断"REQ-F 没有效果"，实际是**新代码根本没执行**。
- **Action**: 改任何 `githooks/**` 后立刻 `xp-gate doctor --sync-hooks`，并确认输出里 15 个 lib 全部 `Installed copy matches githooks/`。`xp-gate doctor` 的 drift 检查本来就会报，别跳过。

### Pattern: 数字不对时先怀疑测量方式，不要先调阈值
- **Context**: 收到的原始需求是"把 CCN 阈值调宽"，真实问题是工具从**第 4 列**（`location_size`，跨度长度）读 CCN 而不是第 1 列。
- **Insight**: 阈值、跨度假象、调用点冒充定义——三层错误叠加，调阈值只会让错的东西更宽松。用 10 个受控探针逐步缩小范围，比读代码推理快且可靠。
- **Action**: 任何"这个数字看起来不对"的场合，先写探针验证数字是怎么算出来的。

### Pattern: 统计前先验证分组方式
- **Context**: 第一次算 REQ-F 的 p50 用 `commit_hash` 归组，得到"89.0s → 69.6s"。实际同一 hash 下会叠加重试记录（最多 123 行 / 792s），且连续两次提交会被合成一次运行。
- **Insight**: 我犯了与本 sprint 要修的 bug 同一类的错误——相信一个没校验过分组方式的数字。
- **Action**: 按"每次 hook 运行的第一行"（`version-consistency`）切分运行边界，只保留干净单次运行再算 p50。算完先看样本量和分布形状，再看结论。

### Pattern: 切片代码走查的假阳性率高，但值得付
- **Context**: 9 条主要 REQUEST_CHANGES 逐条核实后只有 2 条是真的（运算符优先级 bug、hook 与 CI 的 fail-closed 不一致）。
- **Insight**: 切片必然丢失上下文（看不到被引用的文件、看不到完整分支结构），所以"未定义""不一致"类判断大量是假阳性。但命中的那 2 条都是"代码看起来在检查、实际没检查"的恶性 bug——正是最值得被发现的类型。
- **Action**: 走查意见逐条核实并记录判定，不要全盘采纳也不要全盘驳回。把每条写成"真 bug / 半真 / 假阳性 + 为什么"。

### Pattern: 遗留债务要列清单，不要写"有意为之"
- **Context**: Phase 3 总结第一版写"剩余 12 个是有意留下的债务"，被三位评审连续两轮 REQUEST_CHANGES。
- **Insight**: 评审不要求你把活干完，要求你说清楚没干哪些、为什么不干、谁来保证它不变差。逐条列出 13 个函数（CCN + 位置 + 名字 + 具体理由）之后同一批评审给了 3/3 APPROVED。
- **Action**: 部分完成的需求，交付一张可核对的债务表 + 已生效的机制约束（这里是 ratchet 钉住），而不是一句判断。

