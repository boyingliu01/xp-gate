const fs = require('fs');
const path = require('path');
const os = require('os');
const { checkDeps } = require('./detect-deps.js');
const { checkBash } = require('./detect-deps.js');

// Cross-platform home directory resolution with os.homedir() fallback
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || os.homedir();

const CONFIG_DIR = path.join(HOME_DIR, '.config', 'xp-gate');
const CONFIG_FILE = path.join(CONFIG_DIR, 'xp-gate.json');
const TEMPLATE_DIR = path.join(HOME_DIR, '.config', 'opencode', 'git-hooks-template');
const GLOBAL_HOOKS_DIR = path.join(CONFIG_DIR, 'hooks');
const GLOBAL_ADAPTERS_DIR = path.join(CONFIG_DIR, 'adapters');

function copyHooks(srcDir, destDir) {
  ['pre-commit', 'pre-push'].forEach(hook => {
    const src = path.join(srcDir, 'hooks', hook);
    const dest = path.join(destDir, hook);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      fs.chmodSync(dest, 0o755);
    }
  });
}

function copyAdapters(srcDir, destDir) {
  const adapterSrc = path.join(srcDir, 'adapter-common.sh');
  if (fs.existsSync(adapterSrc)) {
    fs.copyFileSync(adapterSrc, path.join(destDir, 'adapter-common.sh'));
  }
  const adaptersDir = path.join(srcDir, 'adapters');
  if (fs.existsSync(adaptersDir)) {
    fs.readdirSync(adaptersDir).forEach(f => {
      if (f.endsWith('.sh')) {
        fs.copyFileSync(path.join(adaptersDir, f), path.join(destDir, f));
      }
    });
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

function printUsage() {
  console.log('Choose installation mode:');
  console.log('  1) Global  — all git projects use the same hooks (recommended)');
  console.log('  2) Local   — install hooks into current project only\n');
  console.log('Usage:');
  console.log('  xp-gate init --global     # all projects');
  console.log('  xp-gate init              # current project');
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

async function init(args) {
  console.log('XP-Gate Initialization');
  console.log('====================\n');

  // Check bash availability (required for shell hooks)
  const bashCheck = checkBash();
  if (bashCheck.ok) {
    console.log(`Bash: ✓ ${bashCheck.path} (v${bashCheck.version})\n`);
  } else {
    console.warn(`Bash: ✗ NOT FOUND`);
    console.warn(`  ${bashCheck.message}\n`);
  }

  logDeps(await checkDeps());

  const installMode = args.includes('--global') ? 'global' :
                      args.includes('--core-only') ? 'local' :
                      args.includes('--full') ? 'local' : null;

  if (!installMode) { printUsage(); return 0; }
  if (installMode === 'global') return setupGlobal(args);
  return installLocal(args);
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

  fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
  copyHooks(srcDir, TEMPLATE_DIR);
  fs.mkdirSync(path.join(TEMPLATE_DIR, 'adapters'), { recursive: true });

  ensureConfigDir();
  updateConfig({ lastInit: new Date().toISOString(), mode: 'local' });

  injectKarpathyPrinciples(projectRoot);

  console.log('\nInstallation complete!');
  console.log('Run git commit to trigger quality gates');
  return 0;
}

async function setupGlobal(args) {
  const srcDir = path.dirname(__dirname);

  console.log('XP-Gate Global Setup');
  console.log('====================\n');
  console.log('Mode: Global (all git projects)');
  console.log(`Global hooks: ${GLOBAL_HOOKS_DIR}`);
  console.log(`Global adapters: ${GLOBAL_ADAPTERS_DIR}\n`);

  fs.mkdirSync(GLOBAL_HOOKS_DIR, { recursive: true });
  fs.mkdirSync(GLOBAL_ADAPTERS_DIR, { recursive: true });

  copyHooks(srcDir, GLOBAL_HOOKS_DIR);
  console.log('Installing hooks...');
  console.log(`  pre-commit -> ${GLOBAL_HOOKS_DIR}`);
  console.log(`  pre-push -> ${GLOBAL_HOOKS_DIR}`);

  copyAdapters(srcDir, GLOBAL_ADAPTERS_DIR);
  console.log(`  adapter-common.sh + adapters -> ${GLOBAL_ADAPTERS_DIR}`);

  const { execSync } = require('child_process');
  try {
    execSync(`git config --global core.hooksPath "${GLOBAL_HOOKS_DIR}"`);
    console.log(`\n  git config --global core.hooksPath "${GLOBAL_HOOKS_DIR}"`);
  } catch (e) {
    console.warn('Warning: Could not set git core.hooksPath config');
  }

  ensureConfigDir();
  updateConfig({ lastInit: new Date().toISOString(), mode: 'global' });

  console.log('\nGlobal setup complete!');
  console.log('All git repositories will now use xp-gate quality gates.');
  console.log('Per-project adapters can still override by creating <repo>/githooks/');
  return 0;
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

module.exports = { init };