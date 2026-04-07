# State Schema - TypeScript Interfaces

## 核心接口定义

```typescript
// ============================================
// Round 1 State (Driver Output)
// ============================================

interface Round1State {
  sealed: SealedData;
  public: PublicData;
  state: EngineState;
  timestamp: Date;
}

interface SealedData {
  code: string;
  designDecisions: string;
  accessible: boolean;  // State 3 前为 false
}

interface PublicData {
  requirements: string;
  testCases: TestCase[];
  testResults: TestResult[];
}

interface TestCase {
  id: string;
  description: string;
  edgeCase: boolean;
}

interface TestResult {
  testCaseId: string;
  passed: boolean;
  error?: string;
}

// ============================================
// Round 2 State (Navigator Output)
// ============================================

interface Round2State {
  phase1Output: NavigatorPhase1Output;
  phase2Output: NavigatorPhase2Output;
  verdict: 'APPROVED' | 'REQUEST_CHANGES';
  confidence: number;  // 0-10
}

interface NavigatorPhase1Input {
  requirements: string;
  testCases: TestCase[];
  testResults: TestResult[];
  // ⚠️ sealed.code 不可访问
}

interface NavigatorPhase1Output {
  checkList: CheckItem[];
  selfCheck: SelfCheckResult;
}

interface CheckItem {
  id: number;
  category: string;
  item: string;
  expected: string;
}

interface SelfCheckResult {
  requirementsCoverage: number;  // 必须 100
  edgeCasesCount: number;        // 必须 ≥3
  securityItemsCount: number;    // 必须 ≥1
  passed: boolean;
  regenerate: boolean;
}

interface NavigatorPhase2Input {
  code: string;  // 解锁后可见
  checkList: CheckItem[];
}

interface NavigatorPhase2Output {
  checkResults: CheckResult[];
  issues: Issue[];
  verdict: 'APPROVED' | 'REQUEST_CHANGES';
  confidence: number;
  reasoning: string;
}

interface CheckResult {
  checkId: number;
  result: 'PASSED' | 'FAILED' | 'UNCLEAR';
  note: string;
}

interface Issue {
  id: string;
  severity: 'Critical' | 'Major' | 'Minor';
  description: string;
  location?: string;
  suggestion: string;
  source: 'Navigator' | 'Gate1';
}

// ============================================
// Arbiter Input/Output
// ============================================

interface ArbiterInput {
  driverOutput: {
    reasoning: string;
  };
  navigatorOutput: Round2State;
  gate1Result: Gate1Result;
}

interface ArbiterOutput {
  decision: 'APPROVED' | 'REQUEST_CHANGES' | 'ESCALATE_TO_HUMAN';
  confidence: number;
  reasoning: string;
  decisionPath: 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
  issues?: Issue[];
  nextAction: string;
}

// ============================================
// Gate 1 Result
// ============================================

interface Gate1Result {
  passed: boolean;
  errors: Gate1Error[];
  attempts: number;
  maxAttempts: number;  // 3
}

interface Gate1Error {
  type: 'TypeScript' | 'ESLint' | 'Test';
  message: string;
  line?: number;
  autoFixable: boolean;
}

// ============================================
// Engine State (17 States)
// ============================================

type EngineState = 
  | 'IDLE'
  | 'ROUND1_RUNNING'
  | 'ROUND1_COMPLETE'
  | 'ROUND2_PHASE1_RUNNING'
  | 'ROUND2_PHASE1_COMPLETE'
  | 'ROUND2_PHASE2_RUNNING'
  | 'ROUND2_PHASE2_COMPLETE'
  | 'GATE1_RUNNING'
  | 'GATE1_COMPLETE'
  | 'GATE1_FAILED'
  | 'ARBITER_RUNNING'
  | 'APPROVED'
  | 'REQUEST_CHANGES'
  | 'GATE2_RUNNING'
  | 'GATE2_COMPLETE'
  | 'READY_FOR_RELEASE'
  | 'ROLLBACK_TO_ROUND1'
  | 'CIRCUIT_BREAKER_TRIGGERED';

// ============================================
// Cost Control
// ============================================

interface CostThresholds {
  singleConsensus: number;   // $0.04
  singleTask: number;        // $0.15
  daily: number;             // $1.00
  weekly: number;            // $5.00
}

interface CostTracker {
  currentSessionCost: number;
  dailyCost: number;
  weeklyCost: number;
  consensusCount: number;
}

// ============================================
// Circuit Breaker
// ============================================

interface CircuitBreakerState {
  triggered: boolean;
  reason: string;
  noProgressRounds: number;
  previousIssueDistribution: IssueDistribution;
}

interface IssueDistribution {
  critical: number;
  major: number;
  minor: number;
}

interface NoProgressCriteria {
  issueDistributionSame: boolean;
  confidenceChange: number;  // < 0.5
  newIssuesFound: number;    // 0
}

// ============================================
// Consensus Engine Main Class
// ============================================

class ConsensusEngine {
  private state: EngineState = 'IDLE';
  private round1Output: Round1State | null = null;
  private round2Output: Round2State | null = null;
  private gate1Result: Gate1Result | null = null;
  private arbiterOutput: ArbiterOutput | null = null;
  private gate1Attempts: number = 0;
  private maxGate1Attempts: number = 3;
  
  // Cost tracking
  private costTracker: CostTracker;
  private costThresholds: CostThresholds;
  
  // Circuit breaker
  private circuitBreaker: CircuitBreakerState;
  
  // ============================================
  // State Transitions
  // ============================================
  
  async runConsensus(requirements: string): Promise<ArbiterOutput> {
    // Round 1
    await this.executeRound1(requirements);
    
    // Round 2 Phase 1 (Blind)
    await this.executeRound2Phase1();
    
    // Round 2 Phase 2 (Code visible)
    await this.executeRound2Phase2();
    
    // Gate 1 (Pre-Arbiter)
    await this.runGate1();
    
    // Arbiter
    const decision = await this.runArbiter();
    
    return decision;
  }
  
  async executeRound1(requirements: string): Promise<void> {
    this.state = 'ROUND1_RUNNING';
    
    const driverOutput = await this.driverAgent.generate(requirements);
    
    this.round1Output = {
      sealed: {
        code: driverOutput.code,
        designDecisions: driverOutput.designDecisions,
        accessible: false
      },
      public: {
        requirements,
        testCases: driverOutput.testCases,
        testResults: await this.runTests(driverOutput.testCases, driverOutput.code)
      },
      state: 'ROUND1_COMPLETE',
      timestamp: new Date()
    };
    
    this.state = 'ROUND1_COMPLETE';
  }
  
  async executeRound2Phase1(): Promise<void> {
    if (this.state !== 'ROUND1_COMPLETE') {
      throw new Error('Round 1 not complete');
    }
    
    this.state = 'ROUND2_PHASE1_RUNNING';
    
    // Navigator 只能看到 public 数据
    const phase1Input: NavigatorPhase1Input = {
      requirements: this.round1Output!.public.requirements,
      testCases: this.round1Output!.public.testCases,
      testResults: this.round1Output!.public.testResults
    };
    
    const phase1Output = await this.navigatorAgent.phase1(phase1Input);
    
    // Self-check
    if (!phase1Output.selfCheck.passed) {
      if (phase1Output.selfCheck.regenerate) {
        // 重新生成 (max 2)
        return this.executeRound2Phase1();
      }
      throw new Error('Navigator Phase 1 self-check failed');
    }
    
    this.round2Output = {
      phase1Output,
      phase2Output: null as any,
      verdict: null as any,
      confidence: 0
    };
    
    this.state = 'ROUND2_PHASE1_COMPLETE';
  }
  
  async executeRound2Phase2(): Promise<void> {
    if (this.state !== 'ROUND2_PHASE1_COMPLETE') {
      throw new Error('Round 2 Phase 1 not complete');
    }
    
    this.state = 'ROUND2_PHASE2_RUNNING';
    
    // Phase 2 可以看到 code
    this.round1Output!.sealed.accessible = true;
    
    const phase2Input: NavigatorPhase2Input = {
      code: this.round1Output!.sealed.code,
      checkList: this.round2Output!.phase1Output.checkList
    };
    
    const phase2Output = await this.navigatorAgent.phase2(phase2Input);
    
    this.round2Output!.phase2Output = phase2Output;
    this.round2Output!.verdict = phase2Output.verdict;
    this.round2Output!.confidence = phase2Output.confidence;
    
    this.state = 'ROUND2_PHASE2_COMPLETE';
  }
  
  async runGate1(): Promise<void> {
    if (this.state !== 'ROUND2_PHASE2_COMPLETE') {
      throw new Error('Round 2 Phase 2 not complete');
    }
    
    this.state = 'GATE1_RUNNING';
    
    const result = await this.runStaticAnalysis(
      this.round1Output!.sealed.code,
      this.round1Output!.public.testCases
    );
    
    this.gate1Result = result;
    
    if (result.passed) {
      this.state = 'GATE1_COMPLETE';
    } else {
      await this.handleGate1Failure(result);
    }
  }
  
  async handleGate1Failure(result: Gate1Result): Promise<void> {
    this.gate1Attempts++;
    
    if (this.gate1Attempts <= this.maxGate1Attempts) {
      const fixableErrors = result.errors.filter(e => e.autoFixable);
      
      if (fixableErrors.length > 0) {
        // 自动修复
        await this.driverAgent.fix(fixableErrors);
        
        // 重新运行 Gate 1
        return this.runGate1();
      }
      
      // 无可自动修复 → 回退
      this.state = 'ROLLBACK_TO_ROUND1';
      return this.rollbackToRound1(result);
    }
    
    // 超过最大次数
    this.state = 'GATE1_FAILED';
    throw new Error('Gate 1 failed after max attempts');
  }
  
  async rollbackToRound1(gate1Result: Gate1Result): Promise<void> {
    // 清空状态
    this.round1Output = null;
    this.round2Output = null;
    this.gate1Attempts = 0;
    
    // 重新执行 Round 1
    this.state = 'ROUND1_RUNNING';
    
    const retryContext = {
      requirements: this.round1Output?.public.requirements || '',
      previousGate1Failure: gate1Result,
      instruction: 'Fix Gate 1 issues in new implementation'
    };
    
    await this.executeRound1(retryContext.requirements);
  }
  
  async runArbiter(): Promise<ArbiterOutput> {
    if (this.state !== 'GATE1_COMPLETE') {
      throw new Error('Gate 1 not complete');
    }
    
    this.state = 'ARBITER_RUNNING';
    
    const arbiterInput: ArbiterInput = {
      driverOutput: {
        reasoning: this.round1Output!.sealed.designDecisions
      },
      navigatorOutput: this.round2Output!,
      gate1Result: this.gate1Result!
    };
    
    const decision = await this.arbiterAgent.decide(arbiterInput);
    
    this.arbiterOutput = decision;
    
    if (decision.decision === 'APPROVED') {
      this.state = 'APPROVED';
    } else if (decision.decision === 'REQUEST_CHANGES') {
      this.state = 'REQUEST_CHANGES';
    } else {
      this.state = 'REQUEST_CHANGES';  // ESCALATE 也需要处理
    }
    
    return decision;
  }
}
```

---

## 使用示例

```typescript
const engine = new ConsensusEngine();

try {
  const result = await engine.runConsensus(
    "实现一个用户登录 API，支持邮箱和密码登录，返回 JWT token"
  );
  
  if (result.decision === 'APPROVED') {
    console.log('共识达成，置信度:', result.confidence);
    // 进入 Gate 2
  } else {
    console.log('需要修复:', result.issues);
    // 重新共识
  }
} catch (error) {
  console.error('共识失败:', error.message);
}
```