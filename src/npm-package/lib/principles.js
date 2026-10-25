'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Above this many characters of argv, the file list is handed over by reference
 * (a temp file with `@`) instead of on the command line.
 *
 * #586: on Windows, `shell: true` routes through cmd.exe, whose command line is
 * capped at 8191 characters. Measure from the issue: 135 Java files came to 12944
 * characters before the `npx -y tsx <entry> --files --format json` prefix. That is
 * not an unusually large project — it is a mid-sized one, every time.
 *
 * 6000 leaves room for the executable, the entry path and the flags without
 * reaching the limit on any plausible installation path.
 */
const ARGV_CHAR_BUDGET = 6000;

/**
 * Build the executable + argument list for one principles run.
 *
 * Two things this must guarantee, both from #586:
 *
 *   1. no shell. `shell: true` is what reaches cmd.exe's 8191-character ceiling, and
 *      the fix is to not need a shell at all: prefer the project's own tsx run
 *      through `process.execPath` (an absolute node.exe — no shim, so no shell).
 *   2. bounded argv. Splitting `files.join(' ')` into many argv elements was
 *      explicitly ruled out in the issue and it is right to rule it out: the
 *      bottleneck is total characters, not quoting. So a long list is handed over by
 *      reference through an `@file` argument, which the engine expands.
 *
 * @param {string[]} files source files to analyse
 * @param {string} format 'json' or 'text'
 * @returns {{command: string, args: string[], useShell: boolean, cleanup: string|null}}
 */
