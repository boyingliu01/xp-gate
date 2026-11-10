/**
 * @test REQ-DEPLOY-001 六个消费方不持有私有 hook/gate 字面量清单（AC-DEPLOY-07）
 * @intent 「清单数据化」只有在这六个消费方真的都从 deploy-manifest 取值时才成立。
 *   逐个改完仍可能漂移——新增消费方、或改回字面量，都不会有任何测试变红。这里
 *   用两条互补的断言把契约钉死：
 *     (1) 每个消费方都必须 require deploy-manifest；
 *     (2) 每个消费方都不许再出现形如 gate-*.sh / pre-commit 的数组字面量。
 *   断言范围本身就是契约（下方 CONSUMERS 常量），新增消费方必须同步登记，否则
 *   它就成了无人看守的第七份清单。
 * @covers AC-DEPLOY-07
 */
const fs = require('node:fs');
const path = require('node:path');

const LIB_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(LIB_DIR, '..', '..', '..');

/**
 * The six deployment consumers named by the specification. Adding a consumer
 * without adding it here leaves it unguarded — that is the drift this test
 * exists to catch, so the list is data, not comments.
 */
const CONSUMERS = [
  { name: 'shared-utils', file: path.join(LIB_DIR, 'shared-utils.js') },
  { name: 'update-hooks', file: path.join(LIB_DIR, 'update-hooks.js') },
  { name: 'init', file: path.join(LIB_DIR, 'init.js') },
  { name: 'uninstall', file: path.join(LIB_DIR, 'uninstall.js') },
  { name: 'doctor', file: path.join(LIB_DIR, 'doctor.js') },
  { name: 'install.sh', file: path.join(REPO_ROOT, 'githooks', 'install.sh') },
];

/** A literal list of hook names or gate filenames, as a JS/shell array. */
const PRIVATE_LIST_PATTERNS = [
  // JS array whose first two elements are hook names
  /\[\s*'pre-commit'\s*,\s*'pre-push'/,
  // JS array of gate filenames
  /\[\s*'gate-\d+[^']*\.sh'\s*,\s*'gate-/,
  // shell word-list assignments of gates/hooks
  /^\s*GATE_SCRIPTS\s*=\s*"gate-/m,
  /^\s*HOOKS_LIST\s*=\s*"pre-commit/m,
];

describe('six deploy consumers hold no private file lists (REQ-DEPLOY-001)', () => {
  it.each(CONSUMERS)('$name 消费 deploy-manifest 而不是自持清单', ({ name, file }) => {
    expect(fs.existsSync(file), `${name} 不存在：${file}`).toBe(true);
    const src = fs.readFileSync(file, 'utf8');

    // init.js is explicitly allowed to reach the manifest only indirectly: it
    // calls shared-utils.copyHooks, which is the consumer that reads the list.
    if (name === 'init') {
      expect(src).toMatch(/require\(['"]\.\/shared-utils\.js['"]\)/);
      expect(src).toMatch(/copyHooks/);
    } else if (name === 'install.sh') {
      expect(src).toMatch(/DEPLOY_MANIFEST|deploy-manifest\.sh/);
    } else {
      expect(src, `${name} 未 require deploy-manifest`).toMatch(
        /require\(['"]\.\/deploy-manifest\.js['"]\)/,
      );
    }

    for (const pattern of PRIVATE_LIST_PATTERNS) {
      expect(src, `${name} 仍持有私有清单（匹配 ${pattern}）`).not.toMatch(pattern);
    }
  });

  it('消费方清单与 specification 登记的六方一致（meta-断言）', () => {
    const spec = fs.readFileSync(path.join(REPO_ROOT, 'specification.yaml'), 'utf8');
    // The spec names exactly these six in AC-DEPLOY-07's parent requirement.
    for (const { name } of CONSUMERS) {
      const label = name === 'install.sh' ? 'install.sh' : name;
      expect(spec, `REQ-DEPLOY-001 描述里未提到消费方 ${label}`).toContain(label);
    }
  });
});
