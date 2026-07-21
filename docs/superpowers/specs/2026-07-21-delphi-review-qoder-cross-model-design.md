# Delphi Review Qoder 跨模型评审设计

**日期**: 2026-07-21
**状态**: Draft v2 (post-delphi-review)
**作者**: AI-assisted design

## 问题陈述

Delphi Review 的核心价值在于**跨模型、跨 provider 的多专家交叉评审**。在 OpenCode 中，通过 `opencode.json` 为每个 `delphi-reviewer-*` subagent 配置不同模型，天然支持跨模型评审。

但在 Qoder 中，一个会话只能使用当前配置的单一模型。调用 delphi-review 时，3 个"专家"实际由同一模型扮演不同角色，认知多样性不足，交叉评审效果显著弱化。

**目标**：让 delphi-review 在 Qoder 中也能实现真正的跨模型评审，同时保持 skill 的自包含性和可移植性。

## 解决方案：外部 API 直接调用

### 架构概览

```
Qoder 会话 (当前模型 - Orchestrator)
    │
    ├─ Step 0: Input Validation (Orchestrator 自身)
    ├─ 读取 .delphi-config.json → 获取 active_profile → 提取 3 个专家的 API 配置
    │
    ├─ Round 1: 并行调用 3 个外部模型 API（通过 Bash 工具）
    │   ├─ node <script-path> --expert architecture --input-file ... --round 1 ...
    │   ├─ node <script-path> --expert technical --input-file ... --round 1 ...
    │   └─ node <script-path> --expert feasibility --input-file ... --round 1 ...
    │   → 对 fallback=true 的专家，Orchestrator 自身模型扮演
    │
    ├─ Consensus Check: Orchestrator 汇总 3 份 JSON verdict，计算共识度
    │
    ├─ Round 2 (如需): 将其他专家意见写入文件，再次并行调用
    │
    ├─ Round 3 (如需): 最终立场
    │
    └─ 输出: 共识报告 + specification.yaml / .code-walkthrough-result.json
```

**关键设计决策**：

| 决策 | 选择 | 理由 |
|------|------|------|
| 配置文件位置 | `skills/delphi-review/.delphi-config.json` | 与 SKILL.md 同目录，skill 自包含，拷贝即迁移 |
| API key 存储 | 配置文件中明文 | 用户明确要求不依赖环境变量；.gitignore 保护 |
| 多方案切换 | profiles 机制 + `--profile` CLI 覆盖 | 类似 OpenCode 的 coding plan 切换体验 |
| API 格式 | OpenAI-compatible `/chat/completions` | 国内模型（DeepSeek/Qwen/GLM）均支持此格式 |
| 脚本位置 | `scripts/`（源码）+ `src/npm-package/scripts/`（分发） | 源码在 scripts/，npm 打包时复制，安装时部署到用户项目 |
| 并行调用 | 3 个 Bash 同时发起 | Round 1 专家互不知对方意见，可并行 |
| 大文件传递 | `--input-file <path>` 文件路径 | 避免 shell 参数长度限制 |
| 跨轮数据传递 | `--other-experts-file <path>` 文件路径 | 避免 shell 中 JSON 转义问题 |
| 混合模式 | provider="local" fallback | 支持渐进式配置，未配外部 API 的专家由 Orchestrator 扮演 |

## 组件详细设计

### 1. 配置文件 `.delphi-config.json`

**位置**: `skills/delphi-review/.delphi-config.json`（与 SKILL.md 同目录）

**结构**:

```json
{
  "active_profile": "default",
  "profiles": {
    "default": {
      "providers": {
        "deepseek": {
          "base_url": "https://api.deepseek.com/v1",
          "api_key": "sk-xxx"
        },
        "zhipu": {
          "base_url": "https://open.bigmodel.cn/api/paas/v4",
          "api_key": "yyy"
        },
        "dashscope": {
          "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
          "api_key": "zzz"
        }
      },
      "experts": {
        "architecture": {
          "provider": "deepseek",
          "model": "deepseek-chat"
        },
        "technical": {
          "provider": "zhipu",
          "model": "glm-5.2"
        },
        "feasibility": {
          "provider": "dashscope",
          "model": "qwen-3.8-plus"
        }
      }
    }
  },
  "consensus": {
    "threshold_percent": 90,
    "max_review_rounds": 5
  }
}
```

