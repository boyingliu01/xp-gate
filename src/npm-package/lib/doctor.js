const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  HOME_DIR,
  CONFIG_DIR,
  CONFIG_FILE,
  GLOBAL_HOOKS_DIR,
  GLOBAL_ADAPTERS_DIR,
  detectPlatform,
  getTemplateDir,
} = require('./shared-paths.js');
const { checkUpgrade, formatUpgradeMsg } = require('./check-version.js');

// npm package source dir (template hooks/adapters)
const PKG_DIR = path.dirname(__dirname);

/**
 * Read the package version from the installed package.json.
 * @returns {string|null}
 */
function getPackageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));
    return pkg.version || null;
  } catch {
    return null;
  }
}

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

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
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
 * Validate config file exists, is parseable, and has a known mode.
 * Returns { config: object|null, checks: Array, issues: number }
 * When config is unrecoverable, returns null to stop further checks.
 */
function checkConfig() {
  const config = getConfig();
  if (config === null) {
    return { config: null, checks: [{ name: 'Config file', status: 'FAIL', detail: 'Not found' }], issues: 1 };
  }
  if (config === 'corrupt') {
    return { config: null, checks: [{ name: 'Config file', status: 'FAIL', detail: 'Corrupt JSON' }], issues: 1 };
  }
  if (config.mode !== 'local' && config.mode !== 'global') {
    return { config: null, checks: [
      { name: 'Config file', status: 'PASS', detail: CONFIG_FILE },
      { name: 'Install mode', status: 'FAIL', detail: `Unknown: ${config.mode}` }
    ], issues: 1 };
  }
  return { config, checks: [
    { name: 'Config file', status: 'PASS', detail: CONFIG_FILE },
    { name: 'Install mode', status: 'PASS', detail: config.mode }
  ], issues: 0 };
}

function checkLocalHooks(checks) {
  let issues = 0;
  const gitDir = getGitDir();
  if (!gitDir) {
    checks.push({ name: 'Git repository', status: 'FAIL', detail: 'Not in a git repo' });
    return 1;
  }
  const hooksDir = path.join(gitDir, 'hooks');
  issues += checkSingleHook(hooksDir, 'pre-commit', SIGNATURES['pre-commit'], 'Hooks', checks);
  issues += checkSingleHook(hooksDir, 'pre-push', SIGNATURES['pre-push'], 'Hooks', checks);
  return issues;
}

function checkGlobalHooks(checks) {
  let issues = 0;
  issues += checkSingleHook(GLOBAL_HOOKS_DIR, 'pre-commit', SIGNATURES['pre-commit'], 'Global hooks', checks);
  issues += checkSingleHook(GLOBAL_HOOKS_DIR, 'pre-push', SIGNATURES['pre-push'], 'Global hooks', checks);

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
  return issues;
}

/**
 * Check a single hook file exists and is an xp-gate file.
 */
function checkSingleHook(hooksDir, name, signature, label, checks) {
  const hookPath = path.join(hooksDir, name);
  if (!fs.existsSync(hookPath) || !isXpGateFile(hookPath, signature)) {
    checks.push({ name: `${label}: ${name}`, status: 'FAIL', detail: 'Missing or not xp-gate' });
    return 1;
  }
  checks.push({ name: `${label}: ${name}`, status: 'PASS', detail: hookPath });
  return 0;
}

function checkAdapters(checks, mode, gitDir) {
  const adaptersDir = mode === 'local'
    ? path.join(path.dirname(gitDir || ''), 'githooks', 'adapters')
    : GLOBAL_ADAPTERS_DIR;

  if (!adaptersDir || !fs.existsSync(adaptersDir)) {
    checks.push({ name: 'Adapters directory', status: 'FAIL', detail: 'Missing' });
    return 1;
  }
  const adapterFiles = fs.readdirSync(adaptersDir).filter(f => f.endsWith('.sh'));
  if (adapterFiles.length === 0) {
    checks.push({ name: 'Adapters directory', status: 'FAIL', detail: 'Empty directory' });
    return 1;
  }
  checks.push({ name: 'Adapters directory', status: 'PASS', detail: `${adapterFiles.length} adapter(s)` });
  return 0;
}

/**
 * Build check report for the doctor.
 * Returns { checks: Array<{name, status, detail}>, issues: number }
 */
