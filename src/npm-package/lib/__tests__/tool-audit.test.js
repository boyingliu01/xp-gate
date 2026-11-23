/**
 * Tool audit: completeness, VALIDITY and uniqueness of every gate tool.
 *
 * Why this module exists (2026-11-23): `check-tools` only probed tools for the
 * languages detected in the current project, and `doctor` only probed its own
 * eight CLI entries. Neither could answer "is this tool set complete", and
 * neither could see that the same tool was installed twice. Two real defects
 * found on this machine and pinned below:
 *
 *   1. VALIDITY false positive: `psscriptanalyzer` is probed with
 *      `pwsh -Command "Get-Module -ListAvailable PSScriptAnalyzer"`. That command
 *      exits 0 with EMPTY output when the module is absent, so an exit-code-only
 *      probe reports "available" for a tool that cannot run. A probe that cannot
 *      distinguish "not installed" from "installed" makes "not checked" look
 *      like "passed" — this project's most repeated defect family.
 *
 *   2. Uniqueness: `hadolint` existed as two byte-identical 54 MB binaries
 *      (~/.local/bin and ~/.npm-global/bin) and `archlint` as an old 0.16.0
 *      binary shadowing a 0.17.1 npm install. Neither was visible to doctor.
 *
 * The audit is a pure description: it reports, it does not modify. Repair lives
 * in install-tools so the two responsibilities stay separable — a check that
 * also fixes things cannot be used to decide whether to fix.
 */
const {
  auditTool,
  summarizeAudit,
  parseVersion,
  compareVersions,
} = require('../tool-audit.js');

/** A tool entry shaped like LANGUAGE_REGISTRY entries. */
function tool(name, opts = {}) {
  return { name, checkCmd: `${name} --version`, optional: false, gates: [], ...opts };
}

describe('tool-audit: probe validity', () => {
  /**
   * @test REQ-TOOLS-001
   * @intent 探针"成功退出但无输出"必须判为不可用，不能因为 exit 0 就报 available
   * @covers AC-TOOLS-001-01
   */
  it('treats a zero-exit probe with empty output as NOT available', () => {
    const result = auditTool(tool('psscriptanalyzer'), {
      runProbe: () => ({ status: 0, stdout: '', stderr: '' }),
      locate: () => ['/home/u/.local/bin/psscriptanalyzer'],
    });
    // The module is absent; exit code alone must not carry the verdict.
    expect(result.available).toBe(false);
    expect(result.validityReason).toMatch(/no output|empty/i);
  });

  /**
   * @test REQ-TOOLS-001
   * @intent 有输出的成功探针才算可用
   * @covers AC-TOOLS-001-02
   */
  it('treats a zero-exit probe WITH output as available', () => {
    const result = auditTool(tool('eslint'), {
      runProbe: () => ({ status: 0, stdout: 'v10.15.0\n', stderr: '' }),
      locate: () => ['/home/u/.npm-global/bin/eslint'],
    });
    expect(result.available).toBe(true);
    expect(result.version).toBe('v10.15.0');
  });

  /**
   * @test REQ-TOOLS-001
   * @intent 探针非零退出即不可用，即使有输出
   * @covers AC-TOOLS-001-03
   */
  it('treats a non-zero exit as NOT available even when it printed something', () => {
    const result = auditTool(tool('broken'), {
      runProbe: () => ({ status: 1, stdout: 'error: cannot execute\n', stderr: '' }),
      locate: () => ['/home/u/.local/bin/broken'],
    });
    expect(result.available).toBe(false);
  });

  /**
   * @test REQ-TOOLS-001
   * @intent 探针本身抛异常（超时/ENOENT）要记为不可用并带原因，不能静默吞掉
   * @covers AC-TOOLS-001-04
   */
  it('records the reason when the probe throws', () => {
    const result = auditTool(tool('timeouty'), {
      runProbe: () => {
        throw new Error('ETIMEDOUT');
      },
      locate: () => [],
    });
    expect(result.available).toBe(false);
    expect(result.validityReason).toContain('ETIMEDOUT');
  });
});

