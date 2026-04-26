# Skill-Cert 评测引擎设计文档

> 日期：2026-04-26
> 状态：Delphi Round 3 评审中（已修复 Round 2 全部 5 个 Minor）

## 1. 概述

Skill-Cert 是一个通用的 AI Skill 评测引擎，接收任意 SKILL.md 文件，自动理解其意图、生成测试用例、执行评测、输出标准化报告。不依赖外部输入的 eval cases，引擎自主完成从分析到报告的全流程。

**目标用户**：公司内部 Skill 市场贡献者——任何人上传 skill 后，引擎自动评测其有效性、稳定性、多模型适配性，输出 PASS/FAIL 判定。

**核心能力**：
- 自解析：读取 SKILL.md 提取语义结构
- 自生成：LLM 自动生成测试用例（evals.json）
- 自审补缺：多模型审查覆盖度 → 渐进式补充
- 自执行：with/without-skill 交叉验证
- 自评估：L1-L4 四层指标 + 跨模型漂移检测

## 2. 架构设计

### 2.1 目录结构

```
skill-cert/
├── SKILL.md              # 评测编排入口（接收 skill_name 参数）
├── pyproject.toml        # Python 项目定义
├── engine/
│   ├── __init__.py
│   ├── analyzer.py       # 解析 SKILL.md → 结构化语义模型
│   ├── testgen.py        # 生成 + 自审 → evals.json
│   ├── runner.py         # 执行 eval cases（多模型并行）
│   ├── grader.py         # assertion 匹配 + LLM-as-judge
│   ├── metrics.py        # L1-L4 指标聚合
│   ├── drift.py          # 跨模型漂移检测
│   ├── reporter.py       # Markdown + JSON 报告
│   └── config.py         # ★ 新增：配置管理（API key、速率限制、超时）
├── adapters/
│   ├── base.py           # 抽象模型接口
│   └── openai_compat.py  # OpenAI 兼容协议
├── prompts/
│   ├── testgen.meta.md       # ★ v1.0 — 测试生成 meta prompt
│   ├── test-review.md        # ★ v1.0 — 测试审查 prompt
│   ├── test-gap.md           # ★ v1.0 — 差距分析 & 补充 prompt
│   ├── judge.md              # ★ v1.0 — LLM-as-judge prompt
│   └── drift-detect.md       # ★ v1.0 — 漂移检测 prompt
├── schemas/
│   ├── evals.schema.json
│   ├── grading.schema.json   # ★ 新增：grader 输出格式
│   ├── report.schema.json
│   └── benchmark.schema.json
├── templates/
│   └── minimum-evals.json    # ★ 新增：testgen 完全失败时的保底 eval 模板
└── docs/
    ├── methodology.md
    └── quickstart.md
```

### 2.2 运行方式

```bash
skill-cert --skill /path/to/SKILL.md [--models m1,m2] [--output ./results/]
```

### 2.3 数据流

```
SKILL.md → analyzer.py → 结构化语义模型（SkillSpec）
    ↓
testgen.py → 生成 evals.json（生成 → 自审 → 补缺 循环）
    ↓
runner.py → 执行 eval cases（多模型并行，带速率控制）
    ↓
grader.py → assertion 匹配 + LLM-as-judge → grading.json
    ↓
metrics.py → 消费 grading.json → L1-L4 指标聚合
    ↓
drift.py → 跨模型漂移检测 → drift-report.json
    ↓
reporter.py → Markdown + JSON 报告（含 PASS/FAIL verdict）
```

### 2.4 模块间数据契约

**SkillSpec**（analyzer.py → testgen.py）：
```json
{
  "name": "delphi-review",
  "description": "...",
  "triggers": ["评审", "review"],
  "workflow_steps": [{"name": "Phase 0", "type": "validation", "critical": true}],
  "anti_patterns": ["跳过Round 1"],
  "output_format": ["共识报告"],
  "examples": ["评审设计文档"],
  "content_length": 4523,
  "parse_method": "regex|llm|hybrid",
  "parse_confidence": 0.92
}
```

