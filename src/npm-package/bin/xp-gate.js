#!/usr/bin/env node
const { init } = require('../lib/init.js');
const { installSkill } = require('../lib/install-skill.js');
const { updateSkill } = require('../lib/update-skill.js');
const { uninstallSkill } = require('../lib/uninstall-skill.js');
const { uninstall } = require('../lib/uninstall.js');
const { doctor } = require('../lib/doctor.js');
const { checkDeps } = require('../lib/detect-deps.js');
const { migrate } = require('../lib/migrate.js');
const { handleBaseline } = require('../lib/baseline.js');
const { check } = require('../lib/check.js');
const { principles } = require('../lib/principles.js');
const { arch } = require('../lib/arch.js');
const { upgrade } = require('../lib/upgrade.js');

function handleUIReview() {
  const { execSync } = require('child_process');
  const uiReviewPath = path.join(__dirname, '..', 'lib', 'ui-review.ts');
  try {
    execSync(`npx -y tsx "${uiReviewPath}"`, { stdio: 'inherit' });
    process.exit(0);
  } catch (err) {
    process.exit(1);
  }
}

const COMMANDS = {
  'init': {
    description: 'Initialize xp-gate (use --global for all projects)',
    run: subargs => init(subargs).then(code => process.exit(code)),
    usage: 'xp-gate init [--global]'
  },
  'setup-global': {
    description: 'Set up xp-gate globally for all git projects',
    run: () => init(['--global']).then(code => process.exit(code)),
    usage: 'xp-gate setup-global'
  },
  'install-skill': {
    description: 'Install a xp-gate skill from GitHub',
    run: subargs => {
      const name = subargs[0];
      if (!name) {
        console.error('Error: Skill name required');
        console.error('Usage: xp-gate install-skill <name>[@<version>]');
        process.exit(1);
      }
      const options = parseOptions(subargs.slice(1));
      installSkill(name, options).then(code => process.exit(code));
    },
    usage: 'xp-gate install-skill <name>[@<version>] [--offline] [--verbose] [--force]'
  },
  'update-skill': {
    description: 'Update installed skill(s)',
    run: subargs => {
      const name = subargs[0];
      const options = parseOptions(subargs.slice(1));
      updateSkill(name, options).then(code => process.exit(code));
    },
    usage: 'xp-gate update-skill [<name>] [--all] [--check]'
  },
  'uninstall-skill': {
    description: 'Uninstall a xp-gate skill',
    run: subargs => {
      const name = subargs[0];
      if (!name) {
        console.error('Error: Skill name required');
        console.error('Usage: xp-gate uninstall-skill <name>');
        process.exit(1);
      }
      const options = parseOptions(subargs.slice(1));
      uninstallSkill(name, options).then(code => process.exit(code));
    },
    usage: 'xp-gate uninstall-skill <name> [--force]'
  },
  'uninstall': {
    description: 'Uninstall xp-gate (reverse of init)',
    run: subargs => uninstall(subargs).then(code => process.exit(code)),
    usage: 'xp-gate uninstall [--dry-run] [--force] [--local|--global]'
  },
  'migrate': {
    description: 'Migrate from v0.4.x (GitHub Packages) to v0.5.x (public npm)',
    run: subargs => migrate(subargs).then(code => process.exit(code)),
    usage: 'xp-gate migrate [--dry-run]'
  },
  'doctor': {
    description: 'Diagnose xp-gate installation health',
    run: subargs => doctor(subargs).then(code => process.exit(code)),
    usage: 'xp-gate doctor [--fix]'
  },
  'ui-review': {
    description: 'Run UI review for non-sprint developers (generates .ui-gate-result.json)',
    run: () => handleUIReview(),
    usage: 'xp-gate ui-review'
  },
  'audit': {
    description: 'Gate audit logging (record, --tail, --stats)',
    run: subargs => handleAudit(subargs),
    usage: 'xp-gate audit [--tail [N]|--stats|record --gate-id X --gate-name Y ...]'
  },
  'baseline': {
    description: 'Manage lint baselines (create, show, reset, diff)',
    run: subargs => handleBaseline(subargs).then(code => process.exit(code)),
    usage: 'xp-gate baseline <create|show|reset|diff>'
  },
  'check': {
    description: 'Run user-invokable quality gates (Gate 4 Principles + Gate 6 Architecture) on a path',
    run: subargs => check(subargs).then(code => process.exit(code)),
    usage: 'xp-gate check <file_or_directory> [--gates principles,arch]'
  },
  'principles': {
    description: 'Run Clean Code + SOLID principles checker (Gate 4 standalone)',
    run: subargs => principles(subargs).then(code => process.exit(code)),
    usage: 'xp-gate principles <file_or_directory> [--format console|json|sarif]'
  },
  'arch': {
    description: 'Run architecture validation (Gate 6 standalone, uses architecture.yaml)',
    run: subargs => arch(subargs).then(code => process.exit(code)),
    usage: 'xp-gate arch [--config <path>]'
  },
  'upgrade': {
    description: 'Check for xp-gate updates (--preview for JSON, --apply to upgrade)',
    run: subargs => upgrade(subargs).then(code => process.exit(code)),
    usage: 'xp-gate upgrade [--preview] [--apply]'
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
  const cmd = COMMANDS[command];
  
  if (!cmd) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
    return;
  }
  
  cmd.run(subargs);
}

function handleAuditTail(args, auditPath) {
  const tailIdx = args.indexOf('--tail');
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
}

function handleAuditStats(auditPath) {
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
}

function handleAuditRecord(args, auditPath) {
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
}

function handleAudit(args) {
  const auditPath = path.join(__dirname, '..', 'lib', 'gate-audit.ts');

  if (args.includes('--tail')) {
    handleAuditTail(args, auditPath);
    return;
  }

  if (args.includes('--stats')) {
    handleAuditStats(auditPath);
    return;
  }

  if (args[0] === 'record') {
    handleAuditRecord(args, auditPath);
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
  const options = { offline: false, verbose: false, force: false, all: false, check: false };
  for (const arg of args) {
    if (arg === '--offline') options.offline = true;
    if (arg === '--verbose') options.verbose = true;
    if (arg === '--force') options.force = true;
    if (arg === '--all') options.all = true;
    if (arg === '--check') options.check = true;
  }
  return options;
}

main();