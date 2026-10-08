/**
 * One-step install command — delegates to init + doctor.
 *
 * `xp-gate install` is the single entry point for new users.
 * It wraps init (which already handles hooks, bootstrap, language detection,
 * and baseline creation) and follows up with doctor --fix for health verification.
 *
 * Local mode:  init --core-only --yes → auto baseline → doctor --fix
 * Global mode: init --global --yes   → doctor --fix
 */
const path = require('path');

async function install(args = []) {
  const isGlobal = args.includes('--global');

  console.log('XP-Gate One-Step Install');
  console.log('========================\n');

  // Build init args: always auto-yes for non-interactive friendliness
  const initArgs = isGlobal ? ['--global', '--yes'] : ['--core-only', '--yes'];

  const { init } = require('./init.js');
  const code = await init(initArgs);

  if (code !== 0) {
    console.error('\nInstallation encountered errors.');
    console.error('Run "xp-gate doctor" for diagnostics.');
    return code;
  }

  // Post-install: run doctor --fix to verify and report
  console.log('\n━━━ Post-Install Health Check ━━━\n');
  const { doctor } = require('./doctor.js');
  const doctorCode = await doctor(['--fix']);

  if (doctorCode === 0) {
    console.log('\n✓ Installation complete and verified!');
  } else {
    // Doctor findings (hook/module drift needing a human judgement, #495) are
    // diagnostics about the environment, not a failed install. Returning its
    // code made `xp-gate install && next-step` fail on a successful install (#502).
    console.log('\n⚠ Installation complete, but doctor reported issues.');
    console.log('  Review them with "xp-gate doctor" — the install itself succeeded.');
  }

  return 0;
}

module.exports = { install };
