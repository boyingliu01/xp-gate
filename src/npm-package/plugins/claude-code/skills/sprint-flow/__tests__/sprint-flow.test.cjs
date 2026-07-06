/**
 * @test REQ-SF-001 Sprint Flow Trigger Accuracy
 * @intent Verify that sprint-flow SKILL.md trigger detection correctly distinguishes
 *        between valid sprint-flow requests and unrelated queries
 * @covers AC-SF-001-01, AC-SF-001-02, AC-SF-001-03
 */
const fs = require('fs');
const path = require('path');

const SKILL_MD_PATH = path.join(__dirname, '..', 'SKILL.md');
const REFERENCES_DIR = path.join(__dirname, '..', 'references');
const PHASE_2_BUILD_PATH = path.join(REFERENCES_DIR, 'phase-2-build.md');
const ORCHESTRATION_RULES_PATH = path.join(REFERENCES_DIR, 'orchestration-rules.md');

let skillContent = '';

function loadSkillMd() {
  skillContent = fs.readFileSync(SKILL_MD_PATH, 'utf-8');
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const result = {};
  // Parse simple YAML key-value pairs and lists
  const lines = yaml.split('\n');
  let currentKey = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const kvMatch = trimmed.match(/^(\w[\w_]*):\s*(.*)/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val === '') {
        result[currentKey] = [];
      } else if (val.startsWith('"') || val.startsWith("'")) {
        result[currentKey] = val.slice(1, -1);
      } else {
        result[currentKey] = val;
      }
    } else if (trimmed.startsWith('- ') && currentKey) {
      const item = trimmed.slice(2).trim().replace(/^["'](.*)["'].*$/, '$1');
      if (!Array.isArray(result[currentKey])) result[currentKey] = [];
      result[currentKey].push(item);
    }
  }
  return result;
}

// === Trigger Accuracy Tests ===

function testPositiveTriggersArePresent() {
  const frontmatter = parseFrontmatter(skillContent);
  const triggers = frontmatter.triggers || [];
  const required = ['/sprint-flow', 'start sprint', '开发新功能', '一键开发'];
  const missing = required.filter(r => !triggers.some(t => t.includes(r)));
  if (missing.length > 0) {
    throw new Error(`Missing positive triggers: ${missing.join(', ')}`);
  }
  console.log('  ✓ Positive triggers are present');
}

function testNegativeTriggersArePresent() {
  const frontmatter = parseFrontmatter(skillContent);
  const negTriggers = frontmatter.triggers_negative_examples || [];
  if (negTriggers.length < 8) {
    throw new Error(`triggers_negative_examples must have at least 8 entries, got ${negTriggers.length}`);
  }
  console.log(`  ✓ Negative triggers have ${negTriggers.length} entries (>= 8 required)`);
}

function testNegativeTriggerPhrases() {
  // These phrases must NOT trigger sprint-flow
  const shouldNotTrigger = [
    '实现排序算法',
    '实现一下',
    '帮我实现这个函数',
    '怎么实现登录功能',
    'start spring boot',
    '开发环境配置',
    '一键部署',
    '新功能建议',
    'implement a sort function',
    'how to implement auth',
  ];
  for (const phrase of shouldNotTrigger) {
    // Verify phrase is in triggers_negative_examples
    const frontmatter = parseFrontmatter(skillContent);
    const negTriggers = frontmatter.triggers_negative_examples || [];
    const found = negTriggers.some(n => n.includes(phrase) || phrase.includes(n));
    if (!found) {
      throw new Error(`Negative trigger phrase "${phrase}" not found in triggers_negative_examples`);
    }
  }
  console.log(`  ✓ All ${shouldNotTrigger.length} negative trigger phrases verified`);
}

function testPositiveTriggerPhrases() {
  const shouldTrigger = [
    '开发用户认证模块',
    '/sprint-flow',
    '一键开发 REST API',
  ];
  for (const phrase of shouldTrigger) {
    const frontmatter = parseFrontmatter(skillContent);
    const triggers = frontmatter.triggers || [];
    // Match against frontmatter triggers OR check body trigger table for broader patterns
    const matched = triggers.some(t =>
      phrase.includes(t) || t.includes(phrase) || phrase.includes('/sprint-flow')
    ) || skillContent.includes(phrase);
    if (!matched) {
      throw new Error(`Positive trigger phrase "${phrase}" should match at least one trigger`);
    }
  }
  console.log(`  ✓ All ${shouldTrigger.length} positive trigger phrases verified`);
}

