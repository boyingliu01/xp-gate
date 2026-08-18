'use strict';

const { execSync, execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Run a bash shell script cross-platform.
 * On Unix: uses bash directly.
 * On Windows: tries bash from PATH (Git Bash / WSL), falls back to a clear message.
 */
function runBashScript(scriptPath) {
  if (process.platform === 'win32') {
    // Check if bash is available on Windows (Git Bash, MSYS2, WSL)
    try {
      execSync('bash --version', { stdio: 'pipe', timeout: 5000 });
    } catch {
      console.log('⚠️  This gate requires bash to run shell scripts.');
      console.log('   On Windows, install Git for Windows (includes Git Bash) or enable WSL.');
      console.log('   Alternatively, install the required tool directly and run the gate again.');
      return;
    }
  }
  // bash is available — run the script (Unix always, or Windows after check above)
  execSync(`bash "${scriptPath}"`, { stdio: 'inherit' });
}

/**
 * Run a gate adapter fragment standalone.
 *
 * The gate fragments in githooks/adapters/gate-*.sh are designed to be *sourced*
 * into the pre-commit hook, which pre-defines the context they rely on:
 *   - PROJECT_LANG (from detect_project_lang)
 *   - CHANGED_FILES (from git)
 *   - gate_start_ms() / record_gate_audit() / now_ms() audit & timing helpers
 *
 * When `xp-gate check` invokes a gate standalone, that context is missing and
 * the fragments fail with "command not found". This wrapper reconstructs the
 * same preamble the pre-commit hook sets up, then *sources* the fragment so it
 * behaves exactly as it does inside the commit hook.
 */
function runGateAdapter(scriptPath, cwd = process.cwd()) {
  if (process.platform === 'win32') {
    try {
      execSync('bash --version', { stdio: 'pipe', timeout: 5000 });
    } catch {
      console.log('⚠️  This gate requires bash to run shell scripts.');
      console.log('   On Windows, install Git for Windows (includes Git Bash) or enable WSL.');
      console.log('   Alternatively, install the required tool directly and run the gate again.');
      return;
    }
  }
  const scriptDir = path.dirname(scriptPath);
  const commonScript = [
    path.join(scriptDir, 'adapter-common.sh'),
    path.join(scriptDir, '..', 'adapter-common.sh'),
    path.join(cwd, 'githooks', 'adapter-common.sh'),
  ].find(candidate => fs.existsSync(candidate)) || '';
  const nowMsScript = [
    path.join(scriptDir, 'lib', 'now-ms.sh'),
    path.join(scriptDir, '..', 'lib', 'now-ms.sh'),
    path.resolve(__dirname, '..', 'hooks', 'lib', 'now-ms.sh'),
  ].find(candidate => fs.existsSync(candidate)) || '';

  // Build the shell preamble the pre-commit hook would otherwise inject before
  // sourcing the gate fragment, then source that fragment. Deliberately NOT
  // set -u (the pre-commit hook does not use it), so fragments that reference
  // a not-yet-defined variable fail the same way inside the commit hook.
  const wrap = [
    'if [ -n "$1" ] && [ -f "$1" ]; then source "$1"; fi',
    'if [ -n "$2" ] && [ -f "$2" ]; then source "$2"; fi',
    'if ! command -v now_ms >/dev/null 2>&1; then now_ms() { "$4" -e "console.log(Date.now())"; }; fi',
    'gate_start_ms() { now_ms; }',
    'record_gate_audit() { :; }',
    'PROJECT_LANG="$(detect_project_lang 2>/dev/null || echo unknown)"',
    'CHANGED_FILES="$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || true)"',
    'if [ -z "${CHANGED_FILES}" ] && [ -n "$(git rev-parse HEAD 2>/dev/null)" ]; then',
    '  CHANGED_FILES="$(git diff HEAD --name-only --diff-filter=ACM 2>/dev/null || true)"',
    'fi',
    'source "$3"',
  ].join('\n');

  // execFileSync avoids an extra /bin/sh layer, so bash receives the script as a
  // single argv arg (no shell-metacharacter injection through the path).
  execFileSync(
    'bash',
    ['--noprofile', '--norc', '-c', wrap, 'xp-gate', commonScript, nowMsScript, scriptPath, process.execPath],
    { stdio: 'inherit', cwd }
  );
}

// Gate metadata registry — maps gate IDs to names, descriptions, and how to run them.
// Standalone gates (<gate-id>: { run }) are invokable via xp-gate gate-<id>.
// Pre-commit-only gates (<gate-id>: { preCommitOnly: true }) run only in git commit context.

/**
 * Run a TypeScript gate module via npx tsx.
 * Finds the .ts entry point, spawns tsx with --run flag.
 * Falls back to bash script if TypeScript module not found.
 */
function runTsGate(gateModule, targetPath) {
  const targetCwd = targetPath ? path.resolve(targetPath) : process.cwd();
  const entry = findTsGateEntry(gateModule);
  if (!entry) {
    // Fallback to bash script
    const gateNum = gateModule.replace('gate-', '');
    const script = resolveGateScript(gateNum, targetCwd);
    if (script) {
      runGateAdapter(script, targetCwd);
    } else {
      console.log(`Gate ${gateModule}: TypeScript module not found and no bash fallback available.`);
    }
    return 0;
  }

  const args = ['-y', 'tsx', entry, '--run'];
  if (targetPath) args.push('--cwd', targetPath);

  const result = spawnSync('npx', args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd: targetCwd,
    timeout: 120000,
  });

  return result.status === null ? 1 : result.status;
}

