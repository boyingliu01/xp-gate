#!/usr/bin/env node
const { init } = require('../lib/init.js');
const { installSkill } = require('../lib/install-skill.js');
const { updateSkill } = require('../lib/update-skill.js');
const { uninstallSkill } = require('../lib/uninstall-skill.js');
const { uninstall } = require('../lib/uninstall.js');
const { doctor } = require('../lib/doctor.js');
const { checkDeps } = require('../lib/detect-deps.js');
const { migrate } = require('../lib/migrate.js');

const COMMANDS = {
  'init': {
    description: 'Initialize xp-gate (use --global for all projects)',
    fn: init,
    usage: 'xp-gate init [--global]'
  },
  'setup-global': {
    description: 'Set up xp-gate globally for all git projects',
    fn: init,
    usage: 'xp-gate setup-global'
  },
  'install-skill': {
    description: 'Install a xp-gate skill from GitHub',
    fn: installSkill,
    usage: 'xp-gate install-skill <name>[@<version>] [--offline] [--verbose] [--force] [--platform opencode|qoder]'
  },
  'update-skill': {
    description: 'Update installed skill(s)',
    fn: updateSkill,
    usage: 'xp-gate update-skill [<name>] [--all] [--check]'
  },
  'uninstall-skill': {
    description: 'Uninstall a xp-gate skill',
    fn: uninstallSkill,
    usage: 'xp-gate uninstall-skill <name> [--force]'
  },
  'uninstall': {
    description: 'Uninstall xp-gate (reverse of init)',
    fn: uninstall,
    usage: 'xp-gate uninstall [--dry-run] [--force] [--local|--global]'
  },
  'migrate': {
    description: 'Migrate from v0.4.x (GitHub Packages) to v0.5.x (public npm)',
    fn: migrate,
    usage: 'xp-gate migrate [--dry-run]'
  },
  'doctor': {
    description: 'Diagnose xp-gate installation health',
    fn: doctor,
    usage: 'xp-gate doctor [--fix]'
  },
  'ui-review': {
    description: 'Run UI review for non-sprint developers (generates .ui-gate-result.json)',
    fn: null,
    usage: 'xp-gate ui-review'
  },
  'audit': {
    description: 'Gate audit logging (record, --tail, --stats)',
    fn: null,
    usage: 'xp-gate audit [--tail [N]|--stats|record --gate-id X --gate-name Y ...]'
  }
};

