# Consensus Schema - TypeScript Interfaces

## 核心接口定义

```typescript
// ============================================
// 共识引擎核心接口
// ============================================

/**
 * 共识输出
 */
interface ConsensusOutput {
  verdict: 'APPROVED' | 'REQUEST_CHANGES' | 'ESCALATE_TO_HUMAN';
  confidence: number;  // 0-10
  issues: Issue[];
  reasoning: string;
  timestamp: Date;
}

/**
 * 问题
 */
interface Issue {
  id: string;
  severity: 'Critical' | 'Major' | 'Minor';
  category: 'Architecture' | 'Design' | 'Implementation' | 'Security' | 'Performance' | 'Testing';
  description: string;
  location?: string;  // 文件路径或行号
  suggestion: string;
  source: 'ExpertA' | 'ExpertB';
}

/**
 * 置信度
 */
interface Confidence {
  overall: number;  // 0-10
  expertA: number;
  expertB: number;
  reasoning: string;
}

// ============================================
// Expert A 接口
// ============================================

interface ExpertAInput {
  targetFile: string;
  context: CodeContext;
  walkthroughFocus?: string;
}

interface ExpertAOutput {
  architecture: ArchitectureReview;
  design: DesignReview;
  verdict: 'APPROVED' | 'REQUEST_CHANGES';
  confidence: number;
  issues: Issue[];
  reasoning: string;
}

interface ArchitectureReview {
  responsibility: ReviewItem;
  dependencies: ReviewItem;
  modularity: ReviewItem;
  extensibility: ReviewItem;
}

interface DesignReview {
  patterns: PatternReview[];
  structure: StructureReview;
  maintainability: MaintainabilityReview;
}

interface ReviewItem {
  score: number;  // 0-10
  description: string;
  status: 'PASSED' | 'FAILED' | 'WARNING';
}

interface PatternReview {
  patternName: string;
  usage: string;
  evaluation: string;
}

interface StructureReview {
  fileOrganization: ReviewItem;
  functionOrganization: ReviewItem;
  naming: ReviewItem;
  comments: ReviewItem;
}

interface MaintainabilityReview {
  complexity: ReviewItem;
  readability: ReviewItem;
  testability: ReviewItem;
  documentation: ReviewItem;
}

// ============================================
// Expert B 接口
// ============================================

interface ExpertBInput {
  targetFile: string;
  context: CodeContext;
  walkthroughFocus?: string;
}

interface ExpertBOutput {
  implementation: ImplementationReview;
  security: SecurityReview;
  performance: PerformanceReview;
  testCoverage: TestCoverageReview;
  verdict: 'APPROVED' | 'REQUEST_CHANGES';
  confidence: number;
  issues: Issue[];
  reasoning: string;
}

interface ImplementationReview {
  typeSafety: ReviewItem;
  errorHandling: ReviewItem;
  resourceManagement: ReviewItem;
  concurrency: ReviewItem;
  edgeCases: ReviewItem;
}

interface SecurityReview {
  inputValidation: ReviewItem;
  injection: ReviewItem;
  sensitiveData: ReviewItem;
  auth: ReviewItem;
  dependencies: ReviewItem;
}

interface PerformanceReview {
  algorithmComplexity: ReviewItem;
  resourceLeaks: ReviewItem;
  caching: ReviewItem;
  database: ReviewItem;
  async: ReviewItem;
}

interface TestCoverageReview {
  unitTests: CoverageItem;
  edgeTests: CoverageItem;
  errorTests: CoverageItem;
}

interface CoverageItem {
  coverage: number;  // 0-100%
  description: string;
}

// ============================================
// 代码上下文
// ============================================

interface CodeContext {
  projectType: string;
  framework?: string;
  language: string;
  architecture?: string;
  patterns?: string[];
  dependencies?: Dependency[];
}

interface Dependency {
  name: string;
  version: string;
  knownVulnerabilities?: Vulnerability[];
}

interface Vulnerability {
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  description: string;
  cve?: string;
}

// ============================================
// 仲裁器接口
// ============================================

interface ArbiterInput {
  expertAOutput: ExpertAOutput;
  expertBOutput: ExpertBOutput;
  consensusRules: ConsensusRules;
}

interface ArbiterOutput {
  decision: 'APPROVED' | 'REQUEST_CHANGES' | 'ESCALATE_TO_HUMAN';
  confidence: number;
  reasoning: string;
  decisionPath: 'CONSENSUS' | 'MAJORITY' | 'ESCALATION';
  issues?: Issue[];
  nextAction: string;
}

interface ConsensusRules {
  minConfidence: number;  // 默认 7
  criticalIssuesThreshold: number;  // 默认 0
  majorIssuesThreshold: number;  // 默认 3
  requireBothApproval: boolean;  // 默认 true
}

// ============================================
// 共识统计
// ============================================

interface ConsensusStats {
  totalIssues: number;
  criticalIssues: number;
  majorIssues: number;
  minorIssues: number;

  expertA: {
    confidence: number;
    issuesCount: number;
  };

  expertB: {
    confidence: number;
    issuesCount: number;
  };

  agreement: {
    bothApproved: boolean;
    bothRejected: boolean;
    oneApprovedOneRejected: boolean;
    confidenceGap: number;
  };
}

// ============================================
// Walkthrough 会话
// ============================================

interface WalkthroughSession {
  sessionId: string;
  targetFile: string;
  startTime: Date;
  endTime?: Date;

  expertA: {
    input: ExpertAInput;
    output: ExpertAOutput;
    duration: number;  // ms
  };

  expertB: {
    input: ExpertBInput;
    output: ExpertBOutput;
    duration: number;  // ms
  };

  consensus: {
    stats: ConsensusStats;
    output: ConsensusOutput;
  };

  status: 'RUNNING' | 'COMPLETE' | 'FAILED' | 'ESCALATED';
}

// ============================================
// 辅助类型
// ============================================

type Severity = 'Critical' | 'Major' | 'Minor';
type Category = 'Architecture' | 'Design' | 'Implementation' | 'Security' | 'Performance' | 'Testing';
type Source = 'ExpertA' | 'ExpertB';
type Verdict = 'APPROVED' | 'REQUEST_CHANGES';
type Confidence = number;  // 0-10

// ============================================
// 工具函数
// ============================================

/**
 * 计算两个专家的置信度差距
 */
function calculateConfidenceGap(confA: number, confB: number): number {
  return Math.abs(confA - confB);
}

/**
 * 合并两个专家的问题列表
 */
function mergeIssues(issuesA: Issue[], issuesB: Issue[]): Issue[] {
  return [...issuesA, ...issuesB];
}

/**
 * 计算问题严重程度分布
 */
function calculateIssueDistribution(issues: Issue[]): {
  critical: number;
  major: number;
  minor: number;
} {
  return {
    critical: issues.filter(i => i.severity === 'Critical').length,
    major: issues.filter(i => i.severity === 'Major').length,
    minor: issues.filter(i => i.severity === 'Minor').length,
  };
}

/**
 * 判断是否达成共识
 */
function hasConsensus(
  verdictA: Verdict,
  verdictB: Verdict,
  confidenceA: number,
  confidenceB: number,
  rules: ConsensusRules
): {
  consensus: boolean;
  type: 'UNANIMOUS' | 'HIGH_CONFIDENCE' | 'NO_CONSENSUS';
} {
  const gap = calculateConfidenceGap(confidenceA, confidenceB);

  // 全员通过
  if (verdictA === 'APPROVED' && verdictB === 'APPROVED') {
    return {
      consensus: true,
      type: 'UNANIMOUS'
    };
  }

  // 高置信度通过（如果规则允许）
  if (
    verdictA === 'APPROVED' &&
    verdictB === 'APPROVED' &&
    confidenceA >= rules.minConfidence &&
    confidenceB >= rules.minConfidence
  ) {
    return {
      consensus: true,
      type: 'HIGH_CONFIDENCE'
    };
  }

  // 其他情况未达成共识
  return {
    consensus: false,
    type: 'NO_CONSENSUS'
  };
}

/**
 * 计算综合置信度
 */
function calculateAggregateConfidence(
  confidenceA: number,
  confidenceB: number,
  stats: ConsensusStats
): number {
  // 简单平均
  const avg = (confidenceA + confidenceB) / 2;

  // 如果置信度差距大，降低综合置信度
  const gap = calculateConfidenceGap(confidenceA, confidenceB);
  const penalty = gap > 3 ? 1 : 0;

  // 如果问题多，降低综合置信度
  const issuePenalty = stats.criticalIssues > 0 ? 2 :
                      stats.majorIssues > 3 ? 1 : 0;

  return Math.max(0, avg - penalty - issuePenalty);
}

// ============================================
// 使用示例
// ============================================

async function runCodeWalkthrough(
  targetFile: string,
  context: CodeContext
): Promise<ConsensusOutput> {
  // 并行执行两个专家评审
  const [expertAOutput, expertBOutput] = await Promise.all([
    runExpertA({ targetFile, context }),
    runExpertB({ targetFile, context }),
  ]);

  // 计算共识统计
  const stats: ConsensusStats = {
    totalIssues: expertAOutput.issues.length + expertBOutput.issues.length,
    criticalIssues: 0,
    majorIssues: 0,
    minorIssues: 0,
    expertA: {
      confidence: expertAOutput.confidence,
      issuesCount: expertAOutput.issues.length,
    },
    expertB: {
      confidence: expertBOutput.confidence,
      issuesCount: expertBOutput.issues.length,
    },
    agreement: {
      bothApproved: expertAOutput.verdict === 'APPROVED' &&
                    expertBOutput.verdict === 'APPROVED',
      bothRejected: expertAOutput.verdict === 'REQUEST_CHANGES' &&
                   expertBOutput.verdict === 'REQUEST_CHANGES',
      oneApprovedOneRejected: false,
      confidenceGap: calculateConfidenceGap(
        expertAOutput.confidence,
        expertBOutput.confidence
      ),
    },
  };

  // 计算问题分布
  const distribution = calculateIssueDistribution([
    ...expertAOutput.issues,
    ...expertBOutput.issues,
  ]);
  stats.criticalIssues = distribution.critical;
  stats.majorIssues = distribution.major;
  stats.minorIssues = distribution.minor;

  // 更新 agreement
  stats.agreement.oneApprovedOneRejected =
    !stats.agreement.bothApproved && !stats.agreement.bothRejected;

  // 仲裁
  const arbiterOutput = await runArbiter({
    expertAOutput,
    expertBOutput,
    consensusRules: {
      minConfidence: 7,
      criticalIssuesThreshold: 0,
      majorIssuesThreshold: 3,
      requireBothApproval: true,
    },
  });

  // 生成共识输出
  const consensusOutput: ConsensusOutput = {
    verdict: arbiterOutput.decision,
    confidence: arbiterOutput.confidence,
    issues: mergeIssues(expertAOutput.issues, expertBOutput.issues),
    reasoning: arbiterOutput.reasoning,
    timestamp: new Date(),
  };

  return consensusOutput;
}
```

## 数据结构说明

### Issue（问题）
- `id`: 唯一标识符（如 "A1", "B2"）
- `severity`: 严重程度（Critical/Major/Minor）
- `category`: 问题类别
- `description`: 详细描述
- `location`: 代码位置（可选）
- `suggestion`: 修复建议
- `source`: 来源专家

### ReviewItem（评审项）
- `score`: 评分 0-10
- `description`: 评分说明
- `status`: 状态（PASSED/FAILED/WARNING）

### ConsensusStats（共识统计）
- 统计总体问题数和严重程度分布
- 统计两个专家的置信度和问题数
- 判断是否达成共识

### ArbiterOutput（仲裁输出）
- `decision`: 最终决策
- `confidence`: 综合置信度
- `decisionPath`: 决策路径
- `nextAction`: 下一步行动