describe('tool-audit: uniqueness', () => {
  /**
   * @test REQ-TOOLS-002
   * @intent 同一工具解析出多个路径时标记为重复，并保留全部路径
   * @covers AC-TOOLS-002-01
   */
  it('flags a tool found at more than one path as duplicated', () => {
    const result = auditTool(tool('hadolint'), {
      runProbe: () => ({ status: 0, stdout: 'Haskell Dockerfile Linter 2.14.0', stderr: '' }),
      locate: () => ['/home/u/.local/bin/hadolint', '/home/u/.npm-global/bin/hadolint'],
      realpath: (p) => p,
    });
    expect(result.duplicated).toBe(true);
    expect(result.paths).toHaveLength(2);
    expect(result.distinctRealPaths).toHaveLength(2);
  });

  /**
   * @test REQ-TOOLS-002
   * @intent 多个路径若解析到同一实体（软链），不算重复安装
   * @covers AC-TOOLS-002-02
   */
  it('does NOT count symlinks to one target as duplicates', () => {
    const result = auditTool(tool('semgrep'), {
      runProbe: () => ({ status: 0, stdout: '1.186.0\n', stderr: '' }),
      locate: () => ['/usr/local/bin/semgrep', '/home/u/.local/bin/semgrep'],
      realpath: () => '/home/u/.local/bin/semgrep',
    });
    expect(result.duplicated).toBe(false);
    expect(result.paths).toHaveLength(2);
    expect(result.distinctRealPaths).toHaveLength(1);
  });

  /**
   * @test REQ-TOOLS-002
   * @intent 单一安装不算重复
   * @covers AC-TOOLS-002-03
   */
  it('reports a single installation as unique', () => {
    const result = auditTool(tool('jscpd'), {
      runProbe: () => ({ status: 0, stdout: '5.4.3\n', stderr: '' }),
      locate: () => ['/home/u/.npm-global/bin/jscpd'],
      realpath: (p) => p,
    });
    expect(result.duplicated).toBe(false);
    expect(result.distinctRealPaths).toHaveLength(1);
  });
});

describe('tool-audit: version currency', () => {
  /**
   * @test REQ-TOOLS-003
   * @intent 已知最新版时给出 outdated 判定与可读版本号
   * @covers AC-TOOLS-003-01
   */
  it('marks an older version as outdated', () => {
    const result = auditTool(tool('hadolint'), {
      runProbe: () => ({ status: 0, stdout: 'Haskell Dockerfile Linter 2.14.0', stderr: '' }),
      locate: () => ['/home/u/.local/bin/hadolint'],
      realpath: (p) => p,
      latestVersion: '2.15.1',
    });
    expect(result.outdated).toBe(true);
    expect(result.installedVersion).toBe('2.14.0');
    expect(result.latestVersion).toBe('2.15.1');
  });

  /**
   * @test REQ-TOOLS-003
   * @intent 等于最新版时不算 outdated
   * @covers AC-TOOLS-003-02
   */
  it('does not mark an equal version as outdated', () => {
    const result = auditTool(tool('gitleaks'), {
      runProbe: () => ({ status: 0, stdout: 'gitleaks version 8.30.1', stderr: '' }),
      locate: () => ['/home/u/.local/bin/gitleaks'],
      realpath: (p) => p,
      latestVersion: '8.30.1',
    });
    expect(result.outdated).toBe(false);
  });

  /**
   * @test REQ-TOOLS-003
   * @intent 无法判定最新版时必须是 unknown，不能默认"最新"（未知≠通过）
   * @covers AC-TOOLS-003-03
   */
  it('reports unknown currency when the latest version cannot be determined', () => {
    const result = auditTool(tool('mystery'), {
      runProbe: () => ({ status: 0, stdout: '1.0.0\n', stderr: '' }),
      locate: () => ['/home/u/.local/bin/mystery'],
      realpath: (p) => p,
      latestVersion: null,
    });
    expect(result.outdated).toBeNull();
    expect(result.currency).toBe('unknown');
  });
});

