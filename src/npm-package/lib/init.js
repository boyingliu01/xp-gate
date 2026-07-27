const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { checkDeps, checkBash, autoInstallDeps, detectPlatform, GATE_CLI_TOOLS, checkCliTool } = require('./detect-deps.js');
const { copyHooks, copyAdapters } = require('./shared-utils.js');
const {
  HOME_DIR,
  CONFIG_DIR,
  CONFIG_FILE,
  TEMPLATE_DIR,
  GLOBAL_HOOKS_DIR,
  GLOBAL_ADAPTERS_DIR,
} = require('./shared-paths.js');

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(entry => {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

function logDeps(depCheck) {
  if (!depCheck.ok) {
    console.warn('Warning: Missing dependencies');
    if (depCheck.missing) console.warn(`  - ${depCheck.missing} (required)`);
    if (depCheck.versionMismatch) {
      console.warn(`  - ${depCheck.versionMismatch.name}: need ${depCheck.versionMismatch.required}, found ${depCheck.versionMismatch.found}`);
    }
    console.warn('Skills may not work without these dependencies');
    console.warn('Install from: https://github.com/boyingliu01/superpowers\n');
  } else {
    console.log('Dependencies: OK\n');
  }
}

/**
 * Detect which AI agent platform is in use and check/auto-install deps.
 * @param {string} platform - 'opencode' | 'claude-code' | 'qoder'
 */
async function checkAndInstallDeps(platform) {
  const depCheck = await checkDeps(platform);
  if (depCheck.ok) {
    logDeps(depCheck);
    return depCheck;
  }

  // Auto-install missing deps
  console.log(`Checking dependencies (platform: ${platform})...`);
  const installResult = await autoInstallDeps(platform);
  if (installResult.ok) {
    console.log('Dependencies: OK (auto-installed)\n');
    return { ok: true };
  }

  // Auto-install failed — report and continue with warning
  logDeps(depCheck);
  if (installResult.errors) {
    for (const err of installResult.errors) {
      console.warn(`  Auto-install failed for ${err.name}: ${err.message}`);
    }
  }
  return depCheck;
}

function printUsage() {
  console.log('Choose installation mode:');
  console.log('  1) Global  — all git projects use the same hooks (recommended)');
  console.log('  2) Local   — install hooks into current project only\n');
  console.log('Usage:');
  console.log('  xp-gate init --global     # all projects');
  console.log('  xp-gate init --baseline   # current project + create lint baseline');
  console.log('  xp-gate setup-global      # all projects (alias)\n');
}

function getGitDir() {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse --git-dir', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function updateConfig(updates) {
  let config = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {}
  }
  config = { ...config, ...updates };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function sha256File(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

function generateManifest(srcDir, projectRoot) {
  const manifest = {
    version: 1,
    files: {},
    injectedSections: {}
  };

  const gitDir = path.join(projectRoot, '.git');
  const hooksDir = path.join(gitDir, 'hooks');
  const githooksDir = path.join(projectRoot, 'githooks');

  // Hooks
  ['pre-commit', 'pre-push'].forEach(hook => {
    const hookPath = path.join(hooksDir, hook);
    if (fs.existsSync(hookPath)) {
      const stat = fs.statSync(hookPath);
      manifest.files[`.git/hooks/${hook}`] = {
        sha256: sha256File(hookPath),
        size: stat.size
      };
    }
  });

  // adapter-common.sh
  const adapterCommonPath = path.join(githooksDir, 'adapter-common.sh');
  if (fs.existsSync(adapterCommonPath)) {
    const stat = fs.statSync(adapterCommonPath);
    manifest.files['githooks/adapter-common.sh'] = {
      sha256: sha256File(adapterCommonPath),
      size: stat.size
    };
  }

  // Adapter scripts
  const adaptersDir = path.join(githooksDir, 'adapters');
  if (fs.existsSync(adaptersDir)) {
    fs.readdirSync(adaptersDir).forEach(f => {
      const fPath = path.join(adaptersDir, f);
      if (fs.statSync(fPath).isFile()) {
        const stat = fs.statSync(fPath);
        manifest.files[`githooks/adapters/${f}`] = {
          sha256: sha256File(fPath),
          size: stat.size
        };
      }
    });
  }

  // Template dir note
  manifest.templateDir = TEMPLATE_DIR;

  // Injected sections
  const agentsPath = path.join(projectRoot, 'AGENTS.md');
  if (fs.existsSync(agentsPath)) {
    try {
      const content = fs.readFileSync(agentsPath, 'utf8');
      if (content.includes('## AI CODING DISCIPLINE (Karpathy Principles)')) {
        manifest.injectedSections['AGENTS.md'] = '## AI CODING DISCIPLINE (Karpathy Principles)';
      }
    } catch {}
  }

  return manifest;
}

function generateGlobalManifest(srcDir) {
  const manifest = {
    version: 1,
    files: {},
    gitConfig: {}
  };

  // Global hooks
  ['pre-commit', 'pre-push'].forEach(hook => {
    const hookPath = path.join(GLOBAL_HOOKS_DIR, hook);
    if (fs.existsSync(hookPath)) {
      const stat = fs.statSync(hookPath);
      manifest.files[`hooks/${hook}`] = {
        sha256: sha256File(hookPath),
        size: stat.size
      };
    }
  });

  // adapter-common.sh
  const adapterCommonPath = path.join(GLOBAL_ADAPTERS_DIR, 'adapter-common.sh');
  if (fs.existsSync(adapterCommonPath)) {
    const stat = fs.statSync(adapterCommonPath);
    manifest.files['adapters/adapter-common.sh'] = {
      sha256: sha256File(adapterCommonPath),
      size: stat.size
    };
  }

  // Adapter scripts
  if (fs.existsSync(GLOBAL_ADAPTERS_DIR)) {
    fs.readdirSync(GLOBAL_ADAPTERS_DIR).forEach(f => {
      const fPath = path.join(GLOBAL_ADAPTERS_DIR, f);
      if (fs.statSync(fPath).isFile() && f !== 'adapter-common.sh') {
        const stat = fs.statSync(fPath);
        manifest.files[`adapters/${f}`] = {
          sha256: sha256File(fPath),
          size: stat.size
        };
      }
    });
  }

  // git config
  manifest.gitConfig = {
    'core.hooksPath': GLOBAL_HOOKS_DIR
  };

  manifest.templateDir = TEMPLATE_DIR;

  return manifest;
}

function printCliToolStatus() {
  const available = [];
  const missing = [];

  for (const entry of GATE_CLI_TOOLS) {
    const result = checkCliTool(entry.tool);
    if (result.available) {
      available.push(entry.tool);
    } else {
      missing.push(entry.tool);
    }
  }

  console.log(`CLI tools: ${available.length}/${GATE_CLI_TOOLS.length} available`);
  if (missing.length > 0) {
    console.log(`  Missing: ${missing.join(', ')}`);
    console.log('  Quality gates using these tools will silently SKIP until they are installed.\n');
  } else {
    console.log('');
  }
}

/**
 * Ask the user for confirmation via stdin.
 * @param {string} question - The yes/no question to display
 * @returns {Promise<boolean>} true if user answered yes
 */
function askYesNo(question) {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(`${question} (Y/n) `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      // Empty (just Enter) or y/yes → yes; anything else → no
      resolve(normalized === '' || normalized === 'y' || normalized === 'yes');
    });
  });
}

