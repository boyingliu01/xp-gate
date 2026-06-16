const { execSync } = require('child_process');
const { checkUpgrade, formatUpgradeMsg, clearCache, getLocalVersion, getPackageName } = require('./check-version.js');

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

  // --- check for upgrade ---
  let result;
  try {
    result = await checkUpgrade(pkgName);
  } catch (err) {
    if (isPreview) {
      console.log(JSON.stringify({ error: 'check failed', detail: err.message }));
    } else {
      console.error('Unable to check for updates (check error).');
    }
    return 1;
  }

  // Guard: if checkUpgrade returned null remote (network issue)
  if (!result.remote) {
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

  // --- --preview: JSON output ---
  if (isPreview) {
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

  // --- --apply: auto-upgrade ---
  if (isApply) {
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
      execSync(`npm install -g ${pkgName}@${result.remote}`, {
        stdio: 'inherit',
        timeout: 120000, // 2 minute timeout
      });
      // clear cache so next check picks up the new version
      clearCache();
      console.log(`\u2713 Upgraded to v${result.remote}`);
      return 0;
    } catch (err) {
      const stderr = (err.stderr || '').toString();
      if (stderr.includes('EACCES') || stderr.includes('permission') || stderr.includes('EPERM')) {
        console.error(`Permission denied. Try: sudo npm install -g ${pkgName}`);
      } else if (err.code === 'ETIMEDOUT' || stderr.includes('ETIMEDOUT')) {
        console.error('npm install timed out. Check your network and try again.');
        console.error(`  Retry: npm install -g ${pkgName}@latest`);
      } else {
        console.error('Upgrade failed:');
        console.error(`  ${err.message}`);
        console.error(`  Retry manually: npm install -g ${pkgName}@latest`);
      }
      return 1;
    }
  }

  // --- default mode: human-readable ---
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

module.exports = { upgrade };
