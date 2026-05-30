const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Cross-platform home directory resolution
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || os.homedir();

const CONFIG_DIR = path.join(HOME_DIR, '.config', 'xp-gate');
const CONFIG_FILE = path.join(CONFIG_DIR, 'xp-gate.json');
const GLOBAL_HOOKS_DIR = path.join(CONFIG_DIR, 'hooks');
const GLOBAL_ADAPTERS_DIR = path.join(CONFIG_DIR, 'adapters');

// npm package source dir (template hooks/adapters)
const PKG_DIR = path.dirname(__dirname);

/**
 * Signature strings used to verify file ownership.
 */
const SIGNATURES = {
  'pre-commit': 'OpenCode Quality Gates - Pre-Commit Hook',
  'pre-push': 'Pre-push Hook - Code Walkthrough Result Validator',
  'adapter-common.sh': 'detect_project_lang()'
};

function isXpGateFile(filePath, signature) {
  if (!fs.existsSync(filePath)) return false;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.includes(signature);
  } catch {
    return false;
  }
}

function getConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return 'corrupt';
  }
}

function getGitDir() {
  try {
    return execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function getCurrentHooksPath() {
  try {
    const result = execSync('git config --global core.hooksPath', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return result.trim();
  } catch {
    return null;
  }
}

function checkEnv(checks) {
  const envChecks = [
    { name: 'Node.js', cmd: 'node --version', label: null },
    { name: 'Git', cmd: 'git --version', label: null },
    { name: 'Bash', cmd: 'bash --version', label: null }
  ];

  let allOk = true;
  for (const env of envChecks) {
    try {
      const output = execSync(env.cmd, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
      const version = output.trim().split('\n')[0];
      env.label = version;
      checks.push({ name: `Environment: ${env.name}`, status: 'PASS', detail: version });
    } catch {
      checks.push({ name: `Environment: ${env.name}`, status: 'FAIL', detail: 'Not found' });
      allOk = false;
    }
  }

  return allOk;
}

/**
 * Build check report for the doctor.
 * Returns { checks: Array<{name, status, detail}>, issues: number }
 */
function diagnose() {
  const checks = [];
  let issues = 0;
  const config = getConfig();

  // --- Check 1: Config file ---
  if (config === null) {
    checks.push({ name: 'Config file', status: 'FAIL', detail: 'Not found' });
    issues++;
    return { checks, issues }; // Cannot proceed without config
  }

  if (config === 'corrupt') {
    checks.push({ name: 'Config file', status: 'FAIL', detail: 'Corrupt JSON' });
    issues++;
    return { checks, issues }; // Cannot proceed with corrupt config
  }

  checks.push({ name: 'Config file', status: 'PASS', detail: CONFIG_FILE });

  // Check mode
  if (config.mode !== 'local' && config.mode !== 'global') {
    checks.push({ name: 'Install mode', status: 'FAIL', detail: `Unknown: ${config.mode}` });
    issues++;
    return { checks, issues };
  }

  checks.push({ name: 'Install mode', status: 'PASS', detail: config.mode });

  // --- Check 2: Hooks files ---
  if (config.mode === 'local') {
    const gitDir = getGitDir();
    if (!gitDir) {
      checks.push({ name: 'Git repository', status: 'FAIL', detail: 'Not in a git repo' });
      issues++;
    } else {
      const hooksDir = path.join(gitDir, 'hooks');
      const preCommit = path.join(hooksDir, 'pre-commit');
      const prePush = path.join(hooksDir, 'pre-push');

      if (!fs.existsSync(preCommit) || !isXpGateFile(preCommit, SIGNATURES['pre-commit'])) {
        checks.push({ name: 'Hooks: pre-commit', status: 'FAIL', detail: 'Missing or not xp-gate' });
        issues++;
      } else {
        checks.push({ name: 'Hooks: pre-commit', status: 'PASS', detail: preCommit });
      }

      if (!fs.existsSync(prePush) || !isXpGateFile(prePush, SIGNATURES['pre-push'])) {
        checks.push({ name: 'Hooks: pre-push', status: 'FAIL', detail: 'Missing or not xp-gate' });
        issues++;
      } else {
        checks.push({ name: 'Hooks: pre-push', status: 'PASS', detail: prePush });
      }
    }
  } else if (config.mode === 'global') {
    // Check global hooks directory
    const preCommit = path.join(GLOBAL_HOOKS_DIR, 'pre-commit');
    const prePush = path.join(GLOBAL_HOOKS_DIR, 'pre-push');

    if (!fs.existsSync(preCommit) || !isXpGateFile(preCommit, SIGNATURES['pre-commit'])) {
      checks.push({ name: 'Global hooks: pre-commit', status: 'FAIL', detail: 'Missing or not xp-gate' });
      issues++;
    } else {
      checks.push({ name: 'Global hooks: pre-commit', status: 'PASS', detail: preCommit });
    }

    if (!fs.existsSync(prePush) || !isXpGateFile(prePush, SIGNATURES['pre-push'])) {
      checks.push({ name: 'Global hooks: pre-push', status: 'FAIL', detail: 'Missing or not xp-gate' });
      issues++;
    } else {
      checks.push({ name: 'Global hooks: pre-push', status: 'PASS', detail: prePush });
    }

    // --- Check 4: core.hooksPath (global mode only) ---
    const hooksPath = getCurrentHooksPath();
    if (hooksPath === null || hooksPath === '') {
      checks.push({ name: 'Git core.hooksPath', status: 'FAIL', detail: 'Not set' });
      issues++;
    } else if (hooksPath !== GLOBAL_HOOKS_DIR) {
      checks.push({ name: 'Git core.hooksPath', status: 'FAIL', detail: `Expected ${GLOBAL_HOOKS_DIR}, got ${hooksPath}` });
      issues++;
    } else {
      checks.push({ name: 'Git core.hooksPath', status: 'PASS', detail: GLOBAL_HOOKS_DIR });
    }
  }

  // --- Check 3: Adapters directory ---
  const adaptersDir = config.mode === 'local'
    ? path.join(path.dirname(getGitDir() || ''), 'githooks', 'adapters')
    : GLOBAL_ADAPTERS_DIR;

  if (!adaptersDir || !fs.existsSync(adaptersDir)) {
    checks.push({ name: 'Adapters directory', status: 'FAIL', detail: 'Missing' });
    issues++;
  } else {
    const adapterFiles = fs.readdirSync(adaptersDir).filter(f => f.endsWith('.sh'));
    if (adapterFiles.length === 0) {
      checks.push({ name: 'Adapters directory', status: 'FAIL', detail: 'Empty directory' });
      issues++;
    } else {
      checks.push({ name: 'Adapters directory', status: 'PASS', detail: `${adapterFiles.length} adapter(s)` });
    }
  }

  // --- Check 5: Environment dependencies ---
  checkEnv(checks);

  return { checks, issues };
}

/**
 * Print the check results in a readable format.
 */
function printReport(checks) {
  console.log('');
  console.log('Diagnosis Report:');
  console.log('-----------------');

  for (const check of checks) {
    const statusSymbol = check.status === 'PASS' ? ' ✓' : ' ✗';
    console.log(`  ${statusSymbol} ${check.name}: ${check.detail}`);
  }
}

/**
 * Attempt to fix known issues.
 * Only operates when mode === 'active' (local or global).
 */
function fixIssues(checks, config) {
  console.log('');
  console.log('Attempting fixes...');
  console.log('-------------------');

  const srcDir = PKG_DIR;
  let fixed = false;

  // Fix missing hooks
  if (config.mode === 'local') {
    const gitDir = getGitDir();
    if (gitDir) {
      const hooksDir = path.join(gitDir, 'hooks');
      const preCommit = path.join(hooksDir, 'pre-commit');
      const prePush = path.join(hooksDir, 'pre-push');

      if (!fs.existsSync(preCommit) || !isXpGateFile(preCommit, SIGNATURES['pre-commit'])) {
        const src = path.join(srcDir, 'hooks', 'pre-commit');
        if (fs.existsSync(src)) {
          fs.mkdirSync(hooksDir, { recursive: true });
          fs.copyFileSync(src, preCommit);
          fs.chmodSync(preCommit, 0o755);
          console.log('  ✓ Restored pre-commit hook');
          fixed = true;
        }
      }

      if (!fs.existsSync(prePush) || !isXpGateFile(prePush, SIGNATURES['pre-push'])) {
        const src = path.join(srcDir, 'hooks', 'pre-push');
        if (fs.existsSync(src)) {
          fs.mkdirSync(hooksDir, { recursive: true });
          fs.copyFileSync(src, prePush);
          fs.chmodSync(prePush, 0o755);
          console.log('  ✓ Restored pre-push hook');
          fixed = true;
        }
      }
    }
  } else if (config.mode === 'global') {
    const preCommit = path.join(GLOBAL_HOOKS_DIR, 'pre-commit');
    const prePush = path.join(GLOBAL_HOOKS_DIR, 'pre-push');

    if (!fs.existsSync(preCommit) || !isXpGateFile(preCommit, SIGNATURES['pre-commit'])) {
      const src = path.join(srcDir, 'hooks', 'pre-commit');
      if (fs.existsSync(src)) {
        fs.mkdirSync(GLOBAL_HOOKS_DIR, { recursive: true });
        fs.copyFileSync(src, preCommit);
        fs.chmodSync(preCommit, 0o755);
        console.log('  ✓ Restored global pre-commit hook');
        fixed = true;
      }
    }

    if (!fs.existsSync(prePush) || !isXpGateFile(prePush, SIGNATURES['pre-push'])) {
      const src = path.join(srcDir, 'hooks', 'pre-push');
      if (fs.existsSync(src)) {
        fs.mkdirSync(GLOBAL_HOOKS_DIR, { recursive: true });
        fs.copyFileSync(src, prePush);
        fs.chmodSync(prePush, 0o755);
        console.log('  ✓ Restored global pre-push hook');
        fixed = true;
      }
    }

    // Fix core.hooksPath
    const hooksPath = getCurrentHooksPath();
    if (hooksPath !== GLOBAL_HOOKS_DIR) {
      try {
        execSync(`git config --global core.hooksPath "${GLOBAL_HOOKS_DIR}"`, {
          stdio: ['pipe', 'pipe', 'pipe']
        });
        console.log(`  ✓ Set core.hooksPath to ${GLOBAL_HOOKS_DIR}`);
        fixed = true;
      } catch (e) {
        console.log(`  ✗ Could not set core.hooksPath: ${e.message}`);
      }
    }
  }

  // Fix missing adapters
  const adaptersDir = config.mode === 'local'
    ? path.join(path.dirname(getGitDir() || ''), 'githooks', 'adapters')
    : GLOBAL_ADAPTERS_DIR;

  if (adaptersDir && (!fs.existsSync(adaptersDir) || fs.readdirSync(adaptersDir).filter(f => f.endsWith('.sh')).length === 0)) {
    const pkgAdaptersDir = path.join(srcDir, 'adapters');
    if (fs.existsSync(pkgAdaptersDir)) {
      fs.mkdirSync(adaptersDir, { recursive: true });
      const adapterFiles = fs.readdirSync(pkgAdaptersDir).filter(f => f.endsWith('.sh'));
      for (const f of adapterFiles) {
        fs.copyFileSync(path.join(pkgAdaptersDir, f), path.join(adaptersDir, f));
      }
      console.log(`  ✓ Restored ${adapterFiles.length} adapter(s)`);
      fixed = true;
    }
  }

  if (!fixed) {
    console.log('  No fixable issues found.');
  }
}

/**
 * @param {string[]} args CLI arguments
 * @returns {number} exit code (0 = all clear, 1 = issues found)
 */
async function doctor(args) {
  const fixMode = args.includes('--fix');

  console.log('XP-Gate Doctor');
  console.log('==============');

  const config = getConfig();

  // §4.8: mode === "uninstalled" → print "xp-gate is not installed"
  if (config && config !== 'corrupt' && config.mode === 'uninstalled') {
    console.log('xp-gate is not installed.');
    console.log('Run xp-gate init to install.');
    return 0;
  }

  // §4.13: --fix only when mode === "active"
  if (fixMode && config && config !== 'corrupt' && (config.mode === 'local' || config.mode === 'global')) {
    fixIssues(null, config);
  }

  const { checks, issues } = diagnose();

  printReport(checks);

  if (issues === 0) {
    console.log('\n✓ All checks passed');
    return 0;
  }

  console.log(`\n✗ ${issues} issue(s) found`);

  if (fixMode && config && config !== 'corrupt' && (config.mode === 'local' || config.mode === 'global')) {
    // Re-run diagnosis after fix to report updated status
    console.log('\nRe-running diagnosis after fix...');
    const { checks: postChecks } = diagnose();
    printReport(postChecks);
  }

  return issues > 0 ? 1 : 0;
}

module.exports = { doctor, isXpGateFile, SIGNATURES };