**grading.json**（grader.py → metrics.py）：
```json
{
  "eval_id": 1,
  "eval_name": "design-mode-full-review",
  "eval_category": "normal",
  "model": "qwen3.6-plus",
  "run": "with-skill",
  "assertions": [
    {"name": "round-1-executed", "type": "contains", "value": "Round 1", "passed": true, "weight": 1},
    {"name": "verdict-present", "type": "regex", "value": "(APPROVED|REQUEST_CHANGES)", "passed": true, "weight": 3}
  ],
  "judge_result": null,
  "pass_rate": 1.0,
  "weighted_score": 1.0,
  "error": null,
  "tokens_used": 3420
}
```

**judge_result 结构定义**（当 LLM-as-judge 被调用时）：
```json
{
  "passed": true,
  "confidence": 0.92,
  "reasoning": "输出包含 Round 1、Round 2 及 Terminal Check 所有关键步骤",
  "judge_version": "judge.md v1.0",
  "judge_model": "qwen3.6-plus"
}
```

断言类型完整列表：`contains`、`not_contains`、`regex`、`starts_with`、`json_valid`。

**metrics.py 维度映射规则**：
- L1：筛选 `eval_category == "trigger"` 的 grading 记录，计算准确率
- L2：对比 `run == "with-skill"` vs `run == "without-skill"` 的 `weighted_score` 差值
- L3：遍历 `workflow_steps`，检查每个 critical step 是否在至少一个 passing eval 的 output 中被引用
- L4：对同一 eval_id 多次运行的 `pass_rate` 计算标准差，**排除 judge_result 的影响**（L4 仅测量 skill 执行输出的确定性断言 pass_rate 方差，不依赖 LLM-as-judge 判定，确保 judge 不稳定不污染 skill 稳定性指标）

## 3. 评测流程（7 Phase）

### Phase 0: Skill 解析（analyzer.py）

**输入**：SKILL.md 文件路径
**输出**：SkillSpec JSON

**解析策略**：
1. 提取 YAML frontmatter（name, description）
2. 正则匹配 `## Workflow` / `## Process` / `## Flow` / `## Core Workflow` 区块
3. 提取 Anti-Patterns / Red Flags 表格
4. 提取 Output Format / Checklist
5. 从 description 推断触发关键词

**鲁棒性保障（修复 Critical #5）**：
- 正则提取后计算 `parse_confidence`（基于提取到的关键字段比例）
- **AST 结构校验中间层**：使用 `markdown-it-py` 解析 SKILL.md 为 AST，验证正则提取到的章节标题是否真实存在于文档结构中，防止"错误提取 + 高置信度"的假阳性
- `parse_confidence < 0.6` **或** AST 校验失败时 fallback 到 LLM 辅助解析：发送 SKILL.md 给强模型，要求其输出 SkillSpec JSON
- 超长 SKILL.md（> 8000 tokens）采用分段提取：先提取 summary，再针对缺失部分二次请求
- 记录 `parse_method`（regex / llm / hybrid）和 `content_length`

### Phase 1: 测试生成 + 自审循环（testgen.py）

**核心**：生成 → 审查 → 补缺 → 审查... 直到覆盖度达标

**Step 1a — 初始生成**：
- 将 SkillSpec + `testgen.meta.md`（v1.0）发送给强模型
- 生成初始 evals.json（normal/boundary/failure + trigger evals）
- 最低要求：4 个 eval case + 5 个 should_trigger + 5 个 should_not_trigger

**Step 1b — 审查**：
- 用另一个模型（不同 provider）审查 evals.json
- 审查维度：场景覆盖度、边界覆盖度、可验证性、触发词充分性
- 输出：覆盖率评分 + 缺口清单

**覆盖率计算公式（修复 Major #2）**：
```
coverage = (covered_workflow_steps / total_workflow_steps) × 0.5
         + (covered_anti_patterns / total_anti_patterns) × 0.3
         + (covered_output_formats / total_output_formats) × 0.2
```
每个维度的"covered"定义：至少有一个 eval case 的 assertions 覆盖了该元素。

