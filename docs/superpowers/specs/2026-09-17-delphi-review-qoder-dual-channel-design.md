# Delphi Review Qoder 双通道适配设计（内置优先 + 外部 API 降级）

**日期**: 2026-09-17
**状态**: Draft v1（待 delphi-review）
**平台影响**: Qoder（主要）；OpenCode 与 Gate MW 校验器零改动
**前序设计**: `2026-07-21-delphi-review-qoder-cross-model-design.md`（本文档继承其外部 API 通道设计，并修正其"仅 OpenCode 可用"的分支归属）

---

## 问题陈述

delphi-review 在 Qoder 平台的官方执行路径是 **Custom Agent 模式**：`plugins/qoder/agents/delphi-*.md` 三个 agent 各钉一个 Qoder 内置模型名（当前为 `Qwen3.7-Max` / `GLM-5.2` / `DeepSeek-V4-Pro`）。

该设计存在**单点失效**：Qoder 的内置模型列表随 IDE 版本漂移，agent 文件中的模型名是历史快照；一旦失效，SKILL.md 契约（"三个 Custom Agent 必须全部成功返回，否则 BLOCK，无单专家路径"）使 Qoder 上的 delphi-review **整体瘫痪且无降级路径**。

同时存在**分发断点**：Qoder 用户没有官方的 skill 安装通道；`xp-gate init` 部署 agent 采用"幂等不覆盖"，重跑无法修复过期模型名。

以下事实全部来自 2026-09-15/17 在 Windows + Qoder 环境的实测（证据见附录 A）。

### 实测确认的 4 处断点

| # | 断点 | 证据 |
|---|------|------|
| B1 | **Qoder skill 无官方安装路径**：`install-delphi-review.sh` 只写 `~/.config/opencode/skills/`；`init.js` 只部署项目级 `.qoder/agents/`，不部署 skill | 安装脚本全文无 qoder 目标；用户机 `~/.qoder/skills/delphi-review/` 仅有手工拷贝的孤立 SKILL.md，缺 INSTALL.md / references / config.example |
| B2 | **agent 模板模型名随 Qoder 版本漂移失效，且无修复机制** | dispatch `delphi-*` agent 报 `model ... not found`；`configureQoderDelphiAgents()` 对已存在文件跳过（"Don't overwrite user customizations"），重跑 init 不修复 |
| B3 | **Qoder 分支 SKILL.md 未接线外部 API 通道**：0.19.1 的 `delphi-external-review.cjs` 功能已完全满足 Qoder 需要（provenance 字段 / verdict schema / 同 provider 放行），但 SKILL.md 把该脚本归为"OpenCode 平台专用"，Qoder 分支只写 Custom Agent | 0.19.1 SKILL.md L334-352：Qoder=Custom Agent，OpenCode=Bash 调脚本 |
| B4 | **仓库/发布版脱同步**：本地仓库 main 曾停在 0.14.30，npm 已发 0.19.1；从旧仓库"重装"实为降级 | 0.14 脚本无 `requested_model`/`result_type` 字段、保留已被 0.19 废弃的 `local` fallback、同 provider 三专家会被 BLOCK——与 0.19 行为相反 |

### B4 补充说明

`origin/main` 已确认 = 0.19.1.0（与 npm 发布一致）。B4 的实质是**用户本地克隆落后**+缺少"安装物与发布版一致性"的校验手段，而非发布流程错误。因此 R6 定义为"可检测"而非重建发布流程。

---

## 目标 / 非目标

### 目标

1. Qoder 上 delphi-review 恢复**多模型交叉评审**能力：内置模型可用时优先内置；不可用时自动降级外部 provider，评审不中断
2. 结果**稳定可预期**：两通道遵守同一证据契约，产物均可通过 Gate MW 校验；模型输出不合 schema 时有确定性的重试行为
3. 提供官方安装与自检修复路径，消除手工拷贝
4. 以本仓库视角固化需求（REQ-1..REQ-6 + 验收标准），作为 GitHub issue 的正文来源

### 非目标

