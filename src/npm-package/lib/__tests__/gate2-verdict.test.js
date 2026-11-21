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

const { buildJscpdArgs, classifyJscpdRun } = require('../gate-runner');

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

  it('ignores a DIRECTORY that happens to be named like a config file', () => {
    // `--config <dir>` cannot work, so a stray directory must not be discovered as
    // a config: it would turn the gate red for a reason that has nothing to do with
    // duplication.
    fs.mkdirSync(path.join(tmpDir, '.jscpd.json'));
    const args = buildJscpdArgs({ targetPath: tmpDir });
    expect(args).not.toContain('--config');
    expect(args[args.indexOf('--threshold') + 1]).toBe('15');
  });

  it('never applies the working directory config to an explicit target', () => {
    // The stated rule is "an explicit --target decides". Measured before this was
    // enforced: with only the xp-gate repo holding a jscpd.conf.json, a target with
    // no config of its own still received `--config <xp-gate repo>/jscpd.conf.json`
    // -- so `check 2 /other/repo` judged that repo by this repo's ignore list.
    // The fixture keeps its own cwd config out of the picture by asserting on the
    // config PATH rather than on presence.
    const args = buildJscpdArgs({ targetPath: tmpDir });
    const at = args.indexOf('--config');
    if (at >= 0) {
      expect(args[at + 1].startsWith(tmpDir)).toBe(true);
    }
    // A target with no config must never produce one of its own.
    expect(args).not.toContain('--config');
  });

  it('falls back to the default threshold when the config is malformed', () => {
    // An unparseable config must not crash the gate or disable the threshold.
    // Measured on jscpd 5.4.3: passing a corrupt --config makes jscpd exit 1 with
    // "key must be a string at line 1 column 3" -- which the gate would report as
    // "duplicate code found". A broken config must not read as a finding.
    fs.writeFileSync(path.join(tmpDir, 'jscpd.conf.json'), '{ not valid json');
    const args = buildJscpdArgs({ targetPath: tmpDir });
    expect(args[args.indexOf('--threshold') + 1]).toBe('15');
    expect(args).not.toContain('--config');
  });

  it('does not pass a --config jscpd would reject', () => {
    // Same rule, stated as the invariant: whatever --config we pass must parse.
    fs.writeFileSync(path.join(tmpDir, 'jscpd.conf.json'), '{ not valid json');
    const args = buildJscpdArgs({ targetPath: tmpDir });
    expect(args).not.toContain('--config');
  });
});

/**
 * @test REQ-GATE2-NO-FILES the CLI must not report "clean" when jscpd analysed zero files
 * @intent `xp-gate check 2` captures jscpd's stream and classifies it BEFORE deciding the
 *         verdict. The shell hook already does this (`classify_jscpd_run` in
 *         githooks/lib/jscpd-run.sh, pinned by gate-2-no-files.test.bats); the CLI path
 *         had no equivalent, so the same defect survived there.
 * @covers AC-855-01 AC-855-02 AC-855-03 AC-855-04
 *
 * #855 measured on 0.38.76: a two-file fixture jscpd refuses to parse (below its
 * min-tokens floor) produced `Files analyzed: 0`, jscpd's own
 * `Warning: jscpd analyzed no files`, and `exit 0` from `xp-gate check 2` with
 * "No duplicates found." A scan that read nothing was indistinguishable from a scan
 * that read the change set and found it clean -- the exact failure family both
 * AGENTS.md files name.
 */
describe('#855 Gate 2 must not call an empty scan clean', () => {
  it('classifies an "analyzed no files" warning as no_files, not clean', () => {
    const out = [
      'No duplicates found.',
      '| Format | Files analyzed | Total lines | Total tokens | Clones found |',
      'Found 0 clones.',
      'time: 8.279ms',
      'Warning: jscpd analyzed no files: check the paths and the --format, --ignore and --pattern filters',
    ].join('\n');
    expect(classifyJscpdRun(0, out)).toBe('no_files');
  });

  it('keeps a real scan with zero clones as clean', () => {
    // Anti-vacuity: if every "Found 0 clones" became no_files the gate would skip
    // every project, trading a silent pass for a permanent skip.
    const out = ['| Total: | 12 | 340 | 2100 | 0 |', 'Found 0 clones.'].join('\n');
    expect(classifyJscpdRun(0, out)).toBe('clean');
  });

  it('keeps a real scan with clones as duplicates', () => {
    const out = ['| Total: | 12 | 340 | 2100 | 3 |', 'Found 3 clones.'].join('\n');
    expect(classifyJscpdRun(0, out)).toBe('duplicates');
  });

  it('lets a non-zero exit win over the no-files warning', () => {
    // A failed run is the more specific fact; calling it no_files would hide it.
    expect(classifyJscpdRun(2, 'Warning: jscpd analyzed no files: check the paths')).toBe('error');
  });

  it('treats a report with no clones line and no files line as no_files', () => {
    // Measured shape: an --ignore that excludes everything prints one timing line.
    expect(classifyJscpdRun(0, 'time: 0.156ms')).toBe('no_files');
  });

  it('does not turn an unfamiliar but non-empty report into a skip', () => {
    // The pre-existing tolerance, kept deliberately: a future jscpd format must not
    // disable the gate for everyone whose output we do not recognise.
    const out = 'some future jscpd format\nformat v9\nclones: none detected\nfiles scanned: 14';
    expect(classifyJscpdRun(0, out)).toBe('clean');
  });
});