**Step 1c — 补缺**：
- 将缺口清单 + `test-gap.md`（v1.0）发送给模型
- 生成补充测试追加到 evals.json
- 回到 Step 1b 重新审查

**收敛策略（修复 Critical #6）**：
- 覆盖率 >= 90% → 通过，进入 Phase 2
- max_rounds 达到（默认 3）且覆盖率 >= 70% → **降级通过**，报告中标记"覆盖度不足"
- max_rounds 达到且覆盖率 < 70% → **阻断**，输出"SKILL.md 结构过于模糊，无法生成有效测试"
- 连续 2 轮补充无新 eval 生成 → **标记"不可改进"**，终止循环
- **testgen 完全失败的保底策略**：如果 LLM API 返回空响应、网络中断等导致零 eval 生成，使用预置的最小 eval 模板（`templates/minimum-evals.json`）作为保底，包含至少 2 个 trigger 验证 + 1 个正常场景的通用 eval case，并标注"auto-generated-minimum"。引擎继续执行但报告明确标记结果不完整

### Phase 2: 首轮执行（runner.py + grader.py）

**输入**：evals.json + SKILL.md 路径
**执行**：
- with-skill：注入 SKILL.md 上下文，跑所有 eval cases
- without-skill：不注入 SKILL.md，跑相同 eval cases

**评分**（grader.py）：
- 确定性断言优先：contains / not_contains / regex → 快速判定
- LLM-as-judge 补充：仅当确定性断言不足以判定复杂行为时调用
- 输出：grading.json

**LLM-as-judge 确定性保障（修复 Major #1）**：
- 固定 `temperature=0`
- 单一 judge 模型判定后，若 `confidence < 0.8`，触发二次判定（不同 provider）
- 两次判定不一致时取多数（引入第三个 judge）
- judge 结果标注 `judge_version`，与 L4 稳定性指标解耦（L4 只测量 skill 执行稳定性，不测量 judge 稳定性）

### Phase 3: 渐进补充（testgen.py gap-filling mode）

**分析 Phase 2 结果**：
- 全部通过的 eval → 标记"可能过简单"
- with/without 都失败的 eval → 标记"断言设计异常"
- 未被任何 eval 覆盖的 workflow 步骤 → 生成补充测试

**收敛条件（修复 Major #5）**：
- L2 delta >= 20% AND L3 >= 85% → 通过
- max_rounds 达到（默认 3）→ 终止，以当前最佳结果继续
- 连续 2 轮补充无改善（L2 delta 和 L3 均无提升）→ 标记"不可改进"，终止
- 绝对上限：Phase 1 + Phase 3 总补充轮数不超过 6 轮

### Phase 4: 完整 L1-L4 评估（metrics.py）

| 维度 | 方法 | 及格线 |
|------|------|--------|
| L1: 触发准确性 | trigger evals 准确率 | >= 90% |
| L2: 输出正确性 | with/without delta | >= 20% |
| L3: 步骤遵循度 | workflow 步骤覆盖率 | >= 85% |
| L4: 执行稳定性 | 同 eval 3+ 次运行的标准差 | std <= 10% 均值 |

### Phase 5: 跨模型漂移检测（drift.py）★ 独立 Phase

**输入**：evals.json + 2+ 个不同模型
**执行**：每个模型独立跑同一 eval suite
**输出**：drift-report.json

```json
{
  "eval_suite": "delphi-review-v1",
  "models": {
    "qwen3.6-plus": {"pass_rate": 0.95, "tokens_avg": 3200},
    "glm-5": {"pass_rate": 0.72, "tokens_avg": 2800}
  },
  "drift_scenarios": [
    {"eval_id": 2, "name": "boundary-flawed-doc", "variance": 0.38, "severity": "high"}
  ],
  "overall_drift": "moderate"
}
```

**漂移与 verdict 的关系**：

