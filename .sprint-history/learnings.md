
## sprint-20261009-67（#507 Java 门禁强化，2026-10-10 关闭）
- Delphi code-walkthrough 三轮全部拦下真实 fail-open 缺陷（R1×11 / R2×2 / R3 确认修复），评审流程价值实证。
- 新测试必须至少在一个可执行环境真正跑过再交付：本 sprint 两个测试"写了但从未运行"，CI 首轮即红。
- check-hook-mirror.sh 只在 CI 执行，本地不拦 principles 漂移 → issue #521。
- 门禁耗时大头是语言检测 find 扫 node_modules（112s 未入账），排除后提交 8m31s→3m32s。
- 本机 node spawn EBUSY 为环境级限制，spawn 类门禁本地以 CI 为准。
