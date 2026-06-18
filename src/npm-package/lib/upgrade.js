const { execSync, spawn } = require('child_process');
const { checkUpgrade, formatUpgradeMsg, clearCache, getLocalVersion, getPackageName } = require('./check-version.js');

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