/**
 * Prompt the user to auto-install missing CLI quality-gate tools.
 * Called after installation completes. Interactive only when TTY is available.
 * Skips silently when no tools are missing.
 *
 * @param {boolean} autoYes - If true, skip prompt and auto-install
 * @returns {Promise<number>} 0 on success or skipped, 1 on failure
 */
async function promptBootstrap(autoYes) {
  const { bootstrap } = require('./bootstrap.js');

  // Check what's missing without printing a full header
  const missing = [];
  for (const entry of GATE_CLI_TOOLS) {
    const result = checkCliTool(entry.tool);
    if (!result.available) {
      missing.push(entry.tool);
    }
  }

  if (missing.length === 0) return 0;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Quality Gate CLI Tools');
  console.log('');
  console.log(`  ${missing.length} tool(s) required by quality gates are not installed:`);
  for (const tool of missing) {
    console.log(`    ✗ ${tool}`);
  }
  console.log('');
  console.log('  Without these tools, the corresponding quality gates will');
  console.log('  silently SKIP during git commits — you may miss issues.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (autoYes || (process.stdin.isTTY && await askYesNo('\nInstall missing tools now?'))) {
    console.log('');
    return bootstrap([]);
  }

  console.log('\n  Skipped. Run "xp-gate bootstrap" later to install them.');
  return 0;
}

