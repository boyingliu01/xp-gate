/**
 * @test REQ-gate2-verdict 重复代码门禁必须能判定失败（#853 的第二半）
 * @intent 修好 jscpd 入口探测只解决了"工具崩溃"，没有解决"门禁从不失败"。
 *   实测：jscpd 在不传 --threshold 时即使发现 66.7% 的重复也返回 exit 0，
 *   所以 `runJscpd` 直接转发它的退出码，Gate 2 对任何仓库都恒为 PASS。
 *
 *   这和 #853 是同一个症状的两个阶段：修复前是 `spawnSync npx ENOENT`
 *   （工具跑不起来），修复后变成"跑起来了但从不拦截"。只修路径会让门禁
 *   从"崩溃"变成"静默通过"——后者更危险，因为它看起来是绿的。
 *
 * @covers AC-GATE2-VERDICT-01, AC-GATE2-VERDICT-02, AC-GATE2-VERDICT-03
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { buildJscpdArgs } = require('../gate-runner');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-gate2-'));
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('#853 Gate 2 must be able to fail', () => {
  it('passes a --threshold so jscpd can return non-zero', () => {
    // Without this the gate can never block, whatever it finds.
    const args = buildJscpdArgs({ targetPath: tmpDir });
    const at = args.indexOf('--threshold');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(Number(args[at + 1])).toBeGreaterThan(0);
  });

  it('uses the same 15% the code-duplication principle rule uses', () => {
    // Two gates judging "how much duplication is too much" must not disagree;
    // a run that fails Gate 4 while passing Gate 2 teaches users the gates lie.
    const args = buildJscpdArgs({ targetPath: tmpDir });
    expect(args[args.indexOf('--threshold') + 1]).toBe('15');
  });

  it('lets a project config own the threshold when it declares one', () => {
    // jscpd reads `threshold` from its own config. Passing --threshold as well
    // would override the project's value with ours, which is the same
    // config-vs-CLI conflict that already cost the ignore list its entries.
    fs.writeFileSync(
      path.join(tmpDir, 'jscpd.conf.json'),
      JSON.stringify({ threshold: 3, ignore: ['**/vendor/**'] }),
    );
    const args = buildJscpdArgs({ targetPath: tmpDir });
    expect(args).toContain('--config');
    expect(args).not.toContain('--threshold');
  });

  it('honours a threshold declared in .jscpd.json, not just jscpd.conf.json', () => {
    // jscpd reads several config filenames. Measured on jscpd 5.4.3 with a fixture
    // at 66.7% duplication:
    //   .jscpd.json {threshold: 90}                -> exit 0  (config respected)
    //   .jscpd.json {threshold: 90} + --threshold 15 -> exit 1  (CLI won)
    // A project that sets 90 in .jscpd.json would have been overridden by our 15,
    // silently taking the decision away from the project that declared it.
    fs.writeFileSync(path.join(tmpDir, '.jscpd.json'), JSON.stringify({ threshold: 90 }));
    const args = buildJscpdArgs({ targetPath: tmpDir });
    expect(args).toContain('--config');
    expect(args).not.toContain('--threshold');
  });

  it('falls back to the default threshold when the config declares none', () => {
    // A config that exists but says nothing about the threshold must still let the
    // gate decide; otherwise Gate 2 would silently stop enforcing anything, which
    // is the very defect this change exists to fix.
    fs.writeFileSync(path.join(tmpDir, 'jscpd.conf.json'), JSON.stringify({ ignore: ['**/x/**'] }));
    const args = buildJscpdArgs({ targetPath: tmpDir });
    expect(args).toContain('--config');
    expect(args[args.indexOf('--threshold') + 1]).toBe('15');
  });

  it('falls back to the default threshold when the config is malformed', () => {
    // An unparseable config must not crash the gate or disable the threshold.
    fs.writeFileSync(path.join(tmpDir, 'jscpd.conf.json'), '{ not valid json');
    const args = buildJscpdArgs({ targetPath: tmpDir });
    expect(args[args.indexOf('--threshold') + 1]).toBe('15');
  });
});
