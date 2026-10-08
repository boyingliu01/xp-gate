/**
 * @test REQ-496 xp-gate doctor compares configured paths the way the OS does
 * @intent doctor 用 `git config core.hooksPath` 的字符串直接 !== path.join 生成的常量：
 *         Windows 上 git 回读的是正斜杠形式，常量是反斜杠形式，两者指向同一目录却被
 *         判为不一致，于是每台配置正确的机器都恒报 FAIL，而 --fix 写入后回读仍是斜杠
 *         形式、永远消不掉（#496）。本套件把"同一目录"的判定收敛到一个比较器上。
 * @covers AC-496-01, AC-496-02, AC-496-03
 */
const fs = require('fs');
const path = require('path');

describe('doctor path equivalence (#496)', () => {
  function comparator() {
    const { pathsEquivalent } = require('../doctor');
    return pathsEquivalent;
  }

  it('AC-496-01: the same directory spelled with either separator is equivalent', () => {
    const same = comparator();
    expect(typeof same).toBe('function');
    const back = 'C:\\Users\\think\\.config\\xp-gate\\hooks';
    const slash = 'C:/Users/think/.config/xp-gate/hooks';
    expect(same(slash, back)).toBe(true);
    expect(same(back, slash)).toBe(true);
  });

  it('AC-496-02: drive-letter case and a trailing separator do not break equivalence', () => {
    const same = comparator();
    expect(same('c:/Users/think/.config/xp-gate/hooks', 'C:\\Users\\think\\.config\\xp-gate\\hooks')).toBe(true);
    expect(same('C:/Users/think/.config/xp-gate/hooks/', 'C:\\Users\\think\\.config\\xp-gate\\hooks')).toBe(true);
    // POSIX paths must keep working (no drive letter, leading slash is content).
    expect(same('/home/u/.config/xp-gate/hooks', '/home/u/.config/xp-gate/hooks')).toBe(true);
    expect(same('/home/u/.config/xp-gate/hooks/', '/home/u/.config/xp-gate/hooks')).toBe(true);
  });

  it('AC-496-03: different directories still compare unequal, including near misses', () => {
    const same = comparator();
    expect(same('C:/Users/think/.config/xp-gate/hooks', 'C:/Users/think/.config/xp-gate/hooks-v2')).toBe(false);
    expect(same('C:/Users/other/.config/xp-gate/hooks', 'C:/Users/think/.config/xp-gate/hooks')).toBe(false);
    expect(same('/home/u/.config/xp-gate/hooks', '/home/u/.config/xp-gate/adapters')).toBe(false);
    // A path that is a prefix of another is not the same directory.
    expect(same('/home/u/.config/xp-gate', '/home/u/.config/xp-gate/hooks')).toBe(false);
    expect(same('', 'C:/Users/think/.config/xp-gate/hooks')).toBe(false);
  });

  it('AC-496-04: anti-vacuity -- the comparator is what the hooksPath check uses', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'doctor.js'),
      'utf8'
    );
    // The two comparison sites that made the Windows call fail must both route
    // through the equivalence check rather than a byte comparison.
    const callSites = source
      .split('\n')
      .filter((line) => /hooksPath\s*!==\s*GLOBAL_HOOKS_DIR/.test(line));
    expect(callSites).toHaveProperty('length', 0);
    expect(source).toMatch(/pathsEquivalent\(hooksPath, GLOBAL_HOOKS_DIR\)/);
  });
});