async function init(args) {
  console.log('XP-Gate Initialization');
  console.log('====================\n');

  // Check bash availability (required for shell hooks)
  console.log('Checking bash availability...');
  const bashCheck = checkBash();
  if (bashCheck.ok) {
    console.log(`Bash: ✓ ${bashCheck.path} (v${bashCheck.version})\n`);
  } else {
    console.warn(`Bash: ✗ NOT FOUND`);
    console.warn(`  ${bashCheck.message}\n`);
  }

  // Check CLI tools availability (quality gates will SKIP silently if tools are missing)
  console.log('Checking CLI tools...');
  printCliToolStatus();

  console.log('Checking platform dependencies...');
  // Detect platform and check/auto-install dependencies
  const platform = detectPlatform();
  console.log(`Platform: ${platform}\n`);
  await checkAndInstallDeps(platform);

  const installMode = args.includes('--global') ? 'global' :
                      args.includes('--core-only') ? 'local' :
                      args.includes('--full') ? 'local' : null;

  if (!installMode) { printUsage(); return 0; }
  if (installMode === 'global') return setupGlobal(args);
  const code = await installLocal(args);
  // Always create lint baseline for local installs (Boy Scout Rule needs it)
  // --baseline flag is now a no-op (baseline is always created)
  if (code === 0) {
    try {
      const { createBaseline } = require('./baseline.js');
      console.log('\nCreating lint baseline (Boy Scout Rule)...');
      const baseline = await createBaseline();
      console.log(`\u2705 Lint baseline created \u2014 ${Object.keys(baseline).length} files tracked.`);
    } catch (e) {
      console.log(`\u2139\ufe0f  Lint baseline creation skipped: ${e.message}`);
    }
  }
  return code;
}

/**
 * Detect project languages and check/install language-specific tools.
 * @param {string} projectRoot - Project root directory
 * @param {boolean} autoYes - Auto-install missing tools
 */
async function detectAndReportLanguages(projectRoot, autoYes) {
  const { detectProjectLanguages, getToolsForLanguages, generateProjectConfig, LANGUAGE_REGISTRY } = require('./language-tools.js');

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Multi-Language Quality Gates');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  const { detected, configFiles } = detectProjectLanguages(projectRoot);

  if (detected.length === 0) {
    console.log('  No project languages detected.');
    return;
  }

  console.log(`  Detected ${detected.length} language(s):`);
  for (const lang of detected) {
    const langDef = LANGUAGE_REGISTRY[lang];
    console.log(`    • ${langDef?.name || lang}`);
  }
  console.log('');

  const toolStatus = getToolsForLanguages(detected);
  const missingRequired = [];
  const missingOptional = [];

  for (const [lang, tools] of Object.entries(toolStatus)) {
    for (const t of tools) {
      if (t.status === 'missing') {
        if (t.tool.optional) {
          missingOptional.push({ lang, tool: t.tool });
        } else {
          missingRequired.push({ lang, tool: t.tool });
        }
      }
    }
  }

  if (missingRequired.length === 0 && missingOptional.length === 0) {
    console.log('  ✓ All language-specific tools are available.');
  } else {
    if (missingRequired.length > 0) {
      console.log(`  ✗ ${missingRequired.length} required tool(s) missing:`);
      for (const { lang, tool } of missingRequired) {
        console.log(`    • ${tool.name} (${lang}) — gates will SKIP`);
      }
    }
    if (missingOptional.length > 0) {
      console.log(`  ⚠ ${missingOptional.length} optional tool(s) missing (fallback available):`);
      for (const { lang, tool } of missingOptional) {
        console.log(`    • ${tool.name} (${lang})`);
      }
    }
    console.log('');

    if (autoYes || (process.stdin.isTTY && await askYesNo('  Install missing language-specific tools now?'))) {
      console.log('');
      const { installTool } = require('./language-tools.js');
      let installed = 0;
      for (const { lang, tool } of [...missingRequired, ...missingOptional]) {
        const result = installTool(tool);
        if (result.success) {
          console.log(`  ✓ ${tool.name} installed`);
          installed++;
        } else {
          console.log(`  ✗ ${tool.name}: ${result.message}`);
        }
      }
      if (installed > 0) {
        console.log(`\n  ${installed} tool(s) installed successfully.`);
      }
    } else {
      console.log('  Skipped. Run "xp-gate install-tools --yes" later.');
    }
  }

  // Generate project config
  generateProjectConfig(projectRoot, detected, toolStatus);
  console.log(`\n  Generated .xp-gate-config.json`);
}

