/**
 * @test REQ-CHECK-ARGS
 * @intent `xp-gate check <x>` 的位置参数**有歧义**：第一个位置参数既可能是
 *         gate（编号或别名），也可能是路径。消歧规则是：
 *
 *         - 能解析成 gate → 它就是 gate，第二个位置参数才是路径；
 *         - 解析不了 → 它是路径，没有 gate。
 *
 *         这条规则错了会往两个方向出错：把路径当 gate（跑到不存在的门上），
 *         或把 gate 当路径（扫错目录并报"没有发现问题"）。
 *
 * @covers AC-CHECK-ARGS-01
 * @covers AC-CHECK-ARGS-02
 * @covers AC-CHECK-ARGS-03
 */
import { describe, expect, it } from 'vitest';

const { parseCheckArgs, resolveGateToken } = require('../check.js');

describe('parseCheckArgs', () => {
  it('defaults to no flags and no target', () => {
    const parsed = parseCheckArgs([]);
    expect(parsed).toMatchObject({
      all: false, list: false, changed: false, brief: false, gateIds: null,
      positionals: [], pathArg: null, gateNumber: null,
    });
  });

  it('treats --gates with a separate value as a comma-separated list', () => {
    const parsed = parseCheckArgs(['--gates', '3, 4 ,5']);
    // Blank entries are dropped: a trailing comma must not yield an empty gate id.
    expect(parsed.gateIds).toEqual(['3', '4', '5']);
  });

  it('accepts --gates=<list> in the same form', () => {
    expect(parseCheckArgs(['--gates=3,4']).gateIds).toEqual(['3', '4']);
  });

  it('collects the boolean flags', () => {
    const parsed = parseCheckArgs(['--all', '--list', '--changed', '--brief']);
    expect(parsed).toMatchObject({ all: true, list: true, changed: true, brief: true });
  });

  it('reads a leading gate token and takes the NEXT positional as the path', () => {
    // The ambiguity that matters: `check 3 ./src` means "gate 3, on ./src".
    const gate = resolveGateToken('3');
    const parsed = parseCheckArgs(['3', './src']);
    expect(parsed.gateNumber).toBe(gate);
    expect(parsed.pathArg).toBe('./src');
  });

  it('treats an unresolvable first positional as the path, not a gate', () => {
    // A directory name is not a gate. Reporting it as gateNumber would run the
    // wrong thing; this must land in pathArg with no gate.
    const parsed = parseCheckArgs(['./some/directory']);
    expect(parsed.gateNumber).toBeNull();
    expect(parsed.pathArg).toBe('./some/directory');
  });

  it('keeps every positional in order even when one is a gate', () => {
    // `positionals` is the raw record; pathArg/gateNumber are the interpretation.
    expect(parseCheckArgs(['3', './src', 'extra']).positionals).toEqual(['3', './src', 'extra']);
  });

  it('ignores a trailing --gates with no value rather than crashing', () => {
    // A shell that expands an unset variable leaves the flag dangling; the parser
    // must not read args[i+1] out of bounds.
    const parsed = parseCheckArgs(['--gates']);
    expect(parsed.gateIds).toBeNull();
  });
});

describe('resolveGateToken', () => {
  it('resolves a numeric gate id', () => {
    expect(resolveGateToken('3')).not.toBeNull();
  });

  it('returns null for something that is not a gate', () => {
    expect(resolveGateToken('definitely-not-a-gate-token')).toBeNull();
  });
});
