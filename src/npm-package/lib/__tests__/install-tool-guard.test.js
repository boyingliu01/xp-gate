/**
 * @test REQ-TOOLS-INSTALL-GUARD
 * @intent `installTool`（language-tools.js 的 840-881 行，零覆盖）决定要不要
 *         真的去 exec 一条安装命令。它有一个安全属性值得钉死：
 *
 *         `detectBy: 'build-file'` 的工具（ArchUnit、Konsist）是**库**，不是
 *         CLI，它们的 `install` 字段是写给人看的说明文字。把这些文字交给
 *         execSync，会在每台 Java 机器上打出
 *         `'add' is not recognized as an internal or external command`，在 POSIX
 *         上则真的当作命令执行（#689 review 发现）。
 *
 *         这条测试保证：无论平台如何，build-file 工具都不会启动任何进程。
 *
 * @covers AC-TOOLS-INSTALL-GUARD-01
 * @covers AC-TOOLS-INSTALL-GUARD-02
 */
'use strict';

// language-tools destructures `execSync` at load time, so neither a late spy nor
// vi.mock reaches it in this CommonJS file. Patching the property on the shared
// module object BEFORE requiring language-tools is what the destructure picks up.
const childProcess = require('node:child_process');
const realExecSync = childProcess.execSync;
let execSyncStub = () => {};
childProcess.execSync = (...args) => execSyncStub(...args);

const { installTool } = require('../language-tools.js');

describe('installTool', () => {
  let executed;

  beforeEach(() => {
    executed = [];
    execSyncStub = (cmd) => { executed.push(cmd); };
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    childProcess.execSync = realExecSync;
  });

  it('never runs a command for a build-file library', () => {
    // The prose an ArchUnit entry carries. Handing it to a shell is the defect.
    const result = installTool({
      name: 'ArchUnit',
      detectBy: 'build-file',
      install: { linux: 'add to build.gradle: testImplementation "com.tngtech.archunit:archunit:1.0"' },
    });
    expect(executed).toEqual([]);
    expect(result.success).toBe(false);
    expect(result.message).toContain('build-file library');
    expect(result.message).toContain('add to build.gradle');
  });

  it('runs the install command for a normal CLI tool', () => {
    const result = installTool({
      name: 'gitleaks',
      install: { linux: 'go install github.com/zricethezav/gitleaks/v8@latest' },
    });
    expect(executed).toHaveLength(1);
    expect(result.success).toBe(true);
    expect(result.message).toContain('installed successfully');
  });

  it('reports failure when no command exists for the platform', () => {
    const result = installTool({ name: 'weird', install: { solaris: 'pkg install weird' } });
    expect(executed).toEqual([]);
    expect(result.success).toBe(false);
    expect(result.message).toContain('No install command');
  });

  it('reports the error message when the installer fails', () => {
    execSyncStub = () => { throw new Error('boom'); };
    const result = installTool({ name: 'gitleaks', install: { linux: 'go install gitleaks' } });
    expect(result.success).toBe(false);
    expect(result.message).toContain('boom');
  });
});
