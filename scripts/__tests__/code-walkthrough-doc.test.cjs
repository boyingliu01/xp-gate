/**
 * @test REQ-DELPHI-MW-002
 * @intent Keep the canonical walkthrough evidence example executable by Gate MW
 * @covers AC-DELPHI-MW-002-01, AC-DELPHI-MW-002-02
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const WALKTHROUGH_DOC = path.join(PROJECT_ROOT, 'skills', 'delphi-review', 'references', 'code-walkthrough.md');
const VALIDATOR = path.join(PROJECT_ROOT, 'githooks', 'lib', 'validate-code-walkthrough.cjs');
const KNOWLEDGE_BASE_DOCS = [
  'skills/delphi-review/AGENTS.md',
  'plugins/qoder/skills/delphi-review/AGENTS.md',
  'src/npm-package/delphi-review/AGENTS.md',
  'src/npm-package/skills/delphi-review/AGENTS.md',
  'src/npm-package/plugins/claude-code/skills/delphi-review/AGENTS.md',
  'src/npm-package/plugins/opencode/skills/delphi-review/AGENTS.md',
  'src/npm-package/plugins/qoder/skills/delphi-review/AGENTS.md',
  'githooks/AGENTS.md',
];
const ACTIVE_SCOPE_DOCS = [
  'docs/ARCHITECTURE.md',
  'CONTRIBUTING.md',
  'src/mock-policy/AGENTS.md',
  'src/npm-package/mock-policy/AGENTS.md',
  ...KNOWLEDGE_BASE_DOCS,
];

describe('canonical code walkthrough documentation', () => {
  it('provides an evidence example accepted by the Gate MW validator', () => {
    const markdown = fs.readFileSync(WALKTHROUGH_DOC, 'utf8');
    const example = markdown.match(/\*\*输出文件格式\*\*[^`]*```json\n([\s\S]*?)\n```/);
    expect(example).not.toBeNull();

    const evidence = JSON.parse(example[1]);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthrough-doc-'));
    const evidencePath = path.join(tmpDir, '.code-walkthrough-result.json');
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

    const result = spawnSync(process.execPath, [
      VALIDATOR,
      evidencePath,
      evidence.commit,
      evidence.branch,
      evidence.timestamp,
    ], { encoding: 'utf8' });

    fs.rmSync(tmpDir, { recursive: true, force: true });
    expect(result.status, result.stderr).toBe(0);
  });

  it('does not preserve obsolete walkthrough size limits or authorized bypass claims in knowledge-base docs', () => {
    const obsoleteLimitPatterns = [
      /(?:20 files?|20 个文件)[\s\S]{0,160}(?:500 LOC|500 行|500-LOC)/i,
      /(?:500 LOC|500 行|500-LOC)[\s\S]{0,160}(?:20 files?|20 个文件)/i,
    ];
    const obsoleteBypassPatterns = [
      /(?:authorized|explicitly authorize|授权)[\s\S]{0,100}(?:skip|bypass|跳过|绕过)/i,
      /(?:skip|bypass|跳过|绕过)[\s\S]{0,100}(?:authorized|explicitly authorize|授权)/i,
    ];

    for (const relativePath of ACTIVE_SCOPE_DOCS) {
      const content = fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8');
      for (const claim of [...obsoleteLimitPatterns, ...obsoleteBypassPatterns]) {
        expect(content, `${relativePath} contains obsolete claim ${claim}`).not.toMatch(claim);
      }
    }
  });

  it('keeps walkthrough size policy independent of threshold and block language', () => {
    const content = fs.readFileSync(WALKTHROUGH_DOC, 'utf8');
    const section = (heading, nextHeading) => {
      const start = content.indexOf(heading);
      const end = content.indexOf(nextHeading, start + heading.length);
      return start >= 0 && end > start ? content.slice(start, end) : '';
    };
    const sizePolicySections = [
      section('## Five Core Properties', '## 触发条件'),
      section('## Anti-Patterns', '## Terminal State Checklist'),
    ].join('\n');
    const staleWalkthroughClaims = [
      /超过阈值必须 BLOCK，不能跳过/i,
      /超过阈值自动跳过走查/i,
    ];
    for (const claim of staleWalkthroughClaims) {
      expect(sizePolicySections).not.toMatch(claim);
    }

    const sizeContext = '(?:file|LOC|diff|文件|行数|变更大小|大型变更|large change)';
    const sizePolicyThresholdClaim = new RegExp(
      `${sizeContext}[\\s\\S]{0,120}(?:超过阈值|threshold)[\\s\\S]{0,80}(?:BLOCK|跳过|skip|auto-skip|自动跳过)`
      + `|(?:BLOCK|跳过|skip|auto-skip|自动跳过)[\\s\\S]{0,80}(?:超过阈值|threshold)[\\s\\S]{0,120}${sizeContext}`,
      'i'
    );
    expect(sizePolicySections).not.toMatch(sizePolicyThresholdClaim);
    expect('consensus threshold below 90% -> BLOCK').not.toMatch(sizePolicyThresholdClaim);
  });
});