- ❌ 不修改 Gate MW 校验器（`validate-code-walkthrough.cjs`）——两通道产物均满足其现有 schema
- ❌ 不修改 OpenCode 执行方式（opencode.json agent + Task 调用保持原样）
- ❌ 不维护"Qoder 版本 → 有效模型列表"自动映射表（Qoder 无公开查询 API，人工映射必滞后；由 REQ-4 的交互式 `delphi-setup` 替代）
- ❌ 不恢复 `provider: "local"` 混合模式（0.19 已废弃：Gate MW 要求三个互异真实模型，orchestrator 扮演专家无法满足 provenance 审计）
- ❌ 不引入新外部依赖、不新增常驻服务

---

## 方案总览：双通道 + 运行时探测

```
/delphi-review (Qoder)
  │
  ├─ Step 0: Input Validation（不变）
  │
  ├─ Phase 0: Channel Selection（新增）
  │     dispatch 3 个 delphi-* Custom Agent，各发一条探测请求（"仅回复 OK"，并行）
  │     ├─ 3/3 成功且三个 agent 的 model 名互异 ────────→ channel = native
  │     └─ 任一失败 / 超时 / 模型名 not found / 模型名重复 → channel = external
  │          前置检查：脚本定位（node_modules → npm global → repo）
  │                    + .delphi-config.json 存在且 ping 通过
  │          若 external 前置检查也失败 → [DelphiReview:BLOCKED] 双通道证据 + doctor 提示
  │
  ├─ Round 1-3 + 共识计算（两通道同契约，仅执行器不同）
  │     native:   Agent tool dispatch（现状）
  │     external: Bash: node delphi-external-review.cjs --expert <role> ...（3 专家并行）
  │
  └─ 输出：共识报告 + specification.yaml / .code-walkthrough-result.json
        + delphi-reviewed.json 新增 channel / fallback_reason / probe_evidence 字段
```

---

## 组件设计

### REQ-1 SKILL.md Qoder 分支双通道契约

**变更对象**: `plugins/qoder/skills/delphi-review/SKILL.md`（及 npm 镜像、主 `skills/delphi-review/SKILL.md` 的 Qoder 段落）

1. "模型选择策略"改为通道决策表（native → 探测 → external → BLOCKED），删除"Qoder 平台（推荐 — Custom Agent 模式）"的单通道表述
2. **两通道共同不变量**（写死在 SKILL.md，与 Gate MW 对齐）：
   - 三个专家角色齐全（architecture / technical / feasibility）
   - 三个 `requested_model` 非空且互异（native 通道取自 agent 文件 `model:` 字段；external 通道由脚本输出）
   - consensus ≥ 90%、全 APPROVED 才可终止；Critical/Major 零容忍
   - 无单专家审批路径（维持现状）
3. **探测规范**：每轮评审开始时执行一次（非每 Round）；探测 dispatch 使用与正式评审相同的 agent，指令固定为单行 ping；任一 agent 报错（含 `model not found`）、超时（默认 60s，可配 `probe_timeout_seconds`）或返回非 OK 视为该 agent 不可用
4. **降级证据落盘**（防"借降级之名跳过三模型"）：`.sprint-state/delphi-reviewed.json` 新增字段
   ```json
   { "channel": "external",
     "fallback_reason": "agent delphi-technical: model 'GLM-5.2' not found",
     "probe_evidence": [ {"agent": "delphi-architecture", "ok": true}, ... ] }
   ```
5. Anti-patterns 表新增两行：
   - native 探测未执行就选通道 → BLOCK
   - `channel=external` 但无 probe_evidence/fallback_reason → 校验提示（Gate MW 不改动，靠 SKILL 契约 + doctor 检查）

### REQ-2 `xp-gate install --platform qoder`（官方 skill 分发）

**变更对象**: 新 CLI 子命令（`src/npm-package/lib/` + bin dispatcher）

- 将包内 `plugins/qoder/skills/*` 安装到 `~/.qoder/skills/`（当前仅 delphi-review、sprint-flow 等已随包分发的 skills）
- 行为：版本比对（目标目录有 `.installed-version` 标记则跳过/升级）；`--force` 先备份再全量覆盖（对齐既有 issue #349 的 install-skill 备份语义）
- 不覆盖用户已编辑的文件时输出差异提示而非静默跳过（吸取 B1/B2 教训：静默幂等掩盖了过期）
- `install-delphi-review.sh` 增加同样的 qoder 分支（bash 脚本与 CLI 行为一致）