async function installLocal(args) {
  const gitDir = getGitDir();
  if (!gitDir) {
    console.error('Error: Not a git repository');
    console.error('Run xp-gate init from inside a git repository');
    return 1;
  }

  const projectRoot = path.dirname(gitDir);
  const hooksDir = path.join(projectRoot, '.git', 'hooks');
  const srcDir = path.dirname(__dirname);

  console.log(`Mode: Local (per-project)`);
  console.log(`Project: ${projectRoot}`);
  console.log(`Git hooks: ${hooksDir}\n`);
  console.log('Installing hooks...');

  copyHooks(srcDir, hooksDir);
  console.log('  pre-commit -> .git/hooks/');
  console.log('  pre-push -> .git/hooks/');

  fs.mkdirSync(path.join(projectRoot, 'githooks', 'adapters'), { recursive: true });
  copyAdapters(srcDir, path.join(projectRoot, 'githooks'));
  console.log(`  adapter-common.sh + adapters -> ${projectRoot}/githooks/`);

  // Install principles/, mutation/, mock-policy/ to .xp-gate/modules/
  const modulesDir = path.join(projectRoot, '.xp-gate', 'modules');
  ['principles', 'mutation', 'mock-policy'].forEach(module => {
    const moduleSrc = path.join(srcDir, module);
    const moduleDest = path.join(modulesDir, module);
    if (fs.existsSync(moduleSrc)) {
      fs.mkdirSync(path.dirname(moduleDest), { recursive: true });
      copyRecursive(moduleSrc, moduleDest);
      console.log(`  ${module}/ -> .xp-gate/modules/${module}/`);
    }
  });

  fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
  copyHooks(srcDir, TEMPLATE_DIR);
  fs.mkdirSync(path.join(TEMPLATE_DIR, 'adapters'), { recursive: true });

  ensureConfigDir();

  const manifest = generateManifest(srcDir, projectRoot);
  updateConfig({ lastInit: new Date().toISOString(), mode: 'local', templateDir: TEMPLATE_DIR, manifest });

  injectKarpathyPrinciples(projectRoot);
  configureOpenCodePlugin(srcDir, projectRoot);
  configureQoderDelphiAgents(srcDir, projectRoot);

  // Auto-register TUI plugin globally (idempotent)
  try {
    const { ensureTuiRegistration } = require('../lib/doctor.js');
    ensureTuiRegistration();
  } catch { /* non-critical: TUI registration is best-effort */ }

  console.log('\nInstallation complete!');
  console.log('Run git commit to trigger quality gates');

  // Auto-install missing CLI tools (prompt user)
  const autoYes = args.includes('--yes') || args.includes('--auto-install');
  await promptBootstrap(autoYes);

  // Detect project languages and check language-specific tools
  await detectAndReportLanguages(projectRoot, autoYes);

  console.log('━━━ FIRST-CLASS TEST QUALITY ━━━');
  console.log('XP-Gate treats test code as a first-class citizen:');
  console.log('  • TypeScript: test files are type-checked, not excluded from tsconfig.json');
  console.log('  • Static analysis: lint/ESLint/Biome check test files alongside source');
  console.log('  • Complexity: cyclomatic complexity is measured on test files too');
  console.log('  • Duplicate code: jscpd scans test files (fixtures/snapshots excluded)');
  console.log('  • Architecture: archlint validates test code structure');
  console.log('');
  console.log('  To include tests in your project:');
  console.log('  1. Remove __tests__/ from tsconfig.json exclude');
  console.log('  2. Remove __tests__/ from jscpd.conf.json ignore');
  console.log('  3. Add tsconfig.json: "types": ["vitest/globals"]');
  console.log('  4. Run "xp-gate doctor" to verify setup');
  return 0;
}