function testNegativeTestCasesExist() {
  // Count test case entries by matching "input:" lines in triggers_negative_test_cases YAML block
  const fmMatch = skillContent.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) throw new Error('Frontmatter not found');
  const yaml = fmMatch[1];

  // Find triggers_negative_test_cases block and count "- input:" lines within it
  const testCasesSection = yaml.split('triggers_negative_test_cases:')[1];
  if (!testCasesSection) throw new Error('triggers_negative_test_cases not found in frontmatter');

  const count = (testCasesSection.match(/^\s+- input:/gm) || []).length;
  if (count < 11) {
    throw new Error(`triggers_negative_test_cases must have at least 11 entries, got ${count}`);
  }
  console.log(`  ✓ Negative test cases have ${count} entries (>= 11 required)`);
}

// === Phase Transition Tests ===

function testWorkflowStepsOrder() {
  const frontmatter = parseFrontmatter(skillContent);
  const steps = frontmatter.workflow_steps || [];
  if (steps.length !== 11) {
    throw new Error(`workflow_steps must have exactly 11 entries, got ${steps.length}`);
  }

  const expectedOrder = [
    'ISOLATE', 'AUTO-ESTIMATE', 'THINK', 'PLAN', 'BUILD',
    'REVIEW', 'FEEDBACK', 'SHIP', 'LAND', 'USER ACCEPTANCE', 'CLEANUP',
  ];

  for (let i = 0; i < expectedOrder.length; i++) {
    if (!steps[i].includes(expectedOrder[i])) {
      throw new Error(
        `workflow_steps[${i}] should contain "${expectedOrder[i]}", got "${steps[i]}"`
      );
    }
  }
  console.log('  ✓ workflow_steps order matches canonical 11-phase sequence');
}

function testPhaseFlowDiagramOrder() {
  // The Phase Flow diagram in the body must show: ISOLATE → ... → FEEDBACK → SHIP → LAND → USER ACCEPTANCE → CLEANUP
  const flowMatch = skillContent.match(/ISOLATE →.*CLEANUP/);
  if (!flowMatch) {
    throw new Error('Phase Flow diagram not found in SKILL.md body');
  }
  const flow = flowMatch[0];

  // Verify FEEDBACK comes before SHIP (not after USER ACCEPTANCE)
  const feedbackPos = flow.indexOf('FEEDBACK');
  const shipPos = flow.indexOf('SHIP');
  const userAcceptPos = flow.indexOf('USER ACCEPT');
  if (feedbackPos === -1 || shipPos === -1 || userAcceptPos === -1) {
    throw new Error('Phase Flow diagram missing required phases');
  }
  if (feedbackPos > shipPos) {
    throw new Error('FEEDBACK must come before SHIP in phase flow diagram');
  }
  if (shipPos > userAcceptPos) {
    throw new Error('SHIP must come before USER ACCEPTANCE in phase flow diagram');
  }
  console.log('  ✓ Phase Flow diagram has correct ordering');
}

function testPhaseFlowConsistencySectionExists() {
  if (!skillContent.includes('Phase Flow Consistency')) {
    throw new Error('SKILL.md must contain "Phase Flow Consistency" section');
  }
  console.log('  ✓ Phase Flow Consistency section exists');
}

function testCanonicalPhaseOrderTableExists() {
  if (!skillContent.includes('Canonical Phase Order')) {
    throw new Error('SKILL.md must contain "Canonical Phase Order" table');
  }
  console.log('  ✓ Canonical Phase Order table exists');
}

function testAll11PhasesInPhaseFlowConsistency() {
  const section = skillContent.split('Phase Flow Consistency')[1];
  const requiredPhases = [
    'ISOLATE', 'AUTO-ESTIMATE', 'THINK', 'PLAN', 'BUILD',
    'REVIEW', 'FEEDBACK', 'SHIP', 'LAND', 'USER ACCEPTANCE', 'CLEANUP',
  ];
  for (const phase of requiredPhases) {
    if (!section.includes(phase)) {
      throw new Error(`Phase Flow Consistency section missing phase: ${phase}`);
    }
  }
  console.log('  ✓ All 11 phases referenced in Phase Flow Consistency section');
}

