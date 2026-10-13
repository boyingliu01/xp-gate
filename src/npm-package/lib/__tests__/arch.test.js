/**
 * @test REQ-A-05 (#447) xp-gate arch subcommand
 * @intent `xp-gate arch` works again: the default path runs the PINNED local
 *   @archlinter/cli with built-in rules (never `npx -y`), with baseline-ratchet
 *   verdicts when .architecture-baseline.json exists (Gate 6 parity) and
 *   zero-tolerance otherwise; `--use-config` is the opt-in legacy config path.
 *   Anti-noop: the integration tests run the REAL archlint binary and prove a
 *   planted high-severity violation flips the verdict to non-zero — an exit 0
 *   is a real scan, not a hardcoded pass.
 * @covers AC-A-05-01, AC-A-05-02
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const archModule = require('../arch.js');
const {
  findProjectRoot,
  binEntryFromPackageDir,
  resolveArchlint,
  verdictFromScanJson,
  quoteForShell,
} = archModule.__internals;

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// Verified against @archlinter/cli 0.16.0: a ~198-token duplicated block is
// reported as a High-severity CodeClone (this repo's four High smells are all
// large clones, token_count 112-149). Smaller clones only reach Medium, which
// the high/critical blocking threshold deliberately ignores.
const HIGH_CLONE_BLOCK = [
  'function processAlphaRecords(records) {',
  '  const out = [];',
  '  for (const r of records) {',
  '    if (!r || typeof r !== "object") continue;',
  '    const score = (r.alpha || 0) * 2 + (r.beta || 0) * 3 + (r.gamma || 0) * 5;',
  '    const tier = score > 100 ? "platinum" : score > 50 ? "gold" : score > 20 ? "silver" : "bronze";',
  '    const weighted = score * (r.weight || 1) + (r.penalty || 0);',
  '    const bucket = weighted > 200 ? "A" : weighted > 120 ? "B" : weighted > 60 ? "C" : "D";',
  '    out.push({ id: r.id, score, weighted, tier, bucket, tags: (r.tags || []).map((t) => t.toLowerCase()) });',
  '  }',
  '  return out.sort((a, b) => b.weighted - a.weighted);',
  '}',
  '',
  'function summarizeAlphaBuckets(rows) {',
  '  const acc = { A: 0, B: 0, C: 0, D: 0 };',
  '  for (const row of rows) {',
  '    acc[row.bucket] = (acc[row.bucket] || 0) + 1;',
  '  }',
  '  return { counts: acc, total: rows.length, average: rows.reduce((s, r) => s + r.weighted, 0) / (rows.length || 1) };',
  '}',
  '',
].join('\n');

let sandbox;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-arch-'));
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

function writeCleanSandbox() {
  fs.mkdirSync(path.join(sandbox, 'src'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'src', 'a.js'), 'module.exports = { a: 1 };\n');
  fs.writeFileSync(
    path.join(sandbox, 'src', 'b.js'),
    'const { a } = require("./a");\nmodule.exports = { b: a + 1 };\n',
  );
}

function plantHighClone() {
  fs.mkdirSync(path.join(sandbox, 'src', 'domain'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'src', 'infrastructure'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'src', 'domain', 'user.js'), 'const u = 1;\n' + HIGH_CLONE_BLOCK);
  fs.writeFileSync(path.join(sandbox, 'src', 'infrastructure', 'db.js'), 'const d = 2;\n' + HIGH_CLONE_BLOCK);
}

/**
 * Run `arch(args)` in a child node process with cwd set to the sandbox.
 * Worker threads forbid process.chdir (ERR_WORKER_UNSUPPORTED_OPERATION), so
 * cwd-sensitive behavior is exercised the same way gate-runner.test.js does it:
 * a real child process whose exit code IS arch's return code.
 */