**漂移严重性计算公式**：
- 单个 eval 的 drift = `|model_A_pass_rate - model_B_pass_rate|`
- `variance` = 所有 eval drift 的平均值（Cliff's delta 效应量，排除极端值后）
- 严重性阈值：`none ≤ 0.10`，`low ≤ 0.20`，`moderate ≤ 0.35`，`high > 0.35`
- `overall_drift` = 所有 eval 的平均 variance

- `overall_drift == "none"` 或 `"low"` → 不影响 verdict
- `overall_drift == "moderate"` → verdict 降级为 `PASS_WITH_CAVEATS`
- `overall_drift == "high"` → verdict 降级为 `FAIL`，建议"该 skill 仅适配特定模型，不建议通用共享"

**全局超时配置**：
- `--max-total-time 3600`（默认 1 小时）
- 超时后输出当前已完成阶段的结果 + 超时警告
- 报告中标注 `incomplete: true` 和已完成/总阶段比例
- 防止无限运行的保护：单次 Phase 超时也阻断该 Phase 并继续下一 Phase

### Phase 6: 报告生成（reporter.py）

**输出文件**：
1. `report.md` — 可读的 Markdown 报告
2. `result.json` — 机器可读的标准化结果
3. `benchmark.json` — 基线数据（含 prompt 版本、引擎版本）

**报告结构**：
```markdown
# Skill Certification Report: [skill-name]

## Verdict: PASS / PASS_WITH_CAVEATS / FAIL
- Overall Score: X/100
- L1 Trigger Accuracy: X%
- L2 Output Correctness: X% (delta: +X%)
- L3 Step Adherence: X%
- L4 Execution Stability: σ=X%
- Cross-Model Drift: X/X models passed

## Eval Coverage
- Total eval cases: N (normal: N, boundary: N, failure: N)
- Workflow steps covered: X/Y (Z%)
- Auto-generated: Yes (B+C mode, N rounds)

## Configuration
- Prompt versions: testgen.meta.md v1.0, judge.md v1.0
- Engine version: skill-cert v0.1.0
- Models tested: [model list]

## Detailed Results
[按维度逐项展示]

## Improvement Suggestions
[基于失败项的针对性建议]
```

## 4. 错误处理与容错机制（修复 Critical #1）

### 4.1 API 调用重试策略

```python
@retry(
    max_retries=3,
    backoff="exponential",  # 1s → 2s → 4s
    retryable_errors=[
        "rate_limit_exceeded",
        "timeout",
        "connection_error",
        "5xx_server_error"
    ],
    non_retryable_errors=[
        "invalid_api_key",
        "model_not_found",
        "insufficient_quota"
    ]
)
def call_model(adapter, messages, timeout=120): ...
```

### 4.2 超时与降级策略

| 场景 | 处理 |
|------|------|
| 强模型超时/不可用 | 降级到备用模型（配置中指定 fallback_model） |
| 所有模型不可用 | 优雅终止，输出已完成的阶段结果 + 错误报告 |
| 部分 eval 执行失败 | 标记 failed evals，继续执行其余，最终报告标注不完整 |
| judge 模型不可用 | 降级为仅使用确定性断言，标注"L3 步骤遵循度未评估" |

### 4.3 配置管理（修复 Major #3）

```python
# engine/config.py
# 优先级：命令行参数 > 环境变量 > 配置文件 > 默认值

class SkillCertConfig:
    models: list[ModelConfig]       # 从 SKILL_CERT_MODELS 环境变量或 ~/.skill-cert/models.yaml
    max_concurrency: int = 5        # SKILL_CERT_MAX_CONCURRENCY
    rate_limit_rpm: int = 60        # SKILL_CERT_RATE_LIMIT_RPM
    request_timeout: int = 120      # SKILL_CERT_TIMEOUT
    judge_temperature: float = 0.0  # 固定为 0
    max_testgen_rounds: int = 3
    max_gapfill_rounds: int = 3
    max_total_time: int = 3600      # 全局超时（秒），超时后输出当前最佳结果
```