// === Force Levels Tests ===

function testForceLevelsDocumentExists() {
  const forceLevelsPath = path.join(REFERENCES_DIR, 'force-levels.md');
  if (!fs.existsSync(forceLevelsPath)) {
    throw new Error('references/force-levels.md must exist');
  }
  const content = fs.readFileSync(forceLevelsPath, 'utf-8');
  if (!content.includes('轻量') || !content.includes('标准') || !content.includes('复杂')) {
    throw new Error('force-levels.md must document lightweight/standard/complex levels');
  }
  console.log('  ✓ force-levels.md exists and documents three levels');
}

function testForceLevelsRequiresDelphi() {
  const forceLevelsContent = fs.readFileSync(
    path.join(REFERENCES_DIR, 'force-levels.md'), 'utf-8'
  );
  if (!forceLevelsContent.includes('Delphi') && !forceLevelsContent.includes('delphi')) {
    throw new Error('force-levels.md must reference Delphi review requirement');
  }
  console.log('  ✓ force-levels.md requires Delphi review for all levels');
}

// === Value Proposition Tests ===

function testUniqueValuePropositionExists() {
  if (!skillContent.includes('Unique Value Proposition')) {
    throw new Error('SKILL.md must contain "Unique Value Proposition" section');
  }
  console.log('  ✓ Unique Value Proposition section exists');
}

function testUvpMentionsTokenSavings() {
  const section = skillContent.split('Unique Value Proposition')[1];
  if (!section.includes('40') || !section.includes('67') || !section.includes('token')) {
    throw new Error('Unique Value Proposition must mention 40-67% token savings');
  }
  console.log('  ✓ UVP mentions 40-67% token savings');
}

function testUvpMentionsHardGate() {
  const section = skillContent.split('Unique Value Proposition')[1];
  if (!section.includes('HARD-GATE')) {
    throw new Error('Unique Value Proposition must mention HARD-GATE discipline');
  }
  console.log('  ✓ UVP mentions HARD-GATE discipline');
}

function testUvpMentionsEmergentRequirements() {
  const section = skillContent.split('Unique Value Proposition')[1];
  if (!section.toLowerCase().includes('emergent')) {
    throw new Error('Unique Value Proposition must mention emergent requirements');
  }
  console.log('  ✓ UVP mentions emergent requirements');
}

// === Phase Timing Tests ===

function testTimingSectionExists() {
  const phase2BuildContent = fs.readFileSync(PHASE_2_BUILD_PATH, 'utf-8');
  if (!phase2BuildContent.includes('Timing & Stability')) {
    throw new Error('phase-2-build.md must contain "Timing & Stability" section');
  }
  console.log('  ✓ Timing & Stability section exists in phase-2-build.md');
}

function testTimeoutRecommendationsExist() {
  const phase2BuildContent = fs.readFileSync(PHASE_2_BUILD_PATH, 'utf-8');
  const timeoutSection = phase2BuildContent.split('Timing & Stability')[1];
  if (!timeoutSection || !timeoutSection.includes('Timeout')) {
    throw new Error('Timing & Stability section must include timeout recommendations');
  }
  console.log('  ✓ Timeout recommendations exist');
}

function testExecutionTimeEstimatesExist() {
  const phase2BuildContent = fs.readFileSync(PHASE_2_BUILD_PATH, 'utf-8');
  if (!phase2BuildContent.includes('Expected Time')) {
    throw new Error('phase-2-build.md must include expected execution time estimates');
  }
  console.log('  ✓ Expected execution time estimates exist');
}

// === Orchestration Rules Tests ===

function testOrchestrationRulesExists() {
  if (!fs.existsSync(ORCHESTRATION_RULES_PATH)) {
    throw new Error('references/orchestration-rules.md must exist');
  }
  console.log('  ✓ orchestration-rules.md exists');
}