### REQ-3 `xp-gate doctor delphi [--fix]`（自检）

**变更对象**: doctor 子命令新增 delphi 检查组

| 检查项 | 内容 | --fix 行为 |
|--------|------|-----------|
| agent 模型名 | 3 个 agent 文件存在、`model:` 非空、互不相同 | 引导运行 delphi-setup |
| skill 版本 | `~/.qoder/skills/delphi-review` 与已安装 npm 包内插件文件 hash 一致 | 重放 install --platform qoder |
| external 通道 | 脚本三级定位成功；`.delphi-config.json` 解析通过；Node ≥ 18；对 active_profile 做一次 1-token ping | 输出定位结果与配置修复指引 |
| 证据文件 | 最新 `.code-walkthrough-result.json` / `delphi-reviewed.json` 的 channel 字段与 schema 完整 | 提示重跑评审 |

### REQ-4 `xp-gate delphi-setup`（内置模型的交互式配置，方案 C′）

- 交互式引导：提示用户打开 Qoder 模型下拉菜单，逐个输入 3 个**互不相同**的当前有效内置模型名（校验：非空、两两不同）
- 写入 `.qoder/agents/delphi-{architecture,technical,feasibility}.md` 的 `model:` 字段（项目级优先，`--global` 写 `~/.qoder/agents/`）
- 完成后输出**必须重载 IDE 窗口**的提醒（Qoder 对 agent 定义做内存缓存，改文件不重载不生效——实测确认）
- 支持 `--list-current` 只读展示当前三模型

### REQ-5 脚本稳定性：verdict schema 失败自动收紧重试

**变更对象**: `scripts/delphi-external-review.cjs`（0.19.1 已含 provenance/schema 校验，本 REQ 只加重试）

- 现状：模型返回不合 schema → 直接输出 `delphi_expert_error`（实测 g-qwen3.8-flash 存在偶发不合 schema，g-deepseek-flash 稳定）
- 变更：`Invalid expert verdict` / `parse_error` 时**自动重试 1 次**——在 user prompt 末尾追加显式 JSON schema 重申，其余参数不变（温度维持 0.3；评审类调用遵循低温度原则）；重试输出新增 `"retry": 1` 标记
- 再失败才返回 `delphi_expert_error`（Orchestrator 按契约重试或 BLOCK）
- 每次脚本调用输出一行结构化执行日志（stdout 单行 JSON：role/model/verdict/retry/latency），供审计与稳定性度量

### REQ-6 仓库/发布版一致性可检测

- `scripts/sync-version.sh`（或 CI）增加检查：`VERSION` / `package.json` / `plugins/qoder/plugin.json` / npm 最新发布版一致性；不一致时 doctor 的"skill 版本"检查项给出明确提示
- 文档要求：用户侧一律以 `npm install -g @boyingliu01/xp-gate` + `xp-gate install --platform qoder` 为安装路径，从源码仓库重装前必须 `git pull`（INSTALL.md 增加醒目说明）

---

## 与 2026-07-21 设计的关系

07-21 spec 的外部 API 通道设计（`.delphi-config.json` profiles、脚本 CLI、4 层 JSON 容错、分级重试）**全部继承**，两处修正：

| 07-21 原设计 | 本设计 | 原因 |
|--------------|--------|------|
| `delphi-external-review.cjs` 仅 OpenCode 分支使用 | Qoder external 通道复用同一脚本 | 0.19.1 脚本产出即 Gate MW 契约格式，与平台无关 |
| `provider: "local"` 混合模式合法 | 废弃（0.19 行为固化为规范） | orchestrator 扮演专家无法提供真实 provenance，违背交叉评审目的 |

## 文件变更清单

