#!/usr/bin/env node
const path = require('path');
const { init } = require('../lib/init.js');
const { delphiSetup } = require('../lib/delphi-setup.js');
const { installSkill } = require('../lib/install-skill.js');
const { updateSkill } = require('../lib/update-skill.js');
const { uninstallSkill } = require('../lib/uninstall-skill.js');
const { uninstall } = require('../lib/uninstall.js');
const { doctor } = require('../lib/doctor.js');
const { parseSkillFlags, SKILL_FLAGS_BY_COMMAND } = require('../lib/shared-utils.js');
const { checkDeps } = require('../lib/detect-deps.js');
const { migrate } = require('../lib/migrate.js');
const { handleBaseline } = require('../lib/baseline.js');
const { check } = require('../lib/check.js');
const { principles } = require('../lib/principles.js');
const { arch } = require('../lib/arch.js');
const { upgrade } = require('../lib/upgrade.js');
const { bootstrap } = require('../lib/bootstrap.js');
const { updateHooks } = require('../lib/update-hooks.js');
const gateRunner = require('../lib/gate-runner.js');

// #392-#6: a user-supplied path embedded in a shell command string lets cmd.exe
// interpret metacharacters (& | ^ < > % ! " and newline) and execute injected
// commands. On POSIX a bare spawn (shell:false) passes argv as discrete,
// uninterpreted bytes, so nothing is injectable. On win32 a `.cmd` wrapper such
// as npx.cmd cannot be launched without a shell (CreateProcess raises EINVAL),
// so we must shell out through cmd.exe -- and we only do so AFTER rejecting any
// argument that carries a cmd metacharacter. Rejection, not escaping, is the
// safe defense: a path containing a metachar is refused outright rather than
// risk a quoting mistake. This guard must stay in front of every launcher.
// \r joins \n: cmd treats a stray carriage return as a command separator too
// (Delphi walkthrough R1, MN-01).
const CMD_METACHAR_RE = /[&|^<>%!"\n\r]/;

// The ONLY place a child process may be launched with an engaged shell.
// Named so a static grep stays readable, and pinned by check-alignment-cli
// .test.mjs: no other launcher in this file may enable a shell.
const SHELL_ON_WINDOWS_ONLY = process.platform === 'win32';

function firstUnsafeArg(argv) {
  for (const arg of argv) {
    if (typeof arg === 'string' && CMD_METACHAR_RE.test(arg)) return arg;
  }
  return undefined;
}

function quoteForCmdShell(arg) {
  // With an engaged shell node concatenates file+args into one cmd.exe command
  // string WITHOUT quoting (DEP0190), so an argument carrying a space would
  // split into multiple argv elements downstream. Double-quoting is safe here
  // ONLY because every caller has already run firstUnsafeArg: the character "
  // that could break out of the quote is on the rejection list.
  return `"${arg}"`;
}

function spawnNpx(tsxArgs) {
  const { spawnSync } = require('child_process');
  // Reject any user-supplied argument that could be interpreted by cmd.exe.
  // Every element of tsxArgs beyond the fixed tokens (-y tsx <script>) is a
  // user path; a metachar there is refused, not quoted, per #392-#6.
  const unsafe = firstUnsafeArg(tsxArgs);
  if (unsafe) {
    console.error(`check-alignment: refusing path containing a shell metacharacter: ${unsafe}`);
    return { status: 1 };
  }
  const isWin = process.platform === 'win32';
  // The shell engages on win32 only, and is only safe because every user
  // argument above is guaranteed metachar-free; each token additionally gets
  // cmd quoting so spaces survive (see quoteForCmdShell).
  // Guarded IO: a failed spawn must surface as a result, not crash the CLI.
  const argv = ['-y', 'tsx', ...tsxArgs];
  let result;
  try {
    result = spawnSync(isWin ? 'npx.cmd' : 'npx', isWin ? argv.map(quoteForCmdShell) : argv, {
      stdio: 'inherit',
      shell: SHELL_ON_WINDOWS_ONLY,
    });
  } catch (err) {
    return { status: 1, error: err };
  }
  return result || { status: 1 };
}

function handleUIReview() {
  const uiReviewPath = path.join(__dirname, '..', 'lib', 'ui-review.ts');
  const result = spawnNpx([uiReviewPath]);
  process.exitCode = result.error ? 1 : (result.status === 0 ? 0 : 1);
}

function runAlignmentInProcess(specPath, testDirs, outputPath, jsonMode, runFullAlignment) {
  const { execFileSync } = require('child_process');
  if (!runFullAlignment) {
    // Loaded lazily by the caller inside the tsx guard; kept optional so an
    // in-repo direct call still works.
    ({ runFullAlignment } = require('../lib/test-alignment.ts'));
  }
  let headCommit = 'unknown';
  try {
    headCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() || 'unknown';
  } catch (err) {
    headCommit = 'unknown';
  }
  let report;
  try {
    report = runFullAlignment({
      specPath,
      testDirs: testDirs || undefined,
      headCommit,
      outputPath: outputPath || undefined,
    });
  } catch (err) {
    console.error('check-alignment failed:', err instanceof Error ? err.message : String(err));
    return 1;
  }
  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('Status:', report.alignment_status);
    console.log('Score:', report.score);
    console.log('Misaligned:', report.misaligned_tests.length);
  }
  // exitCode-style contract (#392 review): never process.exit() right after a
  // JSON print — buffered stdout must flush. Returning the code and letting the
  // dispatcher end the turn naturally is what keeps --json output complete.
  return report.alignment_status === 'PASS' ? 0 : 1;
}