**字段说明**:

| 字段 | 必填 | 说明 |
|------|------|------|
| `active_profile` | ✅ | 当前激活的配置方案名 |
| `profiles` | ✅ | 命名配置方案集合 |
| `profiles.<name>.providers` | ✅ | provider 定义：base_url + api_key |
| `profiles.<name>.experts` | ✅ | 专家到 provider/model 的映射 |
| `profiles.<name>.experts.<role>.provider` | ✅ | provider 名称，或 `"local"` 表示由 Orchestrator 自身模型扮演 |
| `consensus.threshold_percent` | ❌ | 共识阈值，默认 90 |
| `consensus.max_review_rounds` | ❌ | 最大评审轮数，默认 5 |

**切换方案**: 修改 `active_profile` 值，或通过 `--profile <name>` CLI 参数临时覆盖。

**安全**: `.delphi-config.json` 已在项目 `.gitignore` 中（第 16 行），API key 不会被提交。skill 目录中只提交 `.delphi-config.json.example` 模板。

### 2. 脚本 `scripts/delphi-external-review.js`

**功能**: 接收评审内容和专家角色，调用外部模型 API，返回结构化评审 JSON。

**分发策略**:
- **源码位置**: `scripts/delphi-external-review.js`（xp-gate 仓库）
- **npm 分发**: 打包时复制到 `src/npm-package/scripts/delphi-external-review.js`，随 npm 包安装到用户项目
- **路径解析**: SKILL.md 中 Orchestrator 按以下优先级定位脚本：
  1. 用户项目中的 `node_modules/@boyingliu01/xp-gate/scripts/delphi-external-review.js`（npm 安装后）
  2. 全局安装的 `$(npm root -g)/@boyingliu01/xp-gate/scripts/delphi-external-review.js`
  3. xp-gate 仓库中的 `scripts/delphi-external-review.js`（开发环境）
- **配置文件路径**: `--config` 参数指向 `.delphi-config.json`，Orchestrator 按以下优先级定位：
  1. 当前项目 `skills/delphi-review/.delphi-config.json`（Qoder 已安装 skill）
  2. `~/.qoder/skills/delphi-review/.delphi-config.json`（全局安装）

**命令行接口**:

```bash
node <script-path> \
  --expert architecture \
  --input-file "design-doc.md" \
  --round 1 \
  --config "skills/delphi-review/.delphi-config.json" \
  --mode design \
  --profile default \
  --other-experts-file "/tmp/delphi-round1-verdicts.json"
```

**参数说明**:

| 参数 | 必填 | 说明 |
|------|------|------|
| `--expert <role>` | ✅ | 专家角色：architecture / technical / feasibility |
| `--input-file <path>` | ✅* | 评审内容文件路径（与 --input 二选一） |
| `--input <text>` | ✅* | 评审内容直接文本（短内容可用） |
| `--round <N>` | ✅ | 当前轮次（1/2/3） |
| `--config <path>` | ✅ | `.delphi-config.json` 路径 |
| `--mode <mode>` | ❌ | design（默认）或 code-walkthrough |
| `--profile <name>` | ❌ | 覆盖 active_profile（无需编辑文件即可切换方案） |
| `--other-experts-file <path>` | ❌ | Round 2+ 时，上一轮其他专家意见的 JSON 文件路径 |
| `--fallback-local` | ❌ | 当某专家未配置外部 API 时，输出 fallback 标记而非报错 |

**输出**: stdout 输出 JSON（stderr 用于日志）：

```json
{
  "expert_id": "A",
  "expert_role": "architecture",
  "model_used": "deepseek/deepseek-chat",
  "round": 1,
  "mode": "design",
  "verdict": "APPROVED",
  "confidence": 8,
  "critical_issues": [],
  "major_concerns": ["缺少对并发场景的考虑"],
  "minor_concerns": ["命名可以更清晰"],
  "summary": "整体架构合理，建议补充并发处理说明"
}
```

