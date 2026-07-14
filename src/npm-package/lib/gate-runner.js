'use strict';

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Gate metadata registry — maps gate IDs to names, descriptions, and how to run them.
// Standalone gates (<gate-id>: { run }) are invokable via xp-gate gate-<id>.
// Pre-commit-only gates (<gate-id>: { preCommitOnly: true }) run only in git commit context.
const GATE_REGISTRY = {
  '0': {
    name: 'Version Consistency',
    description: 'Check VERSION file matches all package.json versions',
    preCommitOnly: true,
    reason: 'Requires git-staged context to compare VERSION with package.json files',
  },
  '1': {
    name: 'Code Quality',
    description: 'Language-specific static analysis and linting (ESLint, Ruff, govet, etc.)',
    preCommitOnly: true,
    reason: 'Requires language detection from changed files and adapter routing',
  },
  '2': {
    name: 'Duplicate Code',
    description: 'jscpd duplicate code detection',
    run: (targetPath) => {
      const jscpdConfig = findConfig(targetPath, 'jscpd.conf.json');
      const args = [targetPath || '.'];
      if (jscpdConfig) args.push('--config', jscpdConfig);
      execFileSync('npx', ['-y', 'jscpd', ...args], { stdio: 'inherit' });
    },
  },
  '3': {
    name: 'Cyclomatic Complexity',
    description: 'lizard cyclomatic complexity analysis',
    run: (targetPath) => {
      const script = resolveGateScript('3');
      if (script) {
        execSync(`bash "${script}"`, { stdio: 'inherit' });
      } else {
        const target = targetPath || '.';
        console.log(`Running lizard on ${target}...`);
        execFileSync('lizard', [target, '--CCN', '10', '--length', '50', '--arguments', '5', '--warnings_only'], { stdio: 'inherit' });
      }
    },
  },
  '4': {
    name: 'Clean Code + SOLID Principles',
    description: '14 Clean Code/SOLID rules across 9 languages',
    run: (targetPath) => {
      const { principles } = require('./principles.js');
      return principles([targetPath || '.']);
    },
  },
  '5': {
    name: 'Tests + Coverage',
    description: 'Unit test execution and code coverage enforcement (≥80%)',
    preCommitOnly: true,
    reason: 'Requires language detection and adapter-sourced test execution with coverage reports',
  },
  '6': {
    name: 'Architecture + Boy Scout Rule',
    description: 'Architecture layer boundary validation and warning baseline enforcement',
    run: (targetPath) => {
      const { arch } = require('./arch.js');
      return arch([]);
    },
  },
  '7': {
    name: 'IaC Security',
    description: 'Infrastructure-as-Code security scanning (checkov, hadolint, kube-score, tflint)',
    run: (targetPath) => {
      const script = resolveGateScript('7');
      if (script) {
        execSync(`bash "${script}"`, { stdio: 'inherit' });
      } else {
        console.log('IaC security scan requires git-staged context for changed files detection.');
        console.log('Run: git commit to trigger Gate 7 automatically.');
      }
    },
  },
  '8': {
    name: 'Secret Scanning',
    description: 'gitleaks secret and credential detection',
    run: (targetPath) => {
      const script = resolveGateScript('8');
      if (script) {
        execSync(`bash "${script}"`, { stdio: 'inherit' });
      } else {
        console.log('Secret scanning requires git-staged context for changed files detection.');
        console.log('Run: git commit to trigger Gate 8 automatically.');
      }
    },
  },
  '9': {
    name: 'SAST Security',
    description: 'semgrep static application security testing',
    run: (targetPath) => {
      const script = resolveGateScript('9');
      if (script) {
        execSync(`bash "${script}"`, { stdio: 'inherit' });
      } else {
        console.log('SAST scanning requires git-staged context for changed files detection.');
        console.log('Run: git commit to trigger Gate 9 automatically.');
      }
    },
  },
  '10': {
    name: 'Build Integrity',
    description: 'TypeScript compilation, npm pack, and import validation',
    preCommitOnly: true,
    reason: 'Build integrity checks require language detection and build tool context',
  },
  '11': {
    name: 'Sprint Flow Enforcement',
    description: 'Sprint state and delphi-review validation',
    preCommitOnly: true,
    reason: 'Requires sprint state (.sprint-state/) and git branch context',
  },
};

function findConfig(basePath, fileName) {
  const candidates = [
    path.join(basePath || '.', fileName),
    path.join(process.cwd(), fileName),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function resolveGateScript(gateNum) {
  const candidates = [
    path.join(process.cwd(), 'githooks', 'gates', `gate-${gateNum}-*.sh`),
    path.join(process.cwd(), 'githooks', `gate-${gateNum}.sh`),
  ];

  // Try glob patterns
  for (const pattern of candidates) {
    if (pattern.includes('*')) {
      const dir = path.dirname(pattern);
      const prefix = path.basename(pattern).replace('*', '');
      if (fs.existsSync(dir)) {
        const match = fs.readdirSync(dir).find(f => f.startsWith(`gate-${gateNum}-`) && f.endsWith('.sh'));
        if (match) return path.join(dir, match);
      }
    } else if (fs.existsSync(pattern)) {
      return pattern;
    }
  }

  // Check global install
  const globalDir = path.join(require('os').homedir(), '.config', 'xp-gate', 'adapters');
  const globalScript = path.join(globalDir, `gate-${gateNum}.sh`);
  if (fs.existsSync(globalScript)) return globalScript;

  return null;
}

function getGateInfo(gateId) {
  return GATE_REGISTRY[String(gateId)] || null;
}

function getAllGates() {
  return Object.entries(GATE_REGISTRY).map(([id, info]) => ({
    id,
    name: info.name,
    description: info.description,
    preCommitOnly: info.preCommitOnly || false,
    reason: info.reason || null,
  }));
}

async function runGate(gateId, targetPath) {
  const gate = GATE_REGISTRY[String(gateId)];
  if (!gate) {
    console.error(`Unknown gate: ${gateId}`);
    console.error('Available gates: ' + Object.keys(GATE_REGISTRY).join(', '));
    return 1;
  }

  if (gate.preCommitOnly) {
    console.log(`━━━ Gate ${gateId}: ${gate.name} ━━━`);
    console.log(`⏭️  SKIPPED - ${gate.reason}`);
    console.log('   This gate runs automatically during git commit.');
    console.log('   Run: git commit to trigger all gates.');
    return 0;
  }

  if (gate.run) {
    console.log(`━━━ Gate ${gateId}: ${gate.name} ━━━`);
    try {
      const result = gate.run(targetPath);
      if (result && typeof result.then === 'function') {
        return await result;
      }
      return 0;
    } catch (err) {
      console.error(` Gate ${gateId} FAILED: ${err.message}`);
      return 1;
    }
  }

  console.error(`Gate ${gateId}: ${gate.name} — no execution handler available`);
  return 1;
}

module.exports = { GATE_REGISTRY, getGateInfo, getAllGates, runGate };
