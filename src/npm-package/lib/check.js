'use strict';

const { principles } = require('./principles.js');
const { arch } = require('./arch.js');
const { getGateInfo, runGate } = require('./gate-runner.js');

function parseCheckArgs(args) {
  const flags = { all: false, list: false, gateIds: null };
  const posArgs = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--all') { flags.all = true; i++; }
    else if (arg === '--list') { flags.list = true; i++; }
    else if (arg === '--gates' && i + 1 < args.length) {
      flags.gateIds = args[i + 1].split(',').map(s => s.trim()).filter(Boolean);
      i += 2;
    }
    else if (arg.startsWith('--gates=')) {
      flags.gateIds = arg.split('=')[1].split(',').map(s => s.trim()).filter(Boolean);
      i++;
    }
    else { posArgs.push(arg); i++; }
  }
  const rawTarget = posArgs[0] || null;
  const isGateNumber = rawTarget && /^\d+$/.test(rawTarget);
  return {
    ...flags,
    positionals: posArgs,
    pathArg: isGateNumber ? posArgs[1] || null : rawTarget,
    gateNumber: isGateNumber ? rawTarget : null,
  };
}

async function check(args) {
  const opts = parseCheckArgs(args);

  if (opts.list) return listGates();
  if (opts.gateNumber && !opts.all && !opts.gateIds) return runGate(opts.gateNumber, opts.pathArg);
  if (opts.all) return checkAllGates(opts.pathArg);
  if (opts.gateIds && opts.gateIds.length > 0) return runGatesByIds(opts.gateIds, opts.pathArg);

  if (!opts.pathArg) {
    console.error('Usage: xp-gate check <file_or_directory|gate_number> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --gates <ids>    Run specific gates (comma-separated, e.g. "3,4,6")');
    console.error('  --all             Run all invokable gates');
    console.error('  --list            List all available gates');
    console.error('');
    console.error('Examples:');
    console.error('  xp-gate check src/                   # Run principles + architecture check');
    console.error('  xp-gate check 3                      # Run Gate 3 (Complexity)');
    console.error('  xp-gate check --gates 3,4,6          # Run gates 3, 4, and 6');
    console.error('  xp-gate check --all                  # Run all invokable gates');
    console.error('  xp-gate check --list                 # List available gates');
    return 1;
  }

  return runDefaultChecks(opts.pathArg);
}

async function runDefaultChecks(target) {
  let failures = 0;
  let ran = 0;

  console.log('━━━ Gate 4: Principles ━━━');
  const principlesCode = await principles([target]);
  if (principlesCode !== 0) failures += 1;
  ran += 1;

  console.log('━━━ Gate 6: Architecture ━━━');
  const archCode = await arch([]);
  if (archCode !== 0) failures += 1;
  ran += 1;

  console.log('');
  console.log(`[xp-gate check] ${ran - failures}/${ran} gate(s) passed`);
  return failures === 0 ? 0 : 1;
}

async function checkAllGates(target) {
  const { getAllGates } = require('./gate-runner.js');
  const invokableGates = getAllGates().filter(g => !g.preCommitOnly);
  let failures = 0;
  let ran = 0;

  for (const gate of invokableGates) {
    const code = await runGate(gate.id, target);
    if (code !== 0) failures += 1;
    ran += 1;
    console.log('');
  }

  console.log(`[xp-gate check --all] ${ran - failures}/${ran} gate(s) passed`);
  return failures === 0 ? 0 : 1;
}

async function runGatesByIds(gateIds, target) {
  let failures = 0;
  let ran = 0;

  for (const gateId of gateIds) {
    const code = await runGate(gateId, target);
    if (code !== 0) failures += 1;
    ran += 1;
    console.log('');
  }

  if (ran === 0) {
    console.error(`[xp-gate check] No valid gates in --gates list: ${gateIds.join(',')}`);
    console.error('  Run: xp-gate check --list  to see available gates');
    return 1;
  }

  console.log(`[xp-gate check] ${ran - failures}/${ran} gate(s) passed`);
  return failures === 0 ? 0 : 1;
}

function listGates() {
  const { getAllGates } = require('./gate-runner.js');
  const allGates = getAllGates();

  console.log('');
  console.log('XP-Gate Quality Gates:');
  console.log('┌──────┬──────────────────────────────┬──────────┬──────────────────────────────────────────┐');
  console.log('│ Gate │ Name                         │ CLI      │ Description                              │');
  console.log('├──────┼──────────────────────────────┼──────────┼──────────────────────────────────────────┤');
  for (const gate of allGates) {
    const id = gate.id.padEnd(4);
    const name = gate.name.slice(0, 28).padEnd(28);
    const cli = gate.preCommitOnly ? 'commit' : 'check';
    const desc = gate.description.slice(0, 40).padEnd(40);
    console.log(`│ ${id} │ ${name} │ ${cli.padEnd(8)} │ ${desc} │`);
  }
  console.log('└──────┴──────────────────────────────┴──────────┴──────────────────────────────────────────┘');
  console.log('');
  console.log('Legend:');
  console.log('  check   — invokable via xp-gate check <gate-id>');
  console.log('  commit  — only runs during git commit (pre-commit hook)');
  console.log('');
  return 0;
}

module.exports = { check };
