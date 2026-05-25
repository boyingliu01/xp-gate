#!/usr/bin/env node
const { init } = require('../lib/init.js');
const { installSkill } = require('../lib/install-skill.js');
const { updateSkill } = require('../lib/update-skill.js');
const { uninstallSkill } = require('../lib/uninstall-skill.js');
const { checkDeps } = require('../lib/detect-deps.js');

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
    usage: 'xp-gate install-skill <name>[@<version>] [--offline] [--verbose] [--force]'
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
    const args = command === 'setup-global' ? ['--global'] : subargs;
    init(args).then(code => process.exit(code));
    return;
  }
  
  if (command === 'install-skill') {
    const name = subargs[0];
    if (!name) {
      console.error('Error: Skill name required');
      console.error('Usage: xp-gate install-skill <name>[@<version>]');
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
  
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
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