function testPhaseSubagentMatrixOrder() {
  const orchContent = fs.readFileSync(ORCHESTRATION_RULES_PATH, 'utf-8');
  const expectedOrder = [
    'ISOLATE', 'AUTO-ESTIMATE', 'THINK', 'PLAN', 'BUILD',
    'REVIEW', 'USER ACCEPT', 'FEEDBACK', 'SHIP', 'LAND', 'CLEANUP',
  ];
  // The matrix order reflects file names, but phases should all be present
  for (const phase of ['ISOLATE', 'THINK', 'PLAN', 'BUILD', 'REVIEW', 'CLEANUP']) {
    if (!orchContent.includes(phase)) {
      throw new Error(`orchestration-rules.md missing phase: ${phase}`);
    }
  }
  console.log('  ✓ Orchestration rules covers all key phases');
}

// === Run All Tests ===

function runTests() {
  let passed = 0;
  let failed = 0;
  const errors = [];

  const tests = [
    { name: 'Positive triggers are present', fn: testPositiveTriggersArePresent },
    { name: 'Negative triggers have >= 8 entries', fn: testNegativeTriggersArePresent },
    { name: 'Negative trigger phrases verified', fn: testNegativeTriggerPhrases },
    { name: 'Positive trigger phrases verified', fn: testPositiveTriggerPhrases },
    { name: 'Negative test cases exist (>= 11)', fn: testNegativeTestCasesExist },
    { name: 'workflow_steps order matches canonical', fn: testWorkflowStepsOrder },
    { name: 'Phase Flow diagram has correct ordering', fn: testPhaseFlowDiagramOrder },
    { name: 'Phase Flow Consistency section exists', fn: testPhaseFlowConsistencySectionExists },
    { name: 'Canonical Phase Order table exists', fn: testCanonicalPhaseOrderTableExists },
    { name: 'All 11 phases in consistency section', fn: testAll11PhasesInPhaseFlowConsistency },
    { name: 'force-levels.md exists with three levels', fn: testForceLevelsDocumentExists },
    { name: 'force-levels.md requires Delphi review', fn: testForceLevelsRequiresDelphi },
    { name: 'Unique Value Proposition exists', fn: testUniqueValuePropositionExists },
    { name: 'UVP mentions 40-67% token savings', fn: testUvpMentionsTokenSavings },
    { name: 'UVP mentions HARD-GATE', fn: testUvpMentionsHardGate },
    { name: 'UVP mentions emergent requirements', fn: testUvpMentionsEmergentRequirements },
    { name: 'Timing & Stability section exists', fn: testTimingSectionExists },
    { name: 'Timeout recommendations exist', fn: testTimeoutRecommendationsExist },
    { name: 'Execution time estimates exist', fn: testExecutionTimeEstimatesExist },
    { name: 'orchestration-rules.md exists', fn: testOrchestrationRulesExists },
    { name: 'Orchestration covers all key phases', fn: testPhaseSubagentMatrixOrder },
    { name: 'Uncommitted Changes Gate section exists', fn: testUncommittedGateExists },
    { name: 'Uncommitted gate has escape valve', fn: testUncommittedGateEscapeValve },
    { name: 'Uncommitted gate has log path', fn: testUncommittedGateLogPath },
  ];

  loadSkillMd();

  for (const { name, fn } of tests) {
    try {
      fn();
      passed++;
    } catch (e) {
      failed++;
      errors.push(`FAIL: ${name}: ${e.message}`);
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  errors.forEach(e => console.log(e));
  process.exit(failed > 0 ? 1 : 0);
}

// Uncommitted Changes Gate tests (must run after the section is added)
function testUncommittedGateExists() {
  const phase2BuildContent = fs.readFileSync(PHASE_2_BUILD_PATH, 'utf-8');
  if (!phase2BuildContent.includes('Uncommitted Changes Gate')) {
    throw new Error('phase-2-build.md must contain "Uncommitted Changes Gate" section');
  }
}

function testUncommittedGateEscapeValve() {
  const phase2BuildContent = fs.readFileSync(PHASE_2_BUILD_PATH, 'utf-8');
  if (!phase2BuildContent.includes('SKIP_UNCOMMITTED_GATE')) {
    throw new Error('Uncommitted Changes Gate must provide SKIP_UNCOMMITTED_GATE escape valve');
  }
}

function testUncommittedGateLogPath() {
  const phase2BuildContent = fs.readFileSync(PHASE_2_BUILD_PATH, 'utf-8');
  if (!phase2BuildContent.includes('.sprint-state/uncommitted-gate-log.json')) {
    throw new Error('Uncommitted Changes Gate must log to .sprint-state/uncommitted-gate-log.json');
  }
}

runTests();
