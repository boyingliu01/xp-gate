/**
 * @test REQ-423
 * @intent Gate MW 只认绑定到当前 HEAD 的证据，因此提交进仓库的
 *         `.code-walkthrough-result.json` 永远不可能授权任何一次推送，却会被
 *         人和工具当作一份既成 APPROVED 记录（走查 FC-04/MAJ-01 实测：仓库里
 *         躺着一条指向另一分支、且缺少 channel 字段的旧证据）。瞬态证据必须
 *         像 tsconfig.tsbuildinfo 一样不被跟踪。
 * @covers AC-423-07
 */
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = '.code-walkthrough-result.json';

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

describe('walkthrough evidence is a transient artifact (#423)', () => {
  it(`AC-423-07: ${EVIDENCE} is not tracked in the repository`, () => {
    const tracked = git(['ls-files', EVIDENCE]).trim();
    expect(tracked).toBe('');
  });

  it(`AC-423-07: ${EVIDENCE} is ignored so a completed walkthrough cannot be committed by accident`, () => {
    // --no-index: ask the ignore rules directly. Without it git silently skips
    // any path present in the index, so the assertion would pass on the very
    // state this guard exists to catch.
    expect(() => git(['check-ignore', '--no-index', '-q', EVIDENCE])).not.toThrow();
  });
});
