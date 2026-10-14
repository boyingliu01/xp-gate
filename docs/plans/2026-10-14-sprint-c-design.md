# Sprint C 设计文档 — 评审链平台适配（v0.24.0）

> Issues: #429 #481 #414 #443 ｜ 分诊依据: `2026-10-13-open-issues-backlog-plan.md` P3
> 排序: #429（runner 打底）→ #481（标定协议）→ #414（Qoder 双通道）→ #443（DSH 双通道，复用 #414 契约）

## 1. #429 — runner 小缺口（已完成）

第 1-4 项（默认值同源 / 边界正例 / provider 级 readConfig 校验 / env 未设 fail-fast）已在
`08ea988c` 入库。第 5 项（global 部署审计）在 `f0285107` 补齐：导出 `setupGlobal`，
沙箱 HOME 下端到端跑通并断言三份 agent 落盘 `~/.qoder/agents/` 且绑定与本版本模板一致。

## 2. #481 — 席位 prompt 字节上限标定协议（可执行）

### 2.1 事实基础（R1–R4 实测，2026-10-05）

- `g-glm-5.3-flash` 席位连续 6 次在 32081–39414 字节请求上报 `Network error. retryable:false`；
- 同轮他席 36643 字节成功；同席位 ~60 字节冒烟 7 秒正常；换 `s-glm-5.3-flash` 路由后 36KB 一次通过。
- 结论（R4 三席一致）：**上限是 席位×模型路由 属性**，不是全局安全值，也不是瞬时网络故障。

### 2.2 标定协议

1. **探针构造**：语义核心固定（一段固定的评审指令 + 固定样例），附录为确定性填充
   （重复的单行文本块，按目标字节数精确生成）。探针总字节 = 语义核心 + 填充，填充行
   内容不含语义信息，避免污染计费 token 的语义密度。
2. **区间二分**：从 `[last_pass, last_fail]`（首次为 `[26624, 65536]` 先验）二分 3–5 次，
   每次只记录「请求发出且返回合法 verdict」或「请求失败/断连」，不做语义评审。
3. **记录行**：`seat_id × model_id × gateway × max_passing_bytes × measured_at`。
   模型或网关变更即重标（旧行保留，供回归对照）。
4. **标定表（种子行，本协议落档时的实测值）**：

| seat_id | model_id | gateway | max_passing_bytes | last_fail_bytes | measured_at |
|---|---|---|---|---|---|
| architecture | g-glm-5.3-flash | whalecloud | 26624 | 36897 | 2026-10-05 |
| technical | s-glm-5.3-flash | whalecloud | ≥36864（未测出上界） | — | 2026-10-05 |

### 2.3 runner schema（`.delphi-config.json` expert 条目新增可选字段）

```json
{
  "experts": {
    "architecture": {
      "provider": "whalecloud",
      "model": "g-glm-5.3-flash",
      "seat_id": "architecture",
      "max_prompt_bytes": 26624,
      "prompt_calibration": {
        "measured_at": "2026-10-05",
        "model_id": "g-glm-5.3-flash",
        "gateway": "whalecloud",
        "last_pass_bytes": 26624,
        "last_fail_bytes": 36897
      }
    }
  }
}
```

- `max_prompt_bytes`（既有）：发送前硬闸，超限拒发（`prompt_budget_exceeded`）。
- `prompt_calibration`（新增）：失败分类的证据源。格式非法 → WARNING + 忽略，绝不静默采信。
- `seat_id`（新增）：错误输出与标定表的关联键，缺省回落 expert 角色。

### 2.4 SIZE_EXCEEDED 失败分类

- 触发：响应前断连（fetch 异常路径，`message === 'Network error.'` 且 `retryable` 为假）
  **且** 请求字节数 > 该席位标定的 `last_pass_bytes`。
- 输出：`error_type: "SIZE_EXCEEDED"`、`bytes`、`calibrated_pass_bytes`、`retryable: false`。
- 无标定记录或字节数未超标 → 维持 `network_error` / `retryable_error`，不猜。
- 错误类别可断言：编排层解析 stdout JSON 的 `error_type` 字段，不解析散文。

### 2.5 降序裁剪顺序（编排协议，固化）

席位超限（`prompt_budget_exceeded` 或 `SIZE_EXCEEDED`）时按序裁剪，**每步只做一步**：

1. 去附录（探针填充、日志附录、非本轮必需的长引用）；
2. 去非本轮 AC 原文（只保留本轮评审涉及的验收标准原文）；
3. 去测试清单（测试文件枚举 → 文件数统计）；
4. 拆分两次调用（按 diff 范围对半，两份结果在同一报告内合并呈现）；
5. 仍失败 → `PROCESS_BLOCK` 交人裁定。**不得以两席结果冒充 3/3 共识。**

## 3. #414 — Qoder 双通道

SKILL.md Qoder 节已明确 native 路径做不到 distinct models（2026-09-23 复测：
subagent 派发采纳 Custom Agent 提示词但丢弃 model 绑定）。本 sprint 的增量：

- **通道契约**：评审开始探测（Custom Agent 可用且三绑定互异 → native；否则 external）。
  鉴于实测证据（native 永远同模型），Qoder 的探测结论恒为 external，
  契约上仍保留探测-降级结构以对齐 #443 的同构协议。
- **安装链**：`xp-gate install --platform qoder`（官方化 skills 分发）、
  `doctor delphi`（agent hash / config ping / Node≥18）、`delphi-setup`（交互式绑三模型 + 重载提醒）。
- **REQ-5 重试**：verdict 不合 schema 自动收紧重试恰好 1 次。
- 硬约束：Gate MW 校验器零改动；OpenCode 分支零改动。

## 4. #443 — DSH 双通道

与 #414 同构：探测 `subagent` 是否暴露 `provider` 参数且 `allowedModels` ≥3 条互异
（两层开关：preset 能力 + host 设置 `SubagentModelSelectionConfig.enabled`）。
可用 → native；否则降级 external（`delphi-external-review.cjs` + `.delphi-config.json`）。
两通道同不变量：三专家齐全、`requested_model` 互异、consensus ≥90%、无单专家路径。
降级证据（`channel`/`fallback_reason`/`probe_evidence`）落盘 `delphi-reviewed.json`。
doctor 增加 DSH 检查项。SKILL.md DSH 节已有插件工具路径说明，本 sprint 补探测与降级语义。

## 5. 验证策略

- 沙箱实测备忘（backlog §3）：本地 vitest 部分伪红，以目标文件单跑 + CI 权威判定。
- 走查：外部三模型 Delphi（WHALECLOUD_API_KEY 就绪），证据 `.code-walkthrough-result.json`。
- 发布：VERSION bump → CHANGELOG → 12 门禁 commit → push → CI 三包 + tag + Release。
