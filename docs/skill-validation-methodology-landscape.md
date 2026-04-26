# AI Skill 验证方案全景图

> 生成日期：2026-04-26
> 用途：为 XGate 项目（及后续团队共享）提供 skill 验证的方法论选型指南

---

## 一、验证维度定义

任何 skill 验证都可以拆成以下 4 个维度：

| 维度 | 验证什么 | 核心问题 |
|------|---------|---------|
| **L1: 触发准确性** | Skill 是否在该触发时触发、不该触发时不触发 | "大模型知不知道要用这个 skill？" |
| **L2: 输出正确性** | Skill 触发后产出的结果是否正确 | "用了 skill 后结果好不好？" |
| **L3: 步骤遵循度** | Agent 是否按 skill 定义的流程一步步执行 | "大模型有没有跳步骤？" |
| **L4: 执行稳定性** | 同一 skill 多次运行的结果是否一致 | "每次跑出来一样吗？模型更新后会不会变差？" |

---

## 二、业界验证方案全景

### 方案 A: Anthropic Skill-Creator（已采用）

| 项目 | 详情 |
|------|------|
| **来源** | Anthropic 官方，Claude Code 内置 |
| **验证维度** | L1（trigger eval）+ L2（cross-validation）+ L4（benchmark mode） |
| **核心方法** | with-skill vs without-skill 交叉对比 + blind A/B comparison |
| **开源** | ✅ 是（GitHub: anthropics/claude-plugins-official） |
| **优点** | 原生集成 Claude Code，无需额外配置；支持 description optimization 自动优化触发 |
| **缺点** | 只适用于 Claude Code/OpenCode 生态；L3 步骤遵循需要手动定义断言 |
| **适合场景** | Claude Code 原生 skill 的首次验证和迭代优化 |
| **使用成本** | 免费（消耗 Claude Code token） |

### 方案 B: promptfoo

| 项目 | 详情 |
|------|------|
| **来源** | 开源社区（已被 OpenAI 收购） |
| **验证维度** | L1 + L2 + L4 |
| **核心方法** | YAML 声明式测试配置，支持确定性断言 + LLM-as-judge |
| **开源** | ✅ MIT License |
| **优点** | CI/CD 友好（可集成到 GitHub Actions）；支持多模型对比；红队测试模块 |
| **缺点** | 需要自己写测试用例 YAML；不专门针对 skill 文件 |
| **适合场景** | 回归测试、每周自动检测 skill 退化 |
| **使用成本** | 免费开源，消耗各模型 API 费用 |

### 方案 C: LangSmith

| 项目 | 详情 |
|------|------|
| **来源** | LangChain 官方 |
| **验证维度** | L2 + L3 + L4 |
| **核心方法** | 采集 agent 执行 trace，LLM-as-judge 评分中间步骤 |
| **开源** | ❌ 商业平台（有免费额度） |
| **优点** | 能看到 agent 的每一步执行轨迹；支持人类标注；pairwise 对比 |
| **缺点** | 需要使用 LangChain 框架；不是针对 markdown skill 的 |
| **适合场景** | 复杂多步 agent 的过程追踪 |
| **使用成本** | 免费额度有限，超出后收费 |

### 方案 D: DSPy（Stanford NLP）

| 项目 | 详情 |
|------|------|
| **来源** | 斯坦福大学 |
| **验证维度** | L2 + L4 |
| **核心方法** | 编程式 prompt 优化，自定义 metric 函数，自动编译优化 |
| **开源** | ✅ MIT License |
| **优点** | 学术背景强；优化器自动调优 prompt；支持 trace inspection |
| **缺点** | 需要把 skill 改写成 DSPy 程序；学习曲线陡 |
| **适合场景** | 需要自动化优化 prompt/skill 的场景 |
| **使用成本** | 免费开源 |

### 方案 E: DeepEval（Confident AI）

| 项目 | 详情 |
|------|------|
| **来源** | Confident AI 开源框架 |
| **验证维度** | L2 + L3 + L4 |
| **核心方法** | Pytest-like 语法，50+ 预置指标（幻觉、相关性、工具正确性等） |
| **开源** | ✅ MIT License |
| **优点** | 指标丰富（G-Eval、幻觉检测、Plan Adherence 等）；CI 集成方便 |
| **缺点** | Python 生态；需要写测试代码 |
| **适合场景** | 需要检测幻觉和步骤遵循的场景 |
| **使用成本** | 免费开源 |

### 方案 F: Calibra

| 项目 | 详情 |
|------|------|
| **来源** | 开源社区 |
| **验证维度** | L1 + L2 + L4 |
| **核心方法** | 5 维度测试矩阵（模型、指令、skills、MCP、环境），统计显著性分析 |
| **开源** | ✅ 免费开源 |
| **优点** | 专为 coding agent 设计；跨模型 benchmark；Cliff's delta 效应量分析 |
| **缺点** | 需要定义测试矩阵；不适合单 skill 快速验证 |
| **适合场景** | 多模型/多 skill 对比 benchmark |
| **使用成本** | 免费 |

### 方案 G: PromptPressure

| 项目 | 详情 |
|------|------|
| **来源** | 开源社区 |
| **验证维度** | L4（行为漂移） |
| **核心方法** | 190 个对抗 prompt，11 个行为类别，多轮检测漂移 |
| **开源** | ✅ 免费开源 |
| **优点** | 专注于行为漂移检测；190 个即用 prompt |
| **缺点** | 不验证输出正确性；只关注漂移 |
| **适合场景** | 模型更新后检测 skill 行为是否变化 |
| **使用成本** | 免费 |

