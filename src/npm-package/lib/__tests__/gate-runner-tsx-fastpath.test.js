/**
 * @test REQ-cli-tsx-fast-path gate-runner.js
 * @intent 验证 TS 门禁优先用已安装的 tsx 经 node 直启，而不是每次都走
 * `npx -y tsx`；并验证 tsx 缺失时仍回退 npx，不把加速路径变成硬依赖。
 * @covers AC-TSX-FASTPATH-01, AC-TSX-FASTPATH-02, AC-TSX-FASTPATH-03,
 *         AC-TSX-FASTPATH-04, AC-TSX-FASTPATH-05
 *
 * Why these assertions and not a stopwatch: the point of the change is that the
 * gate runs the SAME file with the SAME arguments, started differently. A timing
 * test on CI would be flaky and would prove nothing about correctness; asserting
 * on argv proves the equivalence, and the measured numbers live in the commit
 * message and in the docstring where they cannot rot into a false pass.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { findTsxEntry, resolveTsRunner } = require('../gate-runner');

let tmpRoot;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xpgate-tsx-'));
});

afterEach(() => {
  if (tmpRoot && fs.existsSync(tmpRoot)) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

/** Materialise a fake node_modules/tsx/dist/cli.mjs under `dir`. */
function plantTsx(dir) {
  const entry = path.join(dir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, '// fake tsx\n');
  return entry;
}

describe('findTsxEntry', () => {
  it('AC-TSX-FASTPATH-01: finds a tsx installed in the consumer project', () => {
    const planted = plantTsx(tmpRoot);

    expect(findTsxEntry(tmpRoot)).toBe(planted);
  });

  it('AC-TSX-FASTPATH-02: returns null when no tsx is reachable', () => {
    // An empty temp dir has no node_modules, so the consumer lookup must miss.
    // The package's own and the node-prefix lookups are environment-dependent,
    // so this test only asserts the consumer branch via a path that cannot exist.
    const nowhere = path.join(tmpRoot, 'does', 'not', 'exist');
    expect(findTsxEntry(nowhere)).toBeNull();
  });

  it('AC-TSX-FASTPATH-03: tolerates a missing consumer cwd argument', () => {
    // Callers may omit the cwd; that must not throw, only skip the branch.
    expect(() => findTsxEntry(undefined)).not.toThrow();
  });
});

describe('resolveTsRunner', () => {
  it('AC-TSX-FASTPATH-04: starts a local tsx with node, preserving entry and gate args', () => {
    const planted = plantTsx(tmpRoot);

    const [command, args] = resolveTsRunner('/gate/entry.ts', ['--run', '--cwd', '.'],
      tmpRoot);

    expect(command).toBe(process.execPath);
    expect(args).toEqual([planted, '/gate/entry.ts', '--run', '--cwd', '.']);
    // The gate must not be able to tell which route started it, so no npx flag
    // may leak into the direct-start argv.
    expect(args).not.toContain('-y');
  });

  it('AC-TSX-FASTPATH-05: falls back to npx tsx when no tsx is installed', () => {
    const nowhere = path.join(tmpRoot, 'absent');

    const [command, args] = resolveTsRunner('/gate/entry.ts', ['--run'], nowhere);

    // Either node-running-npx-cli.js or a bare `npx`, but never the direct path.
    expect(['npx', process.execPath]).toContain(command);
    expect(args.join(' ')).toContain('tsx');
    expect(args.join(' ')).toContain('/gate/entry.ts');
    expect(args.join(' ')).toContain('--run');
  });
});
