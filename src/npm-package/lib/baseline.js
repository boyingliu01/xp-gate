/**
 * baseline.js — `xp-gate baseline` CLI handler
 *
 * Manages per-project lint baselines stored in .xp-gate/lint-baseline.json.
 *
 * Commands:
 *   xp-gate baseline create    — Full-repo scan → save baseline
 *   xp-gate baseline show      — Display current baseline
 *   xp-gate baseline reset     — Force re-scan and replace baseline
 *   xp-gate baseline diff      — Diff current state against stored baseline
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getXpGateDir() {
  return path.join(process.cwd(), '.xp-gate');
}

function getBaselineFile() {
  return path.join(getXpGateDir(), 'lint-baseline.json');
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function parseArgs(subargs) {
  return {
    tool: subargs[0] || null,
    rest: subargs.slice(1),
  };
}

/**
 * Run a lint tool and return its JSON output.
 */
function runToolJson(toolCmd, pipeToJsonFlag) {
  try {
    const cmd = `${toolCmd} ${pipeToJsonFlag}`;
    return execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
  } catch (e) {
    // Lint tools exit non-zero when they find issues - that's expected
    if (e.stdout) return e.stdout.trim();
    return '';
  }
}

/**
 * Collect all source files for a given language.
 */
function findFilesByExt(extensions) {
  try {
    const patterns = extensions.map(e => `"**/*${e}"`).join(' ');
    const result = execSync(`git ls-files ${patterns}`, {
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
    }).trim();
    return result ? result.split('\n') : [];
  } catch {
    return [];
  }
}

/**
 * Create baseline: scan all source files with available lint tools.
 * Called by: xp-gate baseline create|reset
 */