| 文件 | 操作 | REQ |
|------|------|-----|
| `plugins/qoder/skills/delphi-review/SKILL.md` | 修改：双通道契约 | R1 |
| `skills/delphi-review/SKILL.md` + `src/npm-package/` 镜像 | 同步 Qoder 段落 | R1 |
| `src/npm-package/lib/install-qoder.js` + bin | 新增 install --platform qoder | R2 |
| `scripts/install-delphi-review.sh` | 增加 qoder 分支 | R2 |
| `src/npm-package/lib/doctor-*.js` | delphi 检查组 | R3 |
| `src/npm-package/lib/delphi-setup.js` + bin | 新增 | R4 |
| `scripts/delphi-external-review.cjs` | schema 失败重试 + 结构化日志 | R5 |
| `scripts/sync-version.sh` / CI | 版本一致性检查 | R6 |
| `plugins/qoder/skills/delphi-review/INSTALL.md` | 安装路径说明重写 | R2/R6 |
| `plugins/qoder/agents/delphi-*.md` | 模板 `model:` 注释说明"以 delphi-setup 为准" | R4 |

## 测试计划

| 层 | 内容 |
|----|------|
| 单元 | 通道决策表（探测全通/部分失败/超时/模型名重复 → native/external/BLOCKED）；REQ-5 重试路径（mock 不合 schema 响应 → 断言恰好 1 次重试、retry 标记）；delphi-setup 模型名互斥校验；doctor 各检查项 |
| 集成 | external 通道端到端（mock provider）产物字段逐一过 `validate-code-walkthrough.cjs`；install --platform qoder 幂等 + --force 备份 |
| 手动验收 | Qoder 内：① 内置模型有效时全流程 native 评审；② 故意写坏一个 agent 模型名 → 自动降级 external 且证据落盘；③ delphi-setup 配置 + 重载 IDE → 通道回归 native |

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 探测消耗少量 Credits / 延迟数秒 | 每轮评审仅一次（非每 Round）；doctor 可预先验证使用户跳过 surprises；用户已确认接受（2026-09-17） |
| Qoder agent 缓存导致"改完即探"误报 | delphi-setup 显式提醒重载 IDE；探测失败信息中附带"若刚修改过模型配置，请先重载 IDE"提示 |
| 外部通道依赖 API key 可用性 | external 前置 ping 失败即 BLOCKED（评审开始前暴露，不中途失败） |
| 模型输出稳定性差异（qwen 类偶发不合 schema） | REQ-5 收紧重试；结构化日志积累各模型合格率数据 |

---

## 附录 A：实测证据（2026-09-15/17，Windows + Qoder + whalecloud proxy）

1. `xp-gate init` 部署函数 `configureQoderDelphiAgents()`：模板源 `plugins/qoder/agents/`，模型即 `Qwen3.7-Max/GLM-5.2/DeepSeek-V4-Pro`；目标已存在则跳过
2. dispatch delphi-* agent：`model ... not found`（旧名失效）；改文件后未重载 IDE 时仍解析旧缓存值，重载后报新值 → B2 + 缓存陷阱
3. npm 全局 `@boyingliu01/xp-gate@0.19.1` 的 `delphi-external-review.cjs`（563 行）：输出含 `requested_model`/`resolved_model`/`result_type`；`local` 被判 `must define a non-local callable provider`；`cross_provider_required` 降级为 warning（同 provider 放行）
4. 真实调用（whalecloud, temperature 0.3, response_format=json_object）：
   - `g-deepseek-flash` → `result_type=delphi_expert_result`，schema 完整 ✅
   - `g-qwen3.8-flash` → 一次 `delphi_expert_error: Invalid expert verdict.`（→ REQ-5）
5. 重装前后对比：`~/.qoder/skills/delphi-review/` 原仅 1 个 SKILL.md（内容与任何官方源均不匹配，系手工拷贝且混入未回灌仓库的新改动）→ 证实 B1 与 B4 的双向漂移
6. 仓库基线：本地 main 曾停 0.14.30（0.14 脚本行为与 0.19 相反：同 provider BLOCK、支持 local、无 provenance 字段）；`origin/main` = 0.19.1.0 与 npm 一致

## 需求受理记录（issue 正文摘要）

> **Title**: Qoder 平台 delphi-review 双通道适配（内置模型优先 + 外部 API 降级）+ 安装/自检链路补全
> **Labels**: enhancement, delphi-review, qoder
> **Body**: 问题 = B1..B4（附实测证据）；方案 = REQ-1..REQ-6；验收 = 手动验收三条 + 测试计划全绿；Gate MW 与 OpenCode 零改动为硬约束。
