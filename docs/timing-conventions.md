# 计时公约（Timing Conventions）

**来源:** issue #524（Sprint A，2026-10-13）
**背景:** Gate 11 曾用 `date +%s`（秒）减 `gate_start_ms`（毫秒），每次 pre-commit 打印约 `-1789830788575s` 的时长，并写入 `.xp-gate/reports/pre-commit/*.json`。

## 公约

1. **门禁计时一律走 #370 的毫秒 helper**：`now_ms()`（`githooks/lib/now-ms.sh`，node 优先、跨平台、正则校验）。`gate_start_ms()` 是它的委托包装；结束时同样用 `now_ms`，显示层除以 1000。
2. **禁止混用单位做算术**：`date +%s`（秒）与毫秒时间戳不得相减。`record_gate_audit` 内部已有负值钳零（`duration_ms < 0 → 0`），但打印层不信任该钳制——Gate 11 的教训是负值先污染输出再流入报告。
3. **新增计时点的写法**：

   ```bash
   GATE_N_START=$(gate_start_ms)
   # ... gate body ...
   GATE_N_END=$(now_ms)
   GATE_N_DURATION_MS=$((GATE_N_END - GATE_N_START))
   [ "$GATE_N_DURATION_MS" -lt 0 ] 2>/dev/null && GATE_N_DURATION_MS=0
   echo "   Gate N (...) completed in $((GATE_N_DURATION_MS / 1000))s"
   ```

## 全仓审计结论（2026-10-13，`grep -rn 'date +%s'` 排除 node_modules/.stryker-tmp）

| 位置 | 用法 | 判定 |
|------|------|------|
| `githooks/lib/now-ms.sh`（+ 镜像） | `date +%s` 回退路径，×1000 转毫秒 | ✅ 合规（helper 内部） |
| `src/npm-package/plugins/claude-code/bin/xp-gate-version-check.sh` | 版本检查缓存时间戳，秒级自洽（同单位比较） | ✅ 合规 |
| `scripts/benchmark-principles.sh` | `date +%s%N` 纳秒，起止同单位 | ✅ 合规 |
| `scripts/xp-gate-init.sh` | plugin id 后缀，非时长 | ✅ 合规 |
| `githooks/pre-commit` Gate 11 | **秒减毫秒** | ❌ 已修复（#524） |

审计范围：`githooks/`、`src/`、`scripts/`、`plugins/`（排除 node_modules、.stryker-tmp、.worktrees）。结论：Gate 11 是唯一单位混用点，无第二处。

## 回归守卫

`githooks/__tests__/issue-524-gate11-duration-units.test.bats`：从真实 `pre-commit` 抽取 Gate 11 计时尾段执行，断言时长非负且 < 86400s；静态断言该区域使用 ms helper 且不含 `date +%s`；npm 镜像字节一致；反空洞用例证明旧形态会被抓。