### 方案 H: Attest

| 项目 | 详情 |
|------|------|
| **来源** | 开源社区 |
| **验证维度** | L2 + L3 + L4 |
| **核心方法** | 8 层断言模型：确定性断言 → LLM-as-judge，逐步升级 |
| **开源** | ✅ 免费开源 |
| **优点** | 8 层 graduated assertion 模型；漂移检测 |
| **缺点** | 需要学习其 assertion DSL |
| **适合场景** | 需要精细化验证的场景 |
| **使用成本** | 免费 |

### 方案 I: 学术方法论 — Process Evaluation（EACL 2026）

| 项目 | 详情 |
|------|------|
| **来源** | EACL 2026 论文 "Process Evaluation for Agentic Systems" |
| **验证维度** | L3（过程遵循） |
| **核心方法** | Compliance Score：LLM-as-judge 检查 agent 轨迹是否符合 checklist，加权扣分 |
| **开源** | 论文开源，无现成工具 |
| **优点** | 学术界认可的 process adherence 评估方法 |
| **缺点** | 需要自己实现 |
| **适合场景** | 验证 skill 的步骤是否被严格遵循 |
| **使用成本** | 论文免费，实现需要 LLM 调用 |

### 方案 J: OpenAI Evals

| 项目 | 详情 |
|------|------|
| **来源** | OpenAI 官方 |
| **验证维度** | L2 |
| **核心方法** | JSONL 测试用例 + model-graded 评分 |
| **开源** | ✅ 框架开源 |
| **优点** | OpenAI 官方支持；适合 OpenAI 模型 |
| **缺点** | 主要针对 OpenAI 模型；不支持 skill 触发测试 |
| **适合场景** | OpenAI 模型生态的输出质量验证 |
| **使用成本** | 框架免费，消耗 OpenAI API 费用 |

### 方案 K: Braintrust

| 项目 | 详情 |
|------|------|
| **来源** | 商业平台 |
| **验证维度** | L2 + L4 |
| **核心方法** | 数据集驱动的 eval，支持人类标注和自动评分 |
| **开源** | ❌ 商业平台 |
| **优点** | 用户体验好；支持团队协作 |
| **缺点** | 商业产品；需要注册 |
| **适合场景** | 团队级别的 eval 管理 |
| **使用成本** | 商业定价 |

### 方案 L: 自定义 Checklist 验证（本框架自研）

| 项目 | 详情 |
|------|------|
| **来源** | XGate 项目自研 |
| **验证维度** | L3（步骤遵循） |
| **核心方法** | 解析 skill 定义的工作流/checklist，逐项验证输出中是否有对应证据 |
| **开源** | ✅ 随 XGate 开源 |
| **优点** | 完全针对 XGate skill 定制；零成本；可复用 |
| **缺点** | 需要手动定义检查项 |
| **适合场景** | XGate skill 的步骤遵循验证 |
| **使用成本** | 免费 |

---

## 三、方案对比决策矩阵

| 需求场景 | 推荐方案 | 理由 |
|---------|---------|------|
| **首次验证新 skill** | A (skill-creator) | 原生集成，with/without 交叉验证最直接 |
| **检测 skill 被忽略/跳步骤** | L (自定义 checklist) + I (Process Evaluation) | 最直接对应 skill 定义的步骤 |
| **检测模型更新后的回归** | B (promptfoo) + G (PromptPressure) | CI/CD 集成 + 行为漂移检测 |
| **跨模型对比 skill 效果** | F (Calibra) | 专为多模型 benchmark 设计 |
| **检测幻觉** | E (DeepEval) | 50+ 预置指标含幻觉检测 |
| **团队级验证管理** | K (Braintrust) | 协作友好 |
| **自动化优化 skill** | D (DSPy) | 编程式自动优化 |

---

## 四、XGate 推荐方案组合

基于 XGate 项目的实际需求（markdown-based SKILL.md，即将团队共享），推荐以下**三层验证体系**：

### 第一层：首次验证（已完成）
- **工具**: Anthropic skill-creator ✅
- **产出**: 3 个 skill 的 evals/evals.json + 交叉验证报告
- **状态**: ✅ 已完成

### 第二层：回归检测（建议后续配置）
- **工具**: promptfoo
- **做法**: 每周自动运行 evals/evals.json，对比基线 benchmark.json
- **触发**: skill 修改后、模型更新后
- **成本**: 低（YAML 配置 + CI 集成）

### 第三层：行为漂移检测（可选）
- **工具**: PromptPressure
- **做法**: 模型大版本更新后，运行对抗 prompt 检测 skill 行为是否漂移
- **触发**: Claude/OpenAI 发布新模型版本时
- **成本**: 中（需要配置 190 个 prompt）

---

## 五、业界最佳实践总结

根据调研结果，验证 skill 有效性的通用方法论是：

1. **先做交叉验证**（with vs without skill）→ 证明 skill 有增量价值
2. **定义可量化断言**（contains / not_contains / regex）→ 客观评分
3. **建立基线**（benchmark.json）→ 后续检测回归
4. **定期重跑**（CI/CD）→ 检测模型更新带来的退化
5. **行为压力测试**（PromptPressure）→ 检测边界条件下的漂移
