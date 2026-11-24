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

/**
 * Read the baseline currently on disk for use as a fallback while rebuilding.
 *
 * Returns `{}` when there is nothing to read. Both "no baseline yet" and "the
 * existing baseline is corrupt" must behave the same way here: this value only
 * ever RESTORES entries for files the rebuild could not evaluate, so a repair
 * path is not needed. Note the difference from the readers elsewhere in this
 * file, which fail loudly -- those answer "what is the baseline", and a wrong
 * answer there changes a verdict. This one only decides whether to keep a row
 * it already had.
 */
function readBaselineForMerge() {
  try {
    const raw = fs.readFileSync(getBaselineFile(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Create a directory if it does not exist, or fail with the path.
 *
 * Called before every baseline write, so a silent failure here surfaces later as
 * "cannot write" with no indication that the directory was the problem.
 */
function ensureDir(dirPath) {
  if (fs.existsSync(dirPath)) return;
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (err) {
    throw new Error(`cannot create ${dirPath}: ${err.message}`);
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
 * @returns {{results: any[], errors: string[], failedFiles: string[]}} parsed
 *   per-batch results, a list of failure messages, and the files that were in a
 *   batch which produced no usable output. An empty `results` with a non-empty
 *   `errors` means "not evaluated", never "clean".
 *
 *   `failedFiles` exists because the caller must be able to tell an evaluated
 *   file from an unevaluated one. Without it, a batch that crashed was
 *   indistinguishable from a batch that reported nothing, and the baseline
 *   writer treated both as "no issues here" -- then wrote that conclusion to
 *   disk, overwriting the entries the previous successful run had recorded.
 */
function runLintInBatches(files, buildCmd, jsonFlag) {
  const results = [];
  const errors = [];
  const failedFiles = [];

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
        failedFiles.push(...batch);
        continue;
      }
    }
    const trimmed = String(stdout).trim();
    if (!trimmed) {
      // No output at all for a batch the tool was asked about: nothing was
      // evaluated, so these files must not be recorded as clean.
      failedFiles.push(...batch);
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) results.push(...parsed);
      else failedFiles.push(...batch);
    } catch {
      errors.push(`linter returned unparseable output for ${batch.length} file(s)`);
      failedFiles.push(...batch);
    }
  }

  return { results, errors, failedFiles };
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
 * command printed a cheerful "✅ Baseline created" while hundreds of files had
 * contributed nothing. A warning is the minimum contract -- the caller can still finish, but
 * the user is told which language went unmeasured and why.
 *
 * @param {string} tool
 * @param {string[]} errors
 */
/** Three bad entries is enough to convey the pattern; a wall of paths gets skimmed. */
const PREVIEW_ITEMS = 3;
const BYTES_PER_MEGABYTE = 1024 * 1024;
/** A lint run's JSON can be large on a big tree; this was the previous inline cap. */
const LINT_MAX_OUTPUT_MEGABYTES = 5;
const LINT_MAX_OUTPUT_BYTES = LINT_MAX_OUTPUT_MEGABYTES * BYTES_PER_MEGABYTE;

function recordFailures(tool, errors) {
  if (!errors || errors.length === 0) return;
  const unique = [...new Set(errors)];
  const shown = unique.slice(0, PREVIEW_ITEMS).join('; ');
  const more = unique.length > PREVIEW_ITEMS ? ` (+${unique.length - PREVIEW_ITEMS} more)` : '';
  console.warn(`⚠️  ${tool}: could not evaluate ${errors.length} batch(es) — ${shown}${more}`);
  console.warn(`   Files covered by a failed batch are absent from the baseline, not clean.`);
}

/**
 * Fold one tool's per-file counts into the baseline.
 *
 * The Go and Shell sections each ended with the same twelve lines: accumulate
 * `{warnings, errors}` per file, then either add the field to an existing entry
 * and bump its `totalWarnings`, or create the entry. Two copies means two places
 * that must agree on how a file with several tools is represented -- and a file
 * linted by both is the normal case in a mixed repo.
 *
 * @param {object} baseline entries keyed by file
 * @param {string} tool field name to store, e.g. 'shellcheck'
 * @param {Object<string, {warnings: number, errors: number}>} warningsByFile
 */
function mergeToolCounts(baseline, tool, warningsByFile) {
  for (const [file, counts] of Object.entries(warningsByFile)) {
    if (baseline[file]) {
      baseline[file][tool] = counts;
      baseline[file].totalWarnings += counts.warnings;
    } else {
      baseline[file] = {
        [tool]: counts,
        totalWarnings: counts.warnings,
        lastAnalyzed: new Date().toISOString(),
      };
    }
  }
}

/**
 * Is this linter runnable?
 *
 * Four languages asked this with the same four-line try/catch around a
 * `<tool> --version` call. One definition means one behaviour: a tool that
 * answers is usable, one that throws is not, and the caller records the
 * unmeasured files either way.
 *
 * @param {string} versionCmd e.g. 'ruff --version'
 * @returns {boolean}
 */
function probeTool(versionCmd) {
  try {
    execSync(versionCmd, { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
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
      maxBuffer: LINT_MAX_OUTPUT_BYTES,
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
      maxBuffer: LINT_MAX_OUTPUT_BYTES,
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
/**
 * Run one linter over its files and account for every batch that failed.
 *
 * Each language section opened with the same three lines:
 *
 *     const { results, errors, failedFiles } = runLintInBatches(...)
 *     recordFailures('<tool>', errors);
 *     failedFiles.forEach(f => unevaluated.add(f));
 *
 * Three lines does not look like duplication, but the CONSISTENCY is the point:
 * every tool must add its unevaluated files to the same set, or the restore step
 * at the end puts back the wrong entries and a file the linter could not read
 * gets recorded as clean. One call site means a new language cannot forget.
 *
 * @param {string} tool name used in the warning
 * @param {string[]} files
 * @param {(batch: string[]) => string} buildCmd
 * @param {string} jsonFlag
 * @param {Set<string>} unevaluated collected across all tools
 * @returns {{results: Array}} the parsed per-file results
 */
function lintAndAccount(tool, files, buildCmd, jsonFlag, unevaluated) {
  const { results, errors, failedFiles } = runLintInBatches(files, buildCmd, jsonFlag);
  recordFailures(tool, errors);
  failedFiles.forEach((f) => unevaluated.add(f));
  return { results };
}

/**
 * Put back the entries for files no linter could evaluate this run.
 *
 * The ratchet's load-bearing half. A rebuild starts from `{}`, which is correct
 * only for files that were actually examined: a batch whose linter did not run
 * taught us nothing, and recording its files as "no entry" silently lowers the
 * bar for every one of them. Measured recurrence -- a run in which every tool
 * failed replaced a good baseline with `{}`, presenting as
 * "BLOCKED - 50 NEW shellcheck issue(s) (baseline: 0, current: 50)" on an
 * unchanged tree.
 *
 * Files that WERE evaluated still shrink: `baseline[file]` is already set for
 * them, so the guard below leaves them alone. That is the ratchet working.
 *
 * @param {object} baseline mutated in place
 * @param {object} previous what was on disk before this run
 * @param {Set<string>} unevaluated
 * @returns {number} how many entries were carried forward
 */
function carryUnevaluated(baseline, previous, unevaluated) {
  let carried = 0;
  for (const file of unevaluated) {
    if (baseline[file]) continue;
    if (!Object.prototype.hasOwnProperty.call(previous, file)) continue;
    baseline[file] = previous[file];
    carried++;
  }
  if (carried > 0) {
    console.log(
      `Kept ${carried} baseline entry/entries for files no linter could evaluate `
      + `(${unevaluated.size} file(s) affected) -- not evaluated is not clean.`,
    );
  }
  return carried;
}

/**
 * Baseline TypeScript/JavaScript with ESLint.
 *
 * `mergeToolCounts` rather than assignment: a file linted by more than one tool keeps
 * every tool's counts, and the previous assignment replaced the whole entry so the
 * last tool to run erased the others.
 *
 * A project with no eslint config has nothing to baseline; staying quiet is correct.
 * The silent-catch defect was about masking ERRORS, not about projects that
 * legitimately have no tool.
 *
 * @param {object} baseline mutated in place
 * @param {Set<string>} unevaluated files no linter could read
 */
function baselineTypeScript(baseline, unevaluated) {
// TypeScript/JavaScript — ESLint
const tsFiles = findFilesByExt(['.ts', '.tsx', '.js', '.jsx']);
if (tsFiles.length > 0) {
  const eslintConfigExists = fs.existsSync('.eslintrc.json') ||
    fs.existsSync('.eslintrc.js') ||
    fs.existsSync('.eslintrc.cjs') ||
    fs.existsSync('eslint.config.js');
  const eslintBin = resolveLocalBin('eslint');

  const eslintAvailable = Boolean(eslintBin) || probeTool('npx eslint --version');

  if (eslintConfigExists && eslintAvailable) {
    const eslintCmd = eslintBin ? quoteBin(eslintBin) : 'npx eslint';
    const { results } = lintAndAccount('eslint', tsFiles, batch => `${eslintCmd} ${batch.map(f => `"${f}"`).join(' ')}`, '-f json --no-warn-ignored', unevaluated);
    const eslintCounts = {};
    for (const fileResult of results) {
      const fileName = matchResultToFile(fileResult.filePath, tsFiles);
      if (!fileName) continue;
      eslintCounts[fileName] = {
        warnings: fileResult.warningCount || 0,
        errors: fileResult.errorCount || 0,
      };
    }
    // Merge, not overwrite: a file linted by more than one tool keeps every
    // tool's counts. The previous assignment replaced the whole entry, so the
    // last tool to run erased the others.
    mergeToolCounts(baseline, 'eslint', eslintCounts);
  } else if (tsFiles.length > 0 && !eslintConfigExists) {
    // Not a failure: a project without an eslint config has nothing to
    // baseline. Staying quiet here is correct; the silent-catch defect was
    // about masking errors, not about projects that legitimately have no tool.
  }
}
}

/**
 * Baseline Python with ruff.
 *
 * A result that names no file cannot be recorded against one; skipping it is the fix
 * for the literal `undefined` key this used to write into the baseline.
 */
function baselinePython(baseline, unevaluated) {
// Python — ruff
const pyFiles = findFilesByExt(['.py']);
if (pyFiles.length > 0) {
  const ruffAvailable = probeTool('ruff --version');

  if (ruffAvailable) {
    const { results } = lintAndAccount('ruff', pyFiles, batch => `ruff check ${batch.map(f => `"${f}"`).join(' ')}`, '--output-format json', unevaluated);
    const ruffCounts = {};
    for (const fileResult of results) {
      // A result that names no file cannot be recorded against one. Skipping it
      // is the fix for the literal "undefined" key this used to write.
      if (!fileResult.file) continue;
      const messages = fileResult.messages || [];
      ruffCounts[fileResult.file] = { warnings: messages.length, errors: 0 };
    }
    mergeToolCounts(baseline, 'ruff', ruffCounts);
  }
}

}

async function createBaseline() {
  ensureDir(getXpGateDir());

  const baseline = {};

  // The baseline is a RATCHET: it records what was already known so a new issue
  // stands out. Rebuilding it from an empty object is correct only for files that
  // were actually evaluated. A batch whose linter could not run taught us nothing
  // about its files, so writing them as "no entry" would silently lower the bar
  // for every one of them -- and because the write is unconditional, a run in
  // which every tool failed replaced a good baseline with `{}`. That is a
  // measured recurrence in this repo: it presents as
  //     BLOCKED - 50 NEW shellcheck issue(s) (baseline: 0, current: 50)
  // on a tree where nothing had changed, and it cannot be distinguished from a
  // genuine regression until the old baseline is reconstructed by hand.
  //
  // So: read what was on disk, and after the rebuild put back the entries for
  // files this run could not evaluate. Files that WERE evaluated still shrink --
  // that is the ratchet working -- because `baseline[file]` is set for them.
  const previous = readBaselineForMerge();
  const unevaluated = new Set();

  baselineTypeScript(baseline, unevaluated);

  baselinePython(baseline, unevaluated);
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
        mergeToolCounts(baseline, 'golangci', warningsByFile);
      }
    } catch {
      // golangci-lint unavailable — skip
    }
  }

  // Shell — shellcheck
  const shFiles = findShellScripts();
  if (shFiles.length > 0) {
    const shAvailable = probeTool('shellcheck --version');

    if (shAvailable) {
      // Same batching as the other tools: one argv for every shell script in the
      // repo is the same platform-limit hazard, even though this repo happens to
      // sit under the threshold today.
      const { results } = lintAndAccount('shellcheck', shFiles, batch => `shellcheck -f json ${batch.map(f => `"${f}"`).join(' ')}`, '', unevaluated);
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
      mergeToolCounts(baseline, 'shellcheck', warningsByFile);
    }
  }

  // Restore what this run could not evaluate, so a broken toolchain cannot
  // rewrite known-bad files as clean. `baseline[file]` being set means some tool
  // did evaluate it this run, and the fresh value wins -- that is the ratchet
  // shrinking, not data loss.
  carryUnevaluated(baseline, previous, unevaluated);

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

  let data;
  try {
    data = JSON.parse(fs.readFileSync(getBaselineFile(), 'utf8'));
  } catch (err) {
    // A baseline we cannot read is not an empty baseline; saying so prevents a
    // caller from concluding the project has no recorded warnings.
    console.error(`Error: cannot read baseline: ${err.message}`);
    return 1;
  }
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

module.exports = { handleBaseline, createBaseline, carryUnevaluated, lintAndAccount, showBaseline, resetBaseline, diffBaseline, countBaselineByTool, compareBaselines, findShellScripts, resolveLocalBin };