async function createBaseline() {
  ensureDir(getXpGateDir());

  const baseline = {};

  // TypeScript/JavaScript — ESLint
  const tsFiles = findFilesByExt(['.ts', '.tsx', '.js', '.jsx']);
  if (tsFiles.length > 0) {
    try {
      const eslintConfigExists = fs.existsSync('.eslintrc.json') ||
        fs.existsSync('.eslintrc.js') ||
        fs.existsSync('.eslintrc.cjs') ||
        fs.existsSync('eslint.config.js');
      const eslintBin = fs.existsSync('node_modules/.bin/eslint') ? 'node_modules/.bin/eslint' : null;

      if (eslintConfigExists && (eslintBin || execSync('npx eslint --version', { encoding: 'utf8' }))) {
        const eslintCmd = eslintBin || 'npx eslint';
        const output = runToolJson(`${eslintCmd} ${tsFiles.join(' ')}`, '-f json --no-warn-ignored');
        if (output && output !== '[]') {
          const parsed = JSON.parse(output);
          for (const fileResult of parsed) {
            const relativePath = fileResult.filePath;
            const fileName = tsFiles.find(f => relativePath.endsWith(f));
            if (!fileName) continue;

            baseline[fileName] = {
              eslint: {
                warnings: fileResult.warningCount || 0,
                errors: fileResult.errorCount || 0,
              },
              totalWarnings: fileResult.warningCount || 0,
              lastAnalyzed: new Date().toISOString(),
            };
          }
        }
      }
    } catch {
      // ESLint unavailable — skip
    }
  }

  // Python — ruff
  const pyFiles = findFilesByExt(['.py']);
  if (pyFiles.length > 0) {
    try {
      execSync('ruff --version', { encoding: 'utf8' });
      const output = runToolJson(`ruff check ${pyFiles.join(' ')}`, '--output-format json');
      if (output && output !== '[]') {
        const parsed = JSON.parse(output);
        for (const fileResult of parsed) {
          if (!baseline[fileResult.file]) {
            const messages = fileResult.messages || [];
            baseline[fileResult.file] = {
              ruff: { warnings: messages.length, errors: 0 },
              totalWarnings: messages.length,
              lastAnalyzed: new Date().toISOString(),
            };
          } else {
            const messages = fileResult.messages || [];
            baseline[fileResult.file].ruff = { warnings: messages.length, errors: 0 };
            baseline[fileResult.file].totalWarnings += messages.length;
          }
        }
      }
    } catch {
      // Ruff unavailable — skip
    }
  }

  // Go — golangci-lint
  const goFiles = findFilesByExt(['.go']);
  if (goFiles.length > 0) {
    try {
      execSync('golangci-lint --version', { encoding: 'utf8' });
      const output = runToolJson('golangci-lint run', '--out-format json');
      if (output) {
        const parsed = JSON.parse(output).Issues || [];
        const warningsByFile = {};
        for (const issue of parsed) {
          const matchedFile = goFiles.find(f => issue.file.endsWith(f));
          if (!matchedFile) continue;
          if (!warningsByFile[matchedFile]) {
            warningsByFile[matchedFile] = { warnings: 0, errors: 0 };
          }
          if (issue.severity === 'error') {
            warningsByFile[matchedFile].errors++;
          } else {
            warningsByFile[matchedFile].warnings++;
          }
        }
        for (const [file, counts] of Object.entries(warningsByFile)) {
          if (baseline[file]) {
            baseline[file].golangci = counts;
            baseline[file].totalWarnings += counts.warnings;
          } else {
            baseline[file] = {
              golangci: counts,
              totalWarnings: counts.warnings,
              lastAnalyzed: new Date().toISOString(),
            };
          }
        }
      }
    } catch {
      // golangci-lint unavailable — skip
    }
  }

  // Shell — shellcheck
  const shFiles = findFilesByExt(['.sh']);
  if (shFiles.length > 0) {
    try {
      execSync('shellcheck --version', { encoding: 'utf8' });
      const output = runToolJson(`shellcheck -f json ${shFiles.join(' ')}`, '');
      if (output && output !== '[]') {
        const parsed = JSON.parse(output);
        const warningsByFile = {};
        for (const item of parsed) {
          const matchedFile = shFiles.find(f => item.file.endsWith(f));
          if (!matchedFile) continue;
          if (!warningsByFile[matchedFile]) {
            warningsByFile[matchedFile] = { warnings: 0, errors: 0 };
          }
          if (item.level === 'error') {
            warningsByFile[matchedFile].errors++;
          } else {
            warningsByFile[matchedFile].warnings++;
          }
        }
        for (const [file, counts] of Object.entries(warningsByFile)) {
          if (baseline[file]) {
            baseline[file].shellcheck = counts;
            baseline[file].totalWarnings += counts.warnings;
          } else {
            baseline[file] = {
              shellcheck: counts,
              totalWarnings: counts.warnings,
              lastAnalyzed: new Date().toISOString(),
            };
          }
        }
      }
    } catch {
      // shellcheck unavailable — skip
    }
  }

  fs.writeFileSync(getBaselineFile(), JSON.stringify(baseline, null, 2));
  return baseline;
}

/**
 * Show current baseline.
 */
function showBaseline() {
  if (!fs.existsSync(getBaselineFile())) {
    console.log('No baseline found. Run `xp-gate baseline create` to initialize.');
    return 1;
  }

  const data = JSON.parse(fs.readFileSync(getBaselineFile(), 'utf8'));
  const files = Object.keys(data);

  if (files.length === 0) {
    console.log('Baseline is empty (no lint issues found on last scan).');
    return 0;
  }

  const totalWarnings = files.reduce((s, f) => s + data[f].totalWarnings, 0);
  let eslintCount = 0;
  let ruffCount = 0;
  let golangciCount = 0;
  let shellcheckCount = 0;

  for (const entry of Object.values(data)) {
    if (entry.eslint) eslintCount++;
    if (entry.ruff) ruffCount++;
    if (entry.golangci) golangciCount++;
    if (entry.shellcheck) shellcheckCount++;
  }

  console.log('Lint Baseline:');
  console.log(`  Created: ${data[files[0]]?.lastAnalyzed?.slice(0, 10) || 'N/A'}`);
  console.log(`  Files tracked: ${files.length}`);
  console.log(`  Total warnings: ${totalWarnings}`);
  if (eslintCount > 0) console.log(`  ESLint: ${eslintCount} files`);
  if (ruffCount > 0) console.log(`  Ruff: ${ruffCount} files`);
  if (golangciCount > 0) console.log(`  golangci-lint: ${golangciCount} files`);
  if (shellcheckCount > 0) console.log(`  ShellCheck: ${shellcheckCount} files`);

  return 0;
}

