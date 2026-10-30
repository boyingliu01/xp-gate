/**
 * @test REQ-672
 * @intent 门禁的 TypeScript 实现必须**随包走**，不能随被检项目的 cwd 走。
 *
 *         `findTsGateEntry` 曾把 `process.cwd()/src/gates/<gate>.ts` 也列进候选。
 *         在开发者布局里这条永远轮不到（前三个候选先命中），所以在本仓跑任何
 *         断言都是绿的——**这正是这个缺陷能活下来的原因**。必须在 npm 安装布局
 *         下测：前三个候选都不存在，第四条的 cwd 候选才会浮上来。
 *
 *         后果不是"用错了文件"，是**被检方决定门禁怎么判**：那个文件可以是
 *         `process.exit(0)`，于是任何一个自带该路径的项目都能让自己通过任何门禁。
 *         一个能被被检对象改写的门禁不是门禁。
 *
 *         夹具把 `lib/` 复制到临时目录并**故意不放** `gates/` 兄弟目录，以此复现
 *         npm 包的布局；被检项目则种下一个 `src/gates/gate-9.ts`。
 * @covers AC-672-01
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LIB_DIR = path.resolve(__dirname, '..');

/**
 * Build an npm-install-shaped fixture and ask it to resolve gate-9.
 *
 * @returns {{ resolved: string, consumer: string, planted: string }} paths for assertions
 */
function resolveInNpmLayout() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xpg-provenance-'));
  // npm package layout: `lib/` exists, and there is NO `src/gates/` sibling three
  // levels up (that is the developer layout, which always wins when it is present).
  const pkg = path.join(root, 'node_modules', 'xp-gate');
  fs.mkdirSync(path.join(pkg, 'lib'), { recursive: true });
  fs.cpSync(LIB_DIR, path.join(pkg, 'lib'), { recursive: true });

  // The party being checked: it plants its own gate implementation.
  const consumer = path.join(root, 'consumer');
  const planted = path.join(consumer, 'src', 'gates', 'gate-9.ts');
  fs.mkdirSync(path.dirname(planted), { recursive: true });
  fs.writeFileSync(planted, 'process.exit(0)\n');

  const runner = path.join(pkg, 'lib', 'gate-runner.js');
  const script = [
    `const { findTsGateEntry } = require(${JSON.stringify(runner)});`,
    'process.stdout.write(String(findTsGateEntry("gate-9")));',
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: consumer,
    encoding: 'utf8',
    timeout: 30000,
  });
  return { resolved: (result.stdout || '').trim(), consumer, planted, root };
}

describe('findTsGateEntry 不从消费项目解析实现 (#672)', () => {
  it('AC-672-01: a project that plants src/gates/gate-9.ts cannot own the gate implementation', () => {
    const { resolved, consumer, root } = resolveInNpmLayout();
    try {
      // Whatever it resolves to (an installed package normally has no gates/ dir at
      // all, so `null` is fine), it must never be a file under the checked project:
      // that file is data supplied by the party being checked.
      expect(resolved.startsWith(consumer)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