function runAlignmentViaNpx(runnerPath, specPath, testDirs, outputPath, jsonMode) {
  // User-supplied paths travel as discrete argv elements routed through
  // spawnNpx, which refuses any argument carrying a cmd metacharacter before a
  // shell can see it (#392-#6). The runner script path is a fixed internal path.
  const argv = [runnerPath, '--spec', specPath];
  if (testDirs) argv.push('--tests', testDirs[0]);
  if (outputPath) argv.push('--output', outputPath);
  if (jsonMode) argv.push('--json');
  const result = spawnNpx(argv);
  if (result.error) {
    console.error('check-alignment: unable to load the alignment engine (tsx unavailable).');
    console.error(result.error.message);
    return 1;
  }
  return result.status === 0 ? 0 : 1;
}

async function runAlignmentCheck(subargs) {
  const specIdx = subargs.indexOf('--spec');
  const specPath = specIdx >= 0 ? subargs[specIdx + 1] : path.join(process.cwd(), 'specification.yaml');

  const testsIdx = subargs.indexOf('--tests');
  const testDirs = testsIdx >= 0 ? [subargs[testsIdx + 1]] : undefined;

  const outputIdx = subargs.indexOf('--output');
  const outputPath = outputIdx >= 0 ? subargs[outputIdx + 1] : undefined;

  const jsonMode = subargs.includes('--json');

  // Injection guard (#392-#6) runs BEFORE any launcher, including the
  // in-process fast path: a metachar path must be refused identically on both
  // platforms (Delphi walkthrough R1, MJ-02 — behavioral, not shape-only).
  for (const value of [specPath, ...(testDirs || []), outputPath].filter(v => v !== undefined)) {
    const unsafe = firstUnsafeArg([value]);
    if (unsafe) {
      console.error(`check-alignment: refusing path containing a shell metacharacter: ${unsafe}`);
      return 1;
    }
  }

  const runnerPath = path.join(__dirname, '..', 'lib', 'check-alignment-runner.cjs');

  // Primary: run the engine in-process via tsx/cjs (fast path, works in-repo
  // where tsx is a devDependency). Fall back to `npx -y tsx` when tsx is not
  // resolvable, which happens in the published global install (the package
  // ships zero runtime deps per the zero-install contract). npx self-provisions
  // tsx on demand, so the published command stays functional without adding a dep.
  //
  // The try guards ONLY the tsx loader's module-load step. The engine call sits
  // outside it: an engine-level failure is a real bug that must surface, not be
  // silently swallowed and misattributed to "tsx unavailable" by the fallback.
  // Delphi walkthrough R2 CI-02: require('../lib/test-alignment.ts') also needs
  // the loader, so it belongs INSIDE the guard — if the .ts file itself cannot
  // load, the npx fallback re-attempts it under a provisioned tsx instead of
  // crashing with an unhandled exception. Engine EXECUTION stays outside.
  let runFullAlignment;
  try {
    require('tsx/cjs');
    ({ runFullAlignment } = require('../lib/test-alignment.ts'));
  } catch (err) {
    if (!err || (err.code !== 'MODULE_NOT_FOUND' && !/Cannot find module/.test(String(err && err.message)))) {
      throw err;
    }
    return runAlignmentViaNpx(runnerPath, specPath, testDirs, outputPath, jsonMode);
  }
  return runAlignmentInProcess(specPath, testDirs, outputPath, jsonMode, runFullAlignment);
}

