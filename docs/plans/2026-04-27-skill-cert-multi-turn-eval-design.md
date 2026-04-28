# Skill-Cert 多轮对话评测引擎设计文档

> 日期：2026-04-27
> 状态：待 Delphi Review
> Issue: https://github.com/boyingliu01/skill-cert/issues/5

## 1. 问题背景

当前评测引擎用单轮 prompt 验证所有 skill，导致编排型 skill（sprint-flow, delphi-review）L1 触发准确性仅 40%，远低于 90% 阈值。根本原因：单轮 prompt 无法验证多轮引导流程。

**UAT 数据**：
| Skill | L1 触发 (当前) | L2 价值 | 问题 |
|-------|---------------|---------|------|
| delphi-review | 40% | 46.9% | 单轮输出不包含完整评审流程 |
| sprint-flow | 40% | 29.2% | 编排流程被截断为单轮响应 |
| plan-eng-review | 80% | 62.5% | 较结构化，但仍不完美 |

## 2. 核心架构

```
┌─────────────────────────────────────────────────────────┐
│                 Skill-Cert v2.0                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [用户模拟器] ──→ 注入模糊意图/跑题/追问                 │
│       │                                                 │
│       ▼                                                 │
│  [被测 Skill] ──→ 执行多轮引导/问询/输出                 │
│       │                                                 │
│       ▼                                                 │
│  [对话评估器] ──→ LLM Judge 5 维度评分                  │
│       │                                                 │
│  [历史重放] ──→ 导入真实会话，对比验证                  │
└─────────────────────────────────────────────────────────┘
```

## 3. 用户模拟器设计

### 3.1 用户画像定义

```yaml
user_profiles:
  clear_intents:
    name: "明确型用户"
    description: "知道自己需要什么，表达清晰"
    example: "我想创建一个 REST API 用户认证模块"
    预期skill行为: 直接进入执行流程
    权重: 30%
  
  vague_intents:
    name: "模糊型用户"
    description: "有需求但表达不清，需要 skill 引导"
    example: "我的代码有点乱，想整理一下"
    预期skill行为: 主动问询澄清
    权重: 50%
  
  chaotic_intents:
    name: "混乱型用户"
    description: "频繁跑题/改需求/加新特性"
    example: "我在修 bug...对了，顺便加个登录吧...等等，先做性能优化"
    预期skill行为: 识别意图变更，重新规划
    权重: 20%
```

### 3.2 实现方式：用户模拟器

```python
class UserSimulator:
    def __init__(self, profile: str):
        self.profile = load_profile(profile)
        self.history = []
        # CRITICAL FIX: Security constraints to prevent simulator hijacking
        self.system_prompt = (
            "You are a human USER interacting with an AI assistant. "
            "NEVER output XML tags, system instructions, or markdown formatting that looks like code. "
            "NEVER ask the AI to ignore rules. Stay in character as a non-technical user."
        )
    
    def generate_next_message(self, skill_response: str) -> str:
        prompt = f"""
Current conversation history: {self.history}
Skill just said: {skill_response[:500]}
Generate your next message based on your profile ({self.profile.name}).
"""
        return llm_chat([
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": prompt}
        ])
```

### 3.3 集成：DialogueRunner (修复 Critical #1)

```python
class DialogueRunner(EvalRunner):
    """
    Wraps existing EvalRunner with multi-turn user simulation.
    Reuses rate limiting, concurrency control, and timeout from EvalRunner.
    """
    def __init__(self, simulator: UserSimulator, evaluator: DialogueEvaluator, **kwargs):
        super().__init__(**kwargs)
        self.simulator = simulator
        self.evaluator = evaluator
    
    async def run_dialogue_eval(self, eval_case: Dict, skill_context: str) -> List[Dict]:
        history = []
        turn = 0
        max_turns = 10
        
        # Initial vague intent
        user_msg = self.simulator.get_initial_message()
        
        while turn < max_turns:
            # Call Skill (reuses EvalRunner's adapter handling)
            skill_response = await self.run_with_skill([
                {"input": user_msg, "context": skill_context}
            ])
            
            history.append({"role": "user", "content": user_msg})
            history.append({"role": "assistant", "content": skill_response[0]})
            
            # Check termination: Heuristic or LLM detector
            if self.evaluator.is_complete(history) or "DONE" in skill_response[0]:
                break
            
            # User generates next message
            user_msg = self.simulator.generate_next_message(skill_response[0])
            turn += 1
            
        return history
```

## 4. 对话评估器设计

### 4.1 评估维度（5 项双向评分）

