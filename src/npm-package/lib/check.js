'use strict';

const { principles } = require('./principles.js');
const { arch } = require('./arch.js');

// Runs the user-invokable subset of quality gates on a path. Mirrors what the
// pre-commit hook does, but as a standalone CLI surface. Intentionally narrower
// than the full pre-commit run (no git staging context, no Boy Scout baseline).
// Currently delegates to: Gate 4 (Principles) + Gate 6 (Architecture).
async function check(args) {
  const target = args[0];
  if (!target) {
    console.error('Usage: xp-gate check <file_or_directory> [--gates principles,arch]');
    return 1;
  }

  const gatesIdx = args.indexOf('--gates');
  const gateList = gatesIdx >= 0
    ? args[gatesIdx + 1].split(',').map(s => s.trim()).filter(Boolean)
    : ['principles', 'arch'];

  let failures = 0;
  let ran = 0;

  if (gateList.includes('principles')) {
    console.log('━━━ Gate 4: Principles ━━━');
    const code = await principles([target]);
    if (code !== 0) failures += 1;
    ran += 1;
  }

  if (gateList.includes('arch')) {
    console.log('━━━ Gate 6: Architecture ━━━');
    const code = await arch([]);
    if (code !== 0) failures += 1;
    ran += 1;
  }

  if (ran === 0) {
    console.error(`[xp-gate check] No valid gates in --gates list: ${gateList.join(',')}`);
    console.error('  Available gates: principles, arch');
    return 1;
  }

  console.log('');
  console.log(`[xp-gate check] ${ran - failures}/${ran} gate(s) passed`);
  return failures === 0 ? 0 : 1;
}

module.exports = { check };
