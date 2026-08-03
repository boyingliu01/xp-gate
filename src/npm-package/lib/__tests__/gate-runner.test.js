/**
 * @test REQ-standalone-gates gate-runner.js
 * @intent 验证 runGateAdapter 独立运行 gate 适配器片段时能提供钩子上下文
 * （gate_start_ms / record_gate_audit / now_ms / PROJECT_LANG / CHANGED_FILES），
 * 避免 "command not found" 误报。
 * @covers standalone gate adapter context
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

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

// Runs runGateAdapter in a child node process (worker threads forbid process
// chdir, and runGateAdapter execs bash), capturing stdout/exit status.
function runChildAdapter(gateRunnerAbsPath, fragmentPath, adapterCommonPath) {
  const script = `
    const { runGateAdapter } = require(${JSON.stringify(gateRunnerAbsPath)});
    runGateAdapter(${JSON.stringify(fragmentPath)});
    console.log('__ADAPTER_DONE__');
  `;
  try {
    const stdout = require('child_process').execFileSync(process.execPath, ['-e', script], {
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
      'if [ -z "${PROJECT_LANG:-}" ]; then exit 99; fi',
      'if [ -z "${CHANGED_FILES:-}" ]; then exit 98; fi',
      'record_gate_audit "gate-9" "sast" "PASS" "0" "$USES_START"',
    ]);
    const fragPath = path.join(tmpAdapters, 'gate-9.sh');
    const { status, stdout } = runChildAdapter(
      runnerAbsPath, fragPath, path.join(tmpAdapters, 'adapter-common.sh')
    );
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
      'if [ -z "${PROJECT_LANG:-}" ]; then exit 94; fi',
      'if [ -z "${CHANGED_FILES:-}" ]; then exit 93; fi',
    ]);
    const fragPath = path.join(tmpAdapters, 'gate-9.sh');
    const { status, stdout } = runChildAdapter(
      runnerAbsPath, fragPath, path.join(tmpAdapters, 'adapter-common.sh')
    );
    expect(status).toBe(0);
    expect(stdout).toContain('__ADAPTER_DONE__');
  }, 30000);

  it('sources adapter-common.sh to provide detect_project_lang (REQ-standalone-gates-03)', () => {
    const runnerAbsPath = path.resolve(__dirname, '../gate-runner.js');
    writeAdapterCommon();
    writeGateFragment([
      'if [ "${PROJECT_LANG:-}" != "typescript" ]; then exit 92; fi',
    ]);
    const fragPath = path.join(tmpAdapters, 'gate-9.sh');
    const { status, stdout } = runChildAdapter(
      runnerAbsPath, fragPath, path.join(tmpAdapters, 'adapter-common.sh')
    );
    expect(status).toBe(0);
    expect(stdout).toContain('__ADAPTER_DONE__');
  }, 30000);
});