describe('tool-audit: version parsing', () => {
  /**
   * @test REQ-TOOLS-003
   * @intent 从各家工具五花八门的版本输出里抽出 x.y.z
   * @covers AC-TOOLS-003-04
   */
  it('extracts a version from real tool banners', () => {
    expect(parseVersion('Haskell Dockerfile Linter 2.14.0')).toBe('2.14.0');
    expect(parseVersion('gitleaks version 8.30.1')).toBe('8.30.1');
    expect(parseVersion('jq-1.8.2')).toBe('1.8.2');
    expect(parseVersion('v10.15.0')).toBe('10.15.0');
    expect(parseVersion('ShellCheck - shell script analysis tool\nversion: 0.10.0')).toBe('0.10.0');
    expect(parseVersion('no digits here')).toBeNull();
  });

  /**
   * @test REQ-TOOLS-003
   * @intent 版本比较按数值而非字符串（1.10 > 1.9）
   * @covers AC-TOOLS-003-05
   */
  it('compares versions numerically, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('2.14.0', '2.15.1')).toBeLessThan(0);
    expect(compareVersions('5.4.3', '5.4.3')).toBe(0);
    expect(compareVersions('0.10.0', '0.11.0')).toBeLessThan(0);
  });
});

describe('tool-audit: summary', () => {
  /**
   * @test REQ-TOOLS-004
   * @intent 汇总必须同时暴露缺失/重复/过期/未知四类，缺一类就等于漏报
   * @covers AC-TOOLS-004-01
   */
  it('counts every problem category, never collapsing unknown into ok', () => {
    const entries = [
      { name: 'a', available: true, duplicated: false, outdated: false, currency: 'current' },
      { name: 'b', available: true, duplicated: true, outdated: true, currency: 'outdated' },
      { name: 'c', available: false, duplicated: false, outdated: null, currency: 'missing' },
      { name: 'd', available: true, duplicated: false, outdated: null, currency: 'unknown' },
    ];
    const s = summarizeAudit(entries);
    expect(s.total).toBe(4);
    expect(s.missing).toBe(1);
    expect(s.duplicated).toBe(1);
    expect(s.outdated).toBe(1);
    expect(s.unknown).toBe(1);
    expect(s.complete).toBe(false);
  });

  /**
   * @test REQ-TOOLS-004
   * @intent 全部正常时 complete=true
   * @covers AC-TOOLS-004-02
   */
  it('is complete only when nothing is missing, duplicated, outdated or unknown', () => {
    const s = summarizeAudit([
      { name: 'a', available: true, duplicated: false, outdated: false, currency: 'current' },
      { name: 'b', available: true, duplicated: false, outdated: false, currency: 'current' },
    ]);
    expect(s.complete).toBe(true);
  });
});

describe('tool-audit: npx-invoked tools', () => {
  /**
   * @test REQ-TOOLS-007
   * @intent 通过 `npx --no-install` 探测的工具没有独立可执行文件，which 找不到
   *         是正常的，不能据此判为缺失（archlint / dependency-cruiser 实况）
   * @covers AC-TOOLS-007-01
   */
  it('does not treat "no PATH entry" as missing when the probe succeeded', () => {
    const result = auditTool(
      { name: '@archlinter/cli', checkCmd: 'npx --no-install archlint --version', optional: true, gates: [] },
      {
        runProbe: () => ({ status: 0, stdout: 'archlint 0.16.0', stderr: '' }),
        locate: () => [],
        realpath: (p) => p,
        latestVersion: null,
      },
    );
    expect(result.available).toBe(true);
    expect(result.currency).not.toBe('missing');
    // Uniqueness is simply unknown when there is no PATH entry to count.
    expect(result.duplicated).toBe(false);
    expect(result.npxInvoked).toBe(true);
  });

  /**
   * @test REQ-TOOLS-007
   * @intent 报告里要能看出"这个工具是经 npx 调用的"，否则读者会以为 which 漏了
   * @covers AC-TOOLS-007-02
   */
  it('marks a tool whose check command goes through npx', () => {
    const result = auditTool(
      { name: 'depcruise', checkCmd: 'npx --no-install depcruise --version', optional: true, gates: [] },
      { runProbe: () => ({ status: 0, stdout: '18.9.0', stderr: '' }), locate: () => [], realpath: (p) => p, latestVersion: '18.9.0' },
    );
    expect(result.npxInvoked).toBe(true);
    expect(result.currency).toBe('current');
  });
});