/**
 * Reset baseline: force re-scan and replace.
 */
async function resetBaseline() {
  const baseline = await createBaseline();
  console.log(`Baseline reset. ${Object.keys(baseline).length} files tracked.`);
  return 0;
}

/**
 * Diff current lint state against stored baseline.
 */
async function diffBaseline() {
  if (!fs.existsSync(getBaselineFile())) {
    console.log('No baseline found. Run `xp-gate baseline create` first.');
    return 1;
  }

  const oldBaseline = JSON.parse(fs.readFileSync(getBaselineFile(), 'utf8'));
  const currentBaseline = await createBaseline();

  const allFiles = new Set([
    ...Object.keys(oldBaseline),
    ...Object.keys(currentBaseline),
  ]);

  let totalWarningsDelta = 0;
  const increased = [];
  const decreased = [];
  const added = [];
  const removed = [];

  for (const file of allFiles) {
    const oldW = oldBaseline[file]?.totalWarnings || 0;
    const newW = currentBaseline[file]?.totalWarnings || 0;
    const delta = newW - oldW;

    totalWarningsDelta += delta;

    if (!oldBaseline[file] && currentBaseline[file]) {
      added.push(`  + ${file} (${newW} warnings)`);
    } else if (oldBaseline[file] && !currentBaseline[file]) {
      removed.push(`  - ${file} (all ${oldW} warnings cleared)`);
    } else if (delta > 0) {
      increased.push(`  ↑ ${file} (${oldW} → ${newW}, +${delta})`);
    } else if (delta < 0) {
      decreased.push(`  ↓ ${file} (${oldW} → ${newW}, ${delta})`);
    }
  }

  console.log('Lint Baseline Diff:');
  console.log(`  Total warnings delta: ${totalWarningsDelta >= 0 ? '+' : ''}${totalWarningsDelta}`);

  if (added.length > 0) {
    console.log(`\nFiles added (${added.length}):`);
    added.forEach(l => console.log(l));
  }
  if (removed.length > 0) {
    console.log(`\nFiles removed (${removed.length}):`);
    removed.forEach(l => console.log(l));
  }
  if (increased.length > 0) {
    console.log(`\nWarnings increased (${increased.length}):`);
    increased.forEach(l => console.log(l));
  }
  if (decreased.length > 0) {
    console.log(`\nWarnings decreased (${decreased.length}):`);
    decreased.forEach(l => console.log(l));
  }

  if (added.length === 0 && removed.length === 0 && increased.length === 0 && decreased.length === 0) {
    console.log('  No change from baseline.');
  }

  return totalWarningsDelta > 0 ? 1 : 0;
}

/**
 * Main handler called from xp-gate CLI.
 * @param {string[]} subargs CLI sub-arguments
 * @returns {Promise<number>} exit code
 */
async function handleBaseline(subargs) {
  const { tool, rest } = parseArgs(subargs);

  switch (tool) {
    case 'create':
      console.log('Creating lint baseline...');
      const created = await createBaseline();
      console.log(`✅ Baseline created — ${Object.keys(created).length} files tracked.`);
      return 0;

    case 'show':
      return showBaseline();

    case 'reset':
      console.log('Resetting lint baseline...');
      return resetBaseline();

    case 'diff':
      return diffBaseline();

    case 'help':
    case '--help':
    case null:
      console.log(`Usage: xp-gate baseline <subcommand>

Subcommands:
  create    Scan all source files and save lint baseline
  show      Display current lint baseline summary
  reset     Force re-scan and replace baseline
  diff      Compare current lint state against baseline

Examples:
  xp-gate baseline create
  xp-gate baseline show
  xp-gate baseline reset
  xp-gate baseline diff`);
      return 0;

    default:
      console.error(`Unknown baseline subcommand: ${tool}`);
      console.error('Run `xp-gate baseline --help` for usage.');
      return 1;
  }
}

module.exports = { handleBaseline, createBaseline, showBaseline, resetBaseline, diffBaseline };
