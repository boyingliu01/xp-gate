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
const { GATE_CLI_TOOLS, checkCliTool, getToolInstallCmd } = require('./detect-deps.js');

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

/**
 * Expected gate scripts that should be present in the adapters directory.
 * gate-5.sh and gate-6.sh are inline in pre-commit, so they are NOT expected here.
 */
const EXPECTED_GATE_SCRIPTS = [
  'gate-3.sh',
  'gate-4.sh',
  'gate-7.sh',
  'gate-8.sh',
  'gate-9.sh',
];

function checkAdapters(checks, mode, gitDir) {
  let issues = 0;
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
  checks.push({ name: 'Adapters directory', status: 'PASS', detail: `${adapterFiles.length} file(s)` });

  // Check for missing gate scripts (Issue #263 follow-up)
  const missingGates = EXPECTED_GATE_SCRIPTS.filter(g => !adapterFiles.includes(g));
  if (missingGates.length > 0) {
    checks.push({
      name: 'Gate scripts',
      status: 'FAIL',
      detail: `Missing: ${missingGates.join(', ')} — run 'xp-gate doctor --fix' to restore`
    });
    issues++;
  } else {
    checks.push({ name: 'Gate scripts', status: 'PASS', detail: `${EXPECTED_GATE_SCRIPTS.length} gate script(s)` });
  }

  return issues;
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
  issues += diagnoseVersion(config, getPackageVersion(), checks);

  // --- Check 3: templateDir validation ---
  issues += diagnoseTemplateDir(config, checks);

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

  // --- Check 7: CLI tools for quality gates (Issue #261) ---
  issues += diagnoseCliTools(checks);

  // --- Check 8: TUI auto-registration ---
  issues += diagnoseTuiRegistration(checks);

  return { checks, issues };
}

/**
 * Check 2: Version mismatch between config and package.
 * @returns {number} issue count (0 or 1)
 */
function diagnoseVersion(config, pkgVersion, checks) {
  const configVersion = config.version;
  if (configVersion && pkgVersion && configVersion !== pkgVersion) {
    checks.push({
      name: 'Version mismatch',
      status: 'FAIL',
      detail: `config: ${configVersion}, package: ${pkgVersion} — run 'xp-gate doctor --fix' to sync`
    });
    return 1;
  }
  return 0;
}

/**
 * Check 3: templateDir validation against platform expectation.
 * @returns {number} issue count (0 or 1)
 */
function diagnoseTemplateDir(config, checks) {
  const configTemplateDir = config.templateDir;
  if (configTemplateDir) {
    const expectedTemplateDir = getTemplateDir();
    if (configTemplateDir !== expectedTemplateDir) {
      checks.push({
        name: 'templateDir',
        status: 'FAIL',
        detail: `points to ${configTemplateDir}, expected ${expectedTemplateDir} for current platform`
      });
      return 1;
    }
  }
  return 0;
}

/**
 * Check CLI tools required by the quality gates.
 * Each gate has a set of CLI tools; if any are missing, that gate will SKIP
 * silently at commit time. This check makes the skip visible.
 *
 * @param {Array} checks
 * @returns {number} issue count
 */
function diagnoseCliTools(checks) {
  let issues = 0;
  const platform = process.platform;

  for (const entry of GATE_CLI_TOOLS) {
    const { available, version } = checkCliTool(entry.tool);
    const gateLabels = entry.gates.join(', ');

    if (available) {
      checks.push({
        name: `CLI tool: ${entry.tool} (${gateLabels})`,
        status: 'PASS',
        detail: version || 'available',
      });
    } else {
      const installCmd = getToolInstallCmd(entry, platform);
      checks.push({
        name: `CLI tool: ${entry.tool} (${gateLabels})`,
        status: 'WARN',
        detail: `Not found — install with: ${installCmd}`,
      });
      issues++;
    }
  }

  return issues;
}

/**
 * Print the check results in a readable format.
 */