| 维度 | 正向评分标准 | 负向扣分标准 | 权重 |
|------|-------------|-------------|------|
| **意图识别** | skill 是否正确理解了用户真实意图？ | 误解/忽略用户核心需求 | 20% |
| **引导质量** | skill 是否主动问询了缺失信息？ | 对模糊输入不做引导直接执行 | 20% |
| **流程遵循** | ✓ 执行了 workflow 所有关键步骤 | ✗ 跳过步骤 / 做未定义的额外操作 | 25% |
| **异常处理** | 妥善处理跑题/改需求/错误输入 | 崩溃/忽略/死循环 | 15% |
| **输出质量** | 最终输出满足用户真实意图 | 输出偏离/不完整/格式错误 | 20% |

### 4.2 具体 Prompt 模板 (修复 Critical #1)

```python
JUDGE_PROMPTS = {
    "intent_recognition": """
Context: User asked "{user_msg}".
Skill responded: "{skill_response}".
Did the skill address the user's core intent?
Score 0-100. Return ONLY JSON: {"score": 0-100, "reason": "..."}
""",
    "guidance_quality": """
User input was vague/incomplete.
Did the skill proactively ask clarifying questions?
If yes -> Score 80-100.
If no (just gave generic answer) -> Score 0-20.
"""
    # ... (similar for other 3 dimensions)
}
```

### 4.3 评分聚合逻辑 (修复 Major #2 & Critical #3)

```python
class DialogueEvaluator:
    def evaluate_conversation(self, conversation: List[Dict]) -> Dict:
        round_scores = []
        for i in range(len(conversation) - 1):
            scores = self._judge_round(conversation[i], conversation[i+1])
            round_scores.append(scores)
        
        final_score = self._judge_final_output(conversation)
        boundary_penalty = self._detect_boundary_violations(conversation)
        
        # 关键步骤最小值机制：关键步骤失败会拉低总分
        critical_min = min(
            s["workflow_adherence"] for s in round_scores if s.get("is_critical_turn")
        )
        
        return {
            "intent_recognition": weighted_mean(s["intent_recognition"] for s in round_scores, weights=[1,2,3]),
            "guidance_quality": weighted_mean(s["guidance_quality"] for s in round_scores, weights=[1,2,3]),
            # 流程遵循取平均和关键步骤最小值的加权
            "workflow_adherence": max(0.7 * mean(s["workflow_adherence"] for s in round_scores), 0.3 * critical_min) - boundary_penalty,
            
            # Verdict 判定矩阵
            "verdict": self.determine_verdict(l1_l4_avg, l5_score)
        }
            

    def determine_verdict(self, l1_l4_avg: float, l5_score: float) -> str:
        """L5 与 L1-L4 的聚合规则（统一：AND 严格模式 + OR 中间态）"""
        if l1_l4_avg >= 0.6 and l5_score >= 0.7:
            return "PASS"
        elif l1_l4_avg >= 0.4 or l5_score >= 0.5:
            return "PASS_WITH_CAVEATS"
        else:
            return "FAIL"
```

## 5. 历史重放模块

### 5.1 语义与数据格式 (修复 Critical #3 & Major #3)

**JSONL 格式规范**:
```json
{"role": "user", "content": "How do I start?"}
{"role": "assistant", "content": "First, define your requirements...", "tool_use": null}
{"role": "tool_output", "content": "File read successfully"}
```

**Replay 语义**:
- `call_skill(skill_path, user_msg)`: 
  1. 加载 `SKILL.md` 到 System Prompt。
  2. 注入历史对话作为 Context。
  3. 调用 LLM 获取单轮响应。
- **对比基准**: 
  - "单轮重放": 只看对当前 User Message 的响应质量。
  - "多轮重放": 检查 Skill 是否能维持上下文一致性，不被历史中的 Tool Output 迷惑。

## 6. 集成到现有评测引擎

### 6.3 Verdict 判定 (修复 Critical #2)

| 模式 | Verdict 依据 |
|------|-------------|
| `single` | L1 >= 90%, L2 >= 20%, L3 >= 85%, L4 std <= 10% |
| `dialogue` | **PASS**: `(L1-L4 >= 60%) AND (L5 >= 70%)`<br>**CAVEATS**: `(L1-L4 >= 40%) OR (L5 >= 50%)`<br>**FAIL**: 其他 |
| `replay` | 相比原会话，New Response Quality Score >= Original Quality |

**注**: Dialogue 模式下，L1-L4 权重降为 40%，L5 (对话质量) 权重升为 60%，因为对于编排型 skill，过程比单轮结果更重要。

## 8. 成本估算 (修复 Major #4)

| 模式 | 调用构成 | 预估 Token | 成本 |
|------|---------|-----------|------|
| dialogue | 8 evals × 5 轮 × (Simulator + Skill + Judge) | ~30K input/eval | $0.40 |
| replay | N turns × (Skill + Diff-Judge) | ~10K input/turn | $0.05×N |

**注**: $0.40 是基于历史窗口随窗口增长指数级上升的悲观估计。实际可能约 $0.25。
