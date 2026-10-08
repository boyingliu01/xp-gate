/**
 * @test REQ-488 Round 3: the release notes must state the command contract the code implements
 * @intent Feasibility Round 2 打中两条纯文档缺陷，但它们的后果是使用面：(1) #429 那条
 *         破坏性变更给出的升级后冒烟命令 `node scripts/delphi-external-review.cjs
 *         --expert ... --mode ... --profile ... --config ... --input-file ...` 少写了
 *         runner 必需的 `--round`（scripts/delphi-external-review.cjs 的 required-args
 *         校验），照抄发布说明的人得到 "Missing required arguments: --round"，无法区分
 *         "我的配置还没修好" 与 "发布说明是错的"；(2) 变更条目写"doctor 现在只接受
 *         --fix/--sync-hooks"，实现接受四个（--force/--install-tools），而它建议的迁移
 *         方式是"删掉脚本里多余的 flag"——照做的人会删掉保护机器独有内容的 --force，
 *         于是发散模块被静默跳过、旧的 Gate 3/4/7/8/9/10 实现继续执行，正是 #493
 *         长期不可见的成因。第三钉：历史发布说明承诺过 `doctor --format json`
 *         （v0.13.x #304），严格 flag 白名单落地后它变成 exit 1，实现必须补上而不是让文档继续说谎。
 * @covers AC-488-06, AC-488-07, AC-429-05
 */
'use strict';

const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const REPO = resolve(__dirname, '..', '..');
const CHANGELOG = readFileSync(resolve(REPO, 'CHANGELOG.md'), 'utf8');
const DOCTOR = readFileSync(resolve(REPO, 'src', 'npm-package', 'lib', 'doctor.js'), 'utf8');
const RUNNER = readFileSync(resolve(REPO, 'scripts', 'delphi-external-review.cjs'), 'utf8');

function knownFlags(source) {
  const line = source.match(/const KNOWN_FLAGS\s*=\s*\[([^\]]*)\]/);
  if (!line) throw new Error('doctor.js declares no KNOWN_FLAGS array');
  const flags = line[1]
    .split(',')
    .map((entry) => entry.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
  // A mis-read array must fail here, not silently shrink what the entry is
  // checked against (the guard would otherwise pass against a partial list).
  for (const flag of flags) {
    expect(flag, `KNOWN_FLAGS parsed as ${flag}, which is not a flag`).toMatch(/^--[a-z][a-z0-9-]*$/);
  }
  expect(flags.length).toBeGreaterThanOrEqual(4);
  return flags;
}

function requiredRunnerArgs(source) {
  // The runner's own guard: `if (!args.X) missing.push('--flag')`.
  const guards = [...source.matchAll(/missing\.push\(['"](--[\w-]+)(?: or --[\w-]+)?['"]\)/g)];
  if (guards.length === 0) throw new Error('could not read the runner required-argument guard');
  // Counting the pushes and the `missing.push` statements against each other is
  // what keeps a flag guarded through a different idiom from being dropped
  // silently -- the alternative would be AC-429-05 passing while a required
  // argument goes undocumented (#488 Round 3, feasibility FC-03).
  const statements = (source.match(/missing\.push\(/g) || []).length;
  expect(guards.length, 'the runner has missing.push statements this parser does not read').toBe(statements);
  return guards.map((m) => m[1]);
}

describe('release notes describe the real command contract (#488/#429 Round 3)', () => {
  it('AC-429-05: every delphi-external-review command in the release notes passes the runner required-argument check', () => {
    const commands = [...CHANGELOG.matchAll(/node scripts\/delphi-external-review\.cjs[^\n`]*/g)].map((m) => m[0]);
    expect(commands.length, 'the release notes document at least one runner invocation').toBeGreaterThan(0);
    const required = requiredRunnerArgs(RUNNER);
    for (const command of commands) {
      for (const flag of required) {
        if (flag === '--input') {
          // --input and --input-file are alternatives; either satisfies the guard.
          expect(
            /--input(\s|=)|--input-file/.test(command),
            `documented command lacks an input argument: ${command}`,
          ).toBe(true);
          continue;
        }
        expect(command, `documented command lacks ${flag}: ${command}`).toContain(flag);
      }
    }
  });

  it('AC-488-06: the doctor Changed entry names exactly the flags the parser accepts', () => {
    const flags = knownFlags(DOCTOR);
    const entry = CHANGELOG.match(/^- \*\*未知命令行参数不再静默 no-op.*$/m);
    expect(entry, 'the flag-contract Changed entry is missing from the release notes').not.toBeNull();
    for (const flag of flags) {
      expect(entry[0], `release notes do not mention ${flag}`).toContain(flag);
    }
    // The entry must not read as a shrinking of the accepted set.
    expect(entry[0], 'claiming a two-flag surface would push users to delete --force').not.toMatch(/只接受\s*`--fix`\/`--sync-hooks`\s*，/);
  });

  it('AC-488-07: a flag the release notes promise for doctor is one the parser accepts', () => {
    const promised = [...CHANGELOG.matchAll(/`xp-gate doctor ((?:--[\w-]+(?: <value>| \[[^\]]*\])?)+)`/g)]
      .flatMap((m) => [...m[1].matchAll(/--[\w-]+/g)].map((f) => f[0]));
    const jsonPromised = /doctor --format json|--format json/.test(CHANGELOG);
    const accepted = new Set(knownFlags(DOCTOR));
    for (const flag of new Set(promised)) {
      expect(accepted.has(flag), `doctor documents ${flag} but rejects it`).toBe(true);
    }
    if (jsonPromised) {
      expect(accepted.has('--format'), 'CHANGELOG advertises doctor --format json while the flag is not accepted').toBe(true);
    }
  });
});
