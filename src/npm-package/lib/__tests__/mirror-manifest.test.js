/**
 * @test REQ-654 镜像清单必须自证完整：漏登记的规范源文件要报错，而不是静默不同步
 * @intent 会话日志里 `mirror/sync` 类失败 **58 次**，git 历史反复出现
 *         `fix(mirror): ...` / `fix(package): 把 java.sh 改动落到真正的源文件`。
 *
 *         根因不是模型不知道规则——`AGENTS.md` 写得很清楚——而是这类约束是
 *         **结构性信息**：哪个文件是源、哪个是镜像、谁依赖谁。模型即使知道规则，
 *         也要在多文件编辑中持续追踪映射关系，而这正是工具该做的事。
 *
 *         提示词救不了的部分，必须靠**漏登记即报错**来兜底。静默不同步是最坏的形态：
 *         它让一次疏忽变成一次发布回滚（v0.27.3 正是只改镜像导致发布回滚）。
 * @covers AC-654-01, AC-654-02, AC-654-03
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { findUnlistedSources, declareSources } = require('../mirror-manifest');

const REPO = path.join(__dirname, '..', '..', '..', '..');

describe('镜像清单完整性 (#654)', () => {
  it('AC-654-01: 列出 canonical 目录下所有应被镜像的文件', () => {
    const declared = declareSources({ cwd: REPO });
    expect(Array.isArray(declared)).toBe(true);
    // A manifest that silently returns nothing would pass every other assertion here,
    // so pin the shape: real file lists are non-trivial.
    expect(declared.length).toBeGreaterThan(20);
    for (const entry of declared) {
      expect(typeof entry.source).toBe('string');
      expect(typeof entry.mirror).toBe('string');
      // Both paths are repo-relative, forward-slashed, so drift messages are readable.
      expect(entry.source.includes('\\')).toBe(false);
      expect(entry.mirror.includes('\\')).toBe(false);
    }
  });

  it('AC-654-02: 实际存在的规范源文件若未登记，必须被报出来', () => {
    const unlisted = findUnlistedSources({ cwd: REPO });
    // The invariant the issue asks for: zero unlisted sources. This is the assertion
    // that turns "someone forgot to register java.sh" from a publish-time rollback
    // into a red test at commit time.
    expect(unlisted).toEqual([]);
  });

  it('AC-654-03: 合成一个未登记文件时能被检出（防止检测器本身失效）', () => {
    // A detector that never fires is indistinguishable from "no drift". Prove it fires
    // on a synthetic tree rather than trusting the empty result above.
    const fixture = {
      'githooks/pre-commit': 'x',
      'githooks/lib/known.sh': 'x',
      'githooks/lib/orphan.sh': 'x',
    };
    const unlisted = findUnlistedSources({
      cwd: REPO,
      files: Object.keys(fixture),
      declared: [
        { source: 'githooks/pre-commit', mirror: 'src/npm-package/hooks/pre-commit' },
        { source: 'githooks/lib/known.sh', mirror: 'src/npm-package/hooks/lib/known.sh' },
      ],
    });
    expect(unlisted).toEqual(['githooks/lib/orphan.sh']);
  });
});
