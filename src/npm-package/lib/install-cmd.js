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

  // Post-install: run doctor --fix to verify and auto-repair
  console.log('\n━━━ Post-Install Health Check ━━━\n');
  const { doctor } = require('./doctor.js');
  const doctorCode = await doctor(['--fix']);

  if (doctorCode === 0) {
    console.log('\n✓ Installation complete and verified!');
  } else {
    console.log('\n⚠ Installation complete, but some issues remain.');
    console.log('  Run "xp-gate doctor" for details.');
  }

  return doctorCode;
}

module.exports = { install };