function buildPrinciplesInvocation(files, format) {
  const entry = findPrinciplesEntry();
  const listChars = files.reduce((n, f) => n + String(f).length + 1, 0);

  // Preferred shape: node.exe + tsx's own CLI, so no shim and no shell are involved.
  const tsxCli = [findLocalTsxCli(), path.resolve(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs')].find(
    (candidate) => candidate && fs.existsSync(candidate)
  );

  const command = tsxCli ? process.execPath : 'npx';
  const prefix = tsxCli ? [tsxCli, entry] : ['-y', 'tsx', entry];

  if (listChars <= ARGV_CHAR_BUDGET) {
    return {
      command,
      args: [...prefix, '--files', files.join(' '), '--format', format],
      useShell: false,
      cleanup: null,
    };
  }

  // By reference: one short argument instead of thousands of characters.
  const listFile = path.join(os.tmpdir(), `xp-gate-principles-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(listFile, files.join('\n'));
  return {
    command,
    // The @ prefix is the engine's own "read the list from this file" form.
    args: [...prefix, '--files', `@${listFile}`, '--format', format],
    useShell: false,
    cleanup: listFile,
  };
}

/**
 * Path to the project's own tsx CLI, or null.
 *
 * Walks up from the working directory so a monorepo's hoisted node_modules is found.
 *
 * @returns {string|null}
 */
function findLocalTsxCli() {
  let dir = process.cwd();
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(dir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Was this failure the tool not running, or the code having problems?
 *
 * #586's last request, and #596's finding in the shell toolchain: a failure to
 * LAUNCH the checker was reported as "Failed to run principles check", which reads
 * like a principles verdict. It is not one — nothing was analysed, so nothing was
 * found. Collapsing the two sends the reader to fix source code when the problem is
 * the environment.
 *
 * @param {{error?: Error, stdout?: string, stderr?: string, status?: number|null}} result
 * @returns {'TOOLCHAIN'|'FINDING'}
 */
function classifyPrinciplesFailure(result) {
  const error = result && result.error;
  if (error && ['E2BIG', 'ENAMETOOLONG', 'ENOENT'].includes(error.code)) return 'TOOLCHAIN';
  const text = `${(result && result.stdout) || ''} ${(result && result.stderr) || ''} ${(error && error.message) || ''}`;
  if (/command line is too long|argument list too long|ENAMETOOLONG|E2BIG/i.test(text)) return 'TOOLCHAIN';
  // Everything else is a genuine verdict from a run that happened. Do NOT widen this
  // to "any non-zero exit": that would make Gate 4 unable to block on a real
  // violation, which is worse than the defect being fixed.
  return 'FINDING';
}

// Resolves repo root for the installed xp-gate npm package, or the development
// checkout when running from source. Walks up looking for either:
//   - src/principles/index.ts (this repo / dev mode)
//   - ../../src/principles/index.ts (installed under node_modules/@boyingliu01/xp-gate)
function findPrinciplesEntry() {
  const candidates = [
    // npm package bundled layout: lib/principles.js → principles/index.ts
    path.resolve(__dirname, '..', 'principles', 'index.ts'),
    // Development layout: lib/principles.js → src/principles/index.ts
    path.resolve(__dirname, '..', '..', '..', 'src', 'principles', 'index.ts'),
    // npm package installed under node_modules/@boyingliu01/xp-gate
    path.resolve(__dirname, '..', '..', 'src', 'principles', 'index.ts'),
    // Running from repo root
    path.resolve(process.cwd(), 'src', 'principles', 'index.ts'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// Extensions the principles engine has an adapter for. Kept as a literal rather
// than imported from src/principles/analyzer.ts because this file must stay
// loadable by plain Node with no transpile step (the package ships zero runtime
// dependencies and no build). Must match `getAdapterForFile`'s adapterMap.
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.java', '.kt', '.kts',
  '.dart', '.swift', '.cpp', '.cc', '.cxx', '.c', '.h', '.hpp',
  '.m', '.mm',
]);

// Directories never worth walking: they hold no project source and can be
// enormous. `node_modules` alone is ~hundreds of MB in this repo.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.stryker-tmp', '.worktrees', '__pycache__', '.venv', 'venv',
]);

/**
 * Walk a directory and collect every source file the engine can analyse.
 *
 * Exported for tests: the walk is the part that used to be silently absent, so
 * it is worth asserting directly rather than only through the CLI.
 *
 * @param {string} dir - absolute or relative directory
 * @returns {string[]} absolute paths, in discovery order
 */
function collectSourceFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // An unreadable directory contributes nothing, but must not crash the run.
    console.error(`[xp-gate principles] cannot read directory ${dir}: ${err.message}`);
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...collectSourceFiles(abs));
      continue;
    }
    if (!entry.isFile()) continue;
    // Skip test files: their assertions legitimately look like magic numbers,
    // long functions and missing error handling, so including them would bury
    // the real findings in noise.
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) continue;
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(abs);
  }
  return out;
}

/**
 * Turn CLI targets into the flat file list the checker understands (#565).
 *
 * `principles-checker --files` only accepts file paths; a directory matches no
 * adapter extension and is dropped silently, which used to report
 * "No violations found / Files checked: 0" with exit code 0. Expanding here
 * keeps that contract in the layer that advertises `<file_or_directory>`.
 *
 * A file target is returned untouched even if its extension is unknown, so the
 * caller can still surface the checker's own opinion about it.
 *
 * @param {string[]} targets - paths as given on the command line
 * @returns {string[]} file paths to hand to the checker
 */
function expandTargets(targets) {
  const out = [];
  for (const target of targets) {
    let stat;
    try {
      stat = fs.statSync(target);
    } catch {
      // Nonexistent path: forward it so the checker reports the missing file
      // rather than this layer pretending it was fine.
      out.push(target);
      continue;
    }
    if (stat.isDirectory()) {
      out.push(...collectSourceFiles(target));
    } else {
      out.push(target);
    }
  }
  return out;
}

function principles(args) {
  const target = args[0];
  if (!target) {
    console.error('Usage: xp-gate principles <file_or_directory> [--format console|json|sarif]');
    return Promise.resolve(1);
  }

  const formatIdx = args.indexOf('--format');
  const format = formatIdx >= 0 ? args[formatIdx + 1] : 'console';

  // Expand directories before handing them to the checker (#565). Passing a
  // directory straight through made the checker examine zero files while the
  // CLI printed "No violations found" and exited 0.
  const files = expandTargets([target]);
  if (files.length === 0) {
    // Nothing to analyse is NOT a pass. Saying so is the whole point: silence
    // here is indistinguishable from a clean directory. Exit 2 mirrors the
    // checker's own "examined nothing" contract, which reserves 1 for
    // "examined files and found violations".
    console.error(`[xp-gate principles] no analysable source files under: ${target}`);
    console.error('  Supported: ' + Array.from(SOURCE_EXTENSIONS).join(' '));
    return Promise.resolve(2);
  }

  const entry = findPrinciplesEntry();
  if (!entry) {
    console.error('[xp-gate principles] ERROR: cannot locate src/principles/index.ts');
    console.error('  Run from inside the xp-gate repo, or install via npm install -g @boyingliu01/xp-gate');
    return Promise.resolve(1);
  }

  // #586: build before spawning so the Windows command-line limit is a planning
  // concern, not a runtime explosion. See buildPrinciplesInvocation().
  const plan = buildPrinciplesInvocation(files, format);
  const result = spawnSync(plan.command, plan.args, {
    stdio: 'inherit',
    // Never a shell: `shell: true` is what reached cmd.exe's 8191-character ceiling.
    shell: plan.useShell,
  });

  if (plan.cleanup) {
    try {
      fs.unlinkSync(plan.cleanup);
    } catch {
      // A leftover temp file is not worth failing a gate over.
    }
  }

  if (result.error || result.status === null) {
    // #586's last request: say which kind of failure this is. "Failed to run
    // principles check" read like a principles verdict on a run where nothing was
    // analysed. Same confusion #596 fixed in the shell toolchain.
    const kind = classifyPrinciplesFailure(result);
    const detail = result.error ? result.error.message : 'no exit status';
    if (kind === 'TOOLCHAIN') {
      console.error(`[xp-gate principles] TOOLCHAIN: the checker could not be run: ${detail}`);
      console.error('  This is an environment problem, not a principles violation - nothing was analysed.');
    } else {
      console.error(`[xp-gate principles] checker failed: ${detail}`);
    }
    return Promise.resolve(1);
  }
  return Promise.resolve(result.status);
}

module.exports = {
  principles,
  expandTargets,
  collectSourceFiles,
  buildPrinciplesInvocation,
  classifyPrinciplesFailure,
  ARGV_CHAR_BUDGET,
};
