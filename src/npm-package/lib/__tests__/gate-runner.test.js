/**
 * @test REQ-standalone-gates gate-runner.js
 * @intent 验证 runGateAdapter 独立运行 gate 适配器片段时能提供钩子上下文
 * （gate_start_ms / record_gate_audit / now_ms / PROJECT_LANG / CHANGED_FILES），
 * 避免 "command not found" 误报。
 * @covers standalone gate adapter context
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

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
function runChildAdapter(gateRunnerAbsPath, fragmentPath) {
  const script = [
    `const { runGateAdapter } = require(${JSON.stringify(gateRunnerAbsPath)});`,
    `runGateAdapter(${JSON.stringify(fragmentPath)});`,
    "console.log('__ADAPTER_DONE__');",
  ].join('\n');
  try {
    const stdout = execFileSync(process.execPath, ['-e', script], {
      cwd: tmpProject,
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
});
