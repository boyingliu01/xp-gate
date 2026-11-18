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
// How many paths to pass to a linter in one call.
//
// A single argv built from every source file is not a style problem, it is a
// correctness one: this repo has 652 TS/JS files and the joined list measured
// 31,917 characters against a Windows limit around 8,191. The call always failed,
// the failure was swallowed, and the baseline recorded zero eslint entries -- so
// Gate 1 compared every TS/JS file against a baseline of nothing.
//
// 100 paths keeps the argv in the low thousands of characters even for deep
// paths, well clear of the limit on every platform.
const LINT_BATCH_SIZE = 100;

/**
 * Run a lint tool over a list of paths, in batches, and return its findings.
 *
 * Returns an object rather than a bare string so the caller can tell apart the
 * two states that used to be identical: "the tool ran and found nothing" versus
 * "the tool could not be evaluated". Collapsing them is how a baselining command
 * reports success while having measured nothing.
 *
 * @param {string[]} files project-relative paths
 * @param {(batch: string[]) => string} buildCmd builds the command line for a batch
 * @param {string} jsonFlag flag that makes the tool emit JSON on stdout
 * @returns {{results: any[], errors: string[]}} parsed per-batch results, or a
 *   list of failure messages. An empty `results` with a non-empty `errors` means
 *   "not evaluated", never "clean".
 */
function runLintInBatches(files, buildCmd, jsonFlag) {
  const results = [];
  const errors = [];

  for (let i = 0; i < files.length; i += LINT_BATCH_SIZE) {
    const batch = files.slice(i, i + LINT_BATCH_SIZE);
    let stdout;
    try {
      stdout = execSync(`${buildCmd(batch)} ${jsonFlag}`, {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (e) {
      // Non-zero exit is the tool's normal answer when it FOUND something, and
      // its stdout still carries the JSON. Only an empty stdout is a failure.
      stdout = e.stdout;
      if (!stdout || !String(stdout).trim()) {
        errors.push(formatToolFailure(e));
        continue;
      }
    }
    const trimmed = String(stdout).trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) results.push(...parsed);
    } catch {
      errors.push(`linter returned unparseable output for ${batch.length} file(s)`);
    }
  }

  return { results, errors };
}

/**
 * Resolve a tool installed in `node_modules/.bin` to something execSync can run.
 *
 * `fs.existsSync('node_modules/.bin/eslint')` is not enough on Windows, and the
 * path it returns cannot be executed there at all. Measured on this machine:
 *
 *   node_modules/.bin/eslint        -> cmd.exe reports "'node_modules' is not
 *                                      recognized" (a relative path is not an
 *                                      executable name to cmd)
 *   node node_modules/.bin/eslint   -> SyntaxError, because the extensionless
 *                                      entry is a POSIX sh wrapper
 *   node_modules/.bin/eslint.cmd    -> same "not recognized" failure
 *   absolute path to eslint.cmd     -> works (v10.3.0)
 *
 * So the resolution has to produce an ABSOLUTE path and pick the platform's
 * launcher: `.cmd` on Windows, the bare script elsewhere.
 *
 * @param {string} name tool name, e.g. 'eslint'
 * @param {string} [cwd] directory to resolve against
 * @returns {string|null} absolute path to an executable, or null
 */
function resolveLocalBin(name, cwd = process.cwd()) {
  const binDir = path.join(cwd, 'node_modules', '.bin');
  const candidates = process.platform === 'win32'
    ? [`${name}.cmd`, name]
    : [name];

  for (const candidate of candidates) {
    const full = path.join(binDir, candidate);
    try {
      if (fs.existsSync(full)) return full;
    } catch {
      // Unreadable candidate -- try the next one.
    }
  }
  return null;
}

/**
 * Format a resolved binary for use inside a shell command line.
 *
 * The path is quoted because node_modules can live under a directory with spaces
 * ("C:\Program Files\..."), which would otherwise split into several args.
 */
function quoteBin(bin) {
  return `"${bin}"`;
}

/** One-line reason a tool run failed, from the error object execSync threw. */
function formatToolFailure(err) {
  const stderr = err && err.stderr ? String(err.stderr).trim() : '';
  if (stderr) {
    // The Windows "command line is too long" case prints exactly this; naming it
    // is what turns an invisible defect into a one-line diagnosis.
    return stderr.split('\n')[0].trim();
  }
  const msg = err && err.message ? String(err.message) : 'unknown error';
  const status = err && typeof err.status === 'number' ? ` (exit ${err.status})` : '';
  return `${msg.split('\n')[0].trim()}${status}`;
}

/**
 * Report a linter that could not be evaluated.
 *
 * Silence is what let "TypeScript was never baselined" survive in this repo: the
 * command printed a cheerful "✅ Baseline created" while 652 files had contributed
 * nothing. A warning is the minimum contract -- the caller can still finish, but
 * the user is told which language went unmeasured and why.
 *
 * @param {string} tool
 * @param {string[]} errors
 */
function recordFailures(tool, errors) {
  if (!errors || errors.length === 0) return;
  const unique = [...new Set(errors)];
  const shown = unique.slice(0, 3).join('; ');
  const more = unique.length > 3 ? ` (+${unique.length - 3} more)` : '';
  console.warn(`⚠️  ${tool}: could not evaluate ${errors.length} batch(es) — ${shown}${more}`);
  console.warn(`   Files covered by a failed batch are absent from the baseline, not clean.`);
}

/**
 * Match a linter's reported path back to one of the files we asked about.
 *
 * Returns null rather than undefined when nothing matches. The previous version
 * used the result of `Array.prototype.find` as an object key, which stringifies
 * an unmatched lookup to the literal key "undefined" -- one bogus baseline entry
 * that made "71 files tracked" print for 70 real files.
 *
 * @param {string} reportedPath absolute or relative path from the tool
 * @param {string[]} candidates the files handed to the tool
 * @returns {string|null}
 */
function matchResultToFile(reportedPath, candidates) {
  if (!reportedPath) return null;
  const normalized = String(reportedPath).replace(/\\/g, '/');
  return candidates.find(f => normalized.endsWith(f)) || null;
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
      cwd: process.cwd(),
    }).trim();
    return result ? result.split('\n') : [];
  } catch {
    return [];
  }
}