**混合模式输出**（provider="local" 时）:

```json
{
  "fallback": true,
  "expert_role": "feasibility",
  "reason": "local"
}
```

**实现要点**:

1. **配置读取**: 读取 `.delphi-config.json` → 获取 `active_profile`（或 `--profile` 覆盖）→ 找到对应 expert 的 provider + model
2. **混合模式处理**: 当 expert 的 provider 值为 `"local"` 时，直接输出 `{fallback: true}` JSON，不调用 API
3. **API 调用**: 使用 Node.js 内置 `fetch`（Node 18+），构造 OpenAI-compatible 请求：
   ```
   POST {base_url}/chat/completions
   Authorization: Bearer {api_key}
   Content-Type: application/json

   {
     "model": "{model}",
     "messages": [
       {"role": "system", "content": "{expert_system_prompt}"},
       {"role": "user", "content": "{review_content + other_experts_context}"}
     ],
     "temperature": 0.3,
     "response_format": {"type": "json_object"}
   }
   ```
4. **System prompt 内嵌**: 根据 expert 角色选择预定义的评审视角 prompt
5. **Round 2+ 注入**: 从 `--other-experts-file` 读取 JSON 文件内容，追加到 user prompt
6. **跨 provider 校验**: 启动时检查 experts 中至少 2 个不同 provider（按 base_url 判断，"local" 不计入），不满足则输出 error JSON 并退出（exit code 1）
7. **JSON 提取 — 多层容错**:
   - Layer 1: 直接 `JSON.parse(response.choices[0].message.content)`
   - Layer 2: 去除 markdown 代码块包裹（```json ... ```）后 parse
   - Layer 3: 正则提取第一个 `{...}` 块后 parse
   - Layer 4: 全部失败 → 输出 `{"parse_error": true, "raw_content": "..."}`，由 Orchestrator 决定是否重试
8. **错误处理 — 分级重试策略**:
   - 401/403: 不重试，输出 error + 配置检查提示
   - 429 (rate limit): exponential backoff 重试，最多 2 次（1s → 2s → 4s）
   - 500/502/503: 重试 1 次
   - 网络超时（>30s）: 重试 1 次
   - 余额不足: 不重试，输出明确错误信息

**内置 system prompt 模板**:

| 角色 | 核心指令 |
|------|---------|
| architecture | "你是架构评审专家。关注：1) 需求对齐度 2) 系统一致性 3) 模块边界清晰度 4) 架构演进性 5) 技术选型合理性。输出结构化 JSON verdict。" |
| technical | "你是技术实现评审专家。关注：1) 实现正确性 2) 代码质量和设计模式 3) 边界情况和错误处理 4) 性能影响 5) 可测试性。输出结构化 JSON verdict。" |
| feasibility | "你是可行性分析专家。关注：1) 实际约束（时间/资源/依赖）2) 风险识别和缓解 3) 执行复杂度 4) 替代方案 5) 回滚策略。输出结构化 JSON verdict。" |

### 3. SKILL.md 修改（Qoder 插件版本）

**核心变更**：

1. **移除** 所有 `opencode.json` agent 配置引用
2. **移除** `Task(subagent_type=delphi-reviewer-*)` 调用方式
3. **新增** 模型选择策略：从 `.delphi-config.json` 读取 API 配置
4. **新增** 执行方式：通过 Bash 工具调用 `delphi-external-review.js`
5. **新增** 混合模式：当某专家 provider="local" 时，Orchestrator 自身扮演

**修改后的执行流程**：

