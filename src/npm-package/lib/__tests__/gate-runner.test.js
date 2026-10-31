/**
 * @test REQ-standalone-gates gate-runner.js
 * @intent 验证 runGateAdapter 独立运行 gate 适配器片段时能提供钩子上下文
 * （gate_start_ms / record_gate_audit / now_ms / PROJECT_LANG / CHANGED_FILES），
 * 避免 "command not found" 误报。
 * @covers AC-STANDALONE-GATES-01, AC-STANDALONE-GATES-02, AC-STANDALONE-GATES-03, AC-STANDALONE-GATES-04, AC-STANDALONE-GATES-05
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const { findConsumerGateVariant } = require('../gate-runner');

let tmpProject;
let tmpAdapters;

beforeEach(() => {
  tmpProject = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-runner-'));
  tmpAdapters = path.join(tmpProject, 'githooks', 'adapters');
  fs.mkdirSync(tmpAdapters, { recursive: true });
});

afterEach(() => {
  if (tmpProject && fs.existsSync(tmpProject)) {
    fs.rmSync(tmpProject, { recursive: true, force: true });
  }
});

function writeAdapterCommon() {
  fs.writeFileSync(
    path.join(tmpAdapters, 'adapter-common.sh'),
    'detect_project_lang() { echo "typescript"; }'
  );
}

function writeGateFragment(fragmentLines) {
  fs.writeFileSync(
    path.join(tmpAdapters, 'gate-9.sh'),
    ['# gate-9 fragment', ...fragmentLines, 'exit 0'].join('\n')
  );
}

function shellParameter(expression) {
  return ['$', '{', expression, '}'].join('');
}

// Path segment that must survive quoting untouched. Windows rejects `"` and `*`
// in a filename, so the hostile set there keeps the same bash hazards — word
// split, parameter expansion, command substitution, quoting, list separator —
// with legal characters instead (#428).
function hostilePathSegment() {
  if (process.platform === 'win32') {
    return "space $HOME `marker` 'quoted' & (paren)";
  }
  return 'space $HOME `marker` "quoted"';
}

function initializeGitProject() {
  execFileSync('git', ['init', '-q'], { cwd: tmpProject });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpProject });
  execFileSync('git', ['config', 'user.name', 'XP-Gate Test'], { cwd: tmpProject });
  fs.writeFileSync(path.join(tmpProject, 'tracked.ts'), 'const value = 1;\n');
  execFileSync('git', ['add', 'tracked.ts'], { cwd: tmpProject });
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'initial'], {
    cwd: tmpProject,
  });
}

// Runs runGateAdapter in a child node process (worker threads forbid process
// chdir, and runGateAdapter execs bash), capturing stdout/exit status.
function runChildAdapter(gateRunnerAbsPath, fragmentPath, cwd = tmpProject, opts = null) {
  const optsArgument = opts ? `, ${JSON.stringify(opts)}` : '';
  const script = [
    `const { runGateAdapter } = require(${JSON.stringify(gateRunnerAbsPath)});`,
    `runGateAdapter(${JSON.stringify(fragmentPath)}, ${JSON.stringify(cwd)}${optsArgument});`,
    "console.log('__ADAPTER_DONE__');",
  ].join('\n');
  try {
    const stdout = execFileSync(process.execPath, ['-e', script], {
      cwd,
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout };
  } catch (err) {
    return { status: err.status ?? 1, stdout: (err.stdout || '').toString() };
  }
}

describe('gate-runner.js — runGateAdapter', () => {
  it('sources the fragment with hook helpers available (REQ-standalone-gates-01)', () => {
    const runnerAbsPath = path.resolve(__dirname, '../gate-runner.js');
    writeAdapterCommon();
    writeGateFragment([
      'USES_START=$(gate_start_ms)',
      `if [ -z "${shellParameter('PROJECT_LANG:-')}" ]; then exit 99; fi`,
      `if [ -z "${shellParameter('CHANGED_FILES+x')}" ]; then exit 98; fi`,
      'record_gate_audit "gate-9" "sast" "PASS" "0" "$USES_START"',
    ]);
    const fragPath = path.join(tmpAdapters, 'gate-9.sh');
    const { status, stdout } = runChildAdapter(runnerAbsPath, fragPath);
    expect(status).toBe(0);
    expect(stdout).toContain('__ADAPTER_DONE__');
  }, 30000);

  it('defines now_ms/gate_start_ms/record_gate_audit/PROJECT_LANG/CHANGED_FILES before sourcing (REQ-standalone-gates-02)', () => {
    const runnerAbsPath = path.resolve(__dirname, '../gate-runner.js');
    writeAdapterCommon();
    writeGateFragment([
      'if ! command -v gate_start_ms >/dev/null 2>&1; then exit 97; fi',
      'if ! command -v record_gate_audit >/dev/null 2>&1; then exit 96; fi',
      'if ! command -v now_ms >/dev/null 2>&1; then exit 95; fi',
      `if [ -z "${shellParameter('PROJECT_LANG:-')}" ]; then exit 94; fi`,
      `if [ -z "${shellParameter('CHANGED_FILES+x')}" ]; then exit 93; fi`,
    ]);
    const fragPath = path.join(tmpAdapters, 'gate-9.sh');
    const { status, stdout } = runChildAdapter(runnerAbsPath, fragPath);
    expect(status).toBe(0);
    expect(stdout).toContain('__ADAPTER_DONE__');
  }, 30000);

  it('sources adapter-common.sh to provide detect_project_lang (REQ-standalone-gates-03)', () => {
    const runnerAbsPath = path.resolve(__dirname, '../gate-runner.js');
    writeAdapterCommon();
    writeGateFragment([
      `if [ "${shellParameter('PROJECT_LANG:-')}" != "typescript" ]; then exit 92; fi`,
    ]);
    const fragPath = path.join(tmpAdapters, 'gate-9.sh');
    const { status, stdout } = runChildAdapter(runnerAbsPath, fragPath);
    expect(status).toBe(0);
    expect(stdout).toContain('__ADAPTER_DONE__');
  }, 30000);

  it('propagates changed files from the project git working tree (REQ-standalone-gates-04)', () => {
    const runnerAbsPath = path.resolve(__dirname, '../gate-runner.js');
    writeAdapterCommon();
    initializeGitProject();
    fs.writeFileSync(path.join(tmpProject, 'tracked.ts'), 'const value = 2;\n');
    writeGateFragment([
      `if [ "${shellParameter('CHANGED_FILES')}" != "tracked.ts" ]; then exit 91; fi`,
    ]);

    const fragPath = path.join(tmpAdapters, 'gate-9.sh');
    const { status, stdout } = runChildAdapter(runnerAbsPath, fragPath);

    expect(status).toBe(0);
    expect(stdout).toContain('__ADAPTER_DONE__');
  }, 30000);

  it('propagates the whole tracked tree under scope=all, one file per line (#589/#<new>)', () => {
    const runnerAbsPath = path.resolve(__dirname, '../gate-runner.js');
    writeAdapterCommon();
    initializeGitProject();
    fs.writeFileSync(path.join(tmpProject, 'untracked.ts'), 'const value = 3;\n');
    // Two tracked files so a one-line join (the old JSON.stringify form) would fail
    // the equality check even though the list was non-empty.
    fs.writeFileSync(path.join(tmpProject, 'second.ts'), 'const value = 4;\n');
    execFileSync('git', ['add', 'second.ts'], { cwd: tmpProject });
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'second'], {
      cwd: tmpProject,
    });
    writeGateFragment([
      `printf '%s\\n' "${shellParameter('CHANGED_FILES')}" | grep -qx 'tracked.ts' || exit 87`,
      `printf '%s\\n' "${shellParameter('CHANGED_FILES')}" | grep -qx 'second.ts' || exit 86`,
      `[ "$(printf '%s\\n' "${shellParameter('CHANGED_FILES')}" | wc -l)" -eq 2 ] || exit 85`,
      `if [ "${shellParameter('GATE_SCOPE')}" != "all" ]; then exit 84; fi`,
    ]);

    const fragPath = path.join(tmpAdapters, 'gate-9.sh');
    const { status, stdout } = runChildAdapter(runnerAbsPath, fragPath, tmpProject, { scope: 'all' });

    expect(status).toBe(0);
    expect(stdout).toContain('__ADAPTER_DONE__');
  }, 30000);

  it('runs a standalone gate bash fallback through the public CLI (REQ-standalone-gates-05)', () => {
    const packageFixture = path.join(tmpProject, 'package');
    fs.cpSync(path.resolve(__dirname, '../..'), packageFixture, { recursive: true });
    const cliPath = path.join(packageFixture, 'bin', 'xp-gate.js');
    const gatesDir = path.join(tmpProject, 'githooks', 'gates');
    fs.mkdirSync(gatesDir, { recursive: true });
    fs.writeFileSync(
      path.join(gatesDir, 'gate-9-public-fallback.sh'),
      [
        'if ! command -v gate_start_ms >/dev/null 2>&1; then exit 90; fi',
        `if [ -z "${shellParameter('CHANGED_FILES+x')}" ]; then exit 89; fi`,
        'echo "__PUBLIC_FALLBACK__"',
      ].join('\n')
    );

    const result = spawnSync(process.execPath, [cliPath, 'check', '9'], {
      cwd: tmpProject,
      encoding: 'utf8',
      timeout: 30000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('__PUBLIC_FALLBACK__');
  }, 30000);

  it('isolates fallback resolution and git context to the requested target path (REQ-standalone-gates-06)', () => {
    const packageFixture = path.join(tmpProject, 'package');
    const callerProject = path.join(tmpProject, 'caller');
    const targetProject = path.join(tmpProject, 'target');
    fs.cpSync(path.resolve(__dirname, '../..'), packageFixture, { recursive: true });
    fs.mkdirSync(path.join(callerProject, 'githooks', 'gates'), { recursive: true });
    fs.mkdirSync(path.join(targetProject, 'githooks', 'gates'), { recursive: true });
    fs.writeFileSync(
      path.join(callerProject, 'githooks', 'gates', 'gate-9-caller.sh'),
      'echo "__CALLER_REPO__"\n'
    );
    // The fragment is written into the target project only, so a relative probe
    // answers "which project did we run in?" without comparing path strings —
    // bash reports $PWD in POSIX form, which can never equal the Windows path
    // the test passes as an argument (#428).
    fs.writeFileSync(
      path.join(targetProject, 'githooks', 'gates', 'gate-9-target.sh'),
      [
        'if [ ! -f "githooks/gates/gate-9-target.sh" ]; then exit 88; fi',
        'if [ -f ".xpgate-caller-only" ]; then exit 88; fi',
        'echo "__TARGET_REPO__"',
      ].join('\n')
    );
    fs.writeFileSync(path.join(callerProject, '.xpgate-caller-only'), 'caller\n');

    const result = spawnSync(
      process.execPath,
      [path.join(packageFixture, 'bin', 'xp-gate.js'), 'check', '9', targetProject],
      {
        cwd: callerProject,
        encoding: 'utf8',
        timeout: 30000,
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('__TARGET_REPO__');
    expect(result.stdout).not.toContain('__CALLER_REPO__');
  }, 30000);

  it('sources fragment and helper paths containing shell metacharacters literally (REQ-standalone-gates-07)', () => {
    const runnerAbsPath = path.resolve(__dirname, '../gate-runner.js');
    const hostileRoot = path.join(tmpProject, hostilePathSegment());
    tmpAdapters = path.join(hostileRoot, 'githooks', 'adapters');
    fs.mkdirSync(tmpAdapters, { recursive: true });
    writeAdapterCommon();
    writeGateFragment([
      `if [ "${shellParameter('PROJECT_LANG')}" != "typescript" ]; then exit 87; fi`,
      'echo "__HOSTILE_PATH_OK__"',
    ]);

    const result = runChildAdapter(
      runnerAbsPath,
      path.join(tmpAdapters, 'gate-9.sh'),
      hostileRoot
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('__HOSTILE_PATH_OK__');
  }, 30000);

  it('loads parent-layout adapter-common and packaged now-ms through the public CLI (REQ-standalone-gates-08)', () => {
    const packageFixture = path.join(tmpProject, 'package');
    fs.cpSync(path.resolve(__dirname, '../..'), packageFixture, { recursive: true });
    const gatesDir = path.join(tmpProject, 'githooks', 'gates');
    fs.mkdirSync(gatesDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpProject, 'githooks', 'adapter-common.sh'),
      'detect_project_lang() { echo "parent-layout-language"; }\n'
    );
    fs.writeFileSync(
      path.join(gatesDir, 'gate-9-parent-helper.sh'),
      [
        `if [ "${shellParameter('PROJECT_LANG')}" != "parent-layout-language" ]; then exit 86; fi`,
        'if [ "$(now_ms)" != "424242" ]; then exit 85; fi',
        'echo "__PARENT_HELPER_OK__"',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(packageFixture, 'hooks', 'lib', 'now-ms.sh'),
      'now_ms() { echo 424242; }\n'
    );

    const result = spawnSync(
      process.execPath,
      [path.join(packageFixture, 'bin', 'xp-gate.js'), 'check', '9'],
      { cwd: tmpProject, encoding: 'utf8', timeout: 30000 }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('__PARENT_HELPER_OK__');
  }, 30000);

  it('propagates a failing fragment exit through the public CLI (REQ-standalone-gates-09)', () => {
    const packageFixture = path.join(tmpProject, 'package');
    const targetProject = path.join(tmpProject, 'failing-target');
    fs.cpSync(path.resolve(__dirname, '../..'), packageFixture, { recursive: true });
    const gatesDir = path.join(targetProject, 'githooks', 'gates');
    fs.mkdirSync(gatesDir, { recursive: true });
    fs.writeFileSync(path.join(gatesDir, 'gate-9-failure.sh'), 'exit 23\n');

    const result = spawnSync(
      process.execPath,
      [path.join(packageFixture, 'bin', 'xp-gate.js'), 'check', '9', targetProject],
      { cwd: tmpProject, encoding: 'utf8', timeout: 30000 }
    );

    expect(result.status).toBe(1);
  }, 30000);

  // The mirror image of the tests above, asserted on the resolver rather than on
  // CLI output. A project that declares no variant must resolve to nothing, so
  // the built-in implementation still runs.
  //
  // Asserted here, not through `check 9`: BOTH implementations print "Semgrep"
  // (githooks/gate-9.sh says it five times too), and a bash fallback that finds
  // no script prints neither banner, so every stdout-based assertion passed even
  // with the TypeScript module hard-disabled -- the guard proved nothing.
  it('resolves no variant when the project declares none (REQ-standalone-gates-05)', () => {
    const plainProject = path.join(tmpProject, 'plain-target');
    fs.mkdirSync(plainProject, { recursive: true });

    expect(findConsumerGateVariant('gate-9', plainProject)).toBe(null);
  });

  it('resolves the declared variant when the project has one (REQ-standalone-gates-05)', () => {
    const variantProject = path.join(tmpProject, 'variant-target');
    const gatesDir = path.join(variantProject, 'githooks', 'gates');
    fs.mkdirSync(gatesDir, { recursive: true });
    const variantPath = path.join(gatesDir, 'gate-9-project-choice.sh');
    fs.writeFileSync(variantPath, 'exit 0\n');

    const resolved = findConsumerGateVariant('gate-9', variantProject);
    expect(resolved).toBe(variantPath);
  });
});