async function setupGlobal(args) {
  const srcDir = path.dirname(__dirname);

  console.log('XP-Gate Global Setup');
  console.log('====================\n');
  console.log('Mode: Global (all git projects)');
  console.log(`Global hooks: ${GLOBAL_HOOKS_DIR}`);
  console.log(`Global adapters: ${GLOBAL_ADAPTERS_DIR}\n`);

  console.log('[setup-global] Creating global directories...');
  fs.mkdirSync(GLOBAL_HOOKS_DIR, { recursive: true });
  fs.mkdirSync(GLOBAL_ADAPTERS_DIR, { recursive: true });

  console.log('[setup-global] Installing git hooks...');
  copyHooks(srcDir, GLOBAL_HOOKS_DIR);
  console.log('Installing hooks...');
  console.log(`  pre-commit -> ${GLOBAL_HOOKS_DIR}`);
  console.log(`  pre-push -> ${GLOBAL_HOOKS_DIR}`);

  console.log('[setup-global] Installing adapters...');
  copyAdapters(srcDir, GLOBAL_ADAPTERS_DIR);
  console.log(`  adapter-common.sh + adapters -> ${GLOBAL_ADAPTERS_DIR}`);

  // Install principles/, mutation/, mock-policy/ to global modules dir
  console.log('[setup-global] Installing quality gate modules...');
  const globalModulesDir = path.join(CONFIG_DIR, 'modules');
  ['principles', 'mutation', 'mock-policy'].forEach(module => {
    const moduleSrc = path.join(srcDir, module);
    const moduleDest = path.join(globalModulesDir, module);
    if (fs.existsSync(moduleSrc)) {
      fs.mkdirSync(path.dirname(moduleDest), { recursive: true });
      copyRecursive(moduleSrc, moduleDest);
      console.log(`  ${module}/ -> ${globalModulesDir}/${module}/`);
    }
  });

  console.log('[setup-global] Configuring git...');
  const { execSync } = require('child_process');
  try {
    execSync(`git config --global core.hooksPath "${GLOBAL_HOOKS_DIR}"`);
    console.log(`\n  git config --global core.hooksPath "${GLOBAL_HOOKS_DIR}"`);
  } catch (e) {
    console.warn('Warning: Could not set git core.hooksPath config');
  }

  ensureConfigDir();

  console.log('[setup-global] Generating installation manifest...');
  const manifest = generateGlobalManifest(srcDir);
  updateConfig({ lastInit: new Date().toISOString(), mode: 'global', templateDir: TEMPLATE_DIR, manifest });

  // Auto-register TUI plugin globally (idempotent)
  try {
    const { ensureTuiRegistration } = require('../lib/doctor.js');
    ensureTuiRegistration();
  } catch { /* non-critical: TUI registration is best-effort */ }

  console.log('\nGlobal setup complete!');
  console.log('All git repositories will now use xp-gate quality gates.');
  console.log('Per-project adapters can still override by creating <repo>/githooks/');

  // Auto-install missing CLI tools (prompt user)
  console.log('[setup-global] Checking quality gate CLI tools...');
  const autoYes = args.includes('--yes') || args.includes('--auto-install');
  await promptBootstrap(autoYes);

  console.log('');
  console.log('━━━ FIRST-CLASS TEST QUALITY ━━━');
  console.log('XP-Gate treats test code as a first-class citizen:');
  console.log('  All quality gates apply equally to test files.');
  console.log('  To include tests in your project:');
  console.log('  1. Remove __tests__/ from tsconfig.json exclude');
  console.log('  2. Remove __tests__/ from jscpd.conf.json ignore');
  console.log('  3. Remove test patterns from .archlint.yaml ignore');
  console.log('  4. Add "types": ["vitest/globals"] to tsconfig.json');
  console.log('  5. Run "xp-gate doctor" to verify');
  return 0;
}

/**
 * Deploy Qoder-native Delphi review agents when platform is Qoder.
 * Copies agent templates from the bundled qoder plugin to the project's
 * .qoder/agents/ directory. Idempotent — never overwrites existing files.
 *
 * @param {string} srcDir - npm package source directory
 * @param {string} projectRoot - user's project root
 */
