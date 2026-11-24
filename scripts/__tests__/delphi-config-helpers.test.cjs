/**
 * @test REQ-DELPHI-CONFIG-HELPERS
 * @intent 两个从 `readConfig`（CCN 31）提取出来的判断，各自守护一次真实的误诊：
 *
 *         `expandEnvPlaceholder`：`${VAR}` 未展开时是一个**合法的非空字符串**，
 *         所以校验会通过，失败留到网络层表现为 DNS 错误——而配置文件看起来是
 *         对的。同样的遗漏先在 `api_key` 上发生过（发出的字面量成了
 *         `Bearer ${NAME}`，401 被诊断成"检查 API key"），后来又在 `base_url`
 *         上重演一次。
 *
 *         `clampConsensusSetting`：静默钳制会改变该机器上"共识"的含义，操作者
 *         必须能看到它被钳过。
 *
 * @covers AC-DELPHI-CONFIG-HELPERS-01
 * @covers AC-DELPHI-CONFIG-HELPERS-02
 */
'use strict';

const { expandEnvPlaceholder, clampConsensusSetting } = require('../delphi-external-review.cjs');

function withEnv(name, value, run) {
  const prev = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try { return run(); } finally {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  }
}

describe('expandEnvPlaceholder', () => {
  it('returns a literal value untouched', () => {
    expect(expandEnvPlaceholder('sk-literal', 'api_key', 'p', 'prov')).toBe('sk-literal');
    expect(expandEnvPlaceholder(undefined, 'api_key', 'p', 'prov')).toBe(undefined);
  });

  it('expands a set variable', () => {
    withEnv('XP_TEST_VAR', 'resolved', () => {
      expect(expandEnvPlaceholder('${XP_TEST_VAR}', 'api_key', 'p', 'prov')).toBe('resolved');
    });
  });

  it('fails loudly when the variable is missing', () => {
    // Not a warning and not a fallback to the literal: the literal is a valid
    // non-empty string, which is exactly how the failure reached the network layer.
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`exit:${code}`); });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    withEnv('XP_TEST_MISSING', undefined, () => {
      expect(() => expandEnvPlaceholder('${XP_TEST_MISSING}', 'base_url', 'p', 'prov'))
        .toThrow('exit:1');
    });
    const printed = err.mock.calls.join('\n');
    expect(printed).toContain('XP_TEST_MISSING');
    expect(printed).toContain('base_url');
    exit.mockRestore();
    err.mockRestore();
  });

  it('treats a partial placeholder as a literal', () => {
    // Only a whole `${...}` is a placeholder; `${X}/v1` is a template someone
    // may be building by hand.
    expect(expandEnvPlaceholder('${A}${B}', 'base_url', 'p', 'prov')).toBe('${A}${B}');
    expect(expandEnvPlaceholder('$NOTAVAR', 'api_key', 'p', 'prov')).toBe('$NOTAVAR');
  });
});

describe('clampConsensusSetting', () => {
  const rounds = { min: 1, max: 5, fallback: 5, clamp: (n) => Math.min(5, Math.max(1, Math.trunc(n))) };

  it('uses the configured value when it is in range', () => {
    expect(clampConsensusSetting(3, rounds)).toEqual({ value: 3, clamped: false });
  });

  it('clamps above and below the range, and says so', () => {
    expect(clampConsensusSetting(99, rounds)).toEqual({ value: 5, clamped: true });
    expect(clampConsensusSetting(0, rounds)).toEqual({ value: 1, clamped: true });
  });

  it('reports a clamp when the configured value is unusable, not just out of range', () => {
    // The existing contract (delphi-external-review.test.cjs) treats an
    // unparseable value as a change worth reporting: a setting the operator wrote
    // is not the one in force either way. I had this returning `false` and the
    // suite caught it.
    expect(clampConsensusSetting('lots', rounds)).toEqual({ value: 5, clamped: true });
    expect(clampConsensusSetting(NaN, rounds)).toEqual({ value: 5, clamped: true });
  });

  it('reports no clamp when nothing was configured at all', () => {
    // An absent key is not a value the operator wrote, so there is nothing to have
    // altered.
    expect(clampConsensusSetting(undefined, rounds)).toEqual({ value: 5, clamped: false });
  });
});