function printReport(checks) {
  console.log('');
  console.log('Diagnosis Report:');
  console.log('-----------------');

  for (const check of checks) {
    const statusSymbol = check.status === 'PASS' ? ' ✓' : check.status === 'WARN' ? ' ⚠' : ' ✗';
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
 * Fix version mismatch — update config.version to match package version.
 * @param {object} config
 * @param {string|null} pkgVersion
 * @returns {boolean} Whether a fix was applied
 */
function fixVersionMismatch(config, pkgVersion) {
  if (pkgVersion && config.version !== pkgVersion) {
    config.version = pkgVersion;
    saveConfig(config);
    console.log(`  ✓ Updated config version to ${pkgVersion}`);
    return true;
  }
  return false;
}

/**
 * Fix templateDir mismatch — update config.templateDir to match expected.
 * @param {object} config
 * @param {string} expectedTemplateDir
 * @returns {boolean} Whether a fix was applied
 */
function fixTemplateDirMismatch(config, expectedTemplateDir) {
  if (config.templateDir && config.templateDir !== expectedTemplateDir) {
    config.templateDir = expectedTemplateDir;
    saveConfig(config);
    console.log(`  ✓ Updated templateDir to ${expectedTemplateDir}`);
    return true;
  }
  return false;
}

/**
 * Restore missing hooks from package source.
 * @param {'local'|'global'} mode
 * @param {string} srcDir - Package source directory
 * @param {string} hooksDir - Target hooks directory
 * @returns {boolean} Whether any hooks were restored
 */
function fixMissingHooks(mode, srcDir, hooksDir) {
  let fixed = false;
  const label = mode === 'local' ? '' : 'global ';
  const preCommitLabel = `${label}pre-commit hook`;
  const prePushLabel = `${label}pre-push hook`;
  fixed = restoreHook(path.join(srcDir, 'hooks', 'pre-commit'), path.join(hooksDir, 'pre-commit'), preCommitLabel) || fixed;
  fixed = restoreHook(path.join(srcDir, 'hooks', 'pre-push'), path.join(hooksDir, 'pre-push'), prePushLabel) || fixed;
  return fixed;
}

/**
 * Fix core.hooksPath for global mode.
 * @param {string} globalHooksDir
 * @returns {boolean} Whether the fix was applied
 */
function fixCoreHooksPath(globalHooksDir) {
  try {
    execSync(`git config --global core.hooksPath "${globalHooksDir}"`, {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    console.log(`  ✓ Set core.hooksPath to ${globalHooksDir}`);
    return true;
  } catch (e) {
    console.log(`  ✗ Could not set core.hooksPath: ${e.message}`);
    return false;
  }
}

/**
 * Restore missing adapters from package source.
 * @param {'local'|'global'} mode
 * @param {string} srcDir - Package source directory
 * @param {string} adaptersDir - Target adapters directory
 * @returns {boolean} Whether adapters were restored
 */
function fixMissingAdapters(mode, srcDir, adaptersDir) {
  if (adaptersDir && (!fs.existsSync(adaptersDir) || fs.readdirSync(adaptersDir).filter(f => f.endsWith('.sh')).length === 0)) {
    const pkgAdaptersDir = path.join(srcDir, 'adapters');
    if (fs.existsSync(pkgAdaptersDir)) {
      fs.mkdirSync(adaptersDir, { recursive: true });
      const adapterFiles = fs.readdirSync(pkgAdaptersDir).filter(f => f.endsWith('.sh'));
      for (const f of adapterFiles) {
        fs.copyFileSync(path.join(pkgAdaptersDir, f), path.join(adaptersDir, f));
      }
      console.log(`  ✓ Restored ${adapterFiles.length} adapter(s)`);
      return true;
    }
  }
  return false;
}

/**
 * Restore missing gate scripts from package root to adapters directory.
 * Gate scripts (gate-3.sh through gate-9.sh) are stored in the package root,
 * not in the adapters subdirectory.
 */
function fixMissingGateScripts(srcDir, adaptersDir) {
  if (!adaptersDir || !fs.existsSync(adaptersDir)) return false;

  const existingFiles = fs.readdirSync(adaptersDir);
  const missingGates = EXPECTED_GATE_SCRIPTS.filter(g => !existingFiles.includes(g));

  if (missingGates.length === 0) return false;

  let restored = 0;
  for (const gateScript of missingGates) {
    const srcFile = path.join(srcDir, gateScript);
    const destFile = path.join(adaptersDir, gateScript);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, destFile);
      fs.chmodSync(destFile, 0o755);
      restored++;
    }
  }

  if (restored > 0) {
    console.log(`  ✓ Restored ${restored} gate script(s)`);
    return true;
  }
  return false;
}

function fixConfigMismatches(config) {
  let fixed = false;
  fixed = fixVersionMismatch(config, getPackageVersion()) || fixed;
  fixed = fixTemplateDirMismatch(config, getTemplateDir()) || fixed;
  return fixed;
}

function fixHooksByMode(config, srcDir) {
  let fixed = false;
  if (config.mode === 'local') {
    const gitDir = getGitDir();
    if (gitDir) {
      const hooksDir = path.join(gitDir, 'hooks');
      fixed = fixMissingHooks('local', srcDir, hooksDir) || fixed;
    }
  } else {
    fixed = fixMissingHooks('global', srcDir, GLOBAL_HOOKS_DIR) || fixed;
  }
  return fixed;
}

function fixGlobalHooksPath(config) {
  if (config.mode !== 'global') return false;
  const hooksPath = getCurrentHooksPath();
  if (hooksPath !== GLOBAL_HOOKS_DIR) {
    return fixCoreHooksPath(GLOBAL_HOOKS_DIR);
  }
  return false;
}

function getAdaptersDirByMode(config) {
  return config.mode === 'local'
    ? path.join(path.dirname(getGitDir() || ''), 'githooks', 'adapters')
    : GLOBAL_ADAPTERS_DIR;
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

  fixed = fixConfigMismatches(config) || fixed;
  fixed = fixHooksByMode(config, srcDir) || fixed;
  fixed = fixGlobalHooksPath(config) || fixed;
  fixed = fixMissingAdapters(config.mode, srcDir, getAdaptersDirByMode(config)) || fixed;
  fixed = fixMissingGateScripts(srcDir, getAdaptersDirByMode(config)) || fixed;
  fixed = fixTuiRegistration() || fixed;
  fixed = printCliToolGuidance() || fixed;

  if (!fixed) {
    console.log('  No fixable issues found.');
  }
}

/**
 * Print install guidance for missing CLI tools.
 * Does NOT auto-install — just shows commands.
 *
 * @returns {boolean} Whether any guidance was printed
 */
function printCliToolGuidance() {
  let guidance = false;
  const platform = process.platform;
  const missingTools = [];

  for (const entry of GATE_CLI_TOOLS) {
    const { available } = checkCliTool(entry.tool);
    if (!available) {
      const installCmd = getToolInstallCmd(entry, platform);
      missingTools.push({ tool: entry.tool, gates: entry.gates, installCmd, script: entry.optScript });
    }
  }

  if (missingTools.length > 0) {
    console.log('');
    console.log('  Missing CLI tools (affects quality gates):');
    for (const mt of missingTools) {
      const gateLabel = mt.gates[0];
      console.log(`    ${mt.tool}: needed by ${gateLabel}`);
      console.log(`      Install: ${mt.installCmd}`);
      if (mt.script) {
        console.log(`      Or run:  bash ${mt.script}`);
      }
    }
    console.log('');
    console.log(`  Or run 'xp-gate bootstrap' to install all at once.`);
    guidance = true;
  }

  return guidance;
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

/**
 * Check 7: Version upgrade check (non-blocking).
 */
async function diagnoseUpgrade() {
  try {
    const upgradeResult = await checkUpgrade();
    const msg = formatUpgradeMsg(upgradeResult, 'doctor');
    if (msg) {
      console.log(`\n  ℹ ${msg}`);
    }
  } catch { /* non-blocking — don't fail doctor on network issue */ }
}

/**
 * Check 8: OpenCode plugin version check.
 * @returns {number} issue count
 */
function diagnoseOpenCodePlugin(checks) {
  const pluginPath = path.join(HOME_DIR, '.config', 'opencode', 'node_modules', '@boyingliu01', 'opencode-plugin', 'package.json');
  if (fs.existsSync(pluginPath)) {
    try {
      const pluginPkg = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));
      const pluginVersion = pluginPkg.version;
      if (pluginVersion) {
        checks.push({ name: 'OpenCode plugin version', status: 'PASS', detail: pluginVersion });
        // Check if plugin is outdated vs xp-gate CLI (they should match)
        const pkgVersion = getPackageVersion();
        if (pkgVersion && pluginVersion !== pkgVersion) {
          checks.push({
            name: 'OpenCode plugin version mismatch',
            status: 'WARN',
            detail: `plugin: ${pluginVersion}, xp-gate CLI: ${pkgVersion} — run 'cd ~/.config/opencode && npm update @boyingliu01/opencode-plugin'`
          });
          return 1;
        }
      }
    } catch { /* skip */ }
  } else {
    checks.push({ name: 'OpenCode plugin', status: 'SKIP', detail: 'Not installed in OpenCode config' });
  }
  return 0;
}

/**
 * TUI registration path and expected plugin entry.
 */
const TUI_JSON_PATH = path.join(HOME_DIR, '.config', 'opencode', 'tui.json');
const TUI_PLUGIN_ENTRY = '@boyingliu01/opencode-plugin/tui';

/**
 * Read and parse tui.json, returning { data, error }.
 * data = parsed object on success, null on file missing, undefined on corrupt.
 */
function readTuiJson() {
  if (!fs.existsSync(TUI_JSON_PATH)) return { data: null, error: null };
  try {
    const raw = fs.readFileSync(TUI_JSON_PATH, 'utf8');
    const data = JSON.parse(raw);
    return { data, error: null };
  } catch (e) {
    return { data: undefined, error: `Corrupt JSON: ${e.message}` };
  }
}

/**
 * Check 9: TUI auto-registration in ~/.config/opencode/tui.json.
 * @returns {number} issue count
 */
function diagnoseTuiRegistration(checks) {
  const { data, error } = readTuiJson();

  if (error) {
    checks.push({ name: 'TUI registration', status: 'FAIL', detail: error });
    return 1;
  }

  if (data === null) {
    checks.push({ name: 'TUI registration', status: 'FAIL', detail: 'Not registered' });
    return 1;
  }

  const plugins = Array.isArray(data.plugin) ? data.plugin : [];
  if (plugins.includes(TUI_PLUGIN_ENTRY)) {
    checks.push({ name: 'TUI registration', status: 'PASS', detail: `${TUI_PLUGIN_ENTRY} registered` });
    return 0;
  }

  checks.push({ name: 'TUI registration', status: 'FAIL', detail: 'Not registered' });
  return 1;
}

/**
 * Fix TUI registration: ensure @boyingliu01/opencode-plugin/tui is in tui.json.
 * Uses atomic write (tmp + renameSync) for JSON safety.
 * On corrupt JSON: backup to .corrupt-{timestamp}.bak then rebuild.
 * Idempotent: skips if already registered.
 * @returns {boolean} Whether a fix was applied
 */
function fixTuiRegistration() {
  const { data, error } = readTuiJson();

  // Corrupt JSON: backup old file, rebuild from scratch
  if (error && data === undefined) {
    const ts = Date.now();
    const backupPath = `${TUI_JSON_PATH}.corrupt-${ts}.bak`;
    try {
      fs.copyFileSync(TUI_JSON_PATH, backupPath);
      console.log(`  ⚠ TUI config corrupted — backed up to ${backupPath}`);
    } catch { /* non-critical */ }
    // Rebuild fresh
    const dir = path.dirname(TUI_JSON_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const newConfig = { plugin: [TUI_PLUGIN_ENTRY] };
    const tmpPath = `${TUI_JSON_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(newConfig, null, 2));
    fs.renameSync(tmpPath, TUI_JSON_PATH);
    console.log(`  ✓ Registered ${TUI_PLUGIN_ENTRY} in TUI (rebuilt after corrupt backup)`);
    return true;
  }

  // File doesn't exist: create it
  if (data === null) {
    const dir = path.dirname(TUI_JSON_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const newConfig = { plugin: [TUI_PLUGIN_ENTRY] };
    const tmpPath = `${TUI_JSON_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(newConfig, null, 2));
    fs.renameSync(tmpPath, TUI_JSON_PATH);
    console.log(`  ✓ Created TUI config with ${TUI_PLUGIN_ENTRY}`);
    return true;
  }

  // File exists, check if plugin already registered (idempotent)
  const plugins = Array.isArray(data.plugin) ? data.plugin : [];
  if (plugins.includes(TUI_PLUGIN_ENTRY)) return false;

  // Append plugin entry
  data.plugin = plugins.concat([TUI_PLUGIN_ENTRY]);
  const tmpPath = `${TUI_JSON_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, TUI_JSON_PATH);
  console.log(`  ✓ Added ${TUI_PLUGIN_ENTRY} to TUI config`);
  return true;
}

/**
 * Wrapper for init.js: ensure TUI is registered without console output.
 * Returns true if the plugin is already registered or was just added.
 */
function ensureTuiRegistration() {
  const { data } = readTuiJson();
  if (data === null || data === undefined) {
    fixTuiRegistration();
    return;
  }
  const plugins = Array.isArray(data.plugin) ? data.plugin : [];
  if (!plugins.includes(TUI_PLUGIN_ENTRY)) {
    fixTuiRegistration();
  }
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

  const { checks, issues: diagnosedIssues } = diagnose();
  let issues = diagnosedIssues;

  printReport(checks);

  await diagnoseUpgrade();
  issues += diagnoseOpenCodePlugin(checks);

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

function formatDoctorJson(checks, issues) {
  const missing_tools = checks
    .filter(c => c.status === 'WARN' || c.status === 'FAIL')
    .map(c => ({ name: c.name, detail: c.detail }));
  return {
    ok: issues === 0,
    issues,
    checks: checks.map(c => ({ name: c.name, status: c.status, detail: c.detail })),
    missing_tools,
  };
}

module.exports = {
  doctor, isXpGateFile, SIGNATURES,
  fixVersionMismatch,
  fixTemplateDirMismatch,
  fixMissingHooks,
  fixCoreHooksPath,
  fixMissingAdapters,
  diagnoseTuiRegistration,
  fixTuiRegistration,
  ensureTuiRegistration,
  readTuiJson,
  formatDoctorJson,
};