// Git hooks carry no .sh extension, so an extension glob cannot see them -- and
// they are the largest shell programs in a gates repository. Same rule as the
// adapter (githooks/adapters/shell.sh): a file is a shell script when it has a
// shell extension OR a shell shebang.
const SHELL_HOOK_NAMES = [
  'pre-commit', 'pre-push', 'post-commit', 'post-merge',
  'post-checkout', 'commit-msg', 'prepare-commit-msg',
];

/**
 * Collect every shell script in the project: *.sh / *.bash plus git hooks,
 * matched at any depth. Mirrors `_shell_script_files()` in the shell adapter so
 * the baseline denominator and the gate numerator describe the same set --
 * a baseline that measures fewer files than the gate reports can only ever
 * conclude "debt unchanged".
 *
 * @returns {string[]} project-relative paths; empty when not in a git work tree
 */
function findShellScripts() {
  // Both lookups run with cwd=process.cwd() for the same reason `handleBaseline`
  // overrides process.cwd in tests: a bare execSync inherits the caller's cwd,
  // so outside a work tree it would walk up into whatever repository happens to
  // contain the temp directory and report that repo's files as this project's.
  const cwd = process.cwd();
  const byExt = findFilesByExt(['.sh', '.bash']).filter(f => !path.isAbsolute(f));
  const hookPatterns = SHELL_HOOK_NAMES
    .map(name => `"**/${name}" "${name}"`)
    .join(' ');

  let hooks = [];
  try {
    const result = execSync(`git ls-files ${hookPatterns}`, {
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
      cwd,
    }).trim();
    hooks = result ? result.split('\n') : [];
  } catch {
    hooks = [];
  }

  const seen = new Set();
  const files = [];
  for (const f of [...byExt, ...hooks]) {
    if (!f || seen.has(f)) continue;
    seen.add(f);
    files.push(f);
  }
  return files;
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
    const eslintConfigExists = fs.existsSync('.eslintrc.json') ||
      fs.existsSync('.eslintrc.js') ||
      fs.existsSync('.eslintrc.cjs') ||
      fs.existsSync('eslint.config.js');
    const eslintBin = resolveLocalBin('eslint');

    let eslintAvailable = Boolean(eslintBin);
    if (!eslintAvailable) {
      try {
        execSync('npx eslint --version', { encoding: 'utf8', stdio: 'pipe' });
        eslintAvailable = true;
      } catch {
        eslintAvailable = false;
      }
    }

    if (eslintConfigExists && eslintAvailable) {
      const eslintCmd = eslintBin ? quoteBin(eslintBin) : 'npx eslint';
      const { results, errors } = runLintInBatches(
        tsFiles,
        batch => `${eslintCmd} ${batch.map(f => `"${f}"`).join(' ')}`,
        '-f json --no-warn-ignored'
      );
      recordFailures('eslint', errors);
      for (const fileResult of results) {
        const fileName = matchResultToFile(fileResult.filePath, tsFiles);
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
    } else if (tsFiles.length > 0 && !eslintConfigExists) {
      // Not a failure: a project without an eslint config has nothing to
      // baseline. Staying quiet here is correct; the silent-catch defect was
      // about masking errors, not about projects that legitimately have no tool.
    }
  }

  // Python — ruff
  const pyFiles = findFilesByExt(['.py']);
  if (pyFiles.length > 0) {
    let ruffAvailable = false;
    try {
      execSync('ruff --version', { encoding: 'utf8', stdio: 'pipe' });
      ruffAvailable = true;
    } catch {
      ruffAvailable = false;
    }

    if (ruffAvailable) {
      const { results, errors } = runLintInBatches(
        pyFiles,
        batch => `ruff check ${batch.map(f => `"${f}"`).join(' ')}`,
        '--output-format json'
      );
      recordFailures('ruff', errors);
      for (const fileResult of results) {
        // A result that names no file cannot be recorded against one. Skipping it
        // is the fix for the literal "undefined" key this used to write.
        if (!fileResult.file) continue;
        const messages = fileResult.messages || [];
        if (!baseline[fileResult.file]) {
          baseline[fileResult.file] = {
            ruff: { warnings: messages.length, errors: 0 },
            totalWarnings: messages.length,
            lastAnalyzed: new Date().toISOString(),
          };
        } else {
          baseline[fileResult.file].ruff = { warnings: messages.length, errors: 0 };
          baseline[fileResult.file].totalWarnings += messages.length;
        }
      }
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
  const shFiles = findShellScripts();
  if (shFiles.length > 0) {
    let shAvailable = false;
    try {
      execSync('shellcheck --version', { encoding: 'utf8', stdio: 'pipe' });
      shAvailable = true;
    } catch {
      shAvailable = false;
    }

    if (shAvailable) {
      // Same batching as the other tools: one argv for every shell script in the
      // repo is the same platform-limit hazard, even though this repo happens to
      // sit under the threshold today.
      const { results, errors } = runLintInBatches(
        shFiles,
        batch => `shellcheck -f json ${batch.map(f => `"${f}"`).join(' ')}`,
        ''
      );
      recordFailures('shellcheck', errors);
      const warningsByFile = {};
      for (const item of results) {
        const matchedFile = matchResultToFile(item.file, shFiles);
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
  }

  fs.writeFileSync(getBaselineFile(), JSON.stringify(baseline, null, 2));
  return baseline;
}

/**
 * Count baseline entries grouped by tool type.
 * @param {object} data - Parsed baseline object (filePath → entry)
 * @returns {{ totalFiles: number, totalWarnings: number, eslintCount: number, ruffCount: number, golangciCount: number, shellcheckCount: number }}
 */
function countBaselineByTool(data) {
  const files = Object.keys(data);
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

  return { totalFiles: files.length, totalWarnings, eslintCount, ruffCount, golangciCount, shellcheckCount };
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

  const counts = countBaselineByTool(data);

  console.log('Lint Baseline:');
  console.log(`  Created: ${data[files[0]]?.lastAnalyzed?.slice(0, 10) || 'N/A'}`);
  console.log(`  Files tracked: ${counts.totalFiles}`);
  console.log(`  Total warnings: ${counts.totalWarnings}`);
  if (counts.eslintCount > 0) console.log(`  ESLint: ${counts.eslintCount} files`);
  if (counts.ruffCount > 0) console.log(`  Ruff: ${counts.ruffCount} files`);
  if (counts.golangciCount > 0) console.log(`  golangci-lint: ${counts.golangciCount} files`);
  if (counts.shellcheckCount > 0) console.log(`  ShellCheck: ${counts.shellcheckCount} files`);

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
 * Compare two baselines and produce diff data.
 * @param {object} oldBaseline
 * @param {object} currentBaseline
 * @returns {{ totalWarningsDelta: number, increased: string[], decreased: string[], added: string[], removed: string[] }}
 */
function compareBaselines(oldBaseline, currentBaseline) {
  const allFiles = new Set([...Object.keys(oldBaseline), ...Object.keys(currentBaseline)]);

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

  return { totalWarningsDelta, increased, decreased, added, removed };
}

/**
 * Print a diff result report to console.
 */
function printDiffReport(result) {
  console.log('Lint Baseline Diff:');
  console.log(`  Total warnings delta: ${result.totalWarningsDelta >= 0 ? '+' : ''}${result.totalWarningsDelta}`);

  if (result.added.length > 0) {
    console.log(`\nFiles added (${result.added.length}):`);
    result.added.forEach(l => console.log(l));
  }
  if (result.removed.length > 0) {
    console.log(`\nFiles removed (${result.removed.length}):`);
    result.removed.forEach(l => console.log(l));
  }
  if (result.increased.length > 0) {
    console.log(`\nWarnings increased (${result.increased.length}):`);
    result.increased.forEach(l => console.log(l));
  }
  if (result.decreased.length > 0) {
    console.log(`\nWarnings decreased (${result.decreased.length}):`);
    result.decreased.forEach(l => console.log(l));
  }

  if (result.added.length === 0 && result.removed.length === 0 && result.increased.length === 0 && result.decreased.length === 0) {
    console.log('  No change from baseline.');
  }
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

  const result = compareBaselines(oldBaseline, currentBaseline);
  printDiffReport(result);

  return result.totalWarningsDelta > 0 ? 1 : 0;
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

module.exports = { handleBaseline, createBaseline, showBaseline, resetBaseline, diffBaseline, countBaselineByTool, compareBaselines, findShellScripts, resolveLocalBin };
