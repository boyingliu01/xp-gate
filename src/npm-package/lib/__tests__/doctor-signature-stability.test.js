/**
 * @test REQ-doctor-signature 钩子归属判定不得依赖会漂移的描述性数字（#854）
 * @intent 证明 `xp-gate doctor` 不再对完好钩子误报 Missing or not xp-gate。
 *   修复前实测：SIGNATURES['pre-push'] 写的是 "Pre-push Hook — 8 gates:"，
 *   而实际横幅是 "Pre-push Hook: Gate 10 (Build Integrity) + M/..."。两者
 *   从来没有匹配过，所以对任何正常安装这条检查恒为 FAIL —— 是误报，不是缺文件。
 *
 *   要点不是"把字符串改成现在这句"，而是让签名不随门禁数量漂移：
 *   pre-commit 的签名如果把 "12 numbered gates" 也算进去，下次加一道门禁
 *   就同样会恒 FAIL。签名只取稳定的身份前缀。
 *
 * @covers AC-DOCTOR-SIG-01, AC-DOCTOR-SIG-02, AC-DOCTOR-SIG-03
 */
const fs = require('node:fs');
const path = require('node:path');
const { getHookSignatures, isXpGateHookContent } = require('../doctor');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

describe('#854 doctor hook signatures', () => {
  it('recognises the real shipped pre-push hook', () => {
    // End-to-end against the actual file. A signature that only matches a
    // hand-written fixture in this test would still fail on every install.
    const hookPath = path.join(REPO_ROOT, 'githooks', 'pre-push');
    const content = fs.readFileSync(hookPath, 'utf8');
    expect(isXpGateHookContent('pre-push', content)).toBe(true);
  });

  it('recognises the real shipped pre-commit and post-merge hooks', () => {
    for (const name of ['pre-commit', 'post-merge']) {
      const content = fs.readFileSync(path.join(REPO_ROOT, 'githooks', name), 'utf8');
      expect(isXpGateHookContent(name, content)).toBe(true);
    }
  });

  it('does not encode a gate COUNT in any signature', () => {
    // A signature containing a number would break the moment a gate is added or
    // removed, which is exactly how pre-push's "8 gates" rotted.
    for (const [name, sig] of Object.entries(getHookSignatures())) {
      expect(Number.isFinite(Number(sig.match(/\d+/)?.[0]))).toBe(false);
    }
  });

  it('still rejects a foreign hook that merely mentions xp-gate', () => {
    // Loosening the signature must not make the check useless: the point of the
    // check is to tell OUR hook from someone else's.
    expect(isXpGateHookContent('pre-push', '#!/bin/bash\necho "some other tool"\n')).toBe(false);
  });

  it('rejects an xp-gate hook placed under the wrong name', () => {
    // Signatures are per-hook; a pre-commit file must not satisfy pre-push.
    const preCommit = fs.readFileSync(path.join(REPO_ROOT, 'githooks', 'pre-commit'), 'utf8');
    expect(isXpGateHookContent('pre-push', preCommit)).toBe(false);
  });
});
