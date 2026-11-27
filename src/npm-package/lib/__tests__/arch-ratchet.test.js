/**
 * @test REQ-ARCH-RATCHET
 * @intent 基线棘轮模式的判据是 **archlint 的退出码本身**：`--fail-on high` 下
 *         0 = 没有新的 high+ 问题，1 = 至少有一个。
 *
 *         两条不能松的规则：
 *         1. **任何非 0/1 的退出码都是工具故障，按阻断处理**。把 2（或 127，
 *            通常是"命令找不到"）读成"没问题"，就是让一个跑不起来的工具
 *            静默地放行代码。
 *         2. 阻断时必须告诉人**怎么修**：给出刷新基线的确切命令。只说"被阻断"
 *            会让人去猜。
 *
 *         这里用一个可控的小 node 脚本冒充 archlint，让退出码完全由测试指定——
 *         断言的是契约，不是真实的 archlint 行为。
 *
 * @covers AC-ARCH-RATCHET-01
 * @covers AC-ARCH-RATCHET-02
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { __internals } = require('../arch.js');

let root;
let out;
let err;

/** A stand-in archlint whose exit code and stdout the test chooses. */
function fakeArchlint(code, stdout = '') {
  const script = join(root, 'fake-archlint.js');
  try {
    writeFileSync(
      script,
      `process.stdout.write(${JSON.stringify(stdout)});\nprocess.exit(${code});\n`,
    );
  } catch (e) {
    throw new Error(`cannot write fake archlint: ${e.message}`);
  }
  return { kind: 'node-script', script, source: 'test double' };
}

function stdout() { return out.join('\n'); }
function stderr() { return err.join('\n'); }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'xp-gate-arch-ratchet-'));
  out = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => out.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a) => err.push(a.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('runBaselineRatchet', () => {
  it('passes when archlint reports no new findings (exit 0)', () => {
    const code = __internals.runBaselineRatchet(root, fakeArchlint(0), join(root, '.architecture-baseline.json'));
    expect(code).toBe(0);
    expect(stdout()).toContain('no new');
  });

  it('blocks on new findings (exit 1) and names the refresh command', () => {
    // "Blocked" alone leaves the reader to guess whether to fix the code or refresh
    // the baseline.
    const code = __internals.runBaselineRatchet(root, fakeArchlint(1), join(root, '.architecture-baseline.json'));
    expect(code).toBe(1);
    expect(stderr()).toContain('BLOCKED');
    expect(stderr()).toContain('snapshot');
    expect(stderr()).toContain('.architecture-baseline.json');
  });

  it('treats any OTHER exit code as a blocking tool failure', () => {
    // The rule that matters: exit 2 (or 127, "command not found") must never read as
    // a clean scan. A tool that cannot run must not pass the gate.
    for (const code of [2, 127, 254]) {
      out.length = 0;
      err.length = 0;
      expect(__internals.runBaselineRatchet(root, fakeArchlint(code), join(root, 'b.json'))).toBe(1);
      expect(stderr()).toContain('tool failure is treated as blocking');
    }
  });

  it('reports the ratchet mode so the operator knows which contract applied', () => {
    // Baseline present vs absent are different policies; the output must say which.
    __internals.runBaselineRatchet(root, fakeArchlint(0), join(root, '.architecture-baseline.json'));
    expect(stdout()).toContain('Baseline ratchet mode');
  });
});
