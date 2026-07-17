'use strict';

const { principles } = require('./principles.js');
const { arch } = require('./arch.js');
const { getGateInfo, runGate, resolveAlias, getAliases } = require('./gate-runner.js');

/**
 * Resolve a token (gate ID or alias) to a canonical gate ID.
 * Returns null if unresolved.
 */
function resolveGateToken(token) {
  return resolveAlias(token);
}

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
  // Try to resolve positional as a gate alias/number
  const resolvedGate = rawTarget ? resolveGateToken(rawTarget) : null;
  return {
    ...flags,
    positionals: posArgs,
    pathArg: resolvedGate ? posArgs[1] || null : rawTarget,
    gateNumber: resolvedGate,
  };
}

async function check(args) {
  const opts = parseCheckArgs(args);

  if (opts.list) return listGates();
  if (opts.gateNumber && !opts.all && !opts.gateIds) return runGate(opts.gateNumber, opts.pathArg);
  if (opts.all) return checkAllGates(opts.pathArg);
  if (opts.gateIds && opts.gateIds.length > 0) return runGatesByIds(opts.gateIds, opts.pathArg);

  if (!opts.pathArg) {
    console.error('Usage: xp-gate check <file_or_directory|gate-or-alias> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --gates <ids>    Run specific gates (comma-separated IDs or aliases, e.g. "version,4,secrets")');
    console.error('  --all             Run all invokable gates');
    console.error('  --list            List all available gates');
    console.error('');
    console.error('Available Gates:');
    console.error('  0/version    1/lint         2/duplicates   3/complexity');
    console.error('  4/principles 5/tests        6/architecture 7/iac');
    console.error('  8/secrets    9/sast         10/build       11/sprint');
    console.error('');
    console.error('Examples:');
    console.error('  xp-gate check src/                              # Default: principles + architecture');
    console.error('  xp-gate check 3                                 # Run Gate 3 (Complexity)');
    console.error('  xp-gate check secrets                           # Run Gate 8 via alias');
    console.error('  xp-gate check . --gates version,4,secrets       # Run gates 0, 4, and 8');
    console.error('  xp-gate check . --all                           # Run all invokable gates');
    console.error('  xp-gate check --list                            # List available gates');
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
  const resolvedGates = [];
  const unknown = [];

  for (const gateId of gateIds) {
    const resolved = resolveGateToken(gateId);
    if (resolved) {
      resolvedGates.push(resolved);
    } else {
      unknown.push(gateId);
    }
  }

  if (unknown.length > 0) {
    const { getAllGates } = require('./gate-runner.js');
    const allAliases = getAllGates().flatMap(g => g.aliases);
    console.error(`[xp-gate check] Unknown gate(s) in --gates list: ${unknown.join(', ')}`);
    console.error(`  Known aliases/IDs: ${allAliases.join(', ')}`);
    return 1;
  }

  for (const resolvedId of resolvedGates) {
    const code = await runGate(resolvedId, target);
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
  console.log('┌──────┬──────────────────────────────┬──────────────────────────────┬──────────┬──────────────────────────────────────────┐');
  console.log('│ Gate │ Name                         │ Aliases                      │ CLI      │ Description                              │');
  console.log('├──────┼──────────────────────────────┼──────────────────────────────┼──────────┼──────────────────────────────────────────┤');
  for (const gate of allGates) {
    const id = gate.id.padEnd(4);
    const name = gate.name.slice(0, 28).padEnd(28);
    const aliases = (gate.aliases || []).join(', ').slice(0, 28).padEnd(28);
    const cli = gate.preCommitOnly ? 'commit' : 'check';
    const desc = gate.description.slice(0, 40).padEnd(40);
    console.log(`│ ${id} │ ${name} │ ${aliases} │ ${cli.padEnd(8)} │ ${desc} │`);
  }
  console.log('└──────┴──────────────────────────────┴──────────────────────────────┴──────────┴──────────────────────────────────────────┘');
  console.log('');
  console.log('Legend:');
  console.log('  check   — invokable via xp-gate check <gate-id-or-alias>');
  console.log('  commit  — only runs during git commit (pre-commit hook)');
  console.log('');
  console.log('Examples:');
  console.log('  xp-gate check . --gates version,principles,secrets');
  console.log('  xp-gate check . --gates 0,4,8');
  console.log('  xp-gate check secrets');
  console.log('  xp-gate check . --all');
  console.log('');
  return 0;
}

module.exports = { check };