function findTsGateEntry(gateModule) {
  const candidates = [
    // Development layout
    path.resolve(__dirname, '..', '..', '..', 'src', 'gates', `${gateModule}.ts`),
    // npm package bundled layout
    path.resolve(__dirname, '..', 'gates', `${gateModule}.ts`),
    // node_modules install
    path.resolve(__dirname, '..', '..', 'src', 'gates', `${gateModule}.ts`),
    // Repo root
    path.resolve(process.cwd(), 'src', 'gates', `${gateModule}.ts`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
// allow: SIZE_OK - this module's bulk is the declarative gate registry below.
const GATE_REGISTRY = {
  '0': {
    name: 'Version Consistency',
    description: 'Check VERSION file matches all package.json versions',
    aliases: ['version', '0'],
    preCommitOnly: true,
    reason: 'Requires git-staged context to compare VERSION with package.json files',
  },
  '1': {
    name: 'Code Quality',
    description: 'Language-specific static analysis and linting (ESLint, Ruff, govet, etc.)',
    aliases: ['lint', '1'],
    preCommitOnly: true,
    reason: 'Requires language detection from changed files and adapter routing',
  },
  '2': {
    name: 'Duplicate Code',
    description: 'jscpd duplicate code detection',
    aliases: ['duplicates', 'dup', '2'],
    run: (targetPath) => {
      const jscpdConfig = findConfig(targetPath, 'jscpd.conf.json');
      const args = [targetPath || '.'];
      if (jscpdConfig) args.push('--config', jscpdConfig);
      execFileSync('npx', ['-y', 'jscpd', ...args], { stdio: 'inherit', shell: true });
    },
  },
  '3': {
    name: 'Cyclomatic Complexity',
    description: 'lizard cyclomatic complexity analysis',
    aliases: ['complexity', 'ccn', '3'],
    run: (targetPath) => {
      return runTsGate('gate-3', targetPath);
    },
  },
  '4': {
    name: 'Clean Code + SOLID Principles',
    description: '14 Clean Code/SOLID rules across 9 languages',
    aliases: ['principles', 'principle', '4'],
    run: (targetPath) => {
      const { principles } = require('./principles.js');
      return principles([targetPath || '.']);
    },
  },
  '5': {
    name: 'Tests + Coverage',
    description: 'Unit test execution and code coverage enforcement (≥80%)',
    aliases: ['tests', 'test', '5'],
    preCommitOnly: true,
    reason: 'Requires language detection and adapter-sourced test execution with coverage reports',
  },
  '6': {
    name: 'Architecture + Boy Scout Rule',
    description: 'Architecture layer boundary validation and warning baseline enforcement',
    aliases: ['architecture', 'arch', '6'],
    run: (targetPath) => {
      const { arch } = require('./arch.js');
      return arch([]);
    },
  },
  '7': {
    name: 'IaC Security',
    description: 'Infrastructure-as-Code security scanning (checkov, hadolint, kube-score, tflint)',
    aliases: ['iac', 'infra', '7'],
    run: (targetPath) => {
      return runTsGate('gate-7', targetPath);
    },
  },
  '8': {
    name: 'Secret Scanning',
    description: 'gitleaks secret and credential detection',
    aliases: ['secrets', 'secret', '8'],
    run: (targetPath) => {
      return runTsGate('gate-8', targetPath);
    },
  },
  '9': {
    name: 'SAST Security',
    description: 'semgrep static application security testing',
    aliases: ['sast', 'semgrep', '9'],
    run: (targetPath) => {
      return runTsGate('gate-9', targetPath);
    },
  },
  '10': {
    name: 'Build Integrity',
    description: 'TypeScript compilation, npm pack, and import validation',
    aliases: ['build', '10'],
    preCommitOnly: true,
    reason: 'Build integrity checks require language detection and build tool context',
  },
  '11': {
    name: 'Sprint Flow Enforcement',
    description: 'Sprint state and delphi-review validation',
    aliases: ['sprint', '11'],
    preCommitOnly: true,
    reason: 'Requires sprint state (.sprint-state/) and git branch context',
  },
  'python-health': {
    name: 'Python Environment Health',
    description: 'Comprehensive Python environment diagnostics',
    aliases: ['python-health', 'py-health'],
    run: (targetPath) => {
      return runTsGate('python-health', targetPath);
    },
  },
  'test-layers': {
    name: 'Test Layer Analytics',
    description: 'Report test distribution across unit/integration/e2e layers',
    aliases: ['test-layers', 'layers', 'test-analytics'],
    run: (targetPath) => {
      return runTsGate('test-layers', targetPath);
    },
  },
  'pbt': {
    name: 'Property-Based Testing Detection',
    description: 'Detect PBT framework usage and report coverage',
    aliases: ['pbt', 'pbt-detect', 'property-based-testing'],
    run: (targetPath) => {
      return runTsGate('pbt-detect', targetPath);
    },
  },
};

// Reverse-lookup: alias → gate ID (built once at module load)
const ALIAS_MAP = {};
(function buildAliasMap() {
  for (const [id, info] of Object.entries(GATE_REGISTRY)) {
    const aliases = Array.isArray(info.aliases) ? info.aliases : [];
    for (const alias of aliases) {
      ALIAS_MAP[String(alias).toLowerCase()] = id;
    }
  }
})();

/**
 * Resolve a gate alias (name or number string) to its canonical gate ID.
 * Returns null if no match.
 */
function resolveAlias(maybeAlias) {
  if (maybeAlias == null) return null;
  const key = String(maybeAlias).toLowerCase();
  // Direct numeric ID lookup
  if (GATE_REGISTRY[key]) return key;
  // Alias lookup
  return ALIAS_MAP[key] || null;
}

/**
 * Get all aliases for a given gate ID, or empty array.
 */
function getAliases(gateId) {
  const info = GATE_REGISTRY[String(gateId)];
  return info && Array.isArray(info.aliases) ? info.aliases : [];
}

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

function resolveGateScript(gateNum, cwd = process.cwd()) {
  const candidates = [
    path.join(cwd, 'githooks', 'gates', `gate-${gateNum}-*.sh`),
    path.join(cwd, 'githooks', `gate-${gateNum}.sh`),
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
    aliases: Array.isArray(info.aliases) ? info.aliases : [],
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

module.exports = { GATE_REGISTRY, getGateInfo, getAllGates, runGate, resolveAlias, getAliases, runGateAdapter, findTsGateEntry, resolveGateScript };