```
Step 0: Input Validation
  └─ Orchestrator 验证输入内容

Phase 0: 准备
  ├─ 定位脚本路径（按优先级查找 node_modules → global → repo）
  ├─ 读取 .delphi-config.json（按优先级查找项目 → 全局）
  ├─ 提取 active_profile 的 experts 配置
  ├─ 校验跨 provider 规则（脚本内部也会校验）
  └─ 将评审内容写入临时文件 /tmp/delphi-input.md

Round 1: 匿名独立评审（并行）
  ├─ Bash: node <script-path> --expert architecture --input-file /tmp/delphi-input.md --round 1 --config ...
  ├─ Bash: node <script-path> --expert technical --input-file /tmp/delphi-input.md --round 1 --config ...
  └─ Bash: node <script-path> --expert feasibility --input-file /tmp/delphi-input.md --round 1 --config ...
  → 收集 3 份 JSON verdict（或 fallback 标记）
  → 对 fallback=true 的专家，Orchestrator 自身模型扮演该角色并输出 verdict

Consensus Check
  └─ Orchestrator 解析 3 份 verdict，计算共识度

Round 2 (如需): 交换意见（并行）
  ├─ 将 Round 1 verdicts 写入 /tmp/delphi-round1-verdicts.json
  ├─ Bash: ... --expert architecture --round 2 --other-experts-file /tmp/delphi-round1-verdicts.json
  ├─ Bash: ... --expert technical --round 2 --other-experts-file /tmp/delphi-round1-verdicts.json
  └─ Bash: ... --expert feasibility --round 2 --other-experts-file /tmp/delphi-round1-verdicts.json

Round 3 (如需): 最终立场

Generate Output
  └─ 共识报告 + specification.yaml / .code-walkthrough-result.json
```

**tools_allowed 更新**:

```yaml
tools_allowed:
  - "Read"
  - "Glob"
  - "Grep"
  - "Bash(node <script-path> ...)"  # 调用外部模型 API
  - "Write(specification.yaml, .code-walkthrough-result.json, delphi-reviewed.json)"
  - "Skill"
  - "Question"
```

### 4. INSTALL.md 更新

**Quick Setup (3 steps)**:

1. 复制配置模板：`cp skills/delphi-review/.delphi-config.json.example skills/delphi-review/.delphi-config.json`
2. 编辑配置文件：填入 API endpoint 和 key
3. 确保 Node.js >= 18（脚本使用内置 fetch）

**渐进式配置示例**（混合模式）:

```json
{
  "active_profile": "starter",
  "profiles": {
    "starter": {
      "providers": {
        "deepseek": { "base_url": "https://api.deepseek.com/v1", "api_key": "sk-xxx" }
      },
      "experts": {
        "architecture": { "provider": "deepseek", "model": "deepseek-chat" },
        "technical": { "provider": "local" },
        "feasibility": { "provider": "local" }
      }
    }
  }
}
```

> 上例中只有 architecture 专家配置了外部 API，其他两位由 Orchestrator 自身模型扮演。这是合法的渐进式起步配置，但脚本会输出 WARNING 标注 confidence=low。

### 5. 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `scripts/delphi-external-review.js` | 新增 | 外部模型 API 调用脚本（源码） |
| `src/npm-package/scripts/delphi-external-review.js` | 新增 | npm 分发副本（prepack 时从 scripts/ 复制） |
| `scripts/sync-package-content.js` | 修改 | 增加 scripts/delphi-external-review.js 的复制逻辑 |
| `skills/delphi-review/.delphi-config.json.example` | 修改 | 更新为新配置格式（含 profiles + local fallback） |
| `plugins/qoder/skills/delphi-review/SKILL.md` | 修改 | 移除 opencode.json 引用，新增 Bash 调用流程 |
| `plugins/qoder/skills/delphi-review/INSTALL.md` | 修改 | 更新安装说明（含脚本定位逻辑 + 混合模式示例） |
| `plugins/qoder/skills/delphi-review/AGENTS.md` | 修改 | 更新模型选择策略说明 |
| `src/npm-package/skills/delphi-review/*` | 同步 | 与 plugins/qoder/ 对应文件保持一致 |
| `skills/delphi-review/SKILL.md` | 微调 | 模型选择策略增加 Qoder 分支说明 |
| `plugins/qoder/skills/sprint-flow/references/orchestration-rules.md` | 修改 | 更新 delphi-review 执行方式（Phase 2/4 从 subagent → Bash 调用） |

