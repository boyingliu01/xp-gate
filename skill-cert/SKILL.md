---
name: skill-cert
description: Evaluate and certify AI skills — auto-parse SKILL.md, generate tests, execute, and produce PASS/FAIL verdict
---

# Skill-Cert: AI Skill 评测引擎

接收任意 SKILL.md 文件，自动评测其有效性、稳定性、多模型适配性。

## 用法

```bash
skill-cert --skill /path/to/SKILL.md [--models m1,m2] [--output ./results/]
```

## 评测模式

### 单轮模式（默认）
用于简单技能，快速验证基本功能。

```bash
# 单轮模式（默认，适用于简单技能）
skill-cert --skill /path/to/SKILL.md --mode single
```

### 多轮对话模式
用于编排类技能，模拟真实用户交互场景。

```bash
# 对话模式（用于编排技能）
skill-cert --skill /path/to/SKILL.md --mode dialogue --max-turns 10
```

### 重放模式
用于回归测试，使用历史会话数据进行验证。

```bash
# 重放模式（用于回归测试）
skill-cert --skill /path/to/SKILL.md --mode replay --session session.jsonl
```

## 评测流程

### Phase 0: Skill 解析
- 读取 SKILL.md，提取语义结构（SkillSpec）
- 正则 + AST 解析，fallback 到 LLM

### Phase 1: 测试生成 + 自审循环
- 生成 → 审查 → 补缺 → 审查... 直到覆盖率 >= 90%
- 保底：templates/minimum-evals.json

### Phase 2: 交叉验证执行
- with-skill vs without-skill
- 确定性断言 + LLM-as-judge

### Phase 3: 渐进补充
- 分析薄弱区域，补充测试
- 收敛：L2 delta >= 20% 或 max_rounds

### Phase 4: L1-L4 完整评估
- L1: 触发准确性 >= 90%
- L2: 输出正确性 delta >= 20%
- L3: 步骤遵循度 >= 85%
- L4: 执行稳定性 std <= 10%

### Phase 5: 跨模型漂移检测
- 多模型跑同一 eval suite
- none/low → PASS, moderate → CAVEATS, high → FAIL

### Phase 6: 报告生成
- Markdown 报告 + JSON 结果 + 基线数据

## Verdict 判定

| Verdict | 条件 |
|---------|------|
| PASS | L1>=90%, L2>=20%, L3>=85%, L4 std<=10%, drift none/low |
| PASS_WITH_CAVEATS | 核心指标通过，drift moderate |
| FAIL | 任一核心指标不达标 或 drift high |

## Anti-Patterns

- 跳过 Phase 1 自审循环直接跑评测
- 只跑 with-skill 不跑 without-skill 基线
- 忽略 L4 稳定性只关注 L2 delta
- 漂移检测 high 仍给 PASS

## Red Flags

- SKILL.md 解析 confidence < 0.6 → 结构模糊，评测结果不可信
- 覆盖率 < 70% → 阻断，无法生成有效测试
- 所有模型不可用 → 优雅终止，输出部分结果