function printHelp() {
  console.log('xp-gate - AI development workflow tool');
  console.log('');
  console.log('Usage: xp-gate <command> [options]');
  console.log('');
  console.log('Commands:');
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(16)} ${cmd.description}`);
  }
  console.log('');
  console.log('Options:');
  console.log('  --version    Show version');
  console.log('  --help       Show this help');
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--version')) {
    const pkg = require('../package.json');
    console.log(`xp-gate v${pkg.version}`);
    return;
  }
  
  if (args.includes('--help') || args.length === 0) {
    printHelp();
    return;
  }
  
  const command = args[0];
  const subargs = args.slice(1);
  
  if (command === 'init' || command === 'setup-global') {
    const initArgs = command === 'setup-global' ? ['--global'] : subargs;
    init(initArgs).then(code => process.exit(code));
    return;
  }
  
  if (command === 'install-skill') {
    const name = subargs[0];
    if (!name) {
      console.error('Error: Skill name required');
      console.error('Usage: xp-gate install-skill <name>[@<version>] [--platform opencode|qoder]');
      process.exit(1);
      return;
    }
    const options = parseOptions(subargs.slice(1));
    installSkill(name, options).then(code => process.exit(code));
    return;
  }
  
  if (command === 'update-skill') {
    const name = subargs[0];
    const options = parseOptions(subargs.slice(1));
    updateSkill(name, options).then(code => process.exit(code));
    return;
  }
  
  if (command === 'uninstall-skill') {
    const name = subargs[0];
    if (!name) {
      console.error('Error: Skill name required');
      console.error('Usage: xp-gate uninstall-skill <name>');
      process.exit(1);
      return;
    }
    const options = parseOptions(subargs.slice(1));
    uninstallSkill(name, options).then(code => process.exit(code));
    return;
  }
  
  if (command === 'uninstall') {
    uninstall(subargs).then(code => process.exit(code));
    return;
  }

  if (command === 'migrate') {
    migrate(subargs).then(code => process.exit(code));
    return;
  }
  
  if (command === 'doctor') {
    doctor(subargs).then(code => process.exit(code));
    return;
  }

  if (command === 'ui-review') {
    const { execSync } = require('child_process');
    const path = require('path');
    const uiReviewPath = path.join(__dirname, '..', 'lib', 'ui-review.ts');
    try {
      execSync(`npx -y tsx "${uiReviewPath}"`, { stdio: 'inherit' });
      process.exit(0);
    } catch (err) {
      process.exit(1);
    }
  }

  if (command === 'audit') {
    handleAudit(subargs);
    return;
  }
  
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

function handleAudit(args) {
  const path = require('path');
  const auditPath = path.join(__dirname, '..', 'lib', 'gate-audit.ts');

  // --tail [N]
  const tailIdx = args.indexOf('--tail');
  if (tailIdx !== -1) {
    const count = parseInt(args[tailIdx + 1] || '20', 10);
    try {
      const { readTailEntries } = require(auditPath);
      const entries = readTailEntries(count);
      if (entries.length === 0) {
        console.log('No audit entries found.');
        return;
      }
      printAuditTable(entries);
    } catch (err) {
      console.error('Error reading audit entries:', err.message);
      process.exit(1);
    }
    return;
  }

  // --stats
  if (args.includes('--stats')) {
    try {
      const { computeStats } = require(auditPath);
      const stats = computeStats();
      if (stats.length === 0) {
        console.log('No audit data found.');
        return;
      }
      printStatsTable(stats);
    } catch (err) {
      console.error('Error computing stats:', err.message);
      process.exit(1);
    }
    return;
  }

  // record --gate-id X --gate-name Y --passed true/false ...
  if (args[0] === 'record') {
    try {
      const { appendAuditEntry } = require(auditPath);
      const rest = args.slice(1);
      const opts = {};
      for (let i = 0; i < rest.length; i++) {
        if (rest[i].startsWith('--') && i + 1 < rest.length) {
          opts[rest[i].slice(2)] = rest[i + 1];
          i++;
        }
      }
      const entry = {
        timestamp: new Date().toISOString(),
        gate_id: opts['gate-id'] || 'unknown',
        gate_name: opts['gate-name'] || 'unknown',
        passed: opts['passed'] === 'true',
        issues_found: parseInt(opts['issues-found'] || '0', 10),
        duration_ms: parseInt(opts['duration-ms'] || '0', 10),
        trigger: opts['trigger'] || 'manual',
        repo_path: process.cwd(),
        commit_hash: opts['commit-hash'] || 'HEAD',
      };
      appendAuditEntry(entry);
    } catch (err) {
      console.error('Error recording audit entry:', err.message);
      process.exit(1);
    }
    return;
  }

  console.error('Error: Unknown audit subcommand or missing flag');
  console.error('Usage:');
  console.error('  xp-gate audit record --gate-id X --gate-name Y --passed true/false --issues-found N --duration-ms N --trigger commit');
  console.error('  xp-gate audit --tail [N]     (default: 20)');
  console.error('  xp-gate audit --stats');
  process.exit(1);
}

function printAuditTable(entries) {
  console.log('');
  console.log('Recent Audit Entries:');
  console.log('┌─────────────────────┬──────────┬─────────────────────┬────────┬────────┬───────────┬──────────┐');
  console.log('│ Timestamp           │ Gate     │ Name                │ Passed │ Issues │ Duration  │ Trigger  │');
  console.log('├─────────────────────┼──────────┼─────────────────────┼────────┼────────┼───────────┼──────────┤');
  for (const e of entries) {
    const ts = e.timestamp ? e.timestamp.slice(0, 19) : 'N/A';
    const gid = (e.gate_id || '').padEnd(8);
    const gname = (e.gate_name || '').slice(0, 19).padEnd(19);
    const pass = (e.passed ? 'Y' : 'N').padEnd(6);
    const issues = String(e.issues_found ?? 0).padEnd(6);
    const dur = String(e.duration_ms ?? 0).padEnd(9);
    const trig = (e.trigger || 'manual').padEnd(8);
    console.log(`│ ${ts} │ ${gid} │ ${gname} │ ${pass} │ ${issues} │ ${dur} │ ${trig} │`);
  }
  console.log('└─────────────────────┴──────────┴─────────────────────┴────────┴────────┴───────────┴──────────┘');
  console.log(`Total: ${entries.length} entries`);
}

function printStatsTable(stats) {
  console.log('');
  console.log('Gate Statistics:');
  console.log('┌──────────────────┬────────┬────────┬────────────┐');
  console.log('│ Gate             │ Pass%  │ Avg ms │ Issues Avg │');
  console.log('├──────────────────┼────────┼────────┼────────────┤');
  for (const s of stats) {
    const gid = (s.gate_id || '').slice(0, 16).padEnd(16);
    const pp = (s.pass_pct || 'N/A').padEnd(6);
    const avg = String(s.avg_ms ?? 0).padEnd(6);
    const iss = String(s.avg_issues ?? 0).padEnd(10);
    console.log(`│ ${gid} │ ${pp} │ ${avg} │ ${iss} │`);
  }
  console.log('└──────────────────┴────────┴────────┴────────────┘');
}

function parseOptions(args) {
  const options = { offline: false, verbose: false, force: false, all: false, check: false, platform: 'opencode' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--offline') options.offline = true;
    if (arg === '--verbose') options.verbose = true;
    if (arg === '--force') options.force = true;
    if (arg === '--all') options.all = true;
    if (arg === '--check') options.check = true;
    if (arg === '--platform' && i + 1 < args.length) {
      options.platform = args[i + 1];
      i++;
    }
  }
  return options;
}

main();