### 6. 与 OpenCode 的兼容性

**不影响 OpenCode 现有流程**。OpenCode 仍然通过 `opencode.json` agent 配置 + `Task(subagent_type=delphi-reviewer-*)` 方式运行。

**SKILL.md 双平台适配策略**：
- 主 SKILL.md（`skills/delphi-review/SKILL.md`）保持 OpenCode 方式为默认
- Qoder 版本的 SKILL.md（`plugins/qoder/skills/delphi-review/SKILL.md`）使用 Bash 调用方式
- 两者共享相同的核心方法论（评审流程、共识规则、输出格式），仅执行机制不同
- 维护策略：核心方法论变更时同步更新两份 SKILL.md；执行机制变更只影响对应平台版本

### 7. 错误处理与降级

| 场景 | 处理 |
|------|------|
| `.delphi-config.json` 不存在 | BLOCK + 提示用户复制模板并配置 |
| 脚本不存在（npm 未安装） | BLOCK + 提示运行 `npm install -g @boyingliu01/xp-gate` 或检查路径 |
| API key 无效（401/403） | 不重试，输出 error JSON + 提示检查配置 |
| Rate limit（429） | Exponential backoff，最多 2 次重试（1s → 2s → 4s） |
| 服务端错误（500/502/503） | 重试 1 次 |
| API 超时（>30s） | 重试 1 次，仍失败则输出 partial result |
| 余额不足 | 不重试，输出明确错误信息 |
| 模型返回非 JSON | 4 层容错提取（直接 parse → 去 markdown → 正则提取 → raw fallback） |
| 跨 provider 规则不满足 | BLOCK + 提示至少 2 个不同 provider |
| 仅配置了 1 个专家 | WARNING，允许执行但标注 confidence=low |
| 专家 provider 为 "local" | 混合模式：脚本输出 fallback 标记，Orchestrator 自身模型扮演该角色 |

### 8. 测试计划

| 测试类型 | 内容 | 位置 |
|---------|------|------|
| 脚本单元测试 | 配置读取、JSON 提取各层、参数解析、错误处理 | `scripts/__tests__/delphi-external-review.test.js` |
| API mock 测试 | 模拟各 provider 响应（正常/超时/429/500/非 JSON） | 同上 |
| 集成测试 | 端到端调用（需真实 API key，CI 中标记 skip） | `githooks/__tests__/delphi-integration.bats` |
| 跨 provider 校验测试 | 验证 2/3 不同 provider 规则 | 单元测试中覆盖 |
| 混合模式测试 | provider="local" 时 fallback 标记输出 | 单元测试中覆盖 |

## 非目标

- 不修改 OpenCode 的 delphi-review 执行方式
- 不引入新的外部依赖（脚本使用 Node.js 内置能力）
- 不创建 MCP server 或其他常驻服务
- 不修改 `.gitignore`（`.delphi-config.json` 已被忽略）

## Round 1 → v2 变更摘要

| # | 问题 | 解决方案 |
|---|------|---------|
| 1 | 脚本分发路径：npm 安装后用户无脚本 | 增加 `src/npm-package/scripts/` 分发副本 + `sync-package-content.js` 复制逻辑 |
| 2 | 路径解析依赖 cwd | 脚本按 3 级优先级自动定位（node_modules → global → repo）；配置同理 |
| 3 | JSON 响应提取不可靠 | 4 层容错策略（直接 parse → 去 markdown → 正则 → raw fallback） |
| 4 | 大文件通过命令行参数限制 | 新增 `--input-file <path>` 参数 |
| 5 | `--other-experts` shell 转义困难 | 改为 `--other-experts-file <path>` 文件路径 |
| 6 | 缺少渐进式迁移/混合模式 | 支持 `provider: "local"` fallback + `--fallback-local` 参数 |
| 7 | sprint-flow orchestration-rules 需同步更新 | 文件变更清单中增加该文件 |
