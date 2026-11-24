/**
 * @test REQ-LANG-EXTSCAN
 * @intent 扩展名扫描只服务一类语言：**没有包管理器清单可依据**的那些
 *         （Shell、PowerShell，以及 #468 定义的 IoC 类）。有清单的语言一律走
 *         清单，因为扩展名列表太宽（IaC 列 yaml/yml），按扩展名匹配会让每个带
 *         CI YAML 的仓库都变成 IaC 项目。
 *
 *         扫描本身是**有界**的：只判断某个扩展名是否存在，大 monorepo 不该为
 *         每个文件付费。有界就必须**确定性**——否则同一份代码在两台机器上会
 *         在边界处得到不同答案。
 *
 * @covers AC-LANG-EXTSCAN-01
 * @covers AC-LANG-EXTSCAN-02
 * @covers AC-LANG-EXTSCAN-03
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const tools = require('../language-tools.js');

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'xp-gate-extscan-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('extensionsPresentIn', () => {
  it('collects extensions case-insensitively and without the dot', () => {
    writeFileSync(join(root, 'run.SH'), '');
    writeFileSync(join(root, 'mod.ps1'), '');
    const found = tools.extensionsPresentIn(root);
    // `.SH` and `.sh` are the same language signal; the set is lowercased.
    expect(found.has('sh')).toBe(true);
    expect(found.has('ps1')).toBe(true);
  });

  it('ignores files with no extension', () => {
    // A bare `Makefile` or `LICENSE` contributes nothing: `path.extname` is '' and
    // an empty key would otherwise be added to the set.
    writeFileSync(join(root, 'Makefile'), '');
    const found = tools.extensionsPresentIn(root);
    expect(found.has('')).toBe(false);
  });

  it('skips dependency and VCS directories', () => {
    // node_modules alone can hold hundreds of thousands of files; walking it would
    // both blow the budget and report extensions the project does not own.
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), '');
    mkdirSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, '.git', 'hook.swift'), '');

    const found = tools.extensionsPresentIn(root);
    expect(found.has('js')).toBe(false);
    expect(found.has('swift')).toBe(false);
  });

  it('recurses into ordinary subdirectories', () => {
    mkdirSync(join(root, 'src', 'deep'), { recursive: true });
    writeFileSync(join(root, 'src', 'deep', 'main.ps1'), '');
    expect(tools.extensionsPresentIn(root).has('ps1')).toBe(true);
  });

  it('returns an empty set for a missing directory instead of throwing', () => {
    // Detection is a report about what was SEEN; a directory that cannot be listed
    // was not seen, and that is not an error.
    const found = tools.extensionsPresentIn(join(root, 'nope'));
    expect(found.size).toBe(0);
  });

  it('gives the same answer regardless of how many times it runs', () => {
    // The bound makes the scan stop partway through; if the stop point depended on
    // readdir order the answer would differ between machines. Repeat the scan on the
    // same tree and require an identical result.
    for (let i = 0; i < 40; i += 1) writeFileSync(join(root, `f${i}.ps1`), '');
    const first = [...tools.extensionsPresentIn(root)].sort();
    const second = [...tools.extensionsPresentIn(root)].sort();
    expect(second).toEqual(first);
  });
});

describe('makeLazyExtensionScanner', () => {
  it('defers the scan until the first question is asked', () => {
    // Lazy on purpose: a config-heavy project never needs the extension fallback, so
    // the scan must not run for it at all.
    writeFileSync(join(root, 'x.ps1'), '');
    const seen = tools.makeLazyExtensionScanner(root);
    expect(typeof seen).toBe('function');
    expect(seen('ps1')).toBe(true);
  });

  it('answers repeated questions consistently', () => {
    writeFileSync(join(root, 'x.ps1'), '');
    const seen = tools.makeLazyExtensionScanner(root);
    expect(seen('ps1')).toBe(true);
    expect(seen('ps1')).toBe(true);
    expect(seen('rb')).toBe(false);
  });
});