function diagnose() {
  const checks = [];
  let issues = 0;

  // --- Check 1: Config file ---
  const configResult = checkConfig();
  if (configResult.config === null) {
    return { checks: configResult.checks, issues: configResult.issues };
  }
  const { config } = configResult;
  checks.push(...configResult.checks);
  issues += configResult.issues;

  // --- Check 2: Version mismatch ---
  const pkgVersion = getPackageVersion();
  const configVersion = config.version;
  if (configVersion && pkgVersion && configVersion !== pkgVersion) {
    checks.push({
      name: 'Version mismatch',
      status: 'FAIL',
      detail: `config: ${configVersion}, package: ${pkgVersion} — run 'xp-gate doctor --fix' to sync`
    });
    issues++;
  }

  // --- Check 3: templateDir validation ---
  const configTemplateDir = config.templateDir;
  if (configTemplateDir) {
    const expectedTemplateDir = getTemplateDir();
    if (configTemplateDir !== expectedTemplateDir) {
      checks.push({
        name: 'templateDir',
        status: 'FAIL',
        detail: `points to ${configTemplateDir}, expected ${expectedTemplateDir} for current platform`
      });
      issues++;
    }
  }

  // --- Check 4: Hooks files ---
  if (config.mode === 'local') {
    issues += checkLocalHooks(checks);
  } else {
    issues += checkGlobalHooks(checks);
  }

  // --- Check 5: Adapters directory ---
  issues += checkAdapters(checks, config.mode, getGitDir());

  // --- Check 6: Environment dependencies ---
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
 * Copy a hook file from package source to target, creating parent dir if needed.
 */
function restoreHook(srcFile, destFile, label) {
  if (!fs.existsSync(srcFile)) return false;
  const destDir = path.dirname(destFile);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(srcFile, destFile);
  fs.chmodSync(destFile, 0o755);
  console.log(`  ✓ Restored ${label}`);
  return true;
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

  // Fix version mismatch — update config version to match package
  const pkgVersion = getPackageVersion();
  if (pkgVersion && config.version !== pkgVersion) {
    config.version = pkgVersion;
    saveConfig(config);
    console.log(`  ✓ Updated config version to ${pkgVersion}`);
    fixed = true;
  }

  // Fix templateDir mismatch
  const expectedTemplateDir = getTemplateDir();
  if (config.templateDir && config.templateDir !== expectedTemplateDir) {
    config.templateDir = expectedTemplateDir;
    saveConfig(config);
    console.log(`  ✓ Updated templateDir to ${expectedTemplateDir}`);
    fixed = true;
  }

  // Fix missing hooks
  if (config.mode === 'local') {
    const gitDir = getGitDir();
    if (gitDir) {
      const hooksDir = path.join(gitDir, 'hooks');
      fixed = restoreHook(path.join(srcDir, 'hooks', 'pre-commit'), path.join(hooksDir, 'pre-commit'), 'pre-commit hook') || fixed;
      fixed = restoreHook(path.join(srcDir, 'hooks', 'pre-push'), path.join(hooksDir, 'pre-push'), 'pre-push hook') || fixed;
    }
  } else {
    const hooksDir = GLOBAL_HOOKS_DIR;
    fixed = restoreHook(path.join(srcDir, 'hooks', 'pre-commit'), path.join(hooksDir, 'pre-commit'), 'global pre-commit hook') || fixed;
    fixed = restoreHook(path.join(srcDir, 'hooks', 'pre-push'), path.join(hooksDir, 'pre-push'), 'global pre-push hook') || fixed;
  }

  // Fix core.hooksPath (global mode only)
  if (config.mode === 'global') {
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
function isActiveMode(config) {
  return config && config !== 'corrupt' && (config.mode === 'local' || config.mode === 'global');
}

function isUninstalledMode(config) {
  return config && config !== 'corrupt' && config.mode === 'uninstalled';
}

async function doctor(args) {
  const fixMode = args.includes('--fix');

  console.log('XP-Gate Doctor');
  console.log('==============');

  const config = getConfig();

  // §4.8: mode === "uninstalled" → print "xp-gate is not installed"
  if (isUninstalledMode(config)) {
    console.log('xp-gate is not installed.');
    console.log('Run xp-gate init to install.');
    return 0;
  }

  // §4.13: --fix only when mode === "active"
  if (fixMode && isActiveMode(config)) {
    fixIssues(null, config);
  }

  const { checks, issues } = diagnose();

  printReport(checks);

  // --- Check 7: Version upgrade check ---
  try {
    const upgradeResult = await checkUpgrade();
    const msg = formatUpgradeMsg(upgradeResult, 'doctor');
    if (msg) {
      console.log(`\n  ℹ ${msg}`);
    }
  } catch { /* non-blocking — don't fail doctor on network issue */ }

  if (issues === 0) {
    console.log('\n✓ All checks passed');
    return 0;
  }

  console.log(`\n✗ ${issues} issue(s) found`);

  // Re-run diagnosis after fix to report updated status
  if (fixMode && isActiveMode(config)) {
    console.log('\nRe-running diagnosis after fix...');
    const { checks: postChecks } = diagnose();
    printReport(postChecks);
  }

  return issues > 0 ? 1 : 0;
}

module.exports = { doctor, isXpGateFile, SIGNATURES };