function runArchInChild(cwd, args) {
  const archPath = path.join(__dirname, '..', 'arch.js');
  const script = [
    `const { arch } = require(${JSON.stringify(archPath)});`,
    `arch(${JSON.stringify(args)}).then((code) => process.exit(code));`,
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

/** Run the REAL pinned archlint (xp-gate's own dependency) inside a sandbox. */
function runRealArchlint(args, cwd) {
  const resolved = resolveArchlint(sandbox);
  return spawnSync(process.execPath, [resolved.script, ...args], { cwd, encoding: 'utf8' });
}

describe('findProjectRoot', () => {
  it('walks up to the directory containing .git', () => {
    fs.mkdirSync(path.join(sandbox, '.git'), { recursive: true });
    const nested = path.join(sandbox, 'a', 'b', 'c');
    fs.mkdirSync(nested, { recursive: true });
    // The walk is purely lexical (dirname chain), so the sandbox path itself
    // comes back unchanged — no realpath normalization is applied.
    expect(findProjectRoot(nested)).toBe(sandbox);
  });

  it('falls back to the start directory when no .git marker exists', () => {
    // os.tmpdir() is outside any repository on CI and dev machines alike.
    expect(findProjectRoot(sandbox)).toBe(sandbox);
  });
});

describe('binEntryFromPackageDir', () => {
  function fakePackage(binValue, { writeEntry = true } = {}) {
    const pkgDir = path.join(sandbox, 'node_modules', '@archlinter', 'cli');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@archlinter/cli', version: '0.16.0', bin: binValue }),
    );
    if (writeEntry) {
      const entryRel = typeof binValue === 'string' ? binValue : binValue.archlint;
      fs.mkdirSync(path.dirname(path.join(pkgDir, entryRel)), { recursive: true });
      fs.writeFileSync(path.join(pkgDir, entryRel), '// entry\n');
    }
    return pkgDir;
  }

  it('resolves the archlint JS entry from a bin map', () => {
    const pkgDir = fakePackage({ archlint: 'bin/archlint.js' });
    expect(binEntryFromPackageDir(pkgDir)).toBe(path.join(pkgDir, 'bin', 'archlint.js'));
  });

  it('supports the string form of bin', () => {
    const pkgDir = fakePackage('bin/archlint.js');
    expect(binEntryFromPackageDir(pkgDir)).toBe(path.join(pkgDir, 'bin', 'archlint.js'));
  });

  it('returns null when the package is not installed', () => {
    expect(binEntryFromPackageDir(path.join(sandbox, 'node_modules', '@archlinter', 'cli'))).toBeNull();
  });

  it('returns null when the bin entry file is missing on disk', () => {
    const pkgDir = fakePackage({ archlint: 'bin/archlint.js' }, { writeEntry: false });
    expect(binEntryFromPackageDir(pkgDir)).toBeNull();
  });

  it('returns null for a manifest without a usable bin', () => {
    const pkgDir = path.join(sandbox, 'node_modules', '@archlinter', 'cli');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@archlinter/cli' }));
    expect(binEntryFromPackageDir(pkgDir)).toBeNull();
  });
});

describe('resolveArchlint', () => {
  it('prefers xp-gate\'s own pinned dependency (never the registry latest)', () => {
    const resolved = resolveArchlint(sandbox);
    expect(resolved.kind).toBe('node-script');
    expect(fs.existsSync(resolved.script)).toBe(true);
    const pkgDir = path.dirname(path.dirname(resolved.script));
    const version = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
    expect(version).toMatch(/^0\.16\./);
  });

  it('falls back to the project\'s local node_modules when the own dependency is skipped', () => {
    const pkgDir = path.join(sandbox, 'node_modules', '@archlinter', 'cli');
    fs.mkdirSync(path.join(pkgDir, 'bin'), { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@archlinter/cli', version: '9.9.9', bin: { archlint: 'bin/archlint.js' } }),
    );
    fs.writeFileSync(path.join(pkgDir, 'bin', 'archlint.js'), '// entry\n');
    const resolved = resolveArchlint(sandbox, { includeOwnDependency: false });
    expect(resolved).toEqual({
      kind: 'node-script',
      script: path.join(pkgDir, 'bin', 'archlint.js'),
      source: 'project node_modules',
    });
  });

  it('falls back to PATH when no node_modules install is reachable', () => {
    const binDir = path.join(sandbox, 'fakebin');
    fs.mkdirSync(binDir, { recursive: true });
    const originalPath = process.env.PATH;
    try {
      if (process.platform === 'win32') {
        fs.writeFileSync(path.join(binDir, 'archlint.bat'), '@echo off\r\nexit /b 0\r\n');
      } else {
        const sh = path.join(binDir, 'archlint');
        fs.writeFileSync(sh, '#!/bin/sh\nexit 0\n');
        fs.chmodSync(sh, 0o755);
      }
      // Prepend so `where`/`which` themselves still resolve, but archlint
      // resolves to the fake first (PATH order).
      process.env.PATH = binDir + path.delimiter + originalPath;
      const resolved = resolveArchlint(sandbox, { includeOwnDependency: false });
      expect(resolved.kind).toBe('binary');
      expect(resolved.bin.toLowerCase()).toContain('archlint');
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('falls back to npx --no-install as the last resort (never npx -y)', () => {
    // System dirs only: the lookup binaries resolve, archlint does not.
    const systemDir =
      process.platform === 'win32'
        ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
        : '/usr/bin:/bin';
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = systemDir;
      const resolved = resolveArchlint(sandbox, { includeOwnDependency: false });
      expect(resolved).toEqual({ kind: 'npx', source: 'npx --no-install (local only)' });
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

describe('verdictFromScanJson', () => {
  const smell = (severity, type = 'SomeSmell') => ({ severity, type, files: ['src/x.js'] });

  it('counts high/critical as blocking and ignores medium/low', () => {
    const json = JSON.stringify({
      smells: [smell('High'), smell('critical'), smell('Medium'), smell('low'), smell('Medium')],
    });
    const verdict = verdictFromScanJson(json);
    expect(verdict.parseError).toBeNull();
    expect(verdict.total).toBe(5);
    expect(verdict.blocking).toBe(2);
    expect(verdict.blockingDetails).toHaveLength(2);
  });

  it('matches severity case-insensitively', () => {
    const json = JSON.stringify({ smells: [smell('HIGH'), smell('Critical')] });
    expect(verdictFromScanJson(json).blocking).toBe(2);
  });

  it('treats a missing smells array as zero findings', () => {
    const verdict = verdictFromScanJson(JSON.stringify({ summary: {} }));
    expect(verdict.parseError).toBeNull();
    expect(verdict.total).toBe(0);
    expect(verdict.blocking).toBe(0);
  });

  it('reports unparseable output as an error (fail-closed, never "clean")', () => {
    const verdict = verdictFromScanJson('not json at all');
    expect(verdict.parseError).toBeTruthy();
    expect(verdict.blocking).toBe(0);
  });

  it('caps the blocking preview at 10 entries', () => {
    const json = JSON.stringify({ smells: Array.from({ length: 25 }, () => smell('High')) });
    const verdict = verdictFromScanJson(json);
    expect(verdict.blocking).toBe(25);
    expect(verdict.blockingDetails).toHaveLength(10);
  });
});

describe('quoteForShell', () => {
  it('leaves whitespace-free arguments untouched', () => {
    expect(quoteForShell('--fail-on')).toBe('--fail-on');
  });

  it('quotes arguments containing whitespace for cmd.exe', () => {
    expect(quoteForShell('C:\\my configs\\arch.yaml')).toBe('"C:\\my configs\\arch.yaml"');
  });
});

describe('arch — real archlint integration (anti-noop)', () => {
  it('exits 0 on a clean sandbox (zero-tolerance mode, no baseline)', () => {
    writeCleanSandbox();
    const run = runArchInChild(sandbox, []);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Zero-tolerance mode');
    expect(run.stdout).toContain('✅ arch: no high/critical architecture findings');
  }, 60000);

  it('BLOCKS a planted high-severity violation — exit 0 is a real scan, not a no-op', () => {
    writeCleanSandbox();
    plantHighClone();
    const run = runArchInChild(sandbox, []);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('BLOCKED');
    expect(run.stderr).toContain('CodeClone');
  }, 60000);

  it('baseline ratchet: snapshot of a clean tree then re-scan exits 0', () => {
    writeCleanSandbox();
    const snapshot = runRealArchlint(['snapshot', '-o', path.join(sandbox, '.architecture-baseline.json'), '-p', sandbox], sandbox);
    expect(snapshot.status).toBe(0);
    const run = runArchInChild(sandbox, []);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Baseline ratchet mode');
  }, 120000);

  it('baseline ratchet: a NEW high finding against the baseline blocks', () => {
    writeCleanSandbox();
    const snapshot = runRealArchlint(['snapshot', '-o', path.join(sandbox, '.architecture-baseline.json'), '-p', sandbox], sandbox);
    expect(snapshot.status).toBe(0);
    plantHighClone();
    const run = runArchInChild(sandbox, []);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('BLOCKED');
  }, 120000);

  it('exits 0 on this repository (AC-A-05-01: baseline present, no new high findings)', () => {
    // Guarded: needs both the committed baseline and the pinned archlint,
    // i.e. a full dev/CI checkout (npm ci installs @archlinter/cli).
    const baseline = path.join(REPO_ROOT, '.architecture-baseline.json');
    if (!fs.existsSync(baseline) || !fs.existsSync(path.join(REPO_ROOT, 'node_modules', '@archlinter', 'cli'))) {
      return;
    }
    const run = runArchInChild(REPO_ROOT, []);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('Baseline ratchet mode');
  }, 180000);
});

describe('arch — opt-in config path (--use-config)', () => {
  it('passes a valid new-schema config through to archlint (exit 0)', () => {
    writeCleanSandbox();
    const init = runRealArchlint(['init', '--no-interactive'], sandbox);
    expect(init.status).toBe(0);
    expect(fs.existsSync(path.join(sandbox, '.archlint.yaml'))).toBe(true);
    const run = runArchInChild(sandbox, ['--use-config', '.archlint.yaml']);
    expect(run.status).toBe(0);
  }, 60000);

  it('accepts --config as a deprecated alias of --use-config', () => {
    writeCleanSandbox();
    runRealArchlint(['init', '--no-interactive'], sandbox);
    const run = runArchInChild(sandbox, ['--config', '.archlint.yaml']);
    expect(run.status).toBe(0);
    expect(run.stderr).toContain('deprecated');
  }, 60000);

  it("surfaces archlint's schema rejection for the repo's pre-0.16 architecture.yaml (no silent pass)", () => {
    const run = runArchInChild(REPO_ROOT, ['--use-config', 'architecture.yaml']);
    expect(run.status).not.toBe(0);
  }, 60000);

  it('rejects a missing config file before spawning archlint', () => {
    const run = runArchInChild(sandbox, ['--use-config', 'nope.yaml']);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('config file not found');
  });

  it('rejects --use-config without a value', () => {
    const run = runArchInChild(sandbox, ['--use-config']);
    expect(run.status).toBe(1);
  });

  it('rejects passing both --use-config and --config', () => {
    const run = runArchInChild(sandbox, ['--use-config', 'a.yaml', '--config', 'b.yaml']);
    expect(run.status).toBe(1);
  });
});
