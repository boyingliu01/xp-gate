'use strict';

/**
 * `xp-gate crap` — advisory CRAP hotspot ranking (#404 P1-2).
 *
 * Prints the functions whose CRAP score is at or above the bar, worst first.
 * This is a NAVIGATION aid: it exits 0 whatever it finds, because the indicator
 * depends on coverage that 21.8% of this repo's source files do not have (see
 * crap.js). A ranking that cannot measure a fifth of its population must not
 * be allowed to fail a build.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  buildCrapReport,
  joinCoverage,
  readFileCoverage,
  parseLizardCsv,
} = require('./crap.js');

const USAGE = `Usage: xp-gate crap [options]

Rank functions by CRAP score = CCN^2 * (1 - coverage) + CCN, worst first.
ADVISORY ONLY: never blocks, always exits 0.

Options:
  --top N            show at most N hotspots (default 20)
  --threshold N      CRAP bar; functions at or above it are listed (default 6)
  --json             machine-readable output
  --coverage <file>  istanbul coverage-final.json (default coverage/coverage-final.json)
  --paths <p...>     directories to scan (default src)
  --include-mirrors  also rank src/npm-package/** (overwritten at publish)
  -h, --help         show this help

Unmeasured = the function's file was never loaded by any test, so coverage is
unknown. Those functions are counted, not scored. Treating them as 0% would put
every untested file at the top of the ranking; treating them as 100% would hide
them.
`;

function parseArgs(argv) {
  const opts = {
    top: 20,
    threshold: 6,
    json: false,
    coverage: path.join(process.cwd(), 'coverage', 'coverage-final.json'),
    paths: ['src'],
    includeMirrors: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--top':
        opts.top = Number(argv[++i]);
        break;
      case '--threshold':
        opts.threshold = Number(argv[++i]);
        break;
      case '--json':
        opts.json = true;
        break;
      case '--coverage':
        opts.coverage = argv[++i];
        break;
      case '--include-mirrors':
        opts.includeMirrors = true;
        break;
      case '--paths': {
        opts.paths = [];
        while (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
          opts.paths.push(argv[++i]);
        }
        break;
      }
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        break;
    }
  }
  return opts;
}

/** Run lizard and return its CSV. Missing lizard is not an error for a
 *  navigation command: the caller reports that it could not measure. */
function runLizard(paths) {
  try {
    return execFileSync('lizard', ['--csv', '-C', '99999', ...paths], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (err) {
    // lizard exits non-zero when it cannot scan everything; its stdout is still
    // usable. Anything else (ENOENT) means no data at all.
    if (err && typeof err.stdout === 'string' && err.stdout.length) return err.stdout;
    return null;
  }
}

function formatRow(hotspot) {
  const crap = hotspot.crap.toFixed(1).padStart(8);
  const ccn = String(hotspot.ccn).padStart(4);
  const cov = `${Math.round(hotspot.cov * 100)}%`.padStart(4);
  return `  ${crap}  CCN ${ccn}  cov ${cov}  ${hotspot.file}  ${hotspot.name}`;
}

function render(report, opts) {
  const lines = [];
  lines.push('━━━ CRAP hotspot ranking (advisory, never blocks) ━━━');

  if (!report.measured && !report.unmeasured) {
    lines.push('');
    lines.push('No functions found. Check that lizard is installed and --paths points at real code:');
    lines.push(`  lizard --csv -C 99999 ${opts.paths.join(' ')}`);
    return lines.join('\n');
  }

  lines.push('');
  lines.push(
    `measured ${report.measured} functions, ${report.unmeasured} unmeasured (no coverage for their file)`
  );
  lines.push(`CRAP >= ${report.threshold}: ${report.hotspots.length} shown`);

  if (!report.hotspots.length) {
    lines.push('');
    lines.push(`✅ Nothing at or above CRAP ${report.threshold}.`);
    return lines.join('\n');
  }

  lines.push('');
  lines.push('  CRAP      complexity coverage  location');
  const dash = '  ' + '─'.repeat(74);
  lines.push(dash);
  for (const hotspot of report.hotspots) lines.push(formatRow(hotspot));
  lines.push(dash);
  lines.push('');
  lines.push('Navigation aid: pick from the top. This does not replace security,');
  lines.push('performance or architecture review, and score-chasing is not a goal.');
  return lines.join('\n');
}

async function handleCrap(argv) {
  const opts = parseArgs(argv);

  if (opts.help) {
    console.log(USAGE);
    return 0;
  }

  const csv = runLizard(opts.paths);
  if (csv === null) {
    console.error('✗ Could not run lizard. Install it with: pip install --user lizard');
    return 1;
  }

  if (!fs.existsSync(opts.coverage)) {
    console.error(`✗ No coverage artifact at ${opts.coverage}`);
    console.error('  Run the test suite with coverage first: npx vitest run --coverage');
    console.error('  (Without it every function is unmeasured, which is not a ranking.)');
    return 1;
  }

  const functions = parseLizardCsv(csv);
  const coverage = readFileCoverage(opts.coverage);
  const joined = joinCoverage(functions, coverage);

  const report = buildCrapReport(joined, {
    threshold: opts.threshold,
    top: opts.top,
    mirrors: opts.includeMirrors,
  });

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log(render(report, opts));
  // Advisory by construction: the ranking never changes the exit code.
  return 0;
}

module.exports = { handleCrap, parseArgs, render, runLizard };
