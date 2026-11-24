/**
 * @test REQ-ARCH-BUILTIN-SCAN
 * @intent 零容忍模式（没有基线文件时）的判据，是**四个信号的交集**，每一个都能
 *         单独让人误判：
 *
 *         1. archlint 的退出码：0/1 是判决，**其它都是工具故障**（127 = 命令找不到
 *            必须阻断，不能读成"干净"）；
 *         2. JSON 必须可解析且含 `smells` 数组，否则是 schema 漂移 → fail closed；
 *         3. 解析出的 high/critical 数量才是真正的阻断依据；
 *         4. 退出码 1 但解析不出 high/critical——**仍然阻断**。这是最关键的一条：
 *            工具说有失败，而我们的解析说不出为什么，那么"相信解析结果并放行"就是
 *            让一个说不清的失败通过。
 *
 * @covers AC-ARCH-BUILTIN-01
 * @covers AC-ARCH-BUILTIN-02
 * @covers AC-ARCH-BUILTIN-03
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { __internals } = require('../arch.js');

let root;
let out;
let err;

/** A stand-in archlint: emits `stdout` and exits with `code`. */
function fakeArchlint(code, stdout = '') {
  const script = join(root, 'fake-archlint.js');
  try {
    writeFileSync(script, `process.stdout.write(${JSON.stringify(stdout)});\nprocess.exit(${code});\n`);
  } catch (e) {
    throw new Error(`cannot write fake archlint: ${e.message}`);
  }
  return { kind: 'node-script', script, source: 'test double' };
}

const CLEAN = JSON.stringify({ smells: [], summary: { files_analyzed: 5, total_smells: 0 } });
const ONE_HIGH = JSON.stringify({
  smells: [{ severity: 'high', rule: 'cycle' }],
  summary: { files_analyzed: 5, total_smells: 1 },
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'xp-gate-arch-scan-'));
  out = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a) => err.push(a.join(' ')));
  // `runWithConfig` announces itself on console.warn; not capturing it made the
  // opt-in assertion below assert against an empty buffer.
  vi.spyOn(console, 'warn').mockImplementation((...a) => err.push(a.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('runBuiltinScan', () => {
  it('passes a clean scan', () => {
    expect(__internals.runBuiltinScan(root, fakeArchlint(0, CLEAN))).toBe(0);
  });

  it('blocks a scan with a high finding', () => {
    expect(__internals.runBuiltinScan(root, fakeArchlint(1, ONE_HIGH))).toBe(1);
    expect(err.join('\n')).toContain('BLOCKED');
  });

  it('blocks on exit 1 even when the parse shows no high finding', () => {
    // The fail-closed rule: the tool said failure and we cannot explain it. Passing
    // here would let an unexplained failure through.
    expect(__internals.runBuiltinScan(root, fakeArchlint(1, CLEAN))).toBe(1);
    expect(err.join('\n')).toContain('failed-closed'.replace('failed', 'fail'));
  });

  it('blocks on ANY exit code outside 0/1', () => {
    // 127 is "command not found"; reading it as clean is the defect.
    for (const code of [2, 127]) {
      expect(__internals.runBuiltinScan(root, fakeArchlint(code, CLEAN))).toBe(1);
    }
  });

  it('blocks when the JSON is unparseable', () => {
    expect(__internals.runBuiltinScan(root, fakeArchlint(0, 'not json'))).toBe(1);
    expect(err.join('\n')).toContain('could not be parsed');
  });

  it('blocks when the payload has no smells array', () => {
    expect(__internals.runBuiltinScan(root, fakeArchlint(0, '{}'))).toBe(1);
    expect(err.join('\n')).toContain('no smells array');
  });

  it('delegates to the ratchet when a baseline file exists', () => {
    // Two different policies; the presence of the baseline decides which one runs.
    try {
      writeFileSync(join(root, '.architecture-baseline.json'), '{}');
    } catch (e) {
      throw new Error(`cannot write baseline: ${e.message}`);
    }
    __internals.runBuiltinScan(root, fakeArchlint(0, CLEAN));
    expect(out.join('\n')).toContain('Baseline ratchet mode');
  });

  it('announces the mode it chose, so the policy in force is visible', () => {
    __internals.runBuiltinScan(root, fakeArchlint(0, CLEAN));
    expect(out.join('\n')).toContain('Zero-tolerance mode');
  });
});

describe('runWithConfig', () => {
  it('warns that the config path is opt-in and validated by archlint itself', () => {
    // The warning is the contract: a pre-0.16 architecture.yaml is rejected by
    // archlint, not by us, and the reader needs to know that before debugging.
    __internals.runWithConfig('/tmp/architecture.yaml', root, fakeArchlint(0, CLEAN));
    const text = [...out, ...err].join('\n');
    expect(text).toContain('opt-in config path');
    expect(text).toContain('validates its own config schema');
  });

  it('returns the tool exit code as the verdict', () => {
    expect(__internals.runWithConfig('/c.yaml', root, fakeArchlint(0, CLEAN))).toBe(0);
  });
});
