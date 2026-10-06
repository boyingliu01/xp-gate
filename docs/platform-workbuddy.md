# WorkBuddy 平台适配指南：以 Expert 团队机制承载 delphi-review

> 2026-09-29 实测整理。背景：xp-gate 原始设计面向 opencode + token plan（一个接入点提供多模型）场景；WorkBuddy 的 **Expert（专家团）机制 + 内置多厂商模型池** 更接近 delphi-review 的原始设计意图——每个专家绑定一个可执行的 distinct model ID，由平台统一计费与路由。

## 一、为什么 WorkBuddy 路线值得做

| 对比维度 | opencode（External API） | Qoder（Custom Agent） | WorkBuddy（Expert 团队） |
|---------|--------------------------|----------------------|--------------------------|
| 三 distinct models | ✅ `.delphi-config.json` 直连 | ❌ subagent 丢弃 model 绑定（见 SKILL.md Qoder 节实测） | ✅ Agent 子代理 `model` 参数 |
| 模型来源 | 用户自配外部 provider | 平台内置（无法多模型） | 平台内置多厂商（DeepSeek/智谱/混元/Kimi…） |
| 计费 | 自有 API key | Qoder Credits | WorkBuddy credits（倍率制，x0.00~x0.79） |
| 执行验证 | provider 调用日志 | 会话分段 jsonl | ⚠️ 暂缺（见第四节） |
| 触发方式 | `/delphi-review` | `/delphi-review` | 技能触发词自动加载 + sprint-flow 串联 |

低成本参考组合（3 家不同厂商，合计 x0.17/轮）：`deepseek-v4.1-flash`(x0.11) + `glm-5.3-flash`(x0.06) + `hy3`(x0.00 免费)。主理人跑会话模型 `local-*`（走企业网关）则零 credits。

## 二、Expert 团队创建方式（Team 型专家包）

WorkBuddy 专家包 = `.codebuddy-plugin/plugin.json` + `agents/*.md` + `skills/`，可用内置 `expert-manager` 技能的脚本链创建：

```bash
# 1. 初始化 Team 型骨架
python <expert-manager>/scripts/init_expert.py delphi-review-team --type team --path \
  ~/.workbuddy/plugins/marketplaces/my-experts/plugins

# 2. 填充内容（模板见 docs/workbuddy-templates/）
#    agents/delphi-review-team-team-lead.md   主理人（编排 + 共识统计）
#    agents/delphi-arch-reviewer.md           构远图 · 架构视角
#    agents/delphi-tech-reviewer.md           严码关 · 技术视角
#    agents/delphi-feasibility-reviewer.md    稳落地 · 可行性视角
#    skills/delphi-review/SKILL.md            团队执行细则（Delphi SOP）

# 3. 校验 → 注册 → 打包
python <expert-manager>/scripts/validate_expert.py <专家目录>
python <expert-manager>/scripts/register_expert.py <专家目录>
python <expert-manager>/scripts/package_expert.py <专家目录> <输出目录>
```

**模型绑定的平台限制**：WorkBuddy 专家包规范（agent-md/team-spec/plugin-json）**均不支持给 agent 声明 model 字段**。专家团成员的模型绑定通过运行时派发实现——主理人 spawn 子代理时在 `Agent` 工具的 `model` 参数中传入模型 ID。主理人自身跑在会话模型上，专家包内以「固定模型 + 开场自检」的软约束声明（本例为 `local-deepseek-v4-flash`）。

完整可拷贝模板：[`docs/workbuddy-templates/`](./workbuddy-templates/)（不含头像，头像可后补到 `avatars/`）。

## 三、技能层适配（skills/delphi-review/SKILL.md）

在「模型选择策略（强制 — 平台适配）」下新增 `#### WorkBuddy 平台（Expert 团队模式）` 节（与本文件同 PR）：

- 触发路由：WorkBuddy 用户级技能目录（`~/.workbuddy/skills/`）中的 delphi-review 技能由触发词自动加载（`/delphi-review`、`delphi评审`、`多专家评审` 等），触发后按 WorkBuddy 节路由到专家团。
- 派发：已启用专家团 → 按团队机制 spawn 成员；未启用 → `Agent` 工具并行 spawn 3 个 `general-purpose` 子代理，prompt = 专家 MD 全文人设 + 匿名评审模板。

## 四、执行验证：WorkBuddy 现状与过渡标准（2026-09-29 校准实验）

| 层级 | 结论 | 证据 |
|------|------|------|
| 参数层路由 | ✅ 通过 | `model` 参数传 `deepseek-v4.1-flash` / `glm-5.3-flash` / `hy3`，3 个 general-purpose 子代理并行执行成功，无回落报错 |
| 执行层证据 | ⚠️ 平台暂缺 | `~/.workbuddy/audit-log/*.jsonl` 只记 command-safety 事件，无 per-request 模型路由记录；不像 Qoder（`segments/*.jsonl` 的 `model.request.started`）或 opencode（provider 调用日志）可取证 |

**WorkBuddy 过渡验证标准**（已写入 SKILL.md WorkBuddy 节）：

1. 参数级校准：model ID 被平台接受且子代理成功执行
2. 专家 `requested_model` 自述如实记录，报告注明「执行层验证待平台日志支持」
3. `model` 参数被拒绝/回落会话模型时，按 Failure Handling 处理，**不得静默降级冒充三模型共识**
4. 需要严格证据时走外部 provider 兜底（`.delphi-config.json` + 兼容 API）

## 五、sprint-flow 自动调用链路评估

sprint-flow（v2.1.0）在 DESIGN(R1 需求/R2 设计) 与 VERIFY(code-walkthrough) 阶段经 `Skill` 工具自动调用 delphi-review。WorkBuddy 侧链路逐环节状态：

| 环节 | 状态 | 说明 |
|------|------|------|
| 技能装载 | ✅ | sprint-flow + delphi-review 均在 `~/.workbuddy/skills/`，触发词自动加载 |
| Skill 串联 | ✅ | `Skill` 工具语义与 sprint-flow 的调用约定兼容 |
| 多轮自动循环 | ✅ | orchestrator-dispatch.md 的 subagent 内自动循环是平台无关 SOP |
| 产物与门禁 | ✅ | `.sprint-state/delphi-reviewed.json` 等均为文件机制，DELPHI-GATE 可用 |
| 专家派发 | ✅（参数层） | 见第四节校准实验 |
| 执行验证 | ⚠️ 阻塞点 | 平台无 per-request 模型日志，按 SKILL.md 原规则「unverifiable execution blocks the review」，DELPHI-GATE 可能被 BLOCK；过渡标准见第四节 |

**结论**：链路能走通到派发与轮次循环，唯一硬卡点是执行验证的证据源。三个解决方向（按优先级）：

1. **WorkBuddy 侧**：提供 per-request 模型路由日志（类似 Qoder 的 `model.request.started` 事件）
2. **xp-gate 侧**：将本文档第四节的「过渡验证标准」正式化为 WorkBuddy 平台的验证规则
3. **用户侧**：严格场景走外部 provider 兜底路径

## 六、遗留事项

- [ ] WorkBuddy 执行层验证的证据源（等待平台日志能力或社区确认其他日志位置）
- [ ] `hy3` 免费档在高峰期的排队情况对评审时长的影响待观察
- [ ] xp-gate 重装/升级可能覆盖用户级 SKILL.md 的 WorkBuddy 节（init「已存在不覆盖」语义下的边界情况）
- [ ] WorkBuddy MCP/插件市场若支持分发专家包，可考虑将 `docs/workbuddy-templates/` 做成可安装产物
