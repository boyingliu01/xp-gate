const { execSync, spawn } = require('child_process');
const { checkUpgrade, formatUpgradeMsg, clearCache, getLocalVersion, getPackageName } = require('./check-version.js');

const OPENCODE_PLUGIN = '@boyingliu01/opencode-plugin';

/**
 * Handle checkUpgrade() failure.
 * @param {Error} err
 * @param {boolean} isPreview
 * @returns {number} exit code (always 1)
 */
function handleCheckError(err, isPreview) {
  if (isPreview) {
    console.log(JSON.stringify({ error: 'check failed', detail: err.message }));
  } else {
    console.error('Unable to check for updates (check error).');
  }
  return 1;
}

/**
 * Handle null remote (network issue) after checkUpgrade().
 * @param {{ local: string|null }} result
 * @param {boolean} isPreview
 * @returns {number} exit code (always 0)
 */
function handleNullRemote(result, isPreview) {
  if (isPreview) {
    console.log(JSON.stringify({
      local: result.local || 'unknown',
      remote: null,
      outdated: false,
      lagDays: 0,
      error: 'Unable to check for updates (network issue)',
    }));
  } else {
    console.error('Unable to check for updates (network issue).');
  }
  return 0;
}

/**
 * Handle --preview mode: emit single-line JSON.
 * @param {{ local: string, remote: string, outdated: boolean, lagDays: number, publishedAt?: string }} result
 * @returns {number} exit code (always 0)
 */
function handlePreviewMode(result) {
  const releaseUrl = result.outdated
    ? `https://github.com/boyingliu01/xp-gate/releases/tag/v${result.remote}`
    : null;
  console.log(JSON.stringify({
    local: result.local,
    remote: result.remote,
    outdated: result.outdated,
    lagDays: result.lagDays,
    releaseUrl,
    publishedAt: result.publishedAt || null,
  }));
  return 0;
}

/**
 * Handle --apply mode: auto-upgrade via npm install -g.
 * Also checks for and updates the local OpenCode plugin.
 * @param {{ local: string, remote: string, outdated: boolean }} result
 * @param {string} pkgName
 * @returns {Promise<number>} exit code
 */
async function handleApplyMode(result, pkgName) {
  if (!result.outdated) {
    if (result.local) {
      console.log(`\u2713 xp-gate v${result.local} is up to date`);
    } else {
      console.log('xp-gate is up to date.');
    }
    return 0;
  }

  console.log(`Upgrading xp-gate from v${result.local} to v${result.remote}...`);
  try {
    const child = spawn('npm', ['install', '-g', `${pkgName}@${result.remote}`], {
      stdio: 'inherit',
      timeout: 120000,
    });
    await new Promise((resolve, reject) => {
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`npm install exited with code ${code}`));
      });
      child.on('error', reject);
    });
    clearCache();
    console.log(`\u2713 Upgraded to v${result.remote}`);

    // Also check for and update the local OpenCode plugin if installed.
    await upgradeOpenCodePlugin();

    return 0;
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('EACCES') || msg.includes('permission') || msg.includes('EPERM')) {
      console.error(`Permission denied. Try: sudo npm install -g ${pkgName}`);
    } else if (msg.includes('ETIMEDOUT')) {
      console.error('npm install timed out. Check your network and try again.');
      console.error(`  Retry: npm install -g ${pkgName}@latest`);
    } else {
      console.error('Upgrade failed:');
      console.error(`  ${msg}`);
      console.error(`  Retry manually: npm install -g ${pkgName}@latest`);
    }
    return 1;
  }
}

async function upgradeOpenCodePlugin() {
  try {
    const hasPlugin = await hasOpenCodePlugin();
    if (!hasPlugin) return;

    const { stdout: versionOut } = await execAsync('npm list -g ' + OPENCODE_PLUGIN + ' --depth=0 --json 2>/dev/null');
    let currentVersion = '';
    try {
      const parsed = JSON.parse(versionOut);
      const deps = parsed.dependencies || {};
      currentVersion = deps[OPENCODE_PLUGIN]?.version || '';
    } catch { /* skip parse error */ }
    if (currentVersion) {
      console.log(`  Found OpenCode plugin v${currentVersion} — upgrading to latest...`);
    }

    const child = spawn('npm', ['install', '-g', OPENCODE_PLUGIN + '@latest'], {
      stdio: 'pipe',
      timeout: 120000,
    });
    const exitCode = await new Promise((resolve) => {
      child.on('close', (code) => resolve(code));
      child.on('error', () => resolve(1));
    });
    if (exitCode === 0) {
      console.log('  Also updated local OpenCode plugin');
    }
  } catch {
    // Non-blocking: plugin upgrade failure should never break the main flow.
  }
}

function hasOpenCodePlugin() {
  return new Promise((resolve) => {
    const child = spawn('npm', ['list', '-g', OPENCODE_PLUGIN, '--depth=0'], {
      stdio: 'pipe',
      timeout: 10000,
    });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, { shell: true, stdio: 'pipe', timeout: 10000 });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `exit code ${code}`));
    });
    child.on('error', reject);
  });
}

/**
 * Handle default mode: human-readable output.
 * @param {{ local: string, remote: string, outdated: boolean, lagDays: number, publishedAt?: string }} result
 * @returns {number} exit code (always 0)
 */
function handleDefaultMode(result) {
  if (!result.outdated) {
    if (result.local) {
      console.log(`\u2713 xp-gate v${result.local} is up to date`);
    } else {
      console.log('xp-gate is up to date.');
    }
  } else {
    const msg = formatUpgradeMsg(result, 'cli');
    console.log(msg);
  }
  return 0;
}

/**
 * xp-gate upgrade command handler.
 *
 * Modes:
 *   xp-gate upgrade           — human-readable output
 *   xp-gate upgrade --preview — single-line JSON for plugin consumption
 *   xp-gate upgrade --apply   — auto-upgrade via npm install -g
 *
 * @param {string[]} args
 * @returns {Promise<number>} exit code
 */
async function upgrade(args) {
  const isPreview = args.includes('--preview');
  const isApply = args.includes('--apply');
  const pkgName = getPackageName();

  let result;
  try {
    result = await checkUpgrade(pkgName);
  } catch (err) {
    return handleCheckError(err, isPreview);
  }

  if (!result.remote) {
    return handleNullRemote(result, isPreview);
  }

  if (isPreview) return handlePreviewMode(result);
  if (isApply) return handleApplyMode(result, pkgName);
  return handleDefaultMode(result);
}

module.exports = { upgrade };