const COMMANDS = {
  'init': {
    description: 'Initialize xp-gate (use --global for all projects)',
    run: subargs => init(subargs).then(code => process.exit(code)),
    usage: 'xp-gate init [--global] [--yes]'
  },
  'setup-global': {
    description: 'Set up xp-gate globally for all git projects',
    run: () => init(['--global']).then(code => process.exit(code)),
    usage: 'xp-gate setup-global'
  },
  'delphi-setup': {
    description: 'Rebind the three Qoder Delphi expert agents to distinct built-in models (#414)',
    run: subargs => delphiSetup(subargs).then(code => process.exit(code)),
    usage: 'xp-gate delphi-setup --model architecture=<id> --model technical=<id> --model feasibility=<id> [--global|--local --project <dir>]'
  },
  'install-skill': {
    description: 'Install a xp-gate skill from the package bundle',
    run: subargs => {
      const name = subargs[0];
      if (!name) {
        console.error('Error: Skill name required');
        console.error('Usage: xp-gate install-skill <name> [--verbose] [--force]');
        process.exit(1);
      }
      const options = parseOptions(subargs.slice(1), 'install-skill');
      installSkill(name, options).then(code => process.exit(code));
    },
    usage: 'xp-gate install-skill <name> [--verbose] [--force]'
  },
  'update-skill': {
    description: 'Update installed skill(s)',
    run: subargs => {
      // Detect --all flag BEFORE extracting name (fix #347)
      const allFlagIndex = subargs.indexOf('--all');
      let name, options;
      if (allFlagIndex !== -1) {
        // Remove --all from args before parsing, name is undefined
        options = parseOptions([...subargs.slice(0, allFlagIndex), ...subargs.slice(allFlagIndex + 1)], 'update-skill');
        options.all = true;
        name = undefined;  // explicit: no single name when --all is used
      } else {
        name = subargs[0];
        options = parseOptions(subargs.slice(1), 'update-skill');
      }
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
      const options = parseOptions(subargs.slice(1), 'uninstall-skill');
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
    run: subargs => {
      // `xp-gate doctor delphi` is a dedicated chain diagnosis (#414 REQ-3),
      // not a flag of the generic doctor run.
      if (subargs[0] === 'delphi') {
        const { doctorDelphi } = require('../lib/doctor.js');
        return doctorDelphi({}).then(code => process.exit(code));
      }
      return doctor(subargs).then(code => process.exit(code));
    },
    usage: 'xp-gate doctor [--fix [--install-tools] | --sync-hooks [--force] | --refresh-env] | --json | --format json  (the two machine-readable modes print one JSON document and refuse --fix/--sync-hooks; --refresh-env is read-only so it combines with them)'
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
    description: 'Run quality gates (--list, --all, --gates <ids>, or <gate-id>)',
    run: subargs => check(subargs).then(code => process.exit(code)),
    usage: 'xp-gate check <file_or_directory|gate_number> [--gates gates] [--all] [--list]'
  },
  'principles': {
    description: 'Run Clean Code + SOLID principles checker (Gate 4 standalone)',
    run: subargs => principles(subargs).then(code => process.exit(code)),
    usage: 'xp-gate principles <file_or_directory> [--format console|json|sarif]'
  },
  'arch': {
    description: 'Run architecture validation (Gate 6 standalone; built-in rules, baseline ratchet when .architecture-baseline.json exists)',
    run: subargs => arch(subargs).then(code => process.exit(code)),
    usage: 'xp-gate arch [--use-config <path>]  (default: pinned local @archlinter/cli built-in rules; --use-config is the opt-in legacy config path)'
  },
  'check-alignment': {
    description: 'Run test-specification alignment check (deterministic, no LLM)',
    run: subargs => runAlignmentCheck(subargs).then(code => {
      // exitCode, not process.exit(): the in-process --json document must flush
      // its buffered stdout before the process ends (#392 review, MJ-01).
      process.exitCode = code;
    }).catch(err => {
      // A quality gate must fail with a deterministic exit code and a real
      // message — never an unhandled rejection whose code depends on Node's
      // default mode (Delphi walkthrough R2, MJ-02).
      console.error('check-alignment: unexpected failure:', err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }),
    usage: 'xp-gate check-alignment [--spec <path>] [--tests <dir>] [--json] [--output <path>]'
  },
  'upgrade': {
    description: 'Check for xp-gate updates (--preview for JSON, --apply to upgrade)',
    run: subargs => upgrade(subargs).then(code => process.exit(code)),
    usage: 'xp-gate upgrade [--preview] [--apply]'
  },
  'bootstrap': {
    description: 'Install CLI tools required by quality gates. Also invoked by "xp-gate init --yes"',
    run: subargs => process.exit(bootstrap(subargs)),
    usage: 'xp-gate bootstrap [--dry-run] [--verbose]'
  },
  'sprint-status': {
    description: 'Show Sprint Flow progress (reads .sprint-state/sprint-state.json)',
    run: subargs => {
      const { handleSprintStatus } = require('../lib/sprint-status.js');
      handleSprintStatus(subargs).then(code => process.exit(code));
    },
    usage: 'xp-gate sprint-status [--json] [--watch] [--dir <path>] [--rework-check] [--window-days N]'
  },
  'retro': {
    description: 'Generate sprint engineering retrospective (#369)',
    run: subargs => {
      const { handleRetro } = require('../lib/retro.js');
      handleRetro(subargs).then(code => process.exit(code));
    },
    usage: 'xp-gate retro [--days N] [--all] [--json] [--sprint <id>]'
  },
  'crap': {
    description: 'Rank functions by CRAP score (complexity x weak coverage) — advisory, never blocks (#404)',
    run: subargs => {
      const { handleCrap } = require('../lib/crap-cli.js');
      handleCrap(subargs).then(code => process.exit(code));
    },
    usage: 'xp-gate crap [--top N] [--threshold N] [--json] [--paths <p...>] [--include-mirrors]'
  },
  'sprint-init': {
    description: 'Initialize sprint state (single entry point for sprint creation, resolves #366)',
    run: subargs => {
      const { handleSprintInit } = require('../lib/sprint-init.js');
      handleSprintInit(subargs).then(code => process.exit(code));
    },
    usage: 'xp-gate sprint-init "<task_description>" [--issues "<#123>"] [--force] [--dry-run] [--dir <path>]'
  },
  'next-sprint': {
    description: 'Analyze remaining open issues and plan next iteration',
    run: subargs => {
      const { handleNextSprint } = require('../lib/next-sprint.js');
      handleNextSprint(subargs).then(code => process.exit(code));
    },
    usage: 'xp-gate next-sprint [--json] [--plan] [--dir <path>]'
  },
  'update-hooks': {
    description: 'Sync latest hooks from xp-gate package to project',
    run: subargs => {
      const scopeArg = subargs.find(a => a.startsWith('--scope='));
      const scopeVal = scopeArg ? scopeArg.split('=')[1] : 'all';
      const options = {
        global: subargs.includes('--global'),
        force: subargs.includes('--force'),
        dryRun: subargs.includes('--dry-run'),
        noBackup: subargs.includes('--no-backup'),
        scope: scopeVal,
      };
      try {
        process.exit(updateHooks(options));
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    },
    usage: 'xp-gate update-hooks [--global] [--force] [--dry-run] [--no-backup] [--scope hooks|adapters|all]'
  },
  'install': {
    description: 'One-step install (init + baseline + bootstrap + doctor --fix)',
    run: subargs => {
      const { install } = require('../lib/install-cmd');
      install(subargs).then(code => process.exit(code));
    },
    usage: 'xp-gate install [--global]'
  },
  'gate-list': {
    description: 'List all quality gates and their availability',
    run: subargs => check(['--list']).then(code => process.exit(code)),
    usage: 'xp-gate gate-list'
  },
  'gate-all': {
    description: 'Run all invokable quality gates',
    run: subargs => check(['--all', ...subargs]).then(code => process.exit(code)),
    usage: 'xp-gate gate-all [<path>]'
  },
  'phase-transition': {
    description: 'Transition sprint phase + auto-render dashboard (resolves #338)',
    run: subargs => {
      const { handlePhaseTransition } = require('../lib/phase-transition.js');
      handlePhaseTransition(subargs).then(code => process.exit(code));
    },
    usage: 'xp-gate phase-transition <phase> <status> [--render] [--outputs <json>]'
  },
  'sprint-audit': {
    description: 'Final sprint completeness audit (Phase 6 CLOSE)',
    run: subargs => {
      const { handleSprintAudit } = require('../lib/sprint-audit.js');
      handleSprintAudit(subargs).then(code => process.exit(code));
    },
    usage: 'xp-gate sprint-audit [--dir <path>] [--json]'
  },
  'detect-languages': {
    description: 'Detect project languages and generate .xp-gate-config.json',
    run: subargs => {
      const { handleDetectLanguages } = require('../lib/language-tools.js');
      handleDetectLanguages(subargs).then(code => process.exit(code));
    },
    usage: 'xp-gate detect-languages [--json] [--write]'
  },
  'check-tools': {
    description: 'Check quality gate tool availability per language',
    run: subargs => {
      const { handleCheckTools } = require('../lib/language-tools.js');
      handleCheckTools(subargs).then(code => process.exit(code));
    },
    usage: 'xp-gate check-tools [--languages <langs>] [--json]'
  },
  'install-tools': {
    description: 'Install missing quality gate tools for detected languages',
    run: subargs => {
      const { handleInstallTools } = require('../lib/language-tools.js');
      handleInstallTools(subargs).then(code => process.exit(code));
    },
    usage: 'xp-gate install-tools [--languages <langs>] [--dry-run] [--yes]'
  }
};

for (let i = 0; i <= 11; i++) {
  const gateId = String(i);
  const gateInfo = gateRunner.GATE_REGISTRY[gateId];
  COMMANDS[`gate-${gateId}`] = {
    description: `Run Gate ${gateId}: ${gateInfo?.name || 'Unknown'}`,
    run: subargs => gateRunner.runGate(gateId, subargs[0]).then(code => process.exit(code)),
    usage: `xp-gate gate-${gateId} [<path>]`
  };
}

// Named utility gates (analytics/report tools)
for (const gateId of ['python-health', 'test-layers', 'pbt']) {
  const gateInfo = gateRunner.GATE_REGISTRY[gateId];
  if (gateInfo) {
    COMMANDS[gateId] = {
      description: gateInfo.description,
      run: subargs => gateRunner.runGate(gateId, subargs[0]).then(code => process.exit(code)),
      usage: `xp-gate ${gateId} [<path>]`
    };
  }
}

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

function parseOptions(args, command) {
  const { options, unknown } = parseSkillFlags(args, command);
  if (unknown.length > 0) {
    console.error(`Unknown argument(s) for ${command}: ${unknown.join(', ')}`);
    console.error(`Supported flags: ${(SKILL_FLAGS_BY_COMMAND[command] || []).join(', ') || '(none)'}`);
    process.exit(1);
  }
  return options;
}

main();