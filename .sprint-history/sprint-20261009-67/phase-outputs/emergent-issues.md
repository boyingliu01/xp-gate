# Emergent Issues — #507 Java 质量门禁强化

## 验收日期: 2026-10-10

## 发现的问题

### Major
1. **check-hook-mirror.sh 未接入本地门禁**（已立 issue）：镜像 parity 只在 CI job 执行，本地 pre-commit/pre-push 不拦 src/principles ↔ npm-package/principles 漂移——本轮 31b6ddac 就漏同步了一次，靠 CI 兜底才发现。建议接入 pre-push 或作为 gate。
   → issue: （见 emergent-filing）

### Minor
2. **phase-transition 无时序守卫**：本次收尾中 4 completed 失败后 5/6 仍可照常推进，history 短暂乱序（已手工补齐）。→ 已立 issue #519。
3. **phase-transition --skip-evidence 语法反直觉**：reason 是 --skip-evidence 的值（`--skip-evidence "<text>"`），独立的 `--reason` flag 不存在，报错信息与直觉不符。可并入 #519 一并改进。
4. **本机 node spawn EBUSY**：环境级限制（疑似火绒行为拦截，目录白名单无效），spawn 类门禁（python-health 等）本地永远无法 10/10。不属于 repo 问题，记录备查。

## 验收结论
- [x] ✅ 验收通过，进入 CLEANUP（依据 DR-002）