function configureQoderDelphiAgents(srcDir, projectRoot) {
  const platform = detectPlatform();
  if (platform !== 'qoder') {
    return; // Not Qoder — skip (OpenCode uses .delphi-config.json instead)
  }

  const agentSrcDir = path.join(srcDir, 'plugins', 'qoder', 'agents');
  if (!fs.existsSync(agentSrcDir)) {
    console.log('  Qoder Delphi agents: SKIP (templates not bundled)');
    return;
  }

  const agentsDestDir = path.join(projectRoot, '.qoder', 'agents');
  fs.mkdirSync(agentsDestDir, { recursive: true });

  const agentFiles = fs.readdirSync(agentSrcDir).filter(f => f.endsWith('.md'));
  let deployed = 0;
  let skipped = 0;
  for (const file of agentFiles) {
    const destFile = path.join(agentsDestDir, file);
    if (fs.existsSync(destFile)) {
      skipped++;
      continue; // Don't overwrite user customizations
    }
    fs.copyFileSync(path.join(agentSrcDir, file), destFile);
    deployed++;
  }

  if (deployed > 0) {
    console.log(`  Qoder Delphi agents: deployed ${deployed} agent(s) to .qoder/agents/`);
  }
  if (skipped > 0) {
    console.log(`  Qoder Delphi agents: ${skipped} existing agent(s) preserved`);
  }
  if (deployed === 0 && skipped === 0) {
    console.log('  Qoder Delphi agents: no agent templates found');
  }
}

function configureOpenCodePlugin(srcDir, projectRoot) {
  const opencodeJsonPath = path.join(projectRoot, 'opencode.json');
  const pluginSrcPath = path.join(srcDir, 'plugins', 'opencode');

  if (!fs.existsSync(pluginSrcPath)) {
    console.log('  OpenCode plugin: SKIP (not bundled)');
    return;
  }

  let config = {};
  if (fs.existsSync(opencodeJsonPath)) {
    try {
      const raw = fs.readFileSync(opencodeJsonPath, 'utf8');
      config = JSON.parse(raw);
    } catch (e) {
      console.warn(`  Warning: could not parse opencode.json: ${e.message}`);
      return;
    }
  }

  if (!Array.isArray(config.plugin)) {
    config.plugin = [];
  }

  const normalizedSrc = path.resolve(pluginSrcPath);
  const alreadyConfigured = config.plugin.some(p => path.resolve(projectRoot, p) === normalizedSrc);

  if (alreadyConfigured) {
    console.log('  OpenCode plugin: already configured in opencode.json');
    return;
  }

  const relativePluginPath = path.relative(projectRoot, normalizedSrc).replace(/\\/g, '/');
  config.plugin.push(relativePluginPath);

  try {
    fs.writeFileSync(opencodeJsonPath, JSON.stringify(config, null, 2) + '\n');
    console.log(`  OpenCode plugin: added to opencode.json (${relativePluginPath})`);
  } catch (e) {
    console.warn(`  Warning: could not write opencode.json: ${e.message}`);
  }
}

function injectKarpathyPrinciples(projectRoot) {
  const agentsPath = path.join(projectRoot, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) return;

  let content;
  try {
    content = fs.readFileSync(agentsPath, 'utf8');
  } catch (e) {
    console.warn(`  Warning: could not read AGENTS.md: ${e.message}`);
    return;
  }

  if (content.includes('## AI CODING DISCIPLINE (Karpathy Principles)')) return;

  const section = `
## AI CODING DISCIPLINE (Karpathy Principles)

**原则 3: Surgical Changes（外科手术式改动）**
- 只碰必须碰的代码。只清理自己制造的混乱。
- 编辑现有代码时，不"优化"相邻代码、注释或 formatting
- 不重构没坏的东西
- 匹配现有代码风格，即使 AI 更喜欢另一种
- 发现无关的死代码 → 提及但不要删除（除非用户明确要求）
- 自己的改动产生的 orphaned import/variable/function → 必须清理
- 判定标准: 每一行改动都应能直接追溯到用户的请求

**原则 4: Goal-Driven Execution（目标驱动执行）**
- 定义成功标准。循环直到验证。
- 把指令转化为可验证目标：
  - "加验证" → "写测试 → 让测试通过"
  - "修 bug" → "写复现测试 → 让测试通过"
  - "重构 X" → "确保重构前后测试都通过"
- 多步骤任务列出验证点
- 改完任何代码后必须运行测试确认无 regression

`;

  try {
    fs.appendFileSync(agentsPath, section, 'utf8');
    console.log('  Karpathy Principles injected into AGENTS.md');
  } catch (e) {
    console.warn(`  Warning: could not write to AGENTS.md: ${e.message}`);
  }
}

module.exports = { init, promptBootstrap };