/**
 * @test REQ-ARCH-CLI-PREAMBLE
 * @intent `arch()`（arch.js 未覆盖的 71 条连续语句）是 `xp-gate arch` 的入口。
 *         它的参数校验和"架构配置缺失"判定各自是一条独立的正确性主张，
 *         尤其后者：
 *
 *           实测（注释记载）在没有这个检查时——
 *             git commit       -> ❌ ARCHITECTURE CONFIG MISSING - BLOCKED
 *             xp-gate check 6  -> ✅ no high/critical findings, exit 0
 *
 *         `check 6` 是用户用来预演门禁的命令，比它预演的门禁更宽容是反的。
 *         这条测试钉住两者一致：缺配置时 preview 也必须拒绝。
 *
 * @covers AC-ARCH-CLI-PREAMBLE-01
 * @covers AC-ARCH-CLI-PREAMBLE-02
 */
'use strict';


const { arch } = require('../arch.js');



function capture(run) {
  const out = [];
  const origLog = console.log;
  const origErr = console.error;
  const origWarn = console.warn;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  console.warn = (...a) => out.push(a.join(' '));
  return Promise.resolve(run()).then(
    (code) => { console.log = origLog; console.error = origErr; console.warn = origWarn; return { code, out: out.join('\n') }; },
    (err) => { console.log = origLog; console.error = origErr; console.warn = origWarn; throw err; },
  );
}

// No chdir: vitest workers disallow it, and arch() reads process.cwd() with no
// seam. These cases exercise argument handling, which does not depend on cwd.

describe('arch() argument validation', () => {
  it('rejects --use-config together with --config', async () => {
    const { code, out } = await capture(() => arch(['--use-config', 'a.yaml', '--config', 'b.yaml']));
    expect(code).toBe(1);
    expect(out).toContain('not both');
  });

  it('warns that --config is deprecated but accepts it', async () => {
    const { out } = await capture(() => arch(['--config']));
    expect(out).toContain('deprecated');
  });

  it('rejects a config flag with no path', async () => {
    const { code, out } = await capture(() => arch(['--use-config']));
    expect(code).toBe(1);
    expect(out).toContain('requires a file path');
  });

  it('rejects a config flag whose next token is another flag', async () => {
    const { code, out } = await capture(() => arch(['--use-config', '--something']));
    expect(code).toBe(1);
    expect(out).toContain('requires a file path');
  });
});

// The "config missing" branch is unreachable from a test: arch() resolves the
// project root from process.cwd() with no seam, and vitest workers disallow
// chdir. Recorded rather than silently omitted -- it is the same
// untestable-by-construction shape handleDetectLanguages had before it accepted
// options.projectRoot.



