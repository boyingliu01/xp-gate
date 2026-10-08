/**
 * @test REQ-416
 * @intent install-skill 的用法字符串删掉了 --offline，但 parseOptions 对认不出的 flag
 *         照旧静默忽略 —— 这正是 #488 给 doctor 修掉的同一类缺陷：用户执行了已不存在的
 *         flag，得到 exit 0 与「安装成功」，而 flag 从未生效（Round 1 架构席位 MA-02）
 * @covers AC-416-06
 */
const { parseSkillFlags } = require('../shared-utils');

describe('parseSkillFlags (#416)', () => {
  it('parses the flags the skill commands implement', () => {
    const { options, unknown } = parseSkillFlags(['--verbose', '--force'], 'install-skill');

    expect(options).toMatchObject({ verbose: true, force: true, all: false, check: false });
    expect(unknown).toEqual([]);
  });

  it('names a flag it does not implement instead of swallowing it', () => {
    const { unknown } = parseSkillFlags(['--offline', '--verbose'], 'install-skill');

    expect(unknown).toEqual(['--offline']);
  });

  it('treats a value argument as unknown rather than silently dropping it', () => {
    expect(parseSkillFlags(['main'], 'install-skill').unknown).toEqual(['main']);
  });

  it('reports no unknown flag for an empty argument list', () => {
    expect(parseSkillFlags([], 'install-skill')).toEqual({
      options: { verbose: false, force: false, all: false, check: false },
      unknown: [],
    });
  });

  // Round 2 architecture MI-04: one global table meant `install-skill x --all`
  // parsed clean and then dropped options.all on the floor -- parsed-but-not-
  // consumed is the same silent no-op this branch exists to remove.
  it('accepts a flag only for the command that consumes it', () => {
    expect(parseSkillFlags(['--all'], 'install-skill').unknown).toEqual(['--all']);
    expect(parseSkillFlags(['--check'], 'uninstall-skill').unknown).toEqual(['--check']);
    expect(parseSkillFlags(['--verbose'], 'uninstall-skill').unknown).toEqual(['--verbose']);

    const update = parseSkillFlags(['--all', '--check', '--verbose'], 'update-skill');
    expect(update.unknown).toEqual([]);
    expect(update.options).toMatchObject({ all: true, check: true, verbose: true });
    expect(parseSkillFlags(['--force'], 'uninstall-skill').unknown).toEqual([]);
  });
});
