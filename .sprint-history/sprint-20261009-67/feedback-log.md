# Feedback Log — #507 Java 质量门禁强化 sprint（sprint-20261009-67）

## 验证事件汇总（对应 verification-events.jsonl）

| # | 验证 | 结果 | 备注 |
|---|---|---|---|
| 1 | 盲审（blind review）修复：tsc + bash -n×5 + 镜像 parity 6/6 | PASS | 提交 702e2801 |
| 2 | Delphi Round 1（3 专家，0 Critical / 11 Major，consensus 1.0 diverging→修复） | REQUEST_CHANGES→fixed | ce00a4fb |
| 3 | stub-fixture harness 14/14 + G9 聚合 5 组合 | PASS | /tmp/verify-dr2.sh |
| 4 | Delphi Round 2（A 新增 2 fail-open Major） | REQUEST_CHANGES→fixed | 42a2a598 |
| 5 | Delphi Round 3 三专家 APPROVED（9/9/9，consensus 1.0） | PASS | 评审闭环 |
| 6 | 性能修复：find 排除 node_modules + gate-11 计时 | PASS | 提交 8m31s→3m32s 实测（bfcf3d14） |
| 7 | 本地 check --all | 9/10 | python-health 门受本机 node spawn EBUSY 机器限制，以 CI 为准 |
| 8 | PR #517 CI 首轮 | 2 vitest 失败 | 两测试从未在任何环境跑过 → 31b6ddac 修复（本地 23/23 + bash fixture 复刻验证） |
| 9 | PR #517 CI 首轮 Mirror Parity | 失败 | principles 镜像漏同步 → 62a94c88；暴露 check-hook-mirror.sh 未接入本地门禁的缺口 |
| 10 | PR #517 CI 第二轮 16/16 + main 合并后 3 workflow（Cross-Platform/Mutation/npm-publish） | PASS | merge e0fe257 |

## 教训（learnings）

1. **新测试必须至少在一个可执行环境真正跑过**——本 worktree 缺 vitest + spawnSync 类测试被 EBUSY 打断，两个测试"写了但从未运行"，CI 首轮即红。
2. **check-hook-mirror.sh 只在 CI 跑**，本地提交不拦 principles 漂移；编辑 src/principles/** 必须手动同步 npm-package 镜像。缺口已立 emergent issue。
3. **Delphi 评审三次拦截真实缺陷**：R1 的 11 Major（bc/awk 分叉、JSON 计数污染、p3c 挡死真实项目等）、R2 的 SKIP 假绿 + GNU-only sed——全部 fail-open 类，值得保留该流程。
4. **门禁耗时瓶颈在语言检测 find 扫 node_modules**（112s 未入账），修复后提交耗时 -58%；剩余 hotspot gate-5/9/6 留作后续优化。
5. 本机 node spawn EBUSY 是环境级限制（疑似火绒行为拦截，目录白名单无效），spawn 类门禁以 CI 为准。