API 密钥管理：
- **强制使用环境变量**：`SKILL_CERT_API_KEY` 或通过 `~/.skill-cert/models.yaml` 配置多模型凭证
- **禁止硬编码**：配置文件中使用 `${ENV_VAR}` 占位符
- **敏感信息不入版本控制**：`models.yaml` 加入 `.gitignore`

## 5. 并发控制与安全（修复 Critical #3 + Major #4）

### 5.1 速率限制器

```python
class RateLimiter:
    """滑动窗口速率限制器"""
    def __init__(self, rpm: int, max_concurrency: int): ...
    async def acquire(self, model_name: str): ...
    async def release(self, model_name: str): ...
```

- 全局 RPM 限制（per model）
- 最大并发数控制（`max_concurrency`，默认 5）
- Token 预算：单次评测总 token 上限（可配置，默认 500K）

### 5.2 安全隔离

- **输入消毒**：SKILL.md 内容在注入 prompt 前过滤 `<script>` 等 HTML 标签和已知注入模式
- **执行超时**：单个 eval case 执行超时 120s，超时则标记 timeout
- **输出长度限制**：模型输出截断到 16K tokens，超出部分标记 truncated
- **敏感操作拦截**：评测过程不执行文件系统写操作（除报告输出目录）、不执行 shell 命令

## 6. 关键设计决策

### 6.1 为什么用 Python 引擎而非纯 skill 编排？

Python 引擎可在任何环境运行（CI/CD、服务器、本地）。SKILL.md 只做编排入口，实际执行逻辑在 engine/ 中。这使得：
- Skill 市场后端可以直接调用
- 可集成到 GitHub Actions
- 不依赖特定 AI IDE 的内部机制

### 6.2 模型适配层设计

```python
class ModelAdapter(ABC):
    @abstractmethod
    def chat(self, messages: list[dict], system: str = None, timeout: int = 120) -> str: ...
    @abstractmethod
    def batch_chat(self, requests: list[dict], max_concurrency: int = 5) -> list[str]: ...

class OpenAICompatAdapter(ModelAdapter):
    """覆盖：火山引擎、通义、Kimi、MiniMax、OpenAI 等"""
    def __init__(self, base_url: str, api_key: str, model: str, fallback_model: str = None): ...
```

所有国内主流模型都支持 OpenAI 兼容接口，一个 adapter 覆盖。每个 adapter 实例绑定独立速率限制器。

### 6.3 核心 Meta Prompt 版本管理（修复 Critical #4）

所有 prompt 文件头部声明版本：

```markdown
---
name: testgen.meta
version: 1.0.0
updated: 2026-04-26
---
```

- prompt 变更时递增版本号
- benchmark.json 记录每个评测使用的 prompt 版本
- 支持 `--prompt-version` 参数指定历史版本进行回归对比

### 6.4 评分机制

```
grader.py:
  1. 确定性断言（contains / not_contains / regex）→ 快速、零成本
  2. LLM-as-judge（复杂行为判定）→ 仅当确定性断言不足时使用，temperature=0
  3. 综合评分 = Σ(assertion_score × weight) / Σ(weights)
```

权重：Critical 断言 = 3，Important = 2，Normal = 1。

## 7. 技术栈

| 依赖 | 用途 | 类型 |
|------|------|------|
| Python 3.10+ | 运行环境 | runtime |
| `httpx` | HTTP 客户端 | runtime |
| `pydantic` | 数据验证（schemas） | runtime |
| `tenacity` | 重试策略 | runtime |
| `jinja2` | 报告模板（支持宏/继承） | runtime |
| `aiolimiter` | 异步速率限制 | runtime |
| `markdown-it-py` | SKILL.md 解析（AST 级） | runtime |

无重型框架依赖，纯脚本式。总依赖 < 15 个包。

## 8. 后续集成路径

1. **独立项目**：`boyingliu01/skill-cert` GitHub 仓库
2. **Skill 市场集成**：市场后端调用 `skill-cert --skill <path>` 自动评测
3. **CI/CD**：skill 修改后自动跑回归检测
4. **Skill 认证徽章**：PASS → 颁发认证标识展示在市场