describe('tool-audit: distinguishing real duplicates from coexisting runtimes', () => {
  /**
   * @test REQ-TOOLS-015
   * @intent 同一工具属于不同运行时/系统包时不算"重复安装"：/usr/bin/jq(系统) 与
   *         ~/.local/bin/jq(用户) 并存是设计状态，nvm 与系统 node 各带 npx 同理。
   *         把它们算作重复会让人去删系统包或另一个运行时。
   * @covers AC-TOOLS-015-01
   */
  it('does not call a system copy plus a user copy a duplicate install', () => {
    const result = auditTool(tool('jq'), {
      runProbe: () => ({ status: 0, stdout: 'jq-1.8.2', stderr: '' }),
      locate: () => ['/usr/bin/jq', '/home/u/.local/bin/jq'],
      realpath: (p) => p,
      latestVersion: '1.8.2',
    });
    expect(result.duplicated).toBe(false);
    expect(result.coexistingCopies).toBe(true);
    expect(result.systemCopies).toEqual(['/usr/bin/jq']);
  });

  /**
   * @test REQ-TOOLS-015
   * @intent 用户目录下的两份实体仍然算重复（hadolint 实况）
   * @covers AC-TOOLS-015-02
   */
  it('still calls two user-owned copies a duplicate install', () => {
    const result = auditTool(tool('hadolint'), {
      runProbe: () => ({ status: 0, stdout: '2.15.1', stderr: '' }),
      locate: () => ['/home/u/.local/bin/hadolint', '/home/u/.npm-global/bin/hadolint'],
      realpath: (p) => p,
      latestVersion: '2.15.1',
    });
    expect(result.duplicated).toBe(true);
    expect(result.systemCopies).toEqual([]);
  });
});

describe('tool-audit: coexisting node runtimes', () => {
  /**
   * @test REQ-TOOLS-015
   * @intent nvm 管理的 node 与系统 node 各带一份 npx 不属于"重复安装"，
   *         它们是两个运行时各自的组件（本机实况：nvm v26 + /usr/lib/node_modules）
   * @covers AC-TOOLS-015-03
   */
  it('does not call npx from two node runtimes a duplicate install', () => {
    const result = auditTool(tool('npx'), {
      runProbe: () => ({ status: 0, stdout: '11.20.0', stderr: '' }),
      locate: () => ['/home/u/.npm-global/bin/npx', '/usr/bin/npx'],
      realpath: (p) => (p.includes('.npm-global')
        ? '/home/u/.nvm/versions/node/v26.13.1/lib/node_modules/npm/bin/npx-cli.js'
        : '/usr/lib/node_modules/npm/bin/npx-cli.js'),
      latestVersion: '11.20.0',
    });
    expect(result.duplicated).toBe(false);
    expect(result.coexistingCopies).toBe(true);
  });
});

describe('tool-audit: async probing keeps the event loop free', () => {
  /**
   * @test REQ-TOOLS-017
   * @intent 同步探测会把事件循环堵死：实测 checkov 1.9s + semgrep 1.4s 串行同步执行，
   *         令同一进程里的 checkEnv `node --version`（正常 5ms）超时并被判 Not found。
   *         审计必须能在不阻塞事件循环的前提下完成探测。
   * @covers AC-TOOLS-017-01
   */
  it('offers an async probe path that does not block the event loop', async () => {
    const { auditAllToolsAsync } = require('../tool-audit.js');
    let ticked = false;
    // A probe that finishes on the next macrotask: only an async implementation
    // lets this timer fire before the audit resolves.
    setTimeout(() => {
      ticked = true;
    }, 0);
    const rows = await auditAllToolsAsync(
      [
        { name: 'a', checkCmd: 'a --version' },
        { name: 'b', checkCmd: 'b --version' },
      ],
      {
        // A probe that genuinely yields: the point under test is that the event
        // loop stays free while tools are probed, which a synchronously-resolved
        // value cannot demonstrate.
        runProbe: () => new Promise((resolve) => {
          setTimeout(() => resolve({ status: 0, stdout: '1.0.0', stderr: '' }), 5);
        }),
        locate: () => ['/x/a'],
        realpath: (p) => p,
        resolveLatest: () => null,
      },
    );
    expect(rows).toHaveLength(2);
    expect(ticked).toBe(true);
  });
});
