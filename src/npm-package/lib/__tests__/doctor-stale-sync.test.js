/**
 * @test REQ-DOCTOR-STALE-SYNC
 * @intent 陈旧 hook 刷新的路径解析，藏着一个**会制造残留**的陷阱：
 *
 *         `adapters/<f>.sh` 在清单里只出现一次，但 `copyAdapters` 会写**两份**
 *         （扁平的和嵌套的）。所以：
 *
 *         - 两份都必须被检查，否则改到任一份都会绕过守卫；
 *         - 但扁平副本**只在它已存在时**才被判断——在这里创建一份，恰好就是
 *           #500 所说的"安装器残留"。
 *
 *         判断题写反了会主动制造缺失的残留文件；漏掉扁平的会让人以为加固已经
 *         生效。两个方向都错。
 *
 * @covers AC-DOCTOR-STALE-SYNC-01
 * @covers AC-DOCTOR-STALE-SYNC-02
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const { staleSyncEntries } = require('../doctor.js');

let root;
let srcDir;
let hooksDest;
let adaptersDest;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'xp-gate-stale-'));
  srcDir = join(root, 'src');
  hooksDest = join(root, 'installed-hooks');
  adaptersDest = join(root, 'installed-adapters');
  try {
    mkdirSync(adaptersDest, { recursive: true });
  } catch (e) {
    throw new Error(`cannot create fixture: ${e.message}`);
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('staleSyncEntries', () => {
  it('maps a hook label to the hooks/ directory', () => {
    const entries = staleSyncEntries('pre-commit', srcDir, hooksDest, adaptersDest);
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe(join(srcDir, 'hooks', 'pre-commit'));
    expect(entries[0].target).toBe(join(hooksDest, 'pre-commit'));
  });

  it('treats sprint-gate.sh as a top-level file, not one under hooks/', () => {
    // It is shipped beside the sources, not inside hooks/; the wrong base would make
    // the refresh copy from a path that does not exist.
    const entries = staleSyncEntries('sprint-gate.sh', srcDir, hooksDest, adaptersDest);
    expect(entries[0].source).toBe(join(srcDir, 'sprint-gate.sh'));
  });

  it('judges an adapter in its nested location', () => {
    const entries = staleSyncEntries('adapters/typescript.sh', srcDir, hooksDest, adaptersDest);
    expect(entries[0].target).toBe(join(adaptersDest, 'adapters', 'typescript.sh'));
  });

  it('does NOT invent a flat adapter copy when none exists', () => {
    // Creating one here would plant exactly the installer residue #500 is about.
    const entries = staleSyncEntries('adapters/typescript.sh', srcDir, hooksDest, adaptersDest);
    expect(entries.some((e) => e.name.includes('flat'))).toBe(false);
    expect(entries).toHaveLength(1);
  });

  it('also judges the flat adapter copy when it is already on disk', () => {
    // A machine edit to EITHER copy must block the refresh, or the hardening is lost
    // silently.
    try {
      writeFileSync(join(adaptersDest, 'typescript.sh'), '#!/bin/bash\n');
    } catch (e) {
      throw new Error(`cannot write fixture: ${e.message}`);
    }
    const entries = staleSyncEntries('adapters/typescript.sh', srcDir, hooksDest, adaptersDest);
    expect(entries).toHaveLength(2);
    const flat = entries.find((e) => e.name.includes('flat'));
    expect(flat).toBeDefined();
    expect(flat.target).toBe(join(adaptersDest, 'typescript.sh'));
  });

  it('falls back to the adapters directory for any other label', () => {
    const entries = staleSyncEntries('gate-entries/gate-1-entry.sh', srcDir, hooksDest, adaptersDest);
    expect(entries[0].target).toBe(join(adaptersDest, 'gate-entries/gate-1-entry.sh'));
  });